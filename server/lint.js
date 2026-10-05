import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { SKETCH_MARKER } from './export.js';
import { JEV_MODEL, JevError, NEW_BELOW, REUSE_AT, callJev } from './jev.js';
import { IGNORED_DIRS } from './scanner.js';
import { loadTheme } from './theme.js';

/**
 * Token conformance for a sketch's preview code. The /klose skill tells the
 * agent to use the repo's tokens (`bg-brand-500`, `rounded-card`,
 * `var(--primary)`) rather than Tailwind's stock palette or a hex value;
 * this is the check that says whether it did.
 *
 * Two layers, so the plain path keeps working without a key:
 *
 *   - Local: pull every class out of the code's `className` attributes, and
 *     pick the ones that are literal design values — a stock palette colour
 *     (`bg-indigo-600`), an arbitrary value (`text-[#1e293b]`, `rounded-[6px]`),
 *     or a stock radius/shadow step (`rounded-lg`) when the repo defines
 *     tokens of that kind. Each finding names the token namespace it belongs
 *     to and how many of the repo's tokens could stand in for it.
 *   - Jev (optional): one request per sketch asks, for each finding, which
 *     token represents the same design value, or none. The answer becomes a
 *     concrete replacement class, with Jev's probability as its confidence.
 *
 * Only class names and token names/values are sent — the sketch's code and
 * the repo's source never leave the machine.
 */

export const MAX_FINDINGS = 40;
const MAX_TOKENS_PER_QUESTION = 254; // + "none" stays within a Choice's 255 options

