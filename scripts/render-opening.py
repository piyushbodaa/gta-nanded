#!/usr/bin/env python3
"""Render the original GTA NANDED opening from two supplied illustrations.

Requires Python 3, ImageMagick 7, ffmpeg with HarfBuzz, ffprobe and Noto Sans
Devanagari Bold. No Python packages,
downloaded music, stock footage or network access are used by this renderer.

Usage:
    python scripts/render-opening.py --key-art /path/key-art.png \
        --lanes /path/taroda-lanes.png

The illustrations remain untouched. Video, responsive WebP artwork and a
machine-readable provenance/validation report are written to public/media.
"""

from __future__ import annotations

import argparse
import array
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import random
import shutil
import struct
import subprocess
import sys
import tempfile
import wave
import zlib


ROOT = Path(__file__).resolve().parents[1]
WIDTH, HEIGHT, FPS, DURATION, AUDIO_RATE = 1280, 720, 30, 18, 48000
SCENE_SECONDS = 9.75
CROSSFADE = 1.5
FONT_CANDIDATES = (
    "/usr/share/fonts/gsfonts/NimbusSansNarrow-Bold.otf",
    "/usr/share/fonts/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf",
)
BODY_CANDIDATES = (
    "/usr/share/fonts/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
)
DEVANAGARI_CANDIDATES = (
    "/usr/share/fonts/noto/NotoSansDevanagari-Bold.ttf",
    "/usr/share/fonts/truetype/noto/NotoSansDevanagari-Bold.ttf",
)


def run(command: list[str], *, capture: bool = False) -> str:
    result = subprocess.run(command, check=True, text=True,
                            stdout=subprocess.PIPE if capture else None,
                            stderr=subprocess.PIPE if capture else None)
    return result.stdout if capture else ""


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def font_path(candidates: tuple[str, ...]) -> str:
    for candidate in candidates:
        if Path(candidate).is_file():
            return candidate
    raise SystemExit(f"A title font is missing; install one of: {', '.join(candidates)}")


def gradient_png(path: Path) -> None:
    """A soft black lower-third gradient; original pixels, not a stock asset."""
    rows = []
    for y in range(HEIGHT):
        progress = max(0.0, (y - 180) / (HEIGHT - 180))
        alpha = round(190 * progress ** 1.4)
        rows.append(b"\0" + bytes((0, 0, 0, alpha)) * WIDTH)

    def chunk(kind: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + kind + data
                + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))

    path.write_bytes(b"\x89PNG\r\n\x1a\n"
                     + chunk(b"IHDR", struct.pack(">2I5B", WIDTH, HEIGHT, 8, 6, 0, 0, 0))
                     + chunk(b"IDAT", zlib.compress(b"".join(rows), 9))
                     + chunk(b"IEND", b""))


