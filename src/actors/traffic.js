// Street traffic: lane-following on the left, turns through junctions on curves,
// gaps kept to whatever is ahead, signals at the big chowks, and horns.
// Plus DynamicDriver: a path-following controller for physics vehicles (police, rivals).
import { clamp, dist, rng, hash2, wrapAngle, headingTo } from '../core/math.js';
import { speedOf, forwardSpeed } from './vehicle-physics.js';

// Traffic mix on Indian streets: mostly two-wheelers and autos.
const MIX = [['bike', 26], ['scooter', 14], ['auto', 20], ['hatch', 16], ['sedan', 8], ['suv', 6], ['tempo', 4], ['bus', 2.5], ['truck', 2], ['tractor', 1], ['ambulance', 0.5]];
const MAJOR_ONLY = new Set(['bus', 'truck']);
const CRUISE = [17, 15, 14, 12.5, 10.5, 8.5]; // by road class, m/s
const TYPE_CAP = { auto: 13, tractor: 8.5, bus: 13, truck: 14, tempo: 13, bike: 16, scooter: 13 };
const SIGNAL_CYCLE = 22;

export class Traffic {
  constructor(game) {
    this.game = game;
    this.net = game.net;
    this.cars = [];
    this.target = 28;
    this.spawnT = 0;
    this.seed = 1;
    this._p = {}; this._q = {};
    this.signals = this._findSignals();
  }

  /** Big chowks (4+ ways with a main road) get signals. */
  _findSignals() {
    const net = this.net, set = new Map();
    for (let j = 0; j < net.junctionCount; j++) {
      const roads = net.jRoads[j];
      if (roads.length < 4) continue;
      if (!roads.some(r => net.type[r] <= 2)) continue;
      set.set(j, { offset: (j * 7) % SIGNAL_CYCLE });
    }
    return set;
  }

  /** Red for a road arriving at junction j at time t? Two phases by street bearing. */
  isRed(j, road, t) {
    const sig = this.signals.get(j);
    if (!sig) return false;
    const net = this.net, p = this._p;
    net.pointAt(road, net.ra[road] === j ? 0 : net.length[road], p);
    const ang = ((Math.atan2(p.dx, p.dz) % Math.PI) + Math.PI) % Math.PI;
    const phase = ang < Math.PI / 4 || ang > (3 * Math.PI) / 4 ? 0 : 1;
    const c = (t + sig.offset) % SIGNAL_CYCLE;
    const green = phase === 0 ? c < SIGNAL_CYCLE / 2 - 2 : c >= SIGNAL_CYCLE / 2 && c < SIGNAL_CYCLE - 2;
    return !green;
  }
  signalState(j, road, t) { return this.isRed(j, road, t) ? 'red' : 'green'; }

