import { createServer } from 'node:http';
import { watch } from 'node:fs';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import * as store from './store.js';
import { scanComponents, filterComponents, readComponentSource } from './scanner.js';
import { loadTheme } from './theme.js';
import { exportProject, repoState } from './export.js';
import { createRepoIndex, listRepos, trayState } from './hub.js';
import { HttpError } from './errors.js';
import { addRepoFolder, finishSetup, installGlobalSkills, resetSetup, setupState } from './setup.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
  } catch {
    throw new HttpError('Request body is not valid JSON', 400, 'INVALID_JSON');
  }
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function isLocalHost(hostHeader) {
  if (!hostHeader) return false;
  try {
    return LOCAL_HOSTNAMES.has(new URL(`http://${hostHeader}`).hostname);
  } catch {
    return false;
  }
}

function isLocalOrigin(origin) {
  try {
    const url = new URL(origin);
    return (url.protocol === 'http:' || url.protocol === 'https:') && LOCAL_HOSTNAMES.has(url.hostname);
  } catch {
    return false;
  }
}

/**
 * The API reads and writes the user's repo, so only the canvas itself may
 * call it. Two browser attacks matter for a server on localhost:
 *
 *   - DNS rebinding: evil.example re-resolves to 127.0.0.1 and reads the API
 *     as a same-origin page. Its requests still carry `Host: evil.example`,
 *     so anything whose Host isn't a loopback name is refused.
 *   - Cross-site requests: any page can fire a "simple" POST at localhost
 *     without a CORS preflight. Browsers attach `Origin` to those, so a
 *     foreign (or sandboxed `null`) Origin on an /api request is refused, and
 *     writes must be `application/json`, which a simple request can't send.
 *
 * Requests with no Origin at all (curl, the CLI, tests) are allowed: they
 * don't come from a web page, and the server only listens on loopback.
 */
