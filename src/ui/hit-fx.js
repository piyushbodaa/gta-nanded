// Knowing when you're hurt, and from where: red screen edges that flash with each hit, a red
// chevron round the middle pointing at whoever hit you, a soft heartbeat pulse when health is low,
// and a buzz. All brief: the edges mix towards red (never towards black) and fade in about 0.6 s,
// so the picture never stays darker (clarity-means-visible).
//
// Edges go into the post FINAL pass when post.setHurt exists (no extra layer for the phone's
// compositor); otherwise a #hud-hurt radial-gradient element stands in. Runs at real time, so the
// slow-motion weapon wheel doesn't stretch it, and does nothing once everything has faded.
import { clamp, wrapAngle } from '../core/math.js';
import { haptic } from './haptics.js';

const DIRS = 4, DIR_LIFE = 1.2, SAME = 25 * Math.PI / 180, FLASH_FADE = 0.6;
const LOW_HP = 30, BEAT_GATE = 10; // seconds since the last hit (or wanted) that the heartbeat keeps going
const POINTED = new Set(['police', 'gang', 'fight', 'explosion', 'vehicle']);
const SHAKE_SKIP = new Set(['explosion', 'crash', 'fight', 'bail']); // these shake at their call sites
const R = 'min(20vmin, 130px)';

/** Where (fx, fz) is, seen from (px, pz) facing `facing`: radians clockwise from screen-up. */
export const screenAngle = (fx, fz, px, pz, facing) => -wrapAngle(Math.atan2(fx - px, fz - pz) - facing);
/** How strong a hit's red flash is, 0.25..1. */
export const flashFor = amount => clamp(amount / 35, 0.25, 1);
/** How low health is: 0 at 30 hp and above, 1 at 0. */
export const lowFor = health => health >= LOW_HP ? 0 : clamp((LOW_HP - health) / LOW_HP, 0, 1);
/** Seconds between heartbeats: 0.95 at 30 hp, 0.6 at 5 hp and below. */
export const beatPeriod = low => 0.95 - 0.35 * clamp(low / (25 / 30), 0, 1);
/** The buzz for a hit. */
export function patternFor(source, amount) {
  if (source === 'explosion') return [70, 40, 90];
  if (source === 'crash' || source === 'bail') return 30;
  return amount >= 20 ? 40 : 18;
}

export class HitFx {
  constructor(game, { doc = globalThis.document, motion = globalThis.matchMedia } = {}) {
    this.game = game;
    this.doc = doc;
    this.calm = !!motion?.('(prefers-reduced-motion: reduce)')?.matches; // halves the shake
    this.t = 0;
    this.flash = 0; this.pulse = 0; this.low = 0; this.desat = 0; this.desatHold = 0;
    this.lastHitT = -1e9; this.beatT = 0;
    this.dirs = Array.from({ length: DIRS }, () => ({ fx: 0, fz: 0, t: 0, el: null, deg: 1e9, op: 0 }));
    this.dirX = 0; this.dirY = 0; this.dirW = 0;
    this.edge = 0; this._shownEdge = -1; this._live = false;
    this._els = null;
  }

  /** The chevrons and the fallback edge element, looked up once they exist. */
  _dom() {
    if (this._els) return this._els;
    const d = this.doc?.getElementById?.('hud-dmg'), h = this.doc?.getElementById?.('hud-hurt');
    if (!d && !h) return null;
    const marks = d ? [...(d.children || d.querySelectorAll?.('i') || [])] : [];
    this.dirs.forEach((m, i) => { m.el = marks[i] || null; });
    return (this._els = { dmg: d, hurt: h });
  }

  /** The player took `amount` from `source`; `from` (x, z) is who or what, if anyone. */
  hurt(amount, source, from = null) {
    const g = this.game;
    this.flash = Math.max(this.flash, flashFor(amount));
    this.lastHitT = this.t;
    this._live = true;
    const hp = g.player?.health ?? 100;
    if (hp > 0 && hp <= 15) { this.desat = 0.35; this.desatHold = 0.5; }
    if (from && POINTED.has(source)) this._point(from.x, from.z);
    if (amount >= 15 && !SHAKE_SKIP.has(source)) g.camera?.addShake?.(Math.min(0.5, amount / 60) * (this.calm ? 0.5 : 1));
    g.hud?.flashHealth?.();
    haptic(g, patternFor(source, amount));
  }

  /** A bullet hit the car you're in: a marker towards the shooter, no red edge. */
  incoming(x, z) {
    this._live = true;
    this.lastHitT = this.t;
    this._point(x, z);
    haptic(this.game, 12);
  }

  /** WASTED: one full red flash, the long buzz, markers gone. */
  wasted() {
    this.flash = 1; this.desat = 0; this.desatHold = 0; this.lastHitT = -1e9; this.low = 0; this.pulse = 0;
    for (const m of this.dirs) m.t = 0;
    this._live = true;
    haptic(this.game, [120, 80, 220], true);
  }

