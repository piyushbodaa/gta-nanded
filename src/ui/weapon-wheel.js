// The weapon wheel, GTA style: hold Tab (or RB) and the game slows down while seven slots fan out round the
// middle of the screen; the mouse, the right stick or a finger points at one, and letting go takes it. On a
// touch screen the weapon button opens it, a tap on a slot chooses, and a tap anywhere else closes it.
// The weapons themselves (what is owned, the slow motion) belong to game.weapons; this is only the picker.
import { SLOTS, WEAPONS, ORDER, AMMO } from '../game/weapon-data.js';
import { keyName } from './controls.js';

const $ = id => document.getElementById(id);
const TAU = Math.PI * 2;

/**
 * The slot a direction points at, as an index into SLOTS: slots run clockwise from the top, and x and y are
 * screen axes (y down, as mouse movement and the stick's y both are). Inside the dead zone it points at none
 * (-1), so a mouse that hardly moved, or a stick at rest, keeps what was highlighted.
 */
export function slotAt(x, y, dead = 0, n = SLOTS.length) {
  const l = Math.hypot(x, y);
  if (!(l > dead) || l === 0) return -1;
  const a = Math.atan2(x, -y); // 0 straight up, growing clockwise
  return ((Math.round(a / (TAU / n)) % n) + n) % n;
}

/** The owned weapons in a slot, in wheel order. */
export const slotOwned = (weapons, slotId) => ORDER.filter(id => WEAPONS[id].slot === slotId && weapons.has(id));

/** The ammo line for a weapon: '25 / 90', '×2' for grenades, nothing for fists and the pan. */
export function ammoText(weapons, id) {
  const def = WEAPONS[id];
  if (!def?.ammo) return '';
  const a = weapons.ammoOf(id);
  return def.hold === 'throw' ? `×${a.mag}` : `${a.mag} / ${a.reserve}`;
}

/**
 * Small silhouettes, drawn for this game (a 48 × 20 box, filled with the text colour): a shape to find a weapon
 * by at a glance, not a picture of the real thing.
 */
const ICON_PATHS = {
  fist: 'M15 6c0-2 2-3 4-3h12c3 0 5 2 5 5v6c0 3-2 5-5 5H21c-3 0-6-2-6-5zM19 7v4M24 6v5M29 6v5',
  pan: 'M4 10a8 8 0 1 0 16 0a8 8 0 1 0-16 0zM19 9h25a1.5 1.5 0 0 1 0 3H19z',
  p92: 'M10 5h26v4H22l-1 2h-3l-2 8h-6l2-8h-2zM36 6h3v2h-3z',
  uzi: 'M8 5h28v5H25l-2 9h-5l2-9h-6l-2 3h-3l1-3H8zM36 6h4v2h-4z',
  ump45: 'M2 7h6l2-2h28v5h-8l-2 8h-4l1-8H15l-1 5h-4l1-5H6l-2 4H2zM38 6h5v2h-5z',
  akm: 'M1 9l8-3h28v4h-6l1 1-3 8h-4l2-7H18l-2 5h-4l1-5H9L2 13zM37 7h10v1.5H37z',
  m416: 'M1 6h8v7H6l-2-2H1zM9 6h28v4h-5l-2 8h-4l1-8H18l-1 5h-4l1-5H9zM37 7h10v1.5H37zM16 3h8v2h-8z',
  s12k: 'M1 8l9-2h26v4H26l-1 8h-6l1-8h-3l-2 4h-4l1-4H9L2 12zM36 6h11v3H36z',
  kar98k: 'M1 10l9-2h20l2-1h17v2H32l-2 2H17l-2 3h-4l1-3H9L2 13zM15 3h12v3H15z',
  awm: 'M1 7h5v7H3l-2-2zM6 8h26v4h-4l-2 6h-4l1-6H14l-1 3H9l1-3H6zM32 9h16v1.5H32zM12 3h16v3.5H12z',
  grenade: 'M18 8a7 7 0 1 0 12 0zM20 5h8v3h-8zM28 4l7-2 1 2-8 2z',
};
const icon = id => `<svg class="ww-icon" viewBox="0 0 48 20" aria-hidden="true"><path d="${ICON_PATHS[id] || ''}"/></svg>`;

export class WeaponWheel {
  constructor(game) {
    this.game = game;
    this.root = $('weapon-wheel');
    this.ring = $('ww-ring');
    this.open = false; // the overlay is up
    this.mode = null; // 'hold' (Tab, RB: letting go chooses) or 'tap' (touch: a tap chooses)
    this.hl = -1; // highlighted slot index
    this.pick = {}; // slot id -> the weapon shown for it (next / previous moves within the slot)
    this.cursor = { x: 0, y: 0 }; // where the mouse points, from the middle (px)
    this.latched = false; // closed while Tab or RB is still held: wait for it to come up before opening again
    this.dirty = false;
    this.refreshT = 0;
    this.shown = []; // per slot: the html last written, so a frame writes only what changed
    this.shownCentre = '';
    this.shownHl = null;
    this._build();
    this._bind();
  }

