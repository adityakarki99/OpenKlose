import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectRouters, discoverRoutes, fillRoute, planMap, DEFAULT_MAP_PROJECT } from '../server/routes.js';
import { liveNodeProblem, mapFieldsProblem } from '../server/storeCore.js';
import * as store from '../server/store.js';

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'klose.js');

/** A throwaway repo holding `files` ({ 'app/index.tsx': '…' }); every route file's body defaults to a stub. */
async function repo(deps, files) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'klose-routes-'));
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'app', dependencies: deps }));
  for (const [rel, body] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await writeFile(path.join(dir, rel), body || 'export default function Screen() { return null; }\n');
  }
  return dir;
}

const pick = (routes, kind = 'page') => routes.filter((r) => r.kind === kind).map((r) => r.path);
const run = (cwd, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf-8' });

test('expo-router: groups, index files, dynamic and catch-all segments, ignored files', async () => {
  const dir = await repo({ expo: '^52', 'expo-router': '^4' }, {
    'app/_layout.tsx': '',
    'app/index.tsx': '',
    'app/+not-found.tsx': '',
    'app/+html.tsx': '',
    'app/__klose.tsx': '',
    'app/(tabs)/_layout.tsx': '',
    'app/(tabs)/settings.tsx': '',
    'app/(tabs)/orders/index.tsx': '',
    'app/(tabs)/orders/[id].tsx': '',
    'app/docs/[...rest].tsx': '',
    'app/about.web.tsx': '',
    'app/about.tsx': '',
    'app/hello+api.ts': '',
    'app/node_modules/pkg/index.tsx': '',
    'components/Button.tsx': '',
  });
  try {
    assert.deepEqual(await detectRouters(dir), ['expo-router']);
    const routes = await discoverRoutes(dir);
    assert.deepEqual(pick(routes), ['/', '/about', '/docs/[...rest]', '/orders', '/orders/[id]', '/settings']);
    assert.deepEqual(pick(routes, 'layout'), ['/', '/']);
    assert.deepEqual(pick(routes, 'api'), ['/hello']);
    const order = routes.find((r) => r.path === '/orders/[id]');
    assert.deepEqual(order, { path: '/orders/[id]', file: 'app/(tabs)/orders/[id].tsx', params: ['id'], framework: 'expo-router', kind: 'page' });
    assert.deepEqual(routes.find((r) => r.path === '/docs/[...rest]').params, ['rest']);
    // A custom harness route is left out too.
    assert.ok(!pick(await discoverRoutes(dir, { harnessPath: '/about' })).includes('/about'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('expo-router reads src/app when there is no app/', async () => {
  const dir = await repo({ 'expo-router': '^4' }, { 'src/app/index.tsx': '', 'src/app/profile.tsx': '' });
  try {
    const routes = await discoverRoutes(dir);
    assert.deepEqual(pick(routes), ['/', '/profile']);
    assert.equal(routes[1].file, 'src/app/profile.tsx');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Next.js: app/ and pages/, with layouts, api routes, private folders and slots left out', async () => {
  const dir = await repo({ next: '^15', react: '^19' }, {
    'src/app/layout.tsx': '',
    'src/app/page.tsx': '',
    'src/app/loading.tsx': '',
    'src/app/(marketing)/pricing/page.tsx': '',
    'src/app/blog/[slug]/page.mdx': '',
    'src/app/shop/[[...filters]]/page.tsx': '',
    'src/app/api/users/route.ts': '',
    'src/app/_components/Card.tsx': '',
    'src/app/_private/page.tsx': '',
    'src/app/@modal/login/page.tsx': '',
    'src/app/feed/(..)photo/page.tsx': '',
    'src/app/build/page.tsx': '',
    'src/pages/_app.tsx': '',
    'src/pages/_document.tsx': '',
    'src/pages/404.tsx': '',
    'src/pages/legacy/index.tsx': '',
    'src/pages/legacy/[id].tsx': '',
    'src/pages/api/hello.ts': '',
  });
  try {
    assert.deepEqual(await detectRouters(dir), ['next']);
    const routes = await discoverRoutes(dir);
    assert.deepEqual(pick(routes), ['/', '/blog/[slug]', '/build', '/legacy', '/legacy/[id]', '/pricing', '/shop/[[...filters]]']);
    assert.deepEqual(pick(routes, 'layout'), ['/']);
    assert.deepEqual(pick(routes, 'api'), ['/api/hello', '/api/users']);
    assert.deepEqual(routes.find((r) => r.path === '/shop/[[...filters]]').params, ['filters']);
    assert.equal(routes.find((r) => r.path === '/pricing').file, 'src/app/(marketing)/pricing/page.tsx');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('React Router: path literals from route objects and <Route> elements, nested ones joined', async () => {
  const dir = await repo({ 'react-router-dom': '^7' }, {
    'src/router.tsx': `import { createBrowserRouter } from 'react-router-dom';
// { path: '/commented-out' }
export const router = createBrowserRouter([
  {
    path: '/',
    element: <Root label="{ path: '/in-a-string' }" />,
    children: [
      { index: true, element: <Home /> },
      { path: 'teams', element: <Teams />, children: [{ path: ':teamId', element: <Team /> }, { path: 'new', element: <NewTeam /> }] },
      { path: '/absolute/:id?', element: <Abs /> },
      { path: 'files/*', element: <Files /> },
    ],
  },
  { path: '*', element: <NotFound /> },
]);
`,
    'src/App.jsx': `import { Routes, Route } from "react-router-dom";
export default () => (
  <Routes>
    <Route path="/dash" element={<Dash a={1 > 0} />}>
      <Route index element={<Overview />} />
      <Route path="reports" element={<Reports />} />
      <Route path={'reports/:reportId'} element={<Report />} />
    </Route>
    <Route element={<Guard />}>
      <Route path="/account" element={<Account />} />
    </Route>
  </Routes>
);
`,
    // Not a router file: its `path` keys are something else.
    'src/config.ts': `export const upload = { path: '/tmp/uploads' };\n`,
    'src/router.test.tsx': `import { x } from 'react-router-dom';\nconst r = [{ path: '/only-in-a-test' }];\n`,
    'dist/router.js': `import 'react-router-dom';\nconst r = [{ path: '/built' }];\n`,
  });
  try {
    assert.deepEqual(await detectRouters(dir), ['react-router']);
    const routes = await discoverRoutes(dir);
    assert.deepEqual(pick(routes), [
      '/',
      '/absolute/[id]',
      '/account',
      '/dash',
      '/dash/reports',
      '/dash/reports/[reportId]',
      '/files/[...splat]',
      '/teams',
      '/teams/[teamId]',
      '/teams/new',
    ]);
    assert.equal(routes.find((r) => r.path === '/teams/[teamId]').file, 'src/router.tsx');
    assert.deepEqual(routes.find((r) => r.path === '/teams/[teamId]').params, ['teamId']);
    assert.equal(routes.find((r) => r.path === '/dash/reports').file, 'src/App.jsx');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a repo with no router has no routes', async () => {
  const dir = await repo({ react: '^19' }, { 'app/index.tsx': '', 'pages/index.tsx': '' });
  try {
    assert.deepEqual(await detectRouters(dir), []);
    assert.deepEqual(await discoverRoutes(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('fillRoute fills params, encodes them, and says which are missing', () => {
  assert.deepEqual(fillRoute('/'), { pathname: '/' });
  assert.deepEqual(fillRoute('/users/[id]', { id: 'a b' }), { pathname: '/users/a%20b' });
  assert.deepEqual(fillRoute('/users/[id]/posts/[postId]', { id: '1' }), { missing: ['postId'] });
  assert.deepEqual(fillRoute('/docs/[...rest]', { rest: 'guides/intro' }), { pathname: '/docs/guides/intro' });
  assert.deepEqual(fillRoute('/docs/[...rest]'), { missing: ['rest'] });
  assert.deepEqual(fillRoute('/shop/[[...filters]]'), { pathname: '/shop' });
});

const page = (p, file = 'app/x.tsx') => ({ path: p, file, params: [...p.matchAll(/\[(?:\.\.\.)?([^\]]+)\]/g)].map((m) => m[1]), framework: 'next', kind: 'page' });

test('planMap lays new routes out in bands, and never touches a card that exists', () => {
  const routes = [page('/'), page('/orders'), page('/orders/[id]'), page('/settings'), { ...page('/api/x'), kind: 'api' }];
  const first = planMap({ routes, devServer: 'http://localhost:3000/' });
  assert.deepEqual(first.add.map((n) => [n.route, n.url ?? null]), [
    ['/', 'http://localhost:3000/'],
    ['/orders', 'http://localhost:3000/orders'],
    ['/orders/[id]', null],
    ['/settings', 'http://localhost:3000/settings'],
  ]);
  assert.match(first.add[2].notes, /--param id=<value>/);
  assert.deepEqual(first.needParams, [{ route: '/orders/[id]', params: ['id'] }]);
  // One band per first segment: /orders and /orders/[id] share a row, the others have their own.
  const at = Object.fromEntries(first.add.map((n) => [n.route, [n.x, n.y]]));
  assert.equal(at['/orders'][1], at['/orders/[id]'][1]);
  assert.ok(at['/orders/[id]'][0] > at['/orders'][0]);
  assert.ok(at['/orders'][1] > at['/'][1] && at['/settings'][1] > at['/orders'][1]);
  for (const n of first.add) assert.equal(liveNodeProblem(n), null);

  // Second run, after the user moved a card, added a state card and the app gained and lost a route.
  const nodes = first.add.map((n, i) => ({ ...n, id: `n${i}` }));
  nodes[1] = { ...nodes[1], x: 5000, y: 5000, name: 'Orders (renamed)' };
  nodes.push({ id: 'state', name: '/orders - empty', route: '/orders', state: 'empty', x: 5600, y: 5000, width: 480, height: 360 });
  nodes.push({ id: 'unrelated', name: 'A sketch', x: 0, y: 9000, width: 480, height: 360 });
  const next = planMap({ routes: [page('/'), page('/orders'), page('/orders/[id]'), page('/new')], nodes, devServer: 'http://localhost:3000', params: { id: '42' } });
  assert.deepEqual(next.add.map((n) => n.route), ['/new']);
  assert.ok(next.add[0].y >= 9000 + 360, 'new cards go below everything already on the canvas');
  assert.deepEqual(next.kept, ['/', '/orders', '/orders/[id]']);
  assert.deepEqual(next.fill, [{ id: 'n2', route: '/orders/[id]', updates: { url: 'http://localhost:3000/orders/42', notes: '' } }]);
  assert.deepEqual(next.missing, [{ route: '/settings', nodeIds: ['n3'] }]);
  assert.deepEqual(next.needParams, []);
});

test('planMap refuses a dev server that is not on this machine', () => {
  for (const devServer of ['https://example.com', 'http://u:p@localhost:3000', 'file:///etc', '', undefined]) {
    assert.throws(() => planMap({ routes: [page('/')], devServer }), /localhost/);
  }
});

test('route and state are validated wherever a card is saved', async () => {
  assert.equal(mapFieldsProblem({ route: '/users/[id]', state: 'loading' }), null);
  assert.equal(mapFieldsProblem({ route: null, state: null }), null);
  assert.equal(mapFieldsProblem({}), null);
  for (const route of ['users', '', 42, '/a b', '/a\nb', `/${'x'.repeat(600)}`]) assert.match(mapFieldsProblem({ route }), /route must/);
  for (const state of ['', '  ', ' loading', 7, 'a\nb', 'x'.repeat(41)]) assert.match(mapFieldsProblem({ state }), /state must/);

  const cwd = await mkdtemp(path.join(os.tmpdir(), 'klose-routes-'));
  try {
    const project = await store.createProject(cwd, 'Fields');
    const node = await store.addNode(cwd, project.id, { name: '/orders', route: '/orders', state: 'empty' });
    assert.equal(node.route, '/orders');
    assert.equal(node.state, 'empty');
    await assert.rejects(store.addNode(cwd, project.id, { name: 'bad', route: 'orders' }), /route must/);
    await assert.rejects(store.updateNode(cwd, project.id, node.id, { state: 'x'.repeat(41) }), /state must/);
    await assert.rejects(store.updateProject(cwd, project.id, { nodes: [{ ...node, route: 'nope' }] }), /route must/);
    const kept = (await store.getProject(cwd, project.id)).nodes[0];
    assert.deepEqual([kept.route, kept.state], ['/orders', 'empty']);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('klose routes and klose map: one card per page, idempotent, reports what disappeared', async () => {
  const dir = await repo({ next: '^15' }, {
    'app/page.tsx': '',
    'app/layout.tsx': '',
    'app/orders/page.tsx': '',
    'app/orders/[id]/page.tsx': '',
    'app/old/page.tsx': '',
    'app/api/ping/route.ts': '',
  });
  try {
    const listed = run(dir, 'routes', '--json');
    assert.equal(listed.status, 0, listed.stderr);
    assert.deepEqual(pick(JSON.parse(listed.stdout)), ['/', '/old', '/orders', '/orders/[id]']);
    assert.match(run(dir, 'routes').stdout, /\/orders\/\[id\]\s+page\s+app\/orders\/\[id\]\/page\.tsx/);

    const first = run(dir, 'map', '--json');
    assert.equal(first.status, 0, first.stderr);
    const a = JSON.parse(first.stdout);
    assert.equal(a.created, true);
    assert.equal(a.projectName, DEFAULT_MAP_PROJECT);
    assert.equal(a.devServer, 'http://localhost:3000');
    assert.deepEqual(a.added.map((n) => [n.route, n.url]), [
      ['/', 'http://localhost:3000/'],
      ['/old', 'http://localhost:3000/old'],
      ['/orders', 'http://localhost:3000/orders'],
      ['/orders/[id]', null],
    ]);
    assert.deepEqual(a.needParams, [{ route: '/orders/[id]', params: ['id'] }]);
    const before = await store.getProject(dir, a.projectId);
    assert.equal(before.nodes.length, 4);
    assert.match(before.nodes.find((n) => n.route === '/orders/[id]').notes, /needs a value for \[id\]/);

    // Again, unchanged: nothing is added, moved or rewritten.
    const again = JSON.parse(run(dir, 'map', '--json').stdout);
    assert.equal(again.created, false);
    assert.equal(again.projectId, a.projectId);
    assert.deepEqual(again.added, []);
    assert.deepEqual((await store.getProject(dir, a.projectId)).nodes, before.nodes);
    assert.equal((await store.listProjects(dir)).filter((p) => p.name === DEFAULT_MAP_PROJECT).length, 1);

    // The app changes: a route goes, a route arrives, the user moves a card, and a param gets a value.
    await rm(path.join(dir, 'app/old'), { recursive: true });
    await mkdir(path.join(dir, 'app/new'), { recursive: true });
    await writeFile(path.join(dir, 'app/new/page.tsx'), '');
    const orders = before.nodes.find((n) => n.route === '/orders');
    await store.updateNode(dir, a.projectId, orders.id, { x: 4000, y: 4000 });
    const third = run(dir, 'map', '--param', 'id=42', '--json');
    assert.equal(third.status, 0, third.stderr);
    const c = JSON.parse(third.stdout);
    assert.deepEqual(c.added.map((n) => n.route), ['/new']);
    assert.deepEqual(c.filled.map((n) => [n.route, n.url]), [['/orders/[id]', 'http://localhost:3000/orders/42']]);
    assert.deepEqual(c.missing.map((m) => m.route), ['/old']);
    const after = await store.getProject(dir, a.projectId);
    assert.equal(after.nodes.length, 5, 'the card for the route that disappeared is left alone');
    const moved = after.nodes.find((n) => n.route === '/orders');
    assert.deepEqual([moved.x, moved.y, moved.url], [4000, 4000, 'http://localhost:3000/orders']);
    assert.equal(after.nodes.find((n) => n.route === '/orders/[id]').notes, '');
    assert.match(run(dir, 'map').stdout, /- \/old is no longer a route/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('klose map takes the dev server from klose.config.json, a flag, and refuses a remote one', async () => {
  const dir = await repo({ expo: '^52', 'expo-router': '^4' }, { 'app/index.tsx': '', 'app/preview.tsx': '' });
  try {
    await writeFile(path.join(dir, 'klose.config.json'), JSON.stringify({ framework: 'expo', devServer: 'http://localhost:19006', harnessPath: '/preview' }));
    const fromConfig = JSON.parse(run(dir, 'map', '--json').stdout);
    assert.equal(fromConfig.devServer, 'http://localhost:19006');
    assert.deepEqual(fromConfig.added.map((n) => n.route), ['/'], 'the harness route is not mapped');

    const project = await store.createProject(dir, 'Elsewhere');
    const flagged = JSON.parse(run(dir, 'map', '--dev-server=http://127.0.0.1:4000/', `--project=${project.id}`, '--json').stdout);
    assert.equal(flagged.projectId, project.id);
    assert.deepEqual(flagged.added.map((n) => n.url), ['http://127.0.0.1:4000/']);

    const remote = run(dir, 'map', '--dev-server=https://example.com');
    assert.equal(remote.status, 1);
    assert.match(remote.stderr, /localhost/);
    assert.equal(run(dir, 'map', '--param', 'id').status, 1);
    assert.equal(run(dir, 'map', '--nope').status, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('klose map fails plainly in a repo with no router', async () => {
  const dir = await repo({ react: '^19' }, { 'src/App.tsx': '' });
  try {
    const result = run(dir, 'map');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no router found/);
    assert.deepEqual(await store.listProjects(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