const PALETTE_RE =
  /^(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(50|[1-9]00|950)$/;

// Utilities whose value is a colour, longest first so `border-t` wins over `border`.
const COLOR_PROPS = [
  'ring-offset', 'placeholder', 'decoration', 'border-x', 'border-y', 'border-t', 'border-b', 'border-l', 'border-r',
  'border-s', 'border-e', 'divide', 'outline', 'accent', 'stroke', 'shadow', 'border', 'caret', 'text', 'fill', 'ring',
  'from', 'via', 'bg', 'to',
];
const SPACING_PROPS = new Set([
  'p', 'px', 'py', 'pt', 'pb', 'pl', 'pr', 'ps', 'pe', 'm', 'mx', 'my', 'mt', 'mb', 'ml', 'mr', 'ms', 'me',
  'gap', 'gap-x', 'gap-y', 'space-x', 'space-y', 'w', 'h', 'min-w', 'min-h', 'max-w', 'max-h', 'size',
  'inset', 'inset-x', 'inset-y', 'top', 'bottom', 'left', 'right', 'start', 'end', 'translate-x', 'translate-y',
]);
const RADIUS_RE = /^rounded(?:-(?:t|b|l|r|s|e|tl|tr|bl|br|ss|se|es|ee))?(?:-(none|sm|md|lg|xl|2xl|3xl|full))?$/;
const SHADOW_RE = /^shadow(?:-(sm|md|lg|xl|2xl|inner|none))?$/;
const COLOR_VALUE_RE = /^(#[0-9a-f]{3,8}|(rgba?|hsla?|oklch|oklab|lab|lch|color)\(.*\)|\d{1,3}(\.\d+)?\s+\d{1,3}(\.\d+)?%?\s+\d{1,3}(\.\d+)?%?)$/i;
const LENGTH_RE = /^-?\d*\.?\d+(px|rem|em|%|vh|vw|ch|svh|dvh)$/;

/** @typedef {{ name: string, value: string, kind: string, utility: string | null }} Token */
/** @typedef {{ class: string, utility: string, property: string, value: string, kind: 'palette' | 'arbitrary' | 'scale', namespace: string, candidates: number }} Finding */

// --------------------------------------------------------- classes in code

/**
 * Every string literal's text inside a JS expression. A template literal's
 * `${…}` holes are expressions themselves (`${muted ? 'text-slate-500' : ''}`),
 * so their strings are collected too, and the hole itself becomes a space.
 */
function stringsIn(expr) {
  const out = [];
  for (const m of expr.matchAll(/"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|`((?:\\.|[^`\\])*)`/g)) {
    if (m[3] === undefined) {
      out.push(m[1] ?? m[2]);
      continue;
    }
    const holes = [...m[3].matchAll(/\$\{([^}]*)\}/g)].map((h) => h[1]);
    out.push(m[3].replace(/\$\{[^}]*\}/g, ' '));
    for (const hole of holes) out.push(...stringsIn(hole));
  }
  return out;
}

/** The distinct class names a sketch applies, in order of first appearance. */
export function extractClasses(code) {
  const classes = new Set();
  for (const m of String(code || '').matchAll(/\b(?:className|class)\s*=\s*/g)) {
    const i = m.index + m[0].length;
    const ch = code[i];
    let text = '';
    if (ch === '"' || ch === "'") {
      const end = code.indexOf(ch, i + 1);
      if (end < 0) continue;
      text = code.slice(i + 1, end);
    } else if (ch === '{') {
      let depth = 0;
      let j = i;
      for (; j < code.length; j++) {
        if (code[j] === '{') depth++;
        else if (code[j] === '}' && --depth === 0) break;
      }
      text = stringsIn(code.slice(i + 1, j)).join(' ');
    } else {
      continue;
    }
    for (const c of text.split(/\s+/)) if (c) classes.add(c);
  }
  return [...classes];
}

/**
 * `hover:md:!bg-indigo-600/50` → variants `hover:md:`, important, utility
 * `bg-indigo-600`, opacity `/50`. Colons and slashes inside `[…]` belong to
 * the value, not to the syntax.
 */
export function splitClass(cls) {
  let depth = 0;
  let lastColon = -1;
  let slash = -1;
  for (let i = 0; i < cls.length; i++) {
    const ch = cls[i];
    if (ch === '[') depth++;
    else if (ch === ']') depth--;
    else if (depth === 0 && ch === ':') lastColon = i;
    else if (depth === 0 && ch === '/') slash = i;
  }
  const variants = lastColon >= 0 ? cls.slice(0, lastColon + 1) : '';
  let rest = cls.slice(lastColon + 1);
  const opacity = slash > lastColon ? cls.slice(slash) : '';
  if (opacity) rest = rest.slice(0, rest.length - opacity.length);
  const important = rest.startsWith('!') ? '!' : '';
  if (important) rest = rest.slice(1);
  return { variants, important, utility: rest, opacity };
}

/** `bg-[#fff]` → { property: 'bg', value: '#fff', arbitrary: true }; `bg-indigo-600` → { property: 'bg', value: 'indigo-600' }. */
function parseUtility(utility) {
  const arbitrary = /^([a-z][a-z0-9-]*?)-\[(.+)\]$/.exec(utility);
  if (arbitrary) return { property: arbitrary[1], value: arbitrary[2], arbitrary: true };
  const radius = RADIUS_RE.exec(utility);
  if (radius) return { property: 'rounded', value: radius[1] || 'DEFAULT', arbitrary: false, stock: true };
  const shadow = SHADOW_RE.exec(utility);
  if (shadow) return { property: 'shadow', value: shadow[1] || 'DEFAULT', arbitrary: false, stock: true };
  for (const prop of COLOR_PROPS) {
    if (utility.startsWith(`${prop}-`)) return { property: prop, value: utility.slice(prop.length + 1), arbitrary: false };
  }
  const dash = utility.indexOf('-');
  if (dash > 0) return { property: utility.slice(0, dash), value: utility.slice(dash + 1), arbitrary: false };
  return { property: utility, value: '', arbitrary: false };
}

/** Which token namespace a literal class belongs to, and whether it is literal at all. */
function classifyClass(utility) {
  const { property, value, arbitrary, stock } = parseUtility(utility);
  const isColorProp = COLOR_PROPS.includes(property);
  if (arbitrary) {
    if (isColorProp && COLOR_VALUE_RE.test(value)) return { property, value, kind: 'arbitrary', namespace: 'color' };
    if (property === 'rounded' || property.startsWith('rounded-')) return { property: 'rounded', value, kind: 'arbitrary', namespace: 'radius' };
    if (property === 'shadow') return { property, value, kind: 'arbitrary', namespace: 'shadow' };
    if (property === 'text' && LENGTH_RE.test(value)) return { property, value, kind: 'arbitrary', namespace: 'text' };
    if (property === 'font') return { property, value, kind: 'arbitrary', namespace: 'font' };
    if (SPACING_PROPS.has(property) && LENGTH_RE.test(value)) return { property, value, kind: 'arbitrary', namespace: 'spacing' };
    return null;
  }
  if (isColorProp && PALETTE_RE.test(value)) return { property, value, kind: 'palette', namespace: 'color' };
  // Only Tailwind's own steps are literals; `rounded-card` or `shadow-soft` is a repo token in use.
  if (stock && property === 'rounded' && value !== 'none') return { property, value, kind: 'scale', namespace: 'radius' };
  if (stock && property === 'shadow' && value !== 'none') return { property, value, kind: 'scale', namespace: 'shadow' };
  return null;
}

// ---------------------------------------------------------------- tokens

const NAMESPACE_PREFIX = { color: '--color-', radius: '--radius-', shadow: '--shadow-', font: '--font-', text: '--text-', spacing: '--spacing-' };

/**
 * The utility class a token is reached by. A Tailwind `@theme` token has one
 * (`--color-brand-500` → `bg-brand-500` for `bg`); a plain `:root` variable is
 * used through `var()`. Returns a function of the property, or null.
 */
function utilityFor(token) {
  const prefix = NAMESPACE_PREFIX[token.kind];
  if (prefix && token.name.startsWith(prefix)) {
    const suffix = token.name.slice(prefix.length);
    if (token.kind === 'radius') return () => `rounded-${suffix}`;
    if (token.kind === 'shadow') return () => `shadow-${suffix}`;
    if (token.kind === 'font') return () => `font-${suffix}`;
    if (token.kind === 'text') return () => `text-${suffix}`;
    return (property) => `${property}-${suffix}`;
  }
  return (property) => `${property}-[var(${token.name})]`;
}

/**
 * The repo's tokens as the lint sees them, from the CSS `klose theme` renders
 * previews with: every custom property in its `@theme` blocks and `:root`
 * rules, with a namespace from its name (`--color-*`, `--radius-*`, …) or,
 * for a plain `:root` variable, from the look of its value.
 */
export function tokensFromCss(css) {
  const seen = new Map();
  for (const m of String(css || '').replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;{}]+)/g)) {
    const name = m[1];
    if (seen.has(name)) continue;
    const value = m[2].trim();
    let kind = Object.entries(NAMESPACE_PREFIX).find(([, prefix]) => name.startsWith(prefix))?.[0];
    if (!kind) kind = COLOR_VALUE_RE.test(value) ? 'color' : 'other';
    seen.set(name, { name, value, kind });
  }
  return [...seen.values()].filter((t) => t.kind !== 'other');
}

