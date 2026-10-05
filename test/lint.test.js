import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  MAX_FINDINGS,
  applyLintAnswers,
  buildLintRequest,
  extractClasses,
  findLiterals,
  linesWith,
  lintFiles,
  lintSketch,
  splitClass,
  tokensFromCss,
} from '../server/lint.js';
import { lintNode } from '../server/insights.js';
import * as store from '../server/store.js';

const CODE = `export default function Card() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <button className={cn('hover:bg-indigo-700 bg-indigo-600 text-[#fff] rounded-[6px]', active && 'ring-2 ring-blue-500/40')}>Go</button>
      <span className={\`text-sm \${muted ? 'text-slate-500' : ''}\`}>Hi</span>
    </div>
  );
}`;

const CSS = `@theme {
  --color-brand-500: #2563eb;
  --color-brand-600: #1d4ed8;
  --radius-card: 12px;
  --shadow-soft: 0 1px 2px rgb(0 0 0 / .1);
}
:root { --primary: 37 99 235; --spacing-gutter: 24px; --duration-fast: 150ms; }`;

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

test('extractClasses reads string, expression and template className values', () => {
  const classes = extractClasses(CODE);
  assert.ok(classes.includes('rounded-xl'));
  assert.ok(classes.includes('hover:bg-indigo-700'));
  assert.ok(classes.includes('ring-blue-500/40'), 'strings inside a cn(...) call');
  assert.ok(classes.includes('text-slate-500'), 'strings inside a template literal hole');
  assert.ok(!classes.some((c) => c.includes('${')), 'template holes are not classes');
});

test('splitClass keeps variants, !important and opacity apart from the utility', () => {
  assert.deepEqual(splitClass('hover:md:!bg-indigo-600/50'), { variants: 'hover:md:', important: '!', utility: 'bg-indigo-600', opacity: '/50' });
  assert.deepEqual(splitClass('bg-[url(a:b/c)]'), { variants: '', important: '', utility: 'bg-[url(a:b/c)]', opacity: '' });
});

test('tokensFromCss namespaces @theme tokens by name and :root variables by value', () => {
  const tokens = tokensFromCss(CSS);
  const byName = Object.fromEntries(tokens.map((t) => [t.name, t.kind]));
  assert.equal(byName['--color-brand-500'], 'color');
  assert.equal(byName['--radius-card'], 'radius');
  assert.equal(byName['--shadow-soft'], 'shadow');
  assert.equal(byName['--spacing-gutter'], 'spacing');
  assert.equal(byName['--primary'], 'color', 'three numbers read as an rgb triple');
  assert.ok(!('--duration-fast' in byName), 'a :root variable with no recognisable value is left out');
});

test('findLiterals flags palette colours, arbitrary values and stock steps only where tokens exist', () => {
  const tokens = tokensFromCss(CSS);
  const found = findLiterals(CODE, tokens);
  const byClass = Object.fromEntries(found.map((f) => [f.class, f]));
  assert.equal(byClass['bg-indigo-600'].kind, 'palette');
  assert.equal(byClass['bg-indigo-600'].namespace, 'color');
  assert.equal(byClass['bg-indigo-600'].candidates, 3);
  assert.equal(byClass['text-[#fff]'].kind, 'arbitrary');
  assert.equal(byClass['rounded-[6px]'].namespace, 'radius');
  assert.equal(byClass['rounded-xl'].kind, 'scale');
  assert.equal(byClass['shadow-sm'].kind, 'scale');
  assert.equal(byClass['hover:bg-indigo-700'].utility, 'bg-indigo-700');
  assert.ok(!('bg-white' in byClass), 'white and black are not palette literals');
  assert.ok(!('p-6' in byClass), 'stock spacing is fine');
  assert.ok(!('ring-2' in byClass));
  assert.deepEqual(findLiterals('<div className="rounded-card shadow-soft rounded-none shadow-none" />', tokens), [], 'a repo radius or shadow token in use is not a literal');

  // Without radius or shadow tokens the stock steps are not findings.
  const colourOnly = tokens.filter((t) => t.kind === 'color');
  const fewer = findLiterals(CODE, colourOnly).map((f) => f.class);
  assert.ok(!fewer.includes('rounded-xl'));
  assert.ok(!fewer.includes('shadow-sm'));
  assert.ok(fewer.includes('rounded-[6px]'), 'an arbitrary value is still a finding');
  // Without colour tokens a palette colour has nothing to become.
  assert.ok(!findLiterals(CODE, []).some((f) => f.kind === 'palette'));
});

