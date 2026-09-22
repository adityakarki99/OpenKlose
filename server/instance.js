import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';

/**
 * Bookkeeping for "is this repo's canvas running, and where?".
 *
 * A running `klose serve` writes `.klose/server.json` ({ pid, port, url, root })
 * and removes it on exit. The file alone isn't trusted — a crash leaves it
 * behind — so every answer is confirmed against the live server's
 * `/api/health`, whose `root` must be this repo. That is also what stops a
 * Klose server started from another repo on the same port from passing for
 * this one.
 */

export const DEFAULT_PORT = 5171;

export function serverInfoPath(root) {
  return path.join(root, '.klose', 'server.json');
}

export async function readServerInfo(root) {
  try {
    return JSON.parse(await readFile(serverInfoPath(root), 'utf-8'));
  } catch {
    return null;
  }
}

export async function writeServerInfo(root, info) {
  await mkdir(path.dirname(serverInfoPath(root)), { recursive: true });
  await writeFile(serverInfoPath(root), JSON.stringify(info, null, 2) + '\n', 'utf-8');
}

/**
 * Removes server.json, but only if it still describes process `pid` — a newer
 * server may have replaced it. Synchronous because it runs in an exit handler.
 */
export function removeServerInfoSync(root, pid) {
  try {
    const info = JSON.parse(readFileSync(serverInfoPath(root), 'utf-8'));
    if (info.pid === pid) unlinkSync(serverInfoPath(root));
  } catch {
    // Already gone, or never written.
  }
}

export async function removeServerInfo(root) {
  try {
    await unlink(serverInfoPath(root));
  } catch {
    // Already gone.
  }
}

/** Human-facing URL. Probes below use 127.0.0.1, which is what we bind. */
export function displayUrl(port) {
  return `http://localhost:${port}`;
}

/** Returns the server's health payload on `port`, or null if nothing answers. */
export async function probe(port, timeoutMs = 1000) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const body = await res.json();
    return body && body.ok ? body : null;
  } catch {
    return null;
  }
}

/**
 * Looks for this repo's server: first on the port server.json names, then on
 * `fallbackPort`. Resolves to one of
 *   { state: 'running', port, url, pid, version }
 *   { state: 'other', port, url, otherRoot }   — a different repo's Klose
 *   { state: 'stopped', port, url }
 */
export async function findServer(root, fallbackPort = DEFAULT_PORT) {
  const info = await readServerInfo(root);
  const ports = [...new Set([info?.port, fallbackPort].filter((p) => Number.isInteger(p)))];
  let other = null;
  for (const port of ports) {
    const health = await probe(port);
    if (!health) continue;
    if (health.root === root) {
      return { state: 'running', port, url: displayUrl(port), pid: health.pid, version: health.version };
    }
    other ??= { state: 'other', port, url: displayUrl(port), otherRoot: health.root };
  }
  const port = ports[0] ?? fallbackPort;
  return other ?? { state: 'stopped', port, url: displayUrl(port) };
}
