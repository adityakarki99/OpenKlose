/**
 * HTML document loaded into the sandboxed preview iframe.
 *
 * SECURITY: The iframe is rendered with `sandbox="allow-scripts"` only (no
 * `allow-same-origin`), so it runs in an opaque origin and CANNOT access the
 * parent app's cookies, localStorage, or DOM. The inner Content-Security-Policy
 * additionally sets `connect-src 'none'`, so the sketch's code cannot exfiltrate
 * anything over the network.
 *
 * Sketch code comes from the coding agent, not an in-browser AI call, but it is
 * still untrusted from Klose's point of view (Klose never inspects or executes
 * it outside this frame). It is NEVER concatenated into this HTML — it is sent
 * in after load via postMessage and compiled/rendered inside the isolated frame.
 *
 * Communication with the parent uses postMessage; every message from this
 * frame carries `source: 'klose-sandbox'` and the parent verifies the message
 * originates from this iframe's contentWindow.
 */
export const SANDBOX_BOOTSTRAP_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://esm.sh https://unpkg.com; style-src 'unsafe-inline' https://fonts.googleapis.com https://cdn.tailwindcss.com; font-src https://fonts.gstatic.com data:; img-src data: blob: https:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'"
    />
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      html, body {
        margin: 0;
        padding: 0;
        height: 100%;
        background-color: #0f172a;
      }
      #root {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        overflow: auto;
      }
      .sb-error {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        padding: 16px;
        color: #ef4444;
        font: 12px/1.4 ui-sans-serif, system-ui, sans-serif;
        text-align: center;
      }
      body.sb-inspecting, body.sb-inspecting * { cursor: crosshair !important; }
      #sb-highlight {
        position: fixed;
        z-index: 2147483647;
        pointer-events: none;
        border: 2px solid #3b82f6;
        background: rgba(59, 130, 246, 0.12);
        border-radius: 2px;
        display: none;
      }
      #sb-highlight > span {
        position: absolute;
        top: -18px;
        left: 0;
        background: #3b82f6;
        color: #fff;
        font: 9px/1.2 ui-monospace, monospace;
        padding: 1px 4px;
        border-radius: 2px 2px 0 0;
        white-space: nowrap;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <div id="sb-highlight"><span id="sb-highlight-label">Target</span></div>
    <script type="module">
      import React from 'https://esm.sh/react@19.2.4';
      import { createRoot } from 'https://esm.sh/react-dom@19.2.4/client?deps=react@19.2.4';
      import * as LucideReact from 'https://esm.sh/lucide-react@0.563.0?deps=react@19.2.4';
      import * as Recharts from 'https://esm.sh/recharts@3.8.1?deps=react@19.2.4,react-dom@19.2.4';
      import * as Babel from 'https://esm.sh/@babel/standalone@7.28.2';

      var root = createRoot(document.getElementById('root'));
      var inspecting = false;
      var hl = document.getElementById('sb-highlight');
      var hlLabel = document.getElementById('sb-highlight-label');

      function post(msg) {
        msg.source = 'klose-sandbox';
        parent.postMessage(msg, '*');
      }

      function showHighlight(rect, label) {
        hlLabel.textContent = label;
        hl.style.left = rect.left + 'px';
        hl.style.top = rect.top + 'px';
        hl.style.width = rect.width + 'px';
        hl.style.height = rect.height + 'px';
        hl.style.display = 'block';
      }
      function hideHighlight() { hl.style.display = 'none'; }

      // Build a short, readable ancestor breadcrumb of tag names so the agent
      // can locate the element (e.g. "div > div > button").
      function describePath(el) {
        var parts = [];
        var cur = el;
        var hops = 0;
        while (cur && cur.tagName && cur.id !== 'root' && hops < 5) {
          parts.unshift(cur.tagName.toLowerCase());
          cur = cur.parentElement;
          hops++;
        }
        return parts.join(' > ');
      }

      function elementInfo(el) {
        return {
          tagName: (el.tagName || '').toLowerCase(),
          text: (el.innerText || el.textContent || '').trim().slice(0, 100),
          classes: (typeof el.className === 'string' ? el.className : '').trim().slice(0, 200),
          path: describePath(el),
        };
      }

      function renderError(message) {
        root.render(
          React.createElement('div', { className: 'sb-error' }, [
            React.createElement('p', { key: 't', style: { fontWeight: 600 } }, 'Render Error'),
            React.createElement('p', { key: 'm', style: { opacity: 0.75, marginTop: 4 } }, message),
          ])
        );
        post({ type: 'error', message: message });
      }

      // A value is renderable if it's a plain function component OR a React
      // object component (forwardRef / memo carry a $$typeof marker).
      function isComponent(v) {
        return typeof v === 'function' || (v && typeof v === 'object' && v.$$typeof);
      }

      function renderCode(code, name) {
        if (!code) return;
        try {
          var result = Babel.transform(code, {
            presets: ['env', 'react', 'typescript'],
            filename: 'component.tsx',
          });
          var module = { exports: {} };
          var exports = module.exports;
          var require = function (name) {
            if (name === 'react') return React;
            if (name === 'lucide-react') return LucideReact;
            if (name === 'recharts') return Recharts;
            return {};
          };
          var factory = new Function('require', 'module', 'exports', 'React', result.code);
          factory(require, module, exports, React);

          var Comp = null;
          // Prefer the specific named export the caller asked for (used when
          // previewing a real repo component), then a default export, then the
          // first renderable export in the file.
          if (name && module.exports && isComponent(module.exports[name])) {
            Comp = module.exports[name];
          } else if (module.exports && isComponent(module.exports.default)) {
            Comp = module.exports.default;
          } else if (isComponent(module.exports)) {
            Comp = module.exports;
          } else if (module.exports && typeof module.exports === 'object') {
            var vals = Object.keys(module.exports)
              .map(function (k) { return module.exports[k]; })
              .filter(isComponent);
            if (vals.length) Comp = vals[0];
          }

          if (!isComponent(Comp)) {
            throw new Error('Component does not export a default function or valid React component.');
          }
          root.render(React.createElement(Comp));
          post({ type: 'rendered' });
        } catch (err) {
          renderError(err && err.message ? err.message : 'Failed to render component');
        }
      }

      document.addEventListener('mousemove', function (e) {
        if (!inspecting) return;
        var t = e.target;
        if (!t || t === hl || t.id === 'sb-highlight' || t.parentNode === hl) return;
        showHighlight(t.getBoundingClientRect(), (t.tagName || '').toLowerCase());
      });

      // Capture on the way DOWN so the sketch's own click handlers never fire
      // while we're picking an element to comment on.
      document.addEventListener('click', function (e) {
        if (!inspecting) return;
        e.preventDefault();
        e.stopPropagation();
        var t = e.target;
        if (!t || t === hl || t.parentNode === hl) return;
        post({ type: 'select', info: elementInfo(t) });
      }, true);

      window.addEventListener('message', function (e) {
        var d = e.data || {};
        if (d.type === 'render') {
          renderCode(d.code || '', d.name);
        } else if (d.type === 'surface') {
          if (d.color) {
            document.documentElement.style.backgroundColor = d.color;
            document.body.style.backgroundColor = d.color;
          }
        } else if (d.type === 'setInspecting') {
          inspecting = !!d.value;
          document.body.classList.toggle('sb-inspecting', inspecting);
          if (!inspecting) hideHighlight();
        }
      });

      post({ type: 'ready' });
    </script>
  </body>
</html>`;
