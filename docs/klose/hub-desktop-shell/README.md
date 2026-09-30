# Hub + desktop shell

Visual exploration for Phase 1 (machine-wide hub) and Phase 2 (Tauri tray shell): how Klose stops being per-repo by reading Claude Code session state, and how the interaction loop changes.

_Exported from Klose project `ebd92035-49a3-48d8-8cd5-700760d4f168` · 9 sketches_

## Sketches

1. [Architecture — how the hub knows about repos](#architecture-how-the-hub-knows-about-repos) — sketch
2. [Interaction — /klose in any repo](#interaction-klose-in-any-repo) — sketch
3. [Hub home — every repo, one canvas](#hub-home-every-repo-one-canvas) — sketch
4. [Navbar repo switcher](#navbar-repo-switcher) — sketch
5. [Canvas session strip](#canvas-session-strip) — sketch
6. [First run — enable the hub](#first-run-enable-the-hub) — sketch
7. [Menubar tray popover (desktop shell)](#menubar-tray-popover-desktop-shell) — sketch
8. [Repo view — many Klose files per repo](#repo-view-many-klose-files-per-repo) — sketch
9. [Canvas file tabs + save to repo](#canvas-file-tabs-save-to-repo) — sketch

---

## Architecture — how the hub knows about repos

**Status:** sketch · **Preview:** [`architecture-how-the-hub-knows-about-repos.tsx`](./architecture-how-the-hub-knows-about-repos.tsx)

Data flow: Claude Code's own on-disk session state → discovery → one hub server → canvas / tray. Sketches stay in each repo's .klose/

### Notes

Borrowed from antiburn: no hooks into the agent, no daemon inside repos. The hub is read-only over ~/.claude and only writes to ~/.klose/ (index, server.json) and to a repo's .klose/ when you sketch there. Refresh policy also antiburn's: fs watch on ~/.claude/sessions + repo .klose/projects, poll session json every 5s while an agent is working, 15s when idle, full reconcile every 5m. Phase 2 wraps exactly this server as a Tauri sidecar — nothing in the middle changes.

---

## Interaction — /klose in any repo

**Status:** sketch · **Preview:** [`interaction-klose-in-any-repo.tsx`](./interaction-klose-in-any-repo.tsx)

The end-to-end loop once the hub exists: agent, hub, canvas, tray. What changes vs today is highlighted

### Notes

Today steps 1–2 require klose init + serve per repo. With the hub the skill only needs `klose status --hub`; the hub already knows the root from the session file. Feedback flows back through the tray/strip so the user never has to find the right canvas tab. Open question for us: should `/klose` auto-focus the canvas on that repo (URL push via SSE) or just surface it in the switcher?

---

## Hub home — every repo, one canvas

**Status:** sketch · **Preview:** [`hub-home-every-repo-one-canvas.tsx`](./hub-home-every-repo-one-canvas.tsx)

Machine-wide landing view: repos discovered from ~/.claude/sessions, live agents pinned on top

### Notes

Replaces the per-repo Projects page as the first screen when the hub is running. Rows come from /api/repos. Live sessions (status working/idle) sort above recently-touched repos. Each row: repo name, branch, agent status dot, last activity, sketch count, pending comments. Clicking a row opens the canvas scoped to that root (/?root=...). 'Not yet set up' repos get a one-click Enable (creates .klose/ there).

---

## Navbar repo switcher

**Status:** sketch · **Preview:** [`navbar-repo-switcher.tsx`](./navbar-repo-switcher.tsx)

The current repo becomes a pill in the navbar; dropdown lists every discovered repo with agent status and feedback count

### Notes

Lives in Navbar.tsx next to the logo. Pill shows repo name + branch + status dot. Dropdown groups Live / Recent. Keyboard: Cmd+K opens it, type to filter, Enter switches root (URL ?root= updates, canvas reloads projects for that root). Selecting a repo that has no .klose/ prompts Enable inline instead of navigating.

---

## Canvas session strip

**Status:** sketch · **Preview:** [`canvas-session-strip.tsx`](./canvas-session-strip.tsx)

Thin strip above the canvas that reflects the live Claude session in this repo — what it's doing, which sketch it last touched, feedback it hasn't picked up yet

### Notes

Data from ~/.claude/sessions/<pid>.json (status, name, branch) plus the transcript tail (last tool call touching .klose/ or a component file). States: working (blue pulse), idle (green, shows 'N comments waiting — copy feedback'), no agent (strip collapses to a 1-line hint: 'Run /klose in this repo to start'). Clicking the sketch chip pans the canvas to that node.

---

## First run — enable the hub

**Status:** sketch · **Preview:** [`first-run-enable-the-hub.tsx`](./first-run-enable-the-hub.tsx)

What you see the first time the hub starts: repos it already found, and the three decisions (global skill, start at login, discovery sources)

### Notes

Shown once, from `klose hub` or the desktop app's onboarding window. Discovery is read-only and local, so the copy leans on that. 'Install /klose skill globally' writes ~/.claude/skills/klose/ so the skill works in every repo without `klose init`. Repos with no .klose/ get created lazily on first sketch, not here. Everything is skippable; hub still works with defaults.

---

## Menubar tray popover (desktop shell)

**Status:** sketch · **Preview:** [`menubar-tray-popover-desktop-shell.tsx`](./menubar-tray-popover-desktop-shell.tsx)

Phase 2: the Tauri tray. 380pt popover anchored under the menubar item, antiburn-style — active repos, feedback waiting, one-click Open

### Notes

Primary click toggles popover; secondary click opens menu (Open canvas, Pin window, Start at login, Settings, Quit). Tray icon dot: none = no agents, blue = an agent is working, amber = feedback waiting for an agent. Popover hides on focus loss / Esc unless pinned. Rows are the same data as the hub home, condensed. 'Copy feedback for agent' per repo reuses the FeedbackTray formatter.

---

## Repo view — many Klose files per repo

**Status:** sketch · **Preview:** [`repo-view-many-klose-files-per-repo.tsx`](./repo-view-many-klose-files-per-repo.tsx)

Inside one repo: every canvas is a file. Shows where each lives on disk, how far along it is, and whether the repo copy is up to date

### Notes

Replaces the current Projects page once a repo is selected. One row per project (.klose/projects/<id>.json). Columns: name + saved path, sketches, built x/y, pending comments, save state, last edit. Save state is the key new idea: 'Saved' = docs/klose/<slug>/ matches the canvas; 'Changed since save' = canvas edited after the last export, one-click Save re-runs export; 'Canvas only' = never exported, 'Save to repo' runs it the first time. Save = `klose project export`. Row click opens that canvas. 'New file' creates a project; the agent's `project create` lands here live via SSE. Open question: should Save be automatic on every canvas change (always in sync, noisier git diff) or stay explicit?

---

## Canvas file tabs + save to repo

**Status:** sketch · **Preview:** [`canvas-file-tabs-save-to-repo.tsx`](./canvas-file-tabs-save-to-repo.tsx)

On the canvas: the repo's open Klose files as tabs, with the save state and the folder it saves to always visible.

### Notes

Sits under the navbar, above the session strip. Tabs = files open in this repo (persisted per repo in localStorage); dot on a tab = changed since last save; amber count = pending comments. '+' opens the file picker (same list as the Repo view). Right side shows where the active file saves and a Save button (Cmd+S) that runs `klose project export`; after saving it flips to 'Saved · 9 files' with a link that reveals the folder. Agent-created files appear as a new tab without stealing focus.

