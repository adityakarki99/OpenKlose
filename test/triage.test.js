import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_COMMENTS_PER_REQUEST,
  TRIAGE_EFFORTS,
  TRIAGE_KINDS,
  buildTriageRequest,
  pendingTriage,
  readTriageAnswers,
  triageComments,
  triageKey,
} from '../server/triage.js';
import { triageProject } from '../server/insights.js';
import { createKloseServer } from '../server/http.js';
import * as store from '../server/store.js';

const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'klose.js');

// Asynchronous on purpose: the fake TypeSafe server below lives in this
// process, and a spawnSync would block the loop it answers from.
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

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Answers every kind/effort question in a request from a table keyed by comment text. */
function answersFor(body, table = {}) {
  const answers = {};
  for (const q of Object.keys(body.questions)) {
    const [id, what] = q.split('_');
    const text = body.state.comments[id].text;
    const [kind, effort] = table[text] || ['visual', 'quick'];
    answers[q] = what === 'kind' ? { choice: kind, confidence: 0.9 } : { choice: effort, confidence: 0.75 };
  }
  return { model: 'jev-1.13.0', answers, usage: { input_tokens: 50, output_tokens: 8 } };
}

const node = {
  id: 'n1',
  name: 'Pricing card',
  description: 'Three tiers',
  comments: [
    { id: 'c1', text: 'Make the CTA bigger', createdAt: 1, element: { tagName: 'button', text: 'Subscribe', classes: 'rounded-xl px-4', path: 'div > button' } },
    { id: 'c2', text: 'Rename "Pro" to "Team"', createdAt: 2 },
    { id: 'c3', text: 'Done already', createdAt: 3, resolvedAt: 4 },
  ],
};

test('a triage request sends the comment text, the sketch context and the element, with two questions per comment', () => {
  const body = buildTriageRequest(node, pendingTriage(node));
  assert.equal(body.model, 'jev-latest');
  assert.deepEqual(body.state.sketch, { name: 'Pricing card', description: 'Three tiers', status: 'sketch', file: null });
  assert.deepEqual(Object.keys(body.state.comments), ['C01', 'C02'], 'resolved comments are not sent');
  assert.deepEqual(body.state.comments.C01.element, { tag: 'button', text: 'Subscribe', classes: 'rounded-xl px-4' });
  assert.equal(body.state.comments.C02.element, null);
  assert.deepEqual(Object.keys(body.questions), ['C01_kind', 'C01_effort', 'C02_kind', 'C02_effort']);
  assert.deepEqual(Object.keys(body.questions.C01_kind.criteria), Object.keys(TRIAGE_KINDS));
  assert.deepEqual(Object.keys(body.questions.C01_effort.criteria), Object.keys(TRIAGE_EFFORTS));
  assert.ok(!('path' in body.state.comments.C01.element), 'the DOM path is not needed and not sent');
});

test('the triage key follows the comment and its sketch, so an edit asks again', () => {
  const c = node.comments[0];
  assert.equal(triageKey(node, c), triageKey({ ...node, x: 9, code: 'whatever' }, { ...c, sentAt: 5 }));
  assert.notEqual(triageKey(node, c), triageKey(node, { ...c, text: 'Make it smaller' }));
  assert.notEqual(triageKey(node, c), triageKey({ ...node, name: 'Plan card' }, c));
  const triaged = { ...c, triage: { kind: 'visual', effort: 'quick', key: triageKey(node, c) } };
  assert.deepEqual(pendingTriage({ ...node, comments: [triaged, node.comments[1]] }).map((x) => x.id), ['c2']);
  assert.deepEqual(pendingTriage({ ...node, comments: [triaged] }, { force: true }).map((x) => x.id), ['c1']);
});

test('readTriageAnswers rejects an answer outside the fixed options', () => {
  const comments = pendingTriage(node);
  const good = answersFor(buildTriageRequest(node, comments), { 'Rename "Pro" to "Team"': ['copy', 'quick'] });
  const read = readTriageAnswers(good, comments);
  assert.deepEqual(read.c2, { kind: 'copy', effort: 'quick', kindConfidence: 0.9, effortConfidence: 0.75 });
  const bad = { answers: { ...good.answers, C01_kind: { choice: 'other' } } };
  assert.throws(() => readTriageAnswers(bad, comments), /unexpected response shape/);
});

