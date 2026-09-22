# Klose — Architecture & How It Works

## What Is This?

Klose is an npm package that installs a `/klose` skill into Claude Code (or any repo that wants it).
It gives you a local, no-login canvas for sketching component ideas — rendered live on an infinite
board, not just as labeled boxes — and grounds the coding agent's ideation in your project's *actual*
design system before it builds the real component into your repo.

Three things follow from that, and they are what the rest of this document explains:

- **Feedback carries a DOM path, not prose.** A comment can name the element it is about (tag, text,
  classes, path), because the preview runs in a sandbox this app controls. That is the loop chat
  cannot close — see [The Canvas UI](#the-canvas-ui).
- **Context comes from the host repo, not from the model.** Tokens, conventions and an index of the
  repo's real components are read off disk before anything is sketched — see
  [The Component Index](#the-component-index).
- **A sketch has a lifecycle.** `sketch` → `built`, and a built node keeps the path of the file it
  produced, so later comments edit real code.

Klose has no AI model of its own. It used to (an earlier version generated and live-rendered code via
Google Gemini behind a hosted Supabase-backed SaaS), and that hosted pipeline — auth, cloud database,
Gemini codegen — has been removed in favor of this local, agent-driven model. The live-preview
sandbox itself survived the rewrite in simplified form: it still renders component code in an
isolated iframe, but the code now comes from the coding agent (grounded in the real repo's design
system) instead of a server-proxied Gemini call.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Canvas UI** | React 19 + TypeScript, React Router, Tailwind CSS, Vite |
| **CLI / local server** | Plain Node.js (`node:http`, `node:fs`) — no framework, no external deps |
| **Storage** | JSON files under `.klose/projects/` in the consuming repo — no database |
| **Distribution** | npm package, installed per-repo; ships a pre-built static frontend |

---

## Package Layout

```
bin/klose.js           CLI entry point: init / serve / status / stop / project * / ...
server/root.js         Finds the repo root a command acts on (nearest .klose/ or .git)
server/store.js        File-based CRUD over .klose/projects/<id>.json
server/http.js         Node HTTP server: REST API + SSE + serves the built canvas UI
server/instance.js     .klose/server.json bookkeeping: is this repo's server running, and where
server/skills.js       Installs skill files without clobbering the user's edits
server/theme.js        Extracts the repo's design tokens for the preview sandbox
server/scanner.js      Indexes the repo's real components
skills/klose/SKILL.md  Source of the /klose skill (copied into consumer repos by `klose init`)
scripts/               smoke-pack.mjs (pack-and-install first-run test), prepare.mjs (git installs)
web/                    The canvas UI source (built to web/dist for packaging)
```

## What Happens On Install

`npx klose init` in a target repo (from anywhere inside it — every command resolves the nearest parent
holding a `.klose/` or `.git`, so a subfolder never gets a stray second `.klose/`):
1. Copies each `skills/*/SKILL.md` into `.claude/skills/`, so Claude Code picks them up as the
   `/klose`, `/klose-update` and `/klose-cleanup` commands. `.klose/skills.json` records a hash of
   each file as written; a later `init` or `update` replaces only files that still match it, and
   leaves ones the user edited alone unless `--force` (which keeps a `.bak`).
2. Creates `.klose/projects/` for local project storage, seeded with a demo project, and a
   `.klose/.gitignore` for the per-machine files (plus `projects/` with `--ignore-projects`).
3. Reports the design tokens (`server/theme.js`) and components (`server/scanner.js`) it found, and
   the prompt to try first.

## What Happens On `/klose`

The skill (see `skills/klose/SKILL.md`) instructs the agent to:
1. Ensure the local server is running (`klose status`, then `klose serve --detach`) and share the URL.
2. Pick or create a `.klose` project.
3. **Read the host repo's real design system** — Tailwind config, CSS custom properties, existing
   component conventions — rather than inventing generic tokens.
4. Have the actual ideation conversation with the user, using that context.
5. Write the settled design to the canvas as a sketch node with live preview `code`
   (`klose project add-node`), grounded in the design system read in step 3, so the user sees a real
   rendered mockup and can reposition it.
6. On confirmation, write the real component file into the project using the agent's normal
   Read/Write/Edit tools — following real repo conventions, not the sandbox's simplified contract —
   then mark the sketch `built` with the resulting file path (`klose project update-node`).
7. Check sketches for `comments` at the start of a session (or when handed a "Copy for agent" text
   block) and address them, clearing the ones handled.

## Theme Tokens

`index.html` declares the palette in a Tailwind v4 `@theme` block
(`--color-app-surface-elevated`, `--color-app-border-strong`, …), and utilities must spell the token
exactly: `bg-app-surface-elevated`, not `bg-app-surfaceElevated`. A camelCase name generates no CSS at
all and the element silently renders with no background or border colour — which is what had happened
to every elevated surface on the canvas (the inspector, the sketch frames, the nav rail).

## The Canvas UI

- **`/`** — a landing/home page (`pages/LandingPage.tsx`) that explains the sketch → preview →
  comment → build loop, with a decorative mini-canvas hero and CTAs into the app. Its "New project"
  button creates a project and opens its canvas.
- **`/projects`** — a grid of local projects (create, rename, delete), backed by the local server's
  REST API instead of a cloud database.
- **`/canvas/:projectId`** — an infinite pannable/zoomable board of `SketchNode`s: a name, description,
  and freeform notes, plus a status (`sketch` or `built`) and, once built, the path of the real file
  the agent wrote. Drag, resize, undo/redo, and a project-context panel (brand notes + design-system
  notes the agent reads) all work exactly as before — none of that logic depended on AI.
- A node can optionally carry `code`: self-contained React/TSX written by the agent, rendered live in
  a sandboxed iframe (`components/Runtime/Preview.tsx` + `sandboxBootstrap.ts`) via Babel-in-browser
  transpilation, with only `react`, `lucide-react`, and `recharts` available inside the sandbox (all
  loaded from esm.sh inside the iframe — no dependency on Klose's own bundle). The sandbox runs with
  `sandbox="allow-scripts"` (no `allow-same-origin`) and a `connect-src 'none'` CSP, so agent-written
  code can't reach the parent page's storage or the network. A node with no `code` just shows its
  description text — a sketch doesn't require a preview to be useful.
- A frame's chrome carries the actions that need the live iframe: a **code toggle** (`CodeView`
  overlays the preview with its own source — the iframe stays mounted underneath, so toggling costs
  no reload), a **screenshot** button, and **fit to preview**, which resizes the frame to the size
  the sandbox reports for the rendered component (`contentSize` over postMessage).
- **Screenshots are taken inside the sandbox.** The parent cannot read a cross-origin frame's pixels,
  so `preview/screenshot.ts` clones the rendered DOM, inlines the document's stylesheets (including
  the Tailwind the sandbox compiled at runtime), wraps it in an `<svg><foreignObject>` and draws that
  into a canvas — the same technique as html2canvas's foreignObject renderer. The SVG is a `data:`
  URL, which is all the CSP's `img-src data: blob:` allows, so a capture still makes no network
  request. The PNG data URL comes back over postMessage and the canvas saves or copies it.
- **Drag/resize geometry lives in `lib/frameGeometry.js`** (plain ESM, so `node --test` can cover it):
  edge-based resizing where an untouched edge never moves, grid snapping applied to positions rather
  than to deltas (Alt bypasses it), Shift for ratio-locked corners, and clamping to the canvas and to
  the minimum frame size. The canvas drives it with pointer events coalesced onto animation frames,
  and switches every preview to `pointer-events: none` for the duration of a gesture — an interactive
  iframe otherwise swallows the moves the moment the cursor crosses it.
- A node can also carry `comments`: freeform feedback left in the `SketchInspector` panel — docked
  bottom-right, titled by the sketch's own name and description, and opening on the comment thread
  with description, notes, frame size and status folded away behind disclosures, so the panel is as
  tall as the work needs rather than as tall as the window. The composer is pinned below the thread.
  Comments also show as a small count badge on the card. "Copy for agent" formats them (with the sketch's name and the
  project/node ids) as text meant to be pasted straight into the coding agent's chat. A comment can
  optionally carry an `element` (`SelectedElementInfo`): the sandbox reports the clicked element's
  tag/text/classes/DOM-path via postMessage, and the next comment is scoped to it — so the agent
  knows exactly which part of the preview the feedback targets.
- **Targeting an element has two entry points, and `lib/targeting.js` decides which frame accepts a
  pick.** The frame's own toggle (next to the code and camera buttons) pins targeting to that sketch
  for one pick; focusing the comment composer targets the selected sketch for as long as it holds
  focus, so the common case needs no mode switch. A pick moves focus into the preview's iframe, so
  the composer's blur handler ignores a blur that landed on a preview (`focusMovedIntoPreview`) and
  the canvas hands focus back to the composer once the element arrives — the draft survives, and
  Escape drops the targeted element before it drops the selection.

## Local Server

`server/http.js` is a small Node `http` server (no Express) that:
- Serves a REST API (`/api/projects`, `/api/projects/:id`, `/api/projects/:id/nodes[/…]`) backed by
  `server/store.js`, which reads/writes `.klose/projects/<id>.json` under the repo root.
- Serves `/api/theme`: the repo's `tailwind.config.*` theme (converted to Tailwind v4 `@theme`
  variables), its `@theme` blocks and its `:root` custom properties. The canvas posts this CSS into
  every preview sandbox before rendering, so sketches written against the repo's own class names
  render with the repo's own values.
