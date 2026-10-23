// Graphics tiers and an automatic governor that trades resolution, shadows and
// density for a steady frame rate. The player's manual choice is remembered, and so
// is what the automatic setting learned about this device's GPU, so the next launch
// starts where the last one settled.
//
// Phones draw more pixels than a desktop at the same tier: their screens pack two to
// three device pixels into every CSS pixel, and the browser stretches whatever we draw
// over all of them. They smooth edges in the final pass (FXAA) instead of multisampling,
// which costs a phone GPU far more memory bandwidth.
const TIERS = {
  low: { name: 'Fast', pr: 0.75, phonePr: 1.5, msaa: false, bloom: false, shadows: 0, dynamicShadows: false, viewDistance: 340, traffic: 14, peds: 20 },
  medium: { name: 'Balanced', pr: 1, phonePr: 1.75, msaa: true, bloom: true, shadows: 1024, dynamicShadows: false, viewDistance: 440, traffic: 24, peds: 32 },
  high: { name: 'High', pr: 1.25, phonePr: 2, msaa: true, bloom: true, shadows: 2048, dynamicShadows: true, viewDistance: 540, traffic: 32, peds: 44 },
  ultra: { name: 'Ultra', pr: 2, phonePr: 2.25, msaa: true, bloom: true, shadows: 2048, dynamicShadows: true, viewDistance: 680, traffic: 42, peds: 60 },
};
export const ORDER = ['low', 'medium', 'high', 'ultra'];
const KEY = 'gta-nanded-quality-v2', FPS_KEY = 'gta-nanded-fps-v1', LEARN_KEY = 'gta-nanded-auto-v1';
/** The lowest resolution scale the governor goes to before it gives up a tier. */
export const MIN_SCALE = 0.5;
/** The fewest cars, people and animals (a share of the tier's numbers) a slow processor thins them to. */
export const MIN_CROWD = 0.4;
/** Frame-rate caps the player can pick: 0 follows the display. Phones also have 'auto'. */
export const FPS_CAPS = [0, 60, 30];

const read = k => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

