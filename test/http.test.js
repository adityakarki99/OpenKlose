import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import http from 'node:http';
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
  await writeFile(path.join(cwd, 'src', 'globals.css'), ':root { --brand: #ff3366; color: red; }\n', 'utf-8');
  server = createKloseServer({ cwd, version: '9.9.9' });
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
  return { status: res.status, headers: res.headers, body: await res.json() };
}

// fetch() won't let a caller set Host, so the browser-attack cases go through
// node:http, which sends whatever headers it's given.
function rawRequest(method, url, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${baseUrl}${url}`, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        let parsed = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          // Not JSON (static asset).
        }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

test('GET /api/health reports the server as up without touching .klose/', async () => {
  const res = await request('GET', '/api/health');
  assert.equal(res.status, 200);
  // `root` is how `klose status` tells this repo's server from another repo's.
  assert.deepEqual(res.body, { ok: true, root: cwd, version: '9.9.9', pid: process.pid });
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});

test('unknown routes still 404', async () => {
  const res = await request('GET', '/nope');
  assert.equal(res.status, 404);
});

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

test('feedback endpoint returns structured element targets', async () => {
  const { body: project } = await request('POST', '/api/projects', { name: 'Feedback' });
  const { body: node } = await request('POST', `/api/projects/${project.id}/nodes`, {
    name: 'Card',
    comments: [{
      id: 'c1', text: 'Tighten spacing', createdAt: 10,
      element: { tagName: 'button', text: 'Save', classes: 'px-4', path: 'div > button' },
    }],
  });
  const res = await request('GET', `/api/feedback?project=${project.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.count, 1);
  assert.equal(res.body.feedback[0].nodeId, node.id);
  assert.equal(res.body.feedback[0].element.path, 'div > button');
});

test('static preview assets allow module loading from the sandbox opaque origin', async () => {
  const publicDir = await mkdtemp(path.join(os.tmpdir(), 'klose-public-test-'));
  await writeFile(path.join(publicDir, 'runtime.js'), 'export const ready = true;', 'utf-8');
  const staticServer = createKloseServer({ cwd, publicDir });
  try {
    await new Promise((resolve) => staticServer.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${staticServer.address().port}/runtime.js`;
    const res = await fetch(url, { headers: { Origin: 'null' } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.match(await res.text(), /ready = true/);
  } finally {
    await new Promise((resolve) => staticServer.close(resolve));
    await rm(publicDir, { recursive: true, force: true });
  }
});

test('a request addressed to a non-loopback Host is refused (DNS rebinding)', async () => {
  const res = await rawRequest('GET', '/api/projects', { Host: 'evil.example:5171' });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'FORBIDDEN_HOST');
});

test('a cross-origin page cannot call the API', async () => {
  const read = await rawRequest('GET', '/api/projects', { Origin: 'https://evil.example' });
  assert.equal(read.status, 403);
  assert.equal(read.body.code, 'FORBIDDEN_ORIGIN');

  // The sandboxed preview has an opaque origin; it gets static assets, not the API.
  const sandboxed = await rawRequest('GET', '/api/projects', { Origin: 'null' });
  assert.equal(sandboxed.status, 403);
  assert.equal(sandboxed.body.code, 'FORBIDDEN_ORIGIN');
});

test('a write must be application/json, which a no-preflight form post cannot send', async () => {
  const res = await rawRequest('POST', '/api/projects', { 'Content-Type': 'text/plain' }, '{"name":"CSRF"}');
  assert.equal(res.status, 415);
  assert.equal(res.body.code, 'UNSUPPORTED_MEDIA_TYPE');
});

test('a malformed JSON body is a 400, not a 500', async () => {
  const res = await rawRequest('POST', '/api/projects', { 'Content-Type': 'application/json' }, '{nope');
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'INVALID_JSON');
});

test('the canvas itself (a localhost origin, e.g. the Vite dev server) is allowed', async () => {
  const res = await rawRequest(
    'POST',
    '/api/projects',
    { Host: 'localhost:5170', Origin: 'http://localhost:5170', 'Content-Type': 'application/json' },
    '{"name":"From the canvas"}'
  );
  assert.equal(res.status, 201);
  assert.equal(res.body.name, 'From the canvas');
});

test('GET /api/theme returns the repo tokens as Tailwind CSS', async () => {
  const res = await request('GET', '/api/theme');
  assert.equal(res.status, 200);
  assert.match(res.body.css, /--brand: #ff3366/);
  assert.doesNotMatch(res.body.css, /color: red/);
  assert.equal(res.body.tokenCount, 1);
  assert.deepEqual(res.body.sources, [{ file: path.join('src', 'globals.css'), kind: 'css', count: 1 }]);
});
