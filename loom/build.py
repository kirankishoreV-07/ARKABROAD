#!/usr/bin/env python3
"""Build the Loom video: slides → architecture → narrated demo → close.

  python3 loom/build.py --voice preview            # free macOS voice, to check timing
  python3 loom/build.py --voice elevenlabs         # ElevenLabs male voice (needs a key, see below)

ElevenLabs key: put it in the env var ELEVENLABS_API_KEY, or in the file ~/.elevenlabs_key (one line).
Voice: --el-voice <voice_id>  (default: Brian, a calm male narrator).
Output: loom/out/Ark_Outreach_Coach_Loom.mp4  +  .srt subtitles  +  per-line audio in loom/out/audio/
"""
import argparse, json, os, subprocess, sys, urllib.request, urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'out'
DEMO = Path(os.path.expanduser('~/Downloads/IMG_0284.MOV'))
ARCH = ROOT.parent / 'Ark_Outreach_Coach_Technical_Architecture.png'
SLIDES = ROOT / 'slides'
W, H, FPS = 1920, 1080, 30
# Crops of the 3840×2160 architecture image (x, y, w, h), all 16:9
ARCH_CROPS = {
    'full': (0, 0, 3840, 2160),
    'inputs': (48, 240, 1536, 864),
    'scoring': (850, 330, 2100, 1181),
    'drafting': (1620, 336, 2220, 1248),
    'outputs': (1536, 300, 2304, 1296),
    'ai': (760, 810, 2400, 1350),
}
DEFAULT_EL_VOICE = 'nPczCjzI2devNBz1KQlx'   # "Brian" (premade male voice)


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"command failed: {' '.join(map(str, cmd))[:300]}\n{r.stderr[-1500:]}")
    return r.stdout


def duration(path):
    return float(run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)]).strip())


def el_key():
    k = os.environ.get('ELEVENLABS_API_KEY', '').strip()
    f = Path(os.path.expanduser('~/.elevenlabs_key'))
    if not k and f.exists():
        k = f.read_text().strip()
    if not k:
        sys.exit('No ElevenLabs key: set ELEVENLABS_API_KEY or create ~/.elevenlabs_key')
    return k


def tts(seg, voice, el_voice, audio_dir, tempo=1.0):
    wav = audio_dir / f"{seg['id']}.wav"
    stamp = audio_dir / f"{seg['id']}.txt"
    tag = f"{voice}|{el_voice}|{seg['text']}"
    raw = audio_dir / (f"{seg['id']}.aiff" if voice == 'preview' else f"{seg['id']}.mp3")
    if raw.exists() and stamp.exists() and stamp.read_text() == tag:
        src = raw                                   # unchanged line: reuse the voice (saves ElevenLabs credits)
    elif voice == 'preview':
        aiff = audio_dir / f"{seg['id']}.aiff"
        run(['say', '-v', 'Daniel', '-r', '170', '-o', str(aiff), seg['text']])
        src = aiff
    else:
        req = urllib.request.Request(
            f'https://api.elevenlabs.io/v1/text-to-speech/{el_voice}?output_format=mp3_44100_128',
            data=json.dumps({'text': seg['text'], 'model_id': 'eleven_multilingual_v2',
                             'voice_settings': {'stability': 0.45, 'similarity_boost': 0.8, 'style': 0.15, 'use_speaker_boost': True}}).encode(),
            headers={'xi-api-key': el_key(), 'Content-Type': 'application/json', 'Accept': 'audio/mpeg'})
        try:
            data = urllib.request.urlopen(req, timeout=120).read()
        except urllib.error.HTTPError as e:
            sys.exit(f"ElevenLabs error {e.code} on {seg['id']}: {e.read()[:400]!r}")
        src = audio_dir / f"{seg['id']}.mp3"
        src.write_bytes(data)
    # atempo speeds the voice up without changing its pitch
    run(['ffmpeg', '-v', 'error', '-y', '-i', str(src), '-af', f'atempo={tempo:.3f}', '-ar', '44100', '-ac', '1', str(wav)])
    stamp.write_text(tag)
    return wav


def still_clip(image, crop, seconds, out, zmax=1.06):
    x, y, w, h = crop
    vf = (f"crop={w}:{h}:{x}:{y},scale={W*2}:{H*2},"                      # upscale first so the slow zoom stays smooth
          f"zoompan=z='min(zoom+0.0006,{zmax})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={int(seconds*FPS)+1}:s={W}x{H}:fps={FPS},"
          f"fade=t=in:st=0:d=0.3,fade=t=out:st={max(0, seconds-0.3):.2f}:d=0.3,format=yuv420p")
    run(['ffmpeg', '-v', 'error', '-y', '-loop', '1', '-i', str(image), '-t', f'{seconds:.3f}', '-vf', vf,
         '-r', str(FPS), '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-an', str(out)])