  update(dt) {
    const g = this.game, focus = g.player.pos;
    this.target = g.quality.settings.traffic * (g.trafficScale ?? 1);
    // Despawn far traffic, spawn near the edge of view.
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const v = this.cars[i];
      if (v.role === 'player' || !g.vehicles.list.includes(v)) { this.cars.splice(i, 1); continue; }
      const d = dist(v.x, v.z, focus.x, focus.z);
      if (d > 320 && !v.keep) { g.vehicles.remove(v); this.cars.splice(i, 1); }
    }
    this.spawnT -= dt;
    let budget = this.cars.length < this.target * 0.5 ? 6 : 2;
    while (this.cars.length < this.target && budget-- > 0 && this.spawnT <= 0) {
      if (!this._spawnOne(focus, this.cars.length < this.target * 0.4 ? 40 : 110, 230)) break;
    }
    if (this.cars.length >= this.target) this.spawnT = 0.3;
    const t = g.time;
    for (const v of this.cars) {
      if (!v.ai) continue;
      if (!v.kinematic) this._disturbed(v, dt);
      else this._drive(v, dt, t);
    }
  }

  _spawnOne(focus, minD, maxD) {
    const g = this.game, net = this.net;
    const r = rng(hash2(this.seed++, 811));
    const ang = r() * Math.PI * 2, d = r.range(minD, maxD);
    const n = net.nearest(focus.x + Math.cos(ang) * d, focus.z + Math.sin(ang) * d, 60, this._q);
    if (!n) return false;
    const road = n.road;
    if (net.bridge[road] && net.width[road] < 6) return false;
    // Choose a type that suits the street.
    let type = pickWeighted(MIX, r);
    if (MAJOR_ONLY.has(type) && net.type[road] > 3) type = 'hatch';
    const dir = r.chance(0.5) ? 1 : -1;
    const len = net.length[road];
    const s = clamp(dir > 0 ? n.s : len - n.s, net.trimStart(road) + 1, len - net.trimEnd(road) - 1);
    if (!(s > 0 && s < len)) return false;
    const lane = net.lanes[road] > 1 && r.chance(0.5) ? 1 : 0;
    const p = net.lanePoint(road, dir, s, net.laneOffset(road, lane), this._p);
    // Keep clear of everything else.
    for (const o of g.vehicles.list) if (dist(o.x, o.z, p.x, p.z) < 9) return false;
    if (dist(p.x, p.z, focus.x, focus.z) < minD * 0.8) return false;
    const v = g.vehicles.spawn(type, p.x, p.z, p.heading, { role: 'traffic', seed: hash2(this.seed, 3) });
    const cap = TYPE_CAP[type] ?? 99;
    v.ai = { road, dir, s, lane, speed: 0, cruise: Math.min(cap, CRUISE[net.type[road]] * r.range(0.85, 1.15)), turn: null, wait: 0, blocked: 0, honk: r.range(4, 20), weave: type === 'bike' || type === 'scooter' ? r.range(-0.6, 0.6) : 0 };
    v.ai.speed = v.ai.cruise * 0.7;
    if ((type === 'bike' || type === 'scooter') && r.chance(0.35)) g.vehicles.addPassenger(v, g.peds?.randomOutfit?.(r()) ?? undefined);
    if (type === 'auto' && r.chance(0.6)) g.vehicles.addPassenger(v, g.peds?.randomOutfit?.(r()));
    this.cars.push(v);
    return true;
  }

  _drive(v, dt, time) {
    const net = this.net, a = v.ai, g = this.game;
    // Look ahead for anything in our path.
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    let gap = Infinity, blockedByPlayer = false;
    const consider = (ox, oz, len, isPlayer) => {
      const dx = ox - v.x, dz = oz - v.z;
      const f = dx * fx + dz * fz;
      if (f <= 0 || f > 32) return;
      const l = Math.abs(-dx * fz + dz * fx);
      if (l > 1.5 + (len || 0) * 0.15) return;
      const gp = f - v.hd - (len || 2);
      if (gp < gap) { gap = gp; blockedByPlayer = isPlayer; }
    };
    for (const o of g.vehicles.list) {
      if (o === v) continue;
      const dx = o.x - v.x, dz = o.z - v.z;
      if (dx * dx + dz * dz > 1200) continue;
      consider(o.x, o.z, o.hd, o.role === 'player');
    }
    if (g.player.state !== 'driving') consider(g.player.x, g.player.z, 0.6, true);
    g.peds?.forEachNear(v.x, v.z, 20, ped => { if (!ped.onRoadOk) consider(ped.h.x, ped.h.z, 0.5, false); });

    // Desired speed.
    let want = a.cruise;
    if (gap < Infinity) want = Math.min(want, Math.max(0, (gap - 2.2) * 1.1));
    const len = net.length[a.road];
    const end = len - net.trimEnd(a.road);
    const j = a.dir > 0 ? net.rb[a.road] : net.ra[a.road];
    if (!a.turn) {
      const toEnd = end - a.s;
      if (net.jRoads[j].length >= 3 && toEnd < 22) want = Math.min(want, 5 + toEnd * 0.45);
      if (this.signals.has(j) && toEnd < 16 && this.isRed(j, a.road, time)) want = Math.min(want, Math.max(0, (toEnd - 2) * 0.9));
    }
    if (a.wait > 0) { a.wait -= dt; want = 0; }
    // Accelerate gently, brake firmly.
    const accel = want > a.speed ? 2.6 : 7;
    a.speed += clamp(want - a.speed, -accel * dt, accel * dt);
    if (a.speed < 0.3 && gap < 6) {
      a.blocked += dt;
      if (blockedByPlayer && a.blocked > 1.4 && (a.honk -= dt) < 0) { g.audio?.horn(v); a.honk = 1.5 + Math.random() * 2; }
    } else a.blocked = 0;
    if ((a.honk -= dt * 0.15) < 0 && a.speed > 4 && Math.random() < 0.002) { g.audio?.horn(v, 0.4); a.honk = 8 + Math.random() * 12; }

    // Advance along the lane or the turn curve.
    const step = a.speed * dt;
    const p = this._p;
    if (a.turn) {
      const T = a.turn;
      T.u += step / T.len;
      if (T.u >= 1) {
        a.road = T.road; a.dir = T.dir; a.s = net.trimStart(T.road) * 0 + T.s0 + (T.u - 1) * T.len; a.turn = null;
        a.cruise = Math.min(TYPE_CAP[v.type] ?? 99, CRUISE[net.type[a.road]] * (0.85 + ((v.id * 37) % 30) / 100));
      } else {
        const u = T.u, iu = 1 - u;
        const x = iu * iu * T.x0 + 2 * iu * u * T.x1 + u * u * T.x2, z = iu * iu * T.z0 + 2 * iu * u * T.z1 + u * u * T.z2;
        const tx = 2 * iu * (T.x1 - T.x0) + 2 * u * (T.x2 - T.x1), tz = 2 * iu * (T.z1 - T.z0) + 2 * u * (T.z2 - T.z1);
        this._place(v, x, z, Math.atan2(tx, tz), dt);
        return;
      }
    }
    a.s += step;
    if (a.s >= end) {
      if (!this._chooseTurn(v, j)) { a.s = end; a.speed = 0; }
      else return;
    }
    const off = net.laneOffset(a.road, a.lane) + (a.weave || 0);
    net.lanePoint(a.road, a.dir, a.s, off, p);
    this._place(v, p.x, p.z, p.heading, dt);
  }

  _place(v, x, z, heading, dt) {
    const a = v.ai;
    v.vx = (x - v.x) / Math.max(dt, 1e-4); v.vz = (z - v.z) / Math.max(dt, 1e-4);
    if (Math.hypot(v.vx, v.vz) > 40) { v.vx = 0; v.vz = 0; }
    v.x = x; v.z = z;
    const dh = wrapAngle(heading - v.heading);
    v.heading = wrapAngle(v.heading + dh * clamp(dt * 10, 0, 1));
    v.w = 0;
    v.steer = clamp(dh * 3, -0.5, 0.5);
    v.wheelSpin += (a.speed / (v.spec.wheelR || 0.3)) * dt;
    v.braking = a.speed < a.cruise * 0.5 && a.speed > 0.2;
    if (v.spec.two) v.lean = clamp(v.steer * 0.8 * Math.min(1, a.speed / 6), -0.4, 0.4);
  }

  /** At the end of a road: pick the next one (straight-ish, bigger roads), build a curve. */
  _chooseTurn(v, j) {
    const net = this.net, a = v.ai;
    const roads = net.jRoads[j];
    const p = this._p, q = this._q;
    net.lanePoint(a.road, a.dir, net.length[a.road] - net.trimEnd(a.road), net.laneOffset(a.road, a.lane), p);
    const inHeading = p.heading;
    let best = null, bestScore = -Infinity;
    const r = rng(hash2(v.id, Math.floor(this.game.time * 3)));
    for (const road of roads) {
      if (road === a.road && roads.length > 1) continue;
      if (net.bridge[road] && net.width[road] < 5) continue;
      const dir = net.ra[road] === j ? 1 : -1;
      if (MAJOR_ONLY.has(v.type) && net.type[road] > 3 && roads.length > 1) continue;
      net.lanePoint(road, dir, net.trimStart(road), net.laneOffset(road, 0), q);
      const turn = Math.abs(wrapAngle(q.heading - inHeading));
      if (turn > 2.6 && roads.length > 1) continue;
      const score = -turn * 1.2 + (5 - net.type[road]) * 0.25 + r() * 1.6;
      if (score > bestScore) { bestScore = score; best = { road, dir }; }
    }
    if (!best) {
      // Dead end: turn around.
      best = { road: a.road, dir: -a.dir };
    }
    // Junction etiquette: wait while someone else is crossing (but not forever).
    if (net.jRoads[j].length >= 3 && a.blocked < 3) {
      const R = net.jRadius[j] + 2;
      for (const o of this.game.vehicles.list) {
        if (o === v || !o.ai || !o.ai.turn || o.ai.turn.j !== j) continue;
        if (dist(o.x, o.z, net.jx[j], net.jz[j]) < R && o.ai.turn.road !== best.road) { a.wait = 0.4; a.blocked += 0.4; return false; }
      }
    }
    const lane = net.lanes[best.road] > 1 ? a.lane : 0;
    const s0 = net.trimStart(best.road);
    net.lanePoint(best.road, best.dir, s0, net.laneOffset(best.road, lane), q);
    const x0 = p.x, z0 = p.z, x2 = q.x, z2 = q.z;
    // Control point where the two lane lines would meet (fall back to the midpoint).
    const d1x = Math.sin(inHeading), d1z = Math.cos(inHeading), d2x = Math.sin(q.heading), d2z = Math.cos(q.heading);
    const den = d1x * d2z - d1z * d2x;
    let x1 = (x0 + x2) / 2, z1 = (z0 + z2) / 2;
    if (Math.abs(den) > 0.15) {
      const tt = ((x2 - x0) * d2z - (z2 - z0) * d2x) / den;
      if (tt > 0 && tt < 30) { x1 = x0 + d1x * tt; z1 = z0 + d1z * tt; }
    }
    const len = Math.max(0.5, (dist(x0, z0, x1, z1) + dist(x1, z1, x2, z2) + dist(x0, z0, x2, z2)) / 2);
    a.turn = { x0, z0, x1, z1, x2, z2, len, u: 0, road: best.road, dir: best.dir, s0, j };
    a.lane = lane;
    return true;
  }

  /** A crashed car: brake to a stop, then rejoin its lane if it still can. */
  _disturbed(v, dt) {
    const a = v.ai;
    v.stunned = (v.stunned || 0) - dt;
    this.game.controls.set(v, { throttle: 0, brake: 1, steer: 0, handbrake: false });
    if (v.stunned > 0 || speedOf(v) > 0.6 || v.wrecked) return;
    const n = this.net.nearest(v.x, v.z, 6, this._q);
    if (!n) { v.ai = null; v.role = 'abandoned'; return; }
    // Rejoin: snap to the nearest lane, facing the way the car points.
    const dir = Math.cos(v.heading - Math.atan2(n.dx, n.dz)) >= 0 ? 1 : -1;
    a.road = n.road; a.dir = dir; a.s = dir > 0 ? n.s : this.net.length[n.road] - n.s; a.turn = null; a.speed = 0; a.lane = 0;
    v.kinematic = true; v.vx = v.vz = 0; v.w = 0;
  }
}

