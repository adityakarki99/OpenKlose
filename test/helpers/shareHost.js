/**
 * A share host in memory, for tests: the API server/shareCore.js talks to
 * (and what the Klose site's api/share functions implement over Vercel
 * Blob). Stores payloads as given, never looks inside them.
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { isPayload, isShareId, newShareId } from '../../server/shareCore.js';

export function createShareHost() {
  const blobs = new Map();
  const log = [];

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', ...headers });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (chunk) => (data += chunk));
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch (err) {
          reject(err);
        }
      });
      req.on('error', reject);
    });

  /** Answers one request, or returns false when the URL isn't the share API (so a static server can mount it). */
  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const m = /^\/api\/share(?:\/([^/]+))?\/?$/.exec(url.pathname);
    if (!m) return false;
    log.push(`${req.method} ${url.pathname}`);
    if (req.method === 'OPTIONS') return send(res, 204, undefined, { 'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS', 'Access-Control-Allow-Headers': '*' });
    const id = m[1];
    try {
      if (!id && req.method === 'POST') {
        const { payload } = await readBody(req);
        if (!isPayload(payload)) return send(res, 400, { error: 'bad payload' });
        const newId = newShareId();
        const etag = `"${randomUUID()}"`;
        blobs.set(newId, { etag, payload, updatedAt: new Date().toISOString() });
        return send(res, 201, { id: newId, etag });
      }
      if (!id || !isShareId(id)) return send(res, 404, { error: 'not found' });
      const blob = blobs.get(id);
      if (!blob) return send(res, 404, { error: 'no such share' });
      if (req.method === 'GET') {
        if (req.headers['if-none-match'] === blob.etag) return send(res, 304, undefined);
        return send(res, 200, { id, etag: blob.etag, payload: blob.payload, updatedAt: blob.updatedAt }, { ETag: blob.etag });
      }
      if (req.method === 'PUT') {
        const { payload } = await readBody(req);
        if (!isPayload(payload)) return send(res, 400, { error: 'bad payload' });
        const ifMatch = req.headers['if-match'];
        if (ifMatch && ifMatch !== blob.etag) return send(res, 412, { error: 'the share changed', etag: blob.etag, payload: blob.payload });
        blob.etag = `"${randomUUID()}"`;
        blob.payload = payload;
        blob.updatedAt = new Date().toISOString();
        return send(res, 200, { etag: blob.etag }, { ETag: blob.etag });
      }
      return send(res, 405, { error: 'method not allowed' });
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  };

  const server = createServer(async (req, res) => {
    if ((await handler(req, res)) === false) send(res, 404, { error: 'not found' });
  });

  return {
    blobs,
    log,
    handler,
    async listen() {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      return `http://127.0.0.1:${server.address().port}`;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
