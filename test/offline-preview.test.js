import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

test('the sandbox screenshot module never reaches the network', async () => {
  const source = await readFile(path.join(root, 'preview/screenshot.ts'), 'utf-8');
  const urls = [...new Set(source.match(/https?:\/\/[^\s'"`)]+/g) || [])].sort();
  // XML namespaces are identifiers, not addresses — nothing is ever fetched
  // from them, and an opaque-origin sandbox could not fetch them anyway.
  assert.deepEqual(urls, ['http://www.w3.org/1999/xhtml', 'http://www.w3.org/2000/svg']);
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|importScripts/);
  // The image the capture rasterizes has to be a data URL: the CSP allows
  // `img-src data: blob:` and nothing else.
  assert.match(source, /data:image\/svg\+xml/);
});

test('screenshots leave the sandbox only as postMessage replies', async () => {
  const runtime = await readFile(path.join(root, 'preview-runtime.tsx'), 'utf-8');
  assert.match(runtime, /data\.type === 'capture'/);
  assert.match(runtime, /post\(\{ type: 'capture', id, dataUrl \}\)/);
  assert.match(runtime, /type: 'captureError'/);
});
