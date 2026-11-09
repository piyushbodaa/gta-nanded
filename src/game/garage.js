// Your own gaadi: Society Parking at home (claim a car by stopping in a bay), the cars you own
// (saved in save.data.fleet, back in their bays on every load, towed home when left behind),
// key-fob locks with an alarm, a small dealer lot and Bablu Mistri's Jugaad Garage, whose menu
// (ui/garage-menu.js) sells the mods priced here. Every call from other modules is guarded (C6).
import * as THREE from 'three';
import * as VP from '../actors/vehicle-physics.js';
import { VEHICLE_TYPES } from '../actors/vehicle-types.js';
import { HOME, GARAGE, STORY } from './story.js';
import {
  DEALER_PRICES, MODS, PRICES, HORNS, HORN_IDS, NEON, NEON_IDS, STICKERS, PAINTS, MAX_CARS,
  canClaim, tunedSpec, damageK, sanitizeFleet, findBays, valueOf, emptyMods,
} from './garage-data.js';

const TOW_FAR = 300, TOW_AFTER = 180, WRECK_BACK = 180, ALARM_FOR = 8;
const BAY_R = 1.6, CLAIM_HOLD = 1, JUGAAD_R = 3.5;
const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const speed = v => Math.hypot(v.vx || 0, v.vz || 0);
const rupees = n => `₹${Math.round(n).toLocaleString('en-IN')}`;
/** C3 `busy`, kept here so the garage does not depend on mission-state.js being present. */
const busy = g => Boolean(g.missions?.active || g.jobs?.active || g.cutscene || g.respawning || g.retryCard?.open);

export class Garage {
  /** `places` overrides the bays / jugaad / dealer lot (tests); otherwise they are found once, deterministically. */
  constructor(game, places = {}) {
    this.game = game;
    this.owned = []; // runtime records: { ...saved, v, farT, wreckT }
    this.next = 1;
    this.bays = places.bays || this._findBays();
    this.jugaad = places.jugaad || findBays(game.net, game.colliders, GARAGE, 1, [{ ...GARAGE, r: 9 }], 10)[0] || { x: GARAGE.x + 12, z: GARAGE.z, heading: 0 };
    this.dealerLot = places.dealerLot || findBays(game.net, game.colliders, this.jugaad, 3, [{ ...this.jugaad, r: 6 }, { ...GARAGE, r: 9 }], 8);
    this.dealerCars = []; this.dealerDay = -1;
    this.alarmT = 0; this.alarmV = null; this._alarmBeep = 0;
    this._slow = 0; this._sync = 0; this._hold = 0; this._refusedAt = -99; this._jugaadArmed = true;
    this.menuCar = null; // the car on the turntable while the menu is open
    this._static = [
      { x: 0, z: 0, kind: 'icon', label: 'P', color: '#4caf50' },
      { x: this.jugaad.x, z: this.jugaad.z, kind: 'icon', label: 'J', color: '#ffd54f' },
    ];
    if (this.bays.length) { this._static[0].x = this.bays.reduce((s, b) => s + b.x, 0) / this.bays.length; this._static[0].z = this.bays.reduce((s, b) => s + b.z, 0) / this.bays.length; }
    this._blips = []; this._markers = [];
  }

  _findBays() {
    const g = this.game, avoid = [];
    const defs = g.missions?.defs || STORY;
    for (const d of defs) {
      let p = null;
      try { p = typeof d.start === 'function' ? g.missions?.startPoint?.(d) : d.start; } catch { p = null; }
      if (p && Number.isFinite(p.x)) avoid.push({ x: p.x, z: p.z, r: 10 });
    }
    const n = g.net?.nearest?.(HOME.x, HOME.z, 30, {}); // startSpot('continue'): where Continue drops you
    if (n) avoid.push({ x: HOME.x + n.dz * 4, z: HOME.z - n.dx * 4, r: 6 });
    return g.net ? findBays(g.net, g.colliders, HOME, MAX_CARS, avoid) : [];
  }

