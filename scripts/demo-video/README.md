# Hosted canvas demo video

`run.sh` renders [`docs/videos/hosted-canvas-demo.mp4`](../../docs/videos/hosted-canvas-demo.mp4):
a 100-second marketing walkthrough of the hosted canvas, with a voice-over and captions.

It is the real thing, recorded: the hosted canvas (`npm run build:static`) runs in headless
Chromium with no server, and is handed an in-memory stand-in for the repo folder (the same
File System Access shim as `test/browser-folder.test.js`) seeded with OnCue's real `index.css`,
so every preview is rendered with OnCue's tokens. The "agent" is the script writing
`.klose/projects/<id>.json` from outside the page, which is what the CLI does.

| Scene | What it shows |
| :--- | :--- |
| Intro | Title card. |
| Front door | Choose the repo folder; nothing else to install. |
| Files | The repo's Klose file, written there by the agent. |
| Canvas | Three OnCue sketches (a Plan card, the run sheet, Cue's suggestions) as live previews in OnCue's tokens. |
| Agent | A fourth sketch appears within a second or two of the agent writing it. |
| Comment | An element-scoped comment on the run sheet's "Running late" button, copied for the agent. |
| Resolve | The agent updates the sketch, resolves the comment and marks the Plan card built, with its file path. |
| Outro | The URL. |

## Files

- `sketches.mjs`: the OnCue sketches (self-contained TSX against `rgb(var(--token))`, the way
  the `/klose` skill writes them) and the project file they live in.
- `narration.json`: the voice-over, one entry per scene. `assemble.py` turns it into captions
  too, and spells URLs and commands properly there.
- `pages/`: the intro and outro cards.
- `harness.mjs`: the static host, the folder shim, a drawn cursor and the agent's writes.
- `record.mjs`: the choreography, paced to the narration's measured durations.
- `assemble.py`: mixes the narration at each scene's start, burns captions, encodes the MP4
  and a poster PNG.

## Requirements

Node 18+, Playwright with Chromium (`npx playwright install chromium`), ffmpeg built with libass,
Python 3 with `pip install piper-tts`, and the [CueHost](https://github.com/adityakarki99/CueHost)
repo checked out next to this one (or `DEMO_REPO=/path/to/CueHost`). For the type to match,
install the Manrope and Fraunces fonts on the machine (Google Fonts); the preview sandbox can't
load web fonts. The Piper voice (en_US lessac, about 60 MB) is fetched once into `.work/`.

```bash
scripts/demo-video/run.sh                 # → docs/videos/hosted-canvas-demo.mp4 (+ .png poster)
scripts/demo-video/run.sh /tmp/demo.mp4   # elsewhere
```

Intermediate files (voice, audio, the raw recording, captions) stay in `scripts/demo-video/.work/`,
which is git-ignored.
