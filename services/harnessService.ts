import { API_BASE } from '../lib/repoScope';
import { STATIC } from '../lib/mode';
import { currentShare } from '../lib/shareSession';

/** What the repo's klose.config.json and klose.registry.ts say (server/harness.js). */
export interface HarnessInfo {
  config: { framework: 'expo' | 'vite'; devServer: string; harnessPath: string; providers?: string } | null;
  registry: string[];
  /** The repo's `harness` setting (server/settings.js): `off` means built cards show their sketch. */
  setting?: 'auto' | 'off';
  /** `env` when KLOSE_HARNESS decides it, so a change made here would not take effect. */
  settingSource?: 'env' | 'file' | 'default';
  /** Why klose.config.json could not be used, when it is there but invalid. */
  error?: string;
}

const NONE: HarnessInfo = { config: null, registry: [] };

/** True where a harness can exist at all: a canvas served next to the repo. */
export const HARNESS_AVAILABLE = (): boolean => !STATIC && !currentShare();
const TTL_MS = 5000;
let cached: { at: number; base: string; promise: Promise<HarnessInfo> } | null = null;

/**
 * The harness of the repo this canvas is showing, or "none". Only a canvas
 * served next to the repo has one: the hosted page and shared or online
 * canvases never reach the author's dev server. Cached briefly, because every
 * built card asks.
 */
export function getHarness(fresh = false): Promise<HarnessInfo> {
  if (!HARNESS_AVAILABLE()) return Promise.resolve(NONE);
  if (!fresh && cached && cached.base === API_BASE && Date.now() - cached.at < TTL_MS) return cached.promise;
  const promise = fetch(`${API_BASE}/harness`)
    .then((res) => (res.ok ? (res.json() as Promise<HarnessInfo>) : NONE))
    .catch(() => NONE);
  cached = { at: Date.now(), base: API_BASE, promise };
  return promise;
}

/** Turn the repo's harness on (`auto`) or off. Resolves to the harness as it now is. */
export async function setHarnessSetting(setting: 'auto' | 'off'): Promise<HarnessInfo> {
  const res = await fetch(`${API_BASE}/harness`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ setting }),
  });
  if (!res.ok) throw new Error(`Could not change the harness setting (${res.status})`);
  const info = (await res.json()) as HarnessInfo;
  cached = { at: Date.now(), base: API_BASE, promise: Promise.resolve(info) };
  return info;
}
