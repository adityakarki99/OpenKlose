import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scanComponents, filterComponents, readComponentSource } from '../server/scanner.js';

async function withTempRepo(files, fn) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'klose-scanner-test-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(cwd, rel);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, content, 'utf-8');
    }
    await fn(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

const BUTTON_SOURCE = `import React from 'react';

interface ButtonProps {
  label: string;
  onClick?: () => void;
  variant?: 'primary' | 'secondary';
}

/** Primary action button. */
export function Button({ label, onClick, variant = 'primary' }: ButtonProps) {
  return <button className={\`btn btn-\${variant}\`} onClick={onClick}>{label}</button>;
}
`;

test('scanComponents finds an exported function component with its doc comment and props', async () => {
  await withTempRepo({ 'src/components/Button.tsx': BUTTON_SOURCE }, async (cwd) => {
    const { components, repo } = await scanComponents(cwd, { force: true });
    assert.equal(repo.root, cwd);
    assert.equal(components.length, 1);

    const [button] = components;
    assert.equal(button.name, 'Button');
    assert.equal(button.file, path.join('src', 'components', 'Button.tsx'));
    assert.equal(button.description, 'Primary action button.');
    assert.equal(button.previewable, true);
    assert.deepEqual(
      button.props.map((p) => p.name),
      ['label', 'onClick', 'variant']
    );
  });
});

test('scanComponents ignores node_modules and non-component files', async () => {
  await withTempRepo(
    {
      'node_modules/some-lib/Fake.tsx': BUTTON_SOURCE,
      'src/utils.ts': 'export function add(a: number, b: number) { return a + b; }',
    },
    async (cwd) => {
      const { components } = await scanComponents(cwd, { force: true });
      assert.equal(components.length, 0);
    }
  );
});

test('filterComponents matches by name, file, or description (case-insensitive)', async () => {
  await withTempRepo({ 'src/components/Button.tsx': BUTTON_SOURCE }, async (cwd) => {
    const { components } = await scanComponents(cwd, { force: true });
    assert.equal(filterComponents(components, 'button').length, 1);
    assert.equal(filterComponents(components, 'BUTTON').length, 1);
    assert.equal(filterComponents(components, 'primary action').length, 1);
    assert.equal(filterComponents(components, 'nonexistent').length, 0);
  });
});

test('readComponentSource returns the file contents for a real in-repo file', async () => {
  await withTempRepo({ 'src/components/Button.tsx': BUTTON_SOURCE }, async (cwd) => {
    const result = await readComponentSource(cwd, 'src/components/Button.tsx');
    assert.equal(result.source, BUTTON_SOURCE);
  });
});

test('readComponentSource rejects a path that escapes the project root', async () => {
  await withTempRepo({ 'src/components/Button.tsx': BUTTON_SOURCE }, async (cwd) => {
    await assert.rejects(
      () => readComponentSource(cwd, '../../../../etc/passwd'),
      /escapes project root/
    );
  });
});

test('readComponentSource rejects non-source file extensions', async () => {
  await withTempRepo({ 'package.json': '{}' }, async (cwd) => {
    await assert.rejects(() => readComponentSource(cwd, 'package.json'), /Not a source file/);
  });
});
