# /// script
# dependencies = ["numpy>=2", "scipy>=1.14"]
# ///
"""Render the original score and foley. Run with uv run scripts/render-soundtrack.py (requires FFmpeg)."""
import json
import subprocess
from pathlib import Path

import numpy as np
from scipy.signal import butter, sosfilt

ROOT = Path(__file__).resolve().parents[1]
MEDIA = ROOT / "public/media"
OUT = MEDIA / "music"
RATE = 32000
TAU = 2 * np.pi
rng = np.random.default_rng(26)


def filtered(x, cutoff, kind):
    return sosfilt(butter(2, cutoff, fs=RATE, btype=kind, output="sos"), x)


def instrument(name, note, length):
    freq = 440 * 2 ** ((note - 69) / 12)
    t = np.arange(round(length * RATE)) / RATE
    phase = TAU * freq * t
    noise = rng.standard_normal(len(t))
    attack, release = .003, .045
    if name == "keys":  # struck electric-piano tine and a slowly beating pickup
        mod = (1.45 * np.exp(-t * 8) + .09) * np.sin(phase * 2.002)
        x = (.8 * np.sin(phase + mod) + .2 * np.sin(phase * 1.003 + mod)) * np.exp(-t * 1.9)
    elif name == "bass":
        x = np.sin(phase + (.9 * np.exp(-t * 9) + .24) * np.sin(phase))
        x = (.8 * x + .22 * np.sin(2 * phase) + .12 * np.sin(3 * phase)) * np.exp(-t * 1.9)
        x += filtered(noise, 1200, 'lowpass') * .12 * np.exp(-t * 65)
    elif name == "wire":  # picked double course; pick position sets harmonic nulls
        x = np.zeros_like(t)
        for h in range(1, 15):
            amp = np.sin(h * np.pi * .21) / h * np.exp(-t * (2.7 + h * .85))
            x += amp * (np.sin(h * phase) + .48 * np.sin(h * phase * 1.0033 + h * .22))
        x += .10 * filtered(noise, 3000, 'lowpass') * np.exp(-70 * t)
    elif name in ("brass", "reed", "strings"):
        attack = {"brass": .045, "reed": .065, "strings": .23}[name]
        bend = .26 * (1 - np.exp(-t * 22)) if name == "brass" else .04
        vib = .09 * np.sin(TAU * 5.1 * t) * np.minimum(1, t * 3)
        x = np.zeros_like(t)
        for h in range(1, 12):
            # Odd harmonics of the reed, dark string ensemble, or a bright opening horn attack.
            amp = (1 if name != "reed" or h % 2 else .22) / h ** (1.05 if name == "brass" else 1.35)
            amp *= np.exp(-t * h * (.32 if name == "brass" else .035))
            x += amp * (.63 * np.sin(h * (phase + vib - bend)) + .37 * np.sin(h * (phase * 1.0038 - vib)))
        release = .10 if name != "strings" else .22
    elif name == "kick":
        x = np.sin(TAU * (46 * t + 2.75 * (1 - np.exp(-t * 32)))) * np.exp(-t * 10)
        x += .22 * filtered(noise, 2300, "lowpass") * np.exp(-120 * t)
    elif name in ("snare", "rim"):
        x = .42 * np.sin(TAU * (164 * t + .47 * (1 - np.exp(-t * 45)))) * np.exp(-24 * t)
        x += .14 * np.sin(TAU * 337 * t) * np.exp(-35 * t)
        snap = filtered(noise, [1150, 7700], "bandpass")
        x += snap * (.55 * np.exp(-19 * t) if name == "snare" else .38 * np.exp(-72 * t))
        if name == "snare":
            x += .23 * snap * np.exp(-38 * np.maximum(0, t - .017)) * (t >= .017)
    elif name in ("hat", "open"):
        metal = sum(np.sin(TAU * hz * t) for hz in [4313, 5483, 7199, 9241]) / 5
        x = (filtered(noise, 7400, "highpass") * .64 + metal) * np.exp(-t * (52 if name == "hat" else 12))
    elif name in ("dhol", "slap"):
        f = freq
        x = (.72 * np.sin(TAU * (f * t + .55 * (1 - np.exp(-35 * t)))) * np.exp(-t * 12)
             + .38 * np.sin(TAU * f * 1.53 * t) * np.exp(-t * 23)
             + .22 * np.sin(TAU * f * 2.36 * t) * np.exp(-t * 33))
        x += .35 * filtered(noise, [450, 3600], "bandpass") * np.exp(-t * 65)
    elif name == "wash":
        x = filtered(noise, [700, 4900], "bandpass") * (t / length) ** 2
        release = .02
    else:
        raise ValueError(name)
    return x * np.minimum(1, t / attack) * np.minimum(1, (length - t) / release)


