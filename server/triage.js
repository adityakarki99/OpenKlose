import { createHash } from 'node:crypto';
import { JEV_MODEL, JevError, callJev } from './jev.js';

/**
 * Feedback triage: before the agent reads a sketch's open comments, Jev
 * (TypeSafe AI) says what each one asks for and how much work it is. The
 * tray can then show "3 quick fixes, 1 rethink" instead of a count, the agent
 * can batch the quick ones and ask about the rest, and the hub can tell
 * feedback that needs a conversation from feedback that needs a minute.
 *
 * One request per sketch covers every open comment on it that hasn't been
 * triaged yet (two Choice questions per comment: kind and effort). Answers
 * are stored on the comment as `triage`, keyed by a hash of exactly what was
 * sent, so an edited comment is asked about again and an unchanged one never
 * is. Opt-in like everything Jev-backed: a key, and an explicit button or
 * flag. This is the one Jev feature that sends text the user wrote — the
 * comment itself, with the sketch's name and description and the targeted
 * element's tag and text — and the README says so.
 */

export const TRIAGE_KINDS = {
  copy: 'Wording or content: a label, heading, placeholder, number or sentence should say something else',
  visual: 'How it looks: colour, contrast, spacing, size, typography, border, radius, shadow, icon',
  layout: 'How it is arranged: alignment, order, grouping, position, responsiveness, what goes where',
  behaviour: 'What it does: interaction, state, data, validation, loading, animation, accessibility',
  scope: 'Asks for something new: another element, section, state, variant or component, or a different direction',
};

export const TRIAGE_EFFORTS = {
  quick: 'A small, local change of one or two properties or words; no judgement calls needed',
  moderate: 'A contained change to one part of the sketch that takes some care or a few decisions',
  rethink: 'Changes the design or its structure, or is ambiguous; worth a conversation before doing it',
};

export const MAX_COMMENTS_PER_REQUEST = 30;
const SKETCH_DESCRIPTION_CHARS = 300;
const COMMENT_CHARS = 500;

function sketchContext(node) {
  return {
    name: node.name || '',
    description: (node.description || '').slice(0, SKETCH_DESCRIPTION_CHARS),
    status: node.status === 'built' ? 'built' : 'sketch',
    file: node.builtFilePath || null,
  };
}

function commentState(comment) {
  const el = comment.element;
  return {
    text: (comment.text || '').slice(0, COMMENT_CHARS),
    element: el ? { tag: el.tagName || '', text: (el.text || '').slice(0, 100), classes: (el.classes || '').slice(0, 150) } : null,
  };
}

/** What a comment's cached triage is keyed on: the comment and the sketch it is about, as sent. */
export function triageKey(node, comment) {
  return createHash('sha1').update(JSON.stringify({ sketch: sketchContext(node), comment: commentState(comment) })).digest('hex').slice(0, 16);
}

function commentId(i) {
  return `C${String(i + 1).padStart(2, '0')}`;
}

/** The request for one sketch's comments. Exported so tests can pin what is sent. */
export function buildTriageRequest(node, comments) {
  const state = { sketch: sketchContext(node), comments: {} };
  const questions = {};
  comments.forEach((c, i) => {
    const id = commentId(i);
    state.comments[id] = commentState(c);
    questions[`${id}_kind`] = {
      type: 'choice',
      instructions: `What kind of change does \`comments.${id}\` ask for on \`sketch\`? Judge from the comment's wording and, when present, the element it points at.`,
      criteria: TRIAGE_KINDS,
    };
    questions[`${id}_effort`] = {
      type: 'choice',
      instructions: `How much work is \`comments.${id}\` for the coding agent that maintains \`sketch\`?`,
      criteria: TRIAGE_EFFORTS,
    };
  });
  return { model: JEV_MODEL, state, questions };
}

const confidence = (a) => (typeof a?.confidence === 'number' ? Math.round(a.confidence * 100) / 100 : null);

/** Jev's answers, by comment id. Throws on an unexpected shape. */
export function readTriageAnswers(data, comments) {
  const out = {};
  comments.forEach((c, i) => {
    const id = commentId(i);
    const kind = data?.answers?.[`${id}_kind`];
    const effort = data?.answers?.[`${id}_effort`];
    if (!TRIAGE_KINDS[kind?.choice] || !TRIAGE_EFFORTS[effort?.choice]) throw new JevError('unexpected response shape');
    out[c.id] = { kind: kind.choice, effort: effort.choice, kindConfidence: confidence(kind), effortConfidence: confidence(effort) };
  });
  return out;
}

/** The open comments on `node` whose cached triage doesn't match what would be sent now. */
export function pendingTriage(node, { force = false } = {}) {
  return (node.comments || []).filter((c) => !c.resolvedAt && (force || c.triage?.key !== triageKey(node, c)));
}

/**
 * Triage every open, not-yet-triaged comment on `nodes`. Resolves to
 *   { results: { [nodeId]: { [commentId]: triage } }, summary: { total, triaged, cached, failed, error } }
 * where `total` counts open comments. A rejected key, or TypeSafe being
 * unreachable, stops the run.
 */
export async function triageComments(nodes, { apiKey, baseUrl, fetchImpl, timeoutMs, retryDelayMs, force = false, onProgress = () => {} } = {}) {
  if (!apiKey) throw new JevError('TYPESAFE_API_KEY is not set');
  const jev = { apiKey, baseUrl, fetchImpl, timeoutMs, retryDelayMs };
  const results = {};
  const summary = { total: 0, triaged: 0, cached: 0, failed: 0, error: null };
  const batches = [];
  for (const node of nodes) {
    const open = (node.comments || []).filter((c) => !c.resolvedAt);
    const pending = pendingTriage(node, { force });
    summary.total += open.length;
    summary.cached += open.length - pending.length;
    for (let i = 0; i < pending.length; i += MAX_COMMENTS_PER_REQUEST) batches.push({ node, comments: pending.slice(i, i + MAX_COMMENTS_PER_REQUEST) });
  }
  let done = 0;
  for (const { node, comments } of batches) {
    try {
      const data = await callJev(buildTriageRequest(node, comments), jev);
      const answers = readTriageAnswers(data, comments);
      const at = new Date().toISOString();
      results[node.id] ??= {};
      for (const c of comments) {
        results[node.id][c.id] = { ...answers[c.id], key: triageKey(node, c), model: data.model || JEV_MODEL, at };
        summary.triaged++;
      }
    } catch (err) {
      if (!(err instanceof JevError)) throw err;
      summary.failed += comments.length;
      summary.error ??= err.message;
      // A rejected key or an unreachable TypeSafe would fail every batch the
      // same way: stop, and count what never got asked as failed.
      if (err.status === 401 || err.unreachable) {
        summary.failed = summary.total - summary.cached - summary.triaged;
        break;
      }
    }
    onProgress({ done: ++done, of: batches.length });
  }
  return { results, summary };
}