- Listens on `127.0.0.1` only, refuses any request whose `Host` isn't a loopback name (DNS
  rebinding), refuses `/api` requests carrying a non-localhost `Origin` (including the sandbox's
  `null`), and requires `application/json` on writes so a cross-site "simple" form post can't
  reach it.
- Reports `{ ok, root, version, pid }` on `/api/health`, and `klose serve` records the same in
  `.klose/server.json`. `klose status` / `stop` / a second `serve` confirm against the live health
  endpoint, so a server another repo started on the same port is never mistaken for this one.
- Watches `.klose/projects/` and pushes an SSE `update` event on any change, so an open canvas tab
  live-refreshes when the agent writes a new sketch from a separate CLI invocation.
- Serves the pre-built canvas UI (`web/dist/`) as static files, with an SPA fallback to `index.html`.

The CLI (`bin/klose.js`) calls the same `server/store.js` functions directly for `project *`
subcommands — it doesn't need the server running to read/write project data, but the server's
directory watch means changes made either way show up live in the browser.

---

## The Component Index

`server/scanner.js` walks the *host* repo and indexes its real components, so both the Components tab
and the agent can reuse what already exists instead of sketching a duplicate. It is a deliberately
dependency-free heuristic scanner (Klose ships zero runtime deps), not a TypeScript parser:

