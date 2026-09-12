#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdir, copyFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
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

async function cmdInit() {
  const skillDir = path.join(cwd, '.claude', 'skills', 'klose');
  await mkdir(skillDir, { recursive: true });
  await copyFile(path.join(packageRoot, 'skills', 'klose', 'SKILL.md'), path.join(skillDir, 'SKILL.md'));

  await mkdir(path.join(cwd, '.klose', 'projects'), { recursive: true });

  console.log(`Installed the /klose skill at .claude/skills/klose/SKILL.md`);
  console.log(`Created local project storage at .klose/`);
  console.log(`Run "npx klose serve" and then use /klose in Claude Code.`);
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
      return cmdInit();
    case 'serve':
      return cmdServe(args);
    case 'status':
      return cmdStatus(args);
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
      console.log('Usage: klose <init|serve|status|project|components> [...args]');
      if (command) process.exit(1);
  }
}

main().catch((err) => fail(err.message || String(err)));
