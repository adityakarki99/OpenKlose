---
name: klose-cleanup
description: Tidy up the local Klose canvas by removing sketches already built into real files and empty projects. Use when the user says "/klose-cleanup", asks to clean up or declutter the canvas, or the canvas has accumulated old built sketches.
---

# klose-cleanup: declutter the canvas

Built sketches and empty projects are safe to remove — for a built sketch, the real component
already lives in the repo, so the canvas copy is just history; an empty project never had anything
on it. Always show the user what would go before removing anything:

```
npx klose cleanup
```

This is a dry run by default — it reports what it *would* remove without changing anything. Show
the user that output. If they confirm, apply it:

```
npx klose cleanup --yes
```

Flags narrow the scope if the user only wants one kind of cleanup: `--built` removes only built
sketches, `--empty-projects` removes only empty projects; with neither flag, both run. Never pass
`--yes` without the user having seen and confirmed the dry-run output first — that confirmation is
the whole point of the two-step default.
