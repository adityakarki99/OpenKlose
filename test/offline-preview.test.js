import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

test('preview iframe keeps an opaque origin and the runtime blocks network connections', async () => {
  const previewComponent = await readFile(path.join(root, 'components/Runtime/Preview.tsx'), 'utf-8');
  const previewHtml = await readFile(path.join(root, 'preview.html'), 'utf-8');
  assert.match(previewComponent, /sandbox="allow-scripts"/);
  const sandboxAttribute = previewComponent.match(/sandbox="([^"]+)"/)?.[1];
  assert.equal(sandboxAttribute, 'allow-scripts');
  assert.match(previewHtml, /connect-src 'none'/);
  assert.match(previewHtml, /img-src data: blob:/);
  assert.doesNotMatch(previewHtml, /cdn\.tailwindcss|esm\.sh|unpkg\.com|fonts\.googleapis/);
});

test('host and preview entrypoints contain no external runtime URLs', async () => {
  for (const file of ['index.html', 'preview.html', 'index.tsx', 'preview-runtime.tsx']) {
    const source = await readFile(path.join(root, file), 'utf-8');
    assert.doesNotMatch(source, /https?:\/\//, file);
  }
});
