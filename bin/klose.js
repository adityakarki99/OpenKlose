#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdir, copyFile, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import * as store from '../server/store.js';
import { createKloseServer } from '../server/http.js';
import { scanComponents, filterComponents } from '../server/scanner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.join(__dirname, '..');
const cwd = process.cwd();

function printJson(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

function fail(message) {
  process.stderr.write(`klose: ${message}\n`);
  process.exit(1);
}

// Accepts either inline JSON or, prefixed with '@', a path to a JSON file to
// read instead (e.g. `@/tmp/node.json`). Multi-line fields like `code` are
// painful and easy to mis-escape as a shell argument — write them to a file
// and pass `@path` instead.
async function parseJsonArg(value) {
  if (value.startsWith('@')) {
    const filePath = path.resolve(cwd, value.slice(1));
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  }
  return JSON.parse(value);
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(cmd, [url], { detached: true, stdio: 'ignore', shell: process.platform === 'win32' }).unref();
  } catch {
    // Best-effort only — printing the URL is enough if this fails.
  }
}

// Copies every skill directory (klose, klose-update, klose-cleanup, ...) that
// ships with the given package root into this repo's .claude/skills/. Shared
// between `init` (first install) and `update` (refresh after a version bump),
// so a new or changed SKILL.md always ends up in the same place.
async function copySkillFiles(fromPackageRoot, targetCwd) {
  const skillsRoot = path.join(fromPackageRoot, 'skills');
  const entries = await readdir(skillsRoot, { withFileTypes: true });
  const copied = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const srcFile = path.join(skillsRoot, entry.name, 'SKILL.md');
    if (!existsSync(srcFile)) continue;
    const destDir = path.join(targetCwd, '.claude', 'skills', entry.name);
    await mkdir(destDir, { recursive: true });
    await copyFile(srcFile, path.join(destDir, 'SKILL.md'));
    copied.push(entry.name);
  }
  return copied;
}

const CLAUDE_MD_MARKER = '<!-- klose:workflow -->';

// Opt-in (`--wire-claude-md`) because editing the user's CLAUDE.md is more
// invasive than dropping a skill file. Idempotent: re-running `init` won't
// duplicate the section, and an existing mention of Klose is left alone.
async function wireClaudeMd(targetCwd) {
  const claudeMdPath = path.join(targetCwd, 'CLAUDE.md');
  let existing = '';
  try {
    existing = await readFile(claudeMdPath, 'utf-8');
  } catch {
    // No CLAUDE.md yet — we'll create one.
  }

  if (existing.includes(CLAUDE_MD_MARKER)) return false;

  const section = `${CLAUDE_MD_MARKER}
## Design ideation

This repo has Klose installed (\`.claude/skills/klose/\`) — a local canvas for sketching UI ideas
against the project's real design system before building them for real. Reach for \`/klose\` when
the user describes a new UI component, screen, or visual change, rather than writing it blind.
${CLAUDE_MD_MARKER}
`;

  const updated = existing ? `${existing.trimEnd()}\n\n${section}` : section;
  await writeFile(claudeMdPath, updated, 'utf-8');
  return true;
}

async function cmdInit(args) {
  const copied = await copySkillFiles(packageRoot, cwd);
  await mkdir(path.join(cwd, '.klose', 'projects'), { recursive: true });

  let demoNote = '';
  if (!args.includes('--no-demo') && (await store.listProjects(cwd)).length === 0) {
    await store.seedDemoProject(cwd);
    demoNote = " — including a demo sketch so the canvas isn't empty";
  }

  if (args.includes('--wire-claude-md')) {
    const wired = await wireClaudeMd(cwd);
    console.log(
      wired
        ? 'Added a Klose workflow note to CLAUDE.md so the agent knows to reach for /klose.'
        : 'CLAUDE.md already mentions Klose — left it alone.'
    );
  }

  console.log(`Installed skill${copied.length === 1 ? '' : 's'}: ${copied.map((n) => `/${n}`).join(', ')}`);
  console.log(`Created local project storage at .klose/${demoNote}`);
  console.log('Run "npx klose serve --open" and then use /klose in Claude Code.');
}