  // ---- save ----
  fromSave(raw) {
    for (const r of this.owned) if (r.v && !r.v.removed && r.v !== this.game.player?.vehicle) this.game.vehicles?.remove?.(r.v);
    const f = sanitizeFleet(raw);
    this.owned = f.cars.map(c => ({ ...c, v: null, farT: 0, wreckT: 0 }));
    this.next = f.next;
  }
  toSave() {
    const s = this.game.save;
    const cars = this.owned.map(({ v, farT, wreckT, ...rec }) => ({ ...rec, mods: { ...rec.mods } }));
    if (s?.data) { s.data.fleet = { cars, next: this.next }; s.dirty?.(); }
    return { cars, next: this.next };
  }
  _commit() { this.toSave(); this.game.save?.flush?.(); }

  spawnAll() { for (const r of this.owned) if (!this._live(r)) this._spawn(r); }

  _live(r) { return r.v && !r.v.removed && !r.v.exploded ? r.v : null; }
  record(v) { return v?.owned ? this.owned.find(r => r.id === v.owned) || null : null; }
  vehicleById(id) { const r = this.owned.find(o => o.id === id); return r ? this._live(r) || this._spawn(r) : null; }

  _spawn(r, at = this.bays[r.bay]) {
    const g = this.game;
    if (!at || !g.vehicles?.spawn) return null;
    const v = g.vehicles.spawn(r.type, at.x, at.z, at.heading ?? 0, { color: r.color, role: 'owned', driver: false });
    r.v = v; r.farT = 0;
    this.apply(v, r);
    v.health = r.health;
    for (let i = 0; i < 8; i++) if (r.flat & (1 << i)) this._burst(v, i);
    return v;
  }

  /** Put a record's mods onto its car. The spec is a clone: never VEHICLE_TYPES' shared one. */
  apply(v, r) {
    const base = VEHICLE_TYPES[r.type] || v.spec;
    v.owned = r.id; v.keep = true;
    if (v.role !== 'player') v.role = 'owned';
    v.spec = tunedSpec(base, r.mods);
    v.mass = v.spec.mass;
    v.inertia = v.mass * (base.L * base.L + base.W * base.W) / 12 * 1.05;
    v.dmgK = damageK(r.mods);
    v.mods = { ...r.mods };
    v.hornTune = r.mods.horn || null;
    v.locked = Boolean(r.locked);
    v.color = r.color;
    return v;
  }

  _freeBay() {
    for (let b = 0; b < this.bays.length; b++) if (!this.owned.some(r => r.bay === b)) return b;
    return -1;
  }

  /** Why `v` can't be claimed right now, or null. */
  refusal(v) {
    const g = this.game;
    if (g.police?.level > 0) return 'Lose the police first.';
    if (busy(g)) return 'Finish the job in hand first.';
    if (!canClaim(v.type)) return "Society secretary: 'No sarkari gaadi, no trucks in my parking!'";
    if (v.owned) return null;
    if (this.owned.length >= Math.min(MAX_CARS, this.bays.length) || this._freeBay() < 0) return 'All four bays are full. Sell one at the Jugaad Garage.';
    return null;
  }

  /** Make `v` yours. Returns the record, or null (with `why` in this.lastRefusal). */
  claim(v, bay = this._freeBay()) {
    const g = this.game;
    this.lastRefusal = this.refusal(v);
    if (this.lastRefusal || v.owned) return v.owned && !this.lastRefusal ? this.record(v) : null;
    const r = { id: this.next++, type: v.type, color: v.color, health: Math.max(300, v.health ?? 1000), flat: v.flat || 0, bay, locked: false, spent: 0, mods: emptyMods(), v, farT: 0, wreckT: 0 };
    this.owned.push(r);
    this.apply(v, r);
    this._commit();
    g.hud?.toast?.(`आपली गाडी · <b>${VEHICLE_TYPES[v.type].name}</b> parked at home`);
    g.audio?.sfx?.('buy');
    if (!g.save?.data?.seenParkingHelp) { g.save?.set?.('seenParkingHelp', true); g.hud?.help?.('This car is yours now. It waits in its bay at <b>Zenda Chowk</b> (blue ◆ on the radar), is towed home if you leave it, and <b>Bablu\'s Jugaad Garage</b> (J) can tune it.', 7); }
    return r;
  }