test('buildLintRequest sends class names and tokens only, one Choice per finding, offering tokens of its namespace', () => {
  const tokens = tokensFromCss(CSS);
  const findings = findLiterals(CODE, tokens);
  const { _ids, _offered, ...body } = buildLintRequest(findings, tokens);
  assert.equal(body.model, 'jev-latest');
  assert.equal(Object.keys(body.questions).length, findings.length);
  assert.ok(!JSON.stringify(body).includes('export default'), 'no code is sent');
  const radiusQ = Object.keys(body.state.classes).find((k) => body.state.classes[k].class === 'rounded-xl');
  const offeredRadius = Object.keys(body.questions[radiusQ].criteria);
  assert.equal(offeredRadius.length, 2, 'the one radius token, plus none');
  assert.equal(body.state.tokens[offeredRadius[0]].name, '--radius-card');
  assert.equal(offeredRadius.at(-1), 'none');
  const colourQ = Object.keys(body.state.classes).find((k) => body.state.classes[k].class === 'bg-indigo-600');
  assert.equal(Object.keys(body.questions[colourQ].criteria).length, 4, 'three colour tokens, plus none');
});

test('applyLintAnswers turns a token pick into a replacement class and ignores tokens the question never offered', () => {
  const tokens = tokensFromCss(CSS);
  const findings = findLiterals('<div className="hover:bg-indigo-600/50 rounded-xl text-[#fff]" />', tokens);
  const request = buildLintRequest(findings, tokens);
  const idOf = (name) => request._ids.find(([n]) => n === name)[1];
  const answers = {
    K01: { probabilities: { [idOf('--color-brand-600')]: 0.85, [idOf('--color-brand-500')]: 0.1, none: 0.05 } },
    // The radius question is answered with a colour token (not offered) and a weak "none".
    K02: { probabilities: { [idOf('--color-brand-600')]: 0.9, none: 0.1 } },
    K03: { probabilities: { [idOf('--primary')]: 0.5, none: 0.5 } },
  };
  const [bg, radius, text] = applyLintAnswers(findings, tokens, request, { answers });
  assert.equal(bg.verdict, 'replace');
  assert.equal(bg.suggestion.replacement, 'hover:bg-brand-600/50');
  assert.equal(bg.suggestion.confidence, 0.85);
  assert.equal(radius.verdict, 'keep');
  assert.equal(radius.suggestion, null);
  assert.equal(text.verdict, 'maybe');
  assert.equal(text.suggestion.replacement, 'text-[var(--primary)]', 'a :root variable is used through var()');
});

test('lintSketch works without a key, adds suggestions with one, and reports a Jev failure instead of throwing', async () => {
  const theme = { css: CSS };
  const plain = await lintSketch('/nowhere', CODE, { theme, jev: { apiKey: '' } });
  assert.equal(plain.jev.asked, false);
  assert.ok(plain.findings.length > 0);
  assert.ok(plain.findings.every((f) => !('suggestion' in f)));
  assert.deepEqual(plain.tokens, { color: 3, radius: 1, shadow: 1, spacing: 1 });

  let sent;
  const fetchImpl = async (url, init) => {
    sent = JSON.parse(init.body);
    assert.ok(url.endsWith('/v1/systemone'));
    const answers = {};
    for (const [q, question] of Object.entries(sent.questions)) {
      const first = Object.keys(question.criteria)[0];
      answers[q] = { probabilities: { [first]: 0.9, none: 0.1 } };
    }
    return jsonResponse(200, { model: 'jev-1.13.0', answers, usage: { input_tokens: 1 } });
  };
  const withJev = await lintSketch('/nowhere', CODE, { theme, jev: { apiKey: 'k', fetchImpl } });
  assert.equal(withJev.jev.asked, true);
  assert.equal(withJev.jev.model, 'jev-1.13.0');
  assert.ok(withJev.findings.every((f) => f.verdict === 'replace' && f.suggestion));
  assert.ok(!('_ids' in sent) && !('_offered' in sent), 'bookkeeping never leaves the process');

  const failing = await lintSketch('/nowhere', CODE, { theme, jev: { apiKey: 'k', fetchImpl: async () => jsonResponse(429, {}), retryDelayMs: 1 } });
  assert.equal(failing.jev.asked, true);
  assert.match(failing.jev.error, /rate limited/);
  assert.equal(failing.findings.length, plain.findings.length, 'the local findings survive');

  const skipped = await lintSketch('/nowhere', CODE, { theme, jev: { apiKey: 'k', fetchImpl }, useJev: false });
  assert.equal(skipped.jev.asked, false);
});

