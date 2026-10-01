import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HttpError } from './errors.js';
import { listRepos, rememberRepo, tildePath } from './hub.js';
import { resolveRoot } from './root.js';
import { readLiveSessions, readRecentCwds } from './sessions.js';
import { installSkills, skillStatus } from './skills.js';
import { findTray, hasClang, setStartAtLogin, startsAtLogin } from './tray.js';

/**
 * First-run setup for the hub: what `klose setup` and the /welcome page walk
 * through. Everything it needs to know is read fresh each time — whether
 * Claude Code is here, which repos the hub found, whether the /klose skill is
 * installed machine-wide, whether the menu bar app runs — so the page can't
 * show a stale step. The only thing setup itself remembers is that it was
 * finished, in ~/.klose/settings.json.
 *
 * `options` are the hub's (see defaultHubOptions in server/hub.js), plus what
 * installing needs: `packageRoot`, `version`, and `cli` (bin/klose.js) for
 * starting the menu bar app. Without `cli`, setup never starts a process.
 */

function settingsPath(home) {
  return path.join(home, 'settings.json');
}

export async function readSetupSettings(home) {
  try {
    const parsed = JSON.parse(await readFile(settingsPath(home), 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeSetupSettings(home, patch) {
  const next = { ...(await readSetupSettings(home)), ...patch };
  for (const [key, value] of Object.entries(next)) if (value === undefined) delete next[key];
  await mkdir(home, { recursive: true });
  await writeFile(settingsPath(home), JSON.stringify(next, null, 2) + '\n', 'utf-8');
  return next;
}

const userHomeOf = (options) => options.userHome || os.homedir();

/** Everything the setup steps show, in one object. */
export async function setupState(options) {
  const { claudeDir, home, packageRoot } = options;
  const userHome = userHomeOf(options);
  const [settings, sessions, recent, repos, skills, tray] = await Promise.all([
    readSetupSettings(home),
    readLiveSessions(claudeDir),
    readRecentCwds(claudeDir, { force: true }),
    listRepos(options),
    packageRoot ? skillStatus(packageRoot, userHome) : [],
    findTray(home),
  ]);
  const macOS = process.platform === 'darwin';
  return {
    claudeCode: {
      found: existsSync(claudeDir),
      dir: tildePath(claudeDir),
      sessions: sessions.length,
      working: sessions.filter((s) => s.status === 'working').length,
      recentFolders: recent.length,
    },
    repos,
    skills: {
      dir: tildePath(path.join(userHome, '.claude', 'skills')),
      installed: skills.length > 0 && skills.every((s) => s.state === 'current' || s.state === 'edited'),
      list: skills,
    },
    menuBar: {
      // The menu bar app is compiled on this machine, so it needs clang too.
      supported: macOS,
      canBuild: macOS && hasClang(),
      running: tray.state === 'running',
      startAtLogin: macOS && startsAtLogin(userHome),
    },
    onboarding: {
      completed: Boolean(settings.onboardingCompletedAt),
      completedAt: settings.onboardingCompletedAt || null,
    },
  };
}

/** Installs the skills for every repo (~/.claude/skills). Resolves to installSkills' report. */
export async function installGlobalSkills(options) {
  if (!options.packageRoot) throw new HttpError('This server cannot install skills', 400, 'SETUP_UNAVAILABLE');
  return installSkills(options.packageRoot, userHomeOf(options));
}

/**
 * Lists a folder on the hub, the way `klose hub add` does. The path comes from
 * a person typing it on the setup page, so it is checked the same way: it must
 * exist, be a folder, and not be the home directory. `~` is expanded.
 */
export async function addRepoFolder(options, input) {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) throw new HttpError('Type the path of a folder', 400, 'PATH_REQUIRED');
  const userHome = userHomeOf(options);
  const expanded = raw === '~' ? userHome : raw.startsWith('~/') ? path.join(userHome, raw.slice(2)) : raw;
  if (!path.isAbsolute(expanded)) throw new HttpError('Use a full path, like ~/code/my-app', 400, 'PATH_NOT_ABSOLUTE');
  let isDir = false;
  try {
    isDir = statSync(expanded).isDirectory();
  } catch {
    // Missing.
  }
  if (!isDir) throw new HttpError(`No folder at ${raw}`, 400, 'PATH_NOT_FOUND');
  const root = resolveRoot(expanded);
  if (root === userHome || root === os.homedir()) throw new HttpError('Your home folder is not a repo — pick a project inside it', 400, 'PATH_IS_HOME');
  const added = await rememberRepo(root, options.home);
  return { root, added };
}

/** Starts the menu bar app in the background (it compiles itself on first run). */
function startMenuBar(options) {
  const child = spawn(process.execPath, [options.cli, 'tray'], { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  child.unref();
}

/**
 * The last step: applies the choices, then marks setup finished. Choices are
 * applied only here, not as they're toggled, so leaving the page halfway
 * changes nothing on the machine. Resolves to { state, warnings }.
 */
export async function finishSetup(options, { menuBar, startAtLogin } = {}) {
  const warnings = [];
  if (process.platform === 'darwin' && options.cli) {
    if (typeof startAtLogin === 'boolean' && startAtLogin !== startsAtLogin(userHomeOf(options))) {
      try {
        await setStartAtLogin(startAtLogin, { ...options, node: process.execPath });
      } catch (err) {
        warnings.push(`Start at login is off: ${err.message}`);
      }
    }
    if (menuBar === true && (await findTray(options.home)).state !== 'running') {
      if (hasClang()) startMenuBar(options);
      else warnings.push("The menu bar app needs Apple's command line tools. Install them with: xcode-select --install");
    }
  }
  await writeSetupSettings(options.home, { onboardingCompletedAt: new Date().toISOString() });
  return { state: await setupState(options), warnings };
}

/** "Run setup again": forgets that it was finished. Nothing else is undone. */
export async function resetSetup(options) {
  await writeSetupSettings(options.home, { onboardingCompletedAt: undefined });
  return setupState(options);
}
