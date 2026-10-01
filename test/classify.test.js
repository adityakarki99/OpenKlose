import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KINDS,
  ROLES,
  annotate,
  buildClassifyRequest,
  buildSketchClassifyRequest,
  classificationPath,
  classifyComponents,
  classifySketches,
  componentKey,
  findDuplicates,
  readClassifications,
  sketchKey,
  sketchOverlaps,
  unclassifiedSketches,
  writeClassifications,
} from '../server/classify.js';
import { classifyRepo, rankAcrossRepos } from '../server/componentIndex.js';
import { classifyProject } from '../server/insights.js';
import * as store from '../server/store.js';
import { createKloseServer } from '../server/http.js';
import { repoId, rememberRepo } from '../server/hub.js';

const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'klose.js');

function component(name, extra = {}) {
  return { id: `src/${name}.tsx#${name}`, name, file: `src/${name}.tsx`, line: 1, category: 'ui', description: '', props: [], ...extra };
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** A Jev answer for a classification request: role/kind picked by component name. */
function classified(body, table) {
  const [role, kind] = table[body.state.component.name] || ['composite', 'content'];
  return {
    model: 'jev-1.13.0',
    answers: {
      role: { type: 'choice', choice: role, confidence: 0.91, probabilities: { [role]: 0.95 } },
      kind: { type: 'choice', choice: kind, confidence: 0.8, probabilities: { [kind]: 0.9 } },
    },
    usage: { input_tokens: 80, output_tokens: 4 },
  };
}

const TABLE = {
  Button: ['primitive', 'action'],
  IconButton: ['primitive', 'action'],
  TextField: ['primitive', 'input'],
  PricingPage: ['screen', 'content'],
};

test('a classification request sends metadata only, with the fixed role and kind options', () => {
  const body = buildClassifyRequest(component('Button', {
    description: 'x'.repeat(1000),
    props: [{ name: 'variant', optional: true, type: "'primary' | 'ghost'" }],
    source: 'export function Button() {}',
  }));
  assert.equal(body.model, 'jev-latest');
  assert.deepEqual(Object.keys(body.state.component).sort(), ['description', 'file', 'folder', 'name', 'props']);
  assert.deepEqual(body.state.component.props, ['variant']);
  assert.equal(body.state.component.description.length, 300);
  assert.equal(body.questions.role.type, 'choice');
  assert.deepEqual(Object.keys(body.questions.role.criteria), Object.keys(ROLES));
  assert.deepEqual(Object.keys(body.questions.kind.criteria), Object.keys(KINDS));
  assert.ok(Object.keys(KINDS).length <= 255);
});

test('the cache key follows what is sent, not where the component sits in the file', () => {
  const a = component('Button', { line: 3 });
  assert.equal(componentKey(a), componentKey({ ...a, line: 40, loc: 99 }));
  assert.notEqual(componentKey(a), componentKey({ ...a, description: 'Now documented' }));
});

test('classifyComponents asks only about uncached components, a few at a time', async () => {
  const components = ['Button', 'IconButton', 'TextField', 'PricingPage', 'Nav', 'Footer'].map((n) => component(n));
  const cache = { [componentKey(components[0])]: { role: 'primitive', kind: 'action' } };
  let inFlight = 0;
  let peak = 0;
  const asked = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    asked.push(body.state.component.name);
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return jsonResponse(200, classified(body, TABLE));
  };
  const progress = [];
  const summary = await classifyComponents(components, cache, {
    apiKey: 'k',
    fetchImpl,
    concurrency: 2,
    onProgress: (p) => progress.push(p),
  });
  assert.deepEqual(summary, { total: 6, classified: 5, cached: 1, failed: 0, error: null });
  assert.ok(!asked.includes('Button'), 'a cached component is not asked about again');
  assert.equal(peak, 2);
  assert.deepEqual(progress.at(-1), { done: 5, of: 5 });
  assert.equal(cache[componentKey(components[3])].role, 'screen');
  assert.equal(cache[componentKey(components[2])].kindConfidence, 0.8);
});

