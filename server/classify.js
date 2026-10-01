import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { JEV_MODEL, JevError, callJev } from './jev.js';

/**
 * Optional enrichment for the component index: Jev (TypeSafe AI) reads each
 * component's metadata and says what it *is* — a design-system primitive, a
 * composite built from primitives, a screen, or plumbing — and what kind of UI
 * it is (an input, navigation, an overlay…). That turns a flat list of file
 * names into a map the canvas can filter and an agent can act on: "reuse the
 * primitive input, don't build a fourth one".
 *
 * Opt-in, like ranking: it runs only when asked, only with TYPESAFE_API_KEY,
 * and sends what the scanner already extracted (name, path, folder, prop names,
 * doc comment) — never source code. One request per component, a few at a
 * time (TypeSafe's own guidance: small pools, retry on 429). Answers are cached
 * per machine by a hash of exactly what was sent, so only new or changed
 * components cost anything on the next run.
 */

export const ROLES = {
  primitive: 'A design-system building block used across many screens: button, input, badge, avatar, icon, card shell',
  composite: 'Combines primitives into a reusable pattern: a form, table, nav bar, pricing card, comment thread',
  screen: 'A page, route or one-off section tied to a single feature or place in the app',
  provider: 'Layout, context, provider or utility wrapper with little or no visual output of its own',
};

export const KINDS = {
  action: 'Triggers something: button, link button, icon button, menu item',
  input: 'Takes input: text field, select, checkbox, toggle, slider, date picker, search box',
  display: 'Shows a small piece of information: badge, tag, avatar, stat, label, tooltip trigger',
  feedback: 'Tells the user what happened: alert, toast, progress, spinner, skeleton, empty state',
  navigation: 'Moves between places: nav bar, sidebar, tabs, breadcrumbs, pagination, menu',
  overlay: 'Floats above the page: modal, dialog, drawer, popover, dropdown, command palette',
  data: 'Presents collections or numbers: table, list, grid of items, chart, timeline',
  content: 'Arranges content: card, hero, section, article, header, footer, marketing block',
  layout: 'Positions other components: container, stack, grid, split pane, page shell',
  media: 'Images, video, icons, illustrations, file previews',
  other: 'None of the above',
};


const DESCRIPTION_CHARS = 300;
const CACHE_VERSION = 1;

/** Exactly what is sent for one component — and so what its cache entry is keyed on. */
function componentState(c) {
  return {
    name: c.name,
    file: c.file,
    folder: c.category,
    props: c.props.map((p) => p.name),
    description: (c.description || '').slice(0, DESCRIPTION_CHARS),
  };
}

export function componentKey(c) {
  return createHash('sha1').update(JSON.stringify(componentState(c))).digest('hex').slice(0, 16);
}

/** The request body for one component. Exported so tests can pin what is sent. */
export function buildClassifyRequest(c) {
  return {
    model: JEV_MODEL,
    state: { component: componentState(c) },
    questions: {
      role: {
        type: 'choice',
        instructions: 'What role does `component` play in this codebase\'s UI? Judge from its name, file path, folder, props and description.',
        criteria: ROLES,
      },
      kind: {
        type: 'choice',
        instructions: 'What kind of UI element is `component`?',
        criteria: KINDS,
      },
    },
  };
}

function readAnswer(data) {
  const role = data?.answers?.role;
  const kind = data?.answers?.kind;
  if (!ROLES[role?.choice] || !KINDS[kind?.choice]) throw new JevError('unexpected response shape');
  const confidence = (a) => (typeof a.confidence === 'number' ? Math.round(a.confidence * 100) / 100 : null);
  return { role: role.choice, kind: kind.choice, roleConfidence: confidence(role), kindConfidence: confidence(kind) };
}

/**
 * Classify every component `cache` doesn't already have an answer for.
 * `cache` is { [componentKey]: answer } and is filled in place. Resolves to
 * { total, classified, cached, failed, error } — `error` is the first failure's
 * message. A rejected key, or TypeSafe being unreachable, stops the run:
 * every other request would fail the same way.
 */
export async function classifyComponents(components, cache, {
  apiKey,
  baseUrl,
  fetchImpl,
  timeoutMs,
  retryDelayMs,
  concurrency = 4,
  onProgress = () => {},
} = {}) {
  if (!apiKey) throw new JevError('TYPESAFE_API_KEY is not set');
  const pending = components.filter((c) => !cache[componentKey(c)]);
  const summary = { total: components.length, classified: 0, cached: components.length - pending.length, failed: 0, error: null };

  let next = 0;
  let stopped = false;
  const worker = async () => {
    while (!stopped && next < pending.length) {
      const c = pending[next++];
      try {
        const data = await callJev(buildClassifyRequest(c), { apiKey, baseUrl, fetchImpl, timeoutMs, retryDelayMs });
        cache[componentKey(c)] = { ...readAnswer(data), at: new Date().toISOString() };
        summary.classified++;
      } catch (err) {
        summary.failed++;
        summary.error ??= err.message;
        if (err.status === 401 || err.unreachable) stopped = true;
      }
      onProgress({ done: summary.classified + summary.failed, of: pending.length });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, pending.length)) }, worker));
  // Components the run never got to count as failed, not as silently skipped.
  if (stopped) summary.failed = pending.length - summary.classified;
  return summary;
}

// ------------------------------------------------------------------ cache

// Per machine, not in the repo: the answers are an index of the code, like a
// build cache, and they're only valid for the model that gave them.
export function classificationPath(home, repoKey) {
  return path.join(home, 'index', `${repoKey}.json`);
}

