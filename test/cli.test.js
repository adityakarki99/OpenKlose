import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import * as store from '../server/store.js';

test('klose feedback prints stable JSON without clipboard handoff', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'klose-cli-test-'));
  try {
    const project = await store.createProject(cwd, 'CLI');
    await store.addNode(cwd, project.id, {
      name: 'Button',
      comments: [{ id: 'feedback-1', text: 'Increase contrast', createdAt: 1 }],
    });
    const cli = path.resolve(import.meta.dirname, '..', 'bin', 'klose.js');
    const result = spawnSync(process.execPath, [cli, 'feedback', `--project=${project.id}`], {
      cwd,
      encoding: 'utf-8',
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.count, 1);
    assert.equal(output.feedback[0].commentId, 'feedback-1');
    assert.equal(output.feedback[0].text, 'Increase contrast');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