  _build() {
    this.ring.innerHTML = SLOTS.map((s, i) => `<button type="button" class="ww-slot" data-slot="${s.id}" style="--a:${(i * 360 / SLOTS.length).toFixed(3)}deg" aria-label="${s.name}"></button>`).join('')
      + '<div class="ww-centre"><b id="ww-name"></b><span id="ww-ammo"></span><small id="ww-cal"></small><em id="ww-hint"></em></div>';
    const bySlot = {};
    for (const el of this.ring.querySelectorAll('[data-slot]')) bySlot[el.dataset.slot] = el;
    this.slots = SLOTS.map(s => bySlot[s.id] || null);
    this.centre = { name: $('ww-name'), ammo: $('ww-ammo'), cal: $('ww-cal'), hint: $('ww-hint') };
  }

  _bind() {
    // The mouse points while the wheel is up: under pointer lock by how far it has moved (the view is held still
    // meanwhile, game.js), and with a free cursor by where it is from the middle of the screen.
    addEventListener('mousemove', e => {
      if (!this.open) return;
      const c = this.cursor, R = 150;
      if (this.game.input.pointerLocked) { c.x += e.movementX || 0; c.y += e.movementY || 0; } else { c.x = e.clientX - innerWidth / 2; c.y = e.clientY - innerHeight / 2; }
      const l = Math.hypot(c.x, c.y);
      if (l > R) { c.x *= R / l; c.y *= R / l; }
      const i = slotAt(c.x, c.y, 28);
      if (i >= 0) this._highlight(i);
    });
    // Taps and clicks: on a slot it chooses, anywhere else it closes. On the way down, as every touch button here.
    this.root.addEventListener('pointerdown', e => {
      if (!this.open) return;
      e.preventDefault(); e.stopPropagation();
      const el = e.target.closest?.('[data-slot]');
      if (el) this.tapSlot(SLOTS.findIndex(s => s.id === el.dataset.slot));
      else this.close();
    });
    this.root.addEventListener('contextmenu', e => e.preventDefault());
    // No click after the tap: it would land on whatever is under the finger once the wheel has gone.
    this.root.addEventListener('touchend', e => { if (e.cancelable) e.preventDefault(); }, { passive: false });
  }

  /** Every frame (game.js), paused or not: opens, follows and closes the wheel. */
  update(dt = 0) {
    const g = this.game, w = g.weapons, input = g.input;
    if (!w) return;
    const P = g.player;
    // Nothing to choose from behind a menu, in a cutscene, at the wheel of a car or knocked down.
    if (g.paused || g.pause?.open || g.cutscene || P.vehicle || P.state !== 'foot' || w.active === false) {
      if (w.wheelOpen) w.closeWheel();
      if (this.open) this._hide();
      if (!g.paused) input.pressed('wheel');
      return;
    }
    const held = input.state.wheelHeld;
    if (!held) this.latched = false;
    if (input.pressed('wheel')) { // the touch weapon button: open, or close again
      if (this.open) this.close(); else this._open('tap');
    }
    if (held && !this.open && !this.latched) this._open('hold');
    if (w.wheelOpen && !this.open) this._open('tap'); // opened from elsewhere: a tap closes it
    else if (!w.wheelOpen && this.open) this._hide(); // closed from elsewhere
    if (!this.open) return;
    if (this.mode === 'hold' && !held) { this.close(this.chosen()); return; }
    // The right stick points like the mouse; pushed only a little, it keeps what was highlighted.
    const sx = input.state.stickX || 0, sy = input.state.stickY || 0;
    if (sx * sx + sy * sy > 0.36) this._highlight(slotAt(sx, sy));
    if (input.pressed('wheelNext') || (this.mode === 'tap' && input.pressed('weaponNext'))) this.cycle(1);
    if (input.pressed('wheelPrev') || (this.mode === 'tap' && input.pressed('weaponPrev'))) this.cycle(-1);
    // Ammo can change while it is up (a pickup in slow motion): look again a few times a second.
    if ((this.refreshT -= dt) <= 0) { this.refreshT = 0.25; this.dirty = true; }
    if (this.dirty) this._render();
  }

  /** The weapon the highlighted slot would give (null for an empty slot, or none highlighted). */
  chosen() {
    const s = SLOTS[this.hl];
    return (s && this.pick[s.id]) || null;
  }

