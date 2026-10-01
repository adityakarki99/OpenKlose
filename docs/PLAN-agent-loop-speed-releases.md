# Klose plan: a faster agent editing loop, a faster and more reliable app, and a release process

Written against `main` at 4ea503b (Klose 0.2.0), October 2026. Every claim below points at the file
it comes from; the numbers were measured in this checkout.

## 0. What Klose is, and the constraints any plan has to respect

Klose is three things that share one data format:

1. **A local Node server with no runtime dependencies** (`server/`, `bin/klose.js`). It serves a REST
   API over JSON files in `.klose/projects/<uuid>.json`, pushes a Server-Sent Events `update` whenever
   that folder changes, and serves the pre-built canvas from `web/dist`. It binds `127.0.0.1` only.
2. **A React canvas** (`pages/CanvasPage.tsx`, 1145 lines, plus `components/`) where each sketch is a
   frame holding a sandboxed iframe (`preview.html` + `preview-runtime.tsx`). The iframe compiles the
   agent's TSX with Babel standalone and Tailwind's browser build, in an opaque origin with
   `connect-src 'none'`.
3. **A CLI that is the agent's whole interface.** The `/klose` skill (`skills/klose/SKILL.md`, 263
   lines) tells Claude Code to shell out: `klose status`, `project list`, `feedback`, `theme`,
   `components`, `project add-node @file.json`, `project update-node`, `resolve`. Klose has no model
   and no agent runtime of its own.

Around those sit the hub (`server/hub.js`, one server for every repo, found through Claude Code's
own session files), the macOS tray (`bin/tray/KloseTray.m`) and the Tauri desktop app
(`apps/desktop`), which bundles a Node binary plus a copy of the npm package and runs
`node klose.js hub`.

Constraints that shape everything below, and that the plan keeps:

- **Zero runtime dependencies.** The package installs into other people's repos. `test/README.md`
  makes this explicit. Build-time dependencies are fine; runtime ones are not.
- **The agent is the intelligence; the CLI is the contract.** Anything that makes the loop faster
  must be reachable as a plain command the skill can name, because that is what Claude Code runs.
- **JSON on disk is the source of truth** and is read by two writers at once: the canvas (via PATCH)
  and the CLI (direct `store.js` calls from a separate process).
