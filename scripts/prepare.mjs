#!/usr/bin/env node
// npm runs `prepare` when klose is installed straight from git
// (`npm i -D github:adityakarki99/OpenKlose`). web/dist is git-ignored, so
// without this such an install would ship a canvas server with no canvas.
//
// Skipped in CI (the build job builds explicitly) and whenever web/dist is
// already there, so `npm install` in a working checkout stays fast. A failed
// build only warns: the CLI and skills still work without the UI.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.env.CI || existsSync(path.join(root, 'web', 'dist', 'index.html'))) process.exit(0);

console.log('klose: building the canvas UI (web/dist)...');
const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (result.status !== 0) {
  console.warn('klose: the canvas UI failed to build — the CLI works, but "klose serve" will have no UI.');
}
