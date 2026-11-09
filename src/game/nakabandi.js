// Nakabandi: from three stars the police block the road ahead. Two jeeps across the carriageway
// with a chicane gap a bike can slip, yellow-black barricades out to the kerbs and constables at
// their posts; from four stars a tyre-killer strip in front of it, and at five a drone overhead
// that keeps the player seen unless they get under a flyover or a tree. Logic only (no three.js):
// nakabandi-fx.js draws the barricades, the strip and the drone.
import { dist, hash2, rng } from '../core/math.js';
import { makeOutfit } from '../actors/humans.js';
import { speedOf, burstTyre } from '../actors/vehicle-physics.js';

const CHUNK = 192; // citygen's chunk size (city.chunk index)
export const POLICE_ROLES = new Set(['police', 'roadblock', 'police-parked', 'police-idle']);
export const NAKA = {
  min: 130, max: 220, gap: 1.4, every: 25, holy: 60,
  bar: { hw: 1.0, hd: 0.22, h: 1.1 },
  strip: { ahead: 12, hd: 0.3, pull: 2 },
  fire: 45, see: 75, far: 250,
  drone: { y: 22, speed: 24, health: 60, r: 0.7, see: 90, again: 75 },
};
const BARKS = ['थांबा! गाडी बाजूला घ्या!', 'Ruko, checking chalu hai!', 'नाकाबंदी आहे, थांबा!', 'Gaadi side mein lagao!'];
const JEEP = { L: 4.15, W: 1.76, ang: 1.13 }; // across the road at 65 degrees
const JEEP_SPAN = JEEP.L * Math.sin(JEEP.ang) + JEEP.W * Math.cos(JEEP.ang);

/** Unit direction leaving junction j along road r, from a point a few metres in. */
function leaving(net, r, j, out) {
  const len = net.length[r], d = Math.min(4, len / 2);
  const p = net.pointAt(r, net.ra[r] === j ? d : len - d, out);
  if (net.ra[r] !== j) { p.dx = -p.dx; p.dz = -p.dz; }
  return p;
}

/**
 * Where to block the road ahead of a driver at (x, z) moving (vx, vz): the first junction of three
 * or more roads `min`-`max` m along the straightest way on, the block `jRadius + 6` m into the road
 * straight on from it. Null when there is none, or it is on a flyover, too narrow, near a holy place
 * (`zones`, as weapons.js keeps them: {x, z, r2}) or `occupied(x, z)` says something stands there.
 * Returns { road, s, j, x, z, ux, uz (into the road, away from the driver), twin: {road, s}|null }.
 */
export function pickSite(net, x, z, vx, vz, { min = NAKA.min, max = NAKA.max, zones = [], occupied = null } = {}) {
  const n = net.nearest(x, z, 20, {}, r => !net.raised[r]);
  if (!n) return null;
  const sp = Math.hypot(vx, vz);
  if (sp < 0.5) return null;
  const dot = vx * n.dx + vz * n.dz;
  if (Math.abs(dot) < sp * 0.3) return null; // crossing the road, not driving along it
  let road = n.road, dir = dot > 0 ? 1 : -1;
  let travelled = dir > 0 ? net.length[road] - n.s : n.s;
  let fx = n.dx * dir, fz = n.dz * dir; // heading into the junction
  const t = {};
  for (let hops = 0; hops < 8 && travelled <= max; hops++) {
    const j = dir > 0 ? net.rb[road] : net.ra[road];
    // The straightest road on from this junction.
    let best = -1, bestDot = -2;
    for (const o of net.jRoads[j] || []) {
      if (o === road) continue;
      const l = leaving(net, o, j, t), d = l.dx * fx + l.dz * fz;
      if (d > bestDot) { bestDot = d; best = o; }
    }
    if (best < 0) return null;
    if ((net.jRoads[j]?.length || 0) >= 3 && travelled >= min && bestDot > 0.5) {
      const into = net.jRadius[j] + 6, len = net.length[best];
      if (len < into + 8) return null;
      const s = net.ra[best] === j ? into : len - into;
      const p = net.pointAt(best, s, {});
      const ux = net.ra[best] === j ? p.dx : -p.dx, uz = net.ra[best] === j ? p.dz : -p.dz;
      if (net.raised[best] || net.width[best] < 4.5) return null;
      for (const zn of zones) if ((zn.x - p.x) ** 2 + (zn.z - p.z) ** 2 < (Math.sqrt(zn.r2 ?? (zn.r || 0) ** 2) + NAKA.holy) ** 2) return null;
      if (occupied?.(p.x, p.z)) return null;
      return { road: best, s, j, x: p.x, z: p.z, ux, uz, twin: net.paired?.[best] ? twinOf(net, best, s, ux, uz) : null };
    }
    if (bestDot < 0.3) return null; // the way on turns: the route is anybody's guess
    const l = leaving(net, best, j, t);
    fx = l.dx; fz = l.dz;
    road = best; dir = net.ra[best] === j ? 1 : -1;
    travelled += net.length[best];
  }
  return null;
}

