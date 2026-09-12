import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createKloseServer } from '../server/http.js';

async function withServer(fn) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'klose-http-test-'));
  const server = createKloseServer({ cwd });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  try {
    await fn(`http://localhost:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(cwd, { recursive: true, force: true });
  }
}

test('GET /api/health reports the server as up without touching .klose/', async () => {
  await withServer(async (url) => {
    const res = await fetch(`${url}/api/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });
});

test('unknown routes still 404 as before', async () => {
  await withServer(async (url) => {
    const res = await fetch(`${url}/nope`);
    assert.equal(res.status, 404);
  });
});
