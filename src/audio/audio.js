// Every sound in the game is synthesised here with Web Audio: engines, horns,
// sirens, crashes, footsteps, the city around you, and (via Radio) the music.
import { clamp, dist } from '../core/math.js';
import { Radio } from './radio.js';

const ENGINE = {
  auto: { base: 26, wave: 'sawtooth', cut: 900, putt: true, gain: 0.11 },
  bike: { base: 40, wave: 'sawtooth', cut: 1800, putt: true, gain: 0.1 },
  scooter: { base: 52, wave: 'triangle', cut: 1600, gain: 0.08 },
  bus: { base: 20, wave: 'sawtooth', cut: 500, diesel: true, gain: 0.13 },
  truck: { base: 19, wave: 'sawtooth', cut: 480, diesel: true, gain: 0.13 },
  tractor: { base: 17, wave: 'square', cut: 420, diesel: true, putt: true, gain: 0.12 },
  tempo: { base: 24, wave: 'sawtooth', cut: 700, diesel: true, gain: 0.11 },
  default: { base: 30, wave: 'sawtooth', cut: 1200, gain: 0.09 },
};
const HORN = {
  auto: { f: [330], wave: 'sawtooth', pulses: 2, len: 0.12 },
  bike: { f: [620], wave: 'square', pulses: 1, len: 0.28 },
  scooter: { f: [700], wave: 'square', pulses: 2, len: 0.12 },
  bus: { f: [220, 277], wave: 'sawtooth', pulses: 1, len: 0.7 },
  truck: { f: [196, 247, 294], wave: 'sawtooth', pulses: 1, len: 0.9 },
  police: { f: [410, 512], wave: 'square', pulses: 1, len: 0.35 },
  default: { f: [415, 520], wave: 'square', pulses: 1, len: 0.32 },
};

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.volume = { master: 0.9, sfx: 0.8, music: 0.6 };
    this.hornCool = new Map();
    this.radio = null;
  }

  /** Must be called from a user gesture. */
  init() {
    if (this.ctx) return this.ctx.resume();
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return Promise.resolve();
    const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));
    this.master = ctx.createGain(); this.master.gain.value = this.volume.master;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = this.volume.sfx; this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.volume.music; this.musicBus.connect(this.master);
    this.ambBus = ctx.createGain(); this.ambBus.gain.value = 0.7; this.ambBus.connect(this.master);
    // Shared noise buffers.
    this.white = this._noise('white'); this.brown = this._noise('brown');
    this._engine();
    this._ambience();
    this._siren();
    this.radio = new Radio(ctx, this.musicBus, this.white);
    this.enabled = true;
    return ctx.resume();
  }

  setEnabled(on) {
    if (!this.ctx) return;
    this.enabled = on;
    this.master.gain.setTargetAtTime(on ? this.volume.master : 0, this.ctx.currentTime, 0.05);
    if (on) this.ctx.resume();
  }
  setVolumes({ sfx, music }) {
    if (sfx !== undefined) { this.volume.sfx = sfx; this.sfxBus && (this.sfxBus.gain.value = sfx); }
    if (music !== undefined) { this.volume.music = music; this.musicBus && (this.musicBus.gain.value = music); }
  }

  _noise(kind) {
    const ctx = this.ctx, len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return buf;
  }
  _src(buf, loop = true) { const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = loop; return s; }

  // ---------------------------------------------------------------- engine
  _engine() {
    const ctx = this.ctx;
    this.eng = {
      o1: ctx.createOscillator(), o2: ctx.createOscillator(), filt: ctx.createBiquadFilter(), gain: ctx.createGain(),
      putt: ctx.createGain(), puttLfo: ctx.createOscillator(), puttDepth: ctx.createGain(),
      screechSrc: this._src(this.white), screechF: ctx.createBiquadFilter(), screech: ctx.createGain(),
      windSrc: this._src(this.brown), windF: ctx.createBiquadFilter(), wind: ctx.createGain(),
      type: null,
    };
    const e = this.eng;
    e.o2.type = 'square';
    e.filt.type = 'lowpass'; e.filt.Q.value = 2;
    e.o1.connect(e.filt); e.o2.connect(e.filt);
    e.filt.connect(e.putt).connect(e.gain).connect(this.sfxBus);
    e.puttLfo.type = 'square'; e.puttLfo.connect(e.puttDepth).connect(e.putt.gain);
    e.putt.gain.value = 1; e.puttDepth.gain.value = 0;
    e.gain.gain.value = 0;
    e.screechF.type = 'bandpass'; e.screechF.frequency.value = 1700; e.screechF.Q.value = 1.6;
    e.screechSrc.connect(e.screechF).connect(e.screech).connect(this.sfxBus); e.screech.gain.value = 0;
    e.windF.type = 'lowpass'; e.windF.frequency.value = 600;
    e.windSrc.connect(e.windF).connect(e.wind).connect(this.sfxBus); e.wind.gain.value = 0;
    for (const n of [e.o1, e.o2, e.puttLfo, e.screechSrc, e.windSrc]) n.start();
  }

  _setEngineType(type) {
    const e = this.eng, p = ENGINE[type] || ENGINE.default;
    e.type = type; e.p = p;
    e.o1.type = p.wave;
    e.filt.frequency.value = p.cut;
    e.puttDepth.gain.value = p.putt ? 0.55 : 0;
  }

  // ---------------------------------------------------------------- siren
  _siren() {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), lfo = ctx.createOscillator(), depth = ctx.createGain(), g = ctx.createGain(), pan = ctx.createStereoPanner?.() || ctx.createGain();
    o.type = 'triangle'; o.frequency.value = 950;
    lfo.type = 'sine'; lfo.frequency.value = 0.42; depth.gain.value = 320;
    lfo.connect(depth).connect(o.frequency);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1000; f.Q.value = 0.8;
    o.connect(f).connect(g).connect(pan).connect(this.sfxBus);
    g.gain.value = 0;
    o.start(); lfo.start();
    this.sir = { o, lfo, g, pan };
  }

  // ---------------------------------------------------------------- ambience
  _ambience() {
    const ctx = this.ctx;
    const bed = this._src(this.brown), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass'; f.frequency.value = 420; g.gain.value = 0.0;
    bed.connect(f).connect(g).connect(this.ambBus); bed.start();
    const rain = this._src(this.white), rf = ctx.createBiquadFilter(), rg = ctx.createGain();
    rf.type = 'highpass'; rf.frequency.value = 1200; rg.gain.value = 0;
    rain.connect(rf).connect(rg).connect(this.ambBus); rain.start();
    this.amb = { bed: g, rain: rg, next: 0, birdNext: 0, bellNext: 0 };
  }

  /** One-shot tone with an envelope. */
  _tone(freq, dur, { type = 'sine', gain = 0.2, at = 0, glide = null, bus = this.sfxBus, attack = 0.005 } = {}) {
    const ctx = this.ctx, t = ctx.currentTime + at;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus); o.start(t); o.stop(t + dur + 0.05);
  }
  _burst(dur, { freq = 1000, q = 1, type = 'bandpass', gain = 0.3, at = 0, buf = this.white, bus = this.sfxBus } = {}) {
    const ctx = this.ctx, t = ctx.currentTime + at;
    const s = this._src(buf, false), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(bus); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }

  sfx(name, k = 1) {
    if (!this.enabled || !this.ctx) return;
    switch (name) {
      case 'punch': this._burst(0.12, { freq: 300, q: 0.7, gain: 0.5 * k, type: 'lowpass' }); this._tone(90, 0.15, { gain: 0.35 * k, glide: 50 }); break;
      case 'crash':
        this._burst(0.5 + k * 0.4, { freq: 900, q: 0.6, gain: clamp(0.25 + k * 0.4, 0, 0.9) });
        this._tone(70, 0.4, { gain: clamp(0.3 + k * 0.4, 0, 0.8), glide: 35 });
        this._tone(1400 + Math.random() * 600, 0.6, { type: 'triangle', gain: 0.05 * k, glide: 900 });
        break;
      case 'explosion':
        this._burst(1.6, { freq: 500, q: 0.4, gain: 0.9, type: 'lowpass', buf: this.brown });
        this._burst(0.8, { freq: 2000, q: 0.5, gain: 0.5 });
        this._tone(55, 1.2, { gain: 0.9, glide: 25 });
        break;
      case 'jump': this._tone(240, 0.08, { gain: 0.05, glide: 300 }); break;
      case 'step': this._burst(0.04, { freq: 1400, q: 0.8, gain: 0.04 * k }); break;
      case 'checkpoint': this._tone(880, 0.12, { type: 'triangle', gain: 0.25 }); this._tone(1320, 0.25, { type: 'triangle', gain: 0.25, at: 0.1 }); break;
      case 'passed': [523, 659, 784, 1046].forEach((f, i) => this._tone(f, 0.5, { type: 'triangle', gain: 0.18, at: i * 0.12 })); break;
      case 'failed': [392, 330, 262].forEach((f, i) => this._tone(f, 0.45, { type: 'sawtooth', gain: 0.1, at: i * 0.18 })); break;
      case 'mission': this._tone(196, 0.9, { type: 'sawtooth', gain: 0.08 }); this._tone(294, 0.9, { type: 'sawtooth', gain: 0.06, at: 0.05 }); this._burst(0.6, { freq: 3000, gain: 0.08, at: 0.02 }); break;
      case 'buy': this._tone(1320, 0.08, { type: 'square', gain: 0.08 }); this._tone(1760, 0.18, { type: 'square', gain: 0.08, at: 0.07 }); break;
      case 'spray': this._burst(1.4, { freq: 5000, q: 0.5, gain: 0.25, type: 'highpass' }); break;
      case 'wasted': this._tone(110, 2.2, { type: 'sawtooth', gain: 0.18, glide: 55 }); this._burst(2, { freq: 300, gain: 0.2, type: 'lowpass', buf: this.brown }); break;
      case 'busted': this._tone(600, 0.25, { type: 'square', gain: 0.1 }); this._tone(450, 0.5, { type: 'square', gain: 0.1, at: 0.25 }); break;
      case 'door': this._burst(0.08, { freq: 600, q: 1, gain: 0.25 }); this._tone(140, 0.1, { gain: 0.2 }); break;
      case 'bell': this._bell(0.12 * k); break;
      case 'wanted': this._tone(988, 0.15, { type: 'square', gain: 0.07 }); this._tone(740, 0.15, { type: 'square', gain: 0.07, at: 0.16 }); break;
    }
  }
  _bell(g) { [880, 1760, 2637, 3520].forEach((f, i) => this._tone(f * (1 + i * 0.002), 2.6 - i * 0.4, { gain: g / (i + 1) })); }

  /** Horn from a vehicle; volume falls off with distance from the listener. */
  horn(v, vol = 1) {
    if (!this.enabled || !this.ctx || !v) return;
    const now = this.ctx.currentTime;
    if ((this.hornCool.get(v.id) || 0) > now) return;
    const h = HORN[v.type] || HORN.default;
    const d = this.listener ? dist(v.x, v.z, this.listener.x, this.listener.z) : 0;
    const g = clamp(1 / (1 + d / 18), 0, 1) * 0.14 * vol;
    if (g < 0.004) return;
    this.hornCool.set(v.id, now + h.len * h.pulses + 0.15);
    for (let p = 0; p < h.pulses; p++) for (const f of h.f) {
      const o = this.ctx.createOscillator(), gn = this.ctx.createGain(), flt = this.ctx.createBiquadFilter();
      const t = now + p * (h.len + 0.06);
      o.type = h.wave; o.frequency.value = f * (v.type === 'auto' ? 1 + Math.sin(p) * 0.02 : 1);
      flt.type = 'lowpass'; flt.frequency.value = 2400;
      gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(g, t + 0.015); gn.gain.setValueAtTime(g, t + h.len - 0.03); gn.gain.linearRampToValueAtTime(0, t + h.len);
      o.connect(flt).connect(gn).connect(this.sfxBus); o.start(t); o.stop(t + h.len + 0.05);
    }
  }

  /** Per-frame: engine, screech, wind, siren, ambience, radio. */
  update(dt, g) {
    if (!this.ctx || !this.enabled) return;
    const now = this.ctx.currentTime, P = g.player, v = P.vehicle;
    this.listener = g.camera3.position;
    const e = this.eng;
    if (v && !g.paused) {
      if (e.type !== v.type) this._setEngineType(v.type);
      const p = e.p;
      const rpm = v.rpm;
      const f = p.base * (0.65 + rpm * 2.1);
      e.o1.frequency.setTargetAtTime(f, now, 0.04);
      e.o2.frequency.setTargetAtTime(f * 0.5, now, 0.04);
      e.puttLfo.frequency.setTargetAtTime(f * 0.5, now, 0.05);
      e.filt.frequency.setTargetAtTime(p.cut * (0.6 + rpm * 1.4), now, 0.05);
      e.gain.gain.setTargetAtTime(v.wrecked ? 0 : p.gain * (0.55 + Math.abs(v.throttle) * 0.6), now, 0.06);
      const spd = Math.hypot(v.vx, v.vz);
      e.screech.gain.setTargetAtTime(v.spec.two ? 0 : clamp((v.slip - 0.18) * 1.4, 0, 0.5) * clamp(spd / 6, 0, 1) * 0.45, now, 0.05);
      e.wind.gain.setTargetAtTime(clamp(spd / 40, 0, 1) * 0.12, now, 0.2);
    } else {
      e.gain.gain.setTargetAtTime(0, now, 0.08); e.screech.gain.setTargetAtTime(0, now, 0.05); e.wind.gain.setTargetAtTime(0, now, 0.1);
    }
    // Siren: loudest unit with its siren on.
    let best = 0, pan = 0;
    for (const u of g.vehicles.list) {
      if (!u.sirenOn) continue;
      const d = dist(u.x, u.z, this.listener.x, this.listener.z);
      const k = clamp(1 / (1 + d / 25), 0, 1);
      if (k > best) {
        best = k;
        const cam = g.camera3, rx = Math.cos(g.camera.facing), rz = -Math.sin(g.camera.facing);
        pan = clamp(((u.x - cam.position.x) * -rx + (u.z - cam.position.z) * -rz) / Math.max(d, 1), -0.8, 0.8);
      }
    }
    this.sir.g.gain.setTargetAtTime(g.paused ? 0 : best * 0.09, now, 0.1);
    if (this.sir.pan.pan) this.sir.pan.pan.setTargetAtTime(pan, now, 0.1);
    // Ambience by place and time.
    const a = this.amb, sky = g.sky, pos = P.pos;
    const dens = g.city.densityAt(pos.x, pos.z);
    a.bed.gain.setTargetAtTime(g.paused ? 0 : (0.02 + dens * 0.05) * (sky.night > 0.5 ? 0.6 : 1), now, 0.5);
    a.rain.gain.setTargetAtTime(g.paused ? 0 : sky.w.grey > 0.5 ? 0.06 : 0, now, 0.8);
    if (!g.paused && now > a.next && dens > 0.25) {
      a.next = now + 1.5 + Math.random() * (6 - dens * 3);
      // A horn somewhere down the street.
      const fake = { id: -Math.floor(Math.random() * 1e6), type: ['auto', 'bike', 'default', 'bus', 'scooter'][Math.floor(Math.random() * 5)], x: pos.x + (Math.random() - 0.5) * 120, z: pos.z + (Math.random() - 0.5) * 120 };
      this.horn(fake, 0.6);
    }
    const hour = sky.hours;
    if (!g.paused && now > a.birdNext && hour > 5.5 && hour < 10.5) {
      a.birdNext = now + 0.8 + Math.random() * 3;
      const f = 2400 + Math.random() * 1800;
      for (let k = 0; k < 2 + Math.floor(Math.random() * 3); k++) this._tone(f, 0.07, { gain: 0.025, at: k * 0.11, glide: f * 1.3, bus: this.ambBus });
    }
    if (!g.paused && now > a.birdNext && (hour > 20 || hour < 5)) {
      a.birdNext = now + 0.4 + Math.random();
      this._burst(0.05, { freq: 4500, q: 8, gain: 0.02, bus: this.ambBus }); this._burst(0.05, { freq: 4500, q: 8, gain: 0.02, at: 0.07, bus: this.ambBus });
    }
    if (!g.paused && now > a.bellNext && g.nearShrine?.()) { a.bellNext = now + 5 + Math.random() * 8; this._bell(0.05); }
    // Radio only plays in vehicles.
    this.radio?.update(dt, Boolean(v) && !g.paused && !g.cutscene, g);
  }
}
