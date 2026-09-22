import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { IGNORED_DIRS } from './scanner.js';

/**
 * Extracts the host repo's design tokens as Tailwind v4 CSS, so the preview
 * sandbox renders `bg-brand-500` or `var(--primary)` the way the real app
 * does instead of silently dropping them.
 *
 * Three sources, all optional:
 *   - `@theme { ... }` blocks in the repo's CSS (Tailwind v4), copied as-is;
 *   - `:root { --x: ... }` custom properties in the repo's CSS, copied as-is
 *     (only the custom properties, not other declarations on :root);
 *   - a Tailwind v3 `tailwind.config.*` at the repo root, whose theme is
 *     converted to the equivalent v4 `@theme` variables.
 *
 * Loading the config means importing it, which runs the repo's own code — the
 * same thing Tailwind's CLI and every dev server already do with that file.
 * A config that fails to import (missing plugin, TypeScript on an older Node)
 * becomes a warning, never an error: the preview still renders, just with
 * fewer of the repo's tokens.
 */

const MAX_CSS_FILES = 400;
const MAX_CSS_BYTES = 256 * 1024;
const CACHE_TTL_MS = 4000;
const CONFIG_NAMES = ['js', 'mjs', 'cjs', 'ts', 'mts', 'cts'].map((ext) => `tailwind.config.${ext}`);

// Tailwind v3 theme key → Tailwind v4 CSS variable namespace.
const NAMESPACES = {
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

/** Pulls `@theme` blocks and `:root` custom properties out of one stylesheet. */
export function extractFromCss(source) {
  const css = stripComments(source);
  const themeBlocks = [];
  const rootVars = [];

  for (const match of css.matchAll(/@theme\b[^{;]*\{/g)) {
    const body = blockBody(css, match.index + match[0].length - 1);
    if (body && body.trim()) themeBlocks.push(`${match[0]}${body}}`);
  }
  for (const match of css.matchAll(/:root\s*\{/g)) {
    const body = blockBody(css, match.index + match[0].length - 1);
    if (!body) continue;
    for (const decl of body.split(';')) {
      const trimmed = decl.trim();
      if (/^--[A-Za-z0-9_-]+\s*:/.test(trimmed)) rootVars.push(trimmed);
    }
  }
  return { themeBlocks, rootVars };
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

async function loadTailwindConfig(root, warnings) {
  for (const name of CONFIG_NAMES) {
    const file = path.join(root, name);
    if (!existsSync(file)) continue;
    try {
      const { mtimeMs } = await stat(file);
      const mod = await import(`${pathToFileURL(file).href}?t=${mtimeMs}`);
      const config = mod.default ?? mod;
      return { file: name, decls: themeToCssVars(config?.theme) };
    } catch (err) {
      let hint = '';
      if (/\.[mc]?ts$/.test(name)) hint = ' (TypeScript configs need Node 22.18 or newer)';
      else if (name.endsWith('.js') && /\b(import|export)\b/.test(err.message)) {
        hint = ' (ESM syntax in a .js config needs "type": "module" in package.json, or Node 22.12 or newer)';
      }
      warnings.push(`Could not load ${name}${hint}: ${err.message.split('\n')[0]}`);
      return null;
    }
  }
  return null;
}

async function walkCss(dir, out) {
  if (out.length >= MAX_CSS_FILES) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= MAX_CSS_FILES) return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      await walkCss(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.css') && !entry.name.endsWith('.min.css')) {
      out.push(full);
    }
  }
}

let cache = null; // { root, at, data }

/**
 * Collects the repo's tokens. Returns `{ css, tokenCount, sources, warnings }`
 * where `css` is ready to drop into a `<style type="text/tailwindcss">`.
 */
export async function loadTheme(root, { force = false } = {}) {
  if (!force && cache && cache.root === root && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;

  const warnings = [];
  const sources = [];
  const parts = [];
  let tokenCount = 0;

  const config = await loadTailwindConfig(root, warnings);
  if (config && config.decls.length) {
    parts.push(`/* ${config.file} */\n@theme {\n  ${config.decls.join(';\n  ')};\n}`);
    sources.push({ file: config.file, kind: 'tailwind-config', count: config.decls.length });
    tokenCount += config.decls.length;
  }

  const cssFiles = [];
  await walkCss(root, cssFiles);
  for (const full of cssFiles) {
    let source;
    try {
      if ((await stat(full)).size > MAX_CSS_BYTES) continue;
      source = await readFile(full, 'utf-8');
    } catch {
      continue;
    }
    const { themeBlocks, rootVars } = extractFromCss(source);
    if (!themeBlocks.length && !rootVars.length) continue;
    const rel = path.relative(root, full);
    const count = rootVars.length + themeBlocks.reduce((n, b) => n + (b.match(/--[A-Za-z0-9_-]+\s*:/g) || []).length, 0);
    parts.push(`/* ${rel} */`);
    if (rootVars.length) parts.push(`:root {\n  ${rootVars.join(';\n  ')};\n}`);
    parts.push(...themeBlocks);
    sources.push({ file: rel, kind: 'css', count });
    tokenCount += count;
  }

  const data = { css: parts.join('\n'), tokenCount, sources, warnings };
  cache = { root, at: Date.now(), data };
  return data;
}