- **Untrusted sketch code never runs in the server process.** Only the opaque-origin iframe runs it.
- **One version number** is shared by the npm package, the skill text copied into user repos, the
  project JSON shape, and the desktop app (`tauri.conf.json` reads `package.json`'s version).

---

## 1. Giving the agent a more efficient way to edit the design

### 1.1 What the loop costs today

Trace one iteration of "change the pricing card" as the skill prescribes:

| Step | Agent action | Cost |
| --- | --- | --- |
| Find the server | `npx klose status` | 1 process (~100 ms) + 1 model turn |
| Find the project | `npx klose project list`, pick an id | 1 process + 1 turn |
| Check comments | `npx klose feedback --project=<id>` | 1 process + 1 turn |
| Read the sketch | `npx klose project get <id>`, find the node in a JSON dump that includes every node's full `code` | 1 process + 1 turn, and the whole project in context |
| Edit | Write the **entire** `code` string into a JSON file (escaped newlines and quotes), then `project update-node <id> <nodeId> @/tmp/x.json` | 1 Write + 1 process + 1 turn |
| See the result | Nothing. The sandbox's "Render Error" is painted in the browser only (`Preview.tsx` `error` state); the agent never learns whether its code rendered | Blind |
| Resolve | `npx klose resolve <id> <nodeId> <commentId> --note=…` | 1 process + 1 turn |

Each process is cheap (measured: `project list` 90 ms, `theme --json` 116 ms, `components --json`
179 ms on 47 files). The expensive part is the **model turns**: six to eight tool calls of
orientation before the first edit, and then a full-file rewrite for every change, with no way to
check the outcome. The per-sketch `code` field is a JSON string, so the agent's precise `Edit` tool
(string replacement in a real file) is unusable on it; it must regenerate the whole component.

Concrete evidence of the mismatch: `store.updateNode` (`server/store.js`) does `{ ...n, ...updates }`
with no validation, so a typo like `"status": "done"` or a malformed `comments` array is accepted
silently; `types.ts` is the only schema and it lives in the canvas, not the server.

### 1.2 Proposals, ranked by payoff per unit of work

**P1. One orientation call: `klose context [--project=<id>] [--json]`.**
Returns in a single JSON document what steps 1 to 4 of the skill fetch separately: server state
(local / hub / stopped, URL), the project list with node names and ids but *not* code, open feedback
(the `listFeedback` shape), the theme summary (`tokenCount`, `sources`, `warnings`), and the
component index count with the top folders. With `--project`, include that project's nodes with
`code` **lengths** and a `codeHash`, not the code. The agent then fetches one node's code only when
it is about to edit it (`klose sketch get <project> <node>`, below). This collapses four turns into
one. It is a thin composition of functions that already exist (`findServer`, `hubUrlForRepo`,
`listProjects`, `listFeedback`, `loadTheme`, `scanComponents`).

**P2. Sketch code as a file, not a JSON string.**
Three layers, each useful on its own:

1. `--code=@path.tsx` on `add-node` and `update-node`: read the file as the raw `code` field. No
   escaping, no JSON wrapper for the common case. Ten lines in `parseJsonArg`'s neighbourhood.
2. `klose sketch get <project> <node> [--out=path.tsx]` and `klose sketch put <project> <node> path.tsx`.
   The agent writes the TSX to a scratch file, uses its normal `Edit` tool for a targeted change
   (one class, one string), and puts it back. The round trip stays two commands, but each edit is a
   diff instead of a regeneration, which is what actually shortens the model's work.
3. Materialised sketches: `klose sketch open <project> <node>` writes
   `.klose/sketches/<nodeId>.tsx` and the server watches that folder; a save of that file becomes an
   `update-node` with the new `code` (and the canvas live-reloads through the existing SSE path).
   The export format already produces one `.tsx` per sketch (`server/export.js`) with a header the
   scanner recognises, so this is the same idea made bidirectional for the working copy. Keep
   `.klose/sketches/` in `.klose/.gitignore`. Risk: two sources of truth; mitigate by making the
   `.tsx` a view that is regenerated whenever the JSON changes from elsewhere, with a one-line
   header carrying the node id and the code hash it was generated from.

**P3. Close the eyes: render status back to the agent.**
The sandbox already posts `rendered` / `error` to the canvas (`preview-runtime.tsx`
`renderError`, `postAfterPaint`). Add a `POST /api/projects/:id/nodes/:nodeId/render` that the
canvas calls with `{ ok, error, codeHash, at }`, stored on the node as `lastRender`. Then:

- `klose project get` and `klose context` show `lastRender` per node, and
- `klose sketch wait <project> <node> [--timeout=5000]` blocks until a `lastRender` whose
  `codeHash` matches the current code arrives, printing the error text on failure.

The skill's step 5 then becomes "write, wait, fix if it failed". Nothing new runs in the server; the
canvas tab does the work it already does. If no tab is open, `wait` says so and exits non-zero,
which is the right signal (the skill already tells the agent to `serve --open`).

A cheaper partial check that needs no browser: a server-side parse of the sketch for the contract
the skill states (one default export, imports limited to `react`, `lucide-react`, `recharts`, no
`fetch`). This is a regex pass like `server/scanner.js` already does, not a compile. Expose it as
`klose sketch lint <file.tsx>` and run it inside `add-node` / `update-node`, returning a
`SKETCH_CONTRACT` error code with the offending line. It catches the most common failures (a
repo-local import, a named export only) before the browser ever sees them.

**P4. Let the agent see: screenshots on demand.**
`preview/screenshot.ts` already rasterises inside the sandbox and returns a PNG data URL over
postMessage; only the user can trigger it. Add a command channel on the existing SSE stream
(`event: command`, `{ type: 'capture', projectId, nodeId, requestId }`), have the canvas tab run the
capture and `POST` the PNG to `/api/projects/:id/nodes/:nodeId/screenshot`, saved to
`.klose/shots/<nodeId>.png`. `klose sketch shot <project> <node>` requests it and prints the path.
Claude Code reads images, so the agent can look at what it drew, compare two variants, or check that
a comment was addressed. The same PNG doubles as the lazy-mount placeholder in section 2.2 and as a
thumbnail on the Files page. Keep `.klose/shots/` git-ignored.

**P5. Batch and atomic edits: `klose project apply <id> @ops.json`.**
An array of operations (`add-node`, `update-node`, `resolve`, `delete-node`) applied in one
read-modify-write of the project file, one `updated_at` bump, one SSE event. Today "three variants
side by side" is three processes and three canvas merges. This also removes the most common race
(section 2.3) for the agent's own multi-step edits.

**P6. Validate writes, with error codes.**
A small hand-written validator in `server/store.js` (no dependency) for node and comment shapes:
known `status` values, `code` is a string, `comments[]` entries keep `id`, `text`, `createdAt`, and
the fields the skill says to preserve (`element`, `sentAt`, `resolvedAt`, `resolution`). Reject with
`badRequest(..., 'INVALID_NODE')` so both the CLI and the API say *what* was wrong. The test README's
convention (status + `code`, unit and HTTP cases) applies.

**P7. Address sketches by name or id prefix.**
`update-node <id> "Pricing card"` or the first 8 characters of a UUID. Ambiguity returns a list.
Small, but it removes a whole class of copy-paste errors in the agent's transcript.

**P8. Rewrite the skill around the new primitives, and make it shorter.**
The current skill is thorough but linear. With P1 to P5 in place the main `SKILL.md` can be about a
third of its length: context → read the design system → search components → ideate → write with
`--code=@file` → `sketch wait` → on feedback, `sketch get`, edit, `sketch put`, `resolve`. Move the
Jev ranking and the export how-to into `skills/klose/reference/*.md` that the skill points at
(Claude Code loads those on demand). Add a test that extracts every `klose …` command the skill
mentions and runs `klose help <command>` against it, so the instructions can't drift from the CLI.
Prefer `klose feedback` over the clipboard everywhere the skill speaks to the agent; the clipboard
path stays for humans.

**P9. Push feedback to the agent instead of waiting to be asked.**
Two options, cheapest first:

- A Claude Code hook. `klose init --wire-hooks` adds a `UserPromptSubmit` hook to
  `.claude/settings.json` that runs `klose feedback --project=… --brief` and injects "N open comments
  on the canvas" into the prompt context when N > 0. Config only, no server change, and it answers
  "why did the user open /klose" before the skill even loads.
- An MCP server. The feedback tray already has a disabled **Use MCP** button
  (`components/Sidebar/FeedbackTray.tsx` line 478). MCP would give typed tools (no shell quoting, no
  JSON-in-argv), resources (the project as a document the model can read), and server-initiated
  notifications. It costs a protocol implementation; the official SDK is a runtime dependency, which
  the zero-deps rule forbids, but MCP over stdio is JSON-RPC with a handful of methods and can be
  written in a few hundred lines on `node:readline`. Do this **after** P1 to P5, because the MCP
  tools would be the same store functions with schemas; building MCP first would mean designing the
  primitives twice. Keep the CLI canonical so every other agent still works.

**P10. Preview fidelity for real repo components (later).**
Today a component with a relative import is flagged "not previewable" (`scanner.js`
`hasRelativeImports`) because the sandbox can only `require` three packages. The ticket in
`docs/TICKET-LOCAL-COMPONENT-FEEDBACK-LOOP.md` deferred a bundler on purpose. The honest shape of a
solution: if the host repo has `esbuild` or `vite` in its own `node_modules`, run a **bundling**
step (which does not execute component code) in a child process with a strict allowlist of entry
files, and feed the output to the sandbox. Opt-in flag, clearly documented as "uses your repo's
bundler". Not before the loop above is solid.

### 1.3 What the loop looks like after P1 to P5

```
klose context --project=<id>            # one call: server, nodes, open comments, theme, index
klose sketch get <id> "Pricing card" --out=/tmp/pricing.tsx
# …Edit /tmp/pricing.tsx with the normal Edit tool…
klose sketch put <id> "Pricing card" /tmp/pricing.tsx   # validates the contract, writes, one SSE event
klose sketch wait <id> "Pricing card"                  # exits 0 when the canvas rendered it, else prints the error
klose sketch shot <id> "Pricing card"                  # optional: look at it
klose resolve <id> "Pricing card" <commentId> --note="Raised contrast on the CTA"
```

Four to five commands per iteration, all with structured output, versus seven to eight today with
one blind spot.

---

## 2. Making the whole app faster and more reliable

### 2.1 Measured baseline (this checkout, Node 22)

| Thing | Measured |
| --- | --- |
| `npm run build` | 14.7 s, 2511 modules |
| Canvas page JS (app + React + router chunk) | ~450 KB raw, ~130 KB gzipped; only these are preloaded by `index.html` |
| Preview runtime loaded by **every** sketch iframe | 3,251 KB raw, 746 KB gzipped (Babel standalone + Tailwind browser + React), plus lazy chunks for recharts (478 KB) and lucide (863 KB) when a sketch uses them |
| Unit tests | 185 tests, 172 pass, 13 browser tests skipped without Chromium, 5.2 s |
| CLI process | 90 to 180 ms per command |
| Component scan | 47 files in 179 ms, regex-based, re-walked by every CLI process (the 4 s cache in `scanner.js` lives in memory, so it only helps the server) |

The canvas page itself is lean. The weight is in the per-sketch sandbox and in a few data-path
choices.

### 2.2 Canvas and preview performance

**Mount previews lazily.** `SketchNode.tsx` renders `<Preview>` for every node that has code, no
matter where it is on the board. A board with 20 sketches is 20 iframes each instantiating Babel,
Tailwind's compiler and React, and each compiling the repo's theme CSS. Use an `IntersectionObserver`
on the canvas scroll container to mount only frames within one viewport of the visible area, keep
the last N (say 12) mounted, and show the stored screenshot (P4) or the description as the
placeholder. This is the single biggest win for large boards and costs nothing on small ones.

**Compile once, not per iframe.** Babel standalone is most of the preview bundle. Two routes:

- Keep Babel but run it in one place: a hidden "compiler" iframe or a Web Worker in the canvas page
  transforms TSX to JS, caches by code hash, and the sketch iframes receive compiled JS over
  postMessage. The sandbox contract (opaque origin, no network) stays; the sandbox simply gets a
  `render` message with `compiled: true`. Per-iframe cost drops to React + Tailwind.
- Replace Babel standalone with Sucrase (~250 KB, JSX + TypeScript stripping, no `env` preset).
  Sketches target modern Chromium only, so the `env` preset Babel currently runs is pure overhead.
  Sucrase is a build-time dependency bundled into the preview, so the zero-runtime-deps rule holds.
  Expected preview bundle: roughly 1 MB raw instead of 3.2 MB. Verify with the browser tests.

Doing both is reasonable; the second is the simpler first step.

**Stop paying for Tailwind per frame.** Each iframe compiles Tailwind over the theme CSS and its own
classes. With compile-once in place, the parent could also precompute the theme-derived CSS once
and send the sketch only its utility classes; Tailwind's browser build does not expose that split
cleanly, so treat this as a later optimisation after measuring.

**Gesture smoothness.** The canvas already coalesces pointer events on animation frames and sets
`pointer-events: none` on iframes during gestures (`frameGeometry.js`, `Preview.tsx`). Add
`content-visibility: auto` on off-screen frames and avoid re-rendering every `SketchNode` on each
drag tick: `nodes` is one array in `useHistory`, so moving one frame re-renders all frames'
props. Memoising `SketchNode` and passing stable callbacks is a contained refactor with a visible
payoff at 15+ sketches.

**Autosave snapshots.** `usePersistence.ts` does `JSON.stringify(data)` on every render to compute
`isDirty`, and the SSE handler stringifies base and incoming to compare them. With large `code`
strings and frequent drags this is measurable. Compare per-node `updatedAt` plus a cheap hash
instead, and debounce the snapshot computation to the save timer.

### 2.3 Data integrity: the real reliability risks

**Non-atomic writes (fixed alongside this document).** `writeProjectFile` called `writeFile`
directly, which empties the file before filling it. A reader in that window (the CLI, the canvas
after an SSE event, or the browser test polling the file) got "Unexpected end of JSON input"; CI hit
exactly this on the PR that added this plan. The fix is to write a temp file and `rename` it into
place, which is atomic on every platform Klose supports, with a store test that reads while
writing. One function, eleven call sites unaffected.

**Lost updates between the canvas and the CLI.** Both do read-modify-write with no precondition:

1. the agent runs `update-node` (file now v2);
2. the canvas, which still holds v1 plus a pending debounced autosave, fires `PATCH /projects/:id`
   with its full `nodes` array before it has processed the SSE event for v2;
3. `updateProject` spreads the body over v2 and writes v1's nodes back. The agent's change is gone,
   and `lib/merge.js` never sees it because the merge runs on the SSE path, not the save path.

The merge logic handles the *ordinary* case well (the browser test proves it). The fix for the race
is optimistic concurrency: the canvas sends `baseUpdatedAt` with every PATCH; the server rejects with
`409 STALE_WRITE` when the file's `updated_at` differs; the canvas then runs the existing merge and
retries. `nextUpdatedAt` already guarantees strictly increasing timestamps, so the precondition is
trustworthy. Add a test in `http.test.js` that interleaves a CLI write and a stale PATCH.

**Whole-project PATCH is a large blast radius.** The canvas saves all nodes every time. Move the
canvas to per-node writes (`PATCH /nodes/:nodeId`, which exists) for node edits, and project-level
PATCH only for name, notes and context. Smaller writes, smaller windows, and the agent's node and
the user's node rarely collide.

**No schema version.** Project files carry no `schemaVersion`. The read path tolerates unknown
fields (object spread), which is good, but there is no way to migrate on read when a field's meaning
changes (comments gained `sentAt`/`resolvedAt` already). Add `schemaVersion: 1` on write and a
`migrate(project)` step in `readProjectFile` that upgrades older shapes in memory. Required before
any format change in section 3.

**Validation** (P6 above) belongs here too: a bad write from any client should be a 400, not a
corrupted file.

### 2.4 Server hot paths

- `GET /api/projects` (`http.js`) calls `listProjects` and then `getProject` again for every project
  to compute `repoState`, which rebuilds the full export (`build(project)`, `server/export.js`) and
  hashes it, per project, per request. The Files bar refetches this on every SSE event and every
  save. Cache `repoState` per `(id, updated_at, savedToRepo.digest)` in memory; the inputs are
  already in the file.
- **Own-write echo.** Every canvas save triggers watch → SSE → `GET /projects/:id` → deep compare →
  discard. Include a `writer` id in the PATCH and echo it in the SSE payload (the event body is `{}`
  today) so the canvas skips its own writes without a fetch.
- **Hub listing.** `GET /api/tray` and `/api/repos` run `listRepos`, which for every candidate repo
  reads every project file (`describe` → `listProjects`) and reads `.git/HEAD`. The desktop app
  polls `/api/tray` every 5 s (`lib.rs` `POLL`). Cache `describe` per root keyed on the projects
  folder's mtime, or keep one `fs.watch` per known repo (the `createRepoEvents` machinery already
  exists per root) and invalidate on change.