def synthesize_theme(path: Path) -> None:
    """Compose a deterministic original 96 BPM instrumental at 48 kHz.

    D-minor / B-flat / F / C pads and bass underpin a newly authored plucked
    motif, hand-drum-like hits, filtered noise hats and a restrained kick.
    Every sample is synthesized here; no recording, sample pack or copied tune.
    """
    length = DURATION * AUDIO_RATE
    left = array.array("f", [0.0]) * length
    right = array.array("f", [0.0]) * length
    rng = random.Random(20261016)
    beat = 60 / 96
    tau = 2 * math.pi

    def add(start: float, duration: float, voice, gain: float, pan: float = 0) -> None:
        first = round(start * AUDIO_RATE)
        count = min(round(duration * AUDIO_RATE), length - first)
        if first < 0 or count <= 0:
            return
        l_gain = gain * math.sqrt((1 - pan) / 2)
        r_gain = gain * math.sqrt((1 + pan) / 2)
        for j in range(count):
            t = j / AUDIO_RATE
            value = voice(t, duration)
            left[first + j] += value * l_gain
            right[first + j] += value * r_gain

    def hz(midi: int) -> float:
        return 440 * 2 ** ((midi - 69) / 12)

    def pad(frequency: float):
        def voice(t: float, duration: float) -> float:
            envelope = min(1, t / .3) * min(1, (duration - t) / .65)
            return envelope * (math.sin(tau * frequency * t)
                               + .22 * math.sin(tau * frequency * 2 * t)
                               + .12 * math.sin(tau * frequency * 1.003 * t)) / 1.34
        return voice

    def bass(frequency: float):
        return lambda t, d: (1 - math.exp(-t * 110)) * math.exp(-t * 3.4) * (
            math.sin(tau * frequency * t) + .17 * math.sin(tau * frequency * 2 * t))

    def pluck(frequency: float):
        return lambda t, d: (1 - math.exp(-t * 200)) * math.exp(-t * 4.5) * (
            math.sin(tau * frequency * t) + .3 * math.sin(tau * frequency * 2 * t)
            + .08 * math.sin(tau * frequency * 3 * t))

    def kick(t: float, duration: float) -> float:
        phase = tau * (48 * t + 72 / 35 * (1 - math.exp(-35 * t)))
        return math.sin(phase) * math.exp(-t * 11) * min(1, t / .002)

    def drum(t: float, duration: float) -> float:
        return ((math.sin(tau * (165 * t + .7 * (1 - math.exp(-t * 40))))
                 + .24 * math.sin(tau * 320 * t)) * math.exp(-t * 20)
                + rng.uniform(-1, 1) * math.exp(-t * 70) * .2)

    def hat(t: float, duration: float) -> float:
        return rng.uniform(-1, 1) * math.exp(-t * 75) * (.7 + .3 * math.sin(tau * 7100 * t))

    chords = ((50, 53, 57), (46, 50, 53), (48, 53, 57), (48, 52, 55))
    roots = (38, 34, 41, 36)
    motifs = ((74, 69, 77, 72), (70, 74, 77, 69),
              (72, 77, 69, 74), (76, 72, 67, 69))
    for bar in range(8):
        start = bar * beat * 4
        chord = chords[bar % 4]
        for index, note in enumerate(chord):
            add(start, beat * 4 + .3, pad(hz(note)), .075, (index - 1) * .35)
        for offset in (0, 1.5, 2, 3.5):
            add(start + offset * beat, .55, bass(hz(roots[bar % 4])), .24)
        for offset in (0, 2):
            add(start + offset * beat, .42, kick, .34)
        for offset in (1, 3, 3.75):
            add(start + offset * beat, .25, drum, .16 if offset < 3.5 else .09, .18)
        for eighth in range(8):
            add(start + eighth * beat / 2, .1, hat, .05 if eighth % 2 else .032, -.28)
        for index, note in enumerate(motifs[bar % 4]):
            at = start + (index + .5) * beat
            add(at, 1.0, pluck(hz(note)), .14, -.15 if index % 2 else .15)
            add(at + beat * .75, .8, pluck(hz(note)), .035, .4)

    # Soft saturation, a quiet opening, and a musical release before the cut.
    samples = array.array("h")
    for index in range(length):
        seconds = index / AUDIO_RATE
        fade = min(1, seconds / .8) * min(1, max(0, (DURATION - seconds) / 1.4))
        samples.append(round(math.tanh(left[index] * 1.2) * fade * 28000))
        samples.append(round(math.tanh(right[index] * 1.2) * fade * 28000))
    if sys.byteorder != "little":
        samples.byteswap()
    with wave.open(str(path), "wb") as output:
        output.setparams((2, 2, AUDIO_RATE, length, "NONE", "not compressed"))
        output.writeframes(samples.tobytes())


def fade_alpha(start: float, end: float, fade: float = .55) -> str:
    return (f"if(lt(t,{start}),0,if(lt(t,{start + fade}),(t-{start})/{fade},"
            f"if(lt(t,{end - fade}),1,if(lt(t,{end}),({end}-t)/{fade},0))))")