/** A short name for the GPU from WebGL's renderer string ("ANGLE (Qualcomm, Adreno (TM) 710, ...)" -> "Adreno 710"). */
export function gpuLabel(raw = '') {
  const s = String(raw).replace(/\((TM|R)\)/gi, '').replace(/\s+/g, ' ').trim();
  const m = s.match(/Adreno\s*\d+|Mali-\w+(?: MC\d+)?|Immortalis-\w+|Xclipse \d+|PowerVR [\w-]+|Apple (?:GPU|M\d+(?: (?:Pro|Max|Ultra))?)|GeForce [\w ]*?\d+\w*(?: Ti)?|Radeon[\w ]*?\d+\w*|Iris Xe|Iris \w+|(?:UHD|HD) Graphics(?: \d+)?/i);
  if (m) return m[0];
  const angle = s.match(/^ANGLE \([^,]*, ([^,(]+)/); // ANGLE (vendor, device, API): the device
  return (angle ? angle[1] : s).trim().slice(0, 32) || 'GPU';
}

/**
 * A first guess at the tier for a GPU nobody has measured yet. Calibration behind the cover
 * and the governor during play correct it; this only decides where they start.
 */
export function guessTier(gpu, phone, cores = 4, memory = 4) {
  if (!phone) return cores >= 8 ? 'high' : 'medium';
  const g = gpu.toLowerCase();
  let m;
  if ((m = g.match(/adreno\D*(\d{3})/))) return +m[1] >= 730 ? 'high' : +m[1] >= 640 ? 'medium' : 'low';
  if (g.includes('immortalis')) return 'high';
  if ((m = g.match(/mali-g(\d+)/))) return +m[1] >= 610 || (+m[1] >= 76 && +m[1] < 100) ? 'medium' : 'low';
  if (g.includes('apple') || g.includes('xclipse')) return 'medium';
  return cores >= 8 && memory >= 6 ? 'medium' : 'low';
}

export class Quality {
  constructor() {
    const saved = read(KEY);
    this.mode = saved && (saved === 'auto' || TIERS[saved]) ? saved : 'auto';
    this.phone = matchMedia('(any-pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 500;
    // Each tier as this device uses it.
    this.tiers = {};
    for (const k of ORDER) { const t = TIERS[k]; this.tiers[k] = { ...t, pr: this.phone ? t.phonePr : t.pr, msaa: t.msaa && !this.phone }; }
    // Phones default to 'auto': 60 fps, or a steady 30 where the processor can't keep up.
    const fps = read(FPS_KEY);
    this.fpsMode = fps === 'auto' ? 'auto' : fps !== null && FPS_CAPS.includes(Number(fps)) ? Number(fps) : this.phone ? 'auto' : 0;
    this.autoCap = 60;
    this.crowd = 1; // traffic, people and animals, as a share of the tier's numbers
    this.gpu = '';
    this.learned = null;
    this.autoTier = guessTier('', this.phone, navigator.hardwareConcurrency, navigator.deviceMemory);
    this.scale = 1; // dynamic resolution multiplier
    this.frames = []; this.windowT = 0; this.goodT = 0; this.slowWindows = 0;
    this.ceiling = 1; this.ceilingT = 0; this.headroomT = 0; this.crowdT = 0; this.idleCpuT = 0;
    this.fps = 60;
  }

  /** Once the renderer exists: name its GPU and start from what we learned about it last time. */
  setGpu(raw) {
    this.gpu = gpuLabel(raw);
    let l = null;
    try { l = JSON.parse(read(LEARN_KEY)); } catch { /* none yet */ }
    if (l && l.gpu === this.gpu && TIERS[l.tier]) {
      this.learned = l;
      this.autoTier = l.tier;
      this.scale = Math.min(1, Math.max(MIN_SCALE, l.scale ?? 1));
      this.crowd = Math.min(1, Math.max(MIN_CROWD, l.crowd ?? 1));
      this.autoCap = l.cap30 ? 30 : 60;
    } else this.autoTier = guessTier(this.gpu, this.phone, navigator.hardwareConcurrency, navigator.deviceMemory);
  }

  get tier() { return this.mode === 'auto' ? this.autoTier : this.mode; }
  get settings() { return this.tiers[this.tier]; }
  /** Drawing-buffer pixels per CSS pixel. */
  pixelRatio() { return Math.min(devicePixelRatio || 1, this.settings.pr) * this.scale; }
  /** How much the browser stretches our frame to fill the screen (1 = every device pixel drawn). */
  upscale() { return Math.max(1, (devicePixelRatio || 1) / this.pixelRatio()); }
  label() { return this.mode === 'auto' ? `Auto (${this.settings.name})` : this.settings.name; }
  /** The frame-rate cap in force (0: the display's rate). */
  get fpsCap() { return this.fpsMode === 'auto' ? this.autoCap : this.fpsMode; }
  fpsLabel() {
    if (this.fpsMode === 'auto') return `Auto (${this.fpsCap} fps)`;
    return this.fpsCap === 30 ? '30 fps · battery saver' : this.fpsCap === 60 ? '60 fps · smooth' : 'Unlimited';
  }
  /** Tiers the automatic setting has found too heavy for this GPU. */
  get tooHeavy() { return this.learned?.tooHeavy || []; }

  cycle(game) {
    const modes = ['auto', ...ORDER];
    this.mode = modes[(modes.indexOf(this.mode) + 1) % modes.length];
    this.scale = this.mode === 'auto' ? this.learned?.scale ?? 1 : 1;
    write(KEY, this.mode);
    game.applyQuality();
    return this.label();
  }

  cycleFps() {
    // Phones: automatic, smooth or battery saver; desktops may also follow the display.
    const modes = this.phone ? ['auto', 60, 30] : FPS_CAPS;
    this.fpsMode = modes[(modes.indexOf(this.fpsMode) + 1) % modes.length];
    write(FPS_KEY, String(this.fpsMode));
    this.frames.length = 0; this.windowT = 0; this.goodT = 0;
    return this.fpsLabel();
  }

  /** Remember where the automatic setting settled for this GPU. */
  learn(extra = {}) {
    if (!this.gpu) return;
    this.learned = { ...this.learned, gpu: this.gpu, tier: this.autoTier, scale: Math.round(this.scale * 100) / 100, crowd: this.crowd, ...extra };
    write(LEARN_KEY, JSON.stringify(this.learned));
  }

  /** Give up the current tier for the next one down, and remember it was too heavy. */
  stepDown(game) {
    const i = ORDER.indexOf(this.autoTier);
    if (i <= 0) return false;
    const heavy = new Set(this.tooHeavy); heavy.add(this.autoTier);
    this.autoTier = ORDER[i - 1];
    this.scale = 0.8;
    this.learn({ tooHeavy: [...heavy], promote: false });
    game.applyQuality();
    return true;
  }

  /**
   * Feed raw frame times; steps resolution (and, as a last resort, tier) in auto mode.
   * Missed frames bring the resolution down at once; a run of frames that keep up raises
   * it again in small steps, but not back to a resolution that just failed for a minute.
   * When the game's own work fills most of the frame, the processor is what can't keep up
   * (budget phones on Firebase Test Lab spent 9-14 ms of a 16.7 ms frame there) and a
   * blurrier picture wouldn't help: it thins the traffic and crowds instead, then, in auto
   * frame-rate mode, settles for a steady 30 fps rather than a ragged 40-50.
   * Running at full resolution with time to spare for a minute and a half marks this GPU
   * for a tier up at the next launch (tier changes recompile shaders: never mid-game).
   * Browsers throttle hidden or covered tabs to a few frames a second: those windows say
   * nothing about the GPU, so they are thrown away rather than read as slowness.
   */
  sample(dt, game) {
    if (!game.started || game.paused || document.hidden) { this.frames.length = 0; this.windowT = 0; return; }
    this.frames.push(dt);
    this.windowT += dt;
    if (this.windowT < 2) return;
    const frames = this.frames.slice(), spent = this.windowT;
    this.frames.length = 0; this.windowT = 0;
    this.fps = frames.length / spent;
    const throttled = frames.filter(f => f > 0.2).length;
    if (frames.length < 20 || throttled > frames.length * 0.2) return;
    if (this.mode !== 'auto') return;
    const target = 1 / (this.fpsCap || 60);
    const sorted = frames.sort((a, b) => a - b);
    const p80 = sorted[Math.floor(sorted.length * 0.8)];
    this.ceilingT = Math.max(0, this.ceilingT - spent);
    const cpuBound = (game.cpuMs || 0) > target * 1000 * 0.55;
    if (p80 > target * 1.3) {
      this.goodT = 0; this.headroomT = 0; this.idleCpuT = 0;
      if (cpuBound && this.crowd > MIN_CROWD + 1e-3) { this.crowd = Math.max(MIN_CROWD, Math.round((this.crowd - 0.2) * 100) / 100); this.crowdT = 60; this.learn(); return; }
      if (cpuBound && this.fpsMode === 'auto' && this.autoCap === 60) { this.autoCap = 30; this.learn({ cap30: true }); return; }
      this.ceiling = this.scale; this.ceilingT = 60;
      if (this.scale > MIN_SCALE + 1e-3) { this.scale = Math.max(MIN_SCALE, Math.round((this.scale - 0.1) * 100) / 100); game.resize(); this.learn(); }
      else if (++this.slowWindows >= 2) { this.slowWindows = 0; this.stepDown(game); }
      return;
    }
    this.slowWindows = 0;
    if (p80 > target * 1.05) return;
    this.goodT += spent;
    // Crowds come back a step at a time once the frame has room again, never within a minute.
    if (this.crowd < 1 && (this.crowdT -= spent) <= 0 && (game.cpuMs || 0) < target * 1000 * 0.4) { this.crowd = Math.min(1, Math.round((this.crowd + 0.1) * 100) / 100); this.crowdT = 20; this.learn(); }
    // Settled at 30 but hardly busy for a minute and a half: try 60 again at the next launch.
    if (this.fpsMode === 'auto' && this.autoCap === 30 && this.learned?.cap30 && (game.cpuMs || 0) < 7 && (this.idleCpuT += spent) >= 90) this.learn({ cap30: false });
    const top = this.ceilingT > 0 ? this.ceiling - 0.05 : 1;
    if (this.scale < top - 1e-3) {
      if (this.goodT >= 8) { this.scale = Math.min(top, Math.round((this.scale + 0.05) * 100) / 100); this.goodT = 0; game.resize(); this.learn(); }
    } else if (this.scale > 0.999 && (this.headroomT += spent) >= 90 && !this.learned?.promote) {
      const up = ORDER[ORDER.indexOf(this.autoTier) + 1];
      if (up && !this.tooHeavy.includes(up)) this.learn({ promote: true });
    }
  }
}
