import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveRoot } from '../server/root.js';

async function withTempDir(fn) {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'klose-root-test-')));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('a subfolder resolves to the git root above it', async () => {
  await withTempDir(async (dir) => {
    await mkdir(path.join(dir, '.git'));
    await mkdir(path.join(dir, 'src', 'components'), { recursive: true });
    assert.equal(resolveRoot(path.join(dir, 'src', 'components')), dir);
  });
});

test('the nearest .klose wins over a .git further up (monorepo package)', async () => {
  await withTempDir(async (dir) => {
    await mkdir(path.join(dir, '.git'));
    await mkdir(path.join(dir, 'packages', 'web', '.klose'), { recursive: true });
    await mkdir(path.join(dir, 'packages', 'web', 'src'), { recursive: true });
    assert.equal(resolveRoot(path.join(dir, 'packages', 'web', 'src')), path.join(dir, 'packages', 'web'));
  });
});

test('with no .klose or .git anywhere, the folder itself is the root', async () => {
  await withTempDir(async (dir) => {
    await mkdir(path.join(dir, 'loose'));
    // os.tmpdir() has no .git/.klose above it on a normal machine or CI runner.
    assert.equal(resolveRoot(path.join(dir, 'loose')), path.join(dir, 'loose'));
  });
});