  // ---- the dealer lot ----
  buyVehicle(type, dealerCar = null) {
    const g = this.game, price = DEALER_PRICES[type];
    if (!price) return null;
    if (g.police?.level > 0 || busy(g)) { g.hud?.help?.('Not now: lose the police and finish the job first.', 3); return null; }
    if (this._freeBay() < 0 || this.owned.length >= MAX_CARS) { g.hud?.help?.('All four bays are full. Sell one first.', 3); return null; }
    if ((g.save?.cash ?? 0) < price) { g.hud?.help?.(`Dealer: '${rupees(price)}, bhau. Come back with the cash.'`, 3); return null; }
    let v = dealerCar;
    const at = this.dealerLot[0] || this.jugaad;
    if (!v) v = g.vehicles.spawn(type, at.x, at.z, at.heading ?? 0, { role: 'parked', driver: false });
    this.dealerCars = this.dealerCars.filter(c => c !== v);
    v.dealer = false;
    g.addCash ? g.addCash(-price) : (g.save.cash -= price);
    const r = this.claim(v);
    if (r) r.spent = 0;
    g.hud?.big?.('NEW GAADI', `${VEHICLE_TYPES[type].name} · −${rupees(price)}`, 'passed', 3);
    if (g.player?.enterVehicle && g.player.state === 'foot') g.player.enterVehicle(v);
    this._commit();
    return r;
  }

  _stockFor(day) {
    const types = Object.keys(DEALER_PRICES).filter(t => t !== 'tractor' || day % 3 === 0);
    const out = [];
    for (let k = 0; out.length < 3 && k < 20; k++) { const t = types[(day * 5 + k * 3) % types.length]; if (!out.includes(t)) out.push(t); }
    return out;
  }
  _dealer(near) {
    const g = this.game;
    const day = Math.floor((g.clock?.day ?? g.day ?? 0));
    if (!near || day !== this.dealerDay) { for (const v of this.dealerCars) if (!v.removed && v !== g.player?.vehicle) g.vehicles.remove(v); this.dealerCars = []; }
    if (!near || this.dealerCars.length || !g.vehicles?.spawn) return;
    this.dealerDay = day;
    this._stockFor(day).forEach((t, i) => {
      const at = this.dealerLot[i];
      if (!at) return;
      const v = g.vehicles.spawn(t, at.x, at.z, at.heading ?? 0, { role: 'parked', driver: false });
      v.keep = true; v.dealer = true;
      this.dealerCars.push(v);
    });
  }

  // ---- the Jugaad Garage: options, preview, buy, sell ----
  /** The menu's rows for a category: [{ val, label, price, current }]. */
  options(cat, v) {
    const r = this.record(v), m = r?.mods || emptyMods();
    switch (cat) {
      case 'engine': case 'brakes': case 'armour': {
        const M = MODS[cat], lvl = m[cat];
        return M.names.map((name, i) => ({ val: i + 1, label: name, price: i + 1 <= lvl ? 0 : M.price[i], current: i + 1 === lvl, done: i + 1 <= lvl }));
      }
      case 'tyres': return [{ val: true, label: 'Bulletproof tyres', price: m.bpTyres ? 0 : PRICES.bpTyres, current: m.bpTyres, done: m.bpTyres }];
      case 'horn': return [{ val: null, label: 'Stock horn', price: 0, current: !m.horn }, ...HORN_IDS.map(id => ({ val: id, label: HORNS[id].name, price: m.horn === id ? 0 : HORNS[id].price, current: m.horn === id }))];
      case 'neon': return [{ val: null, label: 'No neon', price: 0, current: !m.neon }, ...NEON_IDS.map(id => ({ val: id, label: NEON[id].name, color: NEON[id].color, price: m.neon === id ? 0 : PRICES.neon, current: m.neon === id }))];
      case 'sticker': return [{ val: null, label: 'No sticker', price: 0, current: m.sticker == null }, ...STICKERS.map((s, i) => ({ val: i, label: s, price: m.sticker === i ? 0 : PRICES.sticker, current: m.sticker === i }))];
      case 'paint': return PAINTS.map(c => ({ val: c, label: '', color: c, price: (r?.color ?? v.color) === c ? 0 : PRICES.paint, current: (r?.color ?? v.color) === c }));
      default: return [];
    }
  }