  /** Back to nothing (respawn). */
  reset() {
    this.flash = this.pulse = this.low = this.desat = this.desatHold = 0;
    this.lastHitT = -1e9; this.beatT = 0;
    for (const m of this.dirs) m.t = 0;
    this._live = true; // one more update writes everything off
  }

  /** A marker towards (x, z): refresh one within 25°, else a free one, else the oldest. */
  _point(x, z) {
    const g = this.game, p = g.player?.pos || g.player, facing = g.camera?.facing ?? 0;
    const a = p ? screenAngle(x, z, p.x, p.z, facing) : 0;
    let pick = null, oldest = null;
    for (const m of this.dirs) {
      if (m.t > 0 && p && Math.abs(wrapAngle(screenAngle(m.fx, m.fz, p.x, p.z, facing) - a)) < SAME) { pick = m; break; }
      if (!oldest || m.t < oldest.t) oldest = m;
    }
    pick ||= oldest;
    pick.fx = x; pick.fz = z; pick.t = DIR_LIFE;
  }

  /** Whether the heartbeat (and its pulse) should go: hurt, alive, and hit lately or wanted. */
  beating() {
    const g = this.game;
    return this.low > 0 && g.player?.state !== 'dead' && !g.respawning && (this.t - this.lastHitT < BEAT_GATE || (g.police?.level ?? 0) > 0);
  }

  update(realDt) {
    const g = this.game, dt = Math.max(0, realDt || 0);
    this.t += dt;
    this.low = g.player?.state === 'dead' ? 0 : lowFor(g.player?.health ?? 100);
    if (!this._live && this.low === 0) return;
    // Flash and colour drain ease out.
    this.flash = Math.max(0, this.flash - dt / FLASH_FADE);
    if (this.desatHold > 0) this.desatHold -= dt; else this.desat = Math.max(0, this.desat - dt / 0.6);
    // Heartbeat: a thump and a soft swell of the edges, faster the lower health is.
    if (this.beating()) {
      this.beatT -= dt;
      if (this.beatT <= 0) {
        this.beatT += beatPeriod(this.low);
        if (this.beatT < 0) this.beatT = beatPeriod(this.low);
        g.audio?.sfx?.('heartbeat', 0.5 + 0.5 * this.low);
        this._beatAge = 0;
      }
      this._beatAge = (this._beatAge ?? 9) + dt;
      this.pulse = 0.3 * Math.min(1, 0.4 + this.low) * Math.max(0, 1 - this._beatAge / 0.4);
    } else { this.pulse = 0; this.beatT = 0; }
    // Markers: keep pointing at the spot in the world as the camera turns, fade over 1.2 s.
    const p = g.player?.pos || g.player, facing = g.camera?.facing ?? 0;
    const els = this._dom();
    let best = null, live = this.flash > 0 || this.desat > 0 || this.pulse > 0;
    for (const m of this.dirs) {
      if (m.t > 0) { m.t = Math.max(0, m.t - dt); live = true; if (!best || m.t > best.t) best = m; }
      const op = m.t / DIR_LIFE;
      if (!m.el) continue;
      const deg = m.t > 0 && p ? screenAngle(m.fx, m.fz, p.x, p.z, facing) * 180 / Math.PI : m.deg;
      const turned = Math.abs(((deg - m.deg + 540) % 360) - 180) > 1;
      if (turned || Math.abs(op - m.op) >= 0.05 || (op === 0 && m.op !== 0)) {
        if (turned) { m.deg = deg; m.el.style.transform = `rotate(${deg.toFixed(1)}deg) translateY(calc(-1 * ${R}))`; }
        m.op = op;
        m.el.style.opacity = op.toFixed(2);
      }
    }
    if (best && p) { const a = screenAngle(best.fx, best.fz, p.x, p.z, facing); this.dirX = Math.sin(a); this.dirY = Math.cos(a); this.dirW = best.t / DIR_LIFE; }
    else this.dirW = 0;
    // The red edges: in the post pass, or the fallback element.
    this.edge = Math.max(this.flash, this.pulse);
    const post = g.post;
    if (post?.setHurt && post.enabled !== false) {
      post.setHurt(this.edge, this.desat, this.dirX, this.dirY, this.dirW);
      if (els?.hurt && !els.hurt.hidden) els.hurt.hidden = true;
    } else if (els?.hurt) {
      const e = this.edge < 0.02 ? 0 : this.edge;
      if (Math.abs(e - this._shownEdge) >= 0.03 || (e === 0 && this._shownEdge !== 0)) {
        this._shownEdge = e;
        els.hurt.hidden = e === 0;
        els.hurt.style.opacity = e.toFixed(2);
      }
    }
    this._live = live;
  }
}