// ------------------------------------------------------------- findings

/** The literal design values in a sketch, each with how many repo tokens could replace it. */
export function findLiterals(code, tokens) {
  const perNamespace = {};
  for (const t of tokens) perNamespace[t.kind] = (perNamespace[t.kind] || 0) + 1;
  const findings = [];
  for (const cls of extractClasses(code)) {
    const { utility } = splitClass(cls);
    const hit = classifyClass(utility);
    if (!hit) continue;
    const candidates = perNamespace[hit.namespace] || 0;
    // A stock radius or shadow step is only off-system when the repo has its own.
    if (hit.kind === 'scale' && !candidates) continue;
    // A palette colour in a repo with no colour tokens has nothing to become.
    if (hit.kind === 'palette' && !candidates) continue;
    findings.push({ class: cls, utility, ...hit, candidates });
  }
  return findings;
}

function tokenId(i) {
  return `T${String(i + 1).padStart(3, '0')}`;
}
function findingId(i) {
  return `K${String(i + 1).padStart(2, '0')}`;
}

/** The request for one sketch's findings. Exported so tests can pin what is sent. */
export function buildLintRequest(findings, tokens) {
  const byNamespace = new Map();
  for (const t of tokens) {
    if (!byNamespace.has(t.kind)) byNamespace.set(t.kind, []);
    byNamespace.get(t.kind).push(t);
  }
  const used = new Map(); // token name -> id
  const state = { tokens: {}, classes: {} };
  const questions = {};
  const offered = []; // per finding: the token ids its question offered
  findings.forEach((f, i) => {
    const id = findingId(i);
    state.classes[id] = { class: f.class, property: f.property, value: f.value, kind: f.namespace };
    const criteria = {};
    for (const t of (byNamespace.get(f.namespace) || []).slice(0, MAX_TOKENS_PER_QUESTION)) {
      if (!used.has(t.name)) {
        const tid = tokenId(used.size);
        used.set(t.name, tid);
        state.tokens[tid] = { name: t.name, value: t.value, kind: t.kind };
      }
      criteria[used.get(t.name)] = null;
    }
    offered.push(new Set(Object.keys(criteria)));
    criteria.none = 'No token in `tokens` stands for this value; the literal should stay';
    questions[id] = {
      type: 'choice',
      instructions: {
        question:
          `Which token in \`tokens\` represents the same design value as \`classes.${id}\` — the one a developer ` +
          'should use instead of the literal so the sketch follows this repository\'s design system? ' +
          'Match on meaning and value: a brand or primary colour token for a primary-looking blue, a radius token ' +
          'close to the literal radius, and so on.',
      },
      criteria,
    };
  });
  return { model: JEV_MODEL, state: { ...state }, questions, _ids: [...used.entries()], _offered: offered };
}

