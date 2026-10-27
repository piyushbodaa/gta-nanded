// Wanted level and the Nanded police: what they see, how they hunt you, and how you lose them.
import { clamp, dist, rng, hash2, headingTo } from '../core/math.js';
import { DynamicDriver } from '../actors/traffic.js';
import { makeOutfit } from '../actors/humans.js';
import { speedOf, forwardSpeed } from '../actors/vehicle-physics.js';

const UNITS = [0, 2, 3, 4, 6, 8];
const FOOT_MAX = 6; // officers on foot at once; later units stay in their jeeps
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

  /**
   * Heat for a crime at (x, z). Seen by an officer, the police know where the player is. `heard`
   * from a witness, they know only where the crime was: a new hunt searches from there, unseen, and
   * one already on the player's trail keeps it.
   */
  addHeat(h, x, z, heard = false) {
    const before = this.level;
    this.heat = clamp(Math.max(this.heat, this.level) + h, 0, 5.99);
    this.level = Math.max(this.level, Math.min(5, Math.floor(this.heat + 0.001)));
    if (this.level > 0 && !(heard && before > 0)) { this.lastSeen.x = x; this.lastSeen.z = z; this.unseenT = 0; this.seen = !heard; }
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
    // Only a jeep with an officer in it sees anything: not an empty, abandoned or burnt-out one.
    for (const v of this.game.vehicles.list) if (v.type === 'police' && v.driver && v.role !== 'player' && !v.wrecked && dist(v.x, v.z, x, z) < r * 0.8) return true;
    return false;
  }

  update(dt) {
    const g = this.game, P = g.player, pos = P.pos;
    // A witness calls a crime in where it happened: the police hear what was done there, not where
    // the player has got to since. Too late once the player steps into a mission's start marker:
    // the mission waits for the call (missions.js), and a star landing there kept it from starting.
    if (this.pending.length && this._atMissionStart()) this.pending.length = 0;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const c = this.pending[i];
      if ((c.t -= dt) <= 0) { this.pending.splice(i, 1); this.addHeat(c.heat, c.x, c.z, true); }
    }
    if (this.level === 0) {
      // Small crimes are forgotten after a while: a punch long ago doesn't count toward a star.
      this.heat = Math.max(0, this.heat - dt * 0.03);
      this._cleanup(dt);
      return;
    }
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
    // Keep the right number of units on the job. A jeep that is wrecked, gone or taken by the
    // player is off it: let it go, or it wails and is never towed for the rest of the game.
    const want = UNITS[this.level];
    this.units = this.units.filter(u => {
      const on = g.vehicles.list.includes(u.v) && !u.v.wrecked && u.v.role !== 'player';
      if (!on) this._release(u.v);
      return on;
    });
    if (this.units.length < want && (this.spawnT = (this.spawnT || 0) - dt) <= 0) {
      this._spawnUnit(pos);
      this.spawnT = 2.2 - this.level * 0.25;
    }
    for (const u of this.units) this._driveUnit(u, dt, pos);
    for (const c of this.foot) this._footCop(c, dt);
    // Officers left far behind go back to their beat, which makes room for fresh ones closer in;
    // the jeeps they left are towed away like any others (a long chase on foot would pile them up).
    this.foot = this.foot.filter(c => {
      if (!g.peds.list.includes(c)) return false;
      if (dist(c.h.x, c.h.z, pos.x, pos.z) < 150) return true;
      this._offDuty(c);
      return false;
    });
    this._cleanup(dt);
    // Busted? Not while a cutscene holds the player still: they couldn't get away if they tried.
    const near = this.foot.some(c => c.state !== 'down' && dist(c.h.x, c.h.z, P.x, P.z) < 1.5);
    const boxed = P.vehicle && speedOf(P.vehicle) < 1.5 && this.units.some(u => dist(u.v.x, u.v.z, P.vehicle.x, P.vehicle.z) < 6.5);
    if (!g.cutscene && ((P.state === 'foot' && near && P.speed < 2.5) || boxed)) this.bustT += dt; else this.bustT = Math.max(0, this.bustT - dt * 2);
    if (this.bustT > (P.vehicle ? 3.2 : 1.6)) { this.bustT = 0; g.busted?.(); }
  }

  /** The player is in a mission's start marker, ready to begin it (as Missions.update decides). */
  _atMissionStart() {
    const g = this.game, M = g.missions, P = g.player, pos = P.pos;
    if (!M || M.active || M.cooldown > 0 || g.respawning || g.jobs?.active || this.level > 0) return false;
    if (P.vehicle && speedOf(P.vehicle) >= 3) return false;
    return M.available().some(d => { const s = M.startPoint(d); return dist(pos.x, pos.z, s.x, s.z) < 2.6; });
  }

  _spawnUnit(pos) {
    const g = this.game, net = g.net;
    // Never more jeeps than there are instance slots to draw them: one past that is solid but
    // invisible, its officers sitting in the air. Units, the jeeps officers got out of, wrecks and
    // the player's own all count; another unit comes when one is towed or left behind.
    const cap = g.vehicles.meshes?.police?.cap;
    if (cap && g.vehicles.list.reduce((n, v) => n + (v.type === 'police'), 0) >= cap) return null;
    const r = rng(hash2(this.seed++, 4271));
    for (let tries = 0; tries < 8; tries++) {
      const ang = r() * Math.PI * 2, d = r.range(110, 180);
      const n = net.nearest(pos.x + Math.cos(ang) * d, pos.z + Math.sin(ang) * d, 60, {}, r => !net.raised[r]);
      if (!n || net.width[n.road] < 4.5) continue;
      if (g.vehicles.list.some(v => dist(v.x, v.z, n.x, n.z) < 8)) continue;
      const toward = headingTo(n.x, n.z, pos.x, pos.z);
      const heading = Math.cos(toward - Math.atan2(n.dx, n.dz)) > 0 ? Math.atan2(n.dx, n.dz) : Math.atan2(-n.dx, -n.dz);
      const v = g.vehicles.spawn('police', n.x, n.z, heading, { role: 'police', seed: (r() * 1e9) | 0 });
      v.kinematic = false; v.sirenOn = true; v.keep = true;
      if (this.level >= 2) g.vehicles.addPassenger(v, makeOutfit('police', (r() * 1e9) | 0));
      const u = { v, driver: new DynamicDriver(g, v, { aggression: 0.55 + this.level * 0.08, maxSpeed: 30 + this.level * 2 }), repath: 0, state: 'pursue', exitT: 0 };
      u.driver.onStuck = () => this._unstick(u);
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
    // A stopped unit near a player on foot sends its officers out: at once when close, and
    // after a couple of seconds when it is held up further off (a blocked lane, a parked auto).
    if (!g.player.vehicle && d < 35 && speedOf(v) < 2 && this.foot.length < FOOT_MAX) {
      u.exitT += dt;
      if (u.exitT > (d < 14 ? 0.6 : 2.2) && v.driver) this._dismount(u);
    } else u.exitT = Math.max(0, u.exitT - dt);
  }

  /**
   * A jeep wedged against a wall: close to the player its officers get out and run; out of
   * sight it is put back on the road a little further along its route. Returns true if handled.
   */
  _unstick(u) {
    const g = this.game, v = u.v, P = g.player, d = Math.hypot(v.x - P.x, v.z - P.z);
    if (d < 45) { if (!g.player.vehicle && v.driver && this.foot.length < FOOT_MAX) { this._dismount(u); return true; } return false; }
    const path = u.driver.path, net = g.net;
    if (!path) return false;
    const k = Math.min(path.length / 2 - 1, u.driver.i + 3);
    const n = net.nearest(path[k * 2], path[k * 2 + 1], 20, {}, r => !net.raised[r]);
    if (!n || g.vehicles.list.some(o => o !== v && Math.hypot(o.x - n.x, o.z - n.z) < 6)) return false;
    const ahead = Math.min(path.length / 2 - 1, k + 1);
    v.x = n.x; v.z = n.z; v.y = 0; v.vx = v.vz = 0; v.w = 0;
    v.heading = Math.atan2(path[ahead * 2] - n.x, path[ahead * 2 + 1] - n.z);
    u.driver.i = k; u.driver.reverseT = 0; u.driver.stuck = 0;
    return true;
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
    // Left at the roadside, lights still flashing; free to be towed once the player takes it.
    v.role = 'police-parked'; v.keep = false;
    this.units = this.units.filter(x => x !== u);
    g.controls.delete(v);
  }

  /** A unit's jeep off the job (wrecked, gone, or the player's now). */
  _release(v) {
    v.keep = false;
    if (v.role === 'player') return; // the player has its siren switch and its controls now
    v.sirenOn = false;
    this.game.controls.delete(v);
    if (v.role === 'police') v.role = 'abandoned'; // a wreck: it burns, blows up and is towed like any other
  }

  _offDuty(c) { c.state = 'walk'; c.keep = false; c.road = null; }

  _footCop(c, dt) {
    // Cops chase on foot and keep at it longer than angry bystanders do.
    if (c.state === 'flee' || c.state === 'walk' || c.state === 'cower') { c.state = 'fight'; c.t = 30; }
  }

  _standDown() {
    const g = this.game;
    for (const u of this.units) { u.v.sirenOn = false; u.v.role = 'police-idle'; u.v.keep = false; g.controls.delete(u.v); }
    this.units = [];
    // The jeeps officers got out of go quiet too, or they wail on after 'Lost them'.
    for (const v of g.vehicles.list) if (v.role === 'police-parked') v.sirenOn = false;
    for (const c of this.foot) this._offDuty(c);
    this.foot = [];
    this.bustT = 0;
  }

  _cleanup(dt) {
    // Idle and parked police jeeps despawn when far away.
    const g = this.game, pos = g.player.pos;
    for (const v of g.vehicles.list.slice()) {
      if (!(v.role === 'police-idle' || v.role === 'police-parked')) continue;
      if (dist(v.x, v.z, pos.x, pos.z) > 160) g.vehicles.remove(v);
      else if (v.role === 'police-idle') g.controls.set(v, { throttle: 0, brake: 1, steer: 0 });
    }
  }
}