/** The other carriageway of a divided road, beside road r at s (travel direction (ux, uz)): {road, s} or null. */
export function twinOf(net, r, s, ux, uz) {
  const p = net.pointAt(r, s, {});
  for (const side of [-1, 1]) {
    // Left of (ux, uz) is (uz, -ux).
    const off = net.width[r] / 2 + 3;
    const qx = p.x + uz * side * off, qz = p.z - ux * side * off;
    const q = net.nearest(qx, qz, 9, {}, o => o !== r && net.oneway[o] && !net.raised[o]);
    if (!q) continue;
    if (Math.abs(q.dx * p.dx + q.dz * p.dz) < 0.85) continue; // parallel only
    return { road: q.road, s: q.s, x: q.x, z: q.z };
  }
  return null;
}

/** Ray (o + d t, d unit, 0..len) against a sphere at c of radius r: the distance along it, or -1. */
export function raySphere(ox, oy, oz, dx, dy, dz, len, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz, tc = lx * dx + ly * dy + lz * dz;
  const d2 = lx * lx + ly * ly + lz * lz - tc * tc;
  if (d2 > r * r) return -1;
  const t = tc - Math.sqrt(r * r - d2);
  return t >= 0 && t <= len ? t : -1;
}

export class Nakabandi {
  constructor(game) {
    this.game = game;
    this.blocks = [];
    this.drone = null;
    this.cooldown = 0; // seconds until another block may go up
    this.droneT = 0; // seconds until a drone may come (after one is shot down)
    this.pickT = 0;
    this.sparkT = 0;
    this.seed = 1;
    this._free = []; // collider slots given back, reused by the next block
    this._blips = []; this._blipPool = []; this._droneBlip = { x: 0, z: 0, kind: 'drone', clamp: false };
    this._w = { x: 0, y: 0, z: 0 }; this._occ = (x, z) => game.vehicles?.list.some(v => dist(v.x, v.z, x, z) < 8);
    this._hidden = 0;
  }

  // ------------------------------------------------------------------ the frame
  update(dt) {
    const g = this.game, police = g.police, P = g.player, pos = P?.pos;
    if (!police || !pos) return;
    this.cooldown -= dt; this.droneT -= dt;
    const level = police.level;
    if (level >= 3 && !police.lock && !g.missions?.active && P.vehicle && speedOf(P.vehicle) > 8) {
      if ((this.pickT -= dt) <= 0) { this.pickT = 1; this._trySpawn(level); }
    }
    for (let i = this.blocks.length - 1; i >= 0; i--) this._tend(this.blocks[i], dt, pos);
    this._strips(dt);
    this._rimSparks(dt);
    this._fly(dt, level, pos);
  }

