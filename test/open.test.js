import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseRepository, githubContext, projectFromContext } from '../server/githubContext.js';
import { openOnline } from '../server/open.js';
import { decryptBundle, mergeShared, newShareId, parseShareUrl } from '../server/shareCore.js';

function githubFixture() {
  const calls = [];
  const bodies = {
    '': { full_name: 'acme/site', default_branch: 'main' },
    'commits/main': { sha: 'abc123' },
    'commits/feature%2Fdesign': { sha: 'abc123' },
    'git/trees/abc123?recursive=1': {
      tree: [
        { path: 'design.md', type: 'blob', size: 20, sha: 'notes' },
        { path: 'src/index.css', type: 'blob', size: 100, sha: 'css' },
        { path: 'src/pages/home.tsx', type: 'blob', size: 10, sha: 'page' },
        { path: 'image.png', type: 'blob', size: 1000000, sha: 'image' },
      ],
    },
    'git/blobs/notes': { encoding: 'base64', content: btoa('Use existing components.') },
    'git/blobs/css': { encoding: 'base64', content: btoa('@theme {--color-brand:#123456;}') },
  };
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      const suffix = url.split('/repos/acme/site/')[1];
      return new Response(JSON.stringify(bodies[suffix]), { status: bodies[suffix] ? 200 : 404 });
    },
  };
}
test('GitHub imports only bounded context, caches by commit, and never executes repo code', async () => {
  const fixture = githubFixture();
  const entries = new Map();
  const cache = { get: async (k) => entries.get(k), set: async (k, v) => entries.set(k, v) };
  const first = await githubContext('https://github.com/acme/site', { fetch: fixture.fetch, cache });
  assert.equal(first.files.length, 2);
  assert.equal(first.theme.tokenCount, 1);
  assert.deepEqual(first.pages, ['src/pages/home.tsx']);
  const count = fixture.calls.length;
  const second = await githubContext('acme/site', { branch: 'feature/design', fetch: fixture.fetch, cache });
  assert.equal(fixture.calls.length - count, 2);
  assert.equal(second.branch, 'feature/design');
  assert.ok(!fixture.calls.some((c) => c.url.endsWith('/image') || c.url.endsWith('/page')));
  const project = projectFromContext(first);
  assert.equal(project.nodes[0].name, 'Project overview');
  assert.match(project.designSystemPrompt, /existing components/);
  assert.equal(project.source.commit, 'abc123');
});
test('GitHub input validation rejects arbitrary hosts and paths', () => {
  for (const bad of ['https://evil.example/acme/site', '../site', 'acme/..', 'acme/site/extra', '--repo'])
    assert.throws(() => parseRepository(bad));
  assert.equal(parseRepository('acme/site.git'), 'acme/site');
  assert.equal(parseShareUrl('javascript:alert(1)#/s/' + 'a'.repeat(22) + '/' + 'b'.repeat(43)), null);
});
test('online open reuses its workspace and share; private token goes only to GitHub', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'klose-open-'));
  const gh = githubFixture();
  const blobs = new Map();
  let posts = 0;
  const fetch = async (url, init = {}) => {
    if (url.startsWith('https://api.github.com/')) return gh.fetch(url, init);
    assert.equal(init.headers?.Authorization, undefined);
    if (init.method === 'POST') {
      const id = newShareId();
      const value = { id, etag: 'one', ...JSON.parse(init.body) };
      blobs.set(id, value);
      posts++;
      return new Response(JSON.stringify(value), { status: 201 });
    }
    const value = blobs.get(url.split('/').pop());
    if (!value) return new Response('{}', {status:404});
    if (init.headers?.['If-None-Match'] === 'one') return new Response(null, { status: 304 });
    return new Response(JSON.stringify(value), { status: 200 });
  };
  try {
    const options = { repo: 'acme/site', home, cwd: home, host: 'https://canvas.example', token: 'test-only', fetch };
    const a = await openOnline(options);
    const b = await openOnline(options);
    assert.equal(a.projectId, b.projectId);
    assert.equal(a.url, b.url);
    assert.equal(posts, 1);
    assert.ok(gh.calls.every((c) => c.init.headers.Authorization === 'Bearer test-only'));
    const link = parseShareUrl(a.url);
    const bundle = await decryptBundle(link.key, blobs.get(link.id).payload);
    assert.equal(bundle.project.nodes.length, 1);
    assert.match(bundle.theme.css, /color-brand/);
    blobs.delete(link.id);
    const renewed = await openOnline(options);
    assert.equal(renewed.projectId, a.projectId);
    assert.notEqual(renewed.url, a.url);
    assert.equal(posts, 2);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
test('concurrent edits merge different fields and preserve competing code as a conflict sketch', () => {
  const node = { id: 'a', name: 'Card', code: 'base', comments: [], width: 400 };
  const base = { id: 'p', nodes: [node] };
  const local = { ...base, nodes: [{ ...node, comments: [{ id: 'c', text: 'hello' }] }] };
  const incoming = { ...base, nodes: [{ ...node, code: 'agent' }] };
  const merged = mergeShared({ base, local, incoming });
  assert.equal(merged.nodes[0].code, 'agent');
  assert.equal(merged.nodes[0].comments.length, 1);
  const conflict = mergeShared({ base, local: { ...base, nodes: [{ ...node, code: 'mine' }] }, incoming });
  assert.deepEqual(
    conflict.nodes.map((n) => n.code),
    ['mine', 'agent'],
  );
  assert.match(conflict.nodes[1].name, /conflict copy/);
});
