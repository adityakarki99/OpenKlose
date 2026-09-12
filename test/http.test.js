import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createKloseServer } from '../server/http.js';

// The status codes below were previously decided by string-matching err.message,
// so nothing caught a regression if the wording changed. These exercise the
// route end to end and assert the response code and machine-readable code.

let cwd;
let server;
let baseUrl;

before(async () => {
  cwd = await mkdtemp(path.join(os.tmpdir(), 'klose-http-test-'));
  await mkdir(path.join(cwd, 'src', 'components'), { recursive: true });
  await writeFile(
    path.join(cwd, 'src', 'components', 'Button.tsx'),
    "import React from 'react';\nexport function Button({ label }: { label: string }) {\n  return <button>{label}</button>;\n}\n",
    'utf-8'
  );
  server = createKloseServer({ cwd });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(cwd, { recursive: true, force: true });
});

async function request(method, url, body) {
  const res = await fetch(`${baseUrl}${url}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

test('a malformed project id is a 400, not a 500', async () => {
  for (const id of ['not-a-uuid', '%2e%2e%2f%2e%2e%2fetc%2fpasswd', '{}']) {
    const res = await request('GET', `/api/projects/${id}`);
    assert.equal(res.status, 400, `GET /api/projects/${id}`);
    assert.equal(res.body.code, 'INVALID_PROJECT_ID', `GET /api/projects/${id}`);
  }
});

// Documents the incidental normalization the id validation does not rely on:
// literal `../` segments are collapsed by Node's URL parser before routing, so
// the request lands on the collection route and 404s instead of reaching the
// store at all. Percent-encoded traversal (above) does reach it, and is where
// the explicit check earns its keep.
test('literal ../ segments are collapsed by the URL parser before routing', async () => {
  const res = await request('GET', '/api/projects/..');
  assert.equal(res.status, 404);
});

test('a malformed project id is a 400 on writes too', async () => {
  const patch = await request('PATCH', '/api/projects/not-a-uuid', { name: 'x' });
  assert.equal(patch.status, 400);
  assert.equal(patch.body.code, 'INVALID_PROJECT_ID');

  const del = await request('DELETE', '/api/projects/not-a-uuid');
  assert.equal(del.status, 400);

  const node = await request('POST', '/api/projects/not-a-uuid/nodes', { name: 'n' });
  assert.equal(node.status, 400);
});

test('a well-formed but unknown project id is a 404', async () => {
  const res = await request('GET', '/api/projects/11111111-2222-4333-8444-555555555555');
  assert.equal(res.status, 404);
  assert.equal(res.body.code, 'PROJECT_NOT_FOUND');
});

test('an unknown node id is a 404', async () => {
  const { body: project } = await request('POST', '/api/projects', { name: 'P' });
  const res = await request('PATCH', `/api/projects/${project.id}/nodes/nope`, { status: 'built' });
  assert.equal(res.status, 404);
  assert.equal(res.body.code, 'NODE_NOT_FOUND');
});

test('component-source rejects an out-of-tree path with a 400', async () => {
  const res = await request('GET', '/api/component-source?file=../../../../etc/passwd');
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'PATH_ESCAPES_ROOT');
});

test('component-source rejects a non-source extension with a 400', async () => {
  const res = await request('GET', '/api/component-source?file=package.json');
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'NOT_A_SOURCE_FILE');
});

test('the happy paths still work', async () => {
  const created = await request('POST', '/api/projects', { name: 'Happy' });
  assert.equal(created.status, 201);

  const fetched = await request('GET', `/api/projects/${created.body.id}`);
  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.name, 'Happy');

  const source = await request('GET', '/api/component-source?file=src/components/Button.tsx');
  assert.equal(source.status, 200);
  assert.match(source.body.source, /export function Button/);
});
