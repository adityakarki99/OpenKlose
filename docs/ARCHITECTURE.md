# Klose — Architecture & How It Works

## What Is This?

Klose is an npm package that installs a `/klose` skill into Claude Code (or any repo that wants it).
It gives you a local, no-login canvas for sketching component ideas — rendered live on an infinite
board, not just as labeled boxes — and grounds the coding agent's ideation in your project's *actual*
design system before it builds the real component into your repo.

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
bin/klose.js         CLI entry point: init / serve / project *
server/store.js       File-based CRUD over .klose/projects/<id>.json
server/http.js         Node HTTP server: REST API + SSE + serves the built canvas UI
skills/klose/SKILL.md  Source of the /klose skill (copied into consumer repos by `klose init`)
web/                    The canvas UI source (built to web/dist for packaging)
```

## What Happens On Install

`npx klose init` in a target repo:
1. Copies `skills/klose/SKILL.md` to `.claude/skills/klose/SKILL.md`, so Claude Code picks it up as
   the `/klose` command.
2. Creates `.klose/projects/` for local project storage.

## What Happens On `/klose`

The skill (see `skills/klose/SKILL.md`) instructs the agent to:
1. Ensure the local server is running (`klose serve`, backgrounded if needed) and share the URL.
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

## The Canvas UI

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
- A node can also carry `comments`: freeform feedback left in the `SketchInspector` panel, shown as a
  small count badge on the card. "Copy for agent" formats them (with the sketch's name and the
  project/node ids) as text meant to be pasted straight into the coding agent's chat.

## Local Server

`server/http.js` is a small Node `http` server (no Express) that:
- Serves a REST API (`/api/projects`, `/api/projects/:id`, `/api/projects/:id/nodes[/…]`) backed by
  `server/store.js`, which reads/writes `.klose/projects/<id>.json` in the current working directory.
- Watches `.klose/projects/` and pushes an SSE `update` event on any change, so an open canvas tab
  live-refreshes when the agent writes a new sketch from a separate CLI invocation.
- Serves the pre-built canvas UI (`web/dist/`) as static files, with an SPA fallback to `index.html`.

The CLI (`bin/klose.js`) calls the same `server/store.js` functions directly for `project *`
subcommands — it doesn't need the server running to read/write project data, but the server's
directory watch means changes made either way show up live in the browser.

---

## What Changed From the Original (Ceko) Version

The previous version of this codebase was a hosted SaaS: Supabase auth and Postgres storage, a
Vercel Edge Function proxying Google Gemini, and a sandboxed iframe that transpiled and ran
AI-generated code live in the browser. Auth, the cloud database, and the Gemini codegen pipeline
(blueprint generation, planning-mode chat, component editing, image generation, smart-parts
classification) have been removed, along with the asset/pattern library — those depended on a
server-side model call Klose no longer makes. The live-preview sandbox survived in simplified form
(no element inspection, no hover-highlight, no animation tracking — see `components/Runtime/`), now
fed by code the coding agent writes instead of a Gemini response. What else remains is the parts that
were never AI-dependent: the canvas's drag/resize/pan/undo mechanics, the project browser, and the
settings/theme system — now serving a much smaller, local-first tool.
