// Weapons: what the player carries, how each gun fires, where the bullets go and what they do;
// grenades, the loot crates on the footpaths and the air drops. Logic only: WeaponFx draws the
// guns, tracers and crates, the WeaponWheel picks, the HUD reads. No three.js and no DOM here, so
// the tests drive it with a fake game.
import { WEAPONS, AMMO, SLOTS, ORDER, LOOT_TABLE, AIRDROP_TABLE, HEADSHOT, NO_FIRE, interval, falloff } from './weapon-data.js';
import { rng, hash2, clamp, dist, wrapAngle } from '../core/math.js';

const WATER_Y = -2.7; // world/water.js (not imported: it brings three.js along)
const SEG = 24; // a long shot is marched in pieces this long (Colliders.raycastSolid walks a box)
const MAX_RATE = 1 / 12; // never more than 12 shots a second, whatever the table says (sound nodes, phones)
const ASSIST = 0.055; // touch and gamepad: a bullet bends toward someone this close to the crosshair (~3° at the base view, less zoomed in)
const HEAR = 120; // gunfire carries this far to a police officer
const GROUND_TOP = 1.3; // nothing the ground does is higher than the station's platforms
const DECK_TOP = 7; // a flyover's deck (roadnet DECK_H 6.4) and a little over it
const DECK_SLAB = 0.9; // how thick a deck is to a bullet from below
const MUZZLE_CHECK = 6; // the line from the muzzle is checked this far (round a corner the camera sees past)
const TURN_OK = 0.4; // a hip shot waits (a moment at most) until the body faces within this of the aim
const PICKUP = 1.3; // walk this close to a crate to take it
const RESPAWN = 300; // a taken crate is back after five minutes of play
const AIRDROP_EVERY = 420; // an air drop every seven minutes out of missions
const DROP_SPEED = 5.5; // m/s under the parachute
const SLOT_EVENTS = ['slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6', 'slot7'];
// Where the crates lie: thick around the station (where a new story opens) and home (where play
// resumes), then across the city. Coordinates of main.js's station start and story.js's HOME.
const RINGS = [{ x: 1.3, z: 12.9, r0: 20, r1: 520, n: 26 }, { x: -935.4, z: -1834.1, r0: 25, r1: 420, n: 10 }, { x: 400, z: 300, r0: 350, r1: 2900, n: 34 }];

const pickWeighted = (table, r) => {
  let sum = 0;
  for (const e of table) sum += e.w;
  let u = r() * sum;
  for (const e of table) if ((u -= e.w) < 0) return e;
  return table[table.length - 1];
};
/** A crate's contents, rolled from the table: a weapon (with the ammo that comes with it) or a box of ammo. */
function roll(table, r, into) {
  const e = pickWeighted(table, r);
  into.id = e.id || null; into.ammo = e.id ? null : e.ammo; into.n = e.id ? WEAPONS[e.id].start || 0 : e.n;
  return into;
}

/**
 * About 70 crates on the footpaths and road edges, the same ones every game: on a street at ground
 * level (not a flyover or a bridge), clear of walls and stalls, out of the river and the holy places,
 * 40 m or more apart.
 */
export function placeLoot(net, city, colliders, zones = [], seed = 7) {
  const out = [], q = {}, r = rng(hash2(seed, 9091)), ok = road => !net.raised[road] && !net.bridge[road];
  for (const ring of RINGS) {
    let made = 0;
    for (let tries = 0; tries < ring.n * 30 && made < ring.n; tries++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(ring.r0 * ring.r0 + r() * (ring.r1 * ring.r1 - ring.r0 * ring.r0));
      const n = net.nearest(ring.x + Math.cos(a) * d, ring.z + Math.sin(a) * d, 40, q, ok);
      if (!n) continue;
      const w = net.width[n.road], off = w >= 8 ? w / 2 + 0.95 : w / 2 + 0.45, side = r() < 0.5 ? 1 : -1;
      const x = n.x + n.dz * off * side, z = n.z - n.dx * off * side;
      if (colliders?.blocked(x, z, 0.45)) continue;
      const ground = city?.groundHeight(x, z) ?? 0;
      if (ground < -0.4) continue; // down the river bank
      if (zones.some(s => (s.x - x) ** 2 + (s.z - z) ** 2 < s.r2)) continue;
      if (out.some(c => (c.x - x) ** 2 + (c.z - z) ** 2 < 1600)) continue;
      const y = Math.max(ground, (city?.pavementAt?.(n.seg, off)) || -Infinity);
      out.push(roll(LOOT_TABLE, r, { x, y, z, id: null, ammo: null, n: 0, taken: false, kind: 'crate', i: out.length, gen: 0, respawnAt: 0 }));
      made++;
    }
  }
  return out;
}

export class Weapons {
  constructor(game) {
    this.game = game;
    this.inv = new Set(['fist']);
    this.mags = {}; // weapon id -> rounds loaded
    this.ammo = {}; // calibre -> rounds in reserve (frag: grenades carried)
    this.current = 'fist';
    this.reloading = 0; this._reloadT = 0;
    this.aimToggle = false; this.aiming = false; this.scoped = false;
    this.spread = 0; this.bloom = 0;
    this.blocked = null; this.wheelOpen = false;
    this.hitMarker = null; this._hm = { t: 0, kill: false, head: false };
    this.lastShotT = -99;
    this.aimPitch = 0; this.aimYaw = 0;
    this.cool = 0; this._boltT = 0; this._queued = 0; this._swallow = 0; this._clickT = 0; this._dt = 0;
    // A trigger already held as the player comes on foot (RT was the throttle) fires nothing until let go.
    this._wasActive = undefined; this._needRelease = false;
    this._faceT = -99; this._turnT = -99; // a hip shot waiting for the body to turn to the aim
    this._tg = []; this._tgN = 0; // what one shot's pellets hit, added up per person and per vehicle
    this._deckT = -1; this._decks = false; this._nq = {}; this._raised = r => this.game.net.raised[r];
    this.grenades = [];
    this.airdrop = null; this.airdropT = AIRDROP_EVERY;
    this._slotPick = {};
    this._owned = null;
    // Scratch, reused shot after shot: nothing is allocated per bullet.
    this._o = { x: 0, y: 0, z: 0 }; this._d = { x: 0, y: 0, z: 0 }; this._dir = { x: 0, y: 0, z: 0 }; this._m = { x: 0, y: 0, z: 0 };
    this._hit = { t: 0, kind: null, ped: null, vehicle: null, head: false, x: 0, y: 0, z: 0 };
    this._shotReportT = -99; this._panicT = -99; this._holyT = 0; this._fullT = -99;
    this._blips = []; this._blipPool = []; this._blipT = 0;
    this._saveT = 0; this._dirty = false;
    // Places of worship from the map, where guns stay holstered.
    this.zones = [];
    for (const p of game.city?.places || []) if (NO_FIRE[p.id]) this.zones.push({ x: p.x, z: p.z, r2: NO_FIRE[p.id] ** 2, id: p.id });
    this.loot = game.net && game.colliders ? placeLoot(game.net, game.city, game.colliders, this.zones) : [];
    this.fromSave(game.save?.data?.inventory);
  }

