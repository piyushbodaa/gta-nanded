// Procedural radio: three stations whose songs are composed on the fly from
// seeded motifs on Indian scales. Nothing is sampled; everything is synthesised.
import { rng } from '../core/math.js';

const SCALES = { bhairavi: [0, 1, 3, 5, 7, 8, 10], kafi: [0, 2, 3, 5, 7, 9, 10], yaman: [0, 2, 4, 6, 7, 9, 11], pent: [0, 3, 5, 7, 10], khamaj: [0, 2, 4, 5, 7, 9, 10] };
const midi = m => 440 * Math.pow(2, (m - 69) / 12);

export const STATIONS = [
  { id: 'godavari', name: 'Radio Godavari 92.7', tag: 'नांदेडचा आवाज · dhol-tasha bangers', bpm: 124, steps: 16, scales: ['bhairavi', 'kafi', 'khamaj'], root: 62, color: '#ffcf3f' },
  { id: 'lavani', name: 'Lavani Express 98.3', tag: 'ढोलकी, हार्मोनियम आणि ठसका', bpm: 104, steps: 12, scales: ['kafi', 'khamaj', 'yaman'], root: 60, color: '#ff8fb1' },
  { id: 'katta', name: 'Katta Lo-Fi 101.1', tag: 'chai, coaching notes, chill beats', bpm: 80, steps: 16, scales: ['pent', 'kafi', 'yaman'], root: 64, color: '#7fd1ff' },
];

const DJ = [
  "You're tuned to {name}. Traffic on VIP Road? Honk twice and relax.",
  '{name} — chai cutting, volume full.',
  'Next up on {name}: a brand-new track, made in Nanded, approved by your mother.',
  '{name}. If you are driving an auto right now, please look at the road, not the radio.',
];

