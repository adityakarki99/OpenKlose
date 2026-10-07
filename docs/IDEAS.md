# Ideas

A log of ideas that are not planned yet. One entry each, with enough context that someone can pick
it up later without the original conversation. Promote an entry into `PLAN-*.md` or a ticket when
it is scheduled; delete it when it is shipped or rejected.

## Design diffs: revert a sketch, or see what changed on the frame

**Logged:** 2026-10-07

**The idea.** Keep a history of each sketch's `code` (and maybe its description and notes) so that a
frame on the canvas can show *what changed* between two versions and be *reverted* to an earlier
one. Today the only history is the in-tab undo stack, which is thrown away whenever a merge from the
live-update stream replaces it (see `docs/ARCHITECTURE.md`, the merge note), so an agent edit made
through `update-node` or `klose sketch put` cannot be undone from the canvas at all.

**What it would look like.**

- Every write to a node's `code` (canvas save, CLI `update-node`, `sketch put`) appends a version:
  the previous code, a timestamp, and who wrote it (`canvas` or `agent`). Stored next to the
  project file so it survives tab reloads and is readable by the CLI.
- The frame's chrome gets a history control beside the code toggle: step back through versions,
  with the preview re-rendering each one in the same sandbox, and a **revert** that writes the
  chosen version back as a new version (never rewrites history).
- A **diff** view in the same place as `CodeView`: a line diff of the source, so the author can see
  what the agent touched. A visual diff (two screenshots side by side, or a slider) can come later;
  screenshots are already taken inside the sandbox, so the pieces exist.
- CLI access for the agent: `klose sketch history <id> "<name>"` and
  `klose sketch diff <id> "<name>" [--from v --to v]`, so a reviewer can ask the agent "what did you
  change in the pricing card" and get a real answer.

**Open questions.**

- Retention. Cap by count per node (say 50) or by size; sketch code is small, but a long session
  could grow the project file. A sidecar file per project (`<project>.history.json`) keeps the main
  file small and keeps the atomic-rename write path unchanged.
- Does a version record need the rendered screenshot too, or is re-rendering old code on demand
  good enough? Re-rendering is free and always current with the sandbox; stored screenshots are
  what you want when a component depends on something that no longer exists.
- Interaction with the optimistic-concurrency work in `PLAN-agent-loop-speed-releases.md` 2.3: a
  `409 STALE_WRITE` retry should not append a duplicate version.