  /** Show an option on the car without paying (the first tap). */
  preview(v, cat, val) {
    const g = this.game;
    if (!v) return;
    v.mods = { ...(v.mods || emptyMods()) };
    if (cat === 'paint') v.color = val;
    else if (cat === 'neon') v.mods.neon = val;
    else if (cat === 'sticker') v.mods.sticker = val;
    else if (cat === 'horn') { v.hornTune = val; v.horn = 0; g.audio?.horn?.(v); }
    else if (cat === 'engine' || cat === 'brakes' || cat === 'armour') { v.flashT = (g.vehicles?.time ?? 0) + 0.4; }
  }
  /** Undo a preview: the car as its record says. */
  revert(v) {
    const r = this.record(v);
    if (r) this.apply(v, r);
    else if (v?._stock) { v.color = v._stock.color; v.mods = v._stock.mods; v.hornTune = null; }
  }

  /** Pay for an option (the second tap). Returns true when bought. */
  buyMod(v, cat, val) {
    const g = this.game;
    const row = this.options(cat, v).find(o => o.val === val);
    if (!row || row.done) return false;
    let r = this.record(v);
    const cash = g.save?.cash ?? 0;
    if (cash < row.price) { this.lastRefusal = 'Not enough cash.'; return false; }
    if (!r) { r = this.claim(v); if (!r) return false; }
    const m = r.mods;
    if (cat in MODS) m[cat] = val;
    else if (cat === 'tyres') m.bpTyres = true;
    else if (cat === 'horn') m.horn = val;
    else if (cat === 'neon') m.neon = val;
    else if (cat === 'sticker') m.sticker = val;
    else if (cat === 'paint') r.color = val;
    if (row.price) { g.addCash ? g.addCash(-row.price) : (g.save.cash = cash - row.price); r.spent += row.price; }
    this.apply(v, r);
    this.repair(v);
    g.audio?.sfx?.(cat === 'paint' ? 'spray' : 'buy');
    this._commit();
    return true;
  }

  /** Sell `v` back to the dealer for 40% of what it is worth. Returns the cash paid. */
  sell(v) {
    const g = this.game, r = this.record(v);
    if (!r) return 0;
    const pay = Math.round(valueOf(r) * PRICES.sellShare);
    this.owned = this.owned.filter(o => o !== r);
    if (g.player?.vehicle === v) g.player.leaveVehicle?.(true);
    v.owned = 0; v.keep = false;
    g.vehicles?.remove?.(v);
    g.addCash ? g.addCash(pay) : (g.save.cash += pay);
    g.hud?.big?.('SOLD', `${VEHICLE_TYPES[r.type].name} · +${rupees(pay)}`, 'passed', 3);
    this._commit();
    return pay;
  }

  // ---- tyres, repair, locks ----
  _burst(v, i) {
    const g = this.game;
    if (v.mods?.bpTyres) return false;
    if (g.burstTyre) return g.burstTyre(v, i);
    if (VP.burstTyre) return VP.burstTyre(v, i);
    if (v.flat & (1 << i)) return false;
    v.flat = (v.flat || 0) | (1 << i); return true;
  }
  burst(v, i) { return this._burst(v, i); }
  /** Any Jugaad purchase, Anna's respray (jobs._respray), a tow: flats and health fixed, colour kept. */
  repair(v) {
    if (!v) return;
    if (VP.repairTyres) VP.repairTyres(v); else { v.flat = 0; v.flatN = 0; v.flatF = 0; v.flatR = 0; v.flatPull = 0; }
    v.health = 1000; v.onFire = 0;
    const r = this.record(v);
    if (r) { r.color = v.color; r.health = 1000; r.flat = 0; this._commit(); }
  }
  lock(v, on = !v.locked) {
    const g = this.game, r = this.record(v);
    if (!r) return;
    r.locked = v.locked = on;
    v.flashT = (g.vehicles?.time ?? 0) + 0.6;
    g.audio?.sfxAt?.('chirp', v.x, v.z);
    g.hud?.toast?.(on ? '🔒 Locked' : '🔓 Unlocked');
    this._commit();
  }
  /** A locked car of yours rammed or shot: indicators and a whoop every 0.5 s for 8 s. */
  alarm(v) {
    if (!v?.owned || !v.locked) return;
    this.alarmV = v; this.alarmT = ALARM_FOR;
  }