  _trySpawn(level) {
    const g = this.game, P = g.player, v = P.vehicle;
    const live = this.blocks.filter(b => b.state === 'up').length;
    if (this.cooldown > 0 || live >= (level >= 4 ? 2 : 1)) return;
    // Two jeep slots under the police cap (vehicles.js), or no block.
    const cap = g.vehicles.meshes?.police?.cap;
    if (cap && g.vehicles.list.reduce((n, o) => n + (o.type === 'police'), 0) > cap - 2) return;
    const site = pickSite(g.net, P.x, P.z, v.vx, v.vz, { zones: g.weapons?.zones || [], occupied: this._occ });
    if (!site || this.blocks.some(b => dist(b.x, b.z, site.x, site.z) < 40)) return;
    // Rather one round a corner than one going up in plain view: a few tries for a hidden site.
    const cam = g.camera3?.position;
    if (cam && g.colliders?.raycast && this._hidden < 3 && g.colliders.raycast(cam.x, cam.y, cam.z, site.x, 1.5, site.z, 0.05) >= 0.999) { this._hidden++; return; }
    this._hidden = 0;
    this._build(site, level);
  }

  /** Put a block up at a site from pickSite. */
  _build(site, level = this.game.police?.level ?? 3) {
    const g = this.game, net = g.net, r = rng(hash2(this.seed++, 7717));
    const { road, s, ux, uz } = site;
    const hU = Math.atan2(ux, uz), nx = uz, nz = -ux; // left of the way on
    const sideU = net.ra[road] === site.j ? 1 : -1;
    const eL = net.edgeAt(road, s, sideU), eR = net.edgeAt(road, s, -sideU), c = (eL - eR) / 2;
    const at = (lat, along, o) => { o.x = site.x + nx * lat + ux * along; o.z = site.z + nz * lat + uz * along; return o; };
    const b = { id: this.seed, road, s, x: site.x, z: site.z, ux, uz, hw: (eL + eR) / 2, c, twin: site.twin, jeeps: [], cops: [], bars: [], strip: null, state: 'up', t: 0, passed: false };
    const gap = NAKA.gap / 2, p = {};
    // Jeeps: one each side of the gap, staggered; a narrow street gets one, barricades the other side.
    const two = eL + eR >= 9.5;
    const jeepAt = (lat, along, heading) => {
      at(lat, along, p);
      const jv = g.vehicles.spawn('police', p.x, p.z, heading, { role: 'roadblock', driver: false, seed: (r() * 1e9) | 0 });
      jv.sirenOn = true; jv.keep = true; jv.naka = b.id;
      b.jeeps.push(jv);
    };
    const latA = c + gap + JEEP_SPAN / 2;
    jeepAt(latA, 0, hU + JEEP.ang);
    if (two) jeepAt(c - gap - JEEP_SPAN / 2, 3.5, hU - JEEP.ang + Math.PI);
    // Barricades out to each kerb: on the left past jeep A, on the right past jeep B (or from the gap).
    this._fence(b, road, s, at, c + gap + JEEP_SPAN, eL, 1, 0, hU, [road, site.twin?.road]);
    this._fence(b, road, s, at, two ? c - gap - JEEP_SPAN : c - gap, -eR, -1, two ? 3.5 : 0, hU, [road, site.twin?.road]);
    // The other carriageway of a divided road: barricades right across but for a gap.
    if (site.twin) {
      const tw = site.twin, tp = net.pointAt(tw.road, tw.s, {}), tl = net.edgeAt(tw.road, tw.s, 1), tr = net.edgeAt(tw.road, tw.s, -1);
      // Lay it in the block's own frame, centred on the twin's centre line.
      const toLat = (tp.x - site.x) * nx + (tp.z - site.z) * nz, tAlong = (tp.x - site.x) * ux + (tp.z - site.z) * uz;
      const half = (tl + tr) / 2;
      this._fence(b, road, s, at, toLat + gap, toLat + half, 1, tAlong, hU, [tw.road, road]);
      this._fence(b, road, s, at, toLat - gap, toLat - half, -1, tAlong, hU, [tw.road, road]);
    }
    // Constables at the gap and the kerbs.
    const nCops = level >= 5 ? 3 : 2;
    for (let k = 0; k < nCops; k++) {
      const lat = k === 0 ? c : k === 1 ? Math.min(eL - 0.8, latA + JEEP_SPAN / 2 + 1) : c - gap - 1.5;
      at(lat, -2.2 - k * 0.6, p);
      this._constable(b, p.x, p.z, hU + Math.PI, r);
    }
    // Four stars: the tyre killer across the road, 12 m before the jeeps.
    if (level >= 4) { at(c, -NAKA.strip.ahead, p); b.strip = { x: p.x, z: p.z, rot: hU, hw: b.hw, hd: NAKA.strip.hd, live: true, pullT: 0 }; }
    this.blocks.push(b);
    this.cooldown = NAKA.every;
    this._help('seenNakabandiHelp', '<b>Nakabandi!</b> Road blocked ahead (🚧). Turn off, ram the jeeps, or slip the gap on a bike.');
    if (b.strip) this._help('seenSpikeHelp', '<b>Tyre killer!</b> Anna\'s garage fixes punctures.');
    return b;
  }

