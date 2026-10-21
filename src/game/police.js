// Wanted level and the Nanded police: what they see, how they hunt you, and how you lose them.
import { clamp, dist, rng, hash2, headingTo } from '../core/math.js';
import { DynamicDriver } from '../actors/traffic.js';
import { makeOutfit } from '../actors/humans.js';
import { speedOf, forwardSpeed } from '../actors/vehicle-physics.js';

const UNITS = [0, 2, 3, 4, 6, 8];
const CRIME_HEAT = { carjack: 1, hitPed: 1, punch: 0.45, hitCop: 2, ramPolice: 1, wreck: 1, assault: 1, mission: 0 };

export class Police {
  constructor(game) {
    this.game = game;
    this.level = 0;
    this.heat = 0;
    this.units = [];
    this.foot = [];
    this.lastSeen = { x: 0, z: 0 };
    this.seenT = 0;
    this.unseenT = 0;
    this.searchRadius = 0;
    this.bustT = 0;
    this.pending = [];
    this.losT = 0;
    this.seen = false;
    this.seed = 1;
    this.lock = false; // missions can hold the wanted level
  }

  /** A crime at (x, z). If no officer sees it, a witness may call it in a moment later. */
  report(crime, x, z, { cop = false } = {}) {
    if (this.game.cheats?.noWanted) return;
    const heat = CRIME_HEAT[crime] ?? 0.5;
    const seenBy = cop || this._copNear(x, z, 55);
    if (seenBy) this.addHeat(heat, x, z);
    else if (Math.random() < (crime === 'punch' ? 0.25 : 0.6)) this.pending.push({ t: 3 + Math.random() * 3, heat, x, z });
  }

  addHeat(h, x, z) {
    const before = this.level;
    this.heat = clamp(Math.max(this.heat, this.level) + h, 0, 5.99);
    this.level = Math.max(this.level, Math.min(5, Math.floor(this.heat + 0.001)));
    if (this.level > 0) { this.lastSeen.x = x; this.lastSeen.z = z; this.unseenT = 0; this.seen = true; }
    if (this.level > before) this.game.onWantedChange?.(this.level, before);
  }

  setLevel(n) {
    const before = this.level;
    this.level = clamp(n, 0, 5); this.heat = this.level;
    if (n > 0) { const p = this.game.player.pos; this.lastSeen.x = p.x; this.lastSeen.z = p.z; this.unseenT = 0; this.seen = true; }
    if (n !== before) this.game.onWantedChange?.(this.level, before);
    if (n === 0) this._standDown();
  }

  clear() { this.setLevel(0); this.pending.length = 0; }

  _copNear(x, z, r) {
    for (const u of this.units) if (dist(u.v.x, u.v.z, x, z) < r) return true;
    for (const c of this.foot) if (dist(c.h.x, c.h.z, x, z) < r) return true;
    for (const v of this.game.vehicles.list) if (v.type === 'police' && v.role !== 'player' && dist(v.x, v.z, x, z) < r * 0.8) return true;
    return false;
  }

