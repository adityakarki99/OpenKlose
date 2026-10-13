// Shared harness for the demo video: a static host for the built hosted canvas
// plus the title pages, and the in-memory repo folder the page is handed
// instead of a real directory picker (the same stand-in as
// test/browser-folder.test.js), seeded with the demo repo's real stylesheet so
// the canvas reads that repo's tokens.
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
/** The repo whose design system the sketches are styled with (OnCue, the CueHost repo). */
export const DEMO_REPO = process.env.DEMO_REPO || path.resolve(ROOT, '..', 'CueHost');
export const WORK = path.join(HERE, '.work');
export const STATIC_DIR = path.join(ROOT, 'web', 'static');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

/** Serves web/static, with /pages/* from this folder (the title cards). */
export function serve() {
  const pages = path.join(HERE, 'pages');
  const server = createServer((req, res) => {
    const clean = decodeURIComponent(req.url.split('?')[0]);
    let file;
    if (clean.startsWith('/pages/')) file = path.join(pages, clean.slice('/pages/'.length));
    else {
      file = path.join(STATIC_DIR, clean === '/' ? 'index.html' : clean);
      if (!file.startsWith(STATIC_DIR) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(STATIC_DIR, 'index.html');
    }
    if (!existsSync(file)) { res.writeHead(404); res.end(); return; }
    // The preview sandbox has an opaque origin, so its bundle needs CORS, as on GitHub Pages.
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` })));
}

/** What the fake repo folder starts with: the real files the theme reader looks at, plus the Klose file. */
export function seedFiles(project) {
  const read = (rel) => (existsSync(path.join(DEMO_REPO, rel)) ? readFileSync(path.join(DEMO_REPO, rel), 'utf8') : '');
  return [
    { name: 'index.css', text: read('index.css') },
    { name: 'index.html', text: read('index.html') },
    { name: 'package.json', text: read('package.json') },
    { name: 'README.md', text: read('README.md') },
    { name: 'tailwind.config.js', text: read('tailwind.config.js') },
    { name: 'App.tsx', text: '' },
    { name: 'components', entries: [{ name: 'ui', entries: [] }, { name: 'cards', entries: [] }, { name: 'run', entries: [] }, { name: 'cue', entries: [] }] },
    { name: 'server', entries: [] },
    { name: 'packages', entries: [{ name: 'design-system', entries: [] }] },
    { name: 'docs', entries: [] },
    ...(project
      ? [{ name: '.klose', entries: [
          { name: '.gitignore', text: 'server.json\nserver.log\ncanvas.json\n' },
          { name: 'projects', entries: [{ name: `${project.id}.json`, text: JSON.stringify(project, null, 2) }] },
        ] }]
      : []),
  ];
}

/** Installed before the page's scripts: `showDirectoryPicker` hands out an in-memory folder named cuehost. */
export function folderShim(seed) {
  return `
  class MemFile {
    constructor(name) { this.kind = 'file'; this.name = name; this.text = ''; this.lastModified = Date.now(); }
    async getFile() { return new File([this.text], this.name, { lastModified: this.lastModified }); }
    async createWritable() {
      let buffer = '';
      return {
        write: async (data) => { buffer += typeof data === 'string' ? data : await new Response(data).text(); },
        close: async () => { this.text = buffer; this.lastModified = Date.now(); persist(); },
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
    async removeEntry(name) { if (!this.entries.delete(name)) throw new DOMException('not found', 'NotFoundError'); persist(); }
    async *values() { yield* this.entries.values(); }
    async queryPermission() { return 'granted'; }
    async requestPermission() { return 'granted'; }
  }
  const KEY = 'klose-demo-folder';
  const toJson = (dir) => [...dir.entries.values()].map((e) => (e.kind === 'file' ? { name: e.name, text: e.text, lastModified: e.lastModified } : { name: e.name, entries: toJson(e) }));
  const fromJson = (dir, items) => { for (const item of items) { if ('entries' in item) { const d = new MemDir(item.name); fromJson(d, item.entries); dir.entries.set(item.name, d); } else { const f = new MemFile(item.name); f.text = item.text; f.lastModified = item.lastModified || Date.now(); dir.entries.set(item.name, f); } } };
  const root = new MemDir('cuehost');
  let seeded = false;
  try { const saved = sessionStorage.getItem(KEY); if (saved) { fromJson(root, JSON.parse(saved)); seeded = true; } } catch {}
  if (!seeded) fromJson(root, ${JSON.stringify(seed)});
  const persist = () => { try { sessionStorage.setItem(KEY, JSON.stringify(toJson(root))); } catch {} };
  root.__shim = () => {};
  // A real picker dialog would open here; the demo hands the folder over after a beat.
  window.showDirectoryPicker = () => new Promise((resolve) => setTimeout(() => resolve(root), 900));
  // The agent's side: read and write the same files from outside the page.
  window.__folder = {
    read(filePath) { let dir = root; for (const name of filePath.slice(0, -1)) { dir = dir.entries.get(name); if (!dir) return null; } return dir.entries.get(filePath[filePath.length - 1])?.text ?? null; },
    write(filePath, text) {
      let dir = root;
      for (const name of filePath.slice(0, -1)) { let next = dir.entries.get(name); if (!next) { next = new MemDir(name); dir.entries.set(name, next); } dir = next; }
      const name = filePath[filePath.length - 1];
      let file = dir.entries.get(name);
      if (!file) { file = new MemFile(name); dir.entries.set(name, file); }
      file.text = text; file.lastModified = Date.now(); persist();
    },
  };
  `;
}

/** A visible pointer for the recording: Playwright moves the real mouse, this draws it (top frame only). */
export const CURSOR_SHIM = `
  (() => {
    if (window.top !== window) return;
    const make = () => {
      if (document.getElementById('demo-cursor')) return;
      const c = document.createElement('div');
      c.id = 'demo-cursor';
      c.innerHTML = '<svg width="26" height="30" viewBox="0 0 26 30" xmlns="http://www.w3.org/2000/svg"><path d="M3 2 L3 24 L8.5 18.8 L12.5 27.5 L16.8 25.5 L12.9 17 L20 17 Z" fill="#111114" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>';
      Object.assign(c.style, { position: 'fixed', left: '0px', top: '0px', zIndex: '2147483647', pointerEvents: 'none', transform: 'translate(-3px,-2px)', filter: 'drop-shadow(0 2px 4px rgb(0 0 0 / 0.35))', transition: 'opacity 200ms', opacity: '0' });
      document.documentElement.appendChild(c);
      const st = document.createElement('style'); st.textContent = '@keyframes demo-ripple { from { transform: scale(0.3); opacity: 0.9 } to { transform: scale(1.3); opacity: 0 } }';
      (document.head || document.documentElement).appendChild(st);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', make); else make();
    // A clock the recording can read back: the screencast's frame timing drifts
    // from wall time, so assemble.py maps each scene's start through this.
    const clock = () => {
      let strip = document.getElementById('demo-clock');
      if (!strip) {
        strip = document.createElement('div'); strip.id = 'demo-clock';
        Object.assign(strip.style, { position: 'fixed', left: '0px', top: '0px', height: '4px', width: '96px', zIndex: '2147483647', pointerEvents: 'none', display: 'flex', background: '#000' });
        for (let i = 0; i < 16; i++) { const c = document.createElement('i'); Object.assign(c.style, { display: 'block', width: '6px', height: '4px', background: '#000' }); strip.appendChild(c); }
        document.documentElement.appendChild(strip);
      }
      const v = Math.min(65535, Math.round((Date.now() - (window.__T0 || 0)) / 100));
      for (let i = 0; i < 16; i++) strip.children[i].style.background = (v >> (15 - i)) & 1 ? '#fff' : '#000';
    };
    const startClock = () => { clock(); setInterval(clock, 50); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startClock); else startClock();
    window.__cursor = (x, y, show = true) => { make(); const c = document.getElementById('demo-cursor'); c.style.transition = 'opacity 200ms'; c.style.left = x + 'px'; c.style.top = y + 'px'; c.style.opacity = show ? '1' : '0'; };
    window.__glide = (x, y, ms) => { make(); const c = document.getElementById('demo-cursor'); c.style.transition = 'left ' + ms + 'ms cubic-bezier(.45,0,.3,1), top ' + ms + 'ms cubic-bezier(.45,0,.3,1), opacity 200ms'; c.style.left = x + 'px'; c.style.top = y + 'px'; c.style.opacity = '1'; };
    window.__click = () => { const c = document.getElementById('demo-cursor'); if (!c) return; const r = document.createElement('div'); Object.assign(r.style, { position: 'fixed', left: c.style.left, top: c.style.top, width: '36px', height: '36px', marginLeft: '-18px', marginTop: '-18px', borderRadius: '999px', border: '2px solid rgb(31 95 139)', zIndex: '2147483646', pointerEvents: 'none', animation: 'demo-ripple 450ms ease-out forwards' }); document.documentElement.appendChild(r); setTimeout(() => r.remove(), 500); };
  })();
`;

/** Smooth pointer movement, driving both the real mouse and the drawn cursor. */
export class Pointer {
  constructor(page) { this.page = page; this.x = 960; this.y = 540; }
  async show() { await this.page.evaluate(([x, y]) => window.__cursor?.(x, y, true), [this.x, this.y]); }
  async hide() { await this.page.evaluate(() => window.__cursor?.(0, 0, false)); }
  async moveTo(x, y, ms = 600) {
    // The drawn cursor glides by CSS transition (one round-trip); the real
    // mouse follows in a few steps so hover states still fire.
    await this.page.evaluate(([px, py, d]) => window.__glide?.(px, py, d), [x, y, ms]).catch(() => {});
    const steps = 2;
    const sx = this.x, sy = this.y;
    const started = Date.now();
    for (let i = 1; i <= steps; i++) {
      const t = i / steps; const e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      await this.page.mouse.move(sx + (x - sx) * e, sy + (y - sy) * e);
      const due = started + (ms * i) / steps - Date.now();
      if (due > 0) await this.page.waitForTimeout(due);
    }
    this.x = x; this.y = y;
  }
  async click(x, y, ms = 600) {
    await this.moveTo(x, y, ms);
    await this.page.waitForTimeout(120);
    await this.page.evaluate(() => window.__click?.()).catch(() => {});
    await this.page.mouse.down(); await this.page.waitForTimeout(70); await this.page.mouse.up();
  }
  async clickEl(locator, ms = 600) {
    const box = await locator.boundingBox();
    if (!box) throw new Error('no box for element');
    await this.click(box.x + box.width / 2, box.y + box.height / 2, ms);
    return box;
  }
}

/** Plays the agent's CLI: read the project file, change it, write it back. */
export const agentWrites = (page, projectId, mutate) =>
  page.evaluate(([id, fn]) => {
    const file = ['.klose', 'projects', `${id}.json`];
    const project = JSON.parse(window.__folder.read(file));
    new Function('project', fn)(project);
    project.updated_at = new Date(Date.now() + 1).toISOString();
    window.__folder.write(file, JSON.stringify(project, null, 2));
  }, [projectId, mutate]);
