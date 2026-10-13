#!/usr/bin/env node
// Puts what the desktop app runs next to its Rust code, before every build:
//
//   src-tauri/binaries/node-<target-triple>[.exe]   the official Node.js binary
//                                                    (a Tauri "externalBin")
//   src-tauri/resources/klose/                       the klose package itself
//                                                    (bundled as klose-package/):
//                                                    bin/, server/, plugin/, web/dist/
//
// The app starts the hub as `node <resources>/klose-package/bin/klose.js hub`, so Klose
// runs exactly the code npm users run, and needs no Node on the machine.
// antiburn compiles its engine into the app binary; Klose's engine is Node,
// so it ships Node instead.
//
//   node scripts/prepare-sidecar.mjs [--target=<rust target triple>]
//
// The target defaults to this machine's (rustc -vV). Downloads are checked
// against nodejs.org's SHASUMS256.txt and cached in .cache/.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The Node the app ships. Keep it on an LTS line the klose package supports
// (package.json engines) and bump it with security releases.
const NODE_VERSION = 'v22.23.3';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(desktop, '..', '..');
const tauriDir = path.join(desktop, 'src-tauri');
const cacheDir = path.join(desktop, '.cache');

// Rust target triple -> how nodejs.org names that build.
const TARGETS = {
  'aarch64-apple-darwin': { dist: 'darwin-arm64', kind: 'tar' },
  'x86_64-apple-darwin': { dist: 'darwin-x64', kind: 'tar' },
  'x86_64-pc-windows-msvc': { dist: 'win-x64', kind: 'exe' },
  'aarch64-pc-windows-msvc': { dist: 'win-arm64', kind: 'exe' },
};

// This machine's target: rustc's answer if it's on the PATH, else read off
// the OS and CPU (only the targets above are buildable anyway).
function hostTriple() {
  const out = spawnSync('rustc', ['-vV'], { encoding: 'utf-8' });
  const match = out.stdout?.match(/^host:\s*(\S+)/m);
  if (match) return match[1];
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  if (process.platform === 'darwin') return `${arch}-apple-darwin`;
  if (process.platform === 'win32') return `${arch}-pc-windows-msvc`;
  throw new Error('could not tell the target; pass --target=<triple>');
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function cached(name, url) {
  const file = path.join(cacheDir, name);
  if (existsSync(file)) return readFileSync(file);
  console.log(`  downloading ${url}`);
  const data = await download(url);
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(file, data);
  return data;
}

async function prepareNode(triple) {
  const target = TARGETS[triple];
  if (!target) throw new Error(`no Node build known for ${triple}. Known: ${Object.keys(TARGETS).join(', ')}`);
  const base = `https://nodejs.org/dist/${NODE_VERSION}`;
  const sums = (await cached(`SHASUMS256-${NODE_VERSION}.txt`, `${base}/SHASUMS256.txt`)).toString('utf-8');

  // Windows publishes node.exe on its own; macOS only as a tarball.
  const remote = target.kind === 'exe' ? `${target.dist}/node.exe` : `node-${NODE_VERSION}-${target.dist}.tar.gz`;
  const expected = sums.split('\n').find((line) => line.trim().endsWith(`  ${remote}`))?.split(/\s+/)[0];
  if (!expected) throw new Error(`${remote} is not in SHASUMS256.txt for ${NODE_VERSION}`);
  const data = await cached(`${NODE_VERSION}-${remote.replace('/', '-')}`, `${base}/${remote}`);
  const actual = createHash('sha256').update(data).digest('hex');
  if (actual !== expected) {
    rmSync(path.join(cacheDir, `${NODE_VERSION}-${remote.replace('/', '-')}`), { force: true });
    throw new Error(`checksum mismatch for ${remote}: expected ${expected}, got ${actual}`);
  }

  const binDir = path.join(tauriDir, 'binaries');
  mkdirSync(binDir, { recursive: true });
  const dest = path.join(binDir, `node-${triple}${target.kind === 'exe' ? '.exe' : ''}`);
  if (target.kind === 'exe') {
    writeFileSync(dest, data);
  } else {
    const tarball = path.join(cacheDir, `${NODE_VERSION}-${remote}`);
    const member = `node-${NODE_VERSION}-${target.dist}/bin/node`;
    const out = path.join(cacheDir, `extract-${target.dist}`);
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    const result = spawnSync('tar', ['-xzf', tarball, '-C', out, member], { encoding: 'utf-8' });
    if (result.status !== 0) throw new Error(`could not extract node from ${tarball}: ${result.stderr}`);
    cpSync(path.join(out, member), dest);
    chmodSync(dest, 0o755);
  }
  console.log(`  ✓ node ${NODE_VERSION} → ${path.relative(desktop, dest)}`);
}

// The parts of the klose package the hub needs. Same list as package.json
// "files", minus the macOS menu bar app's source: the desktop app replaces it.
function prepareKlose() {
  if (!existsSync(path.join(repoRoot, 'web', 'dist', 'index.html'))) {
    throw new Error('the canvas UI is not built. Run "npm run build" in the repo root first.');
  }
  const dest = path.join(tauriDir, 'resources', 'klose');
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(path.join(dest, 'bin'), { recursive: true });
  cpSync(path.join(repoRoot, 'package.json'), path.join(dest, 'package.json'));
  cpSync(path.join(repoRoot, 'bin', 'klose.js'), path.join(dest, 'bin', 'klose.js'));
  for (const dir of ['server', 'plugin', path.join('web', 'dist')]) {
    cpSync(path.join(repoRoot, dir), path.join(dest, dir), { recursive: true });
  }
  const version = JSON.parse(readFileSync(path.join(dest, 'package.json'), 'utf-8')).version;
  console.log(`  ✓ klose ${version} → ${path.relative(desktop, dest)}`);
}

const targetArg = process.argv.find((a) => a.startsWith('--target='));
try {
  const triple = targetArg ? targetArg.slice('--target='.length) : process.env.KLOSE_TARGET || hostTriple();
  console.log(`Preparing the Klose desktop app for ${triple}`);
  await prepareNode(triple);
  prepareKlose();
} catch (err) {
  console.error(`prepare-sidecar: ${err.message}`);
  process.exit(1);
}