- **What it walks** — `.tsx`/`.jsx` files under the repo root, skipping the usual build and vendor
  directories (`node_modules`, `dist`, `.next`, `.klose`, `web`, …), files over 256 KB, and anything
  past a 6000-file ceiling (the result carries `truncated: true` when that ceiling is hit).
- **What it matches** — exported component declarations by regex (`export function Name`,
  `export const Name =`, `export class Name`, `export default Name`), plus each one's props and its
  leading doc comment. A `.tsx` file with no JSX and no React import is skipped, so plain utilities
  typed `.tsx` don't pollute the index.
- **Previewability** — a component that imports repo-local modules is flagged rather than executed,
  since relative imports can't resolve inside the isolated sandbox.
- **Repo identity** — `repoInfo()` reads `.git/HEAD` and `.git/config` directly for the name, branch
  and remote shown on the Components tab's badge, so a global install always says which repo it is
  looking at.
- **Caching** — results are memoized per root for 4s (`force: true` bypasses it), which keeps the
  Components tab responsive without the agent ever seeing a stale index between CLI calls.

Three surfaces read it: `GET /api/components[?q=]` (the Components tab), `klose components [query]`
(what the `/klose` skill runs before it sketches), and `readComponentSource()` for the detail view —
which resolves the requested path and rejects anything escaping the repo root or not a source file.

---

## What Changed From the Original (Ceko) Version

The previous version of this codebase was a hosted SaaS: Supabase auth and Postgres storage, a
Vercel Edge Function proxying Google Gemini, and a sandboxed iframe that transpiled and ran
AI-generated code live in the browser. Auth, the cloud database, and the Gemini codegen pipeline
(blueprint generation, planning-mode chat, component editing, image generation, smart-parts
classification) have been removed, along with the asset/pattern library — those depended on a
server-side model call Klose no longer makes. The live-preview sandbox survived in simplified form
(no animation tracking, no AI-driven part classification — see `components/Runtime/`), now fed by
code the coding agent writes instead of a Gemini response; its element inspection was later revived
to power element-scoped comments. What else remains is the parts that
were never AI-dependent: the canvas's drag/resize/pan/undo mechanics, the project browser, and the
settings/theme system — now serving a much smaller, local-first tool.
