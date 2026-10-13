---
name: klose-update
description: Update the installed Klose npm package to the latest version and refresh the /klose skill files from it. Use when the user says "/klose-update", asks to update or upgrade Klose, or /klose behaves like it's running an old version.
---

# klose-update: keep Klose current

Run:

```
npx klose update
```

This upgrades the `klose` devDependency to the latest version (via whichever package manager this
repo uses — npm, yarn, or pnpm, detected from the lockfile), then re-copies every `.claude/skills/
klose*/SKILL.md` file from the freshly installed package. That second step matters: the skill files
already in `.claude/skills/` are a snapshot from whenever `init` (or the last `update`) ran, so
without this the npm package could be newer while the agent keeps following stale instructions.

Report the old → new version to the user. If the version actually changed, mention that `/klose`'s
instructions may be different now — treat this session's understanding of the skill as refreshed,
not the one you had before running the command.

If the command fails (network error, no `klose` devDependency present, etc.), show the user the
error rather than guessing at a fix.

**If this skill came from the Klose plugin** (you ran it as `/klose-update` under the `klose`
plugin, and there is no `.claude/skills/klose/` in the repo), the skill files are updated by Claude
Code, not by this command: tell the user to run `/plugin marketplace update openklose`, or to let
Claude Code's plugin auto-update do it. `npx klose update` still upgrades the CLI and canvas when
`klose` is a devDependency here; for a global install it is `npm install -g klose@latest`.