  update(dt) {
    const g = this.game, P = g.player, pos = P.pos;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const c = this.pending[i];
      if ((c.t -= dt) <= 0) { this.pending.splice(i, 1); this.addHeat(c.heat, pos.x, pos.z); }
    }
    if (this.level === 0) { this._cleanup(dt); return; }
    // Line of sight from any unit.
    this.losT -= dt;
    if (this.losT <= 0) {
      this.losT = 0.25;
      this.seen = false;
      const eyes = [...this.units.map(u => u.v), ...this.foot.map(c => c.h)];
      for (const e of eyes) {
        const d = dist(e.x, e.z, pos.x, pos.z);
        if (d > 75) continue;
        if (d < 12 || g.colliders.raycast(e.x, 1.6, e.z, pos.x, 1.6, pos.z, 0.05) >= 0.999) { this.seen = true; break; }
      }
    }
    if (this.seen) {
      this.lastSeen.x = pos.x; this.lastSeen.z = pos.z; this.unseenT = 0;
    } else {
      // Out of sight: escape the search area and keep your head down.
      const inside = dist(pos.x, pos.z, this.lastSeen.x, this.lastSeen.z) < this.searchRadius;
      this.unseenT += dt * (inside ? 0.3 : 1);
      if (this.unseenT > 5 + this.level * 1.6 && !this.lock) {
        this.setLevel(0);
        g.onEvaded?.();
        return;
      }
    }
    this.searchRadius = 45 + this.level * 22;
    // Keep the right number of units on the job.
    const want = UNITS[this.level];
    this.units = this.units.filter(u => g.vehicles.list.includes(u.v) && !u.v.wrecked && u.v.role !== 'player');
    if (this.units.length < want && (this.spawnT = (this.spawnT || 0) - dt) <= 0) {
      this._spawnUnit(pos);
      this.spawnT = 2.2 - this.level * 0.25;
    }
    for (const u of this.units) this._driveUnit(u, dt, pos);
    for (const c of this.foot) this._footCop(c, dt);
    this.foot = this.foot.filter(c => g.peds.list.includes(c));
    // Busted?
    const near = this.foot.some(c => c.state !== 'down' && dist(c.h.x, c.h.z, P.x, P.z) < 1.5);
    const boxed = P.vehicle && speedOf(P.vehicle) < 1.5 && this.units.some(u => dist(u.v.x, u.v.z, P.vehicle.x, P.vehicle.z) < 6.5);
    if ((P.state === 'foot' && near && P.speed < 2.5) || boxed) this.bustT += dt; else this.bustT = Math.max(0, this.bustT - dt * 2);
    if (this.bustT > (P.vehicle ? 3.2 : 1.6)) { this.bustT = 0; g.busted?.(); }
  }

  _spawnUnit(pos) {
    const g = this.game, net = g.net;
    const r = rng(hash2(this.seed++, 4271));
    for (let tries = 0; tries < 8; tries++) {
      const ang = r() * Math.PI * 2, d = r.range(110, 180);
      const n = net.nearest(pos.x + Math.cos(ang) * d, pos.z + Math.sin(ang) * d, 60, {});
      if (!n || net.width[n.road] < 4.5) continue;
      if (g.vehicles.list.some(v => dist(v.x, v.z, n.x, n.z) < 8)) continue;
      const toward = headingTo(n.x, n.z, pos.x, pos.z);
      const heading = Math.cos(toward - Math.atan2(n.dx, n.dz)) > 0 ? Math.atan2(n.dx, n.dz) : Math.atan2(-n.dx, -n.dz);
      const v = g.vehicles.spawn('police', n.x, n.z, heading, { role: 'police', seed: (r() * 1e9) | 0 });
      v.kinematic = false; v.sirenOn = true; v.keep = true;
      if (this.level >= 2) g.vehicles.addPassenger(v, makeOutfit('police', (r() * 1e9) | 0));
      const u = { v, driver: new DynamicDriver(g, v, { aggression: 0.55 + this.level * 0.08, maxSpeed: 30 + this.level * 2 }), repath: 0, state: 'pursue', exitT: 0 };
      this.units.push(u);
      return u;
    }
    return null;
  }

  _driveUnit(u, dt, pos) {
    const g = this.game, v = u.v;
    const d = dist(v.x, v.z, pos.x, pos.z);
    const target = this.seen ? pos : this.lastSeen;
    let ctl;
    const pv = g.player.vehicle;
    if (d < 40 && this.seen) {
      // Close: chase a driver bumper to bumper; pull up short of someone on foot.
      u.driver.ignore = pv;
      ctl = pv ? u.driver.control(dt, { x: pos.x + pv.vx * 0.6, z: pos.z + pv.vz * 0.6 }) : u.driver.control(dt, pos, 7);
    } else {
      u.repath -= dt;
      if (u.repath <= 0) {
        u.repath = 1.5 + Math.random();
        // Lost sight: search the streets around where the player was last seen.
        let tx = target.x, tz = target.z;
        if (!this.seen && u.driver.done && dist(v.x, v.z, tx, tz) < 25) {
          const a = Math.random() * Math.PI * 2, r = this.searchRadius * (0.4 + Math.random() * 0.6);
          tx += Math.cos(a) * r; tz += Math.sin(a) * r;
        }
        const route = g.net.route(v.x, v.z, tx, tz, { plain: true });
        if (route) u.driver.setPath(route.points);
      }
      ctl = u.driver.control(dt);
    }
    g.controls.set(v, ctl);
    // A stopped unit near a player on foot sends its officers out.
    if (!g.player.vehicle && d < 14 && speedOf(v) < 2) {
      u.exitT += dt;
      if (u.exitT > 0.6 && v.driver) this._dismount(u);
    }
  }

  _dismount(u) {
    const g = this.game, v = u.v;
    const people = [v.driver, ...v.passengers].filter(Boolean);
    v.driver = null; v.passengers = [];
    for (const h of people) {
      const door = g.vehicles.doorWorld(v);
      h.x = door.x + (Math.random() - 0.5); h.z = door.z + (Math.random() - 0.5); h.pose = 'idle'; h.pitch = 0; h.roll = 0; h.y = 0;
      const p = g.peds._make(h, h.x, h.z, null);
      p.state = 'fight'; p.t = 30; p.keep = true; p.cop = true; p.grudge = 2;
      this.foot.push(p);
    }
    v.role = 'police-parked';
    this.units = this.units.filter(x => x !== u);
    g.controls.delete(v);
  }

  _footCop(c, dt) {
    // Cops chase on foot and keep at it longer than angry bystanders do.
    if (c.state === 'flee' || c.state === 'walk' || c.state === 'cower') { c.state = 'fight'; c.t = 30; }
  }

  _standDown() {
    const g = this.game;
    for (const u of this.units) { u.v.sirenOn = false; u.v.role = 'police-idle'; u.v.keep = false; g.controls.delete(u.v); }
    this.units = [];
    for (const c of this.foot) { c.state = 'walk'; c.keep = false; c.road = null; }
    this.foot = [];
    this.bustT = 0;
  }

  _cleanup(dt) {
    // Idle police jeeps drive off and despawn when far away.
    const g = this.game, pos = g.player.pos;
    for (const v of g.vehicles.list.slice()) {
      if (!(v.role === 'police-idle' || v.role === 'police-parked')) continue;
      if (dist(v.x, v.z, pos.x, pos.z) > 160) g.vehicles.remove(v);
      else if (v.role === 'police-idle') g.controls.set(v, { throttle: 0, brake: 1, steer: 0 });
    }
  }
}
