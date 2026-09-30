#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, openSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import * as store from '../server/store.js';
import { createKloseServer } from '../server/http.js';
import { scanComponents, filterComponents } from '../server/scanner.js';
import { rankComponents, JEV_DEFAULT_BASE_URL, MAX_CANDIDATES } from '../server/jev.js';
import { loadTheme } from '../server/theme.js';
import { resolveRoot } from '../server/root.js';
import { installSkills } from '../server/skills.js';
import { exportProject } from '../server/export.js';
import {
  defaultHubOptions,
  findHub,
  kloseHome,
  listRepos,
  rememberRepo,
  removeHubInfo,
  removeHubInfoSync,
  repoUrl,
  writeHubInfo,
} from '../server/hub.js';
import { buildTray, findTray, removeTrayInfo, trayBinary } from '../server/tray.js';
import {
  DEFAULT_PORT,
  displayUrl,
  findServer,
  probe,
  removeServerInfo,
  removeServerInfoSync,
  writeServerInfo,
} from '../server/instance.js';

const __filename = fileURLToPath(import.meta.url);
const packageRoot = path.join(path.dirname(__filename), '..');
const VERSION = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf-8')).version;
const invokedFrom = process.cwd();

// Set in main(): the repo this command acts on (see server/root.js).
let root = invokedFrom;

const HELP = `Klose ${VERSION} — a local design canvas for your coding agent.

Usage: klose <command> [options]

Getting started
  init          Install the /klose skills and local storage in this repo
  serve         Start this repo's canvas server
  status        Check whether this repo's canvas is running
  stop          Stop this repo's canvas server

One canvas for every repo
  hub           Start (or check, stop) a machine-wide canvas that finds your
                repos from Claude Code's sessions — nothing to set up per repo
  tray          Put the hub in the macOS menu bar: a dot when an agent is
                working or feedback is waiting, and a popover of your repos

Canvas data
  project       List, create, read and edit projects and their sketches
  feedback      Read pending comments as JSON
  components    Search this repo's real components
  theme         Show the design tokens previews are rendered with

Maintenance
  update        Upgrade klose and refresh the installed skills
  cleanup       Remove built sketches and empty projects

Run "klose help <command>" for its options. Commands run from a subfolder act
on the nearest parent with a .klose/ or .git.`;

const COMMAND_HELP = {
  init: `Usage: klose init [options]

Installs the /klose, /klose-update and /klose-cleanup skills into
.claude/skills/, creates .klose/ storage, and reports what Klose found in the
repo (design tokens, components).

Options
  --no-demo           Don't seed a demo project
  --ignore-projects   Keep sketches out of git (adds projects/ to .klose/.gitignore)
  --wire-claude-md    Add a note to CLAUDE.md so the agent suggests /klose on its own
  --force             Overwrite skill files you've edited (the old copy is kept as SKILL.md.bak)
  --here              Install in this folder instead of the repo root
  --global            Install the skills for every repo (~/.claude/skills) and
                      nothing else — pair it with "klose hub" so no repo needs
                      its own init`,
  serve: `Usage: klose serve [options]

Starts the canvas for this repo on 127.0.0.1. If it is already running, says
where instead of starting a second one. If the default port is taken, the next
free one is used.

Options
  --detach       Run in the background (logs go to .klose/server.log)
  --open         Open the canvas in your browser
  --port=N       Use exactly port N (default ${DEFAULT_PORT}, or $KLOSE_PORT; 0 = any free port)`,
  status: `Usage: klose status [--port=N] [--json]

Reports whether this repo's canvas server is running and at which URL. Exits 1
when it isn't, including when a Klose server for a different repo holds the port.`,
  hub: `Usage: klose hub [start] [--port=N] [--open] [--detach]
       klose hub status [--json]
       klose hub stop
       klose hub add [path]

Runs one canvas for every repo on this machine instead of one per repo. The
hub reads Claude Code's own session files (~/.claude/sessions and the
transcripts under ~/.claude/projects) to see which repos have an agent in
them or were used recently, and serves each one's .klose/ at
  http://localhost:<port>/r/<repo-id>/projects

It only reads ~/.claude. It writes ~/.klose/ (its own bookkeeping) and a
repo's .klose/ once you sketch there — never before. It listens on 127.0.0.1.

  start    (default) Start the hub. --detach runs it in the background.
  status   Whether the hub is running, and the repos it sees.
  stop     Stop the hub.
  add      List a repo the hub hasn't noticed (default: the current one).

While the hub is up, "klose status" and "klose serve" in any repo point at it
instead of starting a second server. "klose init --global" installs the
/klose skill for every repo, so there is nothing left to do per repo.`,
  tray: `Usage: klose tray [start] [--open] [--port=N]
       klose tray status [--json]
       klose tray stop

Puts Klose in the macOS menu bar. The icon carries a dot — blue while an agent
is working, amber when comments are waiting in a repo no agent is busy in —
and clicking it opens a popover of your repos; clicking a repo opens its
canvas in your browser. Right-click for Open Canvas, Start at Login and Quit.

  start    (default) Start the hub if it isn't running, then the menu bar app.
           The first run compiles the app (a few seconds; needs Apple's
           command line tools: xcode-select --install). --open shows the
           popover straight away.
  status   Whether the menu bar app and the hub are running.
  stop     Quit the menu bar app. The hub keeps running; stop it with
           "klose hub stop".

The app is a thin shell: everything it shows comes from the hub, and it
restarts the hub if it finds it down. macOS only for now — the hub itself
("klose hub") works everywhere.`,
  stop: `Usage: klose stop

Stops this repo's canvas server, whether it was started with --detach or not.`,
  update: `Usage: klose update [--force]

Upgrades the klose devDependency (npm, yarn or pnpm, detected from the lockfile)
and refreshes the installed skills. Skill files you've edited are left alone
unless --force, which keeps the old copy as SKILL.md.bak.`,
  cleanup: `Usage: klose cleanup [--built] [--empty-projects] [--yes] [--json]

Removes sketches already built into real files and/or empty projects. With
neither filter, does both. Dry run unless --yes.`,
  components: `Usage: klose components [query] [--json]
       klose components "<what you want to build>" --rank [--top=N] [--json]

Searches every exported .tsx/.jsx component in the repo by name, file, props
and doc comment.

Options
  --rank     Rank components by how well they fit a plain-language need, using
             Jev (TypeSafe AI). Opt-in: needs TYPESAFE_API_KEY, and sends each
             component's name, path, category, prop names and doc comment (no
             source code) to api.typesafe.ai. Says whether anything fits:
             reuse, partial or new. Falls back to the text search on any error.
  --top=N    How many ranked components to show (default 5)
  --json     Machine-readable output`,
  theme: `Usage: klose theme [--json | --css]

Shows the design tokens found in this repo (Tailwind config, @theme blocks,
:root custom properties) that every preview is rendered with. --css prints the
exact stylesheet the sandbox receives.`,
  feedback: `Usage: klose feedback [--project=<id>]

Prints all pending comments as structured JSON.`,
  project: `Usage: klose project <subcommand>

  list                                       List projects
  create <name>                              Create a project
  get <id>                                   Read a project (nodes, comments, notes)
  update <id> <json|@file.json>              Merge fields into a project
  delete <id>                                Delete a project
  add-node <id> <json|@file.json>            Add a sketch to a project's canvas
  update-node <id> <nodeId> <json|@file.json>   Update a sketch (code, comments, status)
  export <id> [--out=<dir>] [--json]         Write the sketches into the repo as files

Any <json> argument can be @path/to/file.json instead — easier for multi-line
preview code than a shell argument.

export writes one .tsx per sketch (its preview code, with a header naming the
sketch and project) plus a README.md carrying descriptions, notes, status and
pending comments — a planning doc you can commit and build from. Defaults to
the folder it was last saved to, else docs/klose/<project-slug>/; --out is
relative to where you run the command. The canvas shows each project as Saved,
Changed since, or not in the repo yet, and its "Save to repo" does the same.`,
};