  /** Barricades in a row across the road from lateral `from` toward `to` (sign `dir`), `along` m on, each kept on the road. */
  _fence(b, road, s, at, from, to, dir, along, rot, roads) {
    const B = NAKA.bar, net = this.game.net, p = {}, q = {};
    const run = (to - from) * dir;
    if (run < 0.6) return;
    const n = Math.ceil(run / (B.hw * 2));
    for (let k = 0; k < n && b.bars.length < 12; k++) {
      // The last one sits against the kerb (overlapping its neighbour) rather than past it.
      const lat = from + dir * Math.min(B.hw + k * B.hw * 2, run - B.hw);
      at(lat, along, p);
      // Half-scale junction arms overlap: a barricade that would land in a cross street is left out.
      const on = net.nearest(p.x, p.z, 6, q);
      if (!on || !roads.includes(on.road)) continue;
      const slot = this._placeBox(p.x, p.z, B.hw, B.hd, rot, B.h);
      b.bars.push({ x: p.x, z: p.z, rot, slot });
    }
  }

  _constable(b, x, z, yaw, r) {
    const g = this.game;
    if (!g.humans || !g.peds?._make) return;
    const h = g.humans.add(makeOutfit('police', (r() * 1e9) | 0), x, z);
    h.yaw = yaw; h.pose = 'idle';
    const p = g.peds._make(h, x, z, null);
    // At their post ('scripted' holds a spot and faces the player) until the player is in range.
    p.cop = true; p.keep = true; p.state = 'scripted'; p.role = 'scripted'; p.homeX = x; p.homeZ = z;
    p.armed = g.police?.level >= 5 && b.cops.length === 2 ? 'm416' : 'p92'; p.after = 'fight'; p.grudge = 2;
    p.post = { x, z, yaw };
    b.cops.push(p);
  }

  /** One block's frame: its constables, whether the player got past, and whether it can go. */
  _tend(b, dt, pos) {
    const g = this.game, P = g.player;
    b.t += dt;
    // A jeep the player drove off in is theirs now.
    b.jeeps = b.jeeps.filter(v => v.role === 'roadblock' && !v.removed);
    b.cops = b.cops.filter(p => g.peds.list.includes(p));
    const d = dist(b.x, b.z, pos.x, pos.z);
    if (b.state === 'up') {
      for (const p of b.cops) {
        if (p.state === 'dead' || p.state === 'down' || p.state === 'getup') continue;
        const dp = dist(p.h.x, p.h.z, pos.x, pos.z);
        if (p.state === 'scripted' && dp < NAKA.fire) { p.state = 'fight'; p.t = 30; this._bark(p); }
        else if (p.state === 'fight' && dp > NAKA.fire + 20) { p.state = 'scripted'; p.backT = 0; }
        else if (p.state !== 'scripted' && p.state !== 'fight') { p.state = 'fight'; p.t = 30; }
      }
      // Past it: along its road beyond the jeeps, or a jeep rammed aside.
      const ax = pos.x - b.x, az = pos.z - b.z, along = ax * b.ux + az * b.uz, lat = ax * b.uz - az * b.ux;
      const rammed = b.jeeps.some(v => !v.kinematic && v.lastHitBy === 'player');
      if (!b.passed && ((along > 6 && along < 30 && Math.abs(lat - b.c) < b.hw + 3) || rammed)) { b.passed = true; g.save?.stat?.('roadblocks'); }
    }
    // Behind the camera means behind the way the player looks.
    const cam = g.camera3, behind = cam?.getWorldDirection ? this._behind(cam, b) : false;
    // Far off (it goes up as far as 220 m along the way), left behind, or stood down and out of the way.
    if (d > NAKA.far || (d > 90 && behind) || (b.state === 'down' && d > 60)) this._remove(b);
  }

