# Ticket: Reliable local component feedback loop

## Outcome

Make the preview → element feedback → agent retrieval loop work without public CDNs or clipboard
handoff, while retaining the opaque-origin iframe boundary. Never evaluate repository component code
inside the Klose server process.

## Accepted scope

- Bundle the host UI and preview dependencies into the published web assets.
- Keep previews in `sandbox="allow-scripts"` without `allow-same-origin`.
- Block preview network connections and remote images through CSP.
- Preserve element selection metadata (`tagName`, text, classes, DOM breadcrumb) on feedback.
- Expose pending feedback as stable JSON through `GET /api/feedback` and `klose feedback`.
- Give unsupported imports a clear preview error instead of silently replacing them with empty modules.
- Verify tests, production build, package contents, and the absence of external runtime URLs.

## Deferred follow-ups

- Project-aware browser bundling for components with relative imports, CSS modules, aliases, app
  providers, or framework-only loaders. This needs a deliberately isolated build worker; it must not
  execute untrusted component runtime code in the server.
- Automatic screenshot comparison, accessibility auditing, and interaction playback.
- Automated design-token discovery, history, and rollback.
- MCP can wrap the JSON CLI later if discovery warrants it; the CLI is the smaller compatible agent
  surface for this milestone.
- Tailwind's bundled browser runtime is v4, while the previous CDN runtime used v3-style JavaScript
  configuration. Core utilities and Klose's theme tokens are covered, but project-specific v3 plugins
  and config are not imported into previews. Project-aware styling belongs with the safe bundler work.

## Acceptance criteria

- [x] No host or preview entrypoint references a public runtime CDN.
- [x] The built preview includes React, Babel, Tailwind, Lucide, and Recharts locally.
- [x] Preview iframe has scripts only, no same-origin permission, `connect-src 'none'`, and remote
  images disabled.
- [x] An agent can fetch all feedback or filter by project as structured JSON without clipboard use.
- [x] Element-scoped feedback includes enough metadata to locate the target.
- [x] Relative/local imports fail with an explicit supported-contract message.
- [ ] Headless-browser render with every non-local request aborted. The installed Playwright package
  has no browser executable in this environment, so this must run in CI once Chromium is provisioned.
- [x] Unit/integration tests, production build, and package dry-run pass.

## Execution results

Recorded on 2026-09-16:

- `npm test`: passed after rebasing onto `main` (43 tests plus one skipped browser test), including structured store/API/CLI
  feedback, static sandbox/CSP checks, and opaque-origin module CORS coverage.
- `npm run build`: passed; both `index.html` and `preview.html` emitted with local hashed bundles.
- Browser regression: blocked before launch because Playwright's Chromium executable is not installed.
  The regression test is included and will run automatically where Chromium and built assets exist.
- `npm pack --dry-run --json`: passed; preview HTML and its local runtime bundle are included. Package
  size is about 1.17 MB compressed / 5.04 MB unpacked; the preview bundle is the main contributor.