# One arrangement per broadcast. Notes are MIDI, offsets and lengths are in quarter-note beats.
# Every B-side has a different tonic, harmony, hook, rhythm pickups and tempo.
TRACKS = {
    "launch-theme": ("title", 240 / 2.90, 4, 38, "MH 26"),
    "backstreets": ("street", 78, 20, 38, "After the Last Auto"),
    "checkpost": ("chase", 112, 24, 38, "Checkpost"),
    "forecourt": ("funk", 94, 24, 40, "Forecourt Funk"),
    "ring-road": ("funk", 100, 24, 43, "Ring Road Relay"),
    "goods-yard": ("lavani", 112, 24, 38, "Goods Yard Express"),
    "last-local": ("lavani", 106, 24, 41, "Last Local"),
    "blue-shutter": ("lofi", 80, 20, 41, "Blue Shutter"),
    "chai-at-four": ("lofi", 75, 20, 36, "Chai at Four"),
}
HOOKS = {
    "title": [(0, 7, .52), (.75, 10, .24), (1.5, 5, .63), (3.25, 3, .55)],
    "street": [(.5, 7, .75), (2.75, 2, .7)],
    "chase": [(0, 0, .3), (.75, 1, .25), (1.5, 7, .35), (2.5, 6, .38), (3.25, 3, .32)],
    "funk": [(.5, 7, .42), (1.25, 10, .22), (1.75, 12, .68), (3.25, 5, .4)],
    "lavani": [(0, 7, .55), (.75, 8, .21), (1, 7, .45), (2, 3, .31), (2.5, 5, .68)],
    "lofi": [(.75, 10, .65), (2, 5, .52), (3.5, 2, .35)],
}
B_HOOK = {
    "funk": [(0, 12, .42), (1, 7, .28), (1.75, 3, .4), (2.75, 5, .35), (3.5, 10, .25)],
    "lavani": [(.5, 3, .45), (1, 5, .22), (1.5, 8, .6), (2.75, 7, .38), (3.5, 2, .27)],
    "lofi": [(0, 7, 1), (1.75, 2, .65), (3, 3, .72)],
}


def encode(path, samples, args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "f32le",
                    "-ar", str(RATE), "-ac", str(samples.shape[1]), "-i", "pipe:0", *args, str(path)],
                   input=samples.astype("<f4").tobytes(), check=True)