async function cmdServe(args) {
  const url = serverUrl(args);
  const port = Number(new URL(url).port);
  const publicDir = path.join(packageRoot, 'web', 'dist');
  const server = createKloseServer({ cwd, publicDir: existsSync(publicDir) ? publicDir : undefined });

  server.listen(port, () => {
    console.log(`klose serving ${cwd} at ${url}`);
    if (args.includes('--open')) openBrowser(url);
  });
}

function serverUrl(args) {
  const portArg = args.find((a) => a.startsWith('--port='));
  const port = portArg ? Number(portArg.split('=')[1]) : Number(process.env.KLOSE_PORT) || 5171;
  return `http://localhost:${port}`;
}

// Unlike `klose project ...`, which reads/writes .klose/ on disk directly and
// so always "succeeds" whether or not the server is running, this is the only
// command that actually checks for a live server — by hitting its HTTP port.
async function cmdStatus(args) {
  const url = serverUrl(args);
  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1000) });
    if (!res.ok) throw new Error(`unexpected status ${res.status}`);
    if (args.includes('--json')) return printJson({ running: true, url });
    console.log(`klose is running at ${url}`);
  } catch {
    if (args.includes('--json')) return printJson({ running: false, url });
    console.log(`klose is not running at ${url}`);
    process.exit(1);
  }
}