- **Theme and scan caches are 4 s and in-process.** Fine for the server; useless for the CLI, which
  is a new process each time. Persist the component index to `~/.klose/index/<repoId>.json` keyed
  by file mtimes (the classification cache already lives there), and only re-read files whose
  mtime changed. Big monorepos with thousands of `.tsx` files will feel this.

### 2.5 Platform floor and dependencies

- `engines.node >= 18`. Node 18 reached end of life in April 2025; the canvas build already needs
  20.19+. Raise the floor to 20 in the next minor, matrix CI on 20, 22 and 24, and drop the
  `EBADENGINE` caveat from `ci.yml`. The desktop app bundles Node 22.23.3 and is unaffected.
- Keep zero runtime deps. Every proposal above is either `node:` built-ins or a build-time
  dependency bundled into `web/dist`.

### 2.6 Tests to add (the suite is good; these are the gaps)

| Gap | Test |
| --- | --- |
| Concurrent writers | `http.test.js`: CLI `updateNode` between a canvas GET and PATCH → 409, then merge succeeds |
| Crash mid-write | `store.test.js`: a `.tmp` left behind is ignored; a truncated file reports `PROJECT_CORRUPT`, not a stack trace |
| Skill ↔ CLI drift | `skills.test.js`: every `klose <cmd>` named in `SKILL.md` has `klose help <cmd>` output |
| Large boards | `browser-canvas.test.js`: 30 sketches with code, assert at most N iframes mounted and a drag stays under a frame budget |
| Merge fuzz | `merge.test.js`: random base/local/incoming triples; invariants (no node lost that was edited locally; every incoming node not edited locally is taken) |
| Render status | `browser-preview.test.js`: a sketch with a bad import yields a `lastRender.error` on the node via the new endpoint |