test('a rejected key stops the run; other failures are counted and the rest carry on', async () => {
  const components = ['A', 'B', 'C', 'D'].map((n) => component(n));
  let calls = 0;
  const rejected = await classifyComponents(components, {}, {
    apiKey: 'bad',
    concurrency: 1,
    fetchImpl: async () => { calls++; return jsonResponse(401, { error: 'no' }); },
  });
  assert.equal(calls, 1);
  assert.equal(rejected.failed, 4);
  assert.match(rejected.error, /TYPESAFE_API_KEY was rejected/);

  const cache = {};
  const mixed = await classifyComponents(components, cache, {
    apiKey: 'k',
    concurrency: 1,
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      if (body.state.component.name === 'B') return jsonResponse(200, { answers: { role: { choice: 'nonsense' } } });
      return jsonResponse(200, classified(body, TABLE));
    },
  });
  assert.equal(mixed.classified, 3);
  assert.equal(mixed.failed, 1);
  assert.match(mixed.error, /unexpected response/);
  assert.equal(Object.keys(cache).length, 3);

  let attempts = 0;
  const offline = await classifyComponents(components, {}, {
    apiKey: 'k',
    concurrency: 1,
    fetchImpl: async () => { attempts++; throw new TypeError('fetch failed'); },
  });
  assert.equal(attempts, 1, 'an unreachable service is not asked again for every component');
  assert.equal(offline.failed, 4);
  assert.match(offline.error, /could not reach TypeSafe/);

  await assert.rejects(classifyComponents(components, {}, {}), /TYPESAFE_API_KEY is not set/);
});