export class Radio {
  constructor(ctx, out, noise) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(out);
    this.noise = noise;
    this.index = 0; // -1 = off
    this.playing = false;
    this.next = 0;
    this.step = 0;
    this.bar = 0;
    this.song = null;
    this.songSeed = Math.floor(Math.random() * 1e6);
    this.crackle = null;
    this.vol = 0;
  }

  get station() { return this.index >= 0 ? STATIONS[this.index] : null; }

  /** Cycle to the next station (or off). Returns { name, tag } for the HUD. */
  cycle() {
    this.setIndex(this.index >= STATIONS.length - 1 ? -1 : this.index + 1);
    return this.station ? { name: this.station.name, tag: this.station.tag } : { name: 'Radio off', tag: '' };
  }

  /** Tune to a station by its index (-1: off). The new station starts with a song of its own. */
  setIndex(i) {
    this.index = Math.max(-1, Math.min(STATIONS.length - 1, Math.round(i) || 0));
    // Not playing: the next update starts the new station's song. Left playing, it would go on
    // scheduling the song just thrown away.
    this.song = null; this.playing = false;
    this._crackle(this.station?.id === 'katta');
  }

  update(dt, inVehicle, game) {
    const ctx = this.ctx, now = ctx.currentTime;
    const want = inVehicle && this.index >= 0;
    this.out.gain.setTargetAtTime(want ? 0.85 : 0, now, want ? 0.6 : 0.25);
    if (!want) { this.playing = false; return; }
    if (!this.playing) { this.playing = true; this.next = now + 0.1; if (!this.song) this._newSong(game); }
    const st = this.station;
    const stepDur = 60 / st.bpm / (st.steps === 12 ? 3 : 4);
    while (this.next < now + 0.18) {
      this._schedule(this.next, stepDur);
      this.next += stepDur * (st.id === 'katta' && this.step % 2 === 0 ? 1.18 : st.id === 'katta' ? 0.82 : 1);
      this.step++;
      if (this.step >= st.steps) { this.step = 0; this.bar++; if (this.bar >= this.song.bars) this._newSong(game); }
    }
  }

  _newSong(game) {
    const st = this.station;
    const r = rng(this.songSeed++);
    const scale = SCALES[r.pick(st.scales)];
    const len = st.steps;
    // A two-bar motif on 8th-note slots (every 2 steps; every 3 for the 12-step lilt).
    const slot = len === 12 ? 3 : 2, slots = (len / slot) * 2;
    const motif = [];
    let deg = r.int(0, 4);
    for (let i = 0; i < slots; i++) {
      if (r.chance(st.id === 'katta' ? 0.45 : 0.22)) { motif.push(null); continue; }
      deg = Math.max(-2, Math.min(9, deg + r.pick([-2, -1, -1, 0, 1, 1, 2])));
      motif.push(deg);
    }
    const prog = st.id === 'katta' ? r.pick([[0, 5, 3, 6], [0, 3, 4, 3], [0, 6, 5, 4]]) : [0, 0, 3, 4];
    this.song = { scale, motif, slot, bars: 24 + r.int(0, 2) * 8, prog, seed: r.int(0, 1e6), lead: r.chance(0.5) };
    this.bar = 0; this.step = 0;
    if (game) {
      const line = r.pick(DJ).replace('{name}', st.name);
      game.hud?.radioText?.(st.name, line, st.color);
    }
  }

  _note(degree, octave = 0) {
    const sc = this.song.scale, n = sc.length;
    const o = Math.floor(degree / n), d = ((degree % n) + n) % n;
    return this.station.root + sc[d] + 12 * (o + octave);
  }

  _schedule(t, stepDur) {
    const st = this.station, s = this.step, bar = this.bar, song = this.song;
    const intro = bar < 4, outro = bar >= song.bars - 2;
    const section = Math.floor(bar / 8) % 2; // A / B
    if (st.id === 'godavari') {
      const dhol = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0];
      const tipri = [0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1];
      if (dhol[s]) this._dholBass(t, s % 8 === 0 ? 0.7 : 0.5);
      if (tipri[s]) this._slap(t, 1300, 0.22);
      // Tasha rolls: 16ths, accented on beats, a 32nd-note roll into each 4th bar.
      if (!intro || bar >= 2) this._tasha(t, s % 4 === 0 ? 0.16 : 0.07);
      if (bar % 4 === 3 && s >= 12) this._tasha(t + stepDur / 2, 0.08);
      if (s % 8 === 4) this._jhanj(t, 0.06);
      if (s % 4 === 0 && !intro) this._kick(t, 0.5);
      if (s === 0 && !intro) this._bass(t, midi(this._note(song.prog[bar % 4], -2)), stepDur * 7, 0.22);
      if (!intro && !outro && s % song.slot === 0) {
        const idx = ((bar % 2) * (st.steps / song.slot)) + s / song.slot;
        let deg = song.motif[idx % song.motif.length];
        if (deg !== null && deg !== undefined) {
          if (section === 1 && bar % 4 >= 2) deg += 2;
          this._shehnai(t, midi(this._note(deg)), stepDur * song.slot * 0.95, 0.09);
        }
      }
    } else if (st.id === 'lavani') {
      const low = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0], high = [0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 1];
      if (low[s]) this._dholBass(t, 0.42, 110);
      if (high[s]) this._slap(t, 900 + (s % 2) * 500, 0.2);
      if (s % 3 === 0) this._jhanj(t, s % 6 === 0 ? 0.05 : 0.025, 8000);
      if (s === 0) this._harmonium(t, [this._note(song.prog[bar % 4], -1), this._note(song.prog[bar % 4] + 2, -1), this._note(song.prog[bar % 4] + 4, -1)].map(midi), stepDur * 11, 0.035);
      if (!intro && !outro && s % song.slot === 0) {
        const idx = ((bar % 2) * (st.steps / song.slot)) + s / song.slot;
        let deg = song.motif[idx % song.motif.length];
        if (deg !== null && deg !== undefined) { if (section === 1) deg += 1; this._harmonium(t, [midi(this._note(deg, 1))], stepDur * song.slot * 0.9, 0.06); }
      }
    } else {
      const kick = [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0], snare = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0];
      if (kick[s]) this._kick(t, 0.55);
      if (snare[s]) this._snare(t, 0.18);
      if (s % 2 === 0) this._hat(t, s % 4 === 0 ? 0.05 : 0.03);
      if (s === 0 || s === 6) {
        const root = song.prog[bar % 4];
        this._rhodes(t, [this._note(root, -1), this._note(root + 2, -1), this._note(root + 4, -1), this._note(root + 6, -1)].map(midi), stepDur * (s === 0 ? 6 : 10), 0.05);
        if (s === 0) this._bass(t, midi(this._note(root, -2)), stepDur * 8, 0.2);
      }
      if (!intro && !outro && s % song.slot === 0) {
        const idx = ((bar % 2) * (st.steps / song.slot)) + s / song.slot;
        const deg = song.motif[idx % song.motif.length];
        if (deg !== null && deg !== undefined && (section === 0 || bar % 2 === 0)) this._pluck(t, midi(this._note(deg, 1)), 0.08);
      }
    }
  }

  // ---------------------------------------------------------------- instruments
  _env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
  _osc(type, f, t, dur) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.start(t); o.stop(t + dur + 0.1); return o; }
  _noiseSrc(t, dur) { const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05); return s; }
  _kick(t, v) { const o = this._osc('sine', 150, t, 0.3), g = this.ctx.createGain(); o.frequency.exponentialRampToValueAtTime(42, t + 0.12); this._env(g, t, 0.003, v, 0.26); o.connect(g).connect(this.out); }
  _dholBass(t, v, f = 92) {
    const o = this._osc('sine', f, t, 0.4), g = this.ctx.createGain(); o.frequency.exponentialRampToValueAtTime(f * 0.62, t + 0.18); this._env(g, t, 0.004, v, 0.32); o.connect(g).connect(this.out);
    const n = this._noiseSrc(t, 0.1), f2 = this.ctx.createBiquadFilter(), g2 = this.ctx.createGain(); f2.type = 'lowpass'; f2.frequency.value = 500; this._env(g2, t, 0.002, v * 0.5, 0.07); n.connect(f2).connect(g2).connect(this.out);
  }
  _slap(t, f, v) { const n = this._noiseSrc(t, 0.12), fl = this.ctx.createBiquadFilter(), g = this.ctx.createGain(); fl.type = 'bandpass'; fl.frequency.value = f; fl.Q.value = 2.5; this._env(g, t, 0.002, v, 0.09); n.connect(fl).connect(g).connect(this.out); }
  _tasha(t, v) { const n = this._noiseSrc(t, 0.08), fl = this.ctx.createBiquadFilter(), g = this.ctx.createGain(); fl.type = 'bandpass'; fl.frequency.value = 2600; fl.Q.value = 3.5; this._env(g, t, 0.001, v, 0.05); n.connect(fl).connect(g).connect(this.out); }
  _jhanj(t, v, f = 6500) { const n = this._noiseSrc(t, 0.4), fl = this.ctx.createBiquadFilter(), g = this.ctx.createGain(); fl.type = 'highpass'; fl.frequency.value = f; this._env(g, t, 0.002, v, 0.3); n.connect(fl).connect(g).connect(this.out); }
  _snare(t, v) { this._slap(t, 1800, v); const o = this._osc('triangle', 190, t, 0.15), g = this.ctx.createGain(); this._env(g, t, 0.002, v * 0.6, 0.1); o.connect(g).connect(this.out); }
  _hat(t, v) { this._jhanj(t, v, 8500); }
  _bass(t, f, dur, v) { const o = this._osc('triangle', f, t, dur), g = this.ctx.createGain(); this._env(g, t, 0.01, v, dur); o.connect(g).connect(this.out); }
  _shehnai(t, f, dur, v) {
    // Reedy saw through a nasal band-pass, with vibrato and a little slide into the note.
    const o = this._osc('sawtooth', f * 0.97, t, dur), fl = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
    const lfo = this._osc('sine', 5.6, t, dur), lg = this.ctx.createGain(); lg.gain.value = f * 0.012; lfo.connect(lg).connect(o.frequency);
    fl.type = 'bandpass'; fl.frequency.value = Math.min(2600, f * 3); fl.Q.value = 1.8;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.03); g.gain.setValueAtTime(v, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(fl).connect(g).connect(this.out);
  }
  _harmonium(t, freqs, dur, v) {
    for (const f of freqs) for (const det of [1, 1.004]) {
      const o = this._osc('square', f * det, t, dur), fl = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
      fl.type = 'lowpass'; fl.frequency.value = 1800;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.04); g.gain.setValueAtTime(v, t + dur * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(fl).connect(g).connect(this.out);
    }
  }
  _rhodes(t, freqs, dur, v) {
    for (const f of freqs) {
      const o = this._osc('sine', f, t, dur), o2 = this._osc('sine', f * 2.005, t, dur * 0.5), g = this.ctx.createGain(), g2 = this.ctx.createGain();
      this._env(g, t, 0.01, v, dur); this._env(g2, t, 0.005, v * 0.25, dur * 0.4);
      o.connect(g).connect(this.out); o2.connect(g2).connect(this.out);
    }
  }
  _pluck(t, f, v) {
    // Sitar-ish: bright triangle with a fast decay and a bend down into the note.
    const o = this._osc('sawtooth', f * 1.02, t, 0.9), fl = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
    fl.type = 'lowpass'; fl.frequency.setValueAtTime(4200, t); fl.frequency.exponentialRampToValueAtTime(700, t + 0.6);
    this._env(g, t, 0.003, v, 0.8);
    o.connect(fl).connect(g).connect(this.out);
  }
  _crackle(on) {
    if (this.crackle) { try { this.crackle.stop(); } catch { /* already stopped */ } this.crackle = null; }
    if (!on) return;
    const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 3200; f.Q.value = 0.5;
    const g = this.ctx.createGain(); g.gain.value = 0.012;
    s.connect(f).connect(g).connect(this.out); s.start();
    this.crackle = s;
  }
}