function printJson(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

function fail(message) {
  process.stderr.write(`klose: ${message}\n`);
  process.exit(1);
}

function hasFlag(args, ...names) {
  return names.some((n) => args.includes(n));
}

// Accepts either inline JSON or, prefixed with '@', a path to a JSON file to
// read instead (e.g. `@/tmp/node.json`). Multi-line fields like `code` are
// painful and easy to mis-escape as a shell argument — write them to a file
// and pass `@path` instead. Relative paths resolve against where the command
// was typed, not the repo root, because that's what the user meant.
async function parseJsonArg(value) {
  let raw = value;
  let label = 'the JSON argument';
  if (value.startsWith('@')) {
    const filePath = path.resolve(invokedFrom, value.slice(1));
    label = filePath;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch (err) {
      fail(`could not read ${filePath}: ${err.code === 'ENOENT' ? 'no such file' : err.message}`);
    }
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    fail(`invalid JSON in ${label}: ${err.message}`);
  }
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    const child = spawn(cmd, [url], { detached: true, stdio: 'ignore', shell: process.platform === 'win32' });
    child.on('error', () => {});
    child.unref();
  } catch {
    // Best-effort only — printing the URL is enough if this fails.
  }
}

function portFromArgs(args) {
  const portArg = args.find((a) => a.startsWith('--port='));
  const raw = portArg ? portArg.split('=')[1] : process.env.KLOSE_PORT;
  if (raw === undefined || raw === '') return { port: DEFAULT_PORT, explicit: false };
  const port = Number(raw);
  // 0 asks the OS for any free port (used by the tests).
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`invalid port "${raw}"`);
  return { port, explicit: true };
}

function relToRoot(file) {
  return path.relative(invokedFrom, path.join(root, file)) || '.';
}

// ---------------------------------------------------------------- init

const CLAUDE_MD_MARKER = '<!-- klose:workflow -->';

