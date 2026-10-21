// People on foot: they walk the lane edges and footpaths, cross at junctions,
// jump out of the way, get knocked down, and run, cower or fight back.
import { clamp, dist, rng, hash2, wrapAngle, dampAngle, headingTo } from '../core/math.js';
import { makeOutfit } from './humans.js';
import { speedOf } from './vehicle-physics.js';
import { ZONE } from '../world/citygen.js';

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
    this._p = {}; this._q = {}; this._o = {}; this._c = { x: 0, z: 0 };
    this.panic = 0;
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
    const p = { h, road, dir: 1, s: 0, side: 1, speed: 0, state: 'walk', t: 0, after: null, vx: 0, vz: 0, hits: 0, grudge: 0, cool: 0, onRoadOk: false, id: this.seed++ };
    h.x = x; h.z = z;
    this.list.push(p);
    return p;
  }

  update(dt) {
    const g = this.game, focus = g.player.pos;
    const target = g.quality.settings.peds * (g.pedScale ?? 1);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      if (dist(p.h.x, p.h.z, focus.x, focus.z) > 150 && !p.keep) { g.humans.remove(p.h); this.list.splice(i, 1); }
    }
    this.spawnT -= dt;
    let budget = this.list.length < target * 0.5 ? 8 : 2;
    while (this.list.length < target && budget-- > 0 && this.spawnT <= 0) {
      if (!this._spawn(focus, this.list.length < target * 0.5 ? 20 : 60, 115)) { this.spawnT = 0.15; break; }
    }
    this.panic = Math.max(0, this.panic - dt * 0.1);
    for (const p of this.list) this._update(p, dt);
  }

  _spawn(focus, minD, maxD) {
    const g = this.game, net = this.net;
    const r = rng(hash2(this.seed++, 5153));
    const ang = r() * Math.PI * 2, d = r.range(minD, maxD);
    const n = net.nearest(focus.x + Math.cos(ang) * d, focus.z + Math.sin(ang) * d, 40, this._q);
    if (!n || net.bridge[n.road]) return false;
    const road = n.road, side = r.chance(0.5) ? 1 : -1;
    const off = this._offset(road);
    const x = n.x + n.dz * off * side, z = n.z - n.dx * off * side;
    if (g.colliders.blocked(x, z, 0.3)) return false;
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

  _offset(road) {
    const w = this.net.width[road];
    return w >= 8 ? w / 2 + 0.95 : w / 2 + 0.45;
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
    p.state = 'down'; p.t = seconds; p.vx = vx; p.vz = vz; p.vy = Math.min(6, Math.hypot(vx, vz) * 0.35);
    p.hits++;
    p.h.pose = 'lie';
    p.after = p.h.outfit.kind === 'police' ? 'fight' : p.grudge > 0 || (cause === 'punch' && Math.random() < 0.3 && p.hits < 3) ? 'fight' : Math.random() < 0.25 ? 'cower' : 'flee';
    if (cause === 'punch') this.bark(p, 'punched'); else this.bark(p, 'hit');
    this.game.onPedHurt?.(p, cause);
    // Everyone nearby gets jumpy.
    this.forEachNear(p.h.x, p.h.z, 18, o => { if (o !== p && (o.state === 'walk' || o.state === 'idle' || o.state === 'phone')) { o.state = Math.random() < 0.3 ? 'cower' : 'flee'; o.t = 6 + Math.random() * 4; } });
  }

  _update(p, dt) {
    const g = this.game, h = p.h, net = this.net;
    p.t -= dt; p.barkCool = (p.barkCool || 0) - dt; p.cool -= dt;
    h.t += dt;
    const player = g.player, pp = player.pos;
    const dpx = h.x - pp.x, dpz = h.z - pp.z, dPlayer = Math.hypot(dpx, dpz);
    // Vehicles: dive out of the way, or get hit.
    if (p.state !== 'down') {
      for (const v of g.vehicles.list) {
        const dx = h.x - v.x, dz = h.z - v.z;
        if (dx * dx + dz * dz > 120) continue;
        const spd = speedOf(v);
        const c = Math.cos(v.heading), s = Math.sin(v.heading);
        const lx = dx * c - dz * s, lz = dx * s + dz * c;
        if (Math.abs(lx) < v.hw + 0.3 && Math.abs(lz) < v.hd + 0.3) {
          if (spd > 3.5) {
            this.knock(p, v.vx * 0.9 + lx * 1.5, v.vz * 0.9, 2.5 + Math.random() * 2, 'vehicle');
            g.onPedHitByVehicle?.(p, v, spd);
          } else {
            // Shoved aside by a crawling car.
            const push = (v.hw + 0.3 - Math.abs(lx)) * Math.sign(lx || 1);
            h.x += c * push; h.z -= s * push;
          }
        } else if (spd > 8 && v.role === 'player' && lz > 0 && lz < 14 && Math.abs(lx) < v.hw + 1.2 && p.state !== 'dive') {
          // Leap aside.
          const side = Math.sign(lx || (Math.random() - 0.5));
          p.state = 'dive'; p.t = 0.6;
          p.vx = c * side * 6.5; p.vz = -s * side * 6.5;
          this.bark(p, 'dive');
        }
      }
    }
    switch (p.state) {
      case 'down': {
        h.pose = 'lie';
        p.vy = (p.vy || 0) - 18 * dt;
        h.y = Math.max(0, (h.y || 0) + (p.vy || 0) * dt);
        h.x += p.vx * dt; h.z += p.vz * dt;
        p.vx *= Math.exp(-dt * (h.y > 0.05 ? 0.3 : 4)); p.vz *= Math.exp(-dt * (h.y > 0.05 ? 0.3 : 4));
        h.pitch = -1.45 * clamp((2.6 - p.t) * 4, 0, 1);
        if (p.t <= 0) { p.state = 'getup'; p.t = 0.7; }
        break;
      }
      case 'getup':
        h.pose = 'cower'; h.pitch = -1.45 * clamp(p.t / 0.7, 0, 1);
        if (p.t <= 0) { h.pitch = 0; p.state = p.after || 'flee'; p.t = p.state === 'cower' ? 5 : 10; if (p.state === 'fight') this.bark(p, 'fight'); }
        break;
      case 'dive':
        h.x += p.vx * dt; h.z += p.vz * dt; h.pose = 'run'; h.speed = 6;
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
        if (p.t < 0 && dPlayer > 30) { p.state = 'walk'; this._resnap(p); }
        if (Math.random() < dt * 0.3) this.bark(p, 'flee');
        break;
      }
      case 'cower':
        h.pose = 'cower'; h.speed = 0;
        if (p.t <= 0) { p.state = dPlayer < 12 ? 'flee' : 'walk'; p.t = 6; if (p.state === 'walk') this._resnap(p); }
        break;
      case 'fight': {
        // Square up to the player; give up after a while or once they're far away.
        const to = Math.atan2(-dpx, -dpz);
        h.yaw = dampAngle(h.yaw, to, 10, dt);
        if (player.state === 'driving' || dPlayer > 25 || p.t < -14) { p.state = 'flee'; p.t = 5; break; }
        if (dPlayer > 1.15) {
          const sp = 4.2;
          h.x += Math.sin(h.yaw) * sp * dt; h.z += Math.cos(h.yaw) * sp * dt;
          h.pose = 'run'; h.speed = sp;
        } else {
          h.pose = 'idle'; h.speed = 0;
          if (p.cool <= 0) { p.cool = 0.9 + Math.random() * 0.5; p.punchT = 0.3; g.pedAttacks?.(p, h.outfit.kind === 'police' ? 7 : 5); }
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
      case 'hail':
        h.pose = 'wave'; h.speed = 0;
        h.yaw = dampAngle(h.yaw, Math.atan2(-dpx, -dpz), 3, dt);
        break;
      case 'scripted':
        break;
      default: this._walk(p, dt);
    }
    // Global panic: wanted chases and crashes scatter people.
    if ((p.state === 'walk' || p.state === 'idle' || p.state === 'phone') && g.police?.level >= 2 && dPlayer < 14 && player.state === 'foot') { p.state = 'flee'; p.t = 6; }
    // Stay out of buildings.
    if (p.state !== 'walk' && p.state !== 'scripted') {
      const c = this._c; c.x = h.x; c.z = h.z;
      if (g.colliders.resolveCircle(c, 0.3, this._o)) { h.x = c.x; h.z = c.z; if (p.state === 'flee') h.yaw += 0.8; }
    }
    // People push past each other and the player.
    if (dPlayer < 0.7 && player.state === 'foot' && p.state !== 'down') {
      const k = (0.7 - dPlayer) / Math.max(dPlayer, 0.05);
      h.x += dpx * k * 0.5; h.z += dpz * k * 0.5;
    }
    if (p.state !== 'down') h.y = g.city.groundHeight(h.x, h.z);
  }

  _walk(p, dt) {
    const net = this.net, h = p.h;
    if (p.road === null || p.road === undefined) { this._resnap(p); if (p.road === null) return; }
    const len = net.length[p.road];
    p.s += p.speed * dt;
    if (p.s > len - 0.5) {
      // Next street at the junction; sometimes stop for a chat.
      const j = p.dir > 0 ? net.rb[p.road] : net.ra[p.road];
      const roads = net.jRoads[j].filter(r => r !== p.road && !net.bridge[r]);
      const r = rng(hash2(p.id, Math.floor(this.game.time)));
      const next = roads.length ? r.pick(roads) : p.road;
      p.dir = next === p.road ? -p.dir : net.ra[next] === j ? 1 : -1;
      p.road = next; p.s = 0.5;
      if (r.chance(0.5)) p.side = -p.side;
      if (r.chance(0.08)) { p.state = 'idle'; p.t = r.range(3, 10); }
      return;
    }
    const pt = net.pointAt(p.road, p.dir > 0 ? p.s : len - p.s, this._p);
    const off = this._offset(p.road) * p.side;
    const tx = pt.x + pt.dz * off, tz = pt.z - pt.dx * off;
    const dx = tx - h.x, dz = tz - h.z, d = Math.hypot(dx, dz);
    // Ease toward the walking line (smooth corners and re-joins).
    if (d > 0.01) {
      const k = Math.min(1, (p.speed * 1.4 * dt) / d);
      h.x += dx * k; h.z += dz * k;
      h.yaw = dampAngle(h.yaw, Math.atan2(dx, dz), 8, dt);
    }
    if (d > 3) p.s -= p.speed * dt * 0.8; // let them catch up to the line
    h.pose = 'walk'; h.speed = p.speed;
    p.onRoadOk = false;
  }

  _resnap(p) {
    const n = this.net.nearest(p.h.x, p.h.z, 30, this._q);
    if (!n) { p.road = null; return; }
    p.road = n.road; p.dir = Math.random() < 0.5 ? 1 : -1;
    p.s = p.dir > 0 ? n.s : this.net.length[n.road] - n.s;
    const lx = p.h.x - n.x, lz = p.h.z - n.z;
    p.side = lx * n.dz - lz * n.dx >= 0 ? 1 : -1;
  }

  /** Player punch: the nearest person in front within reach goes down. */
  punchFrom(player) {
    const fx = Math.sin(player.heading), fz = Math.cos(player.heading);
    let best = null, bd = 1.6;
    for (const p of this.list) {
      if (p.state === 'down') continue;
      const dx = p.h.x - player.x, dz = p.h.z - player.z, d = Math.hypot(dx, dz);
      if (d > bd || d < 0.01) continue;
      if ((dx * fx + dz * fz) / d < 0.45) continue;
      best = p; bd = d;
    }
    if (!best) return null;
    const strong = player.combo === 2;
    if (strong || best.hits >= 1 || Math.random() < 0.55) this.knock(best, fx * (strong ? 5 : 3), fz * (strong ? 5 : 3), 1.8 + Math.random(), 'punch');
    else { best.state = best.grudge || Math.random() < 0.4 ? 'fight' : 'flee'; best.t = 8; best.hits++; this.bark(best, best.state === 'fight' ? 'fight' : 'punched'); this.game.onPedHurt?.(best, 'punch'); }
    return best;
  }

  remove(p) { const i = this.list.indexOf(p); if (i >= 0) this.list.splice(i, 1); this.game.humans.remove(p.h); }
}
