# Tests

```bash
npm test        # node --test test/*.test.js — no watch mode, no config, a few seconds
```

CI runs this on Node 18, 20 and 22 (`.github/workflows/ci.yml`), plus `npm run
build` on 22. Both gate pull requests into `main`.

This file exists because agents change this repo. If you are an agent adding or
editing a test, read the conventions below first — most of them are load-bearing
in ways a diff won't show you.

## What's here

| File | Covers |
| --- | --- |
| `scanner.test.js` | `server/scanner.js` — component detection, prop extraction, filtering, and the path/extension guards in `readComponentSource` |
| `store.test.js` | `server/store.js` — project CRUD, node updates, and project-id validation at the filesystem boundary |
| `http.test.js` | `server/http.js` — routing, status codes and the Host/Origin/content-type guards, driven over a real server on an ephemeral port |
| `theme.test.js` | `server/theme.js` — CSS token extraction and Tailwind v3 config → v4 variables |
| `root.test.js` | `server/root.js` — which folder a command run from a subfolder acts on |
| `skills.test.js` | `server/skills.js` — skill installs that replace Klose's own copies but not the user's edits |
| `cli.test.js` | `bin/klose.js` as a subprocess — help, `init` from a subfolder, and `serve --detach` / `status` / `stop`, which bind `--port=0` |
| `browser-preview.test.js` | The built sandbox in headless Chromium (skipped without Playwright and `web/dist`) |

`server/` and the CLI are covered. The React canvas under `components/` and `pages/` has
no tests and no test runner configured for it — don't add a React test to this
suite expecting it to run.

## Conventions

**Use `node:test` and `node:assert/strict`. Do not add a test dependency.**
The package ships with zero runtime dependencies and that is deliberate — it
installs into other people's repos as a Claude Code skill. Reaching for vitest or
jest to get a matcher you like is not a good enough reason to change that. If a
helper is genuinely missing, write it in the test file.

**Every test gets its own temp directory.** Both `scanner.test.js` and
`store.test.js` have a `withTempRepo()` helper that mkdtemps a directory, runs the
body, and removes it in a `finally`. Tests must not touch the repo's own `.klose/`
directory or each other's state, and must pass in any order. Copy the helper
rather than sharing one across files — they differ (the scanner one seeds files,
the store one doesn't), and a shared fixture module is how these start coupling.

**`http.test.js` binds port 0, never a fixed port.** `server.listen(0)` gets an
ephemeral port and the test reads it back off `server.address().port`. A hardcoded
port breaks under parallel runs and on a developer machine that happens to be
running Klose.

**Assert the status code and the `code` field, not the message text.** Error
messages are prose and will be reworded. `server/errors.js` exists so that
`HttpError` carries a `status` and a stable machine-readable `code` —
`INVALID_PROJECT_ID`, `PROJECT_NOT_FOUND`, `NODE_NOT_FOUND`, `PATH_ESCAPES_ROOT`,
`NOT_A_SOURCE_FILE`. Assert on those. The `assert.rejects(..., /Invalid project
id/)` regexes in `store.test.js` predate `errors.js` and are the older style; new
tests at the HTTP boundary should check `res.status` and `body.code`.

**Assert the happy path alongside the failure.** A validation change that turns a
working request into a 400 passes every negative test. `http.test.js` ends with a
happy-path test for exactly this reason. Keep it that way.

## Adding a new error case

When you add a validation or guard to `server/`:

1. Throw via `badRequest()` / `notFound()` from `server/errors.js` with a new
   `code`, not a bare `new Error`. A bare Error is a 500 — which is a lie if the
   caller caused it.
2. Add the unit-level case to `scanner.test.js` or `store.test.js`.
3. Add the HTTP-level case to `http.test.js` asserting the status and `code`, so
   the mapping is pinned end to end and not just the throw.

Step 3 is the one that gets skipped. The mapping from a thrown error to a
response code has already regressed once in this repo's history; the unit test
did not catch it because the throw was never the part that broke.

## Things that are deliberate, not oversights

- **`test('literal ../ segments are collapsed by the URL parser before routing')`
  asserts a 404, not a 400.** Node's `URL` parser normalizes `..` away before
  routing, so that request never reaches the store. Percent-encoded traversal
  does reach it and returns 400. Both are asserted on purpose — the pair
  documents why the explicit id check is needed despite the parser. Don't
  "fix" the 404 into a 400.
- **`listProjects` silently skips entries that aren't well-formed UUIDs.** Ids
  have always been `randomUUID()`, so anything else in the directory isn't a
  project this code wrote. That skip is intentional; a test asserting it throws
  would be asserting the wrong behavior.
- **Tests run against a real filesystem and a real HTTP server, not mocks.** The
  suite is fast enough (~1s) that mocking `fs` buys nothing and would stop the
  path-containment tests from testing anything real.