  _behind(cam, b) {
    const e = cam.matrixWorld?.elements;
    if (!e) return false;
    // The camera looks down its -z: (-e[8], -e[10]).
    return (b.x - cam.position.x) * -e[8] + (b.z - cam.position.z) * -e[10] < 0;
  }

  /** The strip: every wheel of a vehicle (not a police one) that crosses it bursts; pulled back once the player is past. */
  _strips(dt) {
    const g = this.game, pos = g.player.pos, w = this._w;
    for (const b of this.blocks) {
      const S = b.strip;
      if (!S || !S.live) continue;
      const c = Math.cos(S.rot), s = Math.sin(S.rot); // local z = (s, c) along the road, local x = (c, -s) across
      if ((pos.x - S.x) * s + (pos.z - S.z) * c > 3) { if ((S.pullT += dt) > NAKA.strip.pull) S.live = false; }
      for (const v of g.vehicles.list) {
        if (v.kinematic || POLICE_ROLES.has(v.role) || v.type === 'police' || Math.abs(v.x - S.x) > 30 || Math.abs(v.z - S.z) > 30) continue;
        const vz = v.vx * s + v.vz * c;
        for (let i = 0; i < v.model.wheels.length; i++) {
          if ((v.flat || 0) & (1 << i)) continue;
          g.vehicles.wheelWorld(v, i, w);
          const dx = w.x - S.x, dz = w.z - S.z, lx = dx * c - dz * s, lz = dx * s + dz * c, lz0 = lz - vz * dt;
          // Swept along the road: at 30 m/s and 20 fps a wheel moves 1.5 m a frame, past a 0.6 m strip.
          if (Math.abs(lx) < S.hw && Math.min(lz, lz0) < S.hd && Math.max(lz, lz0) > -S.hd) this.burst(v, i);
        }
      }
    }
  }

  /** Burst a tyre through the game's wrapper (sound, shake, stats) when there is one. */
  burst(v, i) {
    const g = this.game;
    return g.burstTyre ? g.burstTyre(v, i) : burstTyre(v, i);
  }

  /** Sparks off the rims of cars running on flat tyres near the player. */
  _rimSparks(dt) {
    const g = this.game, pos = g.player.pos, w = this._w;
    if ((this.sparkT -= dt) > 0 || !g.effects?.sparks) return;
    this.sparkT = 0.06;
    for (const v of g.vehicles.list) {
      if (!v.flatN || speedOf(v) < 6 || dist(v.x, v.z, pos.x, pos.z) > 80) continue;
      for (let i = 0; i < v.model.wheels.length; i++) {
        if (!(v.flat & (1 << i))) continue;
        g.vehicles.wheelWorld(v, i, w);
        g.effects.sparks(w.x, v.y + 0.05, w.z, 2);
      }
    }
  }

