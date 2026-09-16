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
