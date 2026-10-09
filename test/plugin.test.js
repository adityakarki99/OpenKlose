import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKILLS_DIR } from '../server/skills.js';

// The repo doubles as a Claude Code plugin marketplace: .claude-plugin/marketplace.json
// lists one plugin, sourced from ./plugin, whose skills/ are the same files `klose init`
// copies into repos. These tests keep the two manifests, the package and the skills in
// step, so a release can't ship a plugin that points at nothing or lags package.json.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = async (rel) => JSON.parse(await readFile(path.join(root, rel), 'utf-8'));

test('marketplace.json lists the klose plugin, sourced from ./plugin', async () => {
  const market = await json('.claude-plugin/marketplace.json');
  assert.equal(market.name, 'openklose');
  assert.ok(market.owner?.name);
  const entry = market.plugins.find((p) => p.name === 'klose');
  assert.ok(entry, 'a plugin named klose');
  assert.equal(entry.source, './plugin');
  assert.ok(existsSync(path.join(root, 'plugin', '.claude-plugin', 'plugin.json')));
});

test('plugin.json names the plugin klose and tracks the package version', async () => {
  const [plugin, pkg] = await Promise.all([json('plugin/.claude-plugin/plugin.json'), json('package.json')]);
  assert.equal(plugin.name, 'klose');
  assert.equal(plugin.version, pkg.version, 'plugin.json version must equal package.json version (it pins plugin users)');
  assert.equal(plugin.license, pkg.license);
});

test('the plugin carries only skills: one SKILL.md per directory, named after it, and no bin/', async () => {
  const pluginDir = path.join(root, 'plugin');
  const top = (await readdir(pluginDir)).sort();
  assert.deepEqual(top, ['.claude-plugin', 'skills'], 'anything else in plugin/ is cloned onto every user\'s machine');
  const skillsDir = path.join(root, SKILLS_DIR);
  const names = (await readdir(skillsDir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  assert.deepEqual(names, ['klose', 'klose-cleanup', 'klose-update']);
  for (const name of names) {
    const text = await readFile(path.join(skillsDir, name, 'SKILL.md'), 'utf-8');
    const m = text.match(/^---\n[\s\S]*?^name:\s*(\S+)\s*$[\s\S]*?^---/m);
    assert.ok(m, `${name}/SKILL.md has frontmatter with a name`);
    assert.equal(m[1], name);
  }
});

test('the package ships the plugin directory, so klose init and the plugin read the same files', async () => {
  const pkg = await json('package.json');
  assert.ok(pkg.files.includes('plugin'));
  assert.ok(!pkg.files.includes('skills'));
});
