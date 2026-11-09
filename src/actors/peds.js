// People on foot: they walk the lane edges and footpaths, cross at junctions,
// jump out of the way, get knocked down, and run, cower or fight back.
import { clamp, dist, rng, hash2, wrapAngle, dampAngle, headingTo } from '../core/math.js';
import { makeOutfit } from './humans.js';
import { GETUP_TIME } from './anim.js';
import { speedOf } from './vehicle-physics.js';
import { ZONE } from '../world/citygen.js';
import { WEAPONS, PED_HEALTH, COP_HEALTH } from '../game/weapon-data.js';

// Body radius against walls and posts, and the clear space a new person needs around them.
const PED_R = 0.28, SPAWN_CLEAR = 0.5;
// Closest two people stand, centre to centre, and how near someone ahead makes a walker step aside.
const PERSONAL = 0.46, GIVE_WAY = 1.3;
// States in which people keep out of each other (not the fallen, nor mission actors).
const SOLID = new Set(['walk', 'idle', 'phone', 'hail', 'cower', 'flee', 'fight']);
const SIKH_AREAS = new Set(['Hazur Sahib', 'Old City', 'Godavari riverfront', 'Riverfront', 'Old Mondha', 'Vazirabad', 'Old Nanded']);
export const BARKS = {
  hit: ['अरे! काय करतोयस?', 'Aye! Andha hai kya?', 'अरे देवा!', 'Bhau, gaadi baghun chalav!', 'Police la phone karto!'],
  punched: ['आई गं!', 'Kya re? Dadagiri?', 'थांब, बघतोच तुला!', 'Arre maar kyun raha hai?'],
  flee: ['वाचवा!', 'Bachao!', 'पळा पळा!', 'Police! Police!'],
  fight: ['चल ये, बघू!', 'Aaja, dekh leta hoon!', 'Tujhya aaila…', 'Ruk ja tu!'],
  jacked: ['माझी गाडी!', 'Chor! Chor!', 'Arre meri gaadi!', 'Pakda usko!'],
  dive: ['ए! हळू!', 'Dheere chala!', 'अरे बाप रे!'],
};

export class Peds {
  constructor(game) {
    this.game = game;
    this.net = game.net;
    this.list = [];
    this.seed = 1;
    this.spawnT = 0;
    this._p = {}; this._q = {}; this._n = {}; this._o = {}; this._c = { x: 0, z: 0 };
    this.panic = 0;
    // Streets at ground level (any but a flyover: a river bridge is at ground level too), the
    // same without bridges, and a flyover deck someone is up on.
    this._ground = r => !this.net.raised[r];
    this._street = r => !this.net.raised[r] && !this.net.bridge[r];
    this._deck = r => this.net.raised[r] === 1;
  }

  randomOutfit(x) {
    const r = rng(hash2(this.seed++, Math.floor((x || Math.random()) * 1e6)));
    return makeOutfit(r.pick(['man', 'man', 'woman', 'woman', 'student', 'elder', 'sikh']), (r() * 1e9) | 0);
  }

  outfitFor(x, z, r) {
    const city = this.game.city;
    const d = city.district(x, z).name, zone = city.zoneAt(x, z);
    let kind;
    if (SIKH_AREAS.has(d) && r.chance(0.42)) kind = 'sikh';
    else if (zone === ZONE.COACHING && r.chance(0.55)) kind = 'student';
    else if (zone === ZONE.RURAL) kind = r.pick(['farmer', 'farmer', 'man', 'woman', 'elder']);
    else kind = r.pick(['man', 'man', 'man', 'woman', 'woman', 'woman', 'elder', 'student', 'sikh']);
    return makeOutfit(kind, (r() * 1e9) | 0);
  }

  forEachNear(x, z, radius, fn) {
    const r2 = radius * radius;
    for (const p of this.list) { const dx = p.h.x - x, dz = p.h.z - z; if (dx * dx + dz * dz < r2) fn(p); }
  }

  /** The driver we just pulled out of their car becomes a pedestrian with a grudge. */
  adoptEjected(h, vehicle, player) {
    const r = rng(hash2(this.seed++, 99));
    const p = this._make(h, h.x, h.z, null);
    p.state = 'down'; p.t = 1.2;
    p.after = r.chance(0.35) ? 'fight' : 'flee';
    p.grudge = 1;
    this.bark(p, 'jacked');
  }

  _make(h, x, z, road) {
    const p = {
      h, road, dir: 1, s: 0, side: 1, speed: 0, state: 'walk', t: 0, after: null, vx: 0, vz: 0, hits: 0, grudge: 0, cool: 0, onRoadOk: false, id: this.seed++,
      lat: 0, latHold: 0, stuck: 0, shoveX: 0, shoveZ: 0, // sidestep off the walking line, and how long they've been held up
      fx: 0, fz: 0, nx: 0, nz: 0, // walking direction and the outward normal of their footpath
      pave: 0, under: 0, underX: undefined, underZ: 0, lookT: 0, // the footpath under them (_floor), and when to look for a street
      role: null, homeX: undefined, homeZ: undefined, backT: 0, // a part to go back to after a scare (_keepRole)
      punchT: 0, barkCool: 0,
    };
    h.x = x; h.z = z;
    // Upright, whatever seat they came from (a two-wheeler's lean is its rider's roll).
    h.roll = 0; h.pitch = 0; h.air = false;
    this.list.push(p);
    return p;
  }