### 2.7 Operability

- `klose doctor`: Node version, package version, hub state and version, skill state per repo and
  global (`skillStatus` exists in `server/skills.js`), port in use, `.klose/` writable, last 20
  lines of `server.log` / `hub.log`. Most support questions become one paste.
- Log rotation: `~/.klose/hub.log` and `.klose/server.log` are opened in append mode and never
  truncated. Rotate at 5 MB.
- The desktop app restarts a hub it finds down, but a hub the user started keeps running after the
  app is killed (documented in `apps/desktop/README.md`). Record `startedBy` in `hub.json` so
  `klose doctor` can explain which process owns the hub.

---

## 3. How to release updates

### 3.1 Where releasing stands today

- Version is 0.2.0 and **the package is not on npm** (`npm view klose` returns 404); the README
  tells people to install from GitHub, which runs `scripts/prepare.mjs` to build the canvas.
- **Two npm release workflows conflict.** `.github/workflows/release.yml` publishes on tags `v*`;
  `.github/workflows/release-npm.yml` publishes on `klose-v*`, with stronger gates (typecheck,
  package-contents check, provenance, a GitHub release not marked Latest). The older one should be
  deleted; a `v0.3.0` tag today would publish without the typecheck or the contents check.
- `release-app.yml` builds macOS (arm64 and x64) and Windows installers on `klose-app-v*`, verifies
  the signed Node binary runs, and drafts a release marked Latest (install scripts and the updater
  follow Latest; npm releases never do). Signing and the updater are **off** until the Apple and
  Tauri secrets exist; `tauri.conf.json` ships `pubkey: ""`, so there is no in-app update path yet.