  // ------------------------------------------------------------------ the drone
  _fly(dt, level, pos) {
    const g = this.game, D = NAKA.drone;
    if (!this.drone && level >= 5 && this.droneT <= 0 && !g.police.lock && !g.missions?.active) {
      const v = g.player.vehicle, hx = v ? -Math.sin(v.heading) : 1, hz = v ? -Math.cos(v.heading) : 0;
      this.drone = { x: pos.x + hx * 70, y: D.y + 8, z: pos.z + hz * 70, vx: 0, vy: 0, vz: 0, health: D.health, state: 'fly', t: 0, seen: false, spin: 0 };
      this._help('seenDroneHelp', '<b>Police drone.</b> Hide under a flyover or trees, or shoot it down.');
    }
    const d = this.drone;
    if (!d) return;
    d.t += dt; d.spin += dt * 40;
    if (d.state === 'fall') {
      d.vy -= 9.8 * dt; d.y += d.vy * dt; d.x += d.vx * dt; d.z += d.vz * dt;
      if ((d.sparkT = (d.sparkT || 0) - dt) <= 0) { d.sparkT = 0.08; g.effects?.sparks?.(d.x, d.y, d.z, 3); }
      const floor = g.net?.surfaceAt ? g.net.surfaceAt(d.x, d.z, d.y) : 0;
      if (d.y <= floor + 0.2) { g.effects?.smoke?.(d.x, floor + 0.3, d.z, 0.4, 3); g.effects?.sparks?.(d.x, floor + 0.3, d.z, 10); this.drone = null; this.droneT = D.again; }
      return;
    }
    if (d.state === 'leave' || level < 5) {
      d.state = 'leave';
      d.vy = Math.min(8, d.vy + dt * 4); d.y += d.vy * dt;
      if (d.t > 6 || d.y > 80) { d.state = 'gone'; this.drone = null; }
      return;
    }
    // Hang 8 m behind the player, 22 m above whatever they are on, no faster than 24 m/s.
    const v = g.player.vehicle, sp = v ? speedOf(v) : 0;
    const bx = sp > 1 ? -v.vx / sp : 0, bz = sp > 1 ? -v.vz / sp : 0;
    const tx = pos.x + bx * 8, tz = pos.z + bz * 8;
    const ty = Math.max(pos.y || 0, g.net?.deckOver ? g.net.deckOver(pos.x, pos.z) : 0) + D.y;
    let wx = (tx - d.x) * 1.2, wz = (tz - d.z) * 1.2;
    const wl = Math.hypot(wx, wz);
    if (wl > D.speed) { wx *= D.speed / wl; wz *= D.speed / wl; }
    const k = Math.min(1, dt * 2);
    d.vx += (wx - d.vx) * k; d.vz += (wz - d.vz) * k; d.vy = (ty - d.y) * 1.5;
    d.x += d.vx * dt; d.z += d.vz * dt; d.y += d.vy * dt;
  }

  /** Under cover from above: a flyover deck over the player, or a tree crown. */
  covered(pos) {
    const g = this.game, y = pos.y || 0;
    if (g.net?.deckOver && g.net.deckOver(pos.x, pos.z) > y + 2) return true;
    const T = g.city?.trees, ch = g.city?.chunk?.(Math.floor(pos.x / CHUNK), Math.floor(pos.z / CHUNK));
    if (T && ch?.trees) for (const i of ch.trees) { const r = 2.2 * (T.scale[i] || 1); if ((T.x[i] - pos.x) ** 2 + (T.z[i] - pos.z) ** 2 < r * r) return true; }
    return false;
  }

  _droneSees(pos) {
    const d = this.drone, g = this.game;
    if (!d || d.state !== 'fly') return false;
    if (dist(d.x, d.z, pos.x, pos.z) > NAKA.drone.see || this.covered(pos)) return (d.seen = false);
    const y = (pos.y || 0) + 1.6;
    d.seen = !g.colliders?.raycast || g.colliders.raycast(d.x, d.y, d.z, pos.x, y, pos.z, 0.05) >= 0.999;
    return d.seen;
  }