function rejectForeignRequest(req, res, isApi) {
  if (!isLocalHost(req.headers.host)) {
    sendJson(res, 403, { error: 'Klose only answers requests addressed to localhost', code: 'FORBIDDEN_HOST' });
    return true;
  }
  if (!isApi) return false;
  const origin = req.headers.origin;
  if (origin !== undefined && !isLocalOrigin(origin)) {
    sendJson(res, 403, { error: 'Cross-origin requests to the Klose API are not allowed', code: 'FORBIDDEN_ORIGIN' });
    return true;
  }
  if ((req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT') &&
      !/^application\/json\b/i.test(req.headers['content-type'] || '')) {
    sendJson(res, 415, { error: 'Request body must be application/json', code: 'UNSUPPORTED_MEDIA_TYPE' });
    return true;
  }
  return false;
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function serveStatic(res, publicDir, urlPath) {
  const clean = urlPath.split('?')[0];
  let filePath = path.join(publicDir, clean === '/' ? 'index.html' : clean);
  try {
    const s = await stat(filePath);
    if (s.isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {
    filePath = path.join(publicDir, 'index.html');
  }
  const ext = path.extname(filePath);
  // Sandboxed preview documents have an opaque (`null`) origin. Module
  // scripts therefore require CORS even though both files came from this
  // local server. Static assets contain no repository data.
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Access-Control-Allow-Origin': '*',
  });
  createReadStream(filePath).pipe(res);
}

/**
 * Live-update channel for one repo: tells connected canvases when anything
 * under its .klose/projects/ changes (the agent's CLI writes there directly).
 * The folder may not exist yet — Klose creates it on the first sketch — so
 * until it does, this looks again every couple of seconds.
 */
function createRepoEvents(root) {
  const clients = new Set();
  let watcher = null;
  let retry = null;

  const notify = () => {
    for (const res of clients) res.write('event: update\ndata: {}\n\n');
  };
  const stop = () => {
    watcher?.close();
    watcher = null;
    if (retry) clearInterval(retry);
    retry = null;
  };
  const start = () => {
    if (watcher) return true;
    try {
      watcher = watch(store.projectsWatchDir(root), { persistent: false }, () => notify());
      watcher.on('error', () => {
        watcher = null;
        arm();
      });
      if (retry) clearInterval(retry);
      retry = null;
      return true;
    } catch {
      return false;
    }
  };
  function arm() {
    if (retry || watcher || !clients.size) return;
    retry = setInterval(() => {
      if (start()) notify();
    }, 2000);
    retry.unref();
  }

  return {
    close: stop,
    add(res) {
      clients.add(res);
      if (!start()) arm();
    },
    remove(res) {
      clients.delete(res);
      if (!clients.size) stop();
    },
  };
}

/**
 * One server, two shapes:
 *
 *   - for a single repo (`cwd`): the API lives at /api/…
 *   - as a hub (`hub: { claudeDir, home, … }`, see server/hub.js): the same API
 *     for every discovered repo at /api/repos/<id>/…, plus /api/repos to list
 *     them, /api/tray for the menu bar and /api/setup for first-run setup.
 */
export function createKloseServer({ cwd = process.cwd(), publicDir, version = null, hub = null } = {}) {
  const repoIndex = hub ? createRepoIndex(hub) : null;
  const events = new Map(); // root -> createRepoEvents(root)
  const eventsFor = (root) => {
    if (!events.has(root)) events.set(root, createRepoEvents(root));
    return events.get(root);
  };

  /**
   * The per-repo API. `parts` is the path after /api (or after
   * /api/repos/<id>). Resolves to false when nothing matched.
   */
  async function handleRepoApi(root, req, res, url, parts) {
    // What the canvas sees of a project: the stored record, with the save
    // bookkeeping replaced by its answer ("is the repo copy up to date?").
    const present = ({ savedToRepo, ...project }) => ({ ...project, repo: repoState(root, { ...project, savedToRepo }) });
    const only = (name) => parts[0] === name && parts.length === 1;

    // The repo's design tokens as Tailwind CSS, injected into every preview.
    if (only('theme') && req.method === 'GET') {
      sendJson(res, 200, await loadTheme(root, { force: url.searchParams.get('refresh') === '1' }));
      return true;
    }

    if (only('events')) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('\n');
      const channel = eventsFor(root);
      channel.add(res);
      req.on('close', () => channel.remove(res));
      return true;
    }

    if (only('feedback') && req.method === 'GET') {
      const projectId = url.searchParams.get('project') || undefined;
      const feedback = await store.listFeedback(root, { projectId, includeResolved: url.searchParams.get('all') === '1' });
      sendJson(res, 200, { count: feedback.length, feedback });
      return true;
    }

    // Repo component index — search & view the host repo's real components.
    if (only('components') && req.method === 'GET') {
      const data = await scanComponents(root, { force: url.searchParams.get('refresh') === '1' });
      const q = url.searchParams.get('q');
      const components = q ? filterComponents(data.components, q) : data.components;
      sendJson(res, 200, { ...data, count: components.length, components });
      return true;
    }
    if (parts[0] === 'component-source' && req.method === 'GET') {
      const file = url.searchParams.get('file');
      if (!file) sendJson(res, 400, { error: 'file query param required' });
      else sendJson(res, 200, await readComponentSource(root, file));
      return true;
    }

    if (parts[0] === 'projects') {
      const id = parts[1];
      const sub = parts[2]; // 'nodes' | 'export'
      const nodeId = parts[3];

      if (!id && req.method === 'GET') {
        // The list leaves out fields a save writes (context, design notes),
        // so each project is read in full to judge its repo copy.
        const projects = await store.listProjects(root);
        const repos = await Promise.all(
          projects.map(async (p) => repoState(root, await store.getProject(root, p.id)))
        );
        sendJson(res, 200, projects.map(({ savedToRepo, ...p }, i) => ({ ...p, repo: repos[i] })));
        return true;
      }
      if (!id && req.method === 'POST') {
        const body = await readBody(req);
        // "Try an example": the same live demo sketch `klose init` seeds.
        if (body.example === true) {
          const { project } = await store.seedDemoProject(root);
          sendJson(res, 201, present(await store.getProject(root, project.id)));
          return true;
        }
        sendJson(res, 201, await store.createProject(root, body.name));
        return true;
      }
      if (id && !sub && req.method === 'GET') {
        sendJson(res, 200, present(await store.getProject(root, id)));
        return true;
      }
      if (id && !sub && req.method === 'PATCH') {
        const { repo: _computed, ...body } = await readBody(req);
        sendJson(res, 200, present(await store.updateProject(root, id, body)));
        return true;
      }
      if (id && !sub && req.method === 'DELETE') {
        await store.deleteProject(root, id);
        sendJson(res, 200, { ok: true });
        return true;
      }
      // Save this project into the repo as files. The folder is never taken
      // from the request: it is the one recorded by the last save, or the
      // default under docs/klose/.
      if (id && sub === 'export' && !nodeId && req.method === 'POST') {
        const result = await exportProject(root, id);
        sendJson(res, 200, { dir: result.repo.dir, files: result.files, repo: result.repo });
        return true;
      }
      if (id && sub === 'nodes' && !nodeId && req.method === 'POST') {
        const body = await readBody(req);
        sendJson(res, 201, await store.addNode(root, id, body));
        return true;
      }
      if (id && sub === 'nodes' && nodeId && req.method === 'PATCH') {
        const body = await readBody(req);
        sendJson(res, 200, await store.updateNode(root, id, nodeId, body));
        return true;
      }
    }
    return false;
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    const isApi = parts[0] === 'api';

    if (rejectForeignRequest(req, res, isApi)) return;

    try {
      // `root` lets `klose status` tell this repo's server apart from one
      // another repo started on the same port; a hub has no root of its own.
      if (url.pathname === '/api/health') {
        return sendJson(res, 200, { ok: true, root: hub ? null : cwd, version, pid: process.pid, ...(hub ? { hub: true } : {}) });
      }

      if (isApi && hub) {
        // Everything the menu bar icon and its popover need, in one request.
        if (parts[1] === 'tray' && !parts[2] && req.method === 'GET') {
          return sendJson(res, 200, trayState(await listRepos(hub)));
        }
        // First-run setup (the /welcome page; see server/setup.js).
        if (parts[1] === 'setup') {
          const action = parts[2];
          if (!action && req.method === 'GET') return sendJson(res, 200, await setupState(hub));
          if (req.method === 'POST' && !parts[3]) {
            if (action === 'skills') {
              const report = await installGlobalSkills(hub);
              return sendJson(res, 200, { report, state: await setupState(hub) });
            }
            if (action === 'repos') {
              const { path: folder } = await readBody(req);
              const result = await addRepoFolder(hub, folder);
              return sendJson(res, 200, { ...result, state: await setupState(hub) });
            }
            if (action === 'finish') {
              const { menuBar, startAtLogin } = await readBody(req);
              return sendJson(res, 200, await finishSetup(hub, { menuBar, startAtLogin }));
            }
            if (action === 'reset') return sendJson(res, 200, await resetSetup(hub));
          }
          return sendJson(res, 404, { error: 'Not found' });
        }
        if (parts[1] !== 'repos') {
          return sendJson(res, 400, { error: 'This is a Klose hub: address a repo as /api/repos/<id>/…', code: 'REPO_REQUIRED' });
        }
        if (!parts[2]) {
          if (req.method !== 'GET') return sendJson(res, 404, { error: 'Not found' });
          return sendJson(res, 200, { repos: await listRepos(hub) });
        }
        const root = await repoIndex.resolve(parts[2]);
        if (!root) return sendJson(res, 404, { error: `No repo with id ${parts[2]}`, code: 'REPO_NOT_FOUND' });
        if (!parts[3]) {
          if (req.method !== 'GET') return sendJson(res, 404, { error: 'Not found' });
          return sendJson(res, 200, await repoIndex.describe(parts[2]));
        }
        if (await handleRepoApi(root, req, res, url, parts.slice(3))) return;
        return sendJson(res, 404, { error: 'Not found' });
      }

      if (isApi && (await handleRepoApi(cwd, req, res, url, parts.slice(1)))) return;

      if (req.method === 'GET' && publicDir) {
        return await serveStatic(res, publicDir, url.pathname);
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      // Client-fault errors (bad project id, out-of-tree file path) carry
      // their own status; anything else is ours and stays a 500.
      const status = typeof err.status === 'number' ? err.status : 500;
      const body = { error: err.message || 'Internal error' };
      if (err.code) body.code = err.code;
      sendJson(res, status, body);
    }
  });

  server.on('close', () => {
    for (const channel of events.values()) channel.close();
  });
  return server;
}