// Opt-in (`--wire-claude-md`) because editing the user's CLAUDE.md is more
// invasive than dropping a skill file. Idempotent: re-running `init` won't
// duplicate the section, and an existing mention of Klose is left alone.
async function wireClaudeMd(targetRoot) {
  const claudeMdPath = path.join(targetRoot, 'CLAUDE.md');
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

// .klose/.gitignore keeps per-machine files out of git no matter what the
// user decides about committing their sketches.
async function writeKloseGitignore(targetRoot, ignoreProjects) {
  const file = path.join(targetRoot, '.klose', '.gitignore');
  let lines = [];
  try {
    lines = (await readFile(file, 'utf-8')).split('\n').map((l) => l.trim()).filter(Boolean);
  } catch {
    // Not there yet.
  }
  const wanted = ['server.json', 'server.log', ...(ignoreProjects ? ['projects/'] : [])];
  const missing = wanted.filter((l) => !lines.includes(l));
  if (missing.length) await writeFile(file, [...lines, ...missing].join('\n') + '\n', 'utf-8');
  return lines.includes('projects/') || ignoreProjects;
}

function printSkillReport(report) {
  const list = (names) => names.map((n) => `/${n}`).join(', ');
  const changed = [...report.installed, ...report.updated];
  if (changed.length) console.log(`  ✓ Skills       ${list(changed)} → ${relToRoot('.claude/skills')}/`);
  if (report.unchanged.length && !changed.length) console.log(`  ✓ Skills       ${list(report.unchanged)} (already up to date)`);
  for (const name of report.backedUp) {
    console.log(`  ! /${name}: your previous SKILL.md was saved as SKILL.md.bak`);
  }
  for (const name of report.skipped) {
    console.log(`  ! /${name}: you've edited this skill, so it was left alone (re-run with --force to replace it)`);
  }
}

async function printRepoReport() {
  const [theme, components] = await Promise.all([loadTheme(root, { force: true }), scanComponents(root, { force: true })]);
  console.log('\nWhat Klose found in this repo');
  if (theme.sources.length) {
    for (const s of theme.sources) {
      const what = s.kind === 'tailwind-config' ? 'Tailwind config' : 'CSS tokens';
      console.log(`  ✓ ${what.padEnd(15)} ${s.file} (${s.count} token${s.count === 1 ? '' : 's'})`);
    }
  } else {
    console.log('  – Design tokens   none found. Previews will use stock Tailwind until you add a');
    console.log('                    tailwind.config, an @theme block, or :root CSS variables —');
    console.log("                    or pin your brand in the project's design-system notes.");
  }
  for (const w of theme.warnings) console.log(`  ! ${w}`);
  if (components.count) {
    const dirs = [...new Set(components.components.map((c) => path.dirname(c.file)))].slice(0, 3);
    console.log(`  ✓ Components      ${components.count} exported component${components.count === 1 ? '' : 's'} (${dirs.join(', ')}${dirs.length === 3 ? ', …' : ''})`);
  } else {
    console.log('  – Components      none found yet — the agent will sketch from scratch.');
  }
}

// Installs the skills for every repo (~/.claude/skills) and nothing else: no
// .klose/ here, no demo project. With the hub running, that is all the setup
// any repo needs.
async function initGlobal(args) {
  const home = os.homedir();
  const report = await installSkills(packageRoot, home, { force: hasFlag(args, '--force') });
  const list = (names) => names.map((n) => `/${n}`).join(', ');
  const changed = [...report.installed, ...report.updated];
  console.log(`Klose ${VERSION} skills are installed for every repo on this machine\n`);
  if (changed.length) console.log(`  ✓ Skills       ${list(changed)} → ${path.join(home, '.claude', 'skills')}/`);
  else if (report.unchanged.length) console.log(`  ✓ Skills       ${list(report.unchanged)} (already up to date)`);
  for (const name of report.backedUp) console.log(`  ! /${name}: your previous SKILL.md was saved as SKILL.md.bak`);
  for (const name of report.skipped) console.log(`  ! /${name}: you've edited this skill, so it was left alone (re-run with --force to replace it)`);
  const hub = await findHub();
  console.log(hub.state === 'running' ? `\nThe hub is running at ${hub.url}.` : '\nNext: start the hub with\n  npx klose hub --detach --open');
  console.log("If /klose isn't in Claude Code's command list yet, restart Claude Code.");
}

async function cmdInit(args) {
  if (hasFlag(args, '--global')) return initGlobal(args);
  const report = await installSkills(packageRoot, root, { force: hasFlag(args, '--force') });
  await mkdir(path.join(root, '.klose', 'projects'), { recursive: true });
  const projectsIgnored = await writeKloseGitignore(root, hasFlag(args, '--ignore-projects'));

  let seeded = false;
  if (!hasFlag(args, '--no-demo') && (await store.listProjects(root)).length === 0) {
    await store.seedDemoProject(root);
    seeded = true;
  }

  console.log(`Klose ${VERSION} is set up in ${root}\n`);
  printSkillReport(report);
  console.log(`  ✓ Storage      ${relToRoot('.klose')}/${seeded ? ' (with a demo project, so the canvas isn\'t empty)' : ''}`);

  if (hasFlag(args, '--wire-claude-md')) {
    const wired = await wireClaudeMd(root);
    console.log(wired ? '  ✓ CLAUDE.md    added a note so the agent reaches for /klose on its own' : '  ✓ CLAUDE.md    already mentions Klose — left alone');
  }

  await printRepoReport();

  console.log(
    projectsIgnored
      ? '\nSketches in .klose/projects/ are git-ignored and stay on this machine.'
      : '\nSketches in .klose/projects/ are plain JSON and will be committed with the repo as design\n' +
          'history. To keep them local instead, run: npx klose init --ignore-projects'
  );

  console.log('\nNext: in Claude Code, try');
  console.log('  /klose a pricing card for our billing page');
  console.log('The skill starts the canvas for you (or run "npx klose serve --open" yourself).');
  console.log("If /klose isn't in Claude Code's command list yet, restart Claude Code.");
}

// --------------------------------------------------- serve / status / stop

function listenOnce(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    // Loopback only: the API reads and writes this repo, so it must not be
    // reachable from other machines on the network.
    server.listen(port, '127.0.0.1');
  });
}

