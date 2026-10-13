// Records the demo: one continuous Chromium session (title card → hosted
// canvas → title card), paced to the narration's measured durations. Writes
// .work/out/raw.webm and .work/out/marks.json (when each scene started) for
// assemble.py. Needs the hosted canvas built (npm run build:static) and the
// narration synthesized (run.sh does both).
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CURSOR_SHIM, Pointer, WORK, agentWrites, folderShim, seedFiles, serve } from './harness.mjs';
import { PROJECT_ID, RUN_SHEET, agentNode, project } from './sketches.mjs';

const OUT = path.join(WORK, 'out');
mkdirSync(OUT, { recursive: true });
const durations = JSON.parse(readFileSync(path.join(WORK, 'audio', 'durations.json'), 'utf8'));

const { server, origin } = await serve();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } },
  permissions: ['clipboard-read', 'clipboard-write'],
});
await context.addInitScript(folderShim(seedFiles(project())));
const t0 = Date.now();
await context.addInitScript(`window.__T0 = ${t0};`);
await context.addInitScript(CURSOR_SHIM);
const page = await context.newPage();
const marks = [];
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const p = new Pointer(page);
const wait = (ms) => page.waitForTimeout(ms);

/** Starts a scene: records when, and gives `until(sec)` to pace actions against its narration. */
function scene(key, pad = 600) {
  const start = Date.now();
  marks.push({ key, at: (start - t0) / 1000, duration: durations[key] });
  console.log(`scene ${key} at ${((start - t0) / 1000).toFixed(2)}s`);
  const until = async (sec) => { const left = start + sec * 1000 - Date.now(); if (left > 0) await wait(left); };
  const log = (what) => console.log(`  ${key} +${((Date.now() - start) / 1000).toFixed(2)}s ${what}`);
  return { until, log, end: () => until(durations[key] + pad / 1000) };
}

// ---------------------------------------------------------------- intro
await page.goto(`${origin}/pages/intro.html`);
{ const s = scene('intro', 900); await s.end(); }

// ---------------------------------------------------------------- front door
await page.goto(`${origin}/#/`);
{
  const s = scene('door', 400);
  p.x = 1180; p.y = 760; await p.show();
  await s.until(1.6);
  await p.clickEl(page.getByTestId('choose-folder'), 900);
  await page.waitForURL(/#\/projects$/);
  await p.moveTo(1000, 640, 700);
  await s.end();
}

// ---------------------------------------------------------------- files
{
  const s = scene('files', 300);
  const row = page.getByText('OnCue · Plan & Run', { exact: true }).first();
  await s.until(1.2);
  await p.moveTo(760, 265, 700);
  await s.until(4.2);
  await p.clickEl(row, 300);
  await page.waitForURL(/#\/canvas\//);
  await p.moveTo(590, 700, 600);
  await s.end();
}

// ---------------------------------------------------------------- canvas
{
  const s = scene('canvas', 300);
  await page.getByText('Plan card · Venue', { exact: true }).first().waitFor();
  await s.until(2.0);
  await p.moveTo(900, 680, 900);
  await s.until(7.9); // "The steel blue primary"
  await p.moveTo(300, 396, 700);
  await s.until(9.6); // "Cue's gold"
  await p.moveTo(440, 668, 700);
  await s.until(11.0); // "the live green"
  await p.moveTo(720, 200, 700);
  await s.end();
}

// ---------------------------------------------------------------- the agent adds a sketch
{
  const s = scene('agent', 500);
  await p.moveTo(1180, 700, 800);
  await s.until(2.4);
  await agentWrites(page, PROJECT_ID, `project.nodes.push(${JSON.stringify(agentNode())});`);
  await page.getByText('Event brief · Cue’s reading', { exact: true }).first().waitFor({ timeout: 10000 });
  await s.until(5.0);
  await p.moveTo(1490, 300, 900);
  await s.until(7.0);
  await p.moveTo(1400, 330, 500);
  await s.end();
}

// ---------------------------------------------------------------- an element-scoped comment
{
  const s = scene('comment', 400);
  const title = page.getByText('Run sheet · Now & next', { exact: true }).first();
  await s.until(1.6);
  const titleBox = await p.clickEl(title, 700); // select the sketch
  await s.until(3.4);
  await p.clickEl(page.getByTitle('Click an element in the preview to attach your comment to it (C)'), 600);
  await s.until(4.8);
  // The "Running late" button inside the live preview, relative to the sketch's title.
  await p.click(titleBox.x + 322, titleBox.y + 71, 800);
  await s.until(6.6);
  await p.clickEl(page.getByLabel('Comment on Run sheet · Now & next'), 500);
  for (const chunk of ['Put the delay on this button: ', '“10 min late”, in the warning tone.']) { await page.keyboard.insertText(chunk); await wait(150); }
  await s.until(10.2);
  await p.clickEl(page.getByLabel('Add comment'), 500);
  await s.until(11.8);
  await p.clickEl(page.getByRole('button', { name: /^Copy 1 new comment/ }), 700);
  await s.until(14.4);
  await p.moveTo(1500, 760, 600);
  await s.end();
}

// ---------------------------------------------------------------- the agent resolves it and builds a sketch
{
  const s = scene('resolve', 1800);
  await s.until(0.6);
  const v2 = RUN_SHEET
    .replace("<Clock size={14} /> Running late", "<Clock size={14} /> 10 min late")
    .replace("border: `1px solid ${t('border')}`, background: t('card'), color: t('subtle'), display: 'inline-flex'", "border: `1px solid ${t('warning', 0.35)}`, background: t('warning-soft'), color: t('warning'), display: 'inline-flex'");
  await agentWrites(page, PROJECT_ID, `
    const n = project.nodes.find((x) => x.id === 'run-sheet');
    n.code = ${JSON.stringify(v2)};
    n.updatedAt = Date.now();
    for (const c of n.comments || []) { c.resolvedAt = Date.now(); c.resolution = 'Button now reads the live delay in the warning tone (RunSheet.tsx).'; }
    const v = project.nodes.find((x) => x.id === 'venue-card');
    v.status = 'built'; v.builtFilePath = 'components/cards/VenueCard.tsx'; v.updatedAt = Date.now();
  `);
  await s.until(2.6);
  await p.moveTo(1000, 202, 700);
  await s.until(6.0);
  await p.moveTo(260, 141, 800);
  await s.until(9.0);
  await p.moveTo(330, 141, 700);
  await s.end();
}

// ---------------------------------------------------------------- outro
await p.hide();
await page.goto(`${origin}/pages/outro.html`);
{ const s = scene('outro', 1500); await s.end(); }

const video = page.video();
await context.close();
const file = await video.path();
await browser.close();
server.close();
renameSync(file, path.join(OUT, 'raw.webm'));
writeFileSync(path.join(OUT, 'marks.json'), JSON.stringify({ marks, total: (Date.now() - t0) / 1000 }, null, 2));
if (errors.length) { console.error('page errors:', errors); process.exit(1); }
console.log('recorded', path.join(OUT, 'raw.webm'));