  // ---- hooks from rules (C6) ----
  onEnter(v) {
    const r = this.record(v);
    if (!r) return;
    if (r.locked) { r.locked = v.locked = false; v.flashT = (this.game.vehicles?.time ?? 0) + 0.4; this.game.audio?.sfx?.('chirp'); }
    if (this.alarmV === v) this.alarmT = 0;
    r.farT = 0;
  }
  onExit(v) {
    const r = this.record(v);
    if (!r) return;
    v.role = 'owned';
    r.health = Math.max(300, v.health ?? 1000); r.flat = v.flat || 0;
    this._commit();
  }
  /** WASTED or BUSTED (quit path). Busted in your own car: released to its bay for ₹300. */
  onRespawn(cause, last) {
    const g = this.game, r = this.record(last);
    if (cause !== 'busted' || !r) return;
    const fee = Math.min(PRICES.impound, g.save?.cash ?? 0);
    if (fee) g.addCash ? g.addCash(-fee) : (g.save.cash -= fee);
    this._home(r, false);
    g.hud?.toast?.(`Your ${VEHICLE_TYPES[r.type].name} is back in its bay · impound ${rupees(fee)}`);
  }

  /** Back to its bay (a tow, the impound, a wreck's return), repaired. */
  _home(r, respawn) {
    const g = this.game, at = this.bays[r.bay];
    let v = this._live(r);
    if (respawn || !v) { if (v) g.vehicles?.remove?.(v); r.v = null; r.health = 1000; r.flat = 0; v = this._spawn(r); }
    else if (at) { v.x = at.x; v.z = at.z; v.heading = at.heading ?? 0; v.vx = v.vz = v.w = 0; }
    if (v) this.repair(v);
    r.farT = 0; r.wreckT = 0;
    this._commit();
    return v;
  }

  // ---- what the player can do on foot (C13) ----
  contextAction() {
    const g = this.game, P = g.player;
    if (P?.state !== 'foot' || !P.pos) return null;
    let best = null, bd = 6;
    for (const r of this.owned) { const v = this._live(r); if (v && !v.wrecked) { const d = dist(v.x, v.z, P.pos.x, P.pos.z); if (d < bd) { bd = d; best = v; } } }
    if (best) {
      const v = best;
      if (!g.save?.data?.seenLockHelp) { g.save?.set?.('seenLockHelp', true); g.hud?.help?.(`${VEHICLE_TYPES[v.type].name}: lock it and an alarm sounds if anyone rams or shoots it. Getting in unlocks it.`, 5); }
      return { label: v.locked ? 'UNLOCK CAR' : 'LOCK CAR', run: () => this.lock(v) };
    }
    for (const v of this.dealerCars) {
      if (v.removed || dist(v.x, v.z, P.pos.x, P.pos.z) > 4) continue;
      const price = DEALER_PRICES[v.type];
      if (this._helpType !== v.type) { this._helpType = v.type; g.hud?.help?.(`${VEHICLE_TYPES[v.type].name} · ${rupees(price)} on the dealer lot.`, 3); }
      return { label: `Buy · ${rupees(price)}`, run: () => this.buyVehicle(v.type, v) };
    }
    return null;
  }

