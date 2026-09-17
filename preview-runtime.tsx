import React from 'react';
import { createRoot } from 'react-dom/client';
import * as Babel from '@babel/standalone';
import * as LucideReact from 'lucide-react';
import * as Recharts from 'recharts';
import '@tailwindcss/browser';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Preview root is missing');

const root = createRoot(rootElement);
let inspecting = false;
const highlight = document.getElementById('sb-highlight') as HTMLElement;
const highlightLabel = document.getElementById('sb-highlight-label') as HTMLElement;

function post(message: Record<string, unknown>) {
  parent.postMessage({ ...message, source: 'klose-sandbox' }, '*');
}

function postAfterPaint(message: Record<string, unknown>) {
  requestAnimationFrame(() => requestAnimationFrame(() => post(message)));
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

function renderCode(code: string, exportName?: string) {
  if (!code) return;
  try {
    const result = Babel.transform(code, { presets: ['env', 'react', 'typescript'], filename: 'component.tsx' });
    const module = { exports: {} as Record<string, unknown> };
    const requireModule = (name: string) => {
      if (name === 'react') return React;
      if (name === 'lucide-react') return LucideReact;
      if (name === 'recharts') return Recharts;
      throw new Error(`Unsupported preview import "${name}". Repo-local imports must be replaced with a self-contained sketch.`);
    };
    const factory = new Function('require', 'module', 'exports', 'React', result.code || '');
    factory(requireModule, module, module.exports, React);

    const exports = module.exports;
    let Component: unknown = exportName ? exports[exportName] : null;
    if (!isComponent(Component)) Component = exports.default;
    if (!isComponent(Component) && isComponent(exports)) Component = exports;
    if (!isComponent(Component)) Component = Object.values(exports).find(isComponent);
    if (!isComponent(Component)) throw new Error('Component does not export a valid React component.');
    root.render(React.createElement(Component as React.ElementType));
    postAfterPaint({ type: 'rendered' });
  } catch (error) {
    renderError(error instanceof Error ? error.message : 'Failed to render component');
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
  if (data.type === 'render') renderCode(data.code || '', data.name);
  if (data.type === 'surface' && data.color) {
    document.documentElement.style.backgroundColor = data.color;
    document.body.style.backgroundColor = data.color;
  }
  if (data.type === 'setInspecting') {
    inspecting = !!data.value;
    document.body.classList.toggle('sb-inspecting', inspecting);
    if (!inspecting) highlight.style.display = 'none';
  }
});

post({ type: 'ready' });