def demo_clip(start, end, needed, out):
    window = end - start
    factor = needed / window                      # >1: slow the recording so the line fits; <1: fast-forward idle moments
    if factor < 1:
        factor = max(0.6, factor) if window - needed > 1.0 else 1.0
    vf = (f"setpts={factor:.4f}*(PTS-STARTPTS),scale={W}:{H}:force_original_aspect_ratio=decrease,"
          f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=0xF3ECE2,fps={FPS},format=yuv420p")
    run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{start:.3f}', '-t', f'{window:.3f}', '-i', str(DEMO), '-vf', vf,
         '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-an', str(out)])
    return window * factor, factor


def mux(video, wav, seconds, out, lead=0.25):
    # narration starts `lead` s in, padded with silence to the clip length
    run(['ffmpeg', '-v', 'error', '-y', '-i', str(video), '-i', str(wav), '-filter_complex',
         f"[1:a]adelay={int(lead*1000)},apad,atrim=0:{seconds:.3f},aresample=44100[a]",
         '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', f'{seconds:.3f}', str(out)])


def srt_time(t):
    ms = int(round(t * 1000)); h, ms = divmod(ms, 3600000); m, ms = divmod(ms, 60000); s, ms = divmod(ms, 1000)
    return f'{h:02}:{m:02}:{s:02},{ms:03}'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--voice', choices=['preview', 'elevenlabs'], default='preview')
    ap.add_argument('--el-voice', default=DEFAULT_EL_VOICE)
    ap.add_argument('--tempo', type=float, default=1.15, help='voice speed (1.0 = as generated)')
    a = ap.parse_args()
    segs = json.loads((ROOT / 'segments.json').read_text())['segments']
    audio_dir = OUT / 'audio' / a.voice; clips = OUT / 'clips' / a.voice
    audio_dir.mkdir(parents=True, exist_ok=True); clips.mkdir(parents=True, exist_ok=True)

    parts, srt, t, report = [], [], 0.0, []
    for seg in segs:
        wav = tts(seg, a.voice, a.el_voice, audio_dir, a.tempo)
        d = duration(wav)
        lead, tail = 0.15, 0.3
        vid, final = clips / f"{seg['id']}_v.mp4", clips / f"{seg['id']}.mp4"
        kind, _, name = seg['visual'].partition(':')
        if kind == 'demo':
            length, factor = demo_clip(seg['start'], seg['end'], d + lead + 0.2, vid)
            note = f"demo {seg['start']}-{seg['end']}s" + (f" slowed ×{factor:.2f}" if factor > 1.001 else f" sped up ×{1/factor:.2f}" if factor < 0.999 else '')
        else:
            length = d + lead + tail + (0.25 if seg['id'] in ('A1', 'C1', 'D6') else 0)
            image = SLIDES / f'{name}.png' if kind == 'slide' else ARCH
            crop = (0, 0, W, H) if kind == 'slide' else ARCH_CROPS[name]
            still_clip(image, crop, length, vid, zmax=1.0 if name == 'full' else 1.06)
            note = seg['visual']
        mux(vid, wav, length, final, lead)
        parts.append(final)
        srt.append(f"{len(srt)+1}\n{srt_time(t+lead)} --> {srt_time(t+lead+d)}\n{seg['text']}\n")
        report.append(f"{srt_time(t)[:-4]}  {seg['id']:<4} {seg['part']:<14} {length:5.1f}s  voice {d:4.1f}s  {note}")
        t += length

    lst = OUT / f'concat_{a.voice}.txt'
    lst.write_text(''.join(f"file '{p}'\n" for p in parts))
    final = OUT / ('Ark_Outreach_Coach_Loom.mp4' if a.voice == 'elevenlabs' else 'Ark_Outreach_Coach_Loom_PREVIEW.mp4')
    run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', str(lst), '-c:v', 'libx264', '-crf', '20',
         '-preset', 'medium', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', str(final)])
    final.with_suffix('.srt').write_text('\n'.join(srt))
    md, cur, tt = ['# Loom transcript (timestamps match the built video)\n'], None, 0.0
    for seg, line in zip(segs, report):
        if seg['part'] != cur:
            cur = seg['part']; md.append(f"\n## {cur}\n")
        md.append(f"**[{line[:8]}]** {seg['text']}\n")
    (ROOT.parent / 'LOOM_TRANSCRIPT.md').write_text('\n'.join(md))
    print('\n'.join(report))
    print(f'\nTotal {int(t//60)} min {t%60:.0f} s  →  {final}')


if __name__ == '__main__':
    main()