function pickWeighted(list, r) {
  let total = 0; for (const [, w] of list) total += w;
  let x = r() * total;
  for (const [k, w] of list) { x -= w; if (x <= 0) return k; }
  return list[0][0];
}

/**
 * Drives a physics vehicle along a path of points [x0, z0, x1, z1, ...]:
 * pure-pursuit steering, speed from the curvature ahead, and a brake for whatever is in front.
 */
export class DynamicDriver {
  constructor(game, vehicle, { aggression = 0.6, maxSpeed = 30 } = {}) {
    this.game = game; this.v = vehicle; this.path = null; this.i = 0;
    this.aggression = aggression; this.maxSpeed = maxSpeed;
    this.stuck = 0; this.reverseT = 0;
    this.ignore = null; // the vehicle we mean to hit (police ramming the player)
  }
  setPath(points, lane = true) {
    this.path = lane ? this.game.net.lanePath(points) : points; this.i = 0;
    const n = points.length / 2;
    this.goal = { x: points[(n - 1) * 2], z: points[(n - 1) * 2 + 1] };
    this.offT = 0; this.unsticks = 0;
  }
  /** Lost the path (knocked off the road, wedged in a lane): plan again from here. */
  _replan() {
    if (!this.goal) return;
    const r = this.game.net.route(this.v.x, this.v.z, this.goal.x, this.goal.z);
    if (r) { const goal = this.goal; this.setPath(r.points); this.goal = goal; }
  }

