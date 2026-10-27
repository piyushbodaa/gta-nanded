// Progress saved on this device: cash, story, side jobs, passport stamps, stats, settings.
const KEY = 'gta-nanded-save-v2';

const DEFAULT = () => ({
  version: 2,
  cash: 200,
  story: [], // completed mission ids
  stamps: [], // landmark passport
  districts: [],
  records: {}, // best times
  stats: { distance: 0, fares: 0, deliveries: 0, jacked: 0, busted: 0, wasted: 0, punches: 0, crashes: 0, playTime: 0 },
  settings: { lang: 'en', music: 0.6, sfx: 0.8, radio: 0, sound: true, sensitivity: 1, invertY: false, assist: true, perf: false },
  started: false,
});

export class Save {
  constructor() {
    this.data = DEFAULT();
    this.available = true;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && d.version === 2) this.data = { ...DEFAULT(), ...d, stats: { ...DEFAULT().stats, ...d.stats }, settings: { ...DEFAULT().settings, ...d.settings } };
      }
    } catch { this.available = false; }
    this._dirty = false;
  }
  get cash() { return this.data.cash; }
  set cash(v) { this.data.cash = Math.max(0, Math.round(v)); this.dirty(); }
  get hasProgress() { return this.data.started && (this.data.story.length > 0 || this.data.cash !== 200); }
  done(id) { return this.data.story.includes(id); }
  complete(id) { if (!this.done(id)) this.data.story.push(id); this.dirty(); this.flush(); }
  stat(k, d = 1) { this.data.stats[k] = (this.data.stats[k] || 0) + d; this.dirty(); }
  dirty() { this._dirty = true; }
  /** Write the progress out. The first time storage refuses, `onFail` lets the game tell the player. */
  flush() {
    if (!this._dirty) return true;
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); this._dirty = false; return true; } catch {
      if (this.available) { this.available = false; this.onFail?.(); }
      return false;
    }
  }
  reset() { this.data = DEFAULT(); this._dirty = true; this.flush(); }
}