  // ---------------------------------------------------------------- what is carried
  get def() { return WEAPONS[this.current]; }
  /** Owned weapon ids in wheel order (cached; rebuilt when the inventory changes). */
  get owned() { return this._owned || (this._owned = ORDER.filter(id => this.inv.has(id))); }
  has(id) { return this.inv.has(id); }
  get mag() { const w = this.def; return w.slot === 'throw' ? this.ammo.frag || 0 : this.mags[this.current] || 0; }
  get reserve() { const w = this.def; return !w.ammo || w.slot === 'throw' ? 0 : this.ammo[w.ammo] || 0; }
  ammoOf(id) {
    const w = WEAPONS[id];
    if (!w) return { mag: 0, reserve: 0 };
    if (w.slot === 'throw') return { mag: this.ammo.frag || 0, reserve: 0 };
    return { mag: this.mags[id] || 0, reserve: w.ammo ? this.ammo[w.ammo] || 0 : 0 };
  }
  get armed() { return this.game.player?.state === 'foot' && this.current !== 'fist'; }
  get active() { const g = this.game; return g.player?.state === 'foot' && !g.cutscene && !g.respawning; }
  /** Firing a gun or throwing: the player faces where the camera looks (aiming, or just after a shot). */
  get facing() {
    const h = this.def.hold;
    const t = this.game.time;
    return h !== 'none' && h !== 'melee' && this.armed && (this.aiming || t - this.lastShotT < 1.2 || t - this._faceT < 0.4);
  }

  /** The weapon the wheel shows for a slot: the one in hand, else the last picked there, else the first owned. */
  slotWeapon(slotId) {
    if (this.def.slot === slotId) return this.current;
    const last = this._slotPick[slotId];
    if (last && this.inv.has(last)) return last;
    for (const id of this.owned) if (WEAPONS[id].slot === slotId) return id;
    return null;
  }

  _changed() { this._owned = null; this._dirty = true; }

  equip(id) {
    if (!this.inv.has(id)) return false;
    this._slotPick[WEAPONS[id].slot] = id;
    if (id === this.current) return true;
    this.current = id;
    this._reloadT = 0; this.reloading = 0;
    this.aimToggle = false; this.bloom = 0; this._queued = 0;
    this.cool = Math.max(this.cool, 0.25); // a moment to bring it up
    this._dirty = true;
    if (WEAPONS[id].ammo && WEAPONS[id].slot !== 'throw') this.game.audio?.sfx('bolt', 0.5);
    return true;
  }

  cycle(dir) {
    const list = this.owned, n = list.length;
    if (n < 2) return;
    const i = list.indexOf(this.current);
    this.equip(list[(i + (dir < 0 ? -1 : 1) + n) % n]);
  }

  selectSlot(slotId) {
    const w = this.slotWeapon(slotId);
    if (!w) return false;
    if (w !== this.current) return this.equip(w);
    // Already in hand: the next one in the same slot.
    const list = this.owned.filter(id => WEAPONS[id].slot === slotId);
    if (list.length > 1) this.equip(list[(list.indexOf(w) + 1) % list.length]);
    return true;
  }

  openWheel() {
    if (!this.active || this.wheelOpen) return;
    this.wheelOpen = true;
    this.game.timeScale = 0.25;
  }

  closeWheel(id) {
    if (!this.wheelOpen) { if (id) this.equip(id); return; }
    this.wheelOpen = false;
    this.game.timeScale = 1;
    if (id) this.equip(id);
    // The tap or click that chose was not a shot, nor is a trigger still held from before.
    this.game.input?.events?.delete?.('attack');
    this._swallow = 0.2; this._needRelease = true;
  }

  /** A weapon (and its ammo: a found gun comes loaded, with `start` rounds more). Returns the rounds of reserve added. */
  give(id, ammo) {
    const w = WEAPONS[id];
    if (!w || id === 'fist') return 0;
    if (w.slot === 'throw') return this.giveAmmo('frag', ammo ?? w.start ?? 1); // carried as a count
    const fresh = !this.inv.has(id);
    if (fresh && w.ammo) this.mags[id] = w.mag;
    const added = w.ammo ? this.giveAmmo(w.ammo, ammo ?? w.start ?? 0) : 0;
    if (fresh) {
      this.inv.add(id); this._changed();
      // Empty-handed (or with a pan): a new gun comes out at once.
      if (w.ammo && (this.current === 'fist' || this.current === 'pan')) this.equip(id);
    }
    this._dirty = true;
    return added;
  }

  /** Rounds of a calibre, up to what can be carried. Returns how many were taken. */
  giveAmmo(type, n) {
    const a = AMMO[type];
    if (!a || !(n > 0)) return 0;
    const before = this.ammo[type] || 0, after = Math.min(a.max, before + n);
    this.ammo[type] = after;
    if (type === 'frag' && after > 0 && !this.inv.has('grenade')) { this.inv.add('grenade'); this._changed(); }
    this._dirty = true;
    return after - before;
  }

  /** The armoury cheat: every weapon, every magazine full, every calibre to the brim. */
  giveAll() {
    for (const id of ORDER) {
      const w = WEAPONS[id];
      this.inv.add(id);
      if (w.ammo && w.slot !== 'throw') this.mags[id] = w.mag;
    }
    for (const k in AMMO) this.ammo[k] = AMMO[k].max;
    this._changed();
  }

  reload() {
    const w = this.def;
    if (!w.ammo || w.slot === 'throw' || this._reloadT > 0) return false;
    if ((this.mags[this.current] || 0) >= w.mag || this.reserve <= 0) return false;
    this._reloadT = w.reload; this.reloading = 0.001; this._queued = 0;
    this.game.audio?.sfx('reload');
    return true;
  }

  _finishReload() {
    const w = this.def, have = this.mags[this.current] || 0, n = Math.min(w.mag - have, this.reserve);
    this.mags[this.current] = have + n;
    this.ammo[w.ammo] -= n;
    this._reloadT = 0; this.reloading = 0; this._dirty = true;
  }