  get done() { return !this.path || this.i >= this.path.length / 2 - 1; }

  /**
   * target: optional {x, z} to drive straight at (ramming); otherwise follow the path.
   * stopShort: brake to a halt this many metres before the target (approaching people on foot).
   */
  control(dt, target = null, stopShort = 0) {
    const v = this.v;
    const spd = forwardSpeed(v);
    let tx, tz, curveAhead = 0, arriveCap = Infinity;
    if (target) {
      tx = target.x; tz = target.z;
      if (stopShort) {
        const d = dist(v.x, v.z, tx, tz);
        arriveCap = Math.max(0, (d - stopShort) * 0.9);
        if (d < stopShort + 0.5) return { throttle: 0, brake: 1, steer: 0, handbrake: false };
      }
    }
    else if (this.path && this.path.length >= 4) {
      const P = this.path, n = P.length / 2;
      // Advance past points we've reached.
      while (this.i < n - 1 && dist(v.x, v.z, P[this.i * 2], P[this.i * 2 + 1]) < 4 + Math.abs(spd) * 0.15) this.i++;
      // Steer at a point a short, speed-dependent distance down the path.
      const look = 4 + Math.abs(spd) * 0.35;
      let k = this.i, acc = 0, px = v.x, pz = v.z;
      tx = P[k * 2]; tz = P[k * 2 + 1];
      while (k < n) {
        const nx = P[k * 2], nz = P[k * 2 + 1];
        const seg = dist(px, pz, nx, nz);
        if (acc + seg >= look) { const t = (look - acc) / Math.max(seg, 1e-3); tx = px + (nx - px) * t; tz = pz + (nz - pz) * t; break; }
        acc += seg; tx = nx; tz = nz; px = nx; pz = nz; k++;
      }
      // Speed planning: find each bend ahead, its safe speed, and brake in time for it.
      const decel = 7;
      const scan = Math.abs(spd) * Math.abs(spd) / (2 * decel) + 15;
      acc = dist(v.x, v.z, P[this.i * 2], P[this.i * 2 + 1]);
      for (let j = this.i; j < n - 2 && acc < scan; j++) {
        const h1 = headingTo(P[j * 2], P[j * 2 + 1], P[j * 2 + 2], P[j * 2 + 3]);
        const h2 = headingTo(P[j * 2 + 2], P[j * 2 + 3], P[j * 2 + 4], P[j * 2 + 5]);
        acc += dist(P[j * 2], P[j * 2 + 1], P[j * 2 + 2], P[j * 2 + 3]);
        const turn = Math.abs(wrapAngle(h2 - h1));
        if (turn < 0.12) continue;
        const vTurn = 4.5 + 15 / (1 + turn * 3.2) * (0.85 + this.aggression * 0.3);
        arriveCap = Math.min(arriveCap, Math.sqrt(vTurn * vTurn + 2 * decel * Math.max(0, acc - 3)));
      }
      curveAhead = 0;
      // Arriving at the end of the path: ease off and stop there.
      const last = n - 1;
      const dEnd = dist(v.x, v.z, P[last * 2], P[last * 2 + 1]);
      if (this.i >= last - 1) arriveCap = Math.min(arriveCap, Math.max(0, (dEnd - 3) * 0.8));
      if (this.i >= last - 1 && dEnd < 4) return { throttle: 0, brake: 1, steer: 0, handbrake: false };
    } else return { throttle: 0, brake: 1, steer: 0, handbrake: false };
    const want = headingTo(v.x, v.z, tx, tz);
    const err = wrapAngle(want - v.heading);
    let steer = clamp(err * 2.2, -1, 1);
    // Speed: slower into bends, faster when aggressive.
    let maxV = this.maxSpeed * (0.75 + this.aggression * 0.35);
    maxV = Math.min(maxV, 7 + 22 / (1 + curveAhead * 4) * (0.85 + this.aggression * 0.3));
    // Look ahead: swerve around and brake for anything in our corridor (but ram the target).
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading), range = 7 + Math.abs(spd) * 1.1;
    let avoid = 0, nearest = Infinity;
    for (const o of this.game.vehicles.list) {
      if (o === v || (target && o === this.ignore)) continue;
      const dx = o.x - v.x, dz = o.z - v.z;
      if (dx * dx + dz * dz > range * range) continue;
      const f = dx * fx + dz * fz;
      if (f <= 0) continue;
      const l = -dx * fz + dz * fx; // + is to our right
      if (Math.abs(l) > o.hw + v.hw + 0.9) continue;
      const k = 1 - f / range;
      avoid += (l >= 0 ? 1 : -1) * k * 1.4;
      nearest = Math.min(nearest, f - o.hd - v.hd);
    }
    if (avoid) steer = clamp(steer + avoid, -1, 1);
    // Brake for what's ahead using real stopping distance (about 8 m/s^2).
    if (nearest < Infinity) maxV = Math.min(maxV, Math.sqrt(Math.max(0, 16 * (nearest - 2.5))));
    // Narrow lanes and junctions are taken at city speeds.
    const net = this.game.net, here = net.nearest(v.x, v.z, 12, this._n || (this._n = {}));
    if (here) {
      const w = net.width[here.road];
      maxV = Math.min(maxV, 6 + w * (1.4 + this.aggression * 0.5));
      const len = net.length[here.road], toA = here.s, toB = len - here.s;
      const jA = net.jRoads[net.ra[here.road]].length >= 3, jB = net.jRoads[net.rb[here.road]].length >= 3;
      const toJ = Math.min(jA ? toA : Infinity, jB ? toB : Infinity);
      if (toJ < 25 && Math.abs(err) > 0.25) maxV = Math.min(maxV, 8 + toJ * 0.4);
    }
    if (Math.abs(err) > 0.9) maxV = Math.min(maxV, 9);
    maxV = Math.min(maxV, arriveCap);
    let throttle = spd < maxV ? 1 : 0, brake = spd > maxV + 1.5 ? 1 : 0;
    // Stuck against something: back up and swing round.
    if (Math.abs(spd) < 1 && throttle > 0) this.stuck += dt; else this.stuck = Math.max(0, this.stuck - dt * 2);
    if (this.stuck > 1.2) { this.reverseT = 1.1; this.stuck = 0; if (++this.unsticks >= 2 && !target) { this.unsticks = 0; this._replan(); } }
    // Too far from the path for too long: re-plan.
    if (!target && this.path) {
      const P = this.path, d = dist(v.x, v.z, P[this.i * 2], P[this.i * 2 + 1]);
      this.offT = d > 22 ? this.offT + dt : 0;
      if (this.offT > 2) { this.offT = 0; this._replan(); }
    }
    if (this.reverseT > 0) { this.reverseT -= dt; return { throttle: 0, brake: 1, steer: -steer, handbrake: false }; }
    const handbrake = Math.abs(err) > 1.3 && spd > 12 && this.aggression > 0.5;
    return { throttle, brake, steer, handbrake, analog: true };
  }
}

