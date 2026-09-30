import { createServer } from 'node:http';
import { mkdirSync, watch } from 'node:fs';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import * as store from './store.js';
import { scanComponents, filterComponents, readComponentSource } from './scanner.js';
import { loadTheme } from './theme.js';
import { exportProject, repoState } from './export.js';
import { HttpError } from './errors.js';

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

export function createKloseServer({ cwd = process.cwd(), publicDir, version = null } = {}) {
  const sseClients = new Set();

  // What the canvas sees of a project: the stored record, with the save
  // bookkeeping replaced by its answer ("is the repo copy up to date?").
  const present = ({ savedToRepo, ...project }) => ({ ...project, repo: repoState(cwd, { ...project, savedToRepo }) });

  const notify = () => {
    for (const res of sseClients) res.write('event: update\ndata: {}\n\n');
  };

  // Every write to a project (this server's, or the agent's CLI) lands in this
  // folder, so watching it is how open canvases hear about changes. It has to
  // exist first: watching a missing folder fails, and nothing retried, so a repo
  // whose first project was created after `serve` never got live updates.
  let watcher = null;
  try {
    mkdirSync(store.projectsWatchDir(cwd), { recursive: true });
    watcher = watch(store.projectsWatchDir(cwd), { persistent: false }, () => notify());
  } catch {
    // Unwritable repo: the canvas still works, just without live updates.
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);

    if (rejectForeignRequest(req, res, parts[0] === 'api')) return;

    try {
      // `root` lets `klose status` tell this repo's server apart from one
      // another repo started on the same port.
      if (url.pathname === '/api/health') {
        return sendJson(res, 200, { ok: true, root: cwd, version, pid: process.pid });
      }

      // The repo's design tokens as Tailwind CSS, injected into every preview.
      if (url.pathname === '/api/theme' && req.method === 'GET') {
        return sendJson(res, 200, await loadTheme(cwd, { force: url.searchParams.get('refresh') === '1' }));
      }

      if (url.pathname === '/api/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write('\n');
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
      }

      if (url.pathname === '/api/feedback' && req.method === 'GET') {
        const projectId = url.searchParams.get('project') || undefined;
        const feedback = await store.listFeedback(cwd, { projectId, includeResolved: url.searchParams.get('all') === '1' });
        return sendJson(res, 200, { count: feedback.length, feedback });
      }

      // Repo component index — search & view the host repo's real components.
      if (parts[0] === 'api' && parts[1] === 'components' && !parts[2] && req.method === 'GET') {
        const data = await scanComponents(cwd, { force: url.searchParams.get('refresh') === '1' });
        const q = url.searchParams.get('q');
        const components = q ? filterComponents(data.components, q) : data.components;
        return sendJson(res, 200, { ...data, count: components.length, components });
      }
      if (parts[0] === 'api' && parts[1] === 'component-source' && req.method === 'GET') {
        const file = url.searchParams.get('file');
        if (!file) return sendJson(res, 400, { error: 'file query param required' });
        return sendJson(res, 200, await readComponentSource(cwd, file));
      }

      if (parts[0] === 'api' && parts[1] === 'projects') {
        const id = parts[2];
        const sub = parts[3]; // 'nodes' | 'export'
        const nodeId = parts[4];

        if (!id && req.method === 'GET') {
          // The list leaves out fields a save writes (context, design notes),
          // so each project is read in full to judge its repo copy.
          const projects = await store.listProjects(cwd);
          const repos = await Promise.all(
            projects.map(async (p) => repoState(cwd, await store.getProject(cwd, p.id)))
          );
          return sendJson(res, 200, projects.map(({ savedToRepo, ...p }, i) => ({ ...p, repo: repos[i] })));
        }
        if (!id && req.method === 'POST') {
          const body = await readBody(req);
          // "Try an example": the same live demo sketch `klose init` seeds.
          if (body.example === true) {
            const { project } = await store.seedDemoProject(cwd);
            return sendJson(res, 201, present(await store.getProject(cwd, project.id)));
          }
          return sendJson(res, 201, await store.createProject(cwd, body.name));
        }
        if (id && !sub && req.method === 'GET') {
          return sendJson(res, 200, present(await store.getProject(cwd, id)));
        }
        if (id && !sub && req.method === 'PATCH') {
          const { repo: _computed, ...body } = await readBody(req);
          return sendJson(res, 200, present(await store.updateProject(cwd, id, body)));
        }
        // Save this project into the repo as files. The folder is never taken
        // from the request: it is the one recorded by the last save, or the
        // default under docs/klose/.
        if (id && sub === 'export' && !nodeId && req.method === 'POST') {
          const result = await exportProject(cwd, id);
          return sendJson(res, 200, { dir: result.repo.dir, files: result.files, repo: result.repo });
        }
        if (id && !sub && req.method === 'DELETE') {
          await store.deleteProject(cwd, id);
          return sendJson(res, 200, { ok: true });
        }
        if (id && sub === 'nodes' && !nodeId && req.method === 'POST') {
          const body = await readBody(req);
          return sendJson(res, 201, await store.addNode(cwd, id, body));
        }
        if (id && sub === 'nodes' && nodeId && req.method === 'PATCH') {
          const body = await readBody(req);
          return sendJson(res, 200, await store.updateNode(cwd, id, nodeId, body));
        }
      }

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

  server.on('close', () => watcher?.close());
  return server;
}