async function listen(server, basePort, explicit) {
  const attempts = explicit ? 1 : 20;
  for (let port = basePort; port < basePort + attempts; port++) {
    try {
      await listenOnce(server, port);
      return server.address().port;
    } catch (err) {
      if (err.code !== 'EADDRINUSE') throw err;
      if (explicit) {
        const health = await probe(port);
        fail(
          health
            ? `port ${port} is used by ${health.hub ? 'the Klose hub' : `the Klose canvas for ${health.root}`}. Pick another with --port=N.`
            : `port ${port} is already in use by another program. Pick another with --port=N.`
        );
      }
    }
  }
  fail(`ports ${basePort}–${basePort + attempts - 1} are all in use. Pick one with --port=N.`);
}

async function startDetached(args, open) {
  const logFile = path.join(root, '.klose', 'server.log');
  await mkdir(path.dirname(logFile), { recursive: true });
  const log = openSync(logFile, 'a');
  const childArgs = args.filter((a) => a !== '--detach' && a !== '--open');
  const child = spawn(process.execPath, [__filename, 'serve', ...childArgs], {
    cwd: root,
    detached: true,
    stdio: ['ignore', log, log],
    windowsHide: true,
  });
  let exited = null;
  child.on('exit', (code) => {
    exited = code ?? 1;
  });
  child.unref();

  const { port } = portFromArgs(args);
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && exited === null) {
    const found = await findServer(root, port);
    if (found.state === 'running' && found.pid === child.pid) {
      console.log(`Klose is running at ${found.url} (in the background, pid ${found.pid})`);
      console.log('Stop it with: npx klose stop');
      if (open) openBrowser(found.url);
      return;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  const tail = readFileSync(logFile, 'utf-8').trim().split('\n').slice(-5).join('\n');
  fail(`the background server didn't start. Last lines of ${relToRoot('.klose/server.log')}:\n${tail}`);
}

async function cmdServe(args) {
  const { port: basePort, explicit } = portFromArgs(args);
  const open = hasFlag(args, '--open');

  const existing = await findServer(root, basePort);
  if (existing.state === 'running') {
    console.log(`Klose is already running for this repo at ${existing.url}`);
    if (open) openBrowser(existing.url);
    return;
  }

  // A hub already serves every repo, this one included — a second server
  // would only give the same canvas a second address.
  const onHub = await hubUrlForRepo();
  if (onHub) {
    console.log(`The Klose hub is running — this repo's canvas is at ${onHub}`);
    if (open) openBrowser(onHub);
    return;
  }

  if (hasFlag(args, '--detach')) return startDetached(args, open);

  const publicDir = path.join(packageRoot, 'web', 'dist');
  const hasUi = existsSync(path.join(publicDir, 'index.html'));
  const server = createKloseServer({ cwd: root, publicDir: hasUi ? publicDir : undefined, version: VERSION });
  const port = await listen(server, basePort, explicit);
  const url = displayUrl(port);

  await writeServerInfo(root, { pid: process.pid, port, url, root, version: VERSION, startedAt: new Date().toISOString() });
  process.on('exit', () => removeServerInfoSync(root, process.pid));
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => process.exit(0));

  if (port !== basePort && basePort !== 0) console.log(`Port ${basePort} is busy, so Klose is using ${port} instead.`);
  console.log(`klose serving ${root} at ${url}`);
  if (!hasUi) {
    console.log('Note: the canvas UI isn\'t built in this install (web/dist is missing) — only the API is available.');
    console.log('      Reinstall klose from npm, or run "npm run build" if you\'re working on Klose itself.');
  }
  if (open) openBrowser(url);
}

// Unlike `klose project ...`, which reads/writes .klose/ on disk directly and
// so always "succeeds" whether or not the server is running, this checks for a
// live server — and that it's serving *this* repo, not another one that
// happens to hold the port.
async function cmdStatus(args) {
  const found = await findServer(root, portFromArgs(args).port);
  const running = found.state === 'running';
  const onHub = running ? null : await hubUrlForRepo();
  if (onHub) {
    if (hasFlag(args, '--json')) return printJson({ running: true, hub: true, url: onHub, root });
    return console.log(`klose is running for this repo on the hub at ${onHub}`);
  }
  if (hasFlag(args, '--json')) {
    return printJson({ running, url: found.url, port: found.port, root, ...(found.pid ? { pid: found.pid } : {}), ...(found.otherRoot ? { otherRoot: found.otherRoot } : {}) });
  }
  if (running) return console.log(`klose is running for this repo at ${found.url}`);
  if (found.state === 'other') {
    console.log(`klose on port ${found.port} is serving a different repo (${found.otherRoot}).`);
  } else {
    console.log(`klose is not running for this repo.`);
  }
  console.log('Start it with: npx klose serve --detach');
  process.exit(1);
}