- Four things version together but reach users on different paths: the package (npm or bundled in
  the app), the skill text (copied into `.claude/skills/` per repo or `~/.claude/skills/` globally),
  the project JSON shape, and the desktop shell.
- No CHANGELOG, no release notes beyond GitHub's generated list, no post-publish verification.

### 3.2 Decisions

1. **One version number stays.** It is already wired through `tauri.conf.json` and the two tag
   prefixes; splitting versions would multiply the compatibility matrix for a one-maintainer
   project. What changes: add `schemaVersion` to project files (section 2.3) and a
   `skillVersion` line in each `SKILL.md` front matter, so the CLI and the hub can **detect** skew
   even though they can't prevent it.
2. **`main` is always releasable.** CI already gates PRs with tests on three Node versions, typecheck,
   build, browser tests and the pack-and-install smoke test. Keep that; releases are a tag on a
   green `main` commit, nothing more.
3. **npm first, desktop second, same version.** The desktop app bundles the package, so the app
   release for version X is cut only after `klose@X` is on npm and has passed the post-publish
   check. Users on the app and users on npm then run identical code.
4. **Skill changes are behaviour changes.** Any edit to `skills/*/SKILL.md` gets a line in the
   release notes under "What the agent does differently", because the user won't see a diff.
5. **Prereleases exist.** `0.3.0-next.1` publishes to the `next` dist-tag; desktop builds for a
   prerelease come from `workflow_dispatch` as artifacts, never as a Latest release.