  // ---------------------------------------------------------------- every frame
  update(dt, input) {
    const g = this.game, P = g.player;
    this.cool -= dt; this._clickT -= dt; this._dt = dt;
    const def = this.def, onFoot = P.state === 'foot', active = onFoot && !g.cutscene && !g.respawning;
    // Just on foot (out of a vehicle, a scene, a respawn): a trigger held from before (RT is the
    // throttle at the wheel) waits to be let go before it fires anything.
    if (active && this._wasActive === false) this._needRelease = true;
    this._wasActive = active;
    if (!active && this.wheelOpen) this.closeWheel();
    if (!this.wheelOpen && g.timeScale !== undefined && g.timeScale !== 1) g.timeScale = 1;
    if (!onFoot) { this.aimToggle = false; if (this._reloadT > 0) { this._reloadT = 0; this.reloading = 0; } }
    // While the wheel is up, next and previous move its highlight (the wheel reads them), and nothing fires.
    if (active && !this.wheelOpen) {
      if (input.pressed('weaponNext')) this.cycle(1);
      if (input.pressed('weaponPrev')) this.cycle(-1);
      for (let k = 0; k < SLOT_EVENTS.length; k++) if (input.pressed(SLOT_EVENTS[k])) this.selectSlot(SLOTS[k].id);
      if (input.pressed('aimToggle')) this.aimToggle = !this.aimToggle;
      // R reloads on foot (it is the radio in a vehicle); a gamepad's RB is the radio and the wheel, B reloads.
      const r = input.pressed('reload'), radio = input.mode !== 'gamepad' && input.pressed('radio');
      if (r || radio) this.reload();
    }
    const w = this.def, gun = Boolean(w.ammo) && w.slot !== 'throw', thrower = w.slot === 'throw';
    // The first gun out (outside the story's scenes): rules.js says once how to shoot and pick.
    if (active && gun && !this.blocked && !g.missions?.active && !g.save?.data?.seenGunHelp) g.onGunOut?.();
    this.aiming = active && (gun || thrower) && !this.blocked && Boolean(input.state.aim || this.aimToggle);
    this.scoped = this.aiming && (w.scope || 0) > 0;
    if ((this._holyT -= dt) <= 0) { this._holyT = 0.25; this.blocked = this._holy() ? 'holy' : null; }
    this._aimRay(this._o, this._d);
    this.aimPitch = Math.asin(clamp(this._d.y, -1, 1)); this.aimYaw = Math.atan2(this._d.x, this._d.z);
    // Reloading.
    if (this._reloadT > 0) {
      this._reloadT -= dt;
      this.reloading = clamp(1 - this._reloadT / w.reload, 0.001, 1);
      if (this._reloadT <= 0) this._finishReload();
    }
    if (this._boltT > 0 && (this._boltT -= dt) <= 0 && this.mag > 0 && w.bolt) g.audio?.sfx('bolt');
    // The cone: tight aimed, wide from the hip, wider on the move or in the air, and it blooms under fire.
    this.bloom = Math.max(0, this.bloom - dt * 0.12);
    const base = (this.aiming ? w.spreadAim : w.spreadHip) || 0, move = !P.onGround && onFoot ? 2.2 : P.speed > 0.6 ? (P.sprinting ? 1.8 : 1.35) : 1;
    this.spread = base * move + this.bloom;
    // The trigger.
    const edge = input.pressed('attack'), down = Boolean(input.state.attackHeld);
    if (!down) this._needRelease = false;
    const held = down && !this._needRelease;
    if (this._swallow > 0 || this.wheelOpen) { this._swallow -= dt; this._queued = 0; }
    else if (active && gun) {
      if (edge) this._queued = 0.18; // a tap just before the gun is ready still fires
      // Held: automatic weapons keep firing; on a phone a semi-automatic repeats a little slower.
      const auto = w.auto || (held && input.mode === 'touch' && !w.bolt && this.game.time - this.lastShotT > interval(w) * 1.6);
      if ((this._queued > 0 || (held && auto)) && this.cool <= 0 && this._reloadT <= 0) {
        if (!this.blocked && this.mag > 0 && this._mustTurn()) {
          // From the hip with the body turned away (walking toward the camera): turn first, so the
          // shot leaves the gun's muzzle toward the aim, not back through the body.
          this._faceT = g.time; this._queued = Math.max(this._queued, dt * 1.5);
        } else {
          this._queued = 0;
          if (this.blocked) this._refuse();
          else if (this.mag <= 0) { if (!this.reload()) this._click(); }
          else this._fire(input);
        }
      }
      this._queued -= dt;
    } else if (active && thrower && edge && this.cool <= 0) {
      if (this.blocked) this._refuse(); else this.throwGrenade();
    }
    if (active && !this.wheelOpen && input.pressed('grenade') && this.cool <= 0 && (this.ammo.frag || 0) > 0 && !this.blocked) this.throwGrenade();
    this._grenades(dt);
    this._lootUpdate(dt, onFoot);
    this._airdropUpdate(dt);
    if ((this._blipT -= dt) <= 0) { this._blipT = 0.5; this._refreshBlips(); }
    if (this._dirty && (this._saveT -= dt) <= 0) { this._saveT = 1.5; this._dirty = false; g.save?.set?.('inventory', this.toSave()); }
  }

  _holy() {
    const p = this.game.player?.pos;
    return p ? this.inHoly(p.x, p.z) : false;
  }

  /** Inside a place of worship (NO_FIRE): no gun goes off there, nobody's, and no bullet or blast lands there. */
  inHoly(x, z) {
    for (const s of this.zones) if ((s.x - x) ** 2 + (s.z - z) ** 2 < s.r2) return true;
    return false;
  }

  /**
   * A hip shot with the body facing well away from the aim waits for the turn (player.js turns
   * them while `facing`), a third of a second at most.
   */
  _mustTurn() {
    const g = this.game, P = g.player, face = g.camera?.facing;
    if (this.aiming || face === undefined || !Number.isFinite(P?.heading)) return false;
    if (Math.abs(wrapAngle(face - P.heading)) <= TURN_OK) return false;
    if (g.time - this._faceT > 0.1) this._turnT = g.time; // a fresh wait
    return g.time - this._turnT < 0.3;
  }

  /** A trigger pulled where guns are not fired: a dry click, and the HUD says why. */
  _refuse() { this._click(); this.cool = 0.3; }
  _click() { if (this._clickT <= 0) { this._clickT = 0.25; this.game.audio?.sfx('empty'); } }

  /**
   * Where the crosshair points: from the camera, through the middle of the screen (its quaternion:
   * set by lookAt at once, unlike matrixWorld, which waits for a render). Without a camera (tests,
   * before the first frame), from the player's chest along their heading.
   */
  _aimRay(o, d) {
    const g = this.game, cam = g.camera3, q = cam?.quaternion;
    if (q && cam.position) {
      o.x = cam.position.x; o.y = cam.position.y; o.z = cam.position.z;
      d.x = -2 * (q.x * q.z + q.w * q.y); d.y = -2 * (q.y * q.z - q.w * q.x); d.z = -(1 - 2 * (q.x * q.x + q.y * q.y));
    } else {
      const P = g.player, hd = P?.heading || 0;
      o.x = P?.x || 0; o.y = (P?.y || 0) + 1.4; o.z = P?.z || 0;
      d.x = Math.sin(hd); d.y = 0; d.z = Math.cos(hd);
    }
    const l = Math.hypot(d.x, d.y, d.z) || 1;
    d.x /= l; d.y /= l; d.z /= l;
  }

  /** The gun's muzzle in the world: WeaponFx knows where the mesh is; else a hand's length in front of the right shoulder. */
  _muzzle(m) {
    if (this.game.weaponFx?.muzzle?.(m)) return m;
    const P = this.game.player, h = P.heading || 0, fx = Math.sin(h), fz = Math.cos(h);
    m.x = P.x + fx * 0.55 - fz * 0.2; m.y = (P.y || 0) + 1.35; m.z = P.z + fz * 0.55 + fx * 0.2;
    return m;
  }

  /** A random direction inside a cone of half-angle s around d (uniform over the disc it covers). */
  _cone(d, s, out) {
    if (!(s > 0)) { out.x = d.x; out.y = d.y; out.z = d.z; return out; }
    // Two directions square to d and to each other.
    let ux = d.z, uy = 0, uz = -d.x;
    if (ux * ux + uz * uz < 1e-6) { ux = 1; uz = 0; }
    const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
    const vx = d.y * uz - d.z * uy, vy = d.z * ux - d.x * uz, vz = d.x * uy - d.y * ux;
    const r = Math.tan(s * Math.sqrt(Math.random())), a = Math.random() * Math.PI * 2, c = Math.cos(a) * r, sn = Math.sin(a) * r;
    out.x = d.x + ux * c + vx * sn; out.y = d.y + uy * c + vy * sn; out.z = d.z + uz * c + vz * sn;
    const l = Math.hypot(out.x, out.y, out.z);
    out.x /= l; out.y /= l; out.z /= l;
    return out;
  }