async function cmdStop(args) {
  const found = await findServer(root, portFromArgs(args).port);
  if (found.state !== 'running') {
    await removeServerInfo(root);
    console.log('klose is not running for this repo.');
    return;
  }
  try {
    process.kill(found.pid, 'SIGTERM');
  } catch (err) {
    fail(`could not stop pid ${found.pid}: ${err.message}`);
  }
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && (await probe(found.port, 300))) {
    await new Promise((r) => setTimeout(r, 100));
  }
  await removeServerInfo(root);
  console.log(`Stopped klose at ${found.url}`);
}

// ------------------------------------------------------------------- hub

// If a hub is running, the URL of this repo's canvas on it — and make sure
// the hub lists the repo, since someone just asked about it here.
async function hubUrlForRepo() {
  const hub = await findHub();
  if (hub.state !== 'running') return null;
  await rememberRepo(root);
  return repoUrl(hub.url, root);
}

function isRepo(dir) {
  return dir !== os.homedir() && (existsSync(path.join(dir, '.git')) || existsSync(path.join(dir, '.klose')));
}

async function startHubDetached(args, open) {
  const home = kloseHome();
  const logFile = path.join(home, 'hub.log');
  await mkdir(home, { recursive: true });
  const log = openSync(logFile, 'a');
  const childArgs = args.filter((a) => a !== '--detach' && a !== '--open');
  const child = spawn(process.execPath, [__filename, 'hub', ...childArgs], {
    cwd: invokedFrom,
    detached: true,
    stdio: ['ignore', log, log],
    windowsHide: true,
  });
  let exited = null;
  child.on('exit', (code) => {
    exited = code ?? 1;
  });
  child.unref();

  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && exited === null) {
    const found = await findHub();
    if (found.state === 'running' && found.pid === child.pid) {
      console.log(`The Klose hub is running at ${found.url} (in the background, pid ${found.pid})`);
      console.log('Stop it with: npx klose hub stop');
      if (open) openBrowser(found.url);
      return;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  const tail = readFileSync(logFile, 'utf-8').trim().split('\n').slice(-5).join('\n');
  fail(`the hub didn't start. Last lines of ${logFile}:\n${tail}`);
}

async function hubStart(args) {
  const { port: basePort, explicit } = portFromArgs(args);
  const open = hasFlag(args, '--open');

  const existing = await findHub();
  if (existing.state === 'running') {
    console.log(`The Klose hub is already running at ${existing.url}`);
    if (open) openBrowser(existing.url);
    return;
  }

  // Started from inside a repo: list it even if no agent has been there yet.
  if (isRepo(root)) await rememberRepo(root);

  if (hasFlag(args, '--detach')) return startHubDetached(args, open);

  const publicDir = path.join(packageRoot, 'web', 'dist');
  const hasUi = existsSync(path.join(publicDir, 'index.html'));
  const server = createKloseServer({ hub: defaultHubOptions(), publicDir: hasUi ? publicDir : undefined, version: VERSION });
  const port = await listen(server, basePort, explicit);
  const url = displayUrl(port);

  await writeHubInfo({ pid: process.pid, port, url, version: VERSION, startedAt: new Date().toISOString() });
  process.on('exit', () => removeHubInfoSync(process.pid));
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => process.exit(0));

  if (port !== basePort && basePort !== 0) console.log(`Port ${basePort} is busy, so the hub is using ${port} instead.`);
  const repos = await listRepos();
  console.log(`klose hub serving ${repos.length} repo${repos.length === 1 ? '' : 's'} at ${url}`);
  if (!hasUi) {
    console.log('Note: the canvas UI isn\'t built in this install (web/dist is missing) — only the API is available.');
    console.log('      Reinstall klose from npm, or run "npm run build" if you\'re working on Klose itself.');
  }
  if (open) openBrowser(url);
}

async function hubStatus(args) {
  const hub = await findHub();
  const running = hub.state === 'running';
  const repos = await listRepos();
  if (hasFlag(args, '--json')) {
    return printJson({
      running,
      ...(running ? { url: hub.url, port: hub.port, pid: hub.pid } : {}),
      repos: repos.map((r) => ({ ...r, ...(running ? { url: repoUrl(hub.url, r.root) } : {}) })),
    });
  }
  console.log(running ? `The Klose hub is running at ${hub.url}` : 'The Klose hub is not running. Start it with: npx klose hub --detach');
  if (!repos.length) {
    console.log('\nNo repos found yet — open Claude Code in one, or run "klose hub add" inside it.');
  } else {
    console.log(`\n${repos.length} repo${repos.length === 1 ? '' : 's'}:`);
    for (const r of repos) {
      const agent = r.agent === 'working' ? 'agent working' : r.agent === 'idle' ? 'agent idle' : 'no agent';
      const counts = r.files ? `${r.files} file${r.files === 1 ? '' : 's'}, ${r.sketches} sketch${r.sketches === 1 ? '' : 'es'}${r.comments ? `, ${r.comments} comment${r.comments === 1 ? '' : 's'} waiting` : ''}` : 'no Klose files yet';
      console.log(`  ${r.name.padEnd(22)} ${agent.padEnd(14)} ${counts}`);
      console.log(`  ${' '.repeat(22)} ${running ? repoUrl(hub.url, r.root) : r.path}`);
    }
  }
  if (!running) process.exit(1);
}

