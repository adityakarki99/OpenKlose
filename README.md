# Klose

**A local design-ideation canvas that lives inside your coding agent.**

Install it in any repo, run `/klose` in Claude Code, and get a local canvas for sketching component
ideas against your project's *real* design system — then have the agent build them as real files.

No login, no cloud backend, no bundled API keys. Klose has no AI model of its own: it's a visual
scratchpad and a place to keep design notes; your coding agent does the ideation and the building,
grounded in your actual repo.

---

## How it works

1. **Install** the package in a repo and run `klose init` — this drops a `/klose` skill into
   `.claude/skills/klose/` and creates local project storage at `.klose/`.
2. **Run `/klose`** in Claude Code. It starts a local server, opens the canvas in your browser, and
   reads your repo's actual design tokens and components before talking to you about what to build.
3. **Ideate** with the agent in chat. Once a component's shape is settled, the agent writes a live
   preview onto the canvas — a real, rendered mockup (not just a labeled box), grounded in your
   design system and styled to match your existing components.
4. **Leave feedback**, right on the sketch — add a comment, or hit "Point to an element" and click a
   specific button/heading in the live preview to scope your comment to it. "Copy for agent" copies a
   formatted summary (including any targeted element) to paste back into the chat.
5. **Build**, when you're ready — say so, and the agent writes the real component file into your
   project, following the design system it read, then marks the sketch built on the canvas.

Everything is stored as plain JSON files under `.klose/` in your repo — no account, no server to
manage beyond the one `klose serve` starts locally.

---

## Install

```bash
npm install -D klose
npx klose init
```

Then in Claude Code, run:

```
/klose
```

The skill handles starting the local server for you. To run it manually:

```bash
npx klose serve --open
```

---

## CLI reference

```
klose init                                        Install the /klose skill and local storage in this repo
klose serve [--port=N] [--open]                   Start the local server (default port 5171)
klose project list                                List projects
klose project create <name>                       Create a project
klose project get <id>                             Read a project
klose project update <id> <json|@file.json>       Merge fields into a project
klose project delete <id>                          Delete a project
klose project add-node <id> <json|@file.json>     Add a sketch node to a project's canvas
klose project update-node <id> <nodeId> <json|@file.json>   Update a sketch node (e.g. its code, or mark it built)
```

These are the same primitives the `/klose` skill uses — everything the agent does is a plain CLI
call you can run yourself. Any `<json>` argument can instead be `@path/to/file.json` — handy for the
`code` field, since a multi-line component snippet is painful to pass as a shell argument.

---

## Architecture

```
your-repo/
├── .claude/skills/klose/SKILL.md   The /klose skill (copied in by `klose init`)
└── .klose/projects/<id>.json       One JSON file per project — nodes, notes, design system text

klose package
├── bin/klose.js       CLI (init / serve / project *)
├── server/store.js    File-based project storage (reads/writes .klose/projects/*.json)
├── server/http.js     Local HTTP server: REST API + SSE live-refresh + serves the built canvas UI
├── skills/klose/SKILL.md   Source of the skill file klose init copies into your repo
└── web/               The canvas UI (React + Vite), built to web/dist and shipped in the package
```

The canvas UI itself has no AI dependency — it's a projects list and an infinite board of
draggable/resizable sketch nodes, persisted through the local server's REST API. A sketch can carry
`code` (self-contained React/TSX written by the agent), which the canvas renders live in a sandboxed
iframe (`components/Runtime/Preview.tsx`) — no code from Klose ever executes outside that sandbox.
A sketch can also carry `comments` — freeform feedback you leave in the inspector panel, with a
"Copy for agent" button that formats them (plus the sketch's name/id and the project id) as text
ready to paste into the chat. All the "smart" behavior (reading your design system, asking
clarifying questions, writing the preview and the real component, acting on feedback) happens in the
coding agent via the `/klose` skill, not inside Klose.

---

## Local development (working on Klose itself)

```bash
npm install
npm run dev      # Vite dev server for the canvas UI, proxies /api to localhost:5171
npm run build    # Builds the canvas UI into web/dist for packaging
```

To exercise the CLI/server against this checkout without publishing:

```bash
npm run build
node bin/klose.js init      # run from inside some other test repo
node bin/klose.js serve --open
```

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes with a descriptive message
4. Push and open a Pull Request against `main`

Please keep PRs focused. One feature or fix per PR makes review faster.

---

## License

[MIT](./LICENSE)
