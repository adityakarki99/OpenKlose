"""Mixes the narration onto the recording at each scene's start, burns captions,
and encodes the final MP4 (H.264 + AAC, 1080p) plus a poster frame.

    python3 assemble.py [output.mp4]
"""
import json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, '.work')
OUT = os.path.join(WORK, 'out')
marks = json.load(open(os.path.join(OUT, 'marks.json')))
narration = json.load(open(os.path.join(HERE, 'narration.json')))
durations = json.load(open(os.path.join(WORK, 'audio', 'durations.json')))
final = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', '..', 'docs', 'videos', 'hosted-canvas-demo.mp4')
os.makedirs(os.path.dirname(final), exist_ok=True)
raw = os.path.join(OUT, 'raw.webm')

# The recording's frame timing drifts from wall time (the screencast delivers
# frames late while the page is busy), so the page paints a 16-bit clock,
# deciseconds since the script's t0, into its top-left 96x4 px. Read it back
# at 20 fps to map wall time → video time.
SAMPLE_FPS = 20
cells = subprocess.run(['ffmpeg', '-v', 'error', '-i', raw, '-vf', f'fps={SAMPLE_FPS},crop=96:4:0:0,scale=16:1:flags=area', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
                       check=True, capture_output=True).stdout
clock = []  # (video_time, wall_time)
for i in range(len(cells) // 16):
    bits = cells[i * 16:(i + 1) * 16]
    v = 0
    for b in bits:
        v = (v << 1) | (1 if b > 127 else 0)
    clock.append((i / SAMPLE_FPS, v / 10))

def video_time(wall):
    """The first video time whose painted clock has reached `wall` (seconds since t0)."""
    best = None
    for vt, wt in clock:
        if wt >= wall and abs(wt - wall) < 30:  # ignore garbage frames (navigations)
            return vt
    return wall

# Captions: one cue per sentence, sharing the scene's narration time by character count.
# The voice reads URLs and commands spelled out; the captions show them as written.
CAPTION_FIXES = [
    ('adityakarki99 dot github dot io slash OpenKlose', 'adityakarki99.github.io/OpenKlose'),
    ('slash klose', '/klose'),
    ('dot klose', '.klose/'),
    ('No more, the button in the header, second one down.', 'No more "the button in the header, second one down".'),
]

def srt_time(s):
    h = int(s // 3600); m = int(s % 3600 // 60); sec = s % 60
    return f"{h:02d}:{m:02d}:{int(sec):02d},{int(round((sec - int(sec)) * 1000)):03d}"

cues = []
for m in marks['marks']:
    m['video_at'] = video_time(m['at'])
    print(f"  {m['key']:8s} wall {m['at']:6.2f}s → video {m['video_at']:6.2f}s")
for m in marks['marks']:
    text = narration[m['key']]
    for a, b in CAPTION_FIXES:
        text = text.replace(a, b)
    sentences = [s.strip() for s in re.split(r'(?<=[.!?])\s+', text) if s.strip()]
    total_chars = sum(len(s) for s in sentences)
    t = m['video_at']
    for s in sentences:
        d = durations[m['key']] * len(s) / total_chars
        cues.append((t, t + d - 0.08, s))
        t += d
srt_path = os.path.join(OUT, 'captions.srt')
with open(srt_path, 'w') as f:
    for i, (a, b, s) in enumerate(cues, 1):
        f.write(f"{i}\n{srt_time(a)} --> {srt_time(b)}\n{s}\n\n")

# Audio: each scene's narration delayed to its mark, then mixed.
inputs = ['-i', os.path.join(OUT, 'raw.webm')]
delays = []
for i, m in enumerate(marks['marks'], 1):
    inputs += ['-i', os.path.join(WORK, 'audio', f"{m['key']}.wav")]
    ms = int(m['video_at'] * 1000)
    delays.append(f"[{i}:a]adelay={ms}|{ms}[a{i}]")
n = len(marks['marks'])
mix = ''.join(f"[a{i}]" for i in range(1, n + 1)) + f"amix=inputs={n}:normalize=0,alimiter=limit=0.95[aout]"
raw_len = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', raw]))
last = marks['marks'][-1]
total = min(raw_len, last['video_at'] + durations[last['key']] + 1.4)
srt = srt_path.replace(':', '\\:')
style = "FontName=Inter,FontSize=8,PrimaryColour=&H00FFFFFF,OutlineColour=&H99000000,BackColour=&H99000000,BorderStyle=4,Outline=1,Shadow=0,MarginV=22,MarginL=80,MarginR=80,Bold=0"
# The clock strip is painted over with the page's own background colour.
vf = f"fps=30,drawbox=x=0:y=0:w=100:h=6:color=0x0b0f1a:t=fill,subtitles='{srt}':force_style='{style}',fade=t=in:st=0:d=0.6,fade=t=out:st={total - 0.8:.2f}:d=0.8,format=yuv420p"
subprocess.run(['ffmpeg', '-y', '-v', 'error', *inputs, '-filter_complex', ';'.join(delays + [mix]), '-map', '0:v', '-map', '[aout]',
                '-vf', vf, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart',
                '-t', f"{total:.2f}", final], check=True)

# A poster frame from the canvas scene, for READMEs and link previews.
canvas_at = next(m['video_at'] for m in marks['marks'] if m['key'] == 'canvas') + 2.5
poster = os.path.splitext(final)[0] + '.png'
subprocess.run(['ffmpeg', '-y', '-v', 'error', '-ss', f"{canvas_at:.2f}", '-i', raw, '-vf', 'drawbox=x=0:y=0:w=100:h=6:color=0x0b0f1a:t=fill', '-frames:v', '1', poster], check=True)
print('wrote', final, 'and', poster)