  // ---- radar and markers ----
  staticBlips() { return this._static; }
  /** A blue ◆ for each car of yours you aren't driving, clamped to the radar's edge. Pooled. */
  blips() {
    const out = this._blips, pv = this.game.player?.vehicle;
    out.length = 0;
    let i = 0;
    for (const r of this.owned) {
      const v = this._live(r);
      if (!v || v === pv) continue;
      const b = (this._pool ??= [])[i] ??= { x: 0, z: 0, kind: 'icon', label: '◆', color: '#4da3ff', clamp: true };
      b.x = v.x; b.z = v.z; out.push(b); i++;
    }
    return out;
  }
  /** Floor markers within 150 m: the free bays while driving something claimable, and the Jugaad pad. */
  markers() {
    const g = this.game, P = g.player, out = this._markers;
    out.length = 0;
    const pos = P?.pos;
    if (!pos) return out;
    const v = P.vehicle;
    if (v && canClaim(v.type) && !v.owned) {
      for (let b = 0; b < this.bays.length; b++) {
        const at = this.bays[b];
        if (!this.owned.some(r => r.bay === b) && dist(at.x, at.z, pos.x, pos.z) < 150) out.push((this._bm ??= [])[b] ??= { x: at.x, z: at.z, r: BAY_R, h: 1.2, color: 0x4caf50 });
      }
    }
    if (dist(this.jugaad.x, this.jugaad.z, pos.x, pos.z) < 150) out.push(this._jm ??= { x: this.jugaad.x, z: this.jugaad.z, r: JUGAAD_R, h: 3, color: 0xffd54f });
    return out;
  }

  // ---- per frame ----
  update(dt) {
    const g = this.game, P = g.player, v = P?.vehicle;
    // The turntable: the car turns slowly under the menu's camera.
    if (this.menuCar && g.garageMenu?.open) { const c = this.menuCar; c.heading += 0.6 * dt; c.vx = c.vz = c.w = 0; }
    else this.menuCar = null;
    if (this.alarmT > 0) {
      this.alarmT -= dt; this._alarmBeep -= dt;
      const a = this.alarmV;
      if (!a || a.removed) this.alarmT = 0;
      else if (this._alarmBeep <= 0) { this._alarmBeep = 0.5; a.flashT = (g.vehicles?.time ?? 0) + 0.3; g.audio?.sfxAt?.('alarm', a.x, a.z); }
    }
    if (v && P.state === 'driving') { this._claimCheck(v, dt); this._jugaadCheck(v); } else this._hold = 0;
    this._slow += dt;
    if (this._slow >= 0.5) { this._tick(this._slow); this._slow = 0; }
  }

  _claimCheck(v, dt) {
    const g = this.game;
    if (!this.bays.length || v.owned && this.bays[this.record(v)?.bay] && dist(v.x, v.z, this.bays[this.record(v).bay].x, this.bays[this.record(v).bay].z) < BAY_R) { this._hold = 0; return; }
    const c = this._static[0];
    if (dist(v.x, v.z, c.x, c.z) > 30) { this._hold = 0; return; }
    let bay = -1;
    for (let b = 0; b < this.bays.length; b++) if (dist(v.x, v.z, this.bays[b].x, this.bays[b].z) < BAY_R && !this.owned.some(r => r.bay === b && r.v !== v)) { bay = b; break; }
    if (bay < 0 || speed(v) > 1.5) { this._hold = 0; return; }
    this._hold += dt;
    if (this._hold < CLAIM_HOLD) return;
    this._hold = -999; // once per stop
    const r = this.record(v);
    if (r) { r.bay = bay; this._commit(); g.hud?.toast?.('Parked in a new bay.'); return; }
    if (!this.claim(v, bay) && g.time - this._refusedAt > 6) { this._refusedAt = g.time; g.hud?.help?.(this.lastRefusal, 4); }
  }

  _jugaadCheck(v) {
    const g = this.game, d = dist(v.x, v.z, this.jugaad.x, this.jugaad.z);
    if (d > JUGAAD_R + 3) { this._jugaadArmed = true; return; }
    if (!this._jugaadArmed || d > JUGAAD_R || speed(v) > 1 || g.garageMenu?.open) return;
    this._jugaadArmed = false;
    const why = g.police?.level > 0 ? 'Bablu: \'Police on your tail? Lose them first, bhau.\'' : busy(g) ? 'Finish the job in hand first.' : !canClaim(v.type) ? "Bablu: 'I don't touch sarkari gaadi or trucks.'" : null;
    if (why) { g.hud?.help?.(why, 4); return; }
    this.openMenu(v);
  }

