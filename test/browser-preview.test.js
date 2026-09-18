import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKloseServer } from '../server/http.js';

let playwright;
try {
  playwright = await import('playwright');
} catch {
  // Optional in local development; CI should provision Playwright + Chromium.
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'web', 'dist');
const executable = playwright?.chromium?.executablePath?.();
const canRun = !!executable && existsSync(executable) && existsSync(path.join(publicDir, 'preview.html'));

test('bundled preview renders with every external request blocked', { skip: canRun ? false : 'Chromium or built web assets unavailable' }, async () => {
  const server = createKloseServer({ cwd: root, publicDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await playwright.chromium.launch({ executablePath: executable, headless: true });
    const page = await browser.newPage();
    const externalRequests = [];
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) {
        externalRequests.push(url.href);
        return route.abort();
      }
      return route.continue();
    });
    await page.goto(origin);
    const result = await page.evaluate(async () => {
      const frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.src = '/preview.html';
      document.body.appendChild(frame);
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Preview did not render')), 15_000);
        addEventListener('message', function handler(event) {
          if (event.source !== frame.contentWindow || event.data?.source !== 'klose-sandbox') return;
          if (event.data.type === 'ready') {
            frame.contentWindow.postMessage({
              type: 'render',
              code: "import React from 'react'; export default function Demo(){ return <button>Offline OK</button>; }",
            }, '*');
          }
          if (event.data.type === 'error') reject(new Error(event.data.message));
          if (event.data.type === 'rendered') {
            clearTimeout(timeout);
            removeEventListener('message', handler);
            let isolated = false;
            try { void frame.contentDocument.body; } catch { isolated = true; }
            resolve({ isolated });
          }
        });
      });
    });
    assert.equal(result.isolated, true);
    // React commits asynchronously: the message alone is not evidence of a rendered DOM.
    await page.frameLocator('iframe[src="/preview.html"]').getByRole('button', { name: 'Offline OK' }).waitFor();
    assert.deepEqual(externalRequests, []);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('the sandbox screenshots itself and hands the PNG back over postMessage', { skip: canRun ? false : 'Chromium or built web assets unavailable' }, async () => {
  const server = createKloseServer({ cwd: root, publicDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await playwright.chromium.launch({ executablePath: executable, headless: true });
    const page = await browser.newPage();
    const externalRequests = [];
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) {
        externalRequests.push(url.href);
        return route.abort();
      }
      return route.continue();
    });
    await page.goto(origin);
    const result = await page.evaluate(async () => {
      const frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.src = '/preview.html';
      frame.style.width = '320px';
      frame.style.height = '200px';
      document.body.appendChild(frame);
      const send = (message) => frame.contentWindow.postMessage(message, '*');
      let asked = false;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('No screenshot came back')), 30_000);
        addEventListener('message', function handler(event) {
          if (event.source !== frame.contentWindow || event.data?.source !== 'klose-sandbox') return;
          const data = event.data;
          if (data.type === 'ready') {
            send({ type: 'surface', color: 'rgb(9, 9, 11)' });
            send({
              type: 'render',
              code: "import React from 'react'; export default function Demo(){ return <button className=\"w-40 h-20 bg-emerald-500\">Shoot me</button>; }",
            });
          }
          // The size report is the sandbox saying the component is in the DOM.
          // Tailwind compiles the component's classes in-page a moment later,
          // so give that a beat before asking for the picture.
          if (data.type === 'contentSize' && !asked) {
            asked = true;
            setTimeout(() => send({ type: 'capture', id: 'test-shot', scale: 2 }), 1000);
          }
          if (data.type === 'error' || data.type === 'captureError') {
            clearTimeout(timeout);
            removeEventListener('message', handler);
            reject(new Error(data.message));
          }
          if (data.type === 'capture') {
            clearTimeout(timeout);
            removeEventListener('message', handler);
            const image = new Image();
            image.onload = () => {
              const canvas = document.createElement('canvas');
              canvas.width = image.width;
              canvas.height = image.height;
              const context = canvas.getContext('2d');
              context.drawImage(image, 0, 0);
              // Inside the button but clear of its label, which sits dead centre.
              const middle = context.getImageData(image.width / 2, image.height / 2 - 60, 1, 1).data;
              const corner = context.getImageData(2, 2, 1, 1).data;
              resolve({
                dataUrl: image.src.slice(0, 32),
                width: image.width,
                height: image.height,
                middle: [...middle],
                corner: [...corner],
              });
            };
            image.onerror = () => reject(new Error('The returned screenshot is not a decodable image'));
            image.src = data.dataUrl;
          }
        });
      });
    });

    assert.match(result.dataUrl, /^data:image\/png;base64,/);
    // 320x200 CSS pixels captured at scale 2.
    assert.equal(result.width, 640);
    assert.equal(result.height, 400);
    // That pixel is the button's fill, painted by the Tailwind the sandbox
    // compiled at runtime — proof the capture carries the page's styles and the
    // component's real position, not a blank frame.
    assert.ok(result.middle[1] > 120 && result.middle[0] < 120, `button pixel was ${result.middle}`);
    // The corner is the surface color the canvas handed the sandbox.
    assert.deepEqual(result.corner, [9, 9, 11, 255]);
    assert.deepEqual(externalRequests, []);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('the sandbox reports the size its component wants, so a frame can be fitted to it', { skip: canRun ? false : 'Chromium or built web assets unavailable' }, async () => {
  const server = createKloseServer({ cwd: root, publicDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await playwright.chromium.launch({ executablePath: executable, headless: true });
    const page = await browser.newPage();
    await page.goto(origin);
    const size = await page.evaluate(async () => {
      const frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.src = '/preview.html';
      frame.style.width = '600px';
      frame.style.height = '400px';
      document.body.appendChild(frame);
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('No content size was reported')), 15_000);
        addEventListener('message', function handler(event) {
          if (event.source !== frame.contentWindow || event.data?.source !== 'klose-sandbox') return;
          const data = event.data;
          if (data.type === 'ready') {
            frame.contentWindow.postMessage({
              type: 'render',
              code: "import React from 'react'; export default function Demo(){ return <div style={{ width: 240, height: 160 }} />; }",
            }, '*');
          }
          if (data.type === 'error') {
            clearTimeout(timeout);
            removeEventListener('message', handler);
            reject(new Error(data.message));
          }
          if (data.type === 'contentSize') {
            clearTimeout(timeout);
            removeEventListener('message', handler);
            resolve({ width: data.width, height: data.height });
          }
        });
      });
    });

    // The component's own size, not the frame's: fitting to it has to shrink the frame.
    assert.deepEqual(size, { width: 240, height: 160 });
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
