import React from 'react';
import { createRoot } from 'react-dom/client';
import * as Babel from '@babel/standalone';
import { capture } from './preview/screenshot';
import '@tailwindcss/browser';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Preview root is missing');

const root = createRoot(rootElement);
let inspecting = false;
// Tailwind's browser build watches `text/tailwindcss` styles and recompiles
// when they change, so the repo's tokens land here and utilities rebuild.
const themeStyle = document.querySelector('style[type="text/tailwindcss"]') as HTMLStyleElement | null;

// Recharts and Lucide are most of what a preview would otherwise parse before
// it can render, and most sketches use neither — so they're separate chunks,
// loaded only when the compiled code actually requires them.
const lazyModules: Record<string, () => Promise<unknown>> = {
  'lucide-react': () => import('lucide-react'),
  recharts: () => import('recharts'),
};
const loadedModules = new Map<string, unknown>([['react', React]]);
let renderSeq = 0;
let surfaceColor = '#0f172a';
const highlight = document.getElementById('sb-highlight') as HTMLElement;
const highlightLabel = document.getElementById('sb-highlight-label') as HTMLElement;

function post(message: Record<string, unknown>) {
  parent.postMessage({ ...message, source: 'klose-sandbox' }, '*');
}

function postAfterPaint(message: Record<string, unknown>) {
  let sent = false;
  const send = () => {
    if (sent) return;
    sent = true;
    post(message);
  };
  requestAnimationFrame(() => requestAnimationFrame(send));
  // A frame that is scrolled out of view, in a background tab, or otherwise
  // throttled may never paint, and animation frames stop firing with it. The
  // canvas still needs to hear that the render went through.
  setTimeout(send, 100);
}

function describePath(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current?.tagName && current.id !== 'root' && parts.length < 5) {
    parts.unshift(current.tagName.toLowerCase());
    current = current.parentElement;
  }
  return parts.join(' > ');
}

function elementInfo(element: HTMLElement) {
  return {
    tagName: (element.tagName || '').toLowerCase(),
    text: (element.innerText || element.textContent || '').trim().slice(0, 100),
    classes: (typeof element.className === 'string' ? element.className : '').trim().slice(0, 200),
    path: describePath(element),
  };
}

function isComponent(value: unknown): boolean {
  return typeof value === 'function' || !!(value && typeof value === 'object' && '$$typeof' in value);
}

function renderError(message: string) {
  root.render(<div className="sb-error"><p style={{ fontWeight: 600 }}>Render Error</p><p style={{ opacity: 0.75, marginTop: 4 }}>{message}</p></div>);
  post({ type: 'error', message });
}

async function renderCode(code: string, exportName?: string) {
  if (!code) return;
  // A newer render may arrive while an older one waits on a chunk; only the
  // latest one gets to paint.
  const seq = ++renderSeq;
  try {
    const result = Babel.transform(code, { presets: ['env', 'react', 'typescript'], filename: 'component.tsx' });
    const compiled = result.code || '';
    const needed = [...compiled.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)]
      .map((m) => m[1])
      .filter((name) => name in lazyModules && !loadedModules.has(name));
    await Promise.all(needed.map(async (name) => loadedModules.set(name, await lazyModules[name]())));
    if (seq !== renderSeq) return;

    const module = { exports: {} as Record<string, unknown> };
    const requireModule = (name: string) => {
      if (loadedModules.has(name)) return loadedModules.get(name);
      throw new Error(`Unsupported preview import "${name}". Repo-local imports must be replaced with a self-contained sketch.`);
    };
    const factory = new Function('require', 'module', 'exports', 'React', compiled);
    factory(requireModule, module, module.exports, React);

    const exports = module.exports;
    let Component: unknown = exportName ? exports[exportName] : null;
    if (!isComponent(Component)) Component = exports.default;
    if (!isComponent(Component) && isComponent(exports)) Component = exports;
    if (!isComponent(Component)) Component = Object.values(exports).find(isComponent);
    if (!isComponent(Component)) throw new Error('Component does not export a valid React component.');
    root.render(React.createElement(Component as React.ElementType));
    postAfterPaint({ type: 'rendered' });
    setTimeout(observeContent, 0);
  } catch (error) {
    if (seq !== renderSeq) return;
    renderError(error instanceof Error ? error.message : 'Failed to render component');
  }
}

/**
 * Reports how much room the rendered component actually wants, so the canvas can
 * offer "fit the frame to the preview" instead of making the user eyeball it.
 */
const contentObserver = new ResizeObserver(() => postContentSize());
let contentTimer: ReturnType<typeof setTimeout> | undefined;

function postContentSize() {
  // Debounced on a timer rather than an animation frame: a frame that is
  // scrolled out of view or in a background tab stops painting, and the size
  // still has to reach the canvas.
  clearTimeout(contentTimer);
  contentTimer = setTimeout(() => {
    const content = rootElement.firstElementChild as HTMLElement | null;
    if (!content) return;
    post({
      type: 'contentSize',
      width: Math.ceil(Math.max(content.scrollWidth, content.getBoundingClientRect().width)),
      height: Math.ceil(Math.max(content.scrollHeight, content.getBoundingClientRect().height)),
    });
  }, 50);
}

function observeContent() {
  contentObserver.disconnect();
  const content = rootElement.firstElementChild;
  if (content) contentObserver.observe(content);
  postContentSize();
}

async function handleCapture(id: unknown, scale: unknown) {
  try {
    const dataUrl = await capture(rootElement as HTMLElement, {
      scale: typeof scale === 'number' ? scale : undefined,
      background: surfaceColor,
    });
    post({ type: 'capture', id, dataUrl });
  } catch (error) {
    post({
      type: 'captureError',
      id,
      message: error instanceof Error ? error.message : 'Screenshot failed',
    });
  }
}

document.addEventListener('mousemove', (event) => {
  if (!inspecting) return;
  const target = event.target as HTMLElement | null;
  if (!target || target === highlight || target.parentNode === highlight) return;
  const rect = target.getBoundingClientRect();
  highlightLabel.textContent = target.tagName.toLowerCase();
  Object.assign(highlight.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, display: 'block' });
});

document.addEventListener('click', (event) => {
  if (!inspecting) return;
  event.preventDefault();
  event.stopPropagation();
  const target = event.target as HTMLElement | null;
  if (!target || target === highlight || target.parentNode === highlight) return;
  post({ type: 'select', info: elementInfo(target) });
}, true);

window.addEventListener('message', (event) => {
  if (event.source !== parent) return;
  const data = event.data || {};
  if (data.type === 'theme' && themeStyle && typeof data.css === 'string') {
    themeStyle.textContent = `/* Compiled locally by @tailwindcss/browser, with the repo's tokens. */\n${data.css}`;
  }
  if (data.type === 'render') void renderCode(data.code || '', data.name);
  if (data.type === 'surface' && data.color) {
    surfaceColor = String(data.color);
    document.documentElement.style.backgroundColor = surfaceColor;
    document.body.style.backgroundColor = surfaceColor;
  }
  if (data.type === 'capture') handleCapture(data.id, data.scale);
  if (data.type === 'setInspecting') {
    inspecting = !!data.value;
    document.body.classList.toggle('sb-inspecting', inspecting);
    if (!inspecting) highlight.style.display = 'none';
  }
});

post({ type: 'ready' });