test('the cache survives on disk, and forgets components that are gone', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'klose-classify-cache-'));
  try {
    const keep = component('Button');
    const gone = component('Old');
    const file = classificationPath(home, 'abc123');
    await writeClassifications(file, {
      [componentKey(keep)]: { role: 'primitive', kind: 'action' },
      [componentKey(gone)]: { role: 'screen', kind: 'content' },
    }, [keep]);
    const entries = await readClassifications(file);
    assert.deepEqual(Object.keys(entries), [componentKey(keep)]);
    assert.equal(JSON.parse(await readFile(file, 'utf-8')).model, 'jev-latest');
    assert.deepEqual(await readClassifications(path.join(home, 'missing.json')), {});

    const [annotated, plain] = annotate([keep, component('New')], entries);
    assert.equal(annotated.role, 'primitive');
    assert.equal(plain.role, undefined);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('duplicates: primitives of the same kind, never screens or composites', () => {
  const list = annotate(
    ['Button', 'IconButton', 'TextField', 'PricingPage'].map((n) => component(n)),
    Object.fromEntries(Object.entries(TABLE).map(([name, [role, kind]]) => [componentKey(component(name)), { role, kind }]))
  );
  const extra = [
    { ...component('Card'), role: 'composite', kind: 'content' },
    { ...component('Tile'), role: 'composite', kind: 'content' },
    { ...component('AboutPage'), role: 'screen', kind: 'content' },
  ];
  assert.deepEqual(findDuplicates([...list, ...extra]), [
    { kind: 'action', components: [
      { id: 'src/Button.tsx#Button', name: 'Button', file: 'src/Button.tsx' },
      { id: 'src/IconButton.tsx#IconButton', name: 'IconButton', file: 'src/IconButton.tsx' },
    ] },
  ]);
});

// ---------------------------------------------------------- repos on disk

async function makeRepo(base, name, files) {
  const root = path.join(base, name);
  await mkdir(path.join(root, '.git'), { recursive: true });
  await mkdir(path.join(root, 'src'), { recursive: true });
  for (const [file, source] of Object.entries(files)) await writeFile(path.join(root, 'src', file), source, 'utf-8');
  return root;
}

const fn = (name, doc = '') => `${doc ? `/** ${doc} */\n` : ''}export function ${name}() {\n  return <div />;\n}\n`;

test('rankAcrossRepos ranks the merged index and says which repo each match is in', async () => {
  const base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'klose-rank-repos-')));
  try {
    const app = await makeRepo(base, 'app', { 'Button.tsx': fn('Button') });
    const site = await makeRepo(base, 'site', { 'PlanTier.tsx': fn('PlanTier', 'One pricing tier') });
    let sent;
    const fetchImpl = async (url, init) => {
      sent = JSON.parse(init.body);
      return jsonResponse(200, {
        answers: {
          where: { choice: 'C002', probabilities: { C001: 0.1, C002: 0.9 } },
          exists: { noul: 0.88 },
        },
      });
    };
    const repos = [{ id: 'aaa', name: 'app', root: app }, { id: 'bbb', name: 'site', root: site }];
    const ranking = await rankAcrossRepos(repos, 'pricing tier', { jev: { apiKey: 'k', fetchImpl } });
    assert.equal(sent.state.components.C001.repo, 'app');
    assert.equal(sent.state.components.C002.repo, 'site');
    assert.equal(ranking.verdict, 'reuse');
    assert.equal(ranking.ranked[0].name, 'PlanTier');
    assert.deepEqual(ranking.ranked[0].repo, { id: 'bbb', name: 'site' });
    assert.equal(ranking.ranked[0].id, 'bbb:src/PlanTier.tsx#PlanTier');
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('HTTP: the index shows cached answers, classify fills them in, rank searches by meaning', async (t) => {
  const base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'klose-classify-http-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = await makeRepo(base, 'app', {
    'Button.tsx': fn('Button'),
    'IconButton.tsx': fn('IconButton'),
    'PricingPage.tsx': fn('PricingPage'),
  });
  const home = path.join(base, 'home');
  let requests = 0;
  const fetchImpl = async (url, init) => {
    requests++;
    const body = JSON.parse(init.body);
    if (body.questions.role) return jsonResponse(200, classified(body, TABLE));
    return jsonResponse(200, { answers: { where: { probabilities: { C001: 0.2, C002: 0.1, C003: 0.7 } }, exists: { noul: 0.2 } } });
  };

  const start = async (options) => {
    const server = createKloseServer(options);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    return `http://127.0.0.1:${server.address().port}`;
  };
  const call = async (url, method = 'GET') => {
    const res = await fetch(url, { method, headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined, body: method === 'POST' ? '{}' : undefined });
    return { status: res.status, body: await res.json() };
  };

  // Without a key: the plain index, and a clear answer instead of a request.
  const bare = await start({ cwd: root, jev: { apiKey: '' } });
  const plain = await call(`${bare}/api/components`);
  assert.deepEqual(plain.body.jev, { available: false });
  assert.equal(plain.body.classified, 0);
  const refused = await call(`${bare}/api/components/classify`, 'POST');
  assert.equal(refused.status, 400);
  assert.equal(refused.body.code, 'JEV_UNAVAILABLE');

  // A hub, so the cache lands in its home and the repo is addressed by id.
  await rememberRepo(root, home);
  const hub = await start({ hub: { claudeDir: path.join(base, 'claude'), home }, jev: { apiKey: 'k', fetchImpl } });
  const api = `${hub}/api/repos/${repoId(root)}`;

  const summary = await call(`${api}/components/classify`, 'POST');
  assert.deepEqual(summary.body, { total: 3, classified: 3, cached: 0, failed: 0, error: null });
  assert.equal(requests, 3);

  const index = await call(`${api}/components`);
  assert.equal(index.body.jev.available, true);
  assert.equal(index.body.classified, 3);
  assert.equal(index.body.components.find((c) => c.name === 'PricingPage').role, 'screen');
  assert.deepEqual(index.body.duplicates.map((d) => [d.kind, d.components.map((c) => c.name)]), [['action', ['Button', 'IconButton']]]);

  // A second run pays for nothing.
  assert.equal((await call(`${api}/components/classify`, 'POST')).body.cached, 3);
  assert.equal(requests, 3);

  const ranked = await call(`${api}/components/rank?q=${encodeURIComponent('a pricing page')}`);
  assert.equal(ranked.body.verdict, 'new');
  assert.equal(ranked.body.ranked[0].name, 'PricingPage');
  assert.equal(ranked.body.ranked[0].role, 'screen', 'ranked components keep their classification');
  assert.equal((await call(`${api}/components/rank`)).body.code, 'QUERY_REQUIRED');

  const across = await call(`${hub}/api/rank?q=pricing`);
  assert.equal(across.status, 200);
  assert.equal(across.body.ranked[0].repo.name, 'app');

  // Jev failing is Jev's error, not ours.
  const broken = await start({ cwd: root, jev: { apiKey: 'k', fetchImpl: async () => jsonResponse(401, {}) } });
  const failed = await call(`${broken}/api/components/rank?q=x`);
  assert.equal(failed.status, 502);
  assert.equal(failed.body.code, 'JEV_FAILED');
});

