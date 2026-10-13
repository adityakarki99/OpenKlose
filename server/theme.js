import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  IGNORED_DIRS,
  MAX_CSS_BYTES,
  MAX_CSS_FILES,
  collectThemeCss,
  extractFromCss,
  isThemeSource,
  styleBlocksFromHtml,
  themeToCssVars,
} from './themeParse.js';

// The parsing itself lives in themeParse.js, which the hosted canvas shares;
// re-exported here so existing imports and tests keep working.
export { extractFromCss, styleBlocksFromHtml, themeToCssVars };

/**
 * Extracts the host repo's design tokens as Tailwind v4 CSS, so the preview
 * sandbox renders `bg-brand-500` or `var(--primary)` the way the real app
 * does instead of silently dropping them.
 *
 * Three sources, all optional:
 *   - `@theme { ... }` blocks in the repo's CSS (Tailwind v4), copied as-is;
 *   - `:root { --x: ... }` custom properties in the repo's CSS and in the
 *     `<style>` blocks of HTML entry files, copied as-is (only the custom
 *     properties, not other declarations on :root). Theme variants such as
 *     `:root[data-theme="light"]` or `.dark` keep their selector, so the
 *     preview — which sets neither — renders with the default values while
 *     `@theme { --color-x: rgb(var(--x)) }` still resolves;
 *   - a Tailwind v3 `tailwind.config.*` at the repo root, whose theme is
 *     converted to the equivalent v4 `@theme` variables.
 *
 * Loading the config means importing it, which runs the repo's own code — the
 * same thing Tailwind's CLI and every dev server already do with that file.
 * A config that fails to import (missing plugin, TypeScript on an older Node)
 * becomes a warning, never an error: the preview still renders, just with
 * fewer of the repo's tokens.
 */

const CACHE_TTL_MS = 4000;
const CONFIG_NAMES = ['js', 'mjs', 'cjs', 'ts', 'mts', 'cts'].map((ext) => `tailwind.config.${ext}`);

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

async function walkCss(dir, out, depth = 0) {
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
      await walkCss(full, out, depth + 1);
    } else if (!entry.isFile()) {
      continue;
    } else if (isThemeSource(entry.name, depth)) {
      out.push(full);
    }
  }
}

const cache = new Map(); // root -> { at, data }

/**
 * Collects the repo's tokens. Returns `{ css, tokenCount, sources, warnings }`
 * where `css` is ready to drop into a `<style type="text/tailwindcss">`.
 */
export async function loadTheme(root, { force = false } = {}) {
  const cached = cache.get(root);
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  const warnings = [];
  const config = await loadTailwindConfig(root, warnings);

  const cssFiles = [];
  await walkCss(root, cssFiles);
  const files = [];
  for (const full of cssFiles) {
    try {
      if ((await stat(full)).size > MAX_CSS_BYTES) continue;
      files.push({ rel: path.relative(root, full), source: await readFile(full, 'utf-8') });
    } catch {
      continue;
    }
  }

  const { css, tokenCount, sources } = collectThemeCss(files, config);
  const data = { css, tokenCount, sources, warnings };
  cache.set(root, { at: Date.now(), data });
  return data;
}
