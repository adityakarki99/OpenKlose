import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Finds the directory Klose should treat as "the repo" for a command run from
 * `cwd`: the nearest ancestor (or `cwd` itself) that holds a `.klose/` or a
 * `.git`, whichever comes first.
 *
 * Without this, running `klose` from `src/components/` quietly created a second
 * `.klose/` there and scanned only that folder. Nearest-wins keeps monorepos
 * working: a package with its own `.klose/` is found before the repo's `.git`.
 * The walk never climbs above the home directory, so a stray `~/.klose` can't
 * capture every unrelated folder on the machine.
 */
export function resolveRoot(cwd = process.cwd()) {
  const start = path.resolve(cwd);
  const home = os.homedir();
  let dir = start;
  while (true) {
    // Home itself only counts when that's where the command ran — a dotfiles
    // repo at ~/.git must not swallow every project folder below it.
    if (dir === home && start !== home) return start;
    if (existsSync(path.join(dir, '.klose')) || existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}
