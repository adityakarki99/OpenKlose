import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extractFromCss, themeToCssVars, loadTheme } from '../server/theme.js';

async function withTempRepo(files, fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'klose-theme-test-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
      await writeFile(path.join(dir, rel), content, 'utf-8');
    }
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('extractFromCss keeps @theme blocks and only the custom properties on :root', () => {
  const css = `
    @import "tailwindcss";
    /* :root { --commented: out; } */
    @theme { --color-brand-500: #ff3366; --font-display: "Satoshi", sans-serif; }
    @layer base {
      :root { --radius: 0.5rem; color-scheme: dark; --primary: 222 47% 11%; }
    }
    .dark { --primary: 0 0% 100%; }
  `;
  const { themeBlocks, rootVars } = extractFromCss(css);
  assert.equal(themeBlocks.length, 1);
  assert.match(themeBlocks[0], /^@theme \{ --color-brand-500: #ff3366;/);
  assert.deepEqual(rootVars, ['--radius: 0.5rem', '--primary: 222 47% 11%']);
});

test('themeToCssVars converts a Tailwind v3 theme to v4 variables', () => {
  const decls = themeToCssVars({
    colors: { ink: '#111' },
    extend: {
      colors: {
        brand: { DEFAULT: '#f36', 500: '#ff3366', soft: 'rgb(var(--brand) / <alpha-value>)' },
        'bad.key': '#000',
      },
      fontFamily: { display: ['Cal Sans', 'sans-serif'] },
      fontSize: { tiny: ['0.625rem', { lineHeight: '1rem' }] },
      borderRadius: { card: '14px' },
      spacing: () => ({ nope: '1px' }),
    },
  });
  assert.deepEqual(decls, [
    '--color-ink: #111',
    // Integer-like keys come first in JS property order.
    '--color-brand-500: #ff3366',
    '--color-brand: #f36',
    '--color-brand-soft: rgb(var(--brand) / 1)',
    '--font-display: "Cal Sans", sans-serif',
    '--text-tiny: 0.625rem',
    '--radius-card: 14px',
  ]);
});

test('loadTheme reads tailwind.config.js and CSS, skipping node_modules', async () => {
  await withTempRepo(
    {
      // CommonJS, the common v3 shape — loads on every Node the package supports.
      'tailwind.config.js': 'module.exports = { theme: { extend: { colors: { brand: "#ff3366" } } } };\n',
      'app/globals.css': ':root { --surface: #fafafa; }\n',
      'node_modules/lib/style.css': ':root { --vendor: red; }\n',
    },
    async (dir) => {
      const theme = await loadTheme(dir, { force: true });
      assert.equal(theme.tokenCount, 2);
      assert.deepEqual(theme.sources.map((s) => [s.file, s.kind]), [
        ['tailwind.config.js', 'tailwind-config'],
        [path.join('app', 'globals.css'), 'css'],
      ]);
      assert.match(theme.css, /@theme \{\n {2}--color-brand: #ff3366;\n\}/);
      assert.match(theme.css, /--surface: #fafafa/);
      assert.doesNotMatch(theme.css, /--vendor/);
      assert.deepEqual(theme.warnings, []);
    }
  );
});

test('a config that fails to load is a warning, not an error', async () => {
  await withTempRepo(
    { 'tailwind.config.js': 'import missing from "definitely-not-installed";\nexport default {};\n' },
    async (dir) => {
      const theme = await loadTheme(dir, { force: true });
      assert.equal(theme.tokenCount, 0);
      assert.equal(theme.warnings.length, 1);
      assert.match(theme.warnings[0], /Could not load tailwind\.config\.js/);
    }
  );
});