  /** Bullets the story never lets you hurt: its actors that are not a fight's targets. */
  _protected(p) { return p.mission && !p.needHits; }

  /** How tall someone is to a bullet, from the feet: standing, crouched, or lying. */
  _height(p) { return p.state === 'down' || p.state === 'dive' ? 0.45 : p.state === 'cower' || p.state === 'getup' ? 1.15 : 1.78 * (p.h.outfit?.scale || 1); }

  /** Someone a bullet can hit: alive and not the story's own (on the ground too: a shot there knocks them out, as in GTA). */
  _target(p) { return !(p.state === 'dead' || this._protected(p) || !p.h || p.h.visible === false); }

  /** Someone aim assist bends toward: up on their feet (never a body on the ground), unless a story fight wants every hit. */
  _assistable(p) { return this._target(p) && ((p.state !== 'down' && p.state !== 'getup') || (p.mission && p.needHits)); }

  /**
   * Bend the aim toward the nearest valid person within ~3° of it (touch and gamepad players), if
   * nothing solid is in between. Not when the crosshair is already on someone (a head stays a
   * head), and the reach narrows with a zoomed view (in an 8x scope 3° is most of the lens). The
   * bend goes to the nearest point of them to the crosshair, not a fixed chest point. Writes the
   * new direction into d; true when it bent.
   */
  _assist(o, d, range, t0) {
    const g = this.game, peds = g.peds?.list;
    if (!peds) return false;
    const raw = this.trace(o.x, o.y, o.z, d.x, d.y, d.z, range, this._hit, t0);
    if (raw.kind === 'ped') return false;
    // On a car: only someone in front of it is the better guess.
    const far = raw.kind === 'vehicle' ? raw.t : range;
    const base = g.camera?.fovBase || 62, fov = g.camera3?.fov || base, reach = ASSIST * clamp(fov / base, 0.12, 1);
    const hl2 = d.x * d.x + d.z * d.z;
    let best = null, bestA = reach, bx = 0, by = 0, bz = 0;
    for (const p of peds) {
      if (!this._assistable(p)) continue;
      const h = p.h, tx = h.x - o.x, tz = h.z - o.z;
      if (Math.abs(tx) > far || Math.abs(tz) > far) continue;
      // The crosshair's height where it passes them, kept on their body.
      const s = hl2 > 1e-9 ? (tx * d.x + tz * d.z) / hl2 : 0, foot = h.y || 0;
      const ty = clamp(o.y + d.y * s, foot + 0.25, foot + this._height(p) - 0.08) - o.y;
      const l = Math.hypot(tx, ty, tz);
      if (l > far || l < t0) continue;
      const a = Math.acos(clamp((tx * d.x + ty * d.y + tz * d.z) / l, -1, 1));
      // Someone already fighting (or an officer) wins a near tie.
      const score = a * (p.state === 'fight' || p.cop ? 0.75 : 1);
      if (score >= bestA || this.inHoly(h.x, h.z)) continue;
      best = p; bestA = score; bx = tx / l; by = ty / l; bz = tz / l;
    }
    if (!best) return false;
    const was = this._dir; was.x = d.x; was.y = d.y; was.z = d.z;
    d.x = bx; d.y = by; d.z = bz;
    const hit = this.trace(o.x, o.y, o.z, d.x, d.y, d.z, range, this._hit, t0);
    if (hit.ped === best) return true;
    d.x = was.x; d.y = was.y; d.z = was.z;
    return false;
  }

  /** Where a ray from o along unit d enters vehicle v's box (from the road up to its roof) between t0 and t1; Infinity if it misses. */
  _boxHit(v, ox, oy, oz, dx, dy, dz, t0, t1) {
    const c = Math.cos(v.heading || 0), s = Math.sin(v.heading || 0), ex = ox - v.x, ez = oz - v.z;
    const lax = ex * c - ez * s, laz = ex * s + ez * c, ldx = dx * c - dz * s, ldz = dx * s + dz * c;
    const y0 = v.y || 0, H = v.spec?.H || 1.6;
    let ta = t0, tb = t1;
    if (Math.abs(ldx) < 1e-9) { if (Math.abs(lax) > v.hw) return Infinity; } else { let a = (-v.hw - lax) / ldx, b = (v.hw - lax) / ldx; if (a > b) { const k = a; a = b; b = k; } ta = Math.max(ta, a); tb = Math.min(tb, b); if (ta > tb) return Infinity; }
    if (Math.abs(ldz) < 1e-9) { if (Math.abs(laz) > v.hd) return Infinity; } else { let a = (-v.hd - laz) / ldz, b = (v.hd - laz) / ldz; if (a > b) { const k = a; a = b; b = k; } ta = Math.max(ta, a); tb = Math.min(tb, b); if (ta > tb) return Infinity; }
    if (Math.abs(dy) < 1e-9) { if (oy < y0 || oy > y0 + H) return Infinity; } else { let a = (y0 - oy) / dy, b = (y0 + H - oy) / dy; if (a > b) { const k = a; a = b; b = k; } ta = Math.max(ta, a); tb = Math.min(tb, b); if (ta > tb) return Infinity; }
    return ta;
  }

  /**
   * The first thing a ray from o along unit d meets between t0 and maxT: a wall, post or tree (the
   * colliders, in 24 m pieces), the ground, a flyover's deck or the river, a person (an upright
   * cylinder, the top 28 cm the head; lying, a low wide one), or a vehicle (its box). Never the
   * player, nor the vehicle they are in or a mission's vital one. Fills `out` and returns it;
   * out.kind is null when nothing was hit.
   */
  trace(ox, oy, oz, dx, dy, dz, maxT, out, t0 = 0) {
    const g = this.game, col = g.colliders;
    let best = maxT, kind = null;
    out.ped = null; out.vehicle = null; out.head = false;
    if (col?.raycastSolid) {
      for (let a = t0; a < maxT; a += SEG) {
        const b = Math.min(maxT, a + SEG);
        const t = col.raycastSolid(ox + dx * a, oy + dy * a, oz + dz * a, ox + dx * b, oy + dy * b, oz + dz * b);
        if (t < 1) { best = a + (b - a) * t; kind = 'wall'; break; }
      }
    }
    const tg = this._groundHit(ox, oy, oz, dx, dy, dz, t0, best);
    if (tg < best) { best = tg; kind = this._water ? 'water' : 'ground'; }
    // People.
    const A = dx * dx + dz * dz;
    for (const p of g.peds?.list || []) {
      if (!this._target(p) || A < 1e-9) continue;
      const h = p.h, lying = p.state === 'down', r = lying ? 0.55 : 0.35, base = h.y || 0, top = base + this._height(p);
      const px = ox - h.x, pz = oz - h.z, B = px * dx + pz * dz, C = px * px + pz * pz - r * r, disc = B * B - A * C;
      if (disc < 0) continue;
      const sq = Math.sqrt(disc);
      let te = (-B - sq) / A;
      const tx = (-B + sq) / A;
      if (tx < t0 || te > best) continue;
      te = Math.max(te, t0);
      const ye = oy + dy * te, yx = oy + dy * tx;
      if ((ye > top && yx > top) || (ye < base && yx < base)) continue;
      const t = ye > top ? te + (tx - te) * (ye - top) / (ye - yx) : ye < base ? te + (tx - te) * (base - ye) / (yx - ye) : te;
      if (t >= best) continue;
      best = t; kind = 'ped'; out.ped = p; out.vehicle = null;
      out.head = !lying && p.state !== 'getup' && p.state !== 'cower' && oy + dy * t > top - 0.28;
    }
    // Vehicles.
    const P = g.player;
    for (const v of g.vehicles?.list || []) {
      if (v === P?.vehicle || v.vital || v.removed || !(v.hw > 0)) continue;
      const ta = this._boxHit(v, ox, oy, oz, dx, dy, dz, t0, best);
      if (ta >= best) continue;
      best = ta; kind = 'vehicle'; out.vehicle = v; out.ped = null; out.head = false;
    }
    out.t = best; out.kind = kind;
    out.x = ox + dx * best; out.y = oy + dy * best; out.z = oz + dz * best;
    return out;
  }