def render(key, style, bpm, bars, tonic, title):
    global rng
    rng = np.random.default_rng(100 + list(TRACKS).index(key))
    beat = 60 / bpm
    frames = round(bars * 4 * beat * RATE)
    mix = np.zeros((frames, 2), dtype=np.float32)
    room = mix.copy()
    side_b = key in ("ring-road", "last-local", "chai-at-four")

    def add(when, name, note, seconds, level, pan=0, send=.1):
        wave = instrument(name, note, seconds) * level
        at = max(0, round(when * RATE))
        n = min(len(wave), frames - at)
        if n <= 0:
            return
        signal = wave[:n, None] * np.sqrt([(1 - pan) / 2, (1 + pan) / 2])
        mix[at:at+n] += signal
        room[at:at+n] += signal * send

    for bar in range(bars):
        start = bar * 4 * beat
        quiet = style == "street"
        section = (bar // 4) % 4
        breakdown = section == 2 and bar % 4 < 2 and style != "title"
        progression = ([0, -2, 3, -5] if side_b else [0, 0, -4, -2])
        if style == "chase":
            progression = [0, 0, 1, -2]
        if style == "lofi":
            progression = [0, 5, -2, 3] if side_b else [0, -5, -2, -4]
        root = tonic + progression[bar % 4]
        chord = [0, 3, 7, 10] if bar % 4 < 2 else [0, 4, 7, 11]
        hook = B_HOOK[style] if side_b else HOOKS[style]
        end_title = style == "title" and bar == 3

        def hit(offset, name, note, seconds, gain, pan=0, send=.14):
            add(start + offset * beat, name, note, seconds, gain, pan, send)

        if end_title:
            # The final brand resolves at 9.7 seconds. Leave clean space for the street handoff at 11.6.
            for off in [0, .5, 1.45]:
                hit(off, "dhol", 42, .4, .46)
            for i, n in enumerate([0, 7, 12, 15]):
                hit(1.45 + i * .018, "brass", tonic + 12 + n, 1.03, .16, -.38 + i * .24, .45)
            hit(1.45, "bass", tonic, 1.38, .58)
            hit(1.45, "kick", 0, .44, .69)
            continue

        if not breakdown and not quiet:
            kicks = [0, 1.5, 2.75] if style != "chase" else [0, .75, 2, 2.75]
            if side_b: kicks = [0, 1.75, 2.5]
            for off in kicks: hit(off, "kick", 0, .43, .78 if off == 0 else .59, send=.035)
            for off in [1, 3]:
                hit(off + .022, "rim" if style == "lofi" else "snare", 0, .32, .61, .08, .36)
            for j in range(8):
                off = j / 2 + (.065 if j % 2 and style in ("funk", "lofi") else 0)
                hit(off, "open" if j == 7 and bar % 2 else "hat", 0, .26, (.15 if j % 2 else .23) * rng.uniform(.8, 1.15), -.34)
        if style in ("lavani", "title", "chase", "funk") and not breakdown:
            for j, off in enumerate([0, .75, 1.5, 2.5, 3.25] if style == "lavani" else [.75, 2.5, 3.75]):
                hit(off, "slap" if j % 2 else "dhol", 53 if j % 2 else 42, .28, .38 if style == "lavani" else .21, .28)
        if bar % 4 == 3 and not quiet:
            for i in range(3): hit(3.5 + i / 6, "slap", 53+i*2, .15, .11 + i*.055, -.2 + i*.2)
        if quiet:
            if bar % 2 == 0: hit(0, "dhol", 39, .48, .20, .05, .32)
            if section == 1: hit(2.5, "rim", 0, .18, .12, .25)
        bassline = [(0, 0, 1.15), (1.5, 0, .39), (2.25, 7, .49), (3.48, 10 if bar % 2 else -2, .40)]
        if side_b: bassline = [(0, 0, .8), (1.25, 7, .45), (2, 0, .8), (3.25, 3, .52)]
        if quiet or breakdown: bassline = [(0, 0, 2.5)]
        for off, n, length in bassline: hit(off, "bass", root+n, length*beat, .49 if not quiet else .28, send=.045)

        for i, n in enumerate(chord):
            if style in ("street", "chase", "title") or breakdown:
                hit(i*.021, "strings", root+24+n, beat*(3.6 if quiet else 2.7), .057 if style != "title" else .085, -.65+i*.41, .44)
            for off in ([.5, 2.75] if style in ("funk", "lavani") else [0, 2.5]):
                hit(off+i*.012, "keys", root+24+n, beat*(.65 if style == "funk" else 1.45), .12, -.45+i*.22, .37)
        if style == "funk" and section != 2:
            for off in [.75, 1.75, 2.5, 3.75]:
                for n in [7, 15]: hit(off, "wire", root+24+n, .14, .105, -.55, .16)
        if (not quiet or bar % 4 in (0, 3)) and not breakdown:
            voice = {"title":"brass", "chase":"wire", "funk":"brass", "lavani":"reed", "lofi":"wire", "street":"wire"}[style]
            for off, n, length in hook:
                if bar % 2 and off > 2: n -= 3 if style != "chase" else 2
                if section == 3 and bar % 2: n += 5
                hit(off, voice, root+24+n, length*beat, .23 if not quiet else .15, .21, .43)
                if style in ("lavani", "title") or section == 1:
                    hit(off+.018, "wire", root+36+n, length*beat*.83, .08, -.45, .29)
        if style == "title" or (bar % 8 == 7 and not quiet):
            hit(3.34, "wash", 0, .65*beat, .12, -.18, .32)

    # Asymmetric early reflections followed by a diffuse stereo tail. Wrap the tail on looped cues.
    for delay, gain, swap in [(.031,.32,False),(.047,.29,True),(.091,.20,True),(.157,.15,False),
                              (.231,.12,True),(.349,.085,False),(.443,.06,True)]:
        offset = round(RATE * delay)
        reflected = room[:, ::-1] if swap else room
        mix[offset:] += reflected[:-offset] * gain
        if style != "title": mix[:offset] += reflected[-offset:] * gain
    mix = np.tanh(mix * 1.43)
    if style == "title":
        mix[-RATE:] *= np.linspace(1,0,RATE)[:,None]
        mix = np.pad(mix, ((0, 12*RATE - len(mix)), (0,0)))
    else:
        mix[:80] *= np.linspace(0,1,80)[:,None]
        mix[-180:] *= np.linspace(1,0,180)[:,None]
    path = MEDIA / "launch-theme.m4a" if style == "title" else OUT / (key + ".m4a")
    encode(path, mix, ["-af","loudnorm=I=-16:TP=-1.8:LRA=8","-ar","44100","-c:a","aac","-b:a","112k",
                       "-movflags","+faststart","-metadata","title="+title])
    print(f"{title}: {len(mix)/RATE:.1f}s", flush=True)


def foley():
    """A small one-shot bank. Cues use the same timbres as the opening; actions use noise and resonant bodies."""
    global rng
    rng = np.random.default_rng(737)
    clips = {}
    for name, root, notes in [
        ("mission", 38, [(0,0),(.19,7),(.44,3)]), ("passed", 43, [(0,0),(.18,7),(.34,10),(.59,14)]),
        ("failed", 38, [(0,7),(.32,3),(.68,0)]), ("wanted", 38, [(0,7),(.19,6)]),
        ("busted", 38, [(0,10),(.23,7),(.54,1)]), ("wasted", 33, [(0,7),(.55,3),(1.08,0)]),
        ("checkpoint", 50, [(0,3),(.105,7)]), ("pickup", 50, [(0,7),(.09,10)]),
    ]:
        clip = np.zeros(round(RATE * (notes[-1][0] + .84)))
        for at, n in notes:
            i = round(RATE * at)
            part = instrument("keys", root+24+n, .78) * .48 + instrument("wire", root+12+n, .78) * .28
            clip[i:i+len(part)] += part
        if name not in ("checkpoint", "pickup"):
            bass = instrument("bass", root, .72)
            clip[:len(bass)] += .55*bass
        clips[name] = clip
    for name in ["shoe", "wetStep", "door", "mount", "jump", "buy", "reload", "empty", "bolt", "throw", "crash", "splash"]:
        dur = .76 if name in ("crash","reload","splash") else .34
        t = np.arange(round(dur*RATE)) / RATE
        clip = np.zeros_like(t)
        noise = rng.standard_normal(len(t))
        def tap(at, freq, decay, amount, metal=0):
            age = np.maximum(t-at,0)
            env = np.minimum(age*1100,1)*np.exp(-age*decay)
            return env * (amount*filtered(noise, freq, "bandpass") + metal*np.sin(TAU*freq[0]*age))
        if name in ("shoe","wetStep","jump","throw","mount"):
            clip += tap(.004,[85,370],26,1.8,.20) + tap(.042,[580,2400],32,.56)
            if name == "wetStep": clip += tap(.067,[1400,5600],19,.76)
            if name in ("jump","throw","mount"): clip = tap(.01,[420,2400],17,.5) + tap(.11,[160,880],28,.65)
        elif name == "door":
            clip += tap(0,[78,280],23,2.3,.55) + tap(.009,[370,1200],29,1.2) + tap(.046,[1600,4100],68,.7)
        elif name == "splash":
            clip += tap(.005,[180,2900],7,1.2) + tap(.12,[900,5300],9,.9) + tap(.25,[1300,3600],11,.45)
        elif name == "crash":
            clip += tap(.002,[65,450],14,2.2,.5)+tap(.013,[420,2400],12,1.4)+tap(.06,[1800,6500],7,.8)
            for at in [.14,.19,.32,.46]: clip += tap(at,[960,3500],42,.6,.12)
        else:
            clicks = {"buy":[.01,.065,.15],"reload":[0,.28,.49,.56],"empty":[0],"bolt":[0,.12,.17]}[name]
            for i, at in enumerate(clicks):
                freq = 1450 if name=="buy" else 470+i*130
                clip += tap(at,[freq,4300],48,.97,.20) + tap(at+.013,[250,1500],60,.65)
        clips[name] = clip
    data, index, offset = [], {}, 0
    for name, clip in clips.items():
        clip[-120:] *= np.linspace(1,0,120)
        clip = .8*clip / max(.1,np.max(np.abs(clip)))
        index[name] = [offset/RATE, len(clip)/RATE]
        data.extend((clip, np.zeros(320)))
        offset += len(clip)+320
    encode(OUT / "foley.flac", np.concatenate(data)[:,None], ["-sample_fmt","s16","-c:a","flac"])
    (ROOT / "src/audio/foley.json").write_text(json.dumps(index, indent=2)+"\n")


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    for key, settings in TRACKS.items():
        render(key, *settings)
    foley()
