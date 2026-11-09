import { API_BASE } from '../lib/repoScope';
import { STATIC } from '../lib/mode';
import { currentShare } from '../lib/shareSession';

/** What the repo's klose.config.json and klose.registry.ts say (server/harness.js). */
export interface HarnessInfo {
  config: { framework: 'expo' | 'vite'; devServer: string; harnessPath: string; providers?: string } | null;
  registry: string[];
}

const NONE: HarnessInfo = { config: null, registry: [] };
const TTL_MS = 5000;
let cached: { at: number; base: string; promise: Promise<HarnessInfo> } | null = null;

/**
 * The harness of the repo this canvas is showing, or "none". Only a canvas
 * served next to the repo has one: the hosted page and shared or online
 * canvases never reach the author's dev server. Cached briefly, because every
 * built card asks.
 */
export function getHarness(): Promise<HarnessInfo> {
  if (STATIC || currentShare()) return Promise.resolve(NONE);
  if (cached && cached.base === API_BASE && Date.now() - cached.at < TTL_MS) return cached.promise;
  const promise = fetch(`${API_BASE}/harness`)
    .then((res) => (res.ok ? (res.json() as Promise<HarnessInfo>) : NONE))
    .catch(() => NONE);
  cached = { at: Date.now(), base: API_BASE, promise };
  return promise;
}