/**
 * Parked vehicles along the kerbs near the player: two-wheelers nosed onto the
 * footpath outside shops, cars on the wider roads. Each street segment decides
 * deterministically whether it has one, so they're still there when you return.
 */
const PARKED_MIX = [['scooter', 30], ['bike', 30], ['hatch', 14], ['auto', 12], ['sedan', 6], ['suv', 5], ['tempo', 3]];
export class Parked {
  constructor(game) {
    this.game = game;
    this.net = game.net;
    this.bySeg = new Map();
    this.t = 0;
  }
  update(dt) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.8;
    const g = this.game, net = this.net, pos = g.player.pos, R = 140;
    const max = Math.round(g.quality.settings.traffic * 0.7);
    // Despawn far ones (unless the player took one).
    for (const [seg, v] of this.bySeg) {
      if (!g.vehicles.list.includes(v) || v.role !== 'parked') { this.bySeg.delete(seg); continue; }
      if (dist(v.x, v.z, pos.x, pos.z) > R + 60) { g.vehicles.remove(v); this.bySeg.delete(seg); }
    }
    // Abandoned, crashed and wrecked vehicles are towed once you're well away.
    for (const v of g.vehicles.list.slice()) {
      if ((v.role === 'abandoned' || v.wrecked) && !v.keep && v.role !== 'player' && dist(v.x, v.z, pos.x, pos.z) > 280) g.vehicles.remove(v);
    }
    if (this.bySeg.size >= max) return;
    const p = {};
    net.segmentsIn(pos.x - R, pos.z - R, pos.x + R, pos.z + R, (i, road) => {
      if (this.bySeg.size >= max || this.bySeg.has(i) || net.bridge[road]) return;
      const w = net.width[road];
      if (w < 6) return;
      const r = rng(hash2(i, 60013));
      const dens = g.city.densityAt(net.px[i], net.pz[i]);
      if (!r.chance(dens > 0.45 ? 0.32 : dens > 0.2 ? 0.16 : 0.05)) return;
      const segLen = Math.hypot(net.px[i + 1] - net.px[i], net.pz[i + 1] - net.pz[i]);
      if (segLen < 8) return;
      const s = net.cum[i] + segLen * r.range(0.25, 0.75);
      if (s < net.trimStart(road) + 4 || s > net.length[road] - net.trimEnd(road) - 4) return;
      net.pointAt(road, s, p);
      if (dist(p.x, p.z, pos.x, pos.z) < 35) return; // don't pop in under the player's nose
      let type = pickWeighted(PARKED_MIX, r);
      const two = type === 'bike' || type === 'scooter';
      if (!two && w < 8) type = r.chance(0.5) ? 'scooter' : 'bike';
      const side = r.chance(0.5) ? 1 : -1;
      const off = type === 'bike' || type === 'scooter' ? w / 2 + 0.55 : w / 2 - 0.95;
      const x = p.x + p.dz * off * side, z = p.z - p.dx * off * side;
      // Two-wheelers park nose-in at an angle; cars along the kerb.
      const along = Math.atan2(p.dx, p.dz) + (side > 0 ? 0 : Math.PI);
      const heading = type === 'bike' || type === 'scooter' ? along + side * 1.2 : along;
      if (g.vehicles.list.some(o => dist(o.x, o.z, x, z) < 4)) return;
      if (g.colliders.blocked(x, z, 0.5)) return;
      const v = g.vehicles.spawn(type, x, z, heading, { role: 'parked', driver: false, seed: hash2(i, 7) });
      this.bySeg.set(i, v);
    });
  }
}
