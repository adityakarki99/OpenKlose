# Klose desktop app

Klose as a desktop app: the canvas in a window of its own, plus an icon in the macOS menu bar or the
Windows system tray. It's a [Tauri 2](https://tauri.app) shell around the hub. Its shape, release pipeline and install scripts follow
[antiburn](https://github.com/antiburn/antiburn)'s desktop app.

The app has no Klose logic of its own:

- **The hub** is the klose npm package, run by a copy of Node bundled inside the app
  (`node <resources>/klose-package/bin/klose.js hub`). If a hub is already running
  (`npx klose hub`), the app uses that one instead and leaves it running on quit.
- **The Klose window** shows the hub's pages in the app, like an Electron app would. Opening the
  app (Dock, Finder, Start menu) or choosing Open Klose shows it. Links that leave the hub open in
  the browser, and exports are saved to Downloads. Closing the window leaves the icon and the hub
  running; Quit stops both. On macOS the Dock icon shows while a window is open. Started at login,
  the app stays in the menu bar until it's opened.
- **The icon** polls `GET /api/tray` every 5 seconds. It is blue while an agent works and amber
  when comments are waiting in a repo no agent is busy in.
- **The popover** (left-click) shows the hub's `/tray` page. A repo clicked in it opens in the
  Klose window; other links open in the browser.
- **Setup** shows the hub's `/welcome?shell=desktop` in a window until it's finished. Finishing
  applies "Start at login" (the app's own login item) and opens the Klose window.
- **The menu** (right-click) has Open Klose, Run Setup…, Start at Login, Check for Updates… and
  Quit Klose. Check for Updates… only appears in release builds that have an updater key.
- **Updates** are checked 30 seconds after launch and every 6 hours. A new version downloads,
  installs and relaunches the app on its own, but waits while an agent is working, since the
  relaunch restarts the hub. Until then the menu offers Restart to Install Klose x.y.z.

## Develop

Needs Rust (`rustup`), Node 22, and the canvas built in the repo root (`npm run build` there).

```bash
cd apps/desktop
npm install
npm run dev          # fetches Node, copies the klose package, runs the app
```

`scripts/prepare-sidecar.mjs` runs before every dev and build run. It downloads the pinned Node
release from nodejs.org, checks it against `SHASUMS256.txt`, and copies the klose package into
`src-tauri/resources/klose/`. `npm run icons` redraws every icon from geometry
(`scripts/generate-icons.mjs`).

To try the app without touching your own hub or login items, give it its own homes:

```bash
HOME=/tmp/k/home KLOSE_HOME=/tmp/k/klose src-tauri/target/debug/klose-desktop
```

## Release

Push a tag matching the klose package version:

```bash
git tag klose-app-v0.3.0 && git push origin klose-app-v0.3.0
```

`.github/workflows/release-app.yml` builds the Mac app twice (Apple Silicon and Intel) and the
Windows NSIS installer. It then drafts a GitHub release with the installers, `SHA256SUMS`,
`latest.json` (for the updater) and the two install scripts. Publish the draft to make it the
**Latest** release, which `install.sh`, `install.ps1` and the in-app updater all follow.

To build the installers without releasing anything, run the workflow by hand. They are uploaded
as workflow artifacts.

| Secret / variable | What it turns on |
|---|---|
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD` | Developer ID signing. Without it the app is ad-hoc signed: it runs, but a browser download needs right-click → Open once. `install.sh` downloads with curl, which never adds the quarantine flag, so it avoids that step. |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | Notarization |
| `TAURI_SIGNING_PRIVATE_KEY` (+ `_PASSWORD`) and the variable `TAURI_UPDATER_PUBKEY` | Signed updates: `latest.json` and the in-app updater. Generate the pair with `npx tauri signer generate`. **Required for a tagged release**, which fails without them: an app that can't update strands everyone who installed it. Keep a backup of the private key. Lose it and installed apps can never take another update. |

## Download links for a website

Each release also carries its installers under names that never change, so these links always
fetch the newest published release:

- `https://github.com/adityakarki99/OpenKlose/releases/latest/download/Klose-mac-apple-silicon.dmg`
- `https://github.com/adityakarki99/OpenKlose/releases/latest/download/Klose-mac-intel.dmg`
- `https://github.com/adityakarki99/OpenKlose/releases/latest/download/Klose-windows-setup.exe`

[`website/download-button.html`](website/download-button.html) is a ready-made button for a page
(on WordPress, paste it into a Custom HTML block). It picks the visitor's platform when the page
allows scripts, and falls back to plain links when it doesn't.

## Install

```bash
# macOS
curl -fsSL https://github.com/adityakarki99/OpenKlose/releases/latest/download/install.sh | sh
```

```powershell
# Windows
irm https://github.com/adityakarki99/OpenKlose/releases/latest/download/install.ps1 | iex
```

Both scripts find the newest published release, download the build for this computer (the Mac
one tells an Apple Silicon Mac from an Intel one even in a Rosetta terminal), check it against the
release's `SHA256SUMS`, install it and open it. Run again later, they replace an older copy and
leave a current one alone (`KLOSE_FORCE=1` reinstalls; `KLOSE_NO_LAUNCH=1` installs without
opening; `KLOSE_VERSION=0.2.1` picks a version). The Mac script copies into `/Applications`, or
`~/Applications` when that isn't writable (`KLOSE_INSTALL_DIR` overrides it); the Windows one
installs per user, so no admin prompt.

A `.dmg` or `-setup.exe` downloaded in the browser works too: on a Mac that says the app can't be
checked (the build is ad-hoc signed until there is a Developer ID certificate), right-click
Klose.app → Open, once. The scripts skip that step because they verify the download themselves.

## Notes

- `Entitlements.plist` gives the bundled Node permission for its JIT. Signing (even ad-hoc)
  turns on the hardened runtime, which otherwise kills Node with SIGTRAP on its first line of
  JavaScript. The release workflow fails the build if that ever comes back.
- The Node binary makes up most of the app's size: about 39 MB for the `.dmg` and 119 MB
  installed.
- Quitting the app stops a hub that it started. If the app is killed without quitting, that hub
  keeps running, and the next launch finds it through `~/.klose/hub.json`.