test('lintSketch caps the findings it reports', async () => {
  const classes = Array.from({ length: MAX_FINDINGS + 5 }, (_, i) => `bg-blue-${(i % 9 + 1) * 100} mt-${i}`).join(' ');
  const code = `<div className="${classes}" />`;
  // Every class is distinct via mt-N; the palette ones repeat, so count them.
  const result = await lintSketch('/nowhere', code, { theme: { css: ':root { --primary: #000; }' }, jev: { apiKey: '' } });
  assert.ok(result.findings.length <= MAX_FINDINGS);
  assert.equal(result.truncated, findLiterals(code, tokensFromCss(':root { --primary: #000; }')).length > MAX_FINDINGS);
});

test('lintNode reads the sketch and the repo theme, and 404s on an unknown node', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'klose-lint-'));
  try {
    await mkdir(path.join(cwd, 'src'), { recursive: true });
    await writeFile(path.join(cwd, 'src', 'globals.css'), '@theme { --color-brand-500: #2563eb; }', 'utf-8');
    const project = await store.createProject(cwd, 'Lint');
    const node = await store.addNode(cwd, project.id, { name: 'Card', code: '<div className="bg-indigo-600" />' });
    const result = await lintNode(cwd, project.id, node.id, { jev: { apiKey: '' } });
    assert.equal(result.name, 'Card');
    assert.equal(result.hasCode, true);
    assert.deepEqual(result.tokens, { color: 1 });
    assert.equal(result.findings[0].class, 'bg-indigo-600');

    const empty = await store.addNode(cwd, project.id, { name: 'Idea' });
    assert.equal((await lintNode(cwd, project.id, empty.id, { jev: { apiKey: '' } })).hasCode, false);
    await assert.rejects(lintNode(cwd, project.id, 'nope', { jev: { apiKey: '' } }), (err) => err.code === 'NODE_NOT_FOUND' && err.status === 404);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('buildLintText reads as a to-do list the agent can act on', async () => {
  const { buildLintText, findingLine } = await import('../lib/lintText.js');
  const text = buildLintText({
    projectId: 'p1',
    nodeId: 'n1',
    name: 'Pricing card',
    tokens: { color: 3 },
    jev: { asked: true },
    findings: [
      { class: 'bg-indigo-600', kind: 'palette', namespace: 'color', candidates: 3, verdict: 'replace', suggestion: { token: '--color-brand-600', replacement: 'bg-brand-600', confidence: 0.91 } },
      { class: 'text-[#fff]', kind: 'arbitrary', namespace: 'color', candidates: 3, verdict: 'maybe', suggestion: { token: '--primary', replacement: 'text-[var(--primary)]', confidence: 0.5 } },
      { class: 'rounded-xl', kind: 'scale', namespace: 'radius', candidates: 1, verdict: 'keep', suggestion: null },
    ],
  });
  const lines = text.split('\n');
  assert.equal(lines[0], 'Token check for the "Pricing card" sketch (project p1, node n1): 3 literal values where this repo has design tokens.');
  assert.equal(lines[2], '- bg-indigo-600 → bg-brand-600 (--color-brand-600, 91%)');
  assert.equal(lines[3], '- text-[#fff] → maybe text-[var(--primary)] (--primary, 50%); check it');
  assert.equal(lines[4], '- rounded-xl: no repo token fits; keep it');
  assert.match(lines.at(-1), /npx klose project lint p1 n1/);
  assert.equal(findingLine({ class: 'bg-blue-500', kind: 'palette', namespace: 'color', candidates: 2 }), 'bg-blue-500: stock palette colour, 2 color tokens in the repo could replace it');
  assert.match(buildLintText({ projectId: 'p', nodeId: 'n', name: '', findings: [], tokens: {}, jev: { asked: false } }), /nothing to change/);
});

test('linesWith reports the lines a class is on as a whole token, not inside a longer class', () => {
  const source = ['<div className="bg-indigo-600 text-[#1e293b]">', '  <span className="bg-indigo-600/50 hover:bg-indigo-600" />', '</div>'].join('\n');
  assert.deepEqual(linesWith(source, 'bg-indigo-600'), [1], 'bg-indigo-600/50 and hover:bg-indigo-600 are other classes');
  assert.deepEqual(linesWith(source, 'text-[#1e293b]'), [1], 'brackets and # are matched literally');
  assert.deepEqual(linesWith(source, 'hover:bg-indigo-600'), [2]);
  assert.deepEqual(linesWith(source, 'p-4'), []);
});

test('lintFiles walks a folder (skipping build output, tests and saved sketches), reads named files, and puts a line on each finding', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'klose-lint-files-'));
  try {
    await mkdir(path.join(dir, 'src', 'app', 'pricing'), { recursive: true });
    await mkdir(path.join(dir, 'src', 'node_modules', 'pkg'), { recursive: true });
    await mkdir(path.join(dir, 'docs', 'klose', 'plan'), { recursive: true });
    await writeFile(path.join(dir, 'src', 'app', 'globals.css'), CSS);
    await writeFile(
      path.join(dir, 'src', 'app', 'pricing', 'page.tsx'),
      ['export default function Page() {', '  return (', '    <section className="rounded-xl bg-indigo-600 p-6">', '      <h1 className="text-[#1e293b]">Plans</h1>', '    </section>', '  );', '}'].join('\n')
    );
    await writeFile(path.join(dir, 'src', 'app', 'clean.tsx'), 'export default () => <div className="bg-brand-500 rounded-card p-4" />;');
    await writeFile(path.join(dir, 'src', 'app', 'page.test.tsx'), '<div className="bg-indigo-600" />');
    await writeFile(path.join(dir, 'src', 'node_modules', 'pkg', 'index.jsx'), '<div className="bg-indigo-600" />');
    await writeFile(path.join(dir, 'docs', 'klose', 'plan', 'card.tsx'), `// Klose sketch — "Card" (sketch)\nexport default () => <div className="bg-indigo-600" />;`);
    await writeFile(path.join(dir, 'README.md'), '<p class="text-[#1e293b]">a class attribute in a file lint would not walk into</p>');

    const result = await lintFiles(dir, ['src', 'README.md', 'nope.tsx'], { cwd: dir, jev: { apiKey: '' } });
    assert.deepEqual(result.missing, ['nope.tsx']);
    assert.deepEqual(
      result.files.map((f) => f.file).sort(),
      ['README.md', path.join('src', 'app', 'clean.tsx'), path.join('src', 'app', 'pricing', 'page.tsx')].sort(),
      'the test file, node_modules and the saved sketch are skipped; a named file is read whatever its extension'
    );
    const page = result.files.find((f) => f.file.endsWith('page.tsx'));
    const byClass = Object.fromEntries(page.findings.map((f) => [f.class, f]));
    assert.deepEqual(byClass['bg-indigo-600'].lines, [3]);
    assert.deepEqual(byClass['rounded-xl'].lines, [3], 'a stock radius step is a finding because the repo has a radius token');
    assert.deepEqual(byClass['text-[#1e293b]'].lines, [4]);
    assert.equal(result.files.find((f) => f.file.endsWith('clean.tsx')).findings.length, 0);
    assert.equal(result.scanned, 3);
    assert.equal(result.withFindings, 2);
    assert.equal(result.findings, page.findings.length + 1);
    assert.deepEqual(result.tokens, { color: 3, radius: 1, shadow: 1, spacing: 1 });
    assert.equal(result.jev.asked, 0, 'Jev is only asked with useJev');
    assert.equal(result.truncated, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
