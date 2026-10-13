/**
 * Reading a repo's design tokens out of its stylesheets, without touching a
 * filesystem. server/theme.js walks the repo on disk and hands the files
 * here; the hosted canvas (lib/folderBackend.ts) walks the folder the browser
 * was given and does the same. Both end up with one stylesheet for the
 * preview sandbox. No imports, so it bundles into the canvas.
 */

// Folders no scan looks inside: dependencies, build output, tooling state.
// `web`: that one used to be here and hid every component in a monorepo's
// `apps/web`. Klose's own bundle lives in `web/dist`, which `dist` covers.
export const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit',
  'coverage', '.cache', '.vercel', '.turbo', '.parcel-cache', 'vendor',
  '.klose', '.idea', '.vscode', 'tmp', 'temp',
  // Claude Code keeps agent worktrees (full copies of the repo) in here.
  '.claude',
]);

export const MAX_CSS_FILES = 400;
export const MAX_CSS_BYTES = 256 * 1024;

// Tailwind v3 theme key → Tailwind v4 CSS variable namespace.
export const NAMESPACES = {
  colors: 'color',
  fontFamily: 'font',
  fontSize: 'text',
  borderRadius: 'radius',
  boxShadow: 'shadow',
  spacing: 'spacing',
};

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Returns the text between the `{` at `open` and its matching `}`. */
function blockBody(css, open) {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  return null;
}

function customProperties(body) {
  const decls = [];
  for (const decl of body.split(';')) {
    const trimmed = decl.trim();
    if (/^--[A-Za-z0-9_-]+\s*:/.test(trimmed)) decls.push(trimmed);
  }
  return decls;
}

// `:root[data-theme="light"]`, `html.dark`, `.dark`, `[data-theme=dark]` — the
// usual ways a light/dark variant redefines the :root variables.
const VARIANT_SELECTOR =
  /(?:^|[{};,\s])((?::root|html)(?:\[[^\]{}]*\]|\.[A-Za-z0-9_-]+)+|\.dark|\[data-(?:theme|mode)(?:[~|^$*]?=[^\]{}]*)?\])\s*\{/g;

/**
 * Pulls `@theme` blocks, `:root` custom properties and theme-variant blocks
 * (custom properties only, selector kept) out of one stylesheet.
 */
export function extractFromCss(source) {
  const css = stripComments(source);
  const themeBlocks = [];
  const rootVars = [];
  const variantBlocks = [];

  for (const match of css.matchAll(/@theme\b[^{;]*\{/g)) {
    const body = blockBody(css, match.index + match[0].length - 1);
    if (body && body.trim()) themeBlocks.push(`${match[0]}${body}}`);
  }
  for (const match of css.matchAll(/:root\s*\{/g)) {
    const body = blockBody(css, match.index + match[0].length - 1);
    if (body) rootVars.push(...customProperties(body));
  }
  for (const match of css.matchAll(VARIANT_SELECTOR)) {
    const body = blockBody(css, match.index + match[0].length - 1);
    const decls = body ? customProperties(body) : [];
    if (decls.length) variantBlocks.push(`${match[1]} {\n  ${decls.join(';\n  ')};\n}`);
  }
  return { themeBlocks, rootVars, variantBlocks };
}

/** The contents of an HTML file's inline `<style>` blocks, as one stylesheet. */
export function styleBlocksFromHtml(html) {
  const out = [];
  for (const match of html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi)) {
    // Skip `type="text/babel"` and friends; no type, text/css and text/tailwindcss are CSS.
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(match[1])?.[1].toLowerCase();
    if (!type || type === 'text/css' || type === 'text/tailwindcss') out.push(match[2]);
  }
  return out.join('\n');
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cssValue(value) {
  if (Array.isArray(value)) {
    // fontFamily: ['Inter var', 'sans-serif'] — quote names with spaces.
    if (value.every((v) => typeof v === 'string')) {
      return value.map((v) => (/\s/.test(v) && !/^['"]/.test(v) ? `"${v}"` : v)).join(', ');
    }
    // fontSize: ['0.875rem', { lineHeight: '1.25rem' }] — the size is first.
    return cssValue(value[0]);
  }
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return null;
  return value.replace(/<alpha-value>/g, '1');
}

function flatten(prefix, value, out) {
  if (isPlainObject(value)) {
    for (const [key, nested] of Object.entries(value)) {
      if (!/^[A-Za-z0-9_-]+$/.test(key)) continue;
      flatten(key === 'DEFAULT' ? prefix : `${prefix}-${key}`, nested, out);
    }
    return;
  }
  const css = cssValue(value);
  if (css) out.push(`${prefix}: ${css}`);
}

/** Converts a Tailwind v3 `theme` object into v4 `@theme` declarations. */
export function themeToCssVars(theme) {
  const decls = [];
  if (!isPlainObject(theme)) return decls;
  for (const [key, ns] of Object.entries(NAMESPACES)) {
    // A v3 theme section can be a function of other sections; there's no
    // Tailwind here to evaluate it with, so those are skipped.
    for (const section of [theme[key], theme.extend?.[key]]) {
      if (isPlainObject(section)) flatten(`--${ns}`, section, decls);
    }
  }
  return decls;
}

// HTML files whose `<style>` blocks count: entry points, where apps commonly
// define their CSS variables inline (Vite's index.html, a static site's root).
export function isEntryHtml(name, depth) {
  return name === 'index.html' || (depth === 0 && name.endsWith('.html'));
}

/** Whether a file at `depth` below the repo root is one the theme is read from. */
export function isThemeSource(name, depth) {
  return (name.endsWith('.css') && !name.endsWith('.min.css')) || isEntryHtml(name, depth);
}

/**
 * Builds the preview stylesheet from files already read (`[{ rel, source }]`,
 * `rel` relative to the repo root with `/` separators) plus the Tailwind v3
 * config's declarations when there is one (`{ file, decls }`). Returns
 * `{ css, tokenCount, sources }`; `css` is ready to drop into a
 * `<style type="text/tailwindcss">`.
 */
export function collectThemeCss(files, config = null) {
  const sources = [];
  const parts = [];
  let tokenCount = 0;

  if (config && config.decls && config.decls.length) {
    parts.push(`/* ${config.file} */\n@theme {\n  ${config.decls.join(';\n  ')};\n}`);
    sources.push({ file: config.file, kind: 'tailwind-config', count: config.decls.length });
    tokenCount += config.decls.length;
  }

  for (const { rel, source } of files) {
    const isHtml = rel.endsWith('.html');
    const { themeBlocks, rootVars, variantBlocks } = extractFromCss(isHtml ? styleBlocksFromHtml(source) : source);
    if (!themeBlocks.length && !rootVars.length && !variantBlocks.length) continue;
    // Variant values are alternatives to the :root ones, not extra tokens.
    const count = rootVars.length + themeBlocks.reduce((n, b) => n + (b.match(/--[A-Za-z0-9_-]+\s*:/g) || []).length, 0);
    parts.push(`/* ${rel} */`);
    if (rootVars.length) parts.push(`:root {\n  ${rootVars.join(';\n  ')};\n}`);
    parts.push(...variantBlocks, ...themeBlocks);
    sources.push({ file: rel, kind: isHtml ? 'html' : 'css', count });
    tokenCount += count;
  }

  return { css: parts.join('\n'), tokenCount, sources };
}
