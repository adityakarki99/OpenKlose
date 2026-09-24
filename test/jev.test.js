import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildRequest,
  preselect,
  rankComponents,
  verdictFor,
  JevError,
  MAX_CANDIDATES,
} from '../server/jev.js';

function component(name, extra = {}) {
  return {
    id: `src/${name}.tsx#${name}`,
    name,
    file: `src/${name}.tsx`,
    line: 1,
    category: 'components',
    description: '',
    props: [],
    ...extra,
  };
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function answer(probabilities, noul) {
  return {
    model: 'jev-1.13.0',
    answers: {
      where: { type: 'choice', choice: Object.keys(probabilities)[0], probabilities, confidence: 0.9 },
      exists: { type: 'noul', noul },
    },
    usage: { input_tokens: 100, output_tokens: 20 },
  };
}

const COMPONENTS = [
  component('Badge', { description: 'Small status label.' }),
  component('PlanTier', {
    description: 'One subscription tier with price, features and a call to action.',
    props: [{ name: 'price', optional: false }, { name: 'highlighted', optional: true }],
  }),
  component('Toggle'),
];

test('buildRequest sends metadata under option ids, never source code', () => {
  const body = buildRequest([component('Card', {
    description: 'x'.repeat(1000),
    props: [{ name: 'title', optional: false, type: 'string' }],
    source: 'export function Card() {}',
  })], 'a card');
  assert.equal(body.model, 'jev-latest');
  assert.deepEqual(Object.keys(body.state.components), ['C001']);
  const sent = body.state.components.C001;
  assert.deepEqual(Object.keys(sent).sort(), ['category', 'description', 'file', 'name', 'props']);
  assert.deepEqual(sent.props, ['title']);
  assert.equal(sent.description.length, 300);
  assert.deepEqual(body.questions.where.criteria, { C001: null });
  assert.equal(body.questions.where.type, 'choice');
  assert.equal(body.questions.exists.type, 'noul');
  assert.equal(body.questions.where.instructions.need, 'a card');
});

test('preselect keeps small indexes whole and narrows large ones by query words', () => {
  assert.equal(preselect(COMPONENTS, 'pricing'), COMPONENTS);
  const many = Array.from({ length: 300 }, (_, i) => component(`Widget${i}`));
  many.push(component('PricingCard'));
  const picked = preselect(many, 'pricing card');
  assert.equal(picked.length, MAX_CANDIDATES);
  assert.equal(picked[0].name, 'PricingCard');
});

test('verdictFor splits the exists probability into reuse / partial / new', () => {
  assert.equal(verdictFor(0.95), 'reuse');
  assert.equal(verdictFor(0.5), 'partial');
  assert.equal(verdictFor(0.05), 'new');
});

test('rankComponents orders by relevance and reports the verdict', async () => {
  let request;
  const fetchImpl = async (url, init) => {
    request = { url, init, body: JSON.parse(init.body) };
    return jsonResponse(200, answer({ C001: 0.05, C002: 0.9, C003: 0.05 }, 0.93));
  };
  const result = await rankComponents(COMPONENTS, 'pricing table', { apiKey: 'k', fetchImpl, baseUrl: 'https://example.test/' });
  assert.equal(request.url, 'https://example.test/v1/systemone');
  assert.equal(request.init.headers.Authorization, 'Bearer k');
  assert.equal(result.ranked[0].name, 'PlanTier');
  assert.equal(result.ranked[0].relevance, 0.9);
  assert.equal(result.verdict, 'reuse');
  assert.equal(result.model, 'jev-1.13.0');
  assert.equal(result.considered, 3);
});

test('rankComponents retries once on 429, then succeeds', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return calls === 1 ? jsonResponse(429, { error: 'slow down' }) : jsonResponse(200, answer({ C001: 1 }, 0.1));
  };
  const result = await rankComponents(COMPONENTS, 'x', { apiKey: 'k', fetchImpl, retryDelayMs: 1 });
  assert.equal(calls, 2);
  assert.equal(result.verdict, 'new');
});

test('rankComponents throws JevError without retrying on a rejected key', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return jsonResponse(401, { error: 'bad key' }); };
  await assert.rejects(rankComponents(COMPONENTS, 'x', { apiKey: 'k', fetchImpl }), (err) => {
    assert.ok(err instanceof JevError);
    assert.match(err.message, /rejected/);
    return true;
  });
  assert.equal(calls, 1);
});

