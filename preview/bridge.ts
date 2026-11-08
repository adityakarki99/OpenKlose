/**
 * klose-bridge.js: lets the canvas see into a live page (a dev server framed by
 * a `url` card). Load it from the page:
 *
 *   <script src="http://localhost:<klose-port>/klose-bridge.js"></script>
 *
 * It does nothing until the canvas that framed the page says hello, and then
 * only talks to that window, from that origin, with that nonce (see
 * lib/bridgeProtocol.js). It shares its element picking and pin placement with
 * preview-runtime.tsx through lib/elementInfo.js.
 *
 * Built into web/dist/klose-bridge.js by the klosebridge plugin in
 * vite.config.ts, which is what the Klose server serves.
 */
import { acceptFromCanvas, BRIDGE_VERSION } from '../lib/bridgeProtocol.js';
import { elementInfo, measurePins } from '../lib/elementInfo.js';
import { capture } from './screenshot';

(() => {
  if (window.parent === window) return; // not framed: nothing to talk to
  const w = window as unknown as { __kloseBridge?: boolean };
  if (w.__kloseBridge) return; // loaded twice
  w.__kloseBridge = true;

  const state: { origin: string | null; nonce: string | null } = { origin: null, nonce: null };
  let inspecting = false;
  let pinTargets: Array<{ id: string; element: any }> = [];
  let pinTimer: ReturnType<typeof setTimeout> | undefined;
  let sizeTimer: ReturnType<typeof setTimeout> | undefined;
  let lastSize = '';

  const root = () => document.body;

  function post(message: Record<string, unknown>) {
    if (!state.origin || !state.nonce) return;
    window.parent.postMessage({ klose: 'bridge', nonce: state.nonce, ...message }, state.origin);
  }

  function reportPins() {
    clearTimeout(pinTimer);
    pinTimer = setTimeout(() => post({ type: 'pins', pins: measurePins(root(), pinTargets) }), 60);
  }

  function reportSize() {
    clearTimeout(sizeTimer);
    sizeTimer = setTimeout(() => {
      const el = document.documentElement;
      const width = Math.ceil(Math.max(el.scrollWidth, document.body.scrollWidth));
      const height = Math.ceil(Math.max(el.scrollHeight, document.body.scrollHeight));
      // Nothing can be sent before the canvas says hello, so don't remember a size yet.
      if (!state.origin || !state.nonce) return;
      const key = `${width}x${height}`;
      if (key === lastSize) return;
      lastSize = key;
      post({ type: 'contentSize', width, height });
    }, 50);
  }

  // The element picker's outline. Appended on first use; never part of a capture
  // or a locator, because it is a child of <html>, not of <body>.
  let highlight: HTMLElement | null = null;
  function ensureHighlight() {
    if (highlight) return highlight;
    highlight = document.createElement('div');
    highlight.setAttribute('data-klose-bridge', '');
    highlight.style.cssText =
      'position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #3b82f6;background:rgba(59,130,246,.12);border-radius:2px;display:none;';
    document.documentElement.appendChild(highlight);
    return highlight;
  }

  const isOwn = (el: EventTarget | null) => !!(el as HTMLElement | null)?.closest?.('[data-klose-bridge]');

  document.addEventListener('mousemove', (event) => {
    if (!inspecting) return;
    const target = event.target as HTMLElement | null;
    if (!target || isOwn(target) || target === document.documentElement) return;
    const rect = target.getBoundingClientRect();
    Object.assign(ensureHighlight().style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      display: 'block',
    });
  }, true);

  document.addEventListener('click', (event) => {
    if (!inspecting) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.target as HTMLElement | null;
    if (!target || isOwn(target) || target === document.documentElement) return;
    post({ type: 'elementSelected', info: elementInfo(target, root()) });
  }, true);

  function setInspecting(value: boolean) {
    inspecting = value;
    if (!value && highlight) highlight.style.display = 'none';
    document.documentElement.style.cursor = value ? 'crosshair' : '';
  }

  async function handleCapture(id: string, scale: unknown) {
    try {
      const dataUrl = await capture(root(), {
        scale: typeof scale === 'number' ? scale : undefined,
        background: getComputedStyle(document.body).backgroundColor || '#ffffff',
      });
      post({ type: 'captured', id, dataUrl });
    } catch (error) {
      post({ type: 'captured', id, message: error instanceof Error ? error.message : 'Screenshot failed' });
    }
  }

  window.addEventListener('message', (event) => {
    const message = acceptFromCanvas(event, state, window.parent) as any;
    if (!message) return;
    switch (message.type) {
      case 'klose:hello':
        state.origin = event.origin;
        state.nonce = message.nonce;
        lastSize = ''; // a new canvas (or a reload of it) needs the size again
        post({ type: 'klose:ready', version: BRIDGE_VERSION });
        reportSize();
        reportPins();
        break;
      case 'setInspecting':
        setInspecting(!!message.value);
        break;
      case 'locate':
        pinTargets = Array.isArray(message.targets)
          ? message.targets.filter((t: any) => typeof t?.id === 'string' && t.element && typeof t.element === 'object')
          : [];
        reportPins();
        break;
      case 'capture':
        if (typeof message.id === 'string') void handleCapture(message.id, message.scale);
        break;
    }
  });

  // Re-measure when the page changes shape, scrolls or resizes.
  const observer = new ResizeObserver(() => {
    reportSize();
    reportPins();
  });
  const watch = () => {
    observer.observe(document.documentElement);
    observer.observe(document.body);
  };
  if (document.body) watch();
  else document.addEventListener('DOMContentLoaded', watch, { once: true });
  window.addEventListener('resize', reportPins);
  document.addEventListener('scroll', reportPins, true);
  new MutationObserver(reportPins).observe(document.documentElement, { childList: true, subtree: true, attributes: true });
})();
