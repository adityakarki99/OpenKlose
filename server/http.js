import { createServer } from 'node:http';
import { watch } from 'node:fs';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import * as store from './store.js';
import { scanComponents, filterComponents, readComponentSource } from './scanner.js';

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
  return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
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
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
}

export function createKloseServer({ cwd = process.cwd(), publicDir } = {}) {
  const sseClients = new Set();

  const notify = () => {
    for (const res of sseClients) res.write('event: update\ndata: {}\n\n');
  };

  try {
    watch(store.projectsWatchDir(cwd), { persistent: false }, () => notify());
  } catch {
    // Directory may not exist yet; created lazily on first write.
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);

    try {
      if (url.pathname === '/api/health') {
        return sendJson(res, 200, { ok: true });
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
        const sub = parts[3]; // 'nodes'
        const nodeId = parts[4];

        if (!id && req.method === 'GET') {
          return sendJson(res, 200, await store.listProjects(cwd));
        }
        if (!id && req.method === 'POST') {
          const body = await readBody(req);
          return sendJson(res, 201, await store.createProject(cwd, body.name));
        }
        if (id && !sub && req.method === 'GET') {
          return sendJson(res, 200, await store.getProject(cwd, id));
        }
        if (id && !sub && req.method === 'PATCH') {
          const body = await readBody(req);
          return sendJson(res, 200, await store.updateProject(cwd, id, body));
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
      const status = err.message && err.message.startsWith('Invalid project id') ? 400 : 500;
      sendJson(res, status, { error: err.message || 'Internal error' });
    }
  });

  return server;
}