test('rankComponents rejects missing key, empty query and malformed answers', async () => {
  const fetchImpl = async () => jsonResponse(200, { answers: {} });
  await assert.rejects(rankComponents(COMPONENTS, 'x', { fetchImpl }), /TYPESAFE_API_KEY/);
  await assert.rejects(rankComponents(COMPONENTS, '  ', { apiKey: 'k', fetchImpl }), /description/);
  await assert.rejects(rankComponents(COMPONENTS, 'x', { apiKey: 'k', fetchImpl }), /unexpected response/);
});

test('rankComponents turns a hung request into a timeout error', async () => {
  // AbortSignal.timeout's timer is unref'd; a real socket keeps the process
  // alive while it waits, so stand in for one here.
  const fetchImpl = (url, init) => new Promise((resolve, reject) => {
    const socket = setTimeout(() => {}, 5000);
    init.signal.addEventListener('abort', () => { clearTimeout(socket); reject(init.signal.reason); });
  });
  await assert.rejects(rankComponents(COMPONENTS, 'x', { apiKey: 'k', fetchImpl, timeoutMs: 20 }), /no answer within/);
});

// ---------------------------------------------------------------- CLI

const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'klose.js');

// Async, not spawnSync: the fake TypeSafe server runs in this process and must
// keep serving while the CLI waits on it.
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

async function withRepo(fn) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'klose-jev-test-'));
  try {
    await mkdir(path.join(cwd, '.git'));
    await mkdir(path.join(cwd, 'src'));
    await writeFile(path.join(cwd, 'src', 'PlanTier.tsx'), '/** One subscription tier. */\nexport function PlanTier() {\n  return <div />;\n}\n');
    await writeFile(path.join(cwd, 'src', 'Badge.tsx'), 'export function Badge() {\n  return <span />;\n}\n');
    await fn(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

async function withFakeTypeSafe(handler, fn) {
  const requests = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const body = JSON.parse(raw);
      requests.push({ url: req.url, auth: req.headers.authorization, body });
      const [status, payload] = handler(body);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`, requests);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('klose components --rank --json returns Jev ranking and verdict', async () => {
  await withRepo(async (cwd) => {
    await withFakeTypeSafe((body) => {
      // Scanner order is alphabetical: C001 Badge, C002 PlanTier.
      assert.equal(body.state.components.C002.name, 'PlanTier');
      return [200, answer({ C001: 0.1, C002: 0.9 }, 0.92)];
    }, async (baseUrl, requests) => {
      const result = await klose(cwd, ['components', 'pricing', 'table', '--rank', '--json', '--top=1'], {
        TYPESAFE_API_KEY: 'test-key',
        TYPESAFE_BASE_URL: baseUrl,
      });
      assert.equal(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.equal(output.ranking.source, 'jev');
      assert.equal(output.ranking.verdict, 'reuse');
      assert.equal(output.query, 'pricing table');
      assert.equal(output.count, 1);
      assert.equal(output.components[0].name, 'PlanTier');
      assert.equal(output.components[0].relevance, 0.9);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].url, '/v1/systemone');
      assert.equal(requests[0].auth, 'Bearer test-key');
      assert.match(result.stderr, /no source code/);
    });
  });
});

test('klose components --rank falls back to text search without a key', async () => {
  await withRepo(async (cwd) => {
    const result = await klose(cwd, ['components', 'badge', '--rank', '--json'], { TYPESAFE_API_KEY: '' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /TYPESAFE_API_KEY is not set/);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ranking, undefined);
    assert.deepEqual(output.components.map((c) => c.name), ['Badge']);
  });
});

test('klose components --rank falls back to text search when Jev errors', async () => {
  await withRepo(async (cwd) => {
    await withFakeTypeSafe(() => [401, { error: 'bad key' }], async (baseUrl) => {
      const result = await klose(cwd, ['components', 'badge', '--rank'], {
        TYPESAFE_API_KEY: 'wrong',
        TYPESAFE_BASE_URL: baseUrl,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stderr, /Jev: TYPESAFE_API_KEY was rejected/);
      assert.match(result.stdout, /1 component matching "badge"/);
    });
  });
});
