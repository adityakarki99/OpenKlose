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
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module">
      import React from 'https://esm.sh/react@19.2.4';
      import { createRoot } from 'https://esm.sh/react-dom@19.2.4/client?deps=react@19.2.4';
      import * as LucideReact from 'https://esm.sh/lucide-react@0.563.0?deps=react@19.2.4';
      import * as Recharts from 'https://esm.sh/recharts@3.8.1?deps=react@19.2.4,react-dom@19.2.4';
      import * as Babel from 'https://esm.sh/@babel/standalone@7.28.2';

      var root = createRoot(document.getElementById('root'));

      function post(msg) {
        msg.source = 'klose-sandbox';
        parent.postMessage(msg, '*');
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

      function renderCode(code) {
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
          if (module.exports && module.exports.default) {
            Comp = module.exports.default;
          } else if (typeof module.exports === 'function') {
            Comp = module.exports;
          } else if (module.exports && typeof module.exports === 'object') {
            var vals = Object.keys(module.exports)
              .map(function (k) { return module.exports[k]; })
              .filter(function (v) { return typeof v === 'function'; });
            if (vals.length) Comp = vals[0];
          }

          if (typeof Comp !== 'function') {
            throw new Error('Component does not export a default function or valid React component.');
          }
          root.render(React.createElement(Comp));
          post({ type: 'rendered' });
        } catch (err) {
          renderError(err && err.message ? err.message : 'Failed to render component');
        }
      }

      window.addEventListener('message', function (e) {
        var d = e.data || {};
        if (d.type === 'render') {
          renderCode(d.code || '');
        } else if (d.type === 'surface') {
          if (d.color) {
            document.documentElement.style.backgroundColor = d.color;
            document.body.style.backgroundColor = d.color;
          }
        }
      });

      post({ type: 'ready' });
    </script>
  </body>
</html>`;