async function hubStop() {
  const hub = await findHub();
  if (hub.state !== 'running') {
    await removeHubInfo();
    console.log('The Klose hub is not running.');
    return;
  }
  try {
    process.kill(hub.pid, 'SIGTERM');
  } catch (err) {
    fail(`could not stop pid ${hub.pid}: ${err.message}`);
  }
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && (await probe(hub.port, 300))) {
    await new Promise((r) => setTimeout(r, 100));
  }
  await removeHubInfo();
  console.log(`Stopped the Klose hub at ${hub.url}`);
}

async function hubAdd(args) {
  const target = args.find((a) => !a.startsWith('--'));
  const dir = target ? resolveRoot(path.resolve(invokedFrom, target)) : root;
  if (!existsSync(dir)) fail(`no such folder: ${dir}`);
  if (dir === os.homedir()) fail('your home directory is not a repo — run this inside a project, or pass its path');
  const added = await rememberRepo(dir);
  const hub = await findHub();
  console.log(added ? `Added ${dir} to the hub.` : `${dir} is already on the hub.`);
  console.log(hub.state === 'running' ? `Its canvas: ${repoUrl(hub.url, dir)}` : 'Start the hub with: npx klose hub --detach');
}

// ------------------------------------------------------------------ tray

async function trayStart(args) {
  if (process.platform !== 'darwin') {
    fail('the menu bar app is macOS-only for now. The hub works everywhere: npx klose hub --detach --open');
  }
  const running = await findTray();
  if (running.state === 'running') {
    console.log(`The Klose menu bar app is already running (pid ${running.pid}).`);
    return;
  }

  // The app shows the hub; bring that up first so its first look succeeds.
  const showPopover = hasFlag(args, '--open');
  if ((await findHub()).state !== 'running') await startHubDetached(args.filter((a) => a !== '--open'), false);

  let built;
  try {
    const alreadyBuilt = existsSync(trayBinary(packageRoot, VERSION));
    if (!alreadyBuilt) console.log('Building the menu bar app (first run only, a few seconds)…');
    built = await buildTray(packageRoot, VERSION);
  } catch (err) {
    fail(err.message);
  }

  const home = kloseHome();
  const log = openSync(path.join(home, 'tray.log'), 'a');
  const appArgs = ['--home', home, '--node', process.execPath, '--cli', __filename, ...(showPopover ? ['--show'] : [])];
  const child = spawn(built.binary, appArgs, {
    detached: true,
    stdio: ['ignore', log, log],
  });
  let exited = null;
  child.on('exit', (code) => {
    exited = code ?? 1;
  });
  child.unref();

  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && exited === null) {
    const found = await findTray();
    if (found.state === 'running' && found.pid === child.pid) {
      console.log(`Klose is in your menu bar (pid ${found.pid}). Right-click it for Start at Login and Quit.`);
      console.log('Stop it with: npx klose tray stop');
      return;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  fail(`the menu bar app didn't start. See ${path.join(home, 'tray.log')}`);
}

async function trayStatus(args) {
  const [tray, hub] = await Promise.all([findTray(), findHub()]);
  const running = tray.state === 'running';
  if (hasFlag(args, '--json')) {
    return printJson({
      running,
      ...(running ? { pid: tray.pid } : {}),
      hub: hub.state === 'running' ? { running: true, url: hub.url } : { running: false },
    });
  }
  console.log(running ? `The Klose menu bar app is running (pid ${tray.pid}).` : 'The Klose menu bar app is not running. Start it with: npx klose tray');
  console.log(hub.state === 'running' ? `The hub is running at ${hub.url}` : 'The hub is not running.');
  if (!running) process.exit(1);
}

async function trayStop() {
  const tray = await findTray();
  if (tray.state !== 'running') {
    await removeTrayInfo();
    console.log('The Klose menu bar app is not running.');
    return;
  }
  try {
    process.kill(tray.pid, 'SIGTERM');
  } catch (err) {
    fail(`could not stop pid ${tray.pid}: ${err.message}`);
  }
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && (await findTray()).state === 'running') {
    await new Promise((r) => setTimeout(r, 100));
  }
  // SIGTERM doesn't give the app a chance to tidy up after itself.
  await removeTrayInfo();
  console.log('Quit the Klose menu bar app. The hub is still running; stop it with: npx klose hub stop');
}

async function cmdTray(args) {
  const sub = args.find((a) => !a.startsWith('--'));
  const rest = args.filter((a) => a !== sub);
  if (!sub || sub === 'start') return trayStart(rest);
  if (sub === 'status') return trayStatus(rest);
  if (sub === 'stop') return trayStop();
  fail(`unknown tray subcommand "${sub}"\n\n${COMMAND_HELP.tray}`);
}

async function cmdHub(args) {
  const sub = args.find((a) => !a.startsWith('--'));
  const rest = args.filter((a) => a !== sub);
  if (!sub || sub === 'start') return hubStart(rest);
  if (sub === 'status') return hubStatus(rest);
  if (sub === 'stop') return hubStop();
  if (sub === 'add') return hubAdd(rest);
  fail(`unknown hub subcommand "${sub}"\n\n${COMMAND_HELP.hub}`);
}

// --------------------------------------------------------------- update

