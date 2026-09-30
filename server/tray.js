import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { kloseHome } from './hub.js';
import { isAlive } from './sessions.js';

/**
 * The menu bar app (bin/tray/KloseTray.m) ships as source and is compiled on
 * the machine that runs it, the first time `klose tray` is used — a few
 * seconds with clang. That keeps the npm package free of prebuilt binaries,
 * at the cost of needing Apple's command line tools and being macOS-only for
 * now. It is Objective-C rather than Swift because clang builds it against
 * whatever SDK is installed, where a Swift compiler refuses an SDK that was
 * built by a slightly different Swift.
 *
 * The binary's name carries the package version and a hash of the source, so
 * an upgrade (or an edit while developing) builds a new one instead of
 * running a stale copy.
 */

export function traySource(packageRoot) {
  return path.join(packageRoot, 'bin', 'tray', 'KloseTray.m');
}

export function trayBinary(packageRoot, version, home = kloseHome()) {
  const hash = createHash('sha256').update(readFileSync(traySource(packageRoot))).digest('hex').slice(0, 8);
  return path.join(home, 'tray', `klose-tray-${version}-${hash}`);
}

/** Whether Apple's command line tools (and so clang and the macOS SDK) are installed. */
export function hasClang() {
  if (process.platform !== 'darwin') return false;
  const found = spawnSync('xcrun', ['--find', 'clang'], { encoding: 'utf-8' });
  return found.status === 0 && existsSync(found.stdout.trim());
}

/**
 * Compiles the menu bar app unless this version is already built. Resolves to
 * { binary, built }; throws with the compiler's output if the build fails.
 */
export async function buildTray(packageRoot, version, home = kloseHome()) {
  const binary = trayBinary(packageRoot, version, home);
  if (existsSync(binary)) return { binary, built: false };
  if (!hasClang()) {
    throw new Error("building the menu bar app needs Apple's command line tools. Install them with: xcode-select --install");
  }
  await mkdir(path.dirname(binary), { recursive: true });
  // Through xcrun, not the compiler directly: xcrun is what points clang at the SDK.
  const result = spawnSync(
    'xcrun',
    ['clang', '-fobjc-arc', '-O2', '-framework', 'Cocoa', '-framework', 'WebKit', '-o', binary, traySource(packageRoot)],
    { encoding: 'utf-8' }
  );
  if (result.status !== 0) {
    throw new Error(`the menu bar app failed to build:\n${(result.stderr || result.stdout || '').trim()}`);
  }
  return { binary, built: true };
}

// ------------------------------------------------------ is the tray running?

function trayInfoPath(home) {
  return path.join(home, 'tray.json');
}

/** Resolves to { state: 'running', pid } or { state: 'stopped' }. The app writes tray.json itself. */
export async function findTray(home = kloseHome()) {
  try {
    const info = JSON.parse(await readFile(trayInfoPath(home), 'utf-8'));
    if (isAlive(info.pid)) return { state: 'running', pid: info.pid };
  } catch {
    // Never started, or the file is gone.
  }
  return { state: 'stopped' };
}

export async function removeTrayInfo(home = kloseHome()) {
  try {
    await unlink(trayInfoPath(home));
  } catch {
    // Already gone.
  }
}