  // ------------------------------------------------------------------ what police.js and weapons.js ask
  /** Does a constable at a block, or the drone, see the player at pos? */
  sees(pos) {
    const g = this.game;
    for (const b of this.blocks) {
      if (b.state !== 'up') continue;
      for (const p of b.cops) {
        if (p.state === 'dead' || p.state === 'down') continue;
        const d = dist(p.h.x, p.h.z, pos.x, pos.z);
        if (d > NAKA.see) continue;
        if (d < 12 || !g.colliders?.raycast || g.colliders.raycast(p.h.x, 1.6, p.h.z, pos.x, 1.6, pos.z, 0.05) >= 0.999) return true;
      }
    }
    return this._droneSees(pos);
  }
  /** A constable on duty within r of (x, z)? */
  copNear(x, z, r) {
    for (const b of this.blocks) if (b.state === 'up') for (const p of b.cops) if (p.state !== 'dead' && dist(p.h.x, p.h.z, x, z) < r) return true;
    return false;
  }
  /** A constable on their feet within r (the arrest). */
  copWithin(x, z, r = 1.5) {
    for (const b of this.blocks) if (b.state === 'up') for (const p of b.cops) if (p.state !== 'dead' && p.state !== 'down' && p.state !== 'getup' && dist(p.h.x, p.h.z, x, z) < r) return true;
    return false;
  }
  /** A roadblock jeep (not shoved aside) within r of (x, z): boxing the player's car in. */
  jeepWithin(x, z, r = 6.5) {
    for (const b of this.blocks) if (b.state === 'up') for (const v of b.jeeps) if (v.kinematic && dist(v.x, v.z, x, z) < r) return true;
    return false;
  }
  /**
   * The weapons' hit test: a ray from o along the unit direction d, up to len metres, against the
   * drone's 0.7 m sphere. Returns the distance along the ray, or -1.
   */
  droneHit(ox, oy, oz, dx, dy, dz, len) {
    const D = this.drone;
    return D && D.state === 'fly' ? raySphere(ox, oy, oz, dx, dy, dz, len, D.x, D.y, D.z, NAKA.drone.r) : -1;
  }
  /** Damage the drone; true when that brings it down. */
  hitDrone(dmg) {
    const D = this.drone;
    if (!D || D.state !== 'fly') return false;
    D.health -= dmg;
    this.game.effects?.sparks?.(D.x, D.y, D.z, 4);
    if (D.health > 0) return false;
    D.state = 'fall'; D.vy = 0; D.vx *= 0.5; D.vz *= 0.5;
    return true;
  }
  /** Is road r blocked by a block that is up (traffic turns away from it)? */
  blocksRoad(r) {
    for (const b of this.blocks) if (b.state === 'up' && (b.road === r || b.twin?.road === r)) return true;
    return false;
  }
  forEachBlock(fn) { for (const b of this.blocks) if (b.state === 'up') fn(b); }

  /** Radar blips: a 🚧 pinned to the edge for each block, a flashing diamond for the drone. Pooled. */
  blips() {
    const out = this._blips;
    out.length = 0;
    let k = 0;
    for (const b of this.blocks) {
      if (b.state !== 'up') continue;
      const o = this._blipPool[k] || (this._blipPool[k] = { x: 0, z: 0, kind: 'icon', label: '🚧', color: '#ffcc00', clamp: true });
      k++;
      o.x = b.x; o.z = b.z;
      out.push(o);
    }
    if (this.drone && this.drone.state === 'fly') { this._droneBlip.x = this.drone.x; this._droneBlip.z = this.drone.z; out.push(this._droneBlip); }
    return out;
  }

