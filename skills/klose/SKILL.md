---
name: klose
description: Open the local Klose design-ideation canvas for this repo, ideate a new UI component against the project's real design system, render a live preview of it on the canvas, and build it as a real file once the user confirms. Use when the user says "/klose", asks to sketch/ideate a component visually, wants to design something before building it, or asks you to address feedback or comments left on the canvas.
---

# Klose: ideate on the canvas, build in the repo

Klose is a local, no-login canvas for placing component ideas ("sketches") on an infinite board — it
has no AI model of its own. You (the coding agent) do the ideation, write the sketch's preview code,
and do the eventual build; Klose gives the user a visual place to see sketches (rendered live, not
just as labeled boxes), rearrange them, and store per-project design notes.

## 1. Make sure the local server is running

Check whether `.klose/` exists at the repo root. If not, this is the first run:

```
npx klose init
```

This copies this skill file into `.claude/skills/klose/` (already done if you're reading this from
there), creates `.klose/projects/`, and prints which design tokens and components it found — pass
that summary on to the user in a sentence.

Then make sure the canvas is up. `klose project ...` commands read `.klose/` directly on disk and
"succeed" with no server running, so they can't tell you whether the canvas is reachable — use
`klose status`, which also checks the server belongs to *this* repo:

```
npx klose status
# if it reports not running:
npx klose serve --detach --open
```

`--detach` returns as soon as the server is up and prints its URL (usually `http://localhost:5171`,
or the next free port). Don't background `klose serve` with `&` — the detached server records itself
in `.klose/server.json`, so `status` and `npx klose stop` can find it later. If the canvas is already
running, `serve` just prints where. Tell the user the URL so they can watch the canvas while you
work.

## 2. Pick or create a project

List existing projects (`npx klose project list`) and ask the user which one this work belongs to,
or default to a project named after the current repo/feature if this is clearly new work. Create one
if needed:

```
npx klose project create "<name>"
```

Note the returned project `id` — every subsequent command needs it.

Once you have it, check for pending feedback: `npx klose project get <id>` and look at each node's
`comments`. If any sketch has comments, that's often *why* the user opened `/klose` — lead with
addressing that feedback rather than waiting to be asked.

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

## 3b. Reuse before you sketch — search the repo's real components

Klose indexes the *host repo's* actual components so you can reuse what already exists instead of
re-building it. Before ideating a new component, search for one that already does the job:

```
npx klose components <query>        # e.g. `npx klose components button`, `npx klose components pricing`
npx klose components --json         # full machine-readable index (name, file, line, props, description)
```

Each result gives the component's name, file path and line, its props, and a short doc comment. The
user can also browse this visually at the canvas server's **Components** tab (`/components`) and hit
"Copy for agent" to hand you a reuse note.

**Faster, meaning-based search (optional).** A text query misses a component whose name doesn't
contain your words (`pricing` won't find `PlanTier`). If `TYPESAFE_API_KEY` is set in the
environment, rank the index against a plain-language description of what you're about to build:

```
npx klose components "pricing table with a monthly/annual toggle" --rank --json
```

This asks Jev (TypeSafe AI) which component fits and whether *anything* does, sending only the
index's names, paths, props and doc comments — no source code. Act on `ranking.verdict`:

- `reuse` — open **only the top component's file** and build on it; don't browse for alternatives.
- `partial` — read the top two, then tell the user which is closest and ask whether to extend it or
  start fresh.
- `new` — nothing fits; go straight to sketching a new component instead of searching further.

Each component carries a `relevance` (0–1) for the ordering. If the key isn't set, or Jev is
unreachable, the command says so on stderr and returns the plain text matches instead — carry on
with those. Don't use `--rank` when the user hasn't set a key, and don't ask them for one.

- If a suitable component already exists, prefer **reusing/extending it** — read its file, then build
  on it (compose it, add a variant/prop) rather than sketching a duplicate. Tell the user you found
  an existing `<Name>` and are reusing it.
- Only sketch a genuinely new component when nothing fitting exists. When you do, still match the
  conventions of the components you found here.

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
  - Style with Tailwind utility classes. The sandbox compiles Tailwind locally and loads **the repo's
    own tokens** — its `tailwind.config.*` theme, `@theme` blocks and `:root` CSS variables — so use
    the repo's class names (`bg-primary`, `text-brand-500`, `rounded-card`) and `var(--...)`s rather
    than copying hex values. `npx klose theme` lists what the sandbox has; if it reports no tokens or
    a warning, fall back to literal values that match what you read in step 3.
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

If this build was in response to comments, clear the ones you addressed (or all of them, once
confirmed) so the canvas doesn't keep showing stale feedback — comments are just another field:

```
npx klose project update-node <projectId> <nodeId> '{"comments":[]}'
```

## Comments: the user's other way of talking to you

The inspector panel's "Copy for agent" button formats a sketch's `comments` (plus its name and the
project/node ids) as text for the user to paste into this chat — so a pasted block that starts with
"Feedback on the ... sketch" is a comment dump, not a fresh request. Treat it as feedback on that
specific sketch: read the sketch's current `code`/`notes` first, apply the feedback, update it
(step 5's `update-node`, or step 6 if it's ready to build), and clear the addressed comments as above.

A comment can be **scoped to a specific element** the user clicked in the live preview. In that case
the pasted block carries a `↳ targets element:` line naming the element's tag, visible text, DOM
path, and Tailwind classes — use it to locate exactly which part of the preview `code` the feedback
is about, rather than guessing. On the stored node, such a comment has an `element` field with the
same info.

## Notes

- Never invent a design system when the repo already has one — read before you generate, for both
  the preview code (step 5) and the real build (step 6).
- A sketch is a completely normal, finished state on its own — not everything needs to be built
  immediately. Don't push to build unless asked.
- If the user is iterating on an existing sketch rather than starting fresh, read it first
  (`npx klose project get <projectId>` and find the node) so your edits build on their notes and
  existing preview code instead of overwriting them from scratch.
