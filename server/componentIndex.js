import { scanComponents } from './scanner.js';
import { JEV_DEFAULT_BASE_URL, JevError, rankComponents } from './jev.js';
import { annotate, classificationPath, classifyComponents, findDuplicates, readClassifications, writeClassifications } from './classify.js';
import { repoId } from './hub.js';

/**
 * The component index as the canvas and CLI use it: what the scanner found,
 * plus whatever Jev has said about it (server/classify.js), plus search by
 * meaning — in one repo or across every repo the hub knows.
 */

/** Jev settings from the environment Klose was started in. */
export function jevFromEnv(env = process.env) {
  return { apiKey: env.TYPESAFE_API_KEY || '', baseUrl: env.TYPESAFE_BASE_URL || JEV_DEFAULT_BASE_URL };
}

function cacheFile(home, root) {
  return classificationPath(home, repoId(root));
}

/** Scan + cached classifications + duplicate hints. Never calls Jev. */
export async function enrichedIndex(root, { home, force = false } = {}) {
  const data = await scanComponents(root, { force });
  const entries = await readClassifications(cacheFile(home, root));
  const components = annotate(data.components, entries);
  return {
    ...data,
    components,
    classified: components.filter((c) => c.role).length,
    duplicates: findDuplicates(components),
  };
}

// One run per repo at a time: a second request (another tab, the CLI) waits
// for the first instead of paying for the same answers twice.
const running = new Map();

/**
 * Classifies the repo's components that aren't cached yet, and saves the
 * answers. Resolves to classifyComponents' summary.
 */
export function classifyRepo(root, { home, jev, onProgress } = {}) {
  if (!jev?.apiKey) return Promise.reject(new JevError('TYPESAFE_API_KEY is not set'));
  if (running.has(root)) return running.get(root);
  const run = (async () => {
    const { components } = await scanComponents(root, { force: true });
    const file = cacheFile(home, root);
    const entries = await readClassifications(file);
    const summary = await classifyComponents(components, entries, { ...jev, onProgress });
    await writeClassifications(file, entries, components);
    return summary;
  })().finally(() => running.delete(root));
  running.set(root, run);
  return run;
}

/**
 * "Does anything, in any of these repos, already do this?" — one Jev ranking
 * over the merged index. `repos` is [{ id, name, root }]. Each ranked
 * component carries its `repo`, and an id that stays unique across repos.
 */
export async function rankAcrossRepos(repos, query, { jev, fetchImpl } = {}) {
  const indexes = await Promise.all(
    repos.map(async (repo) => {
      try {
        return { repo, components: (await scanComponents(repo.root)).components };
      } catch {
        return { repo, components: [] };
      }
    })
  );
  const merged = indexes.flatMap(({ repo, components }) =>
    components.map((c) => ({ ...c, id: `${repo.id}:${c.id}`, repo: { id: repo.id, name: repo.name } }))
  );
  return rankComponents(merged, query, { ...jev, ...(fetchImpl ? { fetchImpl } : {}) });
}