export function verdictFor(confidence) {
  if (confidence >= REUSE_AT) return 'replace';
  return confidence < NEW_BELOW ? 'keep' : 'maybe';
}

/** Merges Jev's answer into the findings: a replacement class per finding, or none. */
export function applyLintAnswers(findings, tokens, request, data) {
  const byId = new Map(request._ids.map(([name, id]) => [id, name]));
  const byName = new Map(tokens.map((t) => [t.name, t]));
  return findings.map((f, i) => {
    const answer = data?.answers?.[findingId(i)];
    if (!answer?.probabilities) throw new JevError('unexpected response shape');
    let best = null;
    for (const [id, p] of Object.entries(answer.probabilities)) {
      // Only a token this question offered counts; anything else is noise.
      if (id === 'none' || !byId.has(id) || !request._offered[i].has(id)) continue;
      if (!best || p > best.p) best = { id, p: Number(p) || 0 };
    }
    const keep = Number(answer.probabilities.none) || 0;
    if (!best) return { ...f, verdict: 'keep', keep, suggestion: null };
    const token = byName.get(byId.get(best.id));
    const { variants, important, opacity } = splitClass(f.class);
    const utility = utilityFor(token)(f.property);
    return {
      ...f,
      verdict: verdictFor(best.p),
      keep,
      suggestion: { token: token.name, value: token.value, utility, replacement: `${variants}${important}${utility}${opacity}`, confidence: Math.round(best.p * 100) / 100 },
    };
  });
}

/**
 * Lint one sketch. Resolves to
 *   { classes, tokens: { color: n, … }, findings, truncated, jev: { asked, model?, usage?, error? } }
 * The local findings never depend on Jev; with a key, each carries a
 * `suggestion` and a `verdict` (replace / maybe / keep). A Jev failure is
 * reported in `jev.error` rather than thrown: the findings are still useful.
 */
export async function lintSketch(root, code, { jev = {}, useJev = true, theme } = {}) {
  const css = theme ? theme.css : (await loadTheme(root)).css;
  const tokens = tokensFromCss(css);
  const tokenCounts = {};
  for (const t of tokens) tokenCounts[t.kind] = (tokenCounts[t.kind] || 0) + 1;
  const all = findLiterals(code, tokens);
  let findings = all.slice(0, MAX_FINDINGS);
  const result = { classes: extractClasses(code).length, tokens: tokenCounts, truncated: all.length > findings.length, jev: { asked: false } };

  const askable = findings.filter((f) => f.candidates > 0);
  if (useJev && jev.apiKey && askable.length) {
    const request = buildLintRequest(askable, tokens);
    const { _ids, _offered, ...body } = request;
    try {
      const data = await callJev(body, jev);
      const answered = new Map(applyLintAnswers(askable, tokens, request, data).map((f) => [f.class, f]));
      findings = findings.map((f) => answered.get(f.class) || { ...f, verdict: 'keep', keep: 1, suggestion: null });
      result.jev = { asked: true, model: data.model || JEV_MODEL, usage: data.usage || null };
    } catch (err) {
      if (!(err instanceof JevError)) throw err;
      result.jev = { asked: true, error: err.message };
    }
  }
  return { ...result, findings };
}

