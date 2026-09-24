/**
 * Optional semantic ranking for `klose components --rank`, backed by Jev, TypeSafe
 * AI's System One model (https://docs.typesafe.ai). Jev doesn't generate text: it
 * answers typed questions about a state with calibrated probabilities, which is
 * exactly the shape of "which of these components already does this job?".
 *
 * This is the only part of Klose that talks to a network service, so it is
 * strictly opt-in: it runs only when asked (--rank) and only with a
 * TYPESAFE_API_KEY. It sends component metadata the scanner already extracted
 * (name, file path, category, prop names, doc comment) — never source code —
 * and every failure falls back to the local substring search.
 */

export const JEV_MODEL = 'jev-latest';
export const JEV_DEFAULT_BASE_URL = 'https://api.typesafe.ai';

// A Choice question accepts at most 255 options.
export const MAX_CANDIDATES = 255;

// From TypeSafe's semantic-find cookbook: present answers typically read >= 0.9,
// absent ones <= 0.05. Between the two, the component is only a partial fit.
export const REUSE_AT = 0.7;
export const NEW_BELOW = 0.35;

const DESCRIPTION_CHARS = 300;
const DEFAULT_TIMEOUT_MS = 10000;
const RETRY_DELAY_MS = 1000;

export class JevError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'JevError';
    this.status = status;
  }
}

export function verdictFor(exists) {
  if (exists >= REUSE_AT) return 'reuse';
  return exists < NEW_BELOW ? 'new' : 'partial';
}

function words(text) {
  return (text || '')
    // PricingCard -> Pricing Card, so name parts match query words.
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1);
}

/**
 * Narrow a large index to the Choice option limit with a cheap local score (how
 * many query words appear in the component's searchable text), so the likeliest
 * candidates make the cut. Ties keep the scanner's alphabetical order.
 */
export function preselect(components, query, limit = MAX_CANDIDATES) {
  if (components.length <= limit) return components;
  const terms = [...new Set(words(query))];
  const scored = components.map((c, index) => {
    const hay = new Set(words(`${c.name} ${c.file} ${c.category} ${c.description} ${c.props.map((p) => p.name).join(' ')}`));
    return { c, index, score: terms.filter((t) => hay.has(t)).length };
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, limit).map((s) => s.c);
}

function optionId(i) {
  return `C${String(i + 1).padStart(3, '0')}`;
}

/** The request body for one ranking call. Exported so tests can pin what is sent. */
export function buildRequest(candidates, query) {
  const components = {};
  candidates.forEach((c, i) => {
    components[optionId(i)] = {
      name: c.name,
      file: c.file,
      category: c.category,
      props: c.props.map((p) => p.name),
      description: (c.description || '').slice(0, DESCRIPTION_CHARS),
    };
  });
  const criteria = {};
  candidates.forEach((_, i) => { criteria[optionId(i)] = null; });

  return {
    model: JEV_MODEL,
    state: { components },
    questions: {
      where: {
        type: 'choice',
        instructions: {
          need: query,
          question: 'Which component in `components` should a developer reuse, as-is or by adding a prop or variant, to build `need`?',
        },
        criteria,
      },
      exists: {
        type: 'noul',
        instructions: {
          need: query,
          question: 'Does any component in `components` already do the job described in `need`, closely enough to reuse or extend instead of building a new one?',
        },
        criteria: {
          true: 'At least one existing component does this job or is a small extension away from it',
          false: 'Nothing here does this job; it needs a new component',
        },
      },
    },
  };
}

async function post(url, apiKey, body, { fetchImpl, timeoutMs }) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new JevError(timedOut ? `no answer within ${timeoutMs / 1000}s` : `could not reach TypeSafe (${err.message})`);
  }
  if (response.ok) return response.json();
  let detail = '';
  try { detail = (await response.text()).slice(0, 200); } catch { /* no body */ }
  const reason = {
    401: 'TYPESAFE_API_KEY was rejected',
    422: `request rejected${detail ? `: ${detail}` : ''}`,
    429: 'rate limited',
    529: 'TypeSafe is overloaded',
  }[response.status] || `HTTP ${response.status}${detail ? `: ${detail}` : ''}`;
  throw new JevError(reason, response.status);
}

/**
 * Rank `components` against a plain-language `query` in one Jev request: a Choice
 * question points at the best-fitting component (relevance per candidate) and a
 * Noul question says whether anything fits at all — Choice probabilities always
 * sum to 1, so the top pick alone can't tell "reuse this" from "closest miss".
 *
 * Returns { exists, verdict, model, usage, considered, total, ranked: [{ ...component, relevance }] }
 * sorted by relevance. Throws JevError on any failure; callers fall back.
 */
export async function rankComponents(components, query, {
  apiKey,
  baseUrl = JEV_DEFAULT_BASE_URL,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retryDelayMs = RETRY_DELAY_MS,
} = {}) {
  if (!apiKey) throw new JevError('TYPESAFE_API_KEY is not set');
  if (!query || !query.trim()) throw new JevError('ranking needs a description of what you want to build');
  if (!components.length) throw new JevError('no components to rank');

  const candidates = preselect(components, query);
  const body = buildRequest(candidates, query.trim());
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/systemone`;

  let data;
  try {
    data = await post(url, apiKey, body, { fetchImpl, timeoutMs });
  } catch (err) {
    // Rate limits and overload are transient; one retry, then give up.
    if (err.status !== 429 && err.status !== 529) throw err;
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    data = await post(url, apiKey, body, { fetchImpl, timeoutMs });
  }

  const where = data?.answers?.where;
  const exists = data?.answers?.exists;
  if (!where?.probabilities || typeof exists?.noul !== 'number') {
    throw new JevError('unexpected response shape');
  }

  const ranked = candidates
    .map((c, i) => ({ ...c, relevance: Number(where.probabilities[optionId(i)]) || 0 }))
    .sort((a, b) => b.relevance - a.relevance);

  return {
    exists: exists.noul,
    verdict: verdictFor(exists.noul),
    model: data.model || JEV_MODEL,
    usage: data.usage || null,
    considered: candidates.length,
    total: components.length,
    ranked,
  };
}