### 3.3 The release train

**Cut a release (one script, `scripts/release.mjs`):**

```
npm run release -- minor        # or patch, major, prerelease --preid=next
```

1. Refuse unless on `main`, clean tree, up to date with origin.
2. `npm test && npm run typecheck && npm run build && npm run smoke` locally (the same gates CI runs;
   failing here is cheaper than failing on the tag).
3. Bump `package.json` (and `apps/desktop/package-lock.json` is untouched; the app reads the root
   version).
4. Generate the CHANGELOG section from commits since the last `klose-v*` tag. The repo's commit
   messages are already sentences ("Send :root variables from HTML <style> blocks to previews"), so
   a plain list works without Conventional Commits. Prompt for the "What the agent does differently"
   lines when any `skills/` file changed.
5. Commit "Release 0.3.0", tag `klose-v0.3.0`, push both.

**Publish (CI, `release-npm.yml`, already written):** tag check, tests, typecheck, build, smoke,
package-contents check, `npm publish --provenance`, GitHub release with notes, not Latest.

**Verify (new job in the same workflow, after publish):** in an empty temp dir,
`npm install klose@<version>` from the registry, then `npx klose --version`, `init --no-demo`,
`serve --detach --port=0`, `status`, `stop`. This is `scripts/smoke-pack.mjs` pointed at the
registry instead of the tarball; a failure here deprecates the version automatically and fails the
workflow loudly.

