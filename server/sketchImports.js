// What a sketch's code imports, read off its text. Shared by the canvas (to
// say honestly when the sandbox can't draw a sketch) and the server (to point
// a sketch's repo-relative imports at the right place once it is a file).
// Pure and browser-safe; the canvas reaches it through lib/sketchImports.js.

/** The modules the sandbox can hand a sketch (preview-runtime.tsx). Anything else only resolves in the app. */
export const SANDBOX_MODULES = ['react', 'lucide-react', 'recharts'];

// import x from 'm' · import 'm' · export … from 'm' · import('m') · require('m')
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*|\brequire\s*\(\s*)(["'])([^"'\n]+)\2/g;

/** Every module specifier in `code`, in order, without duplicates. */
export function importSpecifiers(code) {
  const found = [];
  for (const m of String(code || '').matchAll(SPECIFIER)) if (!found.includes(m[3])) found.push(m[3]);
  return found;
}

/**
 * The imports of `code` the sandbox can't satisfy: the repo's own modules
 * (`./src/Button`, `@/components/ui/button`) and packages it doesn't carry.
 * A sketch with any of these only renders through the repo's bundler.
 */
export function repoImports(code) {
  return importSpecifiers(code).filter((spec) => !SANDBOX_MODULES.includes(spec));
}

/**
 * `code` with every `./…` specifier rewritten by `rewrite(spec)`. A sketch
 * names repo files from the repo root (`./src/components/Button`), wherever
 * the file it ends up in lives.
 */
export function mapRelativeImports(code, rewrite) {
  return String(code || '').replace(SPECIFIER, (all, lead, quote, spec) => (spec.startsWith('./') ? `${lead}${quote}${rewrite(spec)}${quote}` : all));
}
