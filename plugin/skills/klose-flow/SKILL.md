---
name: klose-flow
description: Design a whole user flow from a description of what the user is trying to do, lay every step and every state of it out on the local Klose canvas, and build only the frames the user approved. Use when the user says "/klose-flow", describes a flow or journey rather than one component ("sign-up", "checkout", "invite a teammate", "reset a password"), or asks where an approved flow stands or to continue building one.
---

# klose-flow: from intent to an approved, built flow

`/klose` starts from a component. This starts from what the user is trying to get done: they
describe a flow, you lay the whole thing out (every step, and every state each step can be in),
they approve frames on the canvas, and you build only what they approved.

A flow is one Klose project. Each frame is an ordinary sketch that also carries `step` (its position
in the flow) and `state` (`default`, `loading`, `error`, …). Steps run left to right on the canvas;
a step's states are stacked under it. Everything the `/klose` skill says about the canvas, preview
code, comments and building still holds. This skill adds the plan, the approval gate and the order
of work.

## 1. Get the flow, the server and the design system

- Take the user's description as the brief. If it leaves out who the user is, where the flow starts
  or what "done" looks like, ask those in one message; don't ask what you can read from the repo.
- Make sure the canvas is running: `npx klose status` (step 1 of the `/klose` skill covers starting
  it, the hub, and working through a shared canvas).
- Ground yourself exactly as `/klose` steps 3 and 3b say: `npx klose theme`, the repo's tokens and
  conventions, and `npx klose components <query>` for every part of the flow before you sketch it.
  A flow reuses the app's existing form fields, buttons, layouts and empty states; it doesn't
  restate them. Read how the app already does navigation, data fetching and form errors too, since
  you will be wiring the steps together later.

## 2. Enumerate the steps and their real states

Write the flow down as steps, in the order the user meets them. Then, for every step, list the
states it can really be in. Go through this list for each step and keep only the ones that apply:

- `default`: the step as it first appears
- `loading`: waiting on data or on a submit
- `empty`: nothing to show yet
- `error`: the request failed, or the server said no
- `validation`: the user's own input is wrong
- `success`: the step's confirmation, when it has one of its own
- `signed-out` / `permission`: reached without the right to be there
- anything specific to this step (`expired-link`, `rate-limited`, `offline`, `partial`)

A static confirmation screen has one state. A form that submits has at least four. Don't pad a step
with states that can't happen, and don't leave out the ones that will: the states are the point of
laying a flow out before building it.

**Confirm the list with the user in one message** before you write any preview code: the steps in
order, the states under each, and what you are reusing from the repo. Change it as they say.

## 3. Put the flow on the canvas

Write the plan as a JSON file. Each state's `code` is preview code under the same contract as any
sketch (`/klose` step 5), showing that state for real (the error text, the disabled button, the
skeleton), not a note saying which state it is. Run `npx klose harness sketches` first: when it says
sketches are drawn by your bundler, compose each frame from the repo's real components with real
imports ("A sketch with real imports" in `/klose`); otherwise keep each one self-contained, in the
repo's tokens.

```json
// /tmp/flow.json
{
  "description": "A new user signs up with email and lands in an empty workspace.",
  "steps": [
    {
      "name": "Enter email",
      "description": "Email field and continue button. Reuses TextField and Button.",
      "states": [
        { "state": "default", "code": "export default function EnterEmail() { ... }" },
        { "state": "validation", "notes": "Malformed address; error under the field.", "code": "..." },
        { "state": "loading", "code": "..." },
        { "state": "error", "notes": "Address already registered; offer sign-in.", "code": "..." }
      ]
    },
    {
      "name": "Check your inbox",
      "states": [{ "state": "default", "code": "..." }, { "state": "expired-link", "code": "..." }]
    }
  ]
}
```

```
npx klose flow create "Sign-up flow" @/tmp/flow.json
```

It reports every problem with the plan at once and creates nothing until the plan is valid. A state
can also carry `name`, `description`, `width` and `height` (a phone-sized frame, say). The command
prints the project id; use it (or the flow's exact name) in the commands below.

Then tell the user, briefly: the flow is on the canvas, steps left to right; each frame has
**Approve** and **Changes** in its header; they can comment on a frame or click an element in it;
you build what they approve and nothing else. Then stop and wait for them.

## 4. The loop: status, comments, build what is ready

When the user comes back (or says "continue", or pastes feedback), run:

```
npx klose flow status <project> --json
```

It lists every frame by step and state with its `approval` (`approved`, `changes` or `null`), its
open comments, and whether it is built, plus two lists:

- `ready`: approved, not built, no open comments. **Build these.**
- `blocked`: everything else not built, each with a `reason` (`not approved yet`,
  `changes requested`, or open comments).

Work in this order:

1. **Address comments first.** `npx klose feedback --project=<id>` has them; handle each as the
   `/klose` skill describes (update the frame's `code`, then `klose resolve`). Changing a frame's
   code clears its approval: the user approved what they saw, not what you changed it to. Say so
   when you report back, so they know to look again. A frame marked `changes` with no comment is a
   question for the user: ask what they want changed.
2. **Build every `ready` frame, and only those.** A step's states are one component (or one screen)
   in the repo, not one file per frame: build the step so that it renders each approved state, as
   `/klose` step 6 says (real imports, the repo's patterns, not the preview code pasted in). Then
   mark each frame you built, with the file it lives in:

   ```
   npx klose project update-node <projectId> <nodeId> '{"status":"built","builtFilePath":"src/screens/EnterEmail.tsx"}'
   ```

   If a step has some states approved and others not, build the approved ones and leave the rest
   out of the code until they are approved; say which are missing.
3. **Never build an unapproved frame.** Not to "finish the step", not because it looks obviously
   fine. If the user tells you in chat that a frame is approved, record that first
   (`npx klose flow approve <project> <nodeId>` or `<step>:<state>`, e.g. `2:error`; `--all` only
   when they approved everything) and then build it.
4. **Wire the flow together once every step is built.** When `flow status` shows each step's
   frames built, connect them: navigation between the steps, the state they share, the real
   requests behind `loading` and `error`, and the entry point into the flow from the rest of the
   app. Until then, build steps so they stand alone.

## 5. Report where it stands

End every pass with a short summary: the files you built or changed, the frames whose approval was
cleared because you changed them, and what is still waiting on the user (from `blocked`, with the
reason). When `flow status` reports `complete`, say the flow is built and wired, and how to reach
it in the running app.

## Notes

- `npx klose help flow` has the full command reference.
- A flow project is an ordinary project: `klose project get`, `update-node`, `share`, `export` and
  `/klose-cleanup` all work on it.
- Adding a step or a state later is `klose project add-node` with `step` and `state` set (and `x`,
  `y` if you want it in its column); it starts unapproved like any other frame.