// --------------------------------------------------------------------- CLI

function klose(cwd, args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], { cwd, env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test('klose components --classify, then the listing shows roles and duplicate primitives', async () => {
  const base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'klose-classify-cli-')));
  const root = await makeRepo(base, 'app', { 'Button.tsx': fn('Button'), 'IconButton.tsx': fn('IconButton') });
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(classified(JSON.parse(raw), TABLE)));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const env = {
    KLOSE_HOME: path.join(base, 'home'),
    CLAUDE_CONFIG_DIR: path.join(base, 'claude'),
    TYPESAFE_API_KEY: 'test-key',
    TYPESAFE_BASE_URL: `http://127.0.0.1:${server.address().port}`,
  };
  try {
    const run = await klose(root, ['components', '--classify'], env);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stderr, /no source code/);
    assert.match(run.stderr, /2 classified, 0 already known/);
    assert.match(run.stdout, /Button {2}— {2}src\/Button\.tsx:1 {2}\[primitive · action\]/);
    assert.match(run.stdout, /may do the same job[\s\S]*action {6}Button, IconButton/);

    // Cached: a plain listing shows the roles without any key at all.
    const json = JSON.parse((await klose(root, ['components', '--json'], { ...env, TYPESAFE_API_KEY: '' })).stdout);
    assert.equal(json.classified, 2);
    assert.equal(json.components[0].kind, 'action');

    const noKey = await klose(root, ['components', '--classify'], { ...env, TYPESAFE_API_KEY: '' });
    assert.equal(noKey.status, 1);
    assert.match(noKey.stderr, /--classify needs TYPESAFE_API_KEY/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(base, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- sketches

test('a sketch classification request sends name, description and notes — never the code', () => {
  const body = buildSketchClassifyRequest({ id: 'n1', name: 'Pricing card', description: 'd', notes: 'n'.repeat(1000), code: 'export default function X() {}', status: 'built', builtFilePath: 'src/PricingCard.tsx' });
  assert.deepEqual(Object.keys(body.state.sketch).sort(), ['description', 'file', 'name', 'notes']);
  assert.equal(body.state.sketch.notes.length, 300);
  assert.equal(body.state.sketch.file, 'src/PricingCard.tsx');
  assert.ok(!JSON.stringify(body).includes('export default'));
  assert.deepEqual(Object.keys(body.questions.role.criteria), Object.keys(ROLES));
  assert.deepEqual(Object.keys(body.questions.kind.criteria), Object.keys(KINDS));
});

test('classifySketches skips sketches whose stored answer still matches, and sketchOverlaps names same-kind primitives', async () => {
  const button = { id: 'a', name: 'Primary button', description: 'A button', notes: '' };
  const page = { id: 'b', name: 'Pricing page', description: 'The whole page', notes: '' };
  let requests = 0;
  const fetchImpl = async (url, init) => {
    requests++;
    const { sketch } = JSON.parse(init.body).state;
    const [role, kind] = sketch.name === 'Primary button' ? ['primitive', 'action'] : ['screen', 'content'];
    return jsonResponse(200, { model: 'jev-1.13.0', answers: { role: { choice: role, confidence: 0.9 }, kind: { choice: kind, confidence: 0.8 } } });
  };
  const first = await classifySketches([button, page], { apiKey: 'k', fetchImpl });
  assert.equal(requests, 2);
  assert.equal(first.results.a.role, 'primitive');
  assert.equal(first.results.a.key, sketchKey(button));
  assert.deepEqual(first.summary, { total: 2, classified: 2, cached: 0, failed: 0, error: null });

  const stored = [{ ...button, classification: first.results.a }, { ...page, classification: first.results.b, name: 'Plans page' }];
  assert.deepEqual(unclassifiedSketches(stored).map((n) => n.id), ['b'], 'a renamed sketch is asked again');
  const second = await classifySketches(stored, { apiKey: 'k', fetchImpl });
  assert.equal(requests, 3);
  assert.equal(second.summary.cached, 1);

  const components = [
    component('Button', { role: 'primitive', kind: 'action' }),
    component('IconButton', { role: 'primitive', kind: 'action' }),
    component('TextField', { role: 'primitive', kind: 'input' }),
    component('Toolbar', { role: 'composite', kind: 'action' }),
  ];
  assert.deepEqual(sketchOverlaps(first.results.a, components).map((c) => c.name), ['Button', 'IconButton']);
  assert.deepEqual(sketchOverlaps(first.results.b, components), [], 'a screen overlaps nothing');
  assert.deepEqual(sketchOverlaps({ role: 'primitive', kind: 'other' }, components), []);
});

test('classifyProject stores the classification and overlaps on the sketch, over HTTP too', async (t) => {
  const base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'klose-classify-sketch-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = await makeRepo(base, 'app', { 'Button.tsx': fn('Button'), 'TextField.tsx': fn('TextField') });
  const home = path.join(base, 'home');
  const project = await store.createProject(root, 'Billing');
  const sketch = await store.addNode(root, project.id, { name: 'Primary button', description: 'A big blue button', code: '<button />' });
  const idea = await store.addNode(root, project.id, { name: 'Checkout flow', description: 'Three steps' });

  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    if (body.state.component) return jsonResponse(200, classified(body, TABLE));
    const [role, kind] = body.state.sketch.name === 'Primary button' ? ['primitive', 'action'] : ['screen', 'content'];
    return jsonResponse(200, { model: 'jev-1.13.0', answers: { role: { choice: role, confidence: 0.9 }, kind: { choice: kind, confidence: 0.8 } } });
  };
  const jev = { apiKey: 'k', fetchImpl };

  // Nothing classified in the repo yet: sketches are classified, overlaps are empty.
  const before = await classifyProject(root, project.id, { home, jev });
  assert.equal(before.summary.classified, 2);
  assert.equal(before.summary.classifiedPrimitives, 0);
  assert.deepEqual(before.sketches.find((s) => s.id === sketch.id).overlaps, []);

  // Classify the repo, then the sketch overlaps the repo's Button.
  await classifyRepo(root, { home, jev });
  const after = await classifyProject(root, project.id, { home, jev });
  assert.equal(after.summary.cached, 2, 'the sketches themselves were not asked about again');
  const flagged = after.sketches.find((s) => s.id === sketch.id);
  assert.deepEqual(flagged.overlaps.map((c) => c.name), ['Button']);
  assert.equal(after.sketches.find((s) => s.id === idea.id).classification.role, 'screen');

  const stored = await store.getProject(root, project.id);
  const node = stored.nodes.find((n) => n.id === sketch.id);
  assert.equal(node.classification.role, 'primitive');
  assert.equal(node.classification.kind, 'action');
  assert.deepEqual(node.classification.overlaps.map((c) => c.name), ['Button']);
  assert.equal(node.classification.key, sketchKey(node));

  const server = createKloseServer({ cwd: root, jev });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${url}/api/projects/${project.id}/classify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nodeIds: [idea.id], force: true }) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.sketches.length, 1);
  assert.equal(body.sketches[0].classification.role, 'screen');
  const lint = await fetch(`${url}/api/projects/${project.id}/nodes/${sketch.id}/lint?jev=0`);
  assert.equal(lint.status, 200);
  assert.equal((await lint.json()).jev.asked, false);
  const missing = await fetch(`${url}/api/projects/${project.id}/nodes/nope/lint`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code, 'NODE_NOT_FOUND');

  const bare = createKloseServer({ cwd: root, jev: { apiKey: '' } });
  await new Promise((resolve) => bare.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => bare.close(resolve)));
  const refused = await fetch(`http://127.0.0.1:${bare.address().port}/api/projects/${project.id}/classify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(refused.status, 400);
  assert.equal((await refused.json()).code, 'JEV_UNAVAILABLE');
});
