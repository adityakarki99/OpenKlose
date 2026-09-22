import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installSkills } from '../server/skills.js';

// A fake package root with one skill, plus an empty target repo.
async function withPackageAndRepo(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'klose-skills-test-'));
  const pkg = path.join(dir, 'pkg');
  const repo = path.join(dir, 'repo');
  await mkdir(path.join(pkg, 'skills', 'klose'), { recursive: true });
  await mkdir(repo);
  const setSkill = (text) => writeFile(path.join(pkg, 'skills', 'klose', 'SKILL.md'), text, 'utf-8');
  const installed = path.join(repo, '.claude', 'skills', 'klose', 'SKILL.md');
  try {
    await fn({ pkg, repo, setSkill, installed });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('an untouched skill is replaced by the new version', async () => {
  await withPackageAndRepo(async ({ pkg, repo, setSkill, installed }) => {
    await setSkill('v1');
    assert.deepEqual((await installSkills(pkg, repo)).installed, ['klose']);
    await setSkill('v2');
    const report = await installSkills(pkg, repo);
    assert.deepEqual(report.updated, ['klose']);
    assert.deepEqual(report.backedUp, []);
    assert.equal(await readFile(installed, 'utf-8'), 'v2');
  });
});

test('a skill the user edited is left alone unless forced, and forcing keeps a backup', async () => {
  await withPackageAndRepo(async ({ pkg, repo, setSkill, installed }) => {
    await setSkill('v1');
    await installSkills(pkg, repo);
    await writeFile(installed, 'v1 + my house rules', 'utf-8');
    await setSkill('v2');

    const skipped = await installSkills(pkg, repo);
    assert.deepEqual(skipped.skipped, ['klose']);
    assert.equal(await readFile(installed, 'utf-8'), 'v1 + my house rules');

    const forced = await installSkills(pkg, repo, { force: true });
    assert.deepEqual(forced.updated, ['klose']);
    assert.equal(await readFile(installed, 'utf-8'), 'v2');
    assert.equal(await readFile(`${installed}.bak`, 'utf-8'), 'v1 + my house rules');
  });
});

test('an install from before the manifest existed is backed up, then updated', async () => {
  await withPackageAndRepo(async ({ pkg, repo, setSkill, installed }) => {
    await mkdir(path.dirname(installed), { recursive: true });
    await writeFile(installed, 'old release, or maybe edited', 'utf-8');
    await setSkill('v2');
    const report = await installSkills(pkg, repo);
    assert.deepEqual(report.updated, ['klose']);
    assert.deepEqual(report.backedUp, ['klose']);
    assert.equal(await readFile(installed, 'utf-8'), 'v2');
    assert.ok(existsSync(`${installed}.bak`));
  });
});