  /**
   * Is the straight line from a to b clear for a bullet: no wall, post, trunk or low wall (as the
   * player's own bullets meet them) and no vehicle but `skip`? For an officer's sight and shots.
   */
  clearLine(ax, ay, az, bx, by, bz, skip = null) {
    const g = this.game, col = g.colliders, ex = bx - ax, ey = by - ay, ez = bz - az, L = Math.hypot(ex, ey, ez);
    if (L < 1e-6) return true;
    const ux = ex / L, uy = ey / L, uz = ez / L;
    if (col?.raycastSolid) {
      for (let a = 0; a < L; a += SEG) {
        const b = Math.min(L, a + SEG);
        if (col.raycastSolid(ax + ux * a, ay + uy * a, az + uz * a, ax + ux * b, ay + uy * b, az + uz * b) < 1) return false;
      }
    } else if (col?.raycast && col.raycast(ax, ay, az, bx, by, bz, 0.05) < 0.999) return false;
    const P = g.player;
    for (const v of g.vehicles?.list || []) {
      if (v === skip || v === P?.vehicle || v.removed || !(v.hw > 0)) continue;
      if (Math.abs(v.x - ax) > L + 6 && Math.abs(v.x - bx) > L + 6) continue;
      if (this._boxHit(v, ax, ay, az, ux, uy, uz, 0.3, L - 0.3) < Infinity) return false;
    }
    return true;
  }

  /** Is there a flyover near (x, z)? Looked up once a frame at most: bullets then look for its deck. */
  _decksNear(x, z) {
    const g = this.game, net = g.net;
    if (!net?.nearest || !net.raised?.length) return false;
    if (this._deckT !== g.time) { this._deckT = g.time; this._decks = Boolean(net.nearest(x, z, 120, this._nq, this._raised)); }
    return this._decks;
  }

  /**
   * Where the ray meets the ground, a flyover's deck or the river's surface, sampled only over the
   * stretch low enough to meet them (below the station platforms, or near a flyover below its deck),
   * then refined. A river bridge is the street (net.surfaceAt); a deck is a slab, met from above or
   * from below. Infinity if it meets nothing. Sets this._water.
   */
  _groundHit(ox, oy, oz, dx, dy, dz, t0, t1) {
    const g = this.game, city = g.city, net = g.net, decks = this._decksNear(ox, oz);
    this._water = false;
    const cap = decks ? DECK_TOP : GROUND_TOP;
    let a = t0, b = t1;
    if (dy < 0) a = Math.max(a, (cap - oy) / dy);
    else if (oy + dy * a > cap) return Infinity;
    if (dy > 0) b = Math.min(b, (cap - oy) / dy);
    if (!(a < b)) return Infinity;
    const surf = net?.surfaceAt;
    const solid = (x, y, z) => {
      let gy = surf ? net.surfaceAt(x, z, Math.min(y, 0.3)) : city ? city.groundHeight(x, z) : 0;
      if (gy < WATER_Y) gy = WATER_Y;
      if (y <= gy) return true;
      if (!decks) return false;
      const D = net.deckOver(x, z);
      return D > 0.5 && y <= D + 0.02 && y >= D - DECK_SLAB;
    };
    const n = Math.min(160, Math.max(1, Math.ceil((b - a) / 0.75))), step = (b - a) / n;
    let prev = a;
    for (let i = 0; i <= n; i++) {
      const t = a + step * i;
      if (!solid(ox + dx * t, oy + dy * t, oz + dz * t)) { prev = t; continue; }
      // Between the last sample in the open and this one in the ground (or the deck).
      let lo = prev, hi = t;
      for (let k = 0; k < 6; k++) { const m = (lo + hi) / 2; if (!solid(ox + dx * m, oy + dy * m, oz + dz * m)) lo = m; else hi = m; }
      const x = ox + dx * hi, z = oz + dz * hi;
      this._water = city ? oy + dy * hi < WATER_Y + 0.05 && city.groundHeight(x, z) < WATER_Y : false;
      return hi;
    }
    return Infinity;
  }

  // ---------------------------------------------------------------- shooting
  _fire(input) {
    const g = this.game, P = g.player, w = this.def, id = this.current;
    this.mags[id]--;
    this._dirty = true;
    // The next shot is due one interval after this one was (not after the frame it fell in): at
    // 30 or 60 frames a second each gun keeps its own rate. Never banked from idle time.
    this.cool = Math.max(this.cool, -this._dt) + Math.max(interval(w), MAX_RATE);
    if (w.bolt) this._boltT = 0.55;
    this.lastShotT = g.time;
    g.save?.stat?.('shots');
    const o = this._o, d = this._d, dir = this._dir, m = this._muzzle(this._m), hit = this._hit;
    this._aimRay(o, d);
    // Skip the stretch between the camera and the player (someone standing behind them is not in the line of fire).
    const t0 = Math.max(0, (P.x - o.x) * d.x + ((P.y || 0) + 1.4 - o.y) * d.y + (P.z - o.z) * d.z - 0.4);
    const range = w.range * 1.5;
    const assisted = (input?.mode === 'touch' || input?.mode === 'gamepad') && this._assist(o, d, range, t0);
    const pellets = Math.min(8, w.pellets || 1), spread = this.spread * (assisted ? 0.5 : 1);
    // Every pellet is traced before any lands: the first one's knock-down must not let the rest
    // pass over the body (or on into someone behind). What each person and vehicle took is added up.
    this._tgN = 0;
    for (let k = 0; k < pellets; k++) {
      this._cone(d, spread, dir);
      this.trace(o.x, o.y, o.z, dir.x, dir.y, dir.z, range, hit, t0);
      this._fromMuzzle(m, hit);
      this._pellet(hit, w, m, dir);
      // A tracer for the first pellet and every other one after it.
      if (k % 2 === 0) g.weaponFx?.shot?.(m.x, m.y, m.z, hit.x, hit.y, hit.z, id);
    }
    let kills = 0, heads = 0, kill = false, head = false, marked = false;
    for (let i = 0; i < this._tgN; i++) {
      const e = this._tg[i], l = Math.hypot(e.dx, e.dz) || 1;
      if (e.ped) {
        const p = e.ped, res = g.peds.shot(p, e.dmg, (e.dx / l) * 3, (e.dz / l) * 3, 'shot'), dead = res === 'dead';
        marked = true;
        if (dead) { kills++; kill = true; }
        if (e.head) { heads++; head = true; }
        // The story's own fights are no crime (as for punches).
        if (!p.mission) this._crime(p, dead ? (p.cop ? 'killCop' : 'killPed') : p.cop ? 'shotCop' : 'shotPed', p.h.x, p.h.z, 80);
      } else {
        const v = e.vehicle;
        g.damageVehicle?.(v, e.dmg * (w.vehicle ?? 1), true);
        if (v.type === 'police' && v.driver && v.driver !== P.human) this._crime(v, 'shotCop', v.x, v.z, 80, true);
      }
      e.ped = null; e.vehicle = null;
    }
    if (marked) { const hm = this._hm; hm.t = g.time; hm.kill = kill; hm.head = head; this.hitMarker = hm; }
    if (kills) g.save?.stat?.('kills', kills);
    if (heads) g.save?.stat?.('headshots', heads);
    // Kick: the view climbs, the cone blooms, the arms jolt.
    g.camera?.kick?.(w.recoil || 0);
    g.camera?.addShake?.(w.pellets ? 0.12 : w.bolt ? 0.1 : 0.02);
    this.bloom = Math.min(0.07, this.bloom + (w.recoil || 0) * (w.auto ? 0.45 : 0.3));
    if (P.human) P.human.recoil = 1;
    g.audio?.sfx(w.sound, 0.9);
    this._noise(P.x, P.z);
  }

