# Klose — Architecture & How It Works

## What Is This?

Klose is an npm package that installs a `/klose` skill into Claude Code (or any repo that wants it).
It gives you a local, no-login canvas for sketching component ideas — placed as labeled boxes on an
infinite board — and grounds the coding agent's ideation in your project's *actual* design system
before it builds the real component into your repo.

Klose has no AI model of its own. It used to (an earlier version generated and live-rendered code via
Google Gemini behind a hosted Supabase-backed SaaS), but that entire pipeline — auth, cloud database,
Gemini codegen, sandboxed live preview — has been removed in favor of this local, agent-driven model.

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
5. Write the settled design to the canvas as a sketch node (`klose project add-node`), so the user
   sees it and can reposition it.
6. On confirmation, write the real component file into the project using the agent's normal
   Read/Write/Edit tools, then mark the sketch `built` with the resulting file path
   (`klose project update-node`).

## The Canvas UI

- **`/projects`** — a grid of local projects (create, rename, delete), backed by the local server's
  REST API instead of a cloud database.
- **`/canvas/:projectId`** — an infinite pannable/zoomable board of `SketchNode`s: labeled boxes with
  a name, description, and freeform notes, plus a status (`sketch` or `built`) and, once built, the
  path of the real file the agent wrote. Drag, resize, undo/redo, and a project-context panel (brand
  notes + design-system notes the agent reads) all work exactly as before — none of that logic
  depended on AI.
- Nodes have **no code and no live preview**. There is nothing to sandbox or execute — a sketch is a
  plan, not a running component. Real code lives in the actual project, written by the agent.

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
AI-generated code live in the browser. All of that — auth, the cloud database, the Gemini codegen
pipeline (blueprint generation, planning-mode chat, component editing, image generation, smart-parts
classification), the asset/pattern library, and the live code sandbox — has been removed. What
remains is the parts that were never AI-dependent: the canvas's drag/resize/pan/undo mechanics, the
project browser, and the settings/theme system — now serving a much smaller, local-first tool.
