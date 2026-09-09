#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdir, copyFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import * as store from '../server/store.js';
import { createKloseServer } from '../server/http.js';

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
  const portArg = args.find((a) => a.startsWith('--port='));
  const port = portArg ? Number(portArg.split('=')[1]) : Number(process.env.KLOSE_PORT) || 5171;
  const publicDir = path.join(packageRoot, 'web', 'dist');
  const server = createKloseServer({ cwd, publicDir: existsSync(publicDir) ? publicDir : undefined });

  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`klose serving ${cwd} at ${url}`);
    if (args.includes('--open')) openBrowser(url);
  });
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
      if (!id || !json) fail('usage: klose project update <id> <json>');
      return printJson(await store.updateProject(cwd, id, JSON.parse(json)));
    }
    case 'delete':
      if (!rest[0]) fail('usage: klose project delete <id>');
      await store.deleteProject(cwd, rest[0]);
      return printJson({ ok: true });
    case 'add-node': {
      const [id, json] = rest;
      if (!id || !json) fail('usage: klose project add-node <id> <json>');
      return printJson(await store.addNode(cwd, id, JSON.parse(json)));
    }
    case 'update-node': {
      const [id, nodeId, json] = rest;
      if (!id || !nodeId || !json) fail('usage: klose project update-node <id> <nodeId> <json>');
      return printJson(await store.updateNode(cwd, id, nodeId, JSON.parse(json)));
    }
    default:
      fail(`unknown project subcommand "${sub}"`);
  }
}

async function main() {
  const [, , command, ...args] = process.argv;
  switch (command) {
    case 'init':
      return cmdInit();
    case 'serve':
      return cmdServe(args);
    case 'project':
      return cmdProject(args);
    case '--version':
    case '-v': {
      const pkg = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf-8'));
      return console.log(pkg.version);
    }
    default:
      console.log('Usage: klose <init|serve|project> [...args]');
      if (command) process.exit(1);
  }
}

main().catch((err) => fail(err.message || String(err)));