**Desktop (manual trigger after verify):** `git tag klose-app-v0.3.0 && git push --tags`.
`release-app.yml` builds, checks the bundled Node runs under the hardened runtime, drafts the release
with `SHA256SUMS`, `latest.json` and the install scripts. A human opens the draft, installs one
build, runs the welcome flow once, and publishes. Publishing makes it Latest, which is what
`install.sh`, `install.ps1` and the in-app updater follow.

**Cadence:** patch releases whenever a fix lands and CI is green; a minor every few weeks with
notes; never batch a skill change with an unrelated risky change, because the only rollback for a
skill is another release.

### 3.4 How each kind of user gets the update

| Install path | How they update today | What to add |
| --- | --- | --- |
| Per-repo devDependency | `/klose-update` → `klose update` (reinstalls, refreshes skills via the hash manifest, tells them to restart the server) | Keep. Make `klose status` print "0.2.0 installed, 0.3.0 available" when `~/.klose/latest.json` (below) is newer |
| Global skills + hub via `npx klose setup` | Nothing automatic; `npx` may cache an old version | Skill text should say `npx klose@latest`; `klose setup` and the hub home should show the installed version and whether `~/.claude/skills/klose` is current / outdated / edited (`skillStatus` already computes this) |
| Desktop app | Tauri updater checks 30 s after launch and every 6 h, **only once signing keys exist** | Generate the key pair, set `TAURI_SIGNING_PRIVATE_KEY[_PASSWORD]` and the `TAURI_UPDATER_PUBKEY` variable, put the public key in `tauri.conf.json`. Until then there are no app updates at all |
| Skills inside repos after a desktop update | The app bundles a newer CLI, but the repo's `.claude/skills/klose/SKILL.md` is whatever `init` copied | On hub start, run `skillStatus` for every known repo and show "skills outdated in 3 repos, update?" on the hub home; the install is `installSkills`, which already preserves user edits |