function detectPackageManager(dir) {
  if (existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(path.join(dir, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

// Upgrades the `klose` devDependency, then re-copies the skill files from the
// freshly installed package — this process's own `packageRoot` is the OLD
// version once the install completes, so skills are read from
// node_modules/klose fresh rather than from `packageRoot`.
async function cmdUpdate() {
  const pm = detectPackageManager(cwd);
  const installArgs = pm === 'npm' ? ['install', '-D', 'klose@latest'] : ['add', '-D', 'klose@latest'];

  let before = null;
  try {
    before = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf-8')).version;
  } catch {
    // Not fatal — we just won't be able to report the old version.
  }

  console.log(`Updating klose via ${pm} ${installArgs.join(' ')}...`);
  const result = spawnSync(pm, installArgs, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error || result.status !== 0) fail('update failed — see output above');

  const newPackageRoot = path.join(cwd, 'node_modules', 'klose');
  let after = before;
  try {
    after = JSON.parse(await readFile(path.join(newPackageRoot, 'package.json'), 'utf-8')).version;
  } catch {
    fail('installed, but could not find node_modules/klose to read its new version or refresh skills');
  }

  const copied = await copySkillFiles(newPackageRoot, cwd);
  console.log(`klose updated: ${before || '?'} -> ${after || '?'}`);
  console.log(`Refreshed skill${copied.length === 1 ? '' : 's'} from the new version: ${copied.map((n) => `/${n}`).join(', ')}`);
  if (before && after && before !== after) {
    console.log('Instructions may have changed — expect a slightly different /klose flow next time.');
  }
}

// Removes built sketches (the real component already lives in the repo, so
// the canvas copy is just clutter) and/or empty projects. Defaults to a dry
// run so the agent/user can see what would go before anything is deleted.
async function cmdCleanup(args) {
  const apply = args.includes('--yes') || args.includes('-y');
  const filterFlags = args.filter((a) => a.startsWith('--') && a !== '--yes' && a !== '--json');
  const built = filterFlags.length === 0 || filterFlags.includes('--built');
  const emptyProjects = filterFlags.length === 0 || filterFlags.includes('--empty-projects');

  const report = await store.cleanup(cwd, { built, emptyProjects, apply });

  if (args.includes('--json')) return printJson({ apply, ...report });

  if (report.removedNodes.length === 0 && report.removedProjects.length === 0) {
    console.log('Nothing to clean up.');
    return;
  }
  for (const n of report.removedNodes) {
    console.log(`${apply ? 'Removed' : 'Would remove'} built sketch "${n.name}" from project "${n.projectName}"`);
  }
  for (const p of report.removedProjects) {
    console.log(`${apply ? 'Removed' : 'Would remove'} empty project "${p.projectName}" (${p.projectId})`);
  }
  if (!apply) {
    console.log('\nDry run — nothing changed. Re-run with --yes to apply.');
  }
}

async function cmdProject(args) {
  const [sub, ...rest] = args;
  switch (sub) {
    case 'list':
      return printJson(await store.listProjects(cwd));
    case 'create':
      return printJson(await store.createProject(cwd, rest[0]));
    case 'get':
      if (!rest[0]) fail('usage: klose project get <id>');
      return printJson(await store.getProject(cwd, rest[0]));
    case 'update': {
      const [id, json] = rest;
      if (!id || !json) fail('usage: klose project update <id> <json|@file.json>');
      return printJson(await store.updateProject(cwd, id, await parseJsonArg(json)));
    }
    case 'delete':
      if (!rest[0]) fail('usage: klose project delete <id>');
      await store.deleteProject(cwd, rest[0]);
      return printJson({ ok: true });
    case 'add-node': {
      const [id, json] = rest;
      if (!id || !json) fail('usage: klose project add-node <id> <json|@file.json>');
      return printJson(await store.addNode(cwd, id, await parseJsonArg(json)));
    }
    case 'update-node': {
      const [id, nodeId, json] = rest;
      if (!id || !nodeId || !json) fail('usage: klose project update-node <id> <nodeId> <json|@file.json>');
      return printJson(await store.updateNode(cwd, id, nodeId, await parseJsonArg(json)));
    }
    default:
      fail(`unknown project subcommand "${sub}"`);
  }
}

// Search the host repo's real components — so the agent can reuse what already
// exists instead of re-sketching it. `--json` for machine output; default is a
// short human-readable list.
async function cmdComponents(args) {
  const flags = args.filter((a) => a.startsWith('--'));
  const query = args.filter((a) => !a.startsWith('--')).join(' ');
  const data = await scanComponents(cwd, { force: true });
  const components = filterComponents(data.components, query);

  if (flags.includes('--json')) {
    return printJson({ ...data, count: components.length, components });
  }

  const where = `${data.repo.name}${data.repo.branch ? ` (${data.repo.branch})` : ''} — ${data.repo.root}`;
  if (components.length === 0) {
    console.log(`Repo: ${where}`);
    console.log(query ? `No components match "${query}".` : 'No components found in this repo.');
    return;
  }
  console.log(`Repo: ${where}`);
  console.log(`${components.length} component${components.length === 1 ? '' : 's'}${query ? ` matching "${query}"` : ''}:\n`);
  for (const c of components) {
    const props = c.props.length ? `  props: ${c.props.map((p) => p.name + (p.optional ? '?' : '')).join(', ')}` : '';
    console.log(`  ${c.name}  —  ${c.file}:${c.line}`);
    if (c.description) console.log(`    ${c.description}`);
    if (props) console.log(props);
  }
}

async function main() {
  const [, , command, ...args] = process.argv;
  switch (command) {
    case 'init':
      return cmdInit(args);
    case 'serve':
      return cmdServe(args);
    case 'status':
      return cmdStatus(args);
    case 'update':
      return cmdUpdate();
    case 'cleanup':
      return cmdCleanup(args);
    case 'project':
      return cmdProject(args);
    case 'components':
      return cmdComponents(args);
    case '--version':
    case '-v': {
      const pkg = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf-8'));
      return console.log(pkg.version);
    }
    default:
      console.log('Usage: klose <init|serve|status|update|cleanup|project|components> [...args]');
      if (command) process.exit(1);
  }
}

main().catch((err) => fail(err.message || String(err)));