test('triageComments asks one request per sketch for the comments not yet triaged, in batches', async () => {
  const many = { id: 'n2', name: 'Table', comments: Array.from({ length: MAX_COMMENTS_PER_REQUEST + 3 }, (_, i) => ({ id: `m${i}`, text: `Comment ${i}`, createdAt: i })) };
  const requests = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    return jsonResponse(200, answersFor(body));
  };
  const { results, summary } = await triageComments([node, many], { apiKey: 'k', fetchImpl });
  assert.equal(requests.length, 3, 'one for the card, two for the long table');
  assert.equal(summary.total, 2 + many.comments.length);
  assert.equal(summary.triaged, summary.total);
  assert.equal(results.n1.c1.kind, 'visual');
  assert.equal(results.n1.c1.key, triageKey(node, node.comments[0]));
  assert.ok(!results.n1.c3, 'resolved comments are untouched');

  // Already triaged: nothing is sent.
  const done = { ...node, comments: node.comments.map((c) => (results.n1[c.id] ? { ...c, triage: results.n1[c.id] } : c)) };
  requests.length = 0;
  const again = await triageComments([done], { apiKey: 'k', fetchImpl });
  assert.equal(requests.length, 0);
  assert.deepEqual(again.summary, { total: 2, triaged: 0, cached: 2, failed: 0, error: null });
});

test('triageComments stops on a rejected key and counts the rest as failed', async () => {
  let calls = 0;
  const other = { id: 'n3', name: 'Nav', comments: [{ id: 'x', text: 'Left', createdAt: 1 }] };
  const { summary } = await triageComments([node, other], { apiKey: 'bad', fetchImpl: async () => { calls++; return jsonResponse(401, {}); } });
  assert.equal(calls, 1);
  assert.equal(summary.failed, 3);
  assert.match(summary.error, /rejected/);
  await assert.rejects(triageComments([node], { apiKey: '' }), /TYPESAFE_API_KEY is not set/);
});

test('triageProject stores the answers on the comments, and klose feedback shows them', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'klose-triage-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const project = await store.createProject(cwd, 'Billing');
  const saved = await store.addNode(cwd, project.id, { name: 'Pricing card', comments: node.comments });
  const fetchImpl = async (url, init) => jsonResponse(200, answersFor(JSON.parse(init.body), { 'Rename "Pro" to "Team"': ['copy', 'quick'], 'Make the CTA bigger': ['visual', 'moderate'] }));

  const { summary, feedback } = await triageProject(cwd, { projectId: project.id, jev: { apiKey: 'k', fetchImpl } });
  assert.equal(summary.triaged, 2);
  assert.deepEqual(feedback.map((f) => [f.commentId, f.triage.kind, f.triage.effort]), [['c1', 'visual', 'moderate'], ['c2', 'copy', 'quick']]);

  const stored = await store.getProject(cwd, project.id);
  const c1 = stored.nodes[0].comments[0];
  assert.equal(c1.triage.kind, 'visual');
  assert.equal(c1.triage.key, triageKey(saved, c1));
  assert.ok(!stored.nodes[0].comments[2].triage);
  assert.ok(stored.updated_at > project.updated_at);

  // Second run: everything cached, no request.
  let calls = 0;
  const again = await triageProject(cwd, { projectId: project.id, jev: { apiKey: 'k', fetchImpl: async () => { calls++; return jsonResponse(500, {}); } } });
  assert.equal(calls, 0);
  assert.equal(again.summary.cached, 2);

  // Over HTTP.
  const server = createKloseServer({ cwd, jev: { apiKey: 'k', fetchImpl } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}/api/feedback/triage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: project.id, force: true }) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.summary.triaged, 2);
  assert.equal(body.feedback[1].triage.kind, 'copy');
  const health = await (await fetch(`${base}/api/health`)).json();
  assert.deepEqual(health.jev, { available: true });

  // No key: a clear answer, not a request.
  const bare = createKloseServer({ cwd, jev: { apiKey: '' } });
  await new Promise((resolve) => bare.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => bare.close(resolve)));
  const refused = await fetch(`http://127.0.0.1:${bare.address().port}/api/feedback/triage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(refused.status, 400);
  assert.equal((await refused.json()).code, 'JEV_UNAVAILABLE');
});

test('klose feedback --triage runs against TYPESAFE_BASE_URL and prints the triage with each comment', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'klose-triage-cli-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const project = await store.createProject(cwd, 'CLI');
  await store.addNode(cwd, project.id, { name: 'Button', comments: [{ id: 'f1', text: 'Increase contrast', createdAt: 1 }] });

  const fake = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      assert.equal(req.headers.authorization, 'Bearer test-key');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(answersFor(JSON.parse(raw), { 'Increase contrast': ['visual', 'quick'] })));
    });
  });
  await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => fake.close(resolve)));

  const result = await klose(cwd, ['feedback', '--triage', `--project=${project.id}`], {
    TYPESAFE_API_KEY: 'test-key',
    TYPESAFE_BASE_URL: `http://127.0.0.1:${fake.address().port}`,
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.triage.triaged, 1);
  assert.deepEqual(output.feedback[0].triage, { kind: 'visual', effort: 'quick', kindConfidence: 0.9, effortConfidence: 0.75 });

  const noKey = await klose(cwd, ['feedback', '--triage'], { TYPESAFE_API_KEY: '' });
  assert.equal(noKey.status, 1);
  assert.match(noKey.stderr, /TYPESAFE_API_KEY is not set/);
});