export async function readClassifications(file) {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf-8'));
    return parsed.version === CACHE_VERSION && parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {};
  } catch {
    return {};
  }
}

/** Writes the cache, dropping entries for components that no longer exist. */
export async function writeClassifications(file, entries, components) {
  const live = new Set(components.map(componentKey));
  const kept = Object.fromEntries(Object.entries(entries).filter(([key]) => live.has(key)));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ version: CACHE_VERSION, model: JEV_MODEL, entries: kept }, null, 2) + '\n', 'utf-8');
  return kept;
}

/** The components with any cached answer merged in. Unclassified ones are returned as they were. */
export function annotate(components, entries) {
  return components.map((c) => {
    const found = entries[componentKey(c)];
    if (!found) return c;
    const { role, kind, roleConfidence, kindConfidence } = found;
    return { ...c, role, kind, roleConfidence, kindConfidence };
  });
}

/**
 * Primitives that seem to do the same job: two or more of the same kind (three
 * button primitives, two text inputs) usually means a design system that has
 * split. Only primitives: several composite cards or sections are normal. A
 * hint, not a verdict — worth a look before sketching yet another one.
 */
export function findDuplicates(components) {
  const groups = new Map();
  for (const c of components) {
    if (c.role !== 'primitive' || !c.kind || c.kind === 'other') continue;
    if (!groups.has(c.kind)) groups.set(c.kind, { kind: c.kind, components: [] });
    groups.get(c.kind).components.push({ id: c.id, name: c.name, file: c.file });
  }
  return [...groups.values()]
    .filter((g) => g.components.length > 1)
    .sort((a, b) => b.components.length - a.components.length || a.kind.localeCompare(b.kind));
}

// ---------------------------------------------------------------- sketches

const SKETCH_TEXT_CHARS = 300;

/** Exactly what is sent for one sketch — and so what its cached answer is keyed on. */
function sketchState(node) {
  return {
    name: node.name || '',
    description: (node.description || '').slice(0, SKETCH_TEXT_CHARS),
    notes: (node.notes || '').slice(0, SKETCH_TEXT_CHARS),
    file: node.builtFilePath || null,
  };
}

export function sketchKey(node) {
  return createHash('sha1').update(JSON.stringify(sketchState(node))).digest('hex').slice(0, 16);
}

/**
 * The request for one sketch: the same role and kind questions a component
 * gets, asked of the sketch's name, description and notes (its code is never
 * sent). Exported so tests can pin what is sent.
 */
export function buildSketchClassifyRequest(node) {
  return {
    model: JEV_MODEL,
    state: { sketch: sketchState(node) },
    questions: {
      role: {
        type: 'choice',
        instructions: 'What role would `sketch` play in this app\'s UI once built? Judge from its name, description, notes and, if it is built, its file path.',
        criteria: ROLES,
      },
      kind: {
        type: 'choice',
        instructions: 'What kind of UI element is `sketch`?',
        criteria: KINDS,
      },
    },
  };
}

/** The sketches whose stored classification doesn't match what would be sent now. */
export function unclassifiedSketches(nodes, { force = false } = {}) {
  return nodes.filter((n) => force || n.classification?.key !== sketchKey(n));
}

/**
 * Classify the sketches that aren't classified yet (or all of them with
 * `force`). Resolves to { results: { [nodeId]: classification }, summary },
 * where a classification is { role, kind, roleConfidence, kindConfidence,
 * key, model, at } and the summary is the same shape as classifyComponents'.
 */
export async function classifySketches(nodes, {
  apiKey,
  baseUrl,
  fetchImpl,
  timeoutMs,
  retryDelayMs,
  concurrency = 4,
  force = false,
  onProgress = () => {},
} = {}) {
  if (!apiKey) throw new JevError('TYPESAFE_API_KEY is not set');
  const pending = unclassifiedSketches(nodes, { force });
  const results = {};
  const summary = { total: nodes.length, classified: 0, cached: nodes.length - pending.length, failed: 0, error: null };

  let next = 0;
  let stopped = false;
  const worker = async () => {
    while (!stopped && next < pending.length) {
      const node = pending[next++];
      try {
        const data = await callJev(buildSketchClassifyRequest(node), { apiKey, baseUrl, fetchImpl, timeoutMs, retryDelayMs });
        results[node.id] = { ...readAnswer(data), key: sketchKey(node), model: data.model || JEV_MODEL, at: new Date().toISOString() };
        summary.classified++;
      } catch (err) {
        if (!(err instanceof JevError)) throw err;
        summary.failed++;
        summary.error ??= err.message;
        if (err.status === 401 || err.unreachable) stopped = true;
      }
      onProgress({ done: summary.classified + summary.failed, of: pending.length });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, pending.length)) }, worker));
  if (stopped) summary.failed = pending.length - summary.classified;
  return { results, summary };
}

/**
 * The repo's primitives a sketch looks like a second copy of: a sketch Jev
 * calls a primitive of some kind, in a repo that already has classified
 * primitives of that kind. Variants of a composite (three pricing cards) are
 * normal, so only primitives count. A hint for the canvas and the agent, not
 * a verdict.
 */
export function sketchOverlaps(classification, components, limit = 5) {
  if (!classification || classification.role !== 'primitive' || !classification.kind || classification.kind === 'other') return [];
  return components
    .filter((c) => c.role === 'primitive' && c.kind === classification.kind)
    .slice(0, limit)
    .map(({ id, name, file }) => ({ id, name, file }));
}
