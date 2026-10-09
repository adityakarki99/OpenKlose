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
| **Distribution** | npm package (per-repo or global) that ships a pre-built static frontend; the skills also install as a Claude Code plugin from this repo |

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
server/hub.js          The hub: one server for every repo, found from Claude Code's session files
server/setup.js        First-run setup for the hub (`klose setup`, the /welcome page)
server/tray.js         Builds the macOS menu bar app; its start-at-login LaunchAgent
plugin/                The Claude Code plugin: .claude-plugin/plugin.json plus skills/*/SKILL.md,
                       the one source of the /klose skills (the plugin loads them in place;
                       `klose init` copies them into consumer repos)
.claude-plugin/        marketplace.json: makes this repo a plugin marketplace with one entry, ./plugin
scripts/               smoke-pack.mjs (pack-and-install first-run test), prepare.mjs (git installs)
web/                    The canvas UI source (built to web/dist for packaging)
```

## What Happens On Install

`npx klose init` in a target repo (from anywhere inside it — every command resolves the nearest parent
holding a `.klose/` or `.git`, so a subfolder never gets a stray second `.klose/`):
1. Copies each `plugin/skills/*/SKILL.md` into `.claude/skills/`, so Claude Code picks them up as the
   `/klose`, `/klose-update` and `/klose-cleanup` commands. `.klose/skills.json` records a hash of
   each file as written; a later `init` or `update` replaces only files that still match it, and
   leaves ones the user edited alone unless `--force` (which keeps a `.bak`).
2. Creates `.klose/projects/` for local project storage, seeded with a demo project, and a
   `.klose/.gitignore` for the per-machine files (plus `projects/` with `--ignore-projects`).
3. Reports the design tokens (`server/theme.js`) and components (`server/scanner.js`) it found, and
   the prompt to try first.

### As a plugin: `/plugin install klose --marketplace adityakarki99/OpenKlose`

The same three skills ship as a Claude Code plugin, so no repo needs a copy. This repo is the
marketplace: `.claude-plugin/marketplace.json` lists one plugin, `klose`, whose source is the
`plugin/` directory. That directory holds `.claude-plugin/plugin.json` (name, version, metadata) and
`skills/`, which Claude Code loads in place under the plugin's namespace: `/klose:klose`,
`/klose:klose-update`, `/klose:klose-cleanup`. The plugin's `version` pins users until it changes, so
it is bumped with `package.json` (`test/plugin.test.js` checks they agree).

The plugin is deliberately thin. It carries no code: the CLI, the server and the canvas are still the
`klose` npm package, which the skill calls with `npx klose …` exactly as it does from a copied skill.
The first `/klose:klose` in a repo without the package tells the agent to install it once (globally,
or as a devDependency). `klose init --no-skills` sets up `.klose/` for such a repo without writing a
second copy of the skills into `.claude/skills/`. Updates split along the same line: Claude Code
refreshes the plugin (`/plugin marketplace update openklose`), npm refreshes the package.

`plugin/` is a subdirectory rather than the repo root on purpose: a plugin's top-level `bin/` goes on
the agent's PATH and stops claude.ai from installing it, and the repo root has one. Only the skills
and the manifest are cloned into `~/.claude/plugins/`.

### Machine-wide: `klose setup`

`npx klose setup` sets up every repo at once instead: it installs the skills into
`~/.claude/skills/` (the same installer as `init`, so hand edits are kept), starts the hub in the
background, starts the macOS menu bar app, and opens the hub's `/welcome` page. The page
(`pages/WelcomePage.tsx`) walks four steps — welcome, the repos found, the skill, ready — and reads
everything fresh from `GET /api/setup` (`server/setup.js`), so it never shows a stale step. Its
choices (menu bar, start at login) are applied only by the final `POST /api/setup/finish`, which
also records `onboardingCompletedAt` in `~/.klose/settings.json`; until then the hub's home page
redirects to `/welcome`. The flow follows antiburn's onboarding: draft choices until the last
click, system side effects only after it.

## What Happens On `/klose`

The skill (see `plugin/skills/klose/SKILL.md`) instructs the agent to:
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

`app.css` declares the palette in a Tailwind v4 `@theme` block (`--color-app-surface-elevated`,
`--color-app-border-strong`, …) whose values are the RGB tokens in `index.html`, redefined there for
the light theme. The app's CSS is compiled at build time by `@tailwindcss/vite`; only the preview
sandbox still compiles Tailwind in the browser, since it styles code the agent writes on the fly.
Utilities must spell the token
exactly: `bg-app-surface-elevated`, not `bg-app-surfaceElevated`. A camelCase name generates no CSS at
all and the element silently renders with no background or border colour — which is what had happened
to every elevated surface on the canvas (the feedback tray, the sketch frames, the nav rail).

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
- A node can also carry `comments`: freeform feedback, written and read in the **feedback tray**
  (`components/Sidebar/FeedbackTray.tsx`) docked on the right of the canvas. Open (380px) it lists
  the comments of the selected sketch or of every sketch, holds the composer, and copies feedback for
  the agent; collapsed (64px) it is a strip with the comment count, one entry per sketch and a copy
  button. Its open/collapsed state is remembered in `localStorage`, and the canvas scroll area stops
  at its edge so it never covers a frame. "Copy for agent" formats comments (with the sketch's name
  and the project/node ids) via `lib/feedback.js` as text meant to be pasted straight into the coding
  agent's chat.
- **Comments have a lifecycle**, derived from two optional timestamps (`lib/feedback.js`,
  `commentStatus`): *new* (neither set), *sent* (`sentAt`: a copy handed it to the agent) and
  *resolved* (`resolvedAt`, with an optional `resolution` note). A copy carries only new comments
  when there are any, else everything open, and stamps `sentAt` on what it carried. The agent
  resolves with `klose resolve` (`store.resolveComments`); resolved comments stay on the node but
  drop out of pins, counts, `klose feedback`, the copied text and the exported README. Pins, the
  tray and the copied text all number comments by their place among the *open* ones.
- When the live-update stream brings in a version of the project this tab didn't write, the canvas
  merges it three ways (`lib/merge.js`) against the version it last knew was on disk (its load,
  last save, or last merge): a sketch edited here since keeps the local version, every other one
  takes the incoming version, and autosave writes back only what was kept. The merged state
  replaces the undo history, so ⌘Z can't quietly revert the agent's work and autosave the revert.
  `lib/changes.js` then diffs the result against what was on screen: new sketches, new
  code/notes/status, newly resolved comments. Moves and resizes don't count. Changed frames wear a
  badge for a few seconds and a toast says what happened, with a button to fit them into view.
- Autosave (`hooks/usePersistence.ts`) has no baseline until the page has loaded and called
  `markSaved`, so opening a file never writes it.
- **Viewport** math lives in `lib/viewport.js`: zoom steps, zooming around a point (⌘/Ctrl +
  wheel, pinch), and fitting a rect into view. A zoom change resizes the scroll content, so the
  canvas applies the matching scroll position in a layout effect after the new size is laid out.
  `isEditableTarget` there decides when canvas shortcuts must leave a key to a text field. The selected sketch's name, status, description, notes and frame size live in a
  **toolbar above the frame** (`SketchToolbar.tsx`: Details, Comment, code, and a ⋯ menu with
  screenshot, fit, duplicate and delete).
- A comment can optionally carry an `element` (`SelectedElementInfo`): the sandbox reports the
  clicked element's tag/text/classes/DOM-path — plus a `locator`, its nth-child path from the preview
  root — via postMessage, and the next comment is scoped to it, so the agent knows exactly which part
  of the preview the feedback targets. **Element comments are drawn as numbered pins on the preview**
  (`CommentPins.tsx`): the canvas sends the selected sketch's commented elements to the sandbox
  (`locate`), and the sandbox answers with their boxes (`pins`) after every render, resize and
  scroll. It finds each element by its locator, or, for older comments without one, by the best
  text/classes/breadcrumb match (`lib/pins.js`, which refuses to pin on a breadcrumb match alone).
  Pin numbers match the tray and the copied text. Clicking a pin highlights its comment in the tray,
  or opens it as a popup by the pin when the tray is collapsed. Comments on the whole sketch pin to
  the frame's right edge.
- **Targeting an element has two entry points, and `lib/targeting.js` decides which frame accepts a
  pick.** The toolbar's Comment button pins targeting to that sketch for one pick (and opens the
  tray); focusing the comment composer targets the selected sketch for as long as it holds
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

## What Jev Says About a Project

`server/insights.js` is the Jev-backed layer for a project's *own* content, next to
`server/componentIndex.js` for the repo's components. Same rules as there: opt-in on
`TYPESAFE_API_KEY`, explicit (a flag or a button, never on a save), metadata not source, every
answer written back into the project file so the canvas (over SSE) and the agent (over `klose
project get` / `klose feedback`) read the same thing, and the plain path intact on any error.

- **Sketch classification** (`server/classify.js`, `classifySketches`) asks the same role/kind
  questions a component gets, of a sketch's name, description and notes, and stores the answer on
  the node as `classification` keyed by a hash of what was sent. `sketchOverlaps` names the repo's
  classified primitives of the same kind when the sketch is itself a primitive: a second button in
  the making. `klose project classify`, `POST /api/projects/:id/classify`, and **Classify with
  Jev** in the toolbar's ⋯ menu; the frame's header shows the role and an `≈ Button` hint.
- **Feedback triage** (`server/triage.js`) asks, per open comment, what kind of change it is and
  how much work it is (two Choice questions, one request per sketch, batched), and stores the
  answer on the comment as `triage` keyed the same way. `klose feedback --triage`,
  `POST /api/feedback/triage`, the tray's **Triage** button; `lib/feedback.js` adds a `↳ triage:`
  line to the copied text and a `triageSummaryLine` for the tray. This is the one Jev feature that
  sends text the user wrote.
- **Token lint** (`server/lint.js`) is local first: `extractClasses` pulls class names out of a
  sketch's `className` attributes (strings, `cn(...)` arguments, template literals and their holes),
  `tokensFromCss` reads the repo's tokens off the same CSS `klose theme` renders previews with, and
  `findLiterals` keeps the stock palette colours, arbitrary values and stock radius/shadow steps
  that the repo has a token namespace for. With a key, one request offers each finding the tokens
  of its namespace (plus `none`) and the answer becomes a replacement class with Jev's probability.
  `klose project lint`, `GET /api/projects/:id/nodes/:nodeId/lint`, **Check tokens…** in the ⋯
  menu, and `lib/lintText.js` for the copied text.

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
