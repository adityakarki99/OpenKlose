/**
 * Which build this is.
 *
 *   server  the canvas a `klose serve` / hub process serves: it talks to that
 *           process's API, which reads and writes .klose/ on disk.
 *   static  the hosted canvas (`npm run build:static`, deployed as a plain
 *           site): no process at all. The browser is given the repo folder
 *           and reads and writes .klose/ in it directly (lib/folderSession.ts).
 *
 * Decided at build time, so the hosted canvas never probes for a server and
 * the served canvas never asks for a folder.
 */
export const STATIC: boolean = import.meta.env.VITE_KLOSE_STATIC === '1';

/** Where the app's own files are served from: '/' on the server, '/<repo>/' on GitHub Pages. */
export const BASE_URL: string = import.meta.env.BASE_URL || '/';
