// Graphics tiers and an automatic governor that trades resolution, shadows and
// density for a steady frame rate. The player's manual choice is remembered.
const TIERS = {
  low: { name: 'Fast', pr: 0.75, msaa: false, shadows: 0, dynamicShadows: false, viewDistance: 340, traffic: 14, peds: 20 },
  medium: { name: 'Balanced', pr: 1, msaa: true, shadows: 1024, dynamicShadows: false, viewDistance: 440, traffic: 24, peds: 32 },
  high: { name: 'High', pr: 1.25, msaa: true, shadows: 2048, dynamicShadows: true, viewDistance: 540, traffic: 32, peds: 44 },
  ultra: { name: 'Ultra', pr: 2, msaa: true, shadows: 2048, dynamicShadows: true, viewDistance: 680, traffic: 42, peds: 60 },
};
const ORDER = ['low', 'medium', 'high', 'ultra'];
const KEY = 'gta-nanded-quality-v2';

export class Quality {
  constructor() {
    let saved = null;
    try { saved = localStorage.getItem(KEY); } catch { /* private mode */ }
    this.mode = saved && (saved === 'auto' || TIERS[saved]) ? saved : 'auto';
    const coarse = matchMedia('(any-pointer: coarse)').matches;
    const small = Math.min(innerWidth, innerHeight) < 500;
    const cores = navigator.hardwareConcurrency || 4, mem = navigator.deviceMemory || 4;
    this.autoTier = coarse || small ? (cores >= 8 && mem >= 6 ? 'medium' : 'low') : cores >= 8 ? 'high' : 'medium';
    this.scale = 1; // dynamic resolution multiplier
    this.frames = []; this.windowT = 0; this.goodT = 0;
    this.fps = 60;
  }
  get tier() { return this.mode === 'auto' ? this.autoTier : this.mode; }
  get settings() { return TIERS[this.tier]; }
  pixelRatio() { return Math.min(devicePixelRatio || 1, this.settings.pr) * this.scale; }
  label() { return this.mode === 'auto' ? `Auto (${this.settings.name})` : this.settings.name; }

  cycle(game) {
    const modes = ['auto', ...ORDER];
    this.mode = modes[(modes.indexOf(this.mode) + 1) % modes.length];
    this.scale = 1;
    try { localStorage.setItem(KEY, this.mode); } catch { /* private mode */ }
    game.applyQuality();
    return this.label();
  }

  /**
   * Feed raw frame times; steps resolution/tier in auto mode. Browsers throttle
   * hidden or covered tabs to a few frames a second: those windows say nothing
   * about the GPU, so they are thrown away rather than read as slowness.
   */
  sample(dt, game) {
    if (!game.started || game.paused || document.hidden) { this.frames.length = 0; this.windowT = 0; return; }
    this.frames.push(dt);
    this.windowT += dt;
    if (this.windowT < 3) return;
    const frames = this.frames.slice();
    this.frames.length = 0; this.windowT = 0;
    this.fps = frames.length / frames.reduce((a, b) => a + b, 0);
    const throttled = frames.filter(f => f > 0.2).length;
    if (frames.length < 45 || throttled > frames.length * 0.2) return;
    const sorted = frames.sort((a, b) => a - b);
    const p80 = sorted[Math.floor(sorted.length * 0.8)];
    if (this.mode !== 'auto') return;
    if (p80 > 1 / 42) {
      this.goodT = 0;
      if (this.scale > 0.71) { this.scale = Math.max(0.7, this.scale - 0.15); game.resize(); }
      else {
        const i = ORDER.indexOf(this.autoTier);
        if (i > 0) { this.autoTier = ORDER[i - 1]; this.scale = 1; game.applyQuality(); }
      }
    } else if (p80 < 1 / 58) {
      this.goodT += 2.5;
      if (this.goodT >= 10 && this.scale < 1) { this.scale = Math.min(1, this.scale + 0.15); this.goodT = 0; game.resize(); }
    }
  }
}