  /** Into the menu: the car becomes the turntable preview under a still camera. */
  openMenu(v) {
    const g = this.game;
    v.vx = v.vz = v.w = 0;
    if (!v.owned) v._stock = { color: v.color, mods: v.mods };
    this.menuCar = v;
    if (g.camera?.playShot) {
      // A still three-quarter shot from the kerb side; the car turns under it.
      const s = Math.sin(v.heading), c = Math.cos(v.heading), y = v.y || 0;
      const from = (this._from ??= new THREE.Vector3()).set(v.x + s * 5 + c * 4, y + 2.1, v.z + c * 5 - s * 4);
      const look = (this._look ??= new THREE.Vector3()).set(v.x, y + 0.6, v.z);
      g.camera.playShot({ from, look, duration: 1e6 });
    }
    g.garageMenu?.show?.(v);
    if (!g.save?.data?.seenJugaadHelp) { g.save?.set?.('seenJugaadHelp', true); g.hud?.help?.('Bablu Mistri\'s Jugaad Garage: tap an option to try it on, tap <b>BUY</b> to pay. Every buy fixes flats too.', 6); }
  }
  /** The menu closed (garage-menu.js): drop any preview, give the camera back. */
  closedMenu(v) {
    const g = this.game;
    if (v) { this.revert(v); delete v._stock; }
    this.menuCar = null;
    if (g.camera?.cinematic) g.camera.endShot?.(v?.heading);
  }

  _tick(dt) {
    const g = this.game, P = g.player, pos = P?.pos;
    if (!pos) return;
    this._dealer(this.dealerLot.length > 0 && dist(pos.x, pos.z, this.jugaad.x, this.jugaad.z) < 150);
    this._sync += dt;
    const sync = this._sync >= 2;
    if (sync) this._sync = 0;
    let changed = false;
    for (const r of this.owned.slice()) {
      const v = r.v;
      const gone = !v || v.removed || v.exploded || v.wrecked;
      if (gone) {
        // A wreck: cleared once out of sight, back in its bay three minutes later for 20% of its value.
        r.wreckT += dt;
        if (v && !v.removed && v !== P.vehicle && dist(v.x, v.z, pos.x, pos.z) > 80) { g.vehicles?.remove?.(v); }
        if (r.wreckT >= WRECK_BACK) {
          const fee = Math.min(Math.round((DEALER_PRICES[r.type] || 5000) * PRICES.wreckShare), g.save?.cash ?? 0);
          if (fee) g.addCash ? g.addCash(-fee) : (g.save.cash -= fee);
          this._home(r, true);
          g.hud?.toast?.(`Your ${VEHICLE_TYPES[r.type].name} is rebuilt and back at Zenda Chowk · ${rupees(fee)}`);
        }
        continue;
      }
      if (v === P.vehicle) { r.farT = 0; } else if (dist(v.x, v.z, pos.x, pos.z) > TOW_FAR && this.bays[r.bay] && dist(v.x, v.z, this.bays[r.bay].x, this.bays[r.bay].z) > 20) {
        r.farT += dt;
        if (r.farT >= TOW_AFTER) {
          const fee = Math.min(PRICES.towFee, g.save?.cash ?? 0);
          if (fee) g.addCash ? g.addCash(-fee) : (g.save.cash -= fee);
          this._home(r, false);
          g.hud?.toast?.(`${VEHICLE_TYPES[r.type].name} towed to Zenda Chowk · ${rupees(fee)}`);
        }
      } else r.farT = 0;
      if (sync) {
        const h = Math.max(300, Math.round(v.health ?? 1000)), f = v.flat || 0;
        if (h !== r.health || f !== r.flat) { r.health = h; r.flat = f; changed = true; }
      }
    }
    if (changed) this.toSave();
  }
}

export { rupees };
