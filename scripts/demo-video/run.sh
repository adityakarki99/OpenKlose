#!/usr/bin/env bash
# Renders docs/videos/hosted-canvas-demo.mp4: the hosted canvas, driven in
# headless Chromium against a stand-in repo folder styled with OnCue's tokens
# (the CueHost repo), with a synthesized voice-over and captions.
#
#   scripts/demo-video/run.sh [output.mp4]
#
# Needs: Node 18+, Playwright with Chromium (`npx playwright install chromium`),
# ffmpeg with libass, Python 3 with `piper-tts` (pip), and the CueHost repo
# next to this one (or DEMO_REPO=/path/to/CueHost). The voice model is
# downloaded once into scripts/demo-video/.work/voice.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
work="$here/.work"
mkdir -p "$work/voice" "$work/audio" "$work/out"

if [ ! -f "$root/web/static/index.html" ]; then
  echo "Building the hosted canvas…"
  (cd "$root" && node scripts/build-static.mjs)
fi

voice="$work/voice/en_US-lessac-medium.onnx"
if [ ! -f "$voice" ]; then
  echo "Fetching the Piper voice…"
  base="https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium"
  curl -fsSL -o "$voice" "$base/en_US-lessac-medium.onnx"
  curl -fsSL -o "$voice.json" "$base/en_US-lessac-medium.onnx.json"
fi

echo "Synthesizing the narration…"
python3 - "$here" "$work" "$voice" <<'EOF'
import json, subprocess, sys
here, work, voice = sys.argv[1:4]
n = json.load(open(f'{here}/narration.json'))
durs = {}
for key, text in n.items():
    out = f'{work}/audio/{key}.wav'
    subprocess.run(['python3', '-m', 'piper', '-m', voice, '-f', out, '--sentence-silence', '0.35', '--length-scale', '1.02'], input=text.encode(), check=True, capture_output=True)
    durs[key] = round(float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out])), 2)
json.dump(durs, open(f'{work}/audio/durations.json', 'w'), indent=2)
print('  ', durs)
EOF

echo "Recording…"
(cd "$here" && node record.mjs)

echo "Assembling…"
python3 "$here/assemble.py" "$@"