def render(key_art: Path, lanes: Path, output_dir: Path, *, skip_artwork: bool = False) -> dict:
    output_dir.mkdir(parents=True, exist_ok=True)
    video = output_dir / "nanded-opening.mp4"
    headline_font = font_path(FONT_CANDIDATES)
    body_font = font_path(BODY_CANDIDATES)
    devanagari_font = font_path(DEVANAGARI_CANDIDATES)
    inputs = ((key_art, "nanded-key-art.webp"), (lanes, "nanded-lanes.webp"))
    for source, target in inputs:
        if skip_artwork:
            if not (output_dir / target).is_file():
                raise SystemExit(f"--skip-artwork requires the existing asset: {target}")
        else:
            run(["magick", str(source), "-auto-orient", "-strip", "-resize", "1920x1920>",
                 "-define", "webp:method=6", "-quality", "83", str(output_dir / target)])

    with tempfile.TemporaryDirectory(prefix="nanded-opening-") as temporary:
        work = Path(temporary)
        for index, (source, _) in enumerate(inputs):
            # A large intermediate avoids integer-pixel pan jitter at 720p.
            run(["magick", str(source), "-auto-orient", "-resize", "2560x1440^",
                 "-gravity", "center", "-extent", "2560x1440", str(work / f"scene{index}.png")])
        gradient_png(work / "shade.png")
        synthesize_theme(work / "theme.wav")

        captions = [
            ("GTA", headline_font, 142, 80, 404, "0xfff6df", 1.0, 7.8),
            ("NANDED", headline_font, 62, 85, 551, "0xf5bb5b", 2.1, 7.8),
            ("उगं नव्हं मय,", devanagari_font, 62, 82, 397, "0xfff6df", 9.8, 15.9),
            ("नांदेड हाय नांदेड!", devanagari_font, 72, 80, 475, "0xfff6df", 10.6, 15.9),
            ("Zenda Chowk / Taroda Khurd", body_font, 31, 85, 592, "0xf5bb5b", 12.8, 17.6),
        ]
        text_filters = []
        for index, (caption, font, size, x, y, color, start, end) in enumerate(captions):
            textfile = work / f"title{index}.txt"
            textfile.write_text(caption, encoding="utf-8")
            text_filters.append(
                f"drawtext=fontfile='{font}':textfile='{textfile}':fontsize={size}:text_shaping=1:"
                f"fontcolor={color}:x={x}:y={y}:shadowcolor=black@0.45:"
                f"shadowx=1:shadowy=3:alpha='{fade_alpha(start, end)}'"
            )
        # Two gentle, differently directed moves. 293 frames each allow the
        # 1.5-second transition at 8.25 seconds; final trim is exactly 540 frames.
        frames = math.ceil(SCENE_SECONDS * FPS)
        graph = (
            f"[0:v]zoompan=z='1.025+0.055*on/{frames}':"
            f"x='iw/2-iw/zoom/2-20+40*on/{frames}':y='ih/2-ih/zoom/2':"
            f"d={frames}:s={WIDTH}x{HEIGHT}:fps={FPS},setsar=1,format=yuv420p[v0];"
            f"[1:v]zoompan=z='1.085-0.045*on/{frames}':"
            f"x='iw/2-iw/zoom/2+15-30*on/{frames}':y='ih/2-ih/zoom/2':"
            f"d={frames}:s={WIDTH}x{HEIGHT}:fps={FPS},setsar=1,format=yuv420p[v1];"
            f"[v0][v1]xfade=transition=fade:duration={CROSSFADE}:offset=8.25,"
            "eq=brightness=-0.015:saturation=1.02[scenes];"
            "[scenes][2:v]overlay=shortest=1,"
            "drawbox=x=0:y=0:w=iw:h=26:color=0x0b0e10@0.95:t=fill,"
            "drawbox=x=0:y=694:w=iw:h=26:color=0x0b0e10@0.95:t=fill,"
            + ",".join(text_filters)
            + ",fade=t=in:st=0:d=0.65,fade=t=out:st=17.3:d=0.7,format=yuv420p[video];"
            "[3:a]loudnorm=I=-18:TP=-2:LRA=7,aresample=48000[audio]"
        )
        run(["ffmpeg", "-hide_banner", "-loglevel", "warning", "-y",
             "-filter_complex_threads", "2",
             "-i", str(work / "scene0.png"), "-i", str(work / "scene1.png"),
             "-loop", "1", "-framerate", str(FPS), "-i", str(work / "shade.png"),
             "-i", str(work / "theme.wav"), "-filter_complex", graph,
             "-map", "[video]", "-map", "[audio]", "-t", str(DURATION),
             "-r", str(FPS), "-c:v", "libx264", "-preset", "medium", "-crf", "21",
             "-maxrate", "1800k", "-bufsize", "3600k", "-pix_fmt", "yuv420p",
             "-profile:v", "high", "-level:v", "3.1", "-g", "60",
             "-c:a", "aac", "-b:a", "112k", "-ar", str(AUDIO_RATE), "-ac", "2",
             "-movflags", "+faststart", "-metadata", "title=GTA NANDED",
             "-metadata", "comment=Original illustrated opening and synthesized instrumental",
             str(video)])

    probe = json.loads(run(["ffprobe", "-v", "error", "-show_streams", "-show_format",
                           "-of", "json", str(video)], capture=True))
    video_stream = next(s for s in probe["streams"] if s["codec_type"] == "video")
    audio_stream = next(s for s in probe["streams"] if s["codec_type"] == "audio")
    assert video_stream["codec_name"] == "h264"
    assert (video_stream["width"], video_stream["height"]) == (WIDTH, HEIGHT)
    assert video_stream["pix_fmt"] == "yuv420p"
    assert int(video_stream["nb_frames"]) == FPS * DURATION
    assert audio_stream["codec_name"] == "aac" and audio_stream["sample_rate"] == "48000"
    assert abs(float(probe["format"]["duration"]) - DURATION) < .05
    assert video.stat().st_size < 6_000_000, "Video exceeds the 6 MB delivery budget."
    # Check every video frame and every audio packet, not just the first frame.
    run(["ffmpeg", "-hide_banner", "-v", "error", "-xerror", "-i", str(video),
         "-f", "null", "-"])
    data = video.read_bytes()
    atom_names, position = [], 0
    while position < len(data):
        size, name = struct.unpack(">I4s", data[position:position + 8])
        assert size >= 8, "Unexpected MP4 atom size."
        atom_names.append(name)
        position += size
    assert atom_names.index(b"moov") < atom_names.index(b"mdat"), "MP4 is not faststart."
    loudness_result = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", str(video), "-vn", "-af",
         "loudnorm=I=-18:TP=-2:LRA=7:print_format=json", "-f", "null", "-"],
        check=True, capture_output=True, text=True)
    diagnostic = loudness_result.stderr
    loudness = json.loads(diagnostic[diagnostic.rfind("{"):diagnostic.rfind("}") + 1])
    assert -20 <= float(loudness["input_i"]) <= -16, "Unexpected music loudness."
    assert float(loudness["input_tp"]) <= -1, "Music peak exceeds delivery headroom."

    report = {
        "title": "GTA NANDED — original illustrated opening",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "durationSeconds": DURATION, "width": WIDTH, "height": HEIGHT, "fps": FPS,
        "videoCodec": "H.264", "pixelFormat": "yuv420p", "faststart": True,
        "audioCodec": "AAC", "audioSampleRate": AUDIO_RATE,
        "artworkProvenance": "Two original image-generation artworks supplied for this game; illustrated scenes, not photographs or exact architectural surveys.",
        "musicProvenance": "Original 96 BPM instrumental composed and synthesized in scripts/render-opening.py; no external recordings or audio samples.",
        "motion": "Two original illustrations with slow pan/zoom and a 1.5-second crossfade; not live gameplay footage.",
        "titles": [caption[0] for caption in captions],
        "marathiTypography": {
            "font": "Noto Sans Devanagari Bold",
            "shaping": "FFmpeg drawtext with HarfBuzz and text_shaping=1",
            "cardLines": ["उगं नव्हं मय,", "नांदेड हाय नांदेड!"],
        },
        "sources": [{"file": source.name, "sha256": sha256(source)} for source, _ in inputs],
        "outputs": [{"file": name, "bytes": (output_dir / name).stat().st_size,
                     "sha256": sha256(output_dir / name)}
                    for name in ("nanded-opening.mp4", "nanded-key-art.webp", "nanded-lanes.webp")],
        "validation": {"fullDecode": "passed", "frameCount": int(video_stream["nb_frames"]),
                       "durationSeconds": float(probe["format"]["duration"]),
                       "sizeUnder6MB": True, "faststartAtomOrder": "verified",
                       "audioIntegratedLufs": float(loudness["input_i"]),
                       "audioTruePeakDbtp": float(loudness["input_tp"])},
        "rebuild": "python scripts/render-opening.py --key-art /path/key-art.png --lanes /path/taroda-lanes.png",
    }
    (output_dir / "nanded-opening-provenance.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--key-art", type=Path, required=True, help="Original riverfront/auto artwork")
    parser.add_argument("--lanes", type=Path, required=True, help="Original Taroda starting-lanes artwork")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "public" / "media")
    parser.add_argument("--skip-artwork", action="store_true",
                        help="Reuse existing WebPs when only the cinematic is changing")
    args = parser.parse_args()
    for executable in ("ffmpeg", "ffprobe", "magick"):
        if not shutil.which(executable):
            parser.error(f"Required command is missing: {executable}")
    for source in (args.key_art, args.lanes):
        if not source.is_file():
            parser.error(f"Input illustration does not exist: {source}")
    build = subprocess.run(["ffmpeg", "-hide_banner", "-buildconf"], check=True, text=True,
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT).stdout
    if "--enable-libharfbuzz" not in build:
        parser.error("The Marathi title requires an ffmpeg build with HarfBuzz enabled.")
    report = render(args.key_art.resolve(), args.lanes.resolve(), args.output_dir.resolve(),
                    skip_artwork=args.skip_artwork)
    print(json.dumps({"outputs": report["outputs"], "validation": report["validation"]}, indent=2))


if __name__ == "__main__":
    main()
