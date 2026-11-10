// Per-repo settings: `.klose/settings.json`. Unlike server.json or canvas.json
// this is a decision the team shares, so `.klose/.gitignore` does not list it.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const SETTINGS_FILE = '.klose/settings.json';

/** `auto`: Klose sets the component harness up and uses it. `off`: it does neither. */
export const HARNESS_SETTINGS = ['auto', 'off'];
export const DEFAULT_SETTINGS = { harness: 'auto' };

const file = (root) => path.join(root, SETTINGS_FILE);

async function readRaw(root) {
  try {
    const raw = JSON.parse(await readFile(file(root), 'utf-8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    // Missing or unreadable: the defaults apply.
    return {};
  }
}

/** The repo's settings, with defaults for anything missing or invalid. */
export async function readSettings(root) {
  const raw = await readRaw(root);
  return { harness: HARNESS_SETTINGS.includes(raw.harness) ? raw.harness : DEFAULT_SETTINGS.harness };
}

/** Merge `patch` into the settings file. Keys this version doesn't know are kept. */
export async function writeSettings(root, patch) {
  if ('harness' in patch && !HARNESS_SETTINGS.includes(patch.harness)) {
    throw new Error(`harness must be one of: ${HARNESS_SETTINGS.join(', ')}`);
  }
  const next = { ...(await readRaw(root)), ...patch };
  await mkdir(path.dirname(file(root)), { recursive: true });
  await writeFile(file(root), JSON.stringify(next, null, 2) + '\n');
  return readSettings(root);
}

/**
 * The harness setting in force: `KLOSE_HARNESS=off|auto` wins over the file.
 * `source` says where it came from, so a UI can tell when a toggle can't win.
 */
export async function harnessSetting(root, env = process.env) {
  const fromEnv = String(env.KLOSE_HARNESS || '').trim().toLowerCase();
  if (HARNESS_SETTINGS.includes(fromEnv)) return { value: fromEnv, source: 'env' };
  const raw = await readRaw(root);
  if (HARNESS_SETTINGS.includes(raw.harness)) return { value: raw.harness, source: 'file' };
  return { value: DEFAULT_SETTINGS.harness, source: 'default' };
}