// ------------------------------------------------------- real source files

// What `klose lint <folder>` looks at: anything that can carry a className or
// class attribute. A file named on the command line is read whatever its
// extension.
const LINT_EXTS = new Set(['.tsx', '.jsx', '.js', '.ts', '.mjs', '.html', '.vue', '.svelte', '.astro', '.mdx']);
const MAX_LINT_FILES = 400;
const MAX_LINT_BYTES = 512 * 1024;

async function walkForLint(dir, out) {
  if (out.files.length >= MAX_LINT_FILES) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (out.files.length >= MAX_LINT_FILES) {
      out.truncated = true;
      return;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name) || existsSync(path.join(full, '.git'))) continue;
      await walkForLint(full, out);
    } else if (entry.isFile()) {
      if (!LINT_EXTS.has(path.extname(entry.name))) continue;
      if (/\.(test|spec|stories|d)\.[jt]sx?$/.test(entry.name)) continue;
      out.files.push(full);
    }
  }
}

/** The lines (1-based, at most five) on which a class name appears as a whole token. */
export function linesWith(source, cls) {
  const escaped = cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[\\s"'\`{}(),])${escaped}(?=$|[\\s"'\`{}(),])`);
  const lines = [];
  const all = source.split('\n');
  for (let i = 0; i < all.length && lines.length < 5; i++) if (re.test(all[i])) lines.push(i + 1);
  return lines;
}

/**
 * Lint real source files — what an audit of the app's pages runs — against
 * the same tokens a sketch is checked against. `inputs` are files or folders,
 * relative to `cwd`; a folder is walked (skipping build output, dependencies
 * and exported sketches) and a file is read whatever its extension. Resolves to
 *
 *   { files: [{ file, classes, findings: [{ …finding, lines }], truncated }],
 *     scanned, withFindings, findings, tokens, missing, skipped, truncated,
 *     jev: { asked, errors } }
 *
 * `file` is relative to the repo root and each finding carries the lines it
 * is on, so the agent can go straight to the code. Jev is asked only when
 * `useJev` is set: it is one request per file with findings, which an audit
 * of a whole app would otherwise turn into dozens.
 */
export async function lintFiles(root, inputs, { cwd = root, jev = {}, useJev = false } = {}) {
  const theme = await loadTheme(root);
  const tokenCounts = {};
  for (const t of tokensFromCss(theme.css)) tokenCounts[t.kind] = (tokenCounts[t.kind] || 0) + 1;

  const out = { files: [], truncated: false };
  const missing = [];
  for (const input of inputs) {
    const full = path.resolve(cwd, input);
    let s;
    try {
      s = await stat(full);
    } catch {
      missing.push(input);
      continue;
    }
    if (s.isDirectory()) await walkForLint(full, out);
    else if (!out.files.includes(full)) out.files.push(full);
  }

  const files = [];
  let skipped = 0;
  const jevReport = { asked: 0, errors: [] };
  for (const full of out.files) {
    let source;
    try {
      if ((await stat(full)).size > MAX_LINT_BYTES) {
        skipped++;
        continue;
      }
      source = await readFile(full, 'utf-8');
    } catch {
      skipped++;
      continue;
    }
    if (source.includes(SKETCH_MARKER)) continue; // a sketch saved into the repo; lint it on the canvas
    const result = await lintSketch(root, source, { jev, useJev, theme });
    if (result.jev.asked) {
      jevReport.asked++;
      if (result.jev.error) jevReport.errors.push(result.jev.error);
    }
    files.push({
      file: path.relative(root, full) || path.basename(full),
      classes: result.classes,
      findings: result.findings.map((f) => ({ ...f, lines: linesWith(source, f.class) })),
      truncated: result.truncated,
    });
  }
  const withFindings = files.filter((f) => f.findings.length);
  return {
    files,
    scanned: files.length,
    withFindings: withFindings.length,
    findings: withFindings.reduce((n, f) => n + f.findings.length, 0),
    tokens: tokenCounts,
    missing,
    skipped,
    truncated: out.truncated,
    jev: jevReport,
  };
}
