// Per-repo settings: `.klose/settings.json`. Unlike server.json or canvas.json
// this is a decision the team shares, so `.klose/.gitignore` does not list it.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const SETTINGS_FILE = '.klose/settings.json';

/** `auto`: Klose sets the component harness up and uses it. `off`: it does neither. */
export const HARNESS_SETTINGS = ['auto', 'off'];
/**
 * `real`: with a harness in use, a sketch is also written into the repo and
 * drawn by the repo's own bundler, so it can import real components.
 * `sandbox`: sketches are only ever drawn in the sandbox, from their `code`.
 */
export const SKETCH_SETTINGS = ['real', 'sandbox'];
export const DEFAULT_SETTINGS = { harness: 'auto', sketches: 'real' };

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
  return {
    harness: HARNESS_SETTINGS.includes(raw.harness) ? raw.harness : DEFAULT_SETTINGS.harness,
    sketches: SKETCH_SETTINGS.includes(raw.sketches) ? raw.sketches : DEFAULT_SETTINGS.sketches,
  };
}

/** Merge `patch` into the settings file. Keys this version doesn't know are kept. */
export async function writeSettings(root, patch) {
  if ('harness' in patch && !HARNESS_SETTINGS.includes(patch.harness)) {
    throw new Error(`harness must be one of: ${HARNESS_SETTINGS.join(', ')}`);
  }
  if ('sketches' in patch && !SKETCH_SETTINGS.includes(patch.sketches)) {
    throw new Error(`sketches must be one of: ${SKETCH_SETTINGS.join(', ')}`);
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

/** The sketches setting in force: `KLOSE_SKETCHES=real|sandbox` wins over the file. */
export async function sketchSetting(root, env = process.env) {
  const fromEnv = String(env.KLOSE_SKETCHES || '').trim().toLowerCase();
  if (SKETCH_SETTINGS.includes(fromEnv)) return { value: fromEnv, source: 'env' };
  const raw = await readRaw(root);
  if (SKETCH_SETTINGS.includes(raw.sketches)) return { value: raw.sketches, source: 'file' };
  return { value: DEFAULT_SETTINGS.sketches, source: 'default' };
}
