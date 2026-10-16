#!/usr/bin/env python3
"""Extract the game's original synthesized instrumental for the 12-second panel opening.

The source soundtrack was composed and synthesized by render-opening.py. This
uses no commercial recordings. The 12-second cue fades out by the 11.6-second gameplay handoff.
"""
import argparse
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=ROOT / 'public/media/nanded-opening.mp4')
    parser.add_argument('--output', type=Path, default=ROOT / 'public/media/launch-theme.m4a')
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(['ffmpeg', '-hide_banner', '-v', 'error', '-y', '-i', str(args.input),
        '-vn', '-t', '12', '-af', 'afade=t=out:st=10.4:d=1.2', '-c:a', 'aac', '-b:a', '128k',
        '-ar', '48000', '-movflags', '+faststart', '-metadata',
        'title=GTA Nanded original launch theme', str(args.output)], check=True)
    probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams',
        '-show_format', '-of', 'json', str(args.output)], text=True))
    assert len(probe['streams']) == 1
    assert probe['streams'][0]['codec_name'] == 'aac'
    assert probe['streams'][0]['sample_rate'] == '48000'
    assert abs(float(probe['format']['duration']) - 12) < .05
    subprocess.run(['ffmpeg', '-hide_banner', '-v', 'error', '-xerror', '-i', str(args.output),
        '-f', 'null', '-'], check=True)
    print(f'{args.output.name}: 12 seconds, AAC 48 kHz, {args.output.stat().st_size} bytes, full decode passed')

if __name__ == '__main__':
    main()
