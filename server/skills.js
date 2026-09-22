import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Copies every skill that ships with the package (klose, klose-update,
 * klose-cleanup, ...) into `<root>/.claude/skills/`, without clobbering edits.
 *
 * `.klose/skills.json` records the hash of each SKILL.md as Klose last wrote
 * it. On the next `init` or `update`:
 *
 *   - a file that still matches that hash is Klose's own copy → replaced;
 *   - a file that differs from it was edited by the user → left alone and
 *     reported, unless `force` (which first saves it as SKILL.md.bak);
 *   - a file with no recorded hash predates the manifest, so there's no way to
 *     tell an old release from a hand edit → saved as SKILL.md.bak, then
 *     replaced. Nothing is ever lost, and old installs still update.
 */

const MANIFEST = path.join('.klose', 'skills.json');

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

async function readManifest(root) {
  try {
    return JSON.parse(await readFile(path.join(root, MANIFEST), 'utf-8'));
  } catch {
    return {};
  }
}

export async function installSkills(fromPackageRoot, root, { force = false } = {}) {
  const skillsRoot = path.join(fromPackageRoot, 'skills');
  const entries = await readdir(skillsRoot, { withFileTypes: true });
  const manifest = await readManifest(root);
  const report = { installed: [], updated: [], unchanged: [], skipped: [], backedUp: [] };

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const srcFile = path.join(skillsRoot, entry.name, 'SKILL.md');
    if (!existsSync(srcFile)) continue;
    const name = entry.name;
    const incoming = await readFile(srcFile, 'utf-8');
    const destDir = path.join(root, '.claude', 'skills', name);
    const destFile = path.join(destDir, 'SKILL.md');

    let current = null;
    try {
      current = await readFile(destFile, 'utf-8');
    } catch {
      // Not installed yet.
    }

    if (current === null) {
      await mkdir(destDir, { recursive: true });
      await writeFile(destFile, incoming, 'utf-8');
      report.installed.push(name);
    } else if (current === incoming) {
      report.unchanged.push(name);
    } else {
      const recorded = manifest[name];
      const editedByUser = recorded ? sha256(current) !== recorded : true;
      if (editedByUser && recorded && !force) {
        report.skipped.push(name);
        continue;
      }
      if (editedByUser) {
        await copyFile(destFile, `${destFile}.bak`);
        report.backedUp.push(name);
      }
      await writeFile(destFile, incoming, 'utf-8');
      report.updated.push(name);
    }
    manifest[name] = sha256(incoming);
  }

  await mkdir(path.join(root, '.klose'), { recursive: true });
  await writeFile(path.join(root, MANIFEST), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  return report;
}