function detectPackageManager(dir) {
  if (existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(path.join(dir, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

// Upgrades the `klose` devDependency, then re-copies the skill files from the
// freshly installed package — this process's own `packageRoot` is the OLD
// version once the install completes, so skills are read from
// node_modules/klose fresh rather than from `packageRoot`.
async function cmdUpdate(args) {
  const pm = detectPackageManager(root);
  const installArgs = pm === 'npm' ? ['install', '-D', 'klose@latest'] : ['add', '-D', 'klose@latest'];

  console.log(`Updating klose via ${pm} ${installArgs.join(' ')}...`);
  const result = spawnSync(pm, installArgs, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error || result.status !== 0) fail('update failed — see output above');

  const newPackageRoot = path.join(root, 'node_modules', 'klose');
  let after = VERSION;
  try {
    after = JSON.parse(await readFile(path.join(newPackageRoot, 'package.json'), 'utf-8')).version;
  } catch {
    fail('installed, but could not find node_modules/klose to read its new version or refresh skills');
  }

  const report = await installSkills(newPackageRoot, root, { force: hasFlag(args, '--force') });
  console.log(`klose updated: ${VERSION} -> ${after}`);
  printSkillReport(report);
  if (VERSION !== after) {
    console.log('Instructions may have changed — expect a slightly different /klose flow next time.');
    const running = await findServer(root, DEFAULT_PORT);
    if (running.state === 'running') console.log('Restart the canvas to pick up the new version: npx klose stop && npx klose serve --detach');
  }
}

// -------------------------------------------------------------- cleanup

// Removes built sketches (the real component already lives in the repo, so
// the canvas copy is just clutter) and/or empty projects. Defaults to a dry
// run so the agent/user can see what would go before anything is deleted.
async function cmdCleanup(args) {
  const apply = hasFlag(args, '--yes', '-y');
  const filterFlags = args.filter((a) => a.startsWith('--') && a !== '--yes' && a !== '--json');
  const built = filterFlags.length === 0 || filterFlags.includes('--built');
  const emptyProjects = filterFlags.length === 0 || filterFlags.includes('--empty-projects');

  const report = await store.cleanup(root, { built, emptyProjects, apply });

  if (hasFlag(args, '--json')) return printJson({ apply, ...report });

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

// -------------------------------------------------------- data commands

async function cmdProject(args) {
  const [sub, ...rest] = args;
  switch (sub) {
    case 'list':
      return printJson(await store.listProjects(root));
    case 'create':
      return printJson(await store.createProject(root, rest[0]));
    case 'get':
      if (!rest[0]) fail('usage: klose project get <id>');
      return printJson(await store.getProject(root, rest[0]));
    case 'update': {
      const [id, json] = rest;
      if (!id || !json) fail('usage: klose project update <id> <json|@file.json>');
      return printJson(await store.updateProject(root, id, await parseJsonArg(json)));
    }
    case 'delete':
      if (!rest[0]) fail('usage: klose project delete <id>');
      await store.deleteProject(root, rest[0]);
      return printJson({ ok: true });
    case 'add-node': {
      const [id, json] = rest;
      if (!id || !json) fail('usage: klose project add-node <id> <json|@file.json>');
      return printJson(await store.addNode(root, id, await parseJsonArg(json)));
    }
    case 'update-node': {
      const [id, nodeId, json] = rest;
      if (!id || !nodeId || !json) fail('usage: klose project update-node <id> <nodeId> <json|@file.json>');
      return printJson(await store.updateNode(root, id, nodeId, await parseJsonArg(json)));
    }
    case 'export': {
      const id = rest.find((a) => !a.startsWith('--'));
      if (!id) fail('usage: klose project export <id> [--out=<dir>] [--json]');
      const outArg = rest.find((a) => a.startsWith('--out='));
      const outDir = outArg ? path.resolve(invokedFrom, outArg.slice('--out='.length)) : undefined;
      const result = await exportProject(root, id, outDir);
      const rel = path.relative(invokedFrom, result.dir) || '.';
      if (hasFlag(rest, '--json')) return printJson({ ...result, dir: rel });
      const n = result.files.length - 1;
      console.log(`Exported ${n} sketch${n === 1 ? '' : 'es'} to ${rel}/`);
      for (const f of result.files) console.log(`  ${f}`);
      return;
    }
    default:
      fail(`${sub ? `unknown project subcommand "${sub}"` : 'missing project subcommand'}\n\n${COMMAND_HELP.project}`);
  }
}

// Search the host repo's real components — so the agent can reuse what already
// exists instead of re-sketching it. `--json` for machine output; default is a
// short human-readable list. `--rank` asks Jev which component fits a need.
async function cmdComponents(args) {
  const flags = args.filter((a) => a.startsWith('--'));
  const query = args.filter((a) => !a.startsWith('--')).join(' ');
  const json = flags.includes('--json');
  const data = await scanComponents(root, { force: true });

  if (flags.includes('--rank')) {
    const ranking = await rankOrWarn(data.components, query, flags);
    if (ranking) return printRanking(data, query, ranking, flags);
  }

  const components = filterComponents(data.components, query);
  if (json) {
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
  for (const c of components) printComponent(c);
}

function printComponent(c, prefix = '') {
  const props = c.props.length ? `  props: ${c.props.map((p) => p.name + (p.optional ? '?' : '')).join(', ')}` : '';
  console.log(`  ${prefix}${c.name}  —  ${c.file}:${c.line}`);
  if (c.description) console.log(`    ${' '.repeat(prefix.length)}${c.description}`);
  if (props) console.log(`${' '.repeat(prefix.length)}${props}`);
}

// Returns the Jev ranking, or null after explaining on stderr why the plain
// text search is shown instead — ranking is a speed-up, never a hard dependency.
async function rankOrWarn(components, query, flags) {
  const apiKey = process.env.TYPESAFE_API_KEY;
  const fallback = (why) => {
    process.stderr.write(`klose: --rank skipped (${why}); showing text matches instead.\n`);
    return null;
  };
  if (!apiKey) return fallback('TYPESAFE_API_KEY is not set');
  if (!query.trim()) return fallback('describe what you want to build, e.g. klose components "pricing table with a monthly/annual toggle" --rank');
  if (!components.length) return null;
  process.stderr.write(`klose: asking Jev to rank ${Math.min(components.length, MAX_CANDIDATES)} components (names, paths, props and doc comments; no source code)…\n`);
  try {
    return await rankComponents(components, query, {
      apiKey,
      baseUrl: process.env.TYPESAFE_BASE_URL || JEV_DEFAULT_BASE_URL,
    });
  } catch (err) {
    return fallback(`Jev: ${err.message}`);
  }
}

const VERDICT_TEXT = {
  reuse: 'an existing component fits — reuse or extend the top match',
  partial: 'partial fit — check the top matches before sketching something new',
  new: 'nothing here does this job — sketch a new component',
};

function printRanking(data, query, ranking, flags) {
  const topArg = flags.find((f) => f.startsWith('--top='));
  const top = Math.max(1, Number.parseInt(topArg?.slice('--top='.length), 10) || 5);
  const json = flags.includes('--json');
  const shown = ranking.ranked.slice(0, top);
  if (json) {
    return printJson({
      ...data,
      query,
      ranking: {
        source: 'jev',
        model: ranking.model,
        exists: ranking.exists,
        verdict: ranking.verdict,
        considered: ranking.considered,
        total: ranking.total,
      },
      count: shown.length,
      components: shown,
    });
  }
  const where = `${data.repo.name}${data.repo.branch ? ` (${data.repo.branch})` : ''} — ${data.repo.root}`;
  console.log(`Repo: ${where}`);
  console.log(`Ranked by Jev for "${query}"`);
  console.log(`Fit: ${ranking.exists.toFixed(2)} — ${VERDICT_TEXT[ranking.verdict]}`);
  if (ranking.considered < ranking.total) {
    console.log(`(ranked the ${ranking.considered} of ${ranking.total} components that best matched the query's words)`);
  }
  console.log('');
  for (const c of shown) printComponent(c, `${c.relevance.toFixed(2)}  `);
}

async function cmdTheme(args) {
  const theme = await loadTheme(root, { force: true });
  if (hasFlag(args, '--json')) return printJson(theme);
  if (hasFlag(args, '--css')) return process.stdout.write(theme.css + '\n');
  if (!theme.sources.length) {
    console.log('No design tokens found — previews render with stock Tailwind.');
  } else {
    console.log(`${theme.tokenCount} token${theme.tokenCount === 1 ? '' : 's'} applied to every preview:`);
    for (const s of theme.sources) console.log(`  ${s.file}  (${s.count})`);
  }
  for (const w of theme.warnings) console.log(`! ${w}`);
}

async function cmdFeedback(args) {
  const projectArg = args.find((arg) => arg.startsWith('--project='));
  const projectId = projectArg ? projectArg.slice('--project='.length) : undefined;
  const feedback = await store.listFeedback(root, { projectId });
  // JSON is the default: this command is primarily an agent integration
  // surface, and stable structured output is safer than parsing prose.
  return printJson({ count: feedback.length, feedback });
}

// ------------------------------------------------------------------ main

const COMMANDS = {
  init: cmdInit,
  serve: cmdServe,
  status: cmdStatus,
  stop: cmdStop,
  hub: cmdHub,
  tray: cmdTray,
  update: cmdUpdate,
  cleanup: cmdCleanup,
  project: cmdProject,
  components: cmdComponents,
  theme: cmdTheme,
  feedback: cmdFeedback,
};

async function main() {
  const [, , command, ...args] = process.argv;

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    const topic = command === 'help' ? args[0] : undefined;
    if (topic && !COMMAND_HELP[topic]) fail(`unknown command "${topic}"\n\n${HELP}`);
    return console.log(topic ? COMMAND_HELP[topic] : HELP);
  }
  if (command === '--version' || command === '-v' || command === 'version') return console.log(VERSION);

  const run = COMMANDS[command];
  if (!run) fail(`unknown command "${command}"\n\n${HELP}`);
  if (hasFlag(args, '--help', '-h')) return console.log(COMMAND_HELP[command]);

  root = command === 'init' && hasFlag(args, '--here') ? invokedFrom : resolveRoot(invokedFrom);
  // The hub and a global init aren't about this repo, so which root was picked is noise.
  const machineWide = command === 'hub' || command === 'tray' || (command === 'init' && hasFlag(args, '--global'));
  if (root !== invokedFrom && !machineWide) process.stderr.write(`klose: using repo root ${root}\n`);
  return run(args);
}

main().catch((err) => fail(err.message || String(err)));
