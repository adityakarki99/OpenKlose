import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The hosted canvas (`npm run build:static`, web/static) driven in headless
// Chromium with no server at all: the page is given a folder and reads and
// writes .klose/ in it. The folder is an in-memory stand-in for the File
// System Access API (a real folder needs a real picker dialog), installed
// before the page's scripts run. Like the other browser tests, this needs
// Playwright and the build, and skips without them; CI's build job has both.

let playwright;
try {
  playwright = await import('playwright');
} catch {
  // Optional in local development.
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'web', 'static');
const executable = playwright?.chromium?.executablePath?.();
const canRun = !!executable && existsSync(executable) && existsSync(path.join(publicDir, 'index.html'));
const skip = canRun ? false : 'Chromium or the built hosted canvas (web/static) unavailable';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

/** A static host with nothing else: what GitHub Pages is. */
function serveStatic(dir) {
  return createServer((req, res) => {
    const clean = decodeURIComponent(req.url.split('?')[0]);
    let file = path.join(dir, clean === '/' ? 'index.html' : clean);
    if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(dir, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
    createReadStream(file).pipe(res);
  });
}

// Installed in the page before any script runs: `showDirectoryPicker` hands
// out an in-memory folder named acme-web with the shape the canvas uses
// (getDirectoryHandle, getFileHandle, values, getFile, createWritable,
// removeEntry). `window.__folder` lets the test play the agent: read and
// write the same files from outside the page.
const FOLDER_SHIM = `
  class MemFile {
    constructor(name) { this.kind = 'file'; this.name = name; this.text = ''; this.lastModified = Date.now(); }
    async getFile() { return new File([this.text], this.name, { lastModified: this.lastModified }); }
    async createWritable() {
      let buffer = '';
      return {
        write: async (data) => { buffer += typeof data === 'string' ? data : await new Response(data).text(); },
        close: async () => { this.text = buffer; this.lastModified = Date.now(); },
        abort: async () => {},
      };
    }
  }
  class MemDir {
    constructor(name) { this.kind = 'directory'; this.name = name; this.entries = new Map(); }
    async getDirectoryHandle(name, { create = false } = {}) {
      let entry = this.entries.get(name);
      if (!entry) { if (!create) throw new DOMException('not found', 'NotFoundError'); entry = new MemDir(name); this.entries.set(name, entry); }
      if (entry.kind !== 'directory') throw new DOMException('not a directory', 'TypeMismatchError');
      return entry;
    }
    async getFileHandle(name, { create = false } = {}) {
      let entry = this.entries.get(name);
      if (!entry) { if (!create) throw new DOMException('not found', 'NotFoundError'); entry = new MemFile(name); this.entries.set(name, entry); }
      if (entry.kind !== 'file') throw new DOMException('not a file', 'TypeMismatchError');
      return entry;
    }
    async removeEntry(name) { if (!this.entries.delete(name)) throw new DOMException('not found', 'NotFoundError'); }
    async *values() { yield* this.entries.values(); }
    async queryPermission() { return 'granted'; }
    async requestPermission() { return 'granted'; }
  }
  // A real folder outlives the page; this one is kept in sessionStorage so a
  // reload finds the same files.
  const KEY = 'klose-test-folder';
  const toJson = (dir) => [...dir.entries.values()].map((e) => (e.kind === 'file' ? { name: e.name, text: e.text, lastModified: e.lastModified } : { name: e.name, entries: toJson(e) }));
  const fromJson = (dir, items) => { for (const item of items) { if ('entries' in item) { const d = new MemDir(item.name); fromJson(d, item.entries); dir.entries.set(item.name, d); } else { const f = new MemFile(item.name); f.text = item.text; f.lastModified = item.lastModified; dir.entries.set(item.name, f); } } };
  const root = new MemDir('acme-web');
  try { fromJson(root, JSON.parse(sessionStorage.getItem(KEY) || '[]')); } catch {}
  const persist = () => { try { sessionStorage.setItem(KEY, JSON.stringify(toJson(root))); } catch {} };
  const closeWritable = MemFile.prototype.createWritable;
  MemFile.prototype.createWritable = async function () { const w = await closeWritable.call(this); const close = w.close; w.close = async () => { await close(); persist(); }; return w; };
  const removeEntry = MemDir.prototype.removeEntry;
  MemDir.prototype.removeEntry = async function (name) { await removeEntry.call(this, name); persist(); };
  // A function-valued property can't be structured-cloned, so IndexedDB
  // refuses to remember this handle: the "reopen" path needs a real browser.
  root.__shim = () => {};
  window.showDirectoryPicker = async () => root;
  window.__folder = {
    list(dirPath) {
      let dir = root;
      for (const name of dirPath) { dir = dir.entries.get(name); if (!dir) return []; }
      return [...dir.entries.keys()];
    },
    read(filePath) {
      let dir = root;
      for (const name of filePath.slice(0, -1)) { dir = dir.entries.get(name); if (!dir) return null; }
      return dir.entries.get(filePath[filePath.length - 1])?.text ?? null;
    },
    write(filePath, text) {
      let dir = root;
      for (const name of filePath.slice(0, -1)) { let next = dir.entries.get(name); if (!next) { next = new MemDir(name); dir.entries.set(name, next); } dir = next; }
      const name = filePath[filePath.length - 1];
      let file = dir.entries.get(name);
      if (!file) { file = new MemFile(name); dir.entries.set(name, file); }
      file.text = text;
      file.lastModified = Date.now();
      persist();
    },
  };
`;

let browser;
let server;
let origin;

before(async () => {
  if (!canRun) return;
  server = serveStatic(publicDir);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await playwright.chromium.launch({ executablePath: executable, headless: true });
});

after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

/** Polls `fn` until it returns a truthy value, or fails with `what`. */
async function eventually(fn, what, timeout = 10000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail(`${what} (last: ${JSON.stringify(last)})`);
}

async function openPage() {
  const context = await browser.newContext();
  await context.addInitScript(FOLDER_SHIM);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return { context, page, errors };
}

test('opening a folder, then the example, writes .klose/ into that folder and shows the sketch', { skip }, async () => {
  const { context, page, errors } = await openPage();
  try {
    await page.goto(`${origin}/#/`);
    await page.getByTestId('choose-folder').click();
    await eventually(() => page.url().endsWith('#/projects'), 'the files page opens once the folder is picked');
    assert.deepEqual(await page.evaluate(() => window.__folder.list(['.klose'])), [], 'looking at an empty repo writes nothing into it');
    await page.getByText('acme-web', { exact: true }).first().waitFor();

    await page.getByRole('button', { name: 'Open an example' }).click();
    await eventually(() => /#\/canvas\/[0-9a-f-]{36}$/.test(page.url()), 'the example opens on the canvas');
    await page.getByText('Welcome to Klose', { exact: true }).first().waitFor();

    const files = await page.evaluate(() => window.__folder.list(['.klose', 'projects']));
    assert.equal(files.length, 1);
    assert.match(files[0], /^[0-9a-f-]{36}\.json$/);
    const project = JSON.parse(await page.evaluate((f) => window.__folder.read(['.klose', 'projects', f]), files[0]));
    assert.equal(project.name, 'Klose demo');
    assert.equal(project.nodes[0].name, 'Welcome to Klose');
    assert.ok((await page.evaluate(() => window.__folder.read(['.klose', '.gitignore']))).includes('canvas.json'));
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('a sketch the agent writes into the folder appears on the open canvas without a reload', { skip }, async () => {
  const { context, page, errors } = await openPage();
  try {
    await page.goto(`${origin}/#/`);
    await page.getByTestId('choose-folder').click();
    await page.getByRole('button', { name: 'Open an example' }).click();
    await page.getByText('Welcome to Klose', { exact: true }).first().waitFor();
    const projectFile = (await page.evaluate(() => window.__folder.list(['.klose', 'projects'])))[0];

    // The agent's CLI: read the project, add a sketch, write it back.
    await page.evaluate((file) => {
      const project = JSON.parse(window.__folder.read(['.klose', 'projects', file]));
      const now = Date.now();
      project.nodes.push({
        id: 'agent-node', name: 'Agent card', description: '', x: 800, y: 160, width: 480, height: 360,
        createdAt: now, updatedAt: now, status: 'sketch',
        code: 'export default function Card() { return <div className="p-4">From the agent</div>; }',
      });
      project.updated_at = new Date(now + 1).toISOString();
      window.__folder.write(['.klose', 'projects', file], JSON.stringify(project, null, 2));
    }, projectFile);

    await page.getByText('Agent card', { exact: true }).first().waitFor({ timeout: 10000 });
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('after a reload the canvas asks for the folder again, then returns to the sketch', { skip }, async () => {
  const { context, page, errors } = await openPage();
  try {
    await page.goto(`${origin}/#/`);
    await page.getByTestId('choose-folder').click();
    await page.getByRole('button', { name: 'Open an example' }).click();
    await page.getByText('Welcome to Klose', { exact: true }).first().waitFor();
    const canvasUrl = page.url();

    await page.reload();
    await eventually(() => page.url().endsWith('#/'), 'a page without an open folder sends you to the front door');
    await page.getByTestId('choose-folder').click();
    await eventually(() => page.url() === canvasUrl, 'picking the folder again comes back to where you were');
    await page.getByText('Welcome to Klose', { exact: true }).first().waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});