  /**
   * The camera sees past a corner the gun is behind (it sits to the right of the shoulder): the
   * first few metres of the line from the muzzle are checked too, and a wall there takes the shot.
   * Not the first 25 cm, so a gun poking into a wall the player hugs still fires.
   */
  _fromMuzzle(m, hit) {
    const col = this.game.colliders;
    if (!col?.raycastSolid) return;
    const ex = hit.x - m.x, ey = hit.y - m.y, ez = hit.z - m.z, L = Math.hypot(ex, ey, ez);
    if (L < 0.3) return;
    const k = Math.min(L, MUZZLE_CHECK) / L, t = col.raycastSolid(m.x, m.y, m.z, m.x + ex * k, m.y + ey * k, m.z + ez * k);
    const s = t * L * k;
    if (t >= 1 || s < 0.25 || s > L - 0.05) return;
    hit.kind = 'wall'; hit.ped = null; hit.vehicle = null; hit.head = false;
    hit.x = m.x + ex * k * t; hit.y = m.y + ey * k * t; hit.z = m.z + ez * k * t; hit.t = s;
  }

  /** One pellet's hit: its puff, and its damage added to what that person or vehicle takes from this shot (none inside a holy place). */
  _pellet(hit, w, m, dir) {
    const fx = this.game.weaponFx;
    if (!hit.kind) return;
    const p = hit.ped, v = hit.vehicle;
    if ((p || v) && this.inHoly(p ? p.h.x : v.x, p ? p.h.z : v.z)) { fx?.impact?.(hit.x, hit.y, hit.z, 'ground'); return; }
    if (!p && !v) { fx?.impact?.(hit.x, hit.y, hit.z, hit.kind); return; }
    fx?.impact?.(hit.x, hit.y, hit.z, p ? 'body' : 'metal');
    const dmg = falloff(w, dist(m.x, m.z, hit.x, hit.z)) * (p && hit.head ? HEADSHOT : 1);
    let e = null;
    for (let i = 0; i < this._tgN; i++) if ((p && this._tg[i].ped === p) || (v && this._tg[i].vehicle === v)) { e = this._tg[i]; break; }
    if (!e) {
      e = this._tg[this._tgN] || (this._tg[this._tgN] = { ped: null, vehicle: null, dmg: 0, head: false, dx: 0, dz: 0 });
      this._tgN++;
      e.ped = p; e.vehicle = v; e.dmg = 0; e.head = false; e.dx = 0; e.dz = 0;
    }
    e.dmg += dmg; e.head ||= hit.head; e.dx += dir.x; e.dz += dir.z;
  }

  /**
   * A crime against victim o (a person or a manned police jeep): reported once, and again only
   * when it gets worse (shot, then knocked out: the difference) or a few seconds on. Every bullet
   * filing its own report made two pistol hits on one man three stars.
   */
  _crime(o, kind, x, z, r, cop = Boolean(o.cop)) {
    const g = this.game, police = g.police;
    if (!police) return;
    const rank = RANK[kind] || 0, since = g.time - (o.crimeT ?? -1e9);
    let heat;
    if (rank > (o.crimeRank || 0) && since < 30) heat = Math.max(0.3, (police.heatOf?.(kind) ?? 1) - (police.heatOf?.(o.crimeKind) ?? 0));
    else if (since > 3) heat = police.heatOf?.(kind);
    else return;
    o.crimeRank = since > 3 ? rank : Math.max(rank, o.crimeRank || 0); o.crimeKind = kind; o.crimeT = g.time;
    police.report(kind, x, z, { cop, r, heat });
  }

  /** A shot rings out at (x, z): people near it run, and a police officer within earshot (or a witness) reports it. */
  _noise(x, z) {
    const g = this.game;
    if (g.time - this._panicT > 0.5) { this._panicT = g.time; g.peds?.gunfire?.(x, z, 40); }
    // Inside a mission the story decides when the police come.
    if (g.missions?.active || g.time - this._shotReportT < 2) return;
    this._shotReportT = g.time;
    const someone = (g.peds?.list || []).some(p => p.state !== 'dead' && Math.abs(p.h.x - x) < 50 && Math.abs(p.h.z - z) < 50);
    g.police?.report('shoot', x, z, { r: HEAR, witness: someone });
  }

  /** The frying pan: a swing at whoever is in front, harder than a punch. Called by the player's punch. */
  swing(player) {
    const g = this.game, peds = g.peds;
    this.lastShotT = g.time;
    g.audio?.sfx('step', 2);
    if (!peds) return null;
    const fx = Math.sin(player.heading), fz = Math.cos(player.heading), reach = WEAPONS.pan.range;
    let best = null, bd = reach;
    for (const p of peds.list) {
      if (p.state === 'dead' || p.state === 'down' || Math.abs((p.h.y || 0) - (player.y || 0)) > 1.5) continue;
      const dx = p.h.x - player.x, dz = p.h.z - player.z, d = Math.hypot(dx, dz);
      if (d > bd || d < 0.01 || (dx * fx + dz * fz) / d < 0.4) continue;
      best = p; bd = d;
    }
    if (!best) return null;
    g.audio?.sfx('pan');
    g.camera?.addShake?.(0.12);
    g.save?.stat?.('punches');
    if (this._protected(best)) { peds.knock(best, fx * 4, fz * 4, 1.8, 'punch'); return best; }
    const res = peds.shot(best, WEAPONS.pan.damage * (player.combo === 2 ? 1.25 : 1), fx * 4.5, fz * 4.5, 'punch');
    if (res === 'dead') { const hm = this._hm; hm.t = g.time; hm.kill = true; hm.head = false; this.hitMarker = hm; g.save?.stat?.('kills'); }
    if (!best.mission) this._crime(best, res === 'dead' ? (best.cop ? 'killCop' : 'killPed') : best.cop ? 'hitCop' : 'punch', player.x, player.z, 55);
    return best;
  }