**On "is there a newer version":** Klose is local-only by design, so the server must not phone
home silently. The desktop updater is the one component that already talks to GitHub, and only
with the user's consent at setup. For npm users, have `klose update` and `klose doctor` query the
registry explicitly (they are user-initiated), and cache the answer in `~/.klose/latest.json` for
`status` to read. No background checks from the server.

### 3.5 Compatibility rules (write them into `docs/RELEASING.md`)

- Project JSON: additive only within a major. New fields optional; readers ignore unknown fields
  (already true); `schemaVersion` bumps only with a migration in `readProjectFile`.
- CLI: never rename a command the skill names without keeping the old one as an alias for one
  minor, because repos carry old skill files.
- API: the canvas and the server ship together, so the HTTP API can change freely; the CLI's JSON
  output is a contract with the agent and follows the CLI rule.
- The sandbox contract (three packages, one default export, Tailwind classes) is part of the skill.
  Expanding it is fine; narrowing it needs a major.

### 3.6 Rolling back

- npm: `npm deprecate klose@X "…"` and `npm dist-tag add klose@X-1 latest`. Users on `npx klose@latest`
  get the previous version on next run; devDependency users run `klose update`.
- Desktop: mark the previous GitHub release as Latest again (edit the release). `install.sh` and
  the updater follow Latest, so the next check offers the older build; Tauri treats a lower
  version as "no update", so also publish a `X.Y.Z+1` built from the previous commit if the bad
  build must be actively replaced.
- Data: because migrations are additive, an older CLI reading a newer file keeps working; an older
  file read by a newer CLI is migrated in memory and rewritten on the next save.

### 3.7 Immediate release to-dos (before any feature work)

1. Delete `.github/workflows/release.yml`; keep `release-npm.yml`.
2. Publish 0.2.0 (or 0.2.1 with the fix above) to npm so the README's "not on npm yet" path and
   `scripts/prepare.mjs` stop being the primary install.
3. Generate the Tauri updater key pair and set the secrets; the workflow already handles their
   presence.
4. Add `docs/RELEASING.md` with sections 3.3 to 3.6, and `CHANGELOG.md` seeded from the tag history.

---

## 4. Sequencing

| Phase | Scope | Why this order |
| --- | --- | --- |
| **0. Release hygiene** (days) | 3.7: delete the stale workflow, publish to npm, updater keys, RELEASING.md, CHANGELOG | Everything after this ships through this path |
| **1. Integrity + first agent wins** (1 to 2 weeks) | Atomic writes, `schemaVersion`, validation with codes, 409 on stale PATCH, per-node canvas writes; `klose context`; `--code=@file`; `sketch get/put`; render status + `sketch wait`; shorter skill with the drift test | The agent primitives depend on writes being safe; both change `store.js`, so do them together |
| **2. Canvas speed + agent sight** (1 to 2 weeks) | Lazy iframe mounting, screenshots on demand and as placeholders, Sucrase (or compile-once), `SketchNode` memoisation, `repoState` cache, SSE writer id, persistent scan cache, Node 20 floor | Screenshots serve both the agent and the placeholder; measure before and after with the large-board browser test |
| **3. Push, batch, protocol** (2 weeks) | `project apply`, the `UserPromptSubmit` hook, skill-drift warnings on the hub home, `klose doctor`, then the MCP server behind the existing button | MCP wraps primitives that exist by now |
| **4. Fidelity** (later) | Opt-in bundling of real repo components using the host's own bundler | Highest risk, smallest share of the loop |

Each phase is releasable on its own and lands as a minor version with notes that say what the agent
does differently.