  update(dt) {
    const g = this.game, focus = g.player.pos;
    const target = g.quality.settings.peds * (g.pedScale ?? 1) * (g.quality.crowd ?? 1);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      if (p.gone || (dist(p.h.x, p.h.z, focus.x, focus.z) > 150 && !p.keep)) { g.humans.remove(p.h); this.list.splice(i, 1); }
    }
    this.spawnT -= dt;
    // The knocked out lying about don't count toward the crowd: after a shoot-out people still come by.
    let alive = 0;
    for (const p of this.list) if (p.state !== 'dead') alive++;
    let budget = alive < target * 0.5 ? 8 : 2;
    while (alive < target && budget-- > 0 && this.spawnT <= 0) {
      if (!this._spawn(focus, alive < target * 0.5 ? 20 : 60, 115)) { this.spawnT = 0.15; break; }
      alive++;
    }
    this.panic = Math.max(0, this.panic - dt * 0.1);
    for (const p of this.list) this._update(p, dt);
    this._separate(dt);
  }

  /**
   * People keep out of each other: a walker with someone just ahead steps across the footpath
   * (round them, or to the left when dead ahead, as on Indian streets), and bodies that still
   * touch are eased apart. A few hundred distance checks at most.
   */
  _separate(dt) {
    const L = this.list, G2 = GIVE_WAY * GIVE_WAY;
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      if (!SOLID.has(a.state)) continue;
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j];
        if (!SOLID.has(b.state)) continue;
        const dx = b.h.x - a.h.x, dz = b.h.z - a.h.z, d2 = dx * dx + dz * dz;
        if (d2 > G2) continue;
        if (a.state === 'walk') this._giveWay(a, dx, dz, dt);
        if (b.state === 'walk') this._giveWay(b, -dx, -dz, dt);
        if (d2 < PERSONAL * PERSONAL) {
          const d = Math.sqrt(d2);
          // Exactly on top of each other: part along a fixed direction.
          const ux = d > 1e-3 ? dx / d : 1, uz = d > 1e-3 ? dz / d : 0, k = (PERSONAL - d) * 0.5;
          a.h.x -= ux * k; a.h.z -= uz * k; b.h.x += ux * k; b.h.z += uz * k;
        }
      }
    }
  }

  /** Someone is (dx, dz) from walker p: if they're in the way ahead, sidestep. */
  _giveWay(p, dx, dz, dt) {
    if (p.road == null || dx * p.fx + dz * p.fz <= 0.05) return;
    const across = dx * p.nx + dz * p.nz;
    if (Math.abs(across) > PERSONAL + 0.1) return;
    // Away from them across the footpath; dead ahead, to the walker's own left.
    const away = Math.abs(across) > 0.05 ? -Math.sign(across) : Math.sign(p.fz * p.nx - p.fx * p.nz) || 1;
    p.lat = this._sidestep(p.road, p.lat + away * 1.5 * dt);
    p.latHold = Math.max(p.latHold, 0.5);
  }

  _spawn(focus, minD, maxD) {
    const g = this.game, net = this.net;
    const r = rng(hash2(this.seed++, 5153));
    const ang = r() * Math.PI * 2, d = r.range(minD, maxD);
    const n = net.nearest(focus.x + Math.cos(ang) * d, focus.z + Math.sin(ang) * d, 40, this._q);
    if (!n || net.bridge[n.road] || net.raised[n.road]) return false;
    // Either footpath, except the median side of a divided road.
    const road = n.road, side = net.kerbSide(road) || (r.chance(0.5) ? 1 : -1);
    const off = this._offset(road);
    const x = n.x + n.dz * off * side, z = n.z - n.dx * off * side;
    // Never appear inside or against a wall, post, stall or platform, in a vehicle or in someone.
    if (g.colliders.blocked(x, z, SPAWN_CLEAR)) return false;
    if (this._inVehicle(x, z, 0.6)) return false;
    for (const o of this.list) if (Math.abs(o.h.x - x) < 0.8 && Math.abs(o.h.z - z) < 0.8) return false;
    if (dist(x, z, focus.x, focus.z) < minD * 0.7) return false;
    const h = g.humans.add(this.outfitFor(x, z, r), x, z);
    const p = this._make(h, x, z, road);
    p.dir = r.chance(0.5) ? 1 : -1;
    p.s = p.dir > 0 ? n.s : net.length[road] - n.s;
    p.side = side;
    p.speed = r.range(1.1, 1.55);
    if (r.chance(0.12)) { p.state = 'idle'; p.t = r.range(4, 14); }
    if (r.chance(0.05)) { p.state = 'phone'; p.t = r.range(6, 16); }
    return true;
  }

  /** True when (x, z) is within `margin` of any vehicle's footprint. */
  _inVehicle(x, z, margin) {
    for (const v of this.game.vehicles.list) if (v.y <= 1.5 && this._byVehicle(v, x, z, margin)) return true;
    return false;
  }

  /** True when (x, z) is within `margin` of vehicle v's footprint. */
  _byVehicle(v, x, z, margin) {
    const dx = x - v.x, dz = z - v.z;
    if (dx * dx + dz * dz > (v.hd + margin + 1) ** 2) return false;
    const c = Math.cos(v.heading), s = Math.sin(v.heading);
    return Math.abs(dx * c - dz * s) < v.hw + margin && Math.abs(dx * s + dz * c) < v.hd + margin;
  }

  _offset(road) {
    const w = this.net.width[road];
    // Up on a flyover (out of a vehicle that stopped there) or out on a river bridge: along the
    // inside of its parapet.
    if (this.net.raised[road] || this.net.bridge[road]) return w / 2 - 0.5;
    return w >= 8 ? w / 2 + 0.95 : w / 2 + 0.45;
  }

  /**
   * A walker's sidestep off their line: at most a step onto the road's edge to pass a post, more
   * room on the building side; on a deck or a bridge, into the road and never into the parapet.
   */
  _sidestep(road, lat) {
    const w = this.net.width[road], off = this._offset(road);
    return off < w / 2 ? clamp(lat, -1.2, 0.2) : clamp(lat, -(off - w / 2) - 0.2, 1.1);
  }

  /** The height whose walls and railings hold a person in: a flyover deck they're on, else the ground's. */
  _level(h) { return h.y > 1.5 ? h.y : 0; }

  /**
   * What a person stands on: the ground (a station platform, the riverbank), a flyover deck
   * they're up on, or the footpath. Walkers know their footpath from their line; anyone else
   * looks up the one under them, and again once they have moved.
   */
  _floor(p) {
    const g = this.game, h = p.h;
    // The footpath's top, or -Infinity off one (the street or the ground decides), as for the player.
    let pave = p.pave || -Infinity;
    if (p.state !== 'walk') {
      if (p.underX === undefined || Math.abs(h.x - p.underX) + Math.abs(h.z - p.underZ) > 0.3) {
        const n = this.net.nearest(h.x, h.z, 14, this._n, this._ground);
        p.under = (n && g.city.pavementAt(n.seg, n.dist)) || -Infinity; p.underX = h.x; p.underZ = h.z;
      }
      pave = p.under;
    }
    // Down a river valley the streets say what is underfoot: a street stays level across the
    // slope, off it is the bank itself (standing at street level there floated them 3 m up).
    // Only someone already up off the street (out of a vehicle on a flyover) can be on a deck:
    // on level ground, walkers passing a ramp's foot would climb it into the air. One walking a
    // flyover keeps to its deck wherever they are over it: down its ramps, and up the next where
    // it comes down to the street between two (else on into that ramp's embankment).
    const net = this.net, fly = p.state === 'walk' && p.road != null && net.raised[p.road];
    const y = fly ? net.deckAt(p.road, p.dir > 0 ? p.s : net.length[p.road] - p.s) : h.y;
    const ground = g.city.groundHeight(h.x, h.z);
    const top = y > 0.3 || ground < 0 ? net.surfaceAt(h.x, h.z, y) : ground;
    return Math.max(top, pave);
  }

  /** A fare waiting for a ride or a story's actor keeps their part (and spot) to go back to after a scare. */
  _keepRole(p) {
    if (p.state !== 'hail' && p.state !== 'scripted') return;
    p.role = p.state; p.homeX ??= p.h.x; p.homeZ ??= p.h.z;
  }

  /** The scare is over: back to their part (and spot) if they have one, else back to walking their street. */
  _calm(p) {
    if (p.role && p.keep) { p.state = p.role; p.backT = 0; return; }
    p.state = 'walk';
    this._resnap(p);
  }

  bark(p, kind) {
    const lines = BARKS[kind];
    if (!lines || p.barkCool > 0) return;
    p.barkCool = 4;
    const g = this.game;
    if (dist(p.h.x, p.h.z, g.player.x, g.player.z) < 30) g.hud?.bark(lines[(p.id + Math.floor(g.time)) % lines.length]);
  }

  /** Knock a person over (car, punch, explosion). (vx, vz) is the shove. */
  knock(p, vx, vz, seconds, cause) {
    if (p.state === 'down' || p.state === 'dead') return;
    this._keepRole(p);
    p.state = 'down'; p.t = seconds; p.vx = vx; p.vz = vz; p.vy = Math.min(6, Math.hypot(vx, vz) * 0.35);
    p.hits++;
    p.h.pose = 'lie';
    p.after = p.h.outfit.kind === 'police' ? 'fight' : p.grudge > 0 || (cause === 'punch' && Math.random() < 0.3 && p.hits < 3) ? 'fight' : Math.random() < 0.25 ? 'cower' : 'flee';
    if (cause === 'punch') this.bark(p, 'punched'); else this.bark(p, 'hit');
    this.game.onPedHurt?.(p, cause);
    // Everyone nearby gets jumpy.
    this.forEachNear(p.h.x, p.h.z, 18, o => { if (o !== p && (o.state === 'walk' || o.state === 'idle' || o.state === 'phone')) { o.state = Math.random() < 0.3 ? 'cower' : 'flee'; o.t = 6 + Math.random() * 4; } });
  }

  /**
   * Hit by a bullet, a pan or a blast for `dmg` against their health (100, police 130), shoved at
   * (vx, vz). At nothing they are knocked out for good, and so is anyone shot again while down, as
   * in GTA. A story fight's target counts every hit toward beating them (on the ground too) and is
   * never knocked out. Returns 'dead', 'hit' or null.
   */
  shot(p, dmg, vx, vz, cause = 'shot') {
    if (p.state === 'dead') return null;
    if (p.mission && p.needHits) {
      if (p.state === 'down' || p.state === 'getup') { p.hits++; this.game.onPedHurt?.(p, cause); } else this.knock(p, vx, vz, 1.6 + Math.random() * 0.6, cause);
      return 'hit';
    }
    p.health ??= p.cop || p.h.outfit?.kind === 'police' ? COP_HEALTH : PED_HEALTH;
    p.health -= dmg;
    const down = p.state === 'down' || p.state === 'getup';
    if (p.health <= 0 || (down && cause === 'shot')) { this.kill(p, vx * (down ? 0.2 : 1), vz * (down ? 0.2 : 1), cause); return 'dead'; }
    if (down) return 'hit';
    // An officer, or anyone squaring up to the player, flinches at a bullet and fights on (knocked
    // down by every rifle round, they lay out of reach of the next for seconds at a time).
    if (cause === 'shot' && (p.cop || p.state === 'fight')) {
      this._keepRole(p);
      p.hits++; p.cool = Math.max(p.cool, 0.35); p.h.recoil = 1;
      p.h.x += vx * 0.04; p.h.z += vz * 0.04;
      this.bark(p, 'hit');
      this.game.onPedHurt?.(p, cause);
      return 'hit';
    }
    // A hard hit puts them down; a lighter one sends them running.
    if (cause === 'explosion' || dmg >= 40 || Math.random() < dmg / 70) this.knock(p, vx, vz, 1.4 + Math.random() * 0.8, cause);
    else {
      this._keepRole(p);
      p.hits++;
      if (!(p.cop || p.state === 'fight')) { p.state = Math.random() < 0.2 ? 'cower' : 'flee'; p.t = 10; }
      this.bark(p, 'hit');
      this.game.onPedHurt?.(p, cause);
    }
    return 'hit';
  }

  /** Knocked out for good: down where they fall, still, and gone once nobody is looking (no blood: CONTRIBUTING). */
  kill(p, vx = 0, vz = 0, cause = 'shot') {
    if (p.state === 'dead') return;
    p.state = 'dead'; p.t = 0; p.vx = vx; p.vz = vz; p.vy = Math.min(3, Math.hypot(vx, vz) * 0.3);
    p.health = 0; p.hits++; p.keep = false; p.blip = null; p.role = null; p.after = null; p.grudge = 0; p.armed = null;
    const h = p.h;
    h.pose = 'lie'; h.speed = 0; h.punch = 0; h.guard = 0; h.lookYaw = 0; h.gun = null; h.aim = 0; h.hold = 'none';
    this.game.onPedHurt?.(p, cause);
    this.forEachNear(h.x, h.z, 25, o => { if (o !== p && (o.state === 'walk' || o.state === 'idle' || o.state === 'phone')) { o.state = Math.random() < 0.3 ? 'cower' : 'flee'; o.t = 8 + Math.random() * 4; } });
  }

  /** Gunfire at (x, z): everyone within earshot just going about their day runs or ducks (a fare waving for a ride too). */
  gunfire(x, z, r = 40) {
    this.panic = 1;
    this.forEachNear(x, z, r, o => {
      if (o.state !== 'walk' && o.state !== 'idle' && o.state !== 'phone' && o.state !== 'hail') return;
      this._keepRole(o);
      o.state = Math.random() < 0.3 ? 'cower' : 'flee'; o.t = 6 + Math.random() * 5;
      if (Math.random() < 0.25) this.bark(o, 'flee');
    });
  }

  /** Can a body lying at h be seen? In front of the camera and within 70 m (no camera: within 40 m of the player). */
  _inView(h) {
    const g = this.game, cam = g.camera3;
    if (!cam?.quaternion) return dist(h.x, h.z, g.player.x, g.player.z) < 40;
    const q = cam.quaternion, dx = h.x - cam.position.x, dy = (h.y || 0) - cam.position.y, dz = h.z - cam.position.z, d = Math.hypot(dx, dy, dz);
    if (d > 70) return false;
    if (d < 3) return true;
    const fx = -2 * (q.x * q.z + q.w * q.y), fy = -2 * (q.y * q.z - q.w * q.x), fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
    return (dx * fx + dy * fy + dz * fz) / d > 0.45; // inside ~63° of the view's centre: the widest a phone's screen shows
  }

  /** Thrown along the ground in steps of 20 cm or less (a hard throw on a phone's long frame stops at a wall), then down onto the floor. */
  _tumble(p, dt) {
    const g = this.game, h = p.h;
    const steps = clamp(Math.ceil(Math.hypot(p.vx, p.vz) * dt / 0.2), 1, 8), c = this._c, o = this._o;
    for (let k = 0; k < steps; k++) {
      h.x += p.vx * dt / steps; h.z += p.vz * dt / steps;
      c.x = h.x; c.z = h.z;
      if (g.colliders.resolveCircle(c, 0.3, o, Infinity, this._level(h))) {
        h.x = c.x; h.z = c.z;
        const vn = p.vx * o.nx + p.vz * o.nz;
        if (vn < 0) { p.vx -= vn * o.nx; p.vz -= vn * o.nz; }
      }
    }
    // Down onto whatever is under them: the footpath, a flyover's deck, the ground.
    const floor = this._floor(p);
    p.vy = (p.vy || 0) - 18 * dt;
    h.y = Math.max(floor, (h.y || 0) + p.vy * dt);
    const slow = Math.exp(-dt * (h.y > floor + 0.05 ? 0.3 : 4));
    p.vx *= slow; p.vz *= slow;
  }

  _update(p, dt) {
    const g = this.game, h = p.h, net = this.net;
    p.t -= dt; p.barkCool = (p.barkCool || 0) - dt; p.cool -= dt;
    h.t += dt;
    const player = g.player, pp = player.pos;
    const dpx = h.x - pp.x, dpz = h.z - pp.z, dPlayer = Math.hypot(dpx, dpz);
    // Vehicles: dive out of the way, or get hit.
    if (p.state !== 'down' && p.state !== 'dead') {
      for (const v of g.vehicles.list) {
        const dx = h.x - v.x, dz = h.z - v.z;
        if (Math.abs(v.y - (h.y || 0)) > 1.5 || dx * dx + dz * dz > 120) continue; // one of them up on a flyover
        const spd = speedOf(v);
        const c = Math.cos(v.heading), s = Math.sin(v.heading);
        const lx = dx * c - dz * s, lz = dx * s + dz * c;
        if (Math.abs(lx) < v.hw + 0.3 && Math.abs(lz) < v.hd + 0.3) {
          // Run over only by a vehicle coming at them: one pulling away from someone at its back or
          // side leaves them behind (not a hit-and-run on the cop who ran up to the player's car).
          if ((v.vx * dx + v.vz * dz) / Math.max(Math.hypot(dx, dz), 0.1) > 3.5) {
            // Thrown on with the car, and off to whichever side of it they were.
            this.knock(p, v.vx * 0.9 + c * lx * 1.5, v.vz * 0.9 - s * lx * 1.5, 2.5 + Math.random() * 2, 'vehicle');
            g.onPedHitByVehicle?.(p, v, spd);
          } else {
            // Shoved aside by a crawling, parked or passing car; walkers then step round it.
            const push = (v.hw + 0.3 - Math.abs(lx)) * Math.sign(lx || 1);
            h.x += c * push; h.z -= s * push;
            p.shoveX += c * push; p.shoveZ -= s * push;
          }
        } else if (spd > 8 && v.role === 'player' && lz > 0 && lz < 14 && Math.abs(lx) < v.hw + 1.2 && p.state !== 'dive' && p.state !== 'hail' && p.state !== 'scripted') {
          // Leap aside (not a fare waving the player down, nor a story's actor).
          const side = Math.sign(lx || (Math.random() - 0.5));
          p.state = 'dive'; p.t = 0.6;
          p.vx = c * side * 6.5; p.vz = -s * side * 6.5;
          this.bark(p, 'dive');
        }
      }
    }
    switch (p.state) {
      case 'down':
        h.pose = 'lie';
        this._tumble(p, dt);
        if (p.t <= 0) { p.state = 'getup'; p.t = GETUP_TIME; }
        break;
      case 'dead':
        // Lying still where they fell (p.t counts down from 0: how long ago), gone once out of
        // sight a while, or after two minutes whatever.
        h.pose = 'lie'; h.speed = 0;
        if (Math.hypot(p.vx, p.vz) > 0.05 || h.y > this._floor(p) + 0.02) this._tumble(p, dt);
        if ((p.t < -6 && !this._inView(h)) || p.t < -120) p.gone = true;
        break;
      case 'getup':
        h.pose = 'getup';
        if (p.t <= 0) { p.state = p.after || 'flee'; p.t = p.state === 'cower' ? 5 : 10; if (p.state === 'fight') this.bark(p, 'fight'); }
        break;
      case 'dive':
        h.x += p.vx * dt; h.z += p.vz * dt; h.pose = 'dive'; h.speed = 6;
        h.yaw = Math.atan2(p.vx, p.vz);
        if (p.t <= 0) { p.state = Math.random() < 0.5 ? 'flee' : 'walk'; p.t = 4; }
        break;
      case 'flee': {
        // Run away from the player.
        const away = Math.atan2(dpx, dpz);
        h.yaw = dampAngle(h.yaw, away + Math.sin(g.time * 2 + p.id) * 0.3, 6, dt);
        const sp = 5.6;
        h.x += Math.sin(h.yaw) * sp * dt; h.z += Math.cos(h.yaw) * sp * dt;
        h.pose = 'run'; h.speed = sp;
        if (p.t < 0 && (dPlayer > 30 || (p.role && p.keep))) this._calm(p);
        if (Math.random() < dt * 0.3) this.bark(p, 'flee');
        break;
      }
      case 'cower':
        h.pose = 'cower'; h.speed = 0;
        if (p.t <= 0) { p.t = 6; if (dPlayer < 12) p.state = 'flee'; else this._calm(p); }
        break;
      case 'fight': {
        // Square up to the player. A bystander gives up after a while, or once the player is far
        // off, out of reach (up on a flyover) or driving; a cop on the job keeps after them, on
        // foot, until the police stand down (police.js).
        const to = Math.atan2(-dpx, -dpz);
        h.yaw = dampAngle(h.yaw, to, 10, dt);
        h.aim = 0;
        const apart = Math.abs((h.y || 0) - (pp.y || 0)) > 1.5;
        if (!(p.cop && p.keep) && (player.state === 'driving' || dPlayer > 25 || apart || p.t < -14)) { p.state = 'flee'; p.t = 5; break; }
        // In to arm's reach of someone on foot; up to a step from the car they're in, not into it
        // (pressed against it as it pulls away, a cop would be run over). An armed officer (three
        // stars and up) who can see the player stops at range and shoots instead; close in, they
        // still go for the arrest.
        const car = player.vehicle, W = g.weapons;
        // Never a gun at a holy place: there they go for the arrest (the player's gun is put away there too).
        const holy = W?.inHoly?.(pp.x, pp.z) || W?.inHoly?.(h.x, h.z);
        if (p.armed && !apart && !holy && dPlayer > 4 && dPlayer < 40 && this._sees(p, pp, dt)) {
          const sp = dPlayer > 20 ? 3.2 : 0;
          if (sp) { h.x += Math.sin(h.yaw) * sp * dt; h.z += Math.cos(h.yaw) * sp * dt; }
          h.pose = sp ? 'walk' : 'idle'; h.speed = sp;
          h.aim = 1; h.aimYaw = 0; h.aimPitch = Math.atan2((pp.y || 0) + 1.1 - (h.y || 0) - 1.45, dPlayer);
          if (p.cool <= 0) { p.cool = p.armed === 'm416' ? 0.3 + Math.random() * 0.3 : 0.9 + Math.random() * 0.6; g.pedShoots?.(p); }
        } else if (car ? !this._byVehicle(car, h.x, h.z, 0.8) : dPlayer > 1.15) {
          const sp = 4.2;
          h.x += Math.sin(h.yaw) * sp * dt; h.z += Math.cos(h.yaw) * sp * dt;
          h.pose = 'run'; h.speed = sp;
        } else {
          h.pose = 'idle'; h.speed = 0;
          if (p.cool <= 0 && !apart && !car) { p.cool = 0.9 + Math.random() * 0.5; p.punchT = 0.3; g.pedAttacks?.(p, h.outfit.kind === 'police' ? 7 : 5); }
        }
        if (p.punchT > 0) { p.punchT -= dt; h.punch = 1 - p.punchT / 0.3; } else h.punch = 0;
        break;
      }
      case 'idle': case 'phone':
        h.pose = p.state === 'phone' ? 'phone' : 'idle'; h.speed = 0;
        if (p.t <= 0) { p.state = 'walk'; }
        if (dPlayer < 3 && player.state === 'foot') h.lookYaw = clamp(wrapAngle(Math.atan2(-dpx, -dpz) - h.yaw), -1, 1);
        else h.lookYaw *= 0.9;
        break;
      case 'hail': case 'scripted': {
        // A fare waving down a ride at their spot at the kerb, or a story's actor at theirs (posed
        // by the story until a scare). First back to the spot if a scare moved them off it (not
        // for ever: held up on the way, they stay wherever they are), then wave, or stand.
        if (p.state === 'scripted' && !p.role) break;
        const bx = (p.homeX ?? h.x) - h.x, bz = (p.homeZ ?? h.z) - h.z, back = Math.hypot(bx, bz);
        if (back > 0.5 && (p.backT = (p.backT || 0) + dt) < 40) {
          const sp = p.homeSpeed || 1.4, step = Math.min(back, sp * dt) / back;
          h.yaw = dampAngle(h.yaw, Math.atan2(bx, bz), 8, dt);
          h.x += bx * step; h.z += bz * step;
          h.pose = 'walk'; h.speed = sp;
        } else {
          h.pose = p.state === 'hail' ? 'wave' : 'idle'; h.speed = 0;
          h.yaw = dampAngle(h.yaw, Math.atan2(-dpx, -dpz), 3, dt);
        }
        break;
      }
      default: this._walk(p, dt);
    }
    // Fists up when squaring up to the player. Out of a fight the fists come down (mid-punch,
    // too), and the head turns back from the player once they stop standing about.
    h.guard = p.state === 'fight' && dPlayer < 4 && !p.armed ? 1 : 0;
    if (p.state !== 'fight') { h.punch = 0; p.punchT = 0; }
    // An officer's gun: in hand while on their feet, raised only while shooting (the fight case).
    if (p.armed || h.gun) {
      const up = p.armed && p.state !== 'down' && p.state !== 'getup' && p.state !== 'dead';
      h.gun = up ? p.armed : null; h.hold = up ? WEAPONS[p.armed].hold : 'none';
      if (!up || p.state !== 'fight' || h.guard || h.speed > 3.5) h.aim = 0;
    }
    if (p.state !== 'idle' && p.state !== 'phone') h.lookYaw = 0;
    // Global panic: wanted chases and crashes scatter people.
    if ((p.state === 'walk' || p.state === 'idle' || p.state === 'phone') && g.police?.level >= 2 && dPlayer < 14 && player.state === 'foot') { p.state = 'flee'; p.t = 6; }
    // Stay out of buildings (walkers do this in _walk, stepping round what they meet; a story
    // stands its actors where it wants them, until a scare sets them moving).
    if (p.state !== 'walk') p.shoveX = p.shoveZ = 0;
    if (p.state !== 'walk' && !(p.state === 'scripted' && !p.role) && p.state !== 'down' && p.state !== 'dead') {
      const c = this._c; c.x = h.x; c.z = h.z;
      if (g.colliders.resolveCircle(c, 0.3, this._o, Infinity, this._level(h))) { h.x = c.x; h.z = c.z; if (p.state === 'flee') h.yaw += 0.8; }
    }
    // People push past each other and the player.
    if (dPlayer < 0.7 && player.state === 'foot' && p.state !== 'down' && p.state !== 'dead') {
      const k = (0.7 - dPlayer) / Math.max(dPlayer, 0.05);
      h.x += dpx * k * 0.5; h.z += dpz * k * 0.5;
    }
    // On whatever is under them, whatever they're doing (the fallen land on it above).
    if (p.state !== 'down' && p.state !== 'dead') h.y = this._floor(p);
  }

  /**
   * Does officer p have a clear line to the player (at pos), as a bullet would (posts, trunks, a
   * flyover's piers and parked cars are cover, as they are from the player's bullets)? Looked at
   * again every 0.4 s.
   */
  _sees(p, pos, dt) {
    if ((p.losT = (p.losT || 0) - dt) > 0) return p.los;
    p.losT = 0.4;
    const g = this.game, h = p.h, col = g.colliders, W = g.weapons;
    const ax = h.x, ay = (h.y || 0) + 1.5, az = h.z, bx = pos.x, by = (pos.y || 0) + 1.3, bz = pos.z;
    p.los = W?.clearLine ? W.clearLine(ax, ay, az, bx, by, bz, g.player.vehicle) : !col?.raycast || col.raycast(ax, ay, az, bx, by, bz, 0.05) >= 0.999;
    return p.los;
  }

  _walk(p, dt) {
    const net = this.net, h = p.h, g = this.game;
    if (p.road === null || p.road === undefined) {
      // No street to walk (yet): stand, and look again now and then.
      if ((p.lookT = (p.lookT || 0) - dt) <= 0) { p.lookT = 1; this._resnap(p); }
      if (p.road === null || p.road === undefined) { h.pose = 'idle'; h.speed = 0; return; }
    }
    const len = net.length[p.road];
    p.s += p.speed * dt;
    if (p.s > len - 0.5) {
      // Next street at the junction; sometimes stop for a chat.
      const j = p.dir > 0 ? net.rb[p.road] : net.ra[p.road];
      const roads = net.jRoads[j].filter(r => r !== p.road && !net.bridge[r] && !net.raised[r]);
      const r = rng(hash2(p.id, Math.floor(this.game.time)));
      // Up on a flyover, with no street to step onto yet: on the way it leads down.
      const next = roads.length ? r.pick(roads) : net.raised[p.road] ? this._downDeck(p.road, j) : p.road;
      p.dir = next === p.road ? -p.dir : net.ra[next] === j ? 1 : -1;
      p.road = next; p.s = 0.5;
      p.side = net.kerbSide(next) || (r.chance(0.5) ? -p.side : p.side);
      if (r.chance(0.08)) { p.state = 'idle'; p.t = r.range(3, 10); }
      return;
    }
    const pt = net.pointAt(p.road, p.dir > 0 ? p.s : len - p.s, this._p);
    // Outward (away from the road) and forward (the way they walk).
    const nx = pt.dz * p.side, nz = -pt.dx * p.side;
    const fx = p.dir > 0 ? pt.dx : -pt.dx, fz = p.dir > 0 ? pt.dz : -pt.dz;
    p.fx = fx; p.fz = fz; p.nx = nx; p.nz = nz;
    const off = this._offset(p.road) + p.lat;
    const tx = pt.x + nx * off, tz = pt.z + nz * off;
    const dx = tx - h.x, dz = tz - h.z, d = Math.hypot(dx, dz);
    // Ease toward the walking line (smooth corners and re-joins).
    if (d > 0.01) {
      const k = Math.min(1, (p.speed * 1.4 * dt) / d);
      h.x += dx * k; h.z += dz * k;
      h.yaw = dampAngle(h.yaw, Math.atan2(dx, dz), 8, dt);
    }
    // Up on the footpath where the street has one (feet sank 20 cm into it before).
    p.pave = g.city.pavementAt(pt.seg, off);
    if (d > 3) p.s -= p.speed * dt * 0.8; // let them catch up to the line
    // Bump into the world (posts, stalls, platforms, walls, a parked car): the push becomes a
    // sidestep, and they drift back to their line as soon as it is clear a stride ahead (so
    // nobody lingers at the road edge in front of traffic).
    const c = this._c; c.x = h.x; c.z = h.z;
    let px = p.shoveX, pz = p.shoveZ;
    p.shoveX = p.shoveZ = 0;
    if (g.colliders.resolveCircle(c, PED_R, this._o, Infinity, this._level(h))) { px += c.x - h.x; pz += c.z - h.z; h.x = c.x; h.z = c.z; }
    if (px * px + pz * pz > 1e-6) {
      const side = px * nx + pz * nz;
      const step = (Math.abs(side) > 0.005 ? Math.sign(side) : -1) * Math.min(0.25, 0.08 + Math.hypot(px, pz) * 2);
      p.lat = this._sidestep(p.road, p.lat + step);
      p.latHold = 0.4;
      // Pushed back against the way they are walking: held up.
      if (px * fx + pz * fz < -0.004) p.stuck += dt; else p.stuck = Math.max(0, p.stuck - dt * 0.5);
    } else {
      p.latHold -= dt;
      if (p.latHold <= 0 && p.lat !== 0) {
        const lat = Math.abs(p.lat) < 0.02 ? 0 : p.lat * Math.exp(-dt * 2.5), o = this._offset(p.road) + lat;
        if (!g.colliders.blocked(pt.x + nx * o + fx * 0.7, pt.z + nz * o + fz * 0.7, PED_R)) p.lat = lat;
        else p.latHold = 0.25;
      }
      p.stuck = Math.max(0, p.stuck - dt);
    }
    // Truly blocked (a stall across a narrow kerb, a corner): turn back the way they came.
    if (p.stuck > 1.2) { p.dir = -p.dir; p.s = Math.max(0.5, len - p.s); p.stuck = 0; p.lat = 0; p.latHold = 0; }
    h.pose = 'walk'; h.speed = p.speed;
    p.onRoadOk = false;
  }

  /**
   * Up on a flyover at its junction j, coming along `road`: the road on from there whose far end
   * is lowest (a river bridge at the ramp's foot, or the deck that leads down; back along `road`
   * if that is lower still), so they follow its ramps down to the ground.
   */
  _downDeck(road, j) {
    const net = this.net, end = r => (net.raised[r] ? net.jDeck[net.otherEnd(r, j)] : 0);
    let best = road, low = end(road);
    for (const o of net.jRoads[j]) if (o !== road && end(o) <= low) { best = o; low = end(o); }
    return best;
  }

  _resnap(p) {
    const net = this.net, h = p.h;
    // A street at their level: the deck (or ramp) they're up on, else never a flyover overhead,
    // and a river bridge only for someone out on it (from the bank they'd walk into its railing).
    // Someone who ran off across open ground heads back to the nearest street, however far.
    const up = h.y > 0.3 && net.surfaceAt(h.x, h.z, h.y) > 0.3;
    let n = net.nearest(h.x, h.z, 30, this._q, up ? this._deck : this._ground);
    if (n && !up && net.bridge[n.road] && n.dist > net.width[n.road] / 2 + 0.4) n = net.nearest(h.x, h.z, 30, this._q, this._street);
    n ||= net.nearest(h.x, h.z, 200, this._q, up ? this._deck : this._street);
    if (!n) { p.road = null; return; }
    // Out of a seat or a scene, they have no pace of their own yet: an everyday one.
    if (!p.speed) p.speed = 1.1 + (p.id % 10) * 0.045;
    p.road = n.road; p.dir = Math.random() < 0.5 ? 1 : -1; p.lat = 0; p.stuck = 0;
    // On a deck, the way it comes down.
    if (up) p.dir = net.jDeck[net.rb[n.road]] < net.jDeck[net.ra[n.road]] ? 1 : -1;
    p.s = p.dir > 0 ? n.s : this.net.length[n.road] - n.s;
    const lx = p.h.x - n.x, lz = p.h.z - n.z;
    p.side = this.net.kerbSide(n.road) || (lx * n.dz - lz * n.dx >= 0 ? 1 : -1);
  }

  /** Player punch: the nearest person in front within reach goes down. */
  punchFrom(player) {
    const fx = Math.sin(player.heading), fz = Math.cos(player.heading);
    let best = null, bd = 1.6;
    for (const p of this.list) {
      if (p.state === 'down' || p.state === 'dead' || Math.abs((p.h.y || 0) - (player.y || 0)) > 1.5) continue; // not through a flyover's deck
      const dx = p.h.x - player.x, dz = p.h.z - player.z, d = Math.hypot(dx, dz);
      if (d > bd || d < 0.01) continue;
      if ((dx * fx + dz * fz) / d < 0.45) continue;
      best = p; bd = d;
    }
    if (!best) return null;
    const strong = player.combo === 2;
    if (strong || best.hits >= 1 || Math.random() < 0.55) this.knock(best, fx * (strong ? 5 : 3), fz * (strong ? 5 : 3), 1.8 + Math.random(), 'punch');
    else { this._keepRole(best); best.state = best.grudge || Math.random() < 0.4 ? 'fight' : 'flee'; best.t = 8; best.hits++; this.bark(best, best.state === 'fight' ? 'fight' : 'punched'); this.game.onPedHurt?.(best, 'punch'); }
    return best;
  }

  remove(p) { const i = this.list.indexOf(p); if (i >= 0) this.list.splice(i, 1); this.game.humans.remove(p.h); }
}
