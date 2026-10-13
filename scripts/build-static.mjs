#!/usr/bin/env node
// Builds the hosted canvas: the same app as `npm run build`, flagged so it
// asks for a repo folder instead of talking to a server (see lib/mode.ts),
// into web/static. Deployed as a plain site (GitHub Pages, any static host).
//
//   node scripts/build-static.mjs [--base=/OpenKlose/]
//
// `--base` is the path the site is served under: `/` for a domain of its own
// (the default), `/<repo>/` on GitHub Pages' project sites.
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseArg = process.argv.find((a) => a.startsWith('--base='));
const base = baseArg ? baseArg.slice('--base='.length) : '/';
if (!base.startsWith('/') || !base.endsWith('/')) {
  console.error(`--base must start and end with "/", got ${JSON.stringify(base)}`);
  process.exit(2);
}

const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
if (!existsSync(vite)) {
  console.error('vite is not installed: run npm install first.');
  process.exit(1);
}

const result = spawnSync(process.execPath, [vite, 'build'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, VITE_KLOSE_STATIC: '1', VITE_BASE: base },
});
if (result.status !== 0) process.exit(result.status ?? 1);

// GitHub Pages would otherwise run the output through Jekyll, which drops
// files and folders that start with an underscore (Vite's don't, but be safe).
writeFileSync(path.join(root, 'web', 'static', '.nojekyll'), '');
console.log(`hosted canvas built into web/static (base ${base})`);