  // ---------------------------------------------------------------- grenades
  throwGrenade() {
    const g = this.game, P = g.player;
    if ((this.ammo.frag || 0) <= 0) return false;
    const o = this._o, d = this._d;
    this._aimRay(o, d);
    const h = P.heading || 0, sp = this.aiming ? 17 : 14;
    // Out of the right hand, along the aim, lobbed a little higher than it looks.
    this.grenades.push({
      x: P.x + Math.sin(h) * 0.4 - Math.cos(h) * 0.15, y: (P.y || 0) + 1.7, z: P.z + Math.cos(h) * 0.4 + Math.sin(h) * 0.15,
      vx: d.x * sp, vy: d.y * sp + 4, vz: d.z * sp, t: WEAPONS.grenade.fuse, bounced: 0,
    });
    this.ammo.frag--;
    this.cool = interval(WEAPONS.grenade);
    this.lastShotT = g.time;
    if (P.human) P.human.recoil = 1;
    g.audio?.sfx('throw');
    if (this.ammo.frag <= 0) {
      this.inv.delete('grenade'); this._changed();
      if (this.current === 'grenade') { this.current = 'fist'; this.equip(this.owned.find(id => WEAPONS[id].ammo && id !== 'grenade') || 'fist'); }
    }
    this._dirty = true;
    return true;
  }

  /** What a grenade lands on at (x, z) from height y; this._wet says when it is the river's surface. */
  _floorAt(x, z, y) {
    const g = this.game;
    const gy = g.net?.surfaceAt ? g.net.surfaceAt(x, z, y) : g.city?.groundHeight(x, z) ?? 0;
    this._wet = gy < WATER_Y;
    return this._wet ? WATER_Y : gy;
  }

  _grenades(dt) {
    const L = this.grenades, col = this.game.colliders;
    for (let i = L.length - 1; i >= 0; i--) {
      const gr = L[i];
      gr.t -= dt;
      if (gr.wet) {
        // In the river: it sinks, drifting to a stop, and goes off down there.
        const f = Math.exp(-3 * dt);
        gr.vx *= f; gr.vz *= f; gr.vy = -0.9;
        gr.y = Math.max(WATER_Y - 1.6, gr.y + gr.vy * dt); gr.x += gr.vx * dt; gr.z += gr.vz * dt;
        if (gr.t <= 0) { L.splice(i, 1); this.blast(gr.x, gr.y, gr.z, true); }
        continue;
      }
      const steps = clamp(Math.ceil(Math.hypot(gr.vx, gr.vy, gr.vz) * dt / 0.3), 1, 6), h = dt / steps;
      for (let s = 0; s < steps; s++) {
        gr.vy -= 15 * h;
        const nx = gr.x + gr.vx * h, ny = gr.y + gr.vy * h, nz = gr.z + gr.vz * h;
        // Off a wall: back the way it came, much slower.
        const t = col?.raycastSolid ? col.raycastSolid(gr.x, gr.y, gr.z, nx, ny, nz) : 1;
        if (t < 1) { gr.x += (nx - gr.x) * t * 0.9; gr.z += (nz - gr.z) * t * 0.9; gr.y += (ny - gr.y) * t; gr.vx *= -0.35; gr.vz *= -0.35; gr.vy *= 0.6; continue; }
        gr.x = nx; gr.y = ny; gr.z = nz;
        const floor = this._floorAt(gr.x, gr.z, gr.y);
        if (this._wet && gr.y < floor + 0.07) {
          // Into the Godavari: a splash, no bounce off the water as off a road.
          gr.wet = true; gr.y = floor - 0.05; gr.vx *= 0.3; gr.vz *= 0.3;
          this.game.effects?.splash?.(gr.x, gr.z);
          break;
        }
        if (gr.y < floor + 0.07) {
          gr.y = floor + 0.07;
          if (gr.vy < -2) { gr.vy = -gr.vy * 0.35; gr.vx *= 0.6; gr.vz *= 0.6; gr.bounced++; }
          else { gr.vy = 0; const f = Math.exp(-4 * h); gr.vx *= f; gr.vz *= f; }
        }
      }
      if (!gr.wet && gr.t <= 0) { L.splice(i, 1); this.blast(gr.x, gr.y, gr.z); }
    }
  }

  /**
   * A grenade goes off at (x, y, z): the explosion, people thrown and hurt (knocked out close in),
   * cars damaged and shoved, the player hurt if near, all on its own level, and a crime.
   */
  blast(x, y, z, underwater = false) {
    const g = this.game, P = g.player, pos = P.pos || P, w = WEAPONS.grenade, R = w.blast;
    const dP = dist(pos.x, pos.z, x, z);
    if (underwater) {
      // Under the river it only throws up the water: a dull thud, people on the bank startled, nobody hurt.
      g.effects?.splash?.(x, z); g.effects?.splash?.(x + 0.6, z - 0.4);
      g.audio?.sfx('explosion', 0.3 / (1 + dP / 30));
      g.camera?.addShake?.(clamp(0.4 - dP / 60, 0, 0.4));
      g.peds?.gunfire?.(x, z, 30);
      return;
    }
    // The fireball sits on whatever the grenade lies on (its glow on the road, not under it).
    g.effects?.explosion?.(x, y + 0.43, z, y - 0.07);
    g.audio?.sfx('explosion', 1 / (1 + dP / 30));
    g.camera?.addShake?.(clamp(1.2 - dP / 40, 0, 1.2));
    const level = oy => Math.abs((oy || 0) - y) < 3;
    if (!P.vehicle && dP < R && level(P.y) && (P.state === 'foot' || P.state === 'down')) {
      const k = (3 + 6 * (1 - dP / R)) / Math.max(dP, 0.5);
      P.damage?.((R - dP) * 12, 'explosion');
      P.knockDown?.((pos.x - x) * k, (pos.z - z) * k, 1.5);
    }
    let kills = 0;
    // Nobody inside a holy place is hurt by a grenade thrown in from outside it.
    for (const p of g.peds?.list || []) {
      if (p.state === 'dead' || !level(p.h.y) || this.inHoly(p.h.x, p.h.z)) continue;
      const dx = p.h.x - x, dz = p.h.z - z, pd = Math.max(0.5, Math.hypot(dx, dz));
      if (pd > R + 1) continue;
      const k = (3 + 9 * (1 - pd / (R + 1))) / pd;
      if (this._protected(p)) { g.peds.knock(p, dx * k, dz * k, 3, 'explosion'); continue; }
      const res = g.peds.shot(p, w.damage * (1 - pd / (R + 1)), dx * k, dz * k, 'explosion');
      if (res === 'dead') kills++;
      // Hurting people is a crime in a mission too (as a bullet's or a pan's is); the story's own are not.
      if (!p.mission && res) this._crime(p, res === 'dead' ? (p.cop ? 'killCop' : 'killPed') : p.cop ? 'shotCop' : 'shotPed', x, z, HEAR);
    }
    for (const v of g.vehicles?.list || []) {
      if (v === P.vehicle || v.vital || v.removed || !level(v.y) || this.inHoly(v.x, v.z)) continue;
      const od = dist(v.x, v.z, x, z);
      if (od > 9) continue;
      const k = (9 - od) * 1.2;
      g.damageVehicle?.(v, (9 - od) * 60, true);
      if (v.vx !== undefined) { v.vx += (v.x - x) / Math.max(od, 0.5) * k; v.vz += (v.z - z) / Math.max(od, 0.5) * k; }
    }
    if (kills) { g.save?.stat?.('kills', kills); const hm = this._hm; hm.t = g.time; hm.kill = true; hm.head = false; this.hitMarker = hm; }
    // The bang itself: the story decides when the police come.
    if (!g.missions?.active) g.police?.report('blast', x, z, { r: HEAR * 1.5 });
    g.peds?.gunfire?.(x, z, 60);
  }