  // ------------------------------------------------------------------ going away
  /** Wanted level cleared: the blocks stand down (removed once the player is off), the drone flies off. */
  standDown() {
    for (const b of this.blocks) {
      if (b.state !== 'up') continue;
      b.state = 'down';
      if (b.strip) b.strip.live = false;
      for (const p of b.cops) this._offDuty(p);
      for (const v of b.jeeps) { v.sirenOn = false; v.role = 'police-parked'; v.keep = false; }
      b.jeeps = [];
    }
    if (this.drone && this.drone.state === 'fly') { this.drone.state = 'leave'; this.drone.t = 0; }
  }
  /** Everything gone at once (retry, respawn, respray). */
  clear() {
    for (const b of this.blocks.slice()) this._remove(b);
    this.blocks.length = 0;
    this.drone = null;
    this.cooldown = 0; this.droneT = 0;
  }
  _remove(b) {
    const g = this.game;
    for (const bar of b.bars) if (bar.slot >= 0) this._freeBox(bar.slot);
    b.bars.length = 0;
    for (const p of b.cops) if (g.peds?.list.includes(p)) g.peds.remove(p);
    for (const v of b.jeeps) if (v.role === 'roadblock' && !v.removed) g.vehicles.remove(v);
    b.cops.length = 0; b.jeeps.length = 0; b.strip = null;
    const i = this.blocks.indexOf(b);
    if (i >= 0) this.blocks.splice(i, 1);
  }
  _offDuty(p) { p.state = 'walk'; p.keep = false; p.road = null; p.armed = null; p.role = null; p.post = null; if (p.h) { p.h.gun = null; p.h.aim = 0; } }

  // ------------------------------------------------------------------ helpers
  _bark(p) {
    const g = this.game;
    if ((this._barkT ?? -99) > (g.time ?? 0) - 4) return;
    this._barkT = g.time ?? 0;
    g.hud?.bark?.(BARKS[(p.id + Math.floor(g.time || 0)) % BARKS.length]);
  }
  _help(flag, html) {
    const s = this.game.save;
    if (!s?.data || s.data[flag]) return;
    s.set ? s.set(flag, true) : (s.data[flag] = true);
    this.game.hud?.help?.(html, 7);
  }

  /** A solid barricade box, reusing a slot given back by an earlier block. */
  _placeBox(x, z, hw, hd, rot, h) {
    const C = this.game.colliders;
    if (!C?.addBox) return -1;
    const old = this._free.length ? this._free.pop() : -1;
    if (C.placeBox) return C.placeBox(old, x, z, hw, hd, rot, h);
    if (old < 0) return C.addBox(x, z, hw, hd, rot, h);
    C.x[old] = x; C.z[old] = z; C.hw[old] = hw; C.hd[old] = hd; C.c[old] = Math.cos(rot); C.s[old] = Math.sin(rot); C.h[old] = h; C.y0[old] = 0;
    gridRect(C, old, (id, minX, minZ, maxX, maxZ) => C.grid.insertRect(id, minX, minZ, maxX, maxZ));
    return old;
  }
  /** Take a barricade's box out of the world (not solid, out of the grid); the slot waits for the next block. */
  _freeBox(i) {
    const C = this.game.colliders;
    if (!C) return;
    if (C.freeBox) C.freeBox(i);
    else {
      gridRect(C, i, (id, minX, minZ, maxX, maxZ) => {
        const G = C.grid, c = G.cell;
        for (let cx = Math.floor(minX / c); cx <= Math.floor(maxX / c); cx++) {
          for (let cz = Math.floor(minZ / c); cz <= Math.floor(maxZ / c); cz++) {
            const list = G.map.get(G.key(cx, cz)), k = list ? list.lastIndexOf(id) : -1;
            if (k >= 0) list.splice(k, 1);
          }
        }
      });
      C.h[i] = 0;
    }
    this._free.push(i);
  }
}

/** The grid rectangle of collider box i, as Colliders.addBox works it out. */
function gridRect(C, i, fn) {
  const e = Math.abs(C.hw[i] * C.c[i]) + Math.abs(C.hd[i] * C.s[i]), f = Math.abs(C.hw[i] * C.s[i]) + Math.abs(C.hd[i] * C.c[i]);
  fn(i, C.x[i] - e, C.z[i] - f, C.x[i] + e, C.z[i] + f);
}
