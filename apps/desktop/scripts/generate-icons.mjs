#!/usr/bin/env node
// Draws Klose's icons from geometry, with no image tools or dependencies (the
// way antiburn draws its own), so they can be regenerated anywhere:
//
//   icons/app-icon.png         1024px app icon; `tauri icon` turns it into the
//                              .icns / .ico / PNG set in src-tauri/icons/
//   src-tauri/icons/tray-*.png the menu bar / tray icon in each state
//
// The logo is the canvas's: a filled circle. In the menu bar it is a template
// image (macOS tints it for light and dark bars) while nothing needs you, and
// takes a colour when something does: blue while an agent works, amber when
// comments are waiting — the same colours as the hub's dots.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
/** RGBA pixels (Float32 0..1, premultiplied-free) → PNG bytes. */
function png(size, pixels) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size * 4; x++) raw[y * (size * 4 + 1) + 1 + x] = Math.round(Math.min(1, Math.max(0, pixels[y * size * 4 + x])) * 255);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Renders layers onto a transparent square. Each layer is a coverage function
 * (x, y in 0..size → inside?) and a colour; 4×4 supersampling antialiases.
 */
function render(size, layers) {
  const px = new Float32Array(size * size * 4);
  const S = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let [r, g, b, a] = [0, 0, 0, 0];
      for (const { inside, color } of layers) {
        let hits = 0;
        for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) if (inside(x + (sx + 0.5) / S, y + (sy + 0.5) / S)) hits++;
        const cov = (hits / (S * S)) * (color[3] ?? 1);
        if (!cov) continue;
        // "over" compositing
        const na = cov + a * (1 - cov);
        r = (color[0] * cov + r * a * (1 - cov)) / na;
        g = (color[1] * cov + g * a * (1 - cov)) / na;
        b = (color[2] * cov + b * a * (1 - cov)) / na;
        a = na;
      }
      px.set([r, g, b, a], (y * size + x) * 4);
    }
  }
  return png(size, px);
}

const hex = (h, alpha = 1) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255, alpha];
const circle = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
function roundedRect(x0, y0, x1, y1, radius) {
  return (x, y) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const dx = Math.max(x0 + radius - x, 0, x - (x1 - radius));
    const dy = Math.max(y0 + radius - y, 0, y - (y1 - radius));
    return dx * dx + dy * dy <= radius * radius;
  };
}

// App icon: macOS's grid puts the tile at 824/1024 with a ~185px corner.
function appIcon() {
  const n = 1024;
  const tile = roundedRect(100, 100, 924, 924, 185);
  return render(n, [
    { inside: tile, color: hex('#0b1220') },
    // A faint blue halo, like the logo's glow on the hub page.
    { inside: circle(512, 512, 300), color: hex('#3b82f6', 0.10) },
    { inside: circle(512, 512, 262), color: hex('#3b82f6', 0.14) },
    { inside: circle(512, 512, 226), color: hex('#f8fafc') },
  ]);
}

// Tray: 44px is the menu bar's 22pt at 2x. The circle matches the old
// Objective-C tray (an 18pt box inset 3.5pt → 11pt across).
function trayIcon(color) {
  const n = 44;
  return render(n, [{ inside: circle(22, 22, 11), color }]);
}

mkdirSync(path.join(desktop, 'icons'), { recursive: true });
mkdirSync(path.join(desktop, 'src-tauri', 'icons'), { recursive: true });
writeFileSync(path.join(desktop, 'icons', 'app-icon.png'), appIcon());
const tray = {
  'tray-template.png': hex('#000000'), // macOS: tinted by the system
  'tray-plain.png': hex('#a1a1aa'), // Windows: a grey that reads on light and dark taskbars
  'tray-working.png': hex('#3b82f6'),
  'tray-feedback.png': hex('#f59e0b'),
};
for (const [name, color] of Object.entries(tray)) writeFileSync(path.join(desktop, 'src-tauri', 'icons', name), trayIcon(color));
console.log(`icons/app-icon.png and ${Object.keys(tray).length} tray icons written`);
