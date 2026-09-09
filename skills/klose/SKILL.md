---
name: klose
description: Open the local Klose design-ideation canvas for this repo, ideate a new UI component against the project's real design system, render a live preview of it on the canvas, and build it as a real file once the user confirms. Use when the user says "/klose", asks to sketch/ideate a component visually, or wants to design something before building it.
---

# Klose: ideate on the canvas, build in the repo

Klose is a local, no-login canvas for placing component ideas ("sketches") on an infinite board — it
has no AI model of its own. You (the coding agent) do the ideation, write the sketch's preview code,
and do the eventual build; Klose gives the user a visual place to see sketches (rendered live, not
just as labeled boxes), rearrange them, and store per-project design notes.

## 1. Make sure the local server is running

Check whether `.klose/` exists in the current repo. If not, this is the first run:

```
npx klose init
```

This copies this skill file into `.claude/skills/klose/` (already done if you're reading this from
there) and creates `.klose/projects/`.

Then ensure the server is up. Try listing projects first — if it fails to connect, start the server
in the background and retry:

```
npx klose project list
# if that fails to connect:
npx klose serve --open &
```

`klose serve` prints the URL it's listening on (default `http://localhost:5171`). Tell the user that
URL so they can watch the canvas while you work, unless you already opened it with `--open`.

## 2. Pick or create a project

List existing projects (`npx klose project list`) and ask the user which one this work belongs to,
or default to a project named after the current repo/feature if this is clearly new work. Create one
if needed:

```
npx klose project create "<name>"
```

Note the returned project `id` — every subsequent command needs it.

## 3. Ground yourself in the REAL design system

Before ideating, read the *host repository's* actual design system — do not invent generic tokens.
Look for, in this order of likely relevance:

- A Tailwind config (`tailwind.config.*`) — colors, spacing scale, font families, custom utilities.
- CSS custom properties (`:root { --... }` in global stylesheets) or a dedicated tokens file.
- An existing component library (`src/components/ui`, `components/`, a design-system package) —
  read a few representative components to learn naming conventions, prop patterns, and styling
  approach (CSS modules vs Tailwind vs styled-components, etc).
- The project's `.klose` project record itself: `npx klose project get <id>` returns
  `designSystemPrompt` (freeform notes the user pinned) and `projectContext` (brand/audience notes)
  — read and honor both.

If you find nothing (a brand-new project with no conventions yet), say so and ask the user for
direction rather than guessing.

## 4. Ideate with the user

Have the actual design conversation here, in chat — ask about purpose, states, data it displays,
interactions, edge cases. Keep it tight (a couple of focused questions, not an interrogation). This
replaces what used to be an AI "planning mode" inside the tool; now it's just you talking to the user
with real repo context loaded.

## 5. Put the sketch on the canvas, rendered live

Once the shape of the component is settled, write a **live-previewable sketch**, not just a labeled
box — a self-contained React/TSX snippet the canvas renders in a sandboxed iframe, so the user sees
something real rather than a text card. Write the node as a JSON file (multi-line `code` is painful
to pass as a shell argument) and pass it with `@`:

```json
// /tmp/sketch.json
{
  "name": "Pricing card",
  "description": "3-tier pricing card, monthly/annual toggle, middle tier highlighted",
  "notes": "States: monthly vs annual pricing. Highlight tier needs a badge. No real data yet — use placeholders.",
  "code": "export default function PricingCard() {\n  return (\n    <div className=\"...\">...\n    </div>\n  );\n}"
}
```

```
npx klose project add-node <projectId> @/tmp/sketch.json
```

- `name` / `description` — short human labels for the canvas card.
- `notes` — the details from step 4 (states, interactions, data) — keep writing these; they matter
  for step 6 even though `code` now also exists.
- `code` — the live preview. **Ground it in what you read in step 3**: use the same color/spacing/
  radius language as the repo's real tokens, and mimic the visual style of its existing components —
  don't fall back to generic defaults when the repo already has a design language. Contract for this
  code (it runs in an isolated sandbox, not the real app):
  - A single self-contained file: one default-exported function component, no props required to render.
  - Only `react`, `lucide-react`, and `recharts` are available via `require(...)` / `import` — no other
    imports, no fetch/network calls (the sandbox blocks them).
  - Style with Tailwind utility classes (the sandbox loads the Tailwind CDN, same as the canvas itself).
  - Use realistic placeholder content, not lorem ipsum — actual-looking copy, prices, names, etc.
  - This is a visualization aid, not the deliverable — it doesn't need to match the real codebase's
    import paths or component-splitting conventions, just its *look*.
- `x`/`y`/`width`/`height` — optional; omit and let the user drag it into place, or place it
  sensibly near existing nodes if you know the layout.

The node is created with `status: "sketch"`. If the open canvas tab doesn't visually update within a
second or two, the server may not have picked up the file change — that's fine, a page refresh will
show it. Iterating on a sketch's look (user asks for changes) is a normal `update-node` call with a
new `code` (same `@file.json` approach) — no need to touch the real repo for that.

## 6. Build it for real, on confirmation

When the user says to build it (or confirms your proposed plan), write the actual component file(s)
into the real project source tree using your normal file tools — following the design system and
conventions from step 3 (real import paths, the repo's actual component patterns), not the sandbox's
simplified contract from step 5. The preview code is a sketch, not something to copy-paste as-is.

Then mark the sketch as built so the canvas reflects reality:

```
npx klose project update-node <projectId> <nodeId> '{"status":"built","builtFilePath":"src/components/PricingCard.tsx"}'
```

## Notes

- Never invent a design system when the repo already has one — read before you generate, for both
  the preview code (step 5) and the real build (step 6).
- A sketch is a completely normal, finished state on its own — not everything needs to be built
  immediately. Don't push to build unless asked.
- If the user is iterating on an existing sketch rather than starting fresh, read it first
  (`npx klose project get <projectId>` and find the node) so your edits build on their notes and
  existing preview code instead of overwriting them from scratch.
