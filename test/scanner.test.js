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

const PROP_CASES = [
  ['property names matching Object members', 'interface ButtonProps { constructor: string; toString?: string }', [
    { name: 'constructor', optional: false, type: 'string' }, { name: 'toString', optional: true, type: 'string' },
  ]],
  ['single-line interface', 'interface ButtonProps { label?: string; disabled?: boolean }', [
    { name: 'label', optional: true, type: 'string' }, { name: 'disabled', optional: true, type: 'boolean' },
  ]],
  ['single-line alias with comma separators', 'type ButtonProps = { label: string, disabled?: boolean };', [
    { name: 'label', optional: false, type: 'string' }, { name: 'disabled', optional: true, type: 'boolean' },
  ]],
  ['nested object, callback, tuple and generic', 'interface ButtonProps { options: { color: string; size: number }; onChange?: (a: string, b: number) => void; entries: Record<string, [number, boolean]>; disabled: boolean; }', [
    { name: 'options', optional: false, type: '{ color: string; size: number }' },
    { name: 'onChange', optional: true, type: '(a: string, b: number) => void' },
    { name: 'entries', optional: false, type: 'Record<string, [number, boolean]>' },
    { name: 'disabled', optional: false, type: 'boolean' },
  ]],
  ['comments and literal punctuation', 'interface ButtonProps { /* ignore }; fake: string */ label: "a;b,}"; // ignore fake: number\n readonly disabled?: boolean; }', [
    { name: 'label', optional: false, type: '"a;b,}"' }, { name: 'disabled', optional: true, type: 'boolean' },
  ]],
  ['semicolon-free members and multiline union', 'interface ButtonProps {\nlabel:\n  string\n  | number\ndisabled?: boolean\n}', [
    { name: 'label', optional: false, type: 'string | number' }, { name: 'disabled', optional: true, type: 'boolean' },
  ]],
  ['indented closing brace and inheritance', 'interface ButtonProps extends BaseProps {\n readonly label: string;\n  }', [
    { name: 'label', optional: false, type: 'string' },
  ]],
  ['declaration decoys in comments and strings', '// interface ButtonProps { wrong: boolean }\nconst text = "interface ButtonProps { fake: string }";\ninterface ButtonProps { label: string }', [
    { name: 'label', optional: false, type: 'string' },
  ]],
  ['adjacent unrelated declaration', 'interface ButtonProps { label: string }\ninterface OtherProps { wrong: boolean }', [
    { name: 'label', optional: false, type: 'string' },
  ]],
  ['escaped literal delimiters', String.raw`type ButtonProps = { label: 'it\'s;ok}'; disabled?: boolean }`, [
    { name: 'label', optional: false, type: String.raw`'it\'s;ok}'` }, { name: 'disabled', optional: true, type: 'boolean' },
  ]],
];

for (const [description, declaration, expected] of PROP_CASES) {
  test(`prop extraction: ${description}`, async () => {
    await withTempRepo({ 'Button.tsx': `${declaration}\nexport function Button() { return <button />; }` }, async (cwd) => {
      const { components } = await scanComponents(cwd, { force: true });
      assert.deepEqual(components[0].props, expected);
    });
  });
}

test('prop extraction remains capped at 16 direct props', async () => {
  const declaration = `type ButtonProps = { ${Array.from({ length: 20 }, (_, i) => `prop${i}: string;`).join(' ')} };`;
  await withTempRepo({ 'Button.tsx': `${declaration}\nexport function Button() { return <button />; }` }, async (cwd) => {
    const { components } = await scanComponents(cwd, { force: true });
    assert.equal(components[0].props.length, 16);
    assert.equal(components[0].props[15].name, 'prop15');
  });
});

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