  // ---------------------------------------------------------------- loot and air drops
  _lootUpdate(dt, onFoot) {
    const g = this.game, P = g.player;
    for (let i = this.loot.length - 1; i >= 0; i--) {
      const c = this.loot[i];
      if (c.taken) {
        // Back, with fresh contents, once its time is up and nobody is watching it appear.
        if (c.kind === 'crate' && g.time > c.respawnAt && dist(c.x, c.z, P.x, P.z) > 60) {
          c.gen++; roll(LOOT_TABLE, rng(hash2(c.i * 31 + 5, c.gen)), c); c.taken = false;
        }
        continue;
      }
      if (!onFoot || g.respawning || Math.abs(c.x - P.x) > PICKUP || Math.abs(c.z - P.z) > PICKUP || Math.abs(c.y - (P.y || 0)) > 1.6) continue;
      if (this.take(c) && c.kind === 'airdrop') this.loot.splice(i, 1);
    }
  }

  /** Pick a crate up: its weapon or ammo, a toast saying what it was. False (and left) if nothing more can be carried. */
  take(c) {
    const g = this.game;
    let msg;
    if (c.id) {
      const w = WEAPONS[c.id], had = this.inv.has(c.id), added = this.give(c.id, c.n);
      if (had && !added) return this._full();
      msg = w.slot === 'throw' ? `${w.name} ×${added}` : had ? `+${added} ${AMMO[w.ammo]?.name ?? ''}` : `${w.name}${added ? ` + ${added} ${AMMO[w.ammo].name}` : ''}`;
    } else {
      const added = this.giveAmmo(c.ammo, c.n);
      if (!added) return this._full();
      msg = `+${added} ${AMMO[c.ammo].name}`;
    }
    c.taken = true; c.respawnAt = g.time + RESPAWN;
    g.hud?.toast?.(`<b>${msg}</b>`, 2.5);
    g.audio?.sfx('pickup');
    if (c.kind === 'airdrop' && this.airdrop?.crate === c) { this.airdrop.taken = true; this.airdrop.smoke = Math.min(this.airdrop.smoke || 0, 4); }
    this._blipT = 0; this._saveT = 0;
    return true;
  }

  _full() {
    const g = this.game;
    if (g.time - this._fullT > 6) { this._fullT = g.time; g.hud?.toast?.('You can\'t carry any more of that.', 2); }
    return false;
  }

  _airdropUpdate(dt) {
    const g = this.game, a = this.airdrop;
    if (!g.missions?.active && !g.cutscene && !g.respawning && (this.airdropT -= dt) <= 0) this.airdropT = this.dropNow() ? AIRDROP_EVERY : 20;
    if (!a) return;
    a.t += dt;
    if (!a.landed) {
      a.y = Math.max(a.ground, a.y - DROP_SPEED * dt);
      if (a.y <= a.ground) {
        a.landed = true;
        a.crate = roll(AIRDROP_TABLE, rng(hash2(Math.round(a.x), Math.round(a.z))), { x: a.x, y: a.ground, z: a.z, id: null, ammo: null, n: 0, taken: false, kind: 'airdrop' });
        a.crate.n *= 2; // a care package comes well stocked
        this.loot.push(a.crate);
        this._blipT = 0;
      }
    } else {
      // Red smoke (WeaponFx draws it) for a minute and a half, or a few seconds once opened; then false.
      if (a.smoke !== false && (a.smoke -= dt) <= 0) a.smoke = false;
      if (a.taken && a.smoke === false) this.airdrop = null;
    }
  }

  /** A care package comes down by parachute 150-350 m away, on a street. False if there was nowhere to put it. */
  dropNow() {
    const g = this.game, net = g.net, P = g.player.pos || g.player;
    if (!net) return false;
    const ok = road => !net.raised[road] && !net.bridge[road];
    for (let tries = 0; tries < 12; tries++) {
      const a = Math.random() * Math.PI * 2, d = 150 + Math.random() * 200;
      const n = net.nearest(P.x + Math.cos(a) * d, P.z + Math.sin(a) * d, 50, {}, ok);
      if (!n) continue;
      const off = net.width[n.road] / 2 + 0.6, x = n.x + n.dz * off, z = n.z - n.dx * off;
      if (g.colliders?.blocked(x, z, 1)) continue;
      const ground = g.city?.groundHeight(x, z) ?? 0;
      if (ground < -0.4 || this.zones.some(s => (s.x - x) ** 2 + (s.z - z) ** 2 < s.r2)) continue;
      // The last one, untaken, goes.
      if (this.airdrop?.crate) { const i = this.loot.indexOf(this.airdrop.crate); if (i >= 0) this.loot.splice(i, 1); }
      this.airdrop = { x, z, y: ground + 110, ground, landed: false, smoke: 90, t: 0, crate: null, taken: false };
      g.hud?.toast?.('<b>Air drop!</b> A care package is coming down nearby: follow the red smoke.', 5);
      g.audio?.sfx('wanted', 0.6);
      this._blipT = 0;
      return true;
    }
    return false;
  }

  /** Radar icons: crates within 150 m (one array and its blips, reused). The HUD marks the air drop itself, at any distance. */
  blips() { return this._blips; }

  _refreshBlips() {
    const g = this.game, P = g.player, out = this._blips, pool = this._blipPool;
    if (!P) return;
    out.length = 0;
    const blip = (x, z, label, color) => {
      const b = pool[out.length] || (pool[out.length] = { x: 0, z: 0, kind: 'icon', label: '', color: '' });
      b.x = x; b.z = z; b.label = label; b.color = color;
      out.push(b);
    };
    for (const c of this.loot) {
      if (c.taken || c.kind === 'airdrop' || Math.abs(c.x - P.x) > 150 || Math.abs(c.z - P.z) > 150 || dist(c.x, c.z, P.x, P.z) > 150) continue;
      blip(c.x, c.z, c.id ? '🔫' : '•', c.id ? '#e8b931' : '#c9a227');
    }
  }

  // ---------------------------------------------------------------- save
  toSave() {
    return { weapons: this.owned.filter(id => id !== 'fist'), mags: { ...this.mags }, ammo: { ...this.ammo }, equipped: this.current };
  }

  /** From the save (an old one has none: the starter pistol). */
  fromSave(o) {
    this.inv = new Set(['fist']); this.mags = {}; this.ammo = {};
    if (!o || !Array.isArray(o.weapons)) o = { weapons: ['p92'], mags: { p92: 15 }, ammo: { '9mm': 30 }, equipped: 'fist' };
    for (const id of o.weapons) if (WEAPONS[id] && id !== 'grenade') this.inv.add(id);
    for (const k in AMMO) { const n = Math.floor(Number(o.ammo?.[k]) || 0); if (n > 0) this.ammo[k] = Math.min(AMMO[k].max, n); }
    if (this.ammo.frag > 0) this.inv.add('grenade');
    for (const id of this.inv) { const w = WEAPONS[id]; if (w.ammo && w.slot !== 'throw') this.mags[id] = clamp(Math.floor(Number(o.mags?.[id]) || 0), 0, w.mag); }
    this.current = this.inv.has(o.equipped) ? o.equipped : 'fist';
    this._reloadT = 0; this.reloading = 0; this.aimToggle = false;
    this._owned = null; this._dirty = false;
  }
}

// How bad a crime against one person is: a worse one reports the difference.
const RANK = { punch: 1, shotPed: 2, hitCop: 3, shotCop: 4, killPed: 5, killCop: 6 };
