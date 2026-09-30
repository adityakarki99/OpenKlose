import { open, readdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Finds out where coding agents are working on this machine, by reading what
 * Claude Code already writes to disk — no hook into the agent, nothing
 * installed in any repo:
 *
 *   ~/.claude/sessions/<pid>.json          one per running session: its cwd,
 *                                          whether it is busy or idle, its name
 *   ~/.claude/projects/<cwd>/<id>.jsonl    transcripts; the newest one's
 *                                          mtime says when a folder was last used
 *
 * Everything here is read-only and best-effort: these files belong to another
 * program and their shape can change, so anything unreadable is skipped
 * rather than reported.
 */

export function claudeHome() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

/** Whether a process with this pid exists (it may belong to another user). */
export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/**
 * Sessions whose process is still running. A crashed session leaves its file
 * behind, so the pid is checked rather than trusting the file.
 * Resolves to [{ id, pid, cwd, status: 'working' | 'idle', name, updatedAt }].
 */
export async function readLiveSessions(claudeDir = claudeHome()) {
  const dir = path.join(claudeDir, 'sessions');
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const sessions = await Promise.all(
    names.filter((n) => n.endsWith('.json')).map(async (n) => {
      try {
        const s = JSON.parse(await readFile(path.join(dir, n), 'utf-8'));
        if (typeof s.cwd !== 'string' || !s.cwd || !isAlive(s.pid)) return null;
        return {
          id: String(s.sessionId || s.pid),
          pid: s.pid,
          cwd: s.cwd,
          // Only an explicit "busy" counts as working; anything else (idle,
          // or a state added later) is shown as idle rather than guessed at.
          status: s.status === 'busy' ? 'working' : 'idle',
          name: typeof s.name === 'string' && s.name ? s.name : null,
          updatedAt: Number(s.statusUpdatedAt || s.updatedAt || s.startedAt) || 0,
        };
      } catch {
        return null;
      }
    })
  );
  return sessions.filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt);
}

const HEAD_BYTES = 64 * 1024;
const RECENT_TTL_MS = 60 * 1000;
const recentCache = new Map(); // claudeDir -> { at, data }

// The transcript folder name is the cwd with every separator turned into "-",
// which can't be turned back into a path; the transcript itself records it.
async function cwdOfTranscript(file) {
  let handle;
  try {
    handle = await open(file, 'r');
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(HEAD_BYTES), 0, HEAD_BYTES, 0);
    const match = buffer.toString('utf-8', 0, bytesRead).match(/"cwd":"((?:[^"\\]|\\.)*)"/);
    return match ? JSON.parse(`"${match[1]}"`) : null;
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

/**
 * Folders an agent was used in recently, newest first, whether or not a
 * session is still open there. Resolves to [{ cwd, at }]. Cached for a minute:
 * it stats every transcript folder.
 */
export async function readRecentCwds(claudeDir = claudeHome(), { days = 14, limit = 40, force = false } = {}) {
  const cached = recentCache.get(claudeDir);
  if (!force && cached && Date.now() - cached.at < RECENT_TTL_MS) return cached.data;

  const dir = path.join(claudeDir, 'projects');
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let folders = [];
  try {
    folders = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory());
  } catch {
    // No transcripts on this machine.
  }

  const newest = await Promise.all(
    folders.map(async (folder) => {
      try {
        const folderPath = path.join(dir, folder.name);
        const files = (await readdir(folderPath)).filter((f) => f.endsWith('.jsonl'));
        let best = null;
        for (const f of files) {
          const { mtimeMs } = await stat(path.join(folderPath, f));
          if (!best || mtimeMs > best.at) best = { file: path.join(folderPath, f), at: mtimeMs };
        }
        return best && best.at >= cutoff ? best : null;
      } catch {
        return null;
      }
    })
  );

  const data = [];
  for (const t of newest.filter(Boolean).sort((a, b) => b.at - a.at).slice(0, limit)) {
    const cwd = await cwdOfTranscript(t.file);
    if (cwd) data.push({ cwd, at: t.at });
  }
  recentCache.set(claudeDir, { at: Date.now(), data });
  return data;
}