  /** A tap or click on slot i: take its weapon; on the slot already in hand, the next weapon in it. */
  tapSlot(i) {
    const w = this.game.weapons, s = SLOTS[i];
    if (!s || !w) return;
    const owned = slotOwned(w, s.id);
    this._highlight(i);
    if (!owned.length) return; // greyed out: nothing to take
    if (owned.length > 1 && owned.includes(w.current)) {
      w.selectSlot(s.id); // cycles within the slot, and stays open to show which
      this.pick[s.id] = w.current;
      this.dirty = true;
      return;
    }
    this.close(this.pick[s.id] || owned[0]);
  }

  /** Next or previous weapon within the highlighted slot (shown, taken on letting go). */
  cycle(dir) {
    const s = SLOTS[this.hl], w = this.game.weapons;
    if (!s) return;
    const owned = slotOwned(w, s.id);
    if (owned.length < 2) return;
    const i = Math.max(0, owned.indexOf(this.pick[s.id]));
    this.pick[s.id] = owned[(i + dir + owned.length) % owned.length];
    this.dirty = true;
  }

  /** Close, taking weapon `id` if given. */
  close(id) {
    const g = this.game, w = g.weapons;
    if (id) w.closeWheel(id); else w.closeWheel();
    if (g.input.state.wheelHeld) this.latched = true; // Tab or RB still down: not straight back open
    this._hide();
  }

  _open(mode) {
    const w = this.game.weapons;
    if (!w.wheelOpen) w.openWheel();
    if (!w.wheelOpen) return; // refused (respawning, say): don't flash the overlay
    this.open = true; this.mode = mode;
    this.cursor.x = this.cursor.y = 0;
    for (const s of SLOTS) this.pick[s.id] = w.slotWeapon(s.id);
    const cur = WEAPONS[w.current]?.slot;
    this.hl = SLOTS.findIndex(s => s.id === cur);
    if (this.hl >= 0) this.pick[cur] = w.current;
    this.root.hidden = false;
    document.body?.classList.add('wheel-open');
    this.refreshT = 0.25;
    this.shown.length = 0; this.shownCentre = ''; this.shownHl = null; // its slots may have changed since
    this._render();
  }

  _hide() {
    this.open = false; this.mode = null;
    this.root.hidden = true;
    document.body?.classList.remove('wheel-open');
  }

  _highlight(i) {
    if (i === this.hl || i < 0) return;
    this.hl = i;
    this.dirty = true;
    if (this.game.input.mode === 'touch') return;
    navigator.vibrate?.(4);
  }

  /** Write the slots and the middle, touching only what changed. */
  _render() {
    this.dirty = false;
    const g = this.game, w = g.weapons;
    for (let i = 0; i < SLOTS.length; i++) {
      const s = SLOTS[i], el = this.slots[i];
      if (!el) continue;
      const owned = slotOwned(w, s.id), id = this.pick[s.id];
      const def = WEAPONS[id];
      let html;
      if (!owned.length || !def) html = `<b>${s.name.toUpperCase()}</b><small>—</small>`;
      else {
        const k = owned.indexOf(id);
        html = `${icon(id)}<b>${def.short}</b><small>${ammoText(w, id)}</small>${owned.length > 1 ? `<i class="ww-more">${k + 1}/${owned.length}</i>` : ''}`;
      }
      const cls = `ww-slot${!owned.length ? ' empty' : ''}${i === this.hl ? ' hl' : ''}${id && id === w.current ? ' cur' : ''}`;
      if (this.shown[i] !== html) { this.shown[i] = html; el.innerHTML = html; }
      if (el.className !== cls) el.className = cls;
    }
    if (this.hl !== this.shownHl) {
      this.shownHl = this.hl;
      this.ring.classList.toggle('none', this.hl < 0);
      this.ring.style.setProperty?.('--hl', `${(this.hl * 360 / SLOTS.length).toFixed(3)}deg`);
    }
    const s = SLOTS[this.hl], id = s && this.pick[s.id], def = WEAPONS[id];
    const mode = g.input.mode;
    const hint = this.mode === 'tap' ? 'Tap to choose · tap outside to close'
      : mode === 'gamepad' ? `Right stick to point · let go of ${keyName(g, 'wheel')}` : `Point with the mouse · let go of ${keyName(g, 'wheel')}`;
    const name = def ? def.name : s ? `${s.name}: none yet` : '';
    const ammo = def ? ammoText(w, id) : '';
    const cal = def?.ammo && def.hold !== 'throw' ? AMMO[def.ammo]?.name || '' : '';
    const key = `${name}|${ammo}|${cal}|${hint}`;
    if (key !== this.shownCentre) {
      this.shownCentre = key;
      const c = this.centre;
      c.name.textContent = name; c.ammo.textContent = ammo; c.cal.textContent = cal; c.hint.textContent = hint;
    }
  }
}
