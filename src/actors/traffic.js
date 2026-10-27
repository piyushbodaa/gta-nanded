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
// Junctions joined by a road this short are one crossing (a street over both carriageways of a divided road).
const CROSSING_LINK = 16;
// A lane's ends, in the direction of travel (dir -1 starts at junction b): how far in from the
// junction it starts, and how far short of the far junction it stops.
const startTrim = (net, road, dir) => dir > 0 ? net.trimStart(road) : net.trimEnd(road);
const endTrim = (net, road, dir) => dir > 0 ? net.trimEnd(road) : net.trimStart(road);

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

  /**
   * Signals stand at the chowks where main roads cross. A crossing is the junctions
   * joined by short links (a street over both carriageways of a divided road counts
   * once), with main roads on two different axes; all its junctions share one cycle,
   * so the lights agree. Maps each of those junctions to { offset, axis, junctions }.
   */
  _findSignals() {
    const net = this.net, J = net.junctionCount, set = new Map(), p = {};
    const major = j => net.jRoads[j].length >= 3 && net.jRoads[j].some(r => net.type[r] <= 2);
    const parent = Int32Array.from({ length: J }, (_, i) => i);
    const find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
    for (let r = 0; r < net.count; r++) {
      const a = net.ra[r], b = net.rb[r];
      if (a !== b && net.length[r] < CROSSING_LINK && major(a) && major(b)) parent[find(a)] = find(b);
    }
    const groups = new Map();
    for (let j = 0; j < J; j++) {
      if (!major(j)) continue;
      const c = find(j);
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c).push(j);
    }
    for (const junctions of groups.values()) {
      let ways = 0;
      const axes = [];
      for (const j of junctions) for (const r of net.jRoads[j]) {
        if (this._link(junctions, r)) continue;
        ways++;
        if (net.type[r] > 2) continue;
        // The main road's bearing as it leaves the crossing, folded to an axis (0..PI).
        net.pointAt(r, net.ra[r] === j ? Math.min(12, net.length[r]) : Math.max(0, net.length[r] - 12), p);
        const b = ((Math.atan2(p.dx, p.dz) % Math.PI) + Math.PI) % Math.PI;
        if (!axes.some(a => { const d = Math.abs(a - b); return Math.min(d, Math.PI - d) < 0.6; })) axes.push(b);
      }
      if (ways < 3 || axes.length < 2) continue;
      const sig = { offset: (junctions[0] * 7) % SIGNAL_CYCLE, axis: axes[0], junctions };
      for (const j of junctions) set.set(j, sig);
    }
    return set;
  }

  /** A short road between two junctions of the same crossing: whoever is on it is already crossing. */
  _link(junctions, road) {
    const net = this.net;
    return net.length[road] < CROSSING_LINK && junctions.includes(net.ra[road]) && junctions.includes(net.rb[road]);
  }

  /** The light for a road arriving at junction j at time t: 'green', 'amber' or 'red'. Two phases, by axis. */
  signalState(j, road, t) {
    const sig = this.signals.get(j);
    if (!sig || this._link(sig.junctions, road)) return 'green';
    const net = this.net, p = this._p;
    net.pointAt(road, net.ra[road] === j ? 0 : net.length[road], p);
    let d = Math.abs((((Math.atan2(p.dx, p.dz) - sig.axis) % Math.PI) + Math.PI) % Math.PI);
    d = Math.min(d, Math.PI - d);
    // Phase 1 runs half a cycle after phase 0: green, two seconds of amber, then red.
    const half = SIGNAL_CYCLE / 2, c = (t + sig.offset + (d < Math.PI / 4 ? 0 : half)) % SIGNAL_CYCLE;
    return c < half - 2 ? 'green' : c < half ? 'amber' : 'red';
  }
  isRed(j, road, t) { return this.signalState(j, road, t) !== 'green'; }

  update(dt) {
    const g = this.game, focus = g.player.pos;
    this.target = g.quality.settings.traffic * (g.trafficScale ?? 1) * (g.quality.crowd ?? 1);
    // Despawn far traffic, spawn near the edge of view. A wreck, or a car stranded off the road,
    // is no longer traffic: it stays where it is (Parked tows it later) and frees its place for a new car.
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const v = this.cars[i];
      if (v.role === 'player' || v.wrecked || !v.ai || !g.vehicles.list.includes(v)) { this.cars.splice(i, 1); continue; }
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
    const dir = net.oneway[road] || (r.chance(0.5) ? 1 : -1);
    const len = net.length[road];
    const s = clamp(dir > 0 ? n.s : len - n.s, startTrim(net, road, dir) + 1, len - endTrim(net, road, dir) - 1);
    if (!(s > 0 && s < len)) return false;
    const lane = net.lanes[road] > 1 && r.chance(0.5) ? 1 : 0;
    const p = net.lanePoint(road, dir, s, net.laneOffset(road, lane, dir > 0 ? s : len - s), this._p);
    // Keep clear of everything else.
    for (const o of g.vehicles.list) if (dist(o.x, o.z, p.x, p.z) < 9) return false;
    if (dist(p.x, p.z, focus.x, focus.z) < minD * 0.8) return false;
    const v = g.vehicles.spawn(type, p.x, p.z, p.heading, { role: 'traffic', seed: hash2(this.seed, 3) });
    const cap = TYPE_CAP[type] ?? 99;
    v.ai = { road, dir, s, lane, speed: 0, cruise: Math.min(cap, CRUISE[net.type[road]] * r.range(0.85, 1.15)), turn: null, wait: 0, blocked: 0, honk: r.range(4, 20), weave: type === 'bike' || type === 'scooter' ? r.range(-0.6, 0.6) : 0, dodge: 0, dodgeWant: 0 };
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
    a.dodgeWant = 0; a.waitFor = null;
    // len: the thing's half-length (for the gap); ohw: its half-extent across our path.
    const consider = (ox, oz, len, isPlayer, oncoming = false, ohw = 0.3) => {
      const dx = ox - v.x, dz = oz - v.z;
      const f = dx * fx + dz * fz;
      if (f <= 0 || f > 32) return;
      const l = Math.abs(-dx * fz + dz * fx);
      // In our path when the two would touch, a bus's width or a bike's; oncoming traffic in
      // its own lane passes us, so only a head-on path holds us up.
      if (l > v.hw + ohw + (oncoming ? 0.1 : 0.3)) return;
      const gp = f - v.hd - (len || 2);
      if (gp < gap) { gap = gp; blockedByPlayer = isPlayer; }
    };
    for (const o of g.vehicles.list) {
      if (o === v || Math.abs(o.y - v.y) > 2) continue;
      const dx = o.x - v.x, dz = o.z - v.z;
      if (dx * dx + dz * dz > 1200) continue;
      const f = dx * fx + dz * fz, facing = Math.cos(o.heading - v.heading);
      // Its half-extent across our path: a car side-on to us blocks with its length.
      let across = Math.abs(facing) * o.hw + Math.abs(Math.sin(o.heading - v.heading)) * o.hd;
      // A parked, crashed or abandoned vehicle standing in the lane, at whatever angle (a scooter
      // nosed onto the footpath sticks its tail out): squeeze past it towards the middle of the
      // road, the way everyone does, instead of queueing forever (slowing while still in its way).
      // Anything moving is followed like traffic instead.
      if ((!o.ai || !o.kinematic) && o.role !== 'player' && speedOf(o) < 1 && f > -(v.hd + o.hd) && f < 26) {
        // Where it stands across our lane (+ to the right), however far we have moved over already.
        const l = -dx * fz + dz * fx + (a.turn ? 0 : a.dodge || 0), clear = v.hw + across + 0.35;
        if (Math.abs(l) < clear) {
          if (a.turn) continue; // a turn's curve can't swerve: it is soon past it
          let dodge = this._passBy(v, l, clear);
          // No room either side (a car left in the middle of a narrow street): after a few seconds
          // stood behind it, go by closer, wheels up on the verge where nothing solid stands, and out
          // to the right only once nothing coming the other way needs that gap. Then keep to that
          // side until past.
          if (dodge === null && (a.blocked > 3 || a.squeezing?.has(o.id))) {
            const side = a.squeezing?.get(o.id);
            let coming = null;
            dodge = this._passBy(v, l, clear - 0.25, 0.6, d => side ? Math.sign(d) === side :
              this._clearBeside(v, d, f, o.hd + v.hd) && (d < 0 || !(coming = this._oncoming(v, d, f + o.hd + v.hd + 16))));
            // It is in our way only until we have moved over that far.
            if (dodge !== null) { (a.squeezing ||= new Map()).set(o.id, Math.sign(dodge)); across -= 0.25; }
            else { a.squeezing?.delete(o.id); if (coming) a.waitFor = coming.id; }
          }
          if (dodge !== null && Math.abs(dodge) > Math.abs(a.dodgeWant)) a.dodgeWant = dodge;
        }
      }
      // Two cars each waiting for the other: across a junction or nose to nose, or come to stand on
      // top of each other (merging side by side, piled up at a dead end). After a while one drives on
      // as if the other weren't there, until it is clear of it (or the two would only inch forward by
      // turns): past a stuck car that isn't simply queueing ahead of us, or, of two stuck cars on top
      // of each other, the one with the lower id.
      const otherWay = facing < 0.5, onTop = f < v.hd + o.hd;
      if (o.ai && f > 0 && (otherWay || onTop) && (a.pushPast?.has(o.id) || (otherWay && a.blocked > 4 && o.ai.blocked > 2) ||
        (onTop && a.blocked > 2 && o.ai.blocked > 2 && v.id < o.id))) { (a.pushPast ||= new Set()).add(o.id); continue; }
      consider(o.x, o.z, o.hd, o.role === 'player', facing < -0.3, across);
    }
    if (g.player.state !== 'driving' && Math.abs(g.player.y - v.y) < 2) consider(g.player.x, g.player.z, 0.6, true);
    if (v.y < 1) {
      g.peds?.forEachNear(v.x, v.z, 20, ped => { if (!ped.onRoadOk) consider(ped.h.x, ped.h.z, 0.5, false); });
      g.animals?.forEachNear(v.x, v.z, 22, an => {
        // Its half-extent across our path: a cow sitting across the street blocks with its length.
        const c = Math.abs(Math.cos(an.heading - v.heading)), s = Math.abs(Math.sin(an.heading - v.heading));
        consider(an.x, an.z, an.cow ? 1.2 : 0.4, false, false, an.cow ? c * 0.55 + s * 1.1 : c * 0.25 + s * 0.4);
      });
    }

    // Desired speed.
    let want = a.cruise;
    if (gap < Infinity) want = Math.min(want, Math.max(0, (gap - 2.2) * 1.1));
    if (!a.turn) {
      // Speed breakers: everyone crawls over them, two-wheelers a little quicker.
      const toBump = g.city.bumps.ahead(a.road, a.dir, a.s, 28);
      if (toBump < 28) want = Math.min(want, (v.spec.two ? 4.2 : 3) + Math.max(0, toBump - 2) * 0.5);
      const j = a.dir > 0 ? net.rb[a.road] : net.ra[a.road];
      const toEnd = net.length[a.road] - endTrim(net, a.road, a.dir) - a.s;
      if (net.jRoads[j].length >= 3 && toEnd < 22) want = Math.min(want, 5 + toEnd * 0.45);
      if (this.signals.has(j) && toEnd < 16 && this.isRed(j, a.road, time)) want = Math.min(want, Math.max(0, (toEnd - 2) * 0.9));
    }
    if (a.wait > 0) { a.wait -= dt; want = 0; }
    // Accelerate gently, brake firmly.
    const accel = want > a.speed ? 2.6 : 7;
    a.speed += clamp(want - a.speed, -accel * dt, accel * dt);
    // Held up: by something just ahead, or waiting at a junction's mouth for someone crossing.
    if (a.speed < 0.3 && (gap < 6 || a.wait > 0)) {
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
      if (T.u < 1) {
        const u = T.u, iu = 1 - u;
        const x = iu * iu * T.x0 + 2 * iu * u * T.x1 + u * u * T.x2, z = iu * iu * T.z0 + 2 * iu * u * T.z1 + u * u * T.z2;
        const tx = 2 * iu * (T.x1 - T.x0) + 2 * u * (T.x2 - T.x1), tz = 2 * iu * (T.z1 - T.z0) + 2 * u * (T.z2 - T.z1);
        this._place(v, x, z, Math.atan2(tx, tz), dt, T.y0 + (T.y2 - T.y0) * u);
        return;
      }
      // Out of the curve onto the new road, with what is left of this frame's step already taken.
      a.road = T.road; a.dir = T.dir; a.s = T.s0 + (T.u - 1) * T.len; a.turn = null; a.pushPast = a.squeezing = null;
      a.cruise = Math.min(TYPE_CAP[v.type] ?? 99, CRUISE[net.type[a.road]] * (0.85 + ((v.id * 37) % 30) / 100));
    } else a.s += step;
    // The road we are on now (it may have just changed): where its lane ends, and the junction there.
    const len = net.length[a.road], end = len - endTrim(net, a.road, a.dir);
    if (a.s >= end) {
      if (!this._chooseTurn(v, a.dir > 0 ? net.rb[a.road] : net.ra[a.road])) { a.s = end; a.speed = 0; }
      else return;
    }
    // Ease out round whatever is parked ahead, and back into the lane after it.
    a.dodge = (a.dodge || 0) + clamp((a.dodgeWant || 0) - (a.dodge || 0), -1.2 * dt, 1.6 * dt);
    const off = net.laneOffset(a.road, a.lane, a.dir > 0 ? a.s : len - a.s) + (a.weave || 0) - a.dodge;
    net.lanePoint(a.road, a.dir, a.s, off, p);
    this._place(v, p.x, p.z, p.heading, dt, net.deckAt(a.road, a.dir > 0 ? a.s : len - a.s));
  }

  _place(v, x, z, heading, dt, y = 0) {
    const a = v.ai, B = this.game.city.bumps;
    // Up and over a speed breaker, nose first.
    const fx = Math.sin(heading), fz = Math.cos(heading), half = v.spec.wheelbase / 2;
    const hf = B.heightAt(x + fx * half, z + fz * half), hr = B.heightAt(x - fx * half, z - fz * half);
    v.y = y + (hf + hr) / 2;
    v.bumpPitch = Math.atan2(hf - hr, 2 * half);
    v.vx = (x - v.x) / Math.max(dt, 1e-4); v.vz = (z - v.z) / Math.max(dt, 1e-4);
    if (Math.hypot(v.vx, v.vz) > 40) { v.vx = 0; v.vz = 0; }
    v.x = x; v.z = z;
    const dh = wrapAngle(heading - v.heading), turn = dh * clamp(dt * 10, 0, 1);
    v.heading = wrapAngle(v.heading + turn);
    v.w = 0;
    v.steer = clamp(dh * 3, -0.5, 0.5);
    v.wheelSpin += (a.speed / (v.spec.wheelR || 0.3)) * dt;
    v.braking = a.speed < a.cruise * 0.5 && a.speed > 0.2;
    if (v.spec.two) v.lean = clamp(v.steer * 0.8 * Math.min(1, a.speed / 6), -0.4, 0.4);
    // The body rolls out of a turn, dips its nose braking and squats pulling away, as driven ones do.
    if (dt > 0) {
      const acc = (a.speed - (a.lastSpeed ?? a.speed)) / dt;
      a.lastSpeed = a.speed;
      v.roll += (clamp((a.speed * turn / dt) * 0.011, -0.07, 0.07) - v.roll) * clamp(dt * 6, 0, 1);
      v.pitch += (clamp(-acc * 0.011, -0.06, 0.06) - v.pitch) * clamp(dt * 6, 0, 1);
    }
  }

  /** At the end of a road: pick the next one (straight-ish, bigger roads), build a curve. */
  _chooseTurn(v, j) {
    const net = this.net, a = v.ai;
    const roads = net.jRoads[j];
    const p = this._p, q = this._q;
    const sEnd = net.length[a.road] - endTrim(net, a.road, a.dir);
    net.lanePoint(a.road, a.dir, sEnd, net.laneOffset(a.road, a.lane, a.dir > 0 ? sEnd : net.length[a.road] - sEnd), p);
    const inHeading = p.heading;
    let best = null, bestScore = -Infinity, hairpin = null, hairpinTurn = Infinity;
    const r = rng(hash2(v.id, Math.floor(this.game.time * 3)));
    for (const road of roads) {
      if (road === a.road && roads.length > 1) continue;
      if (net.bridge[road] && net.width[road] < 5) continue;
      const dir = net.ra[road] === j ? 1 : -1;
      if (!net.canTravel(road, dir)) continue; // no entry: one-way the other way
      if (MAJOR_ONLY.has(v.type) && net.type[road] > 3 && roads.length > 1) continue;
      const s = startTrim(net, road, dir);
      net.lanePoint(road, dir, s, net.laneOffset(road, 0, dir > 0 ? s : net.length[road] - s), q);
      const turn = Math.abs(wrapAngle(q.heading - inHeading));
      if (turn < hairpinTurn) { hairpinTurn = turn; hairpin = { road, dir }; }
      if (turn > 2.6 && roads.length > 1) continue;
      const score = -turn * 1.2 + (5 - net.type[road]) * 0.25 + r() * 1.6;
      if (score > bestScore) { bestScore = score; best = { road, dir }; }
    }
    // Only hairpins on: take the gentlest legal one. A dead end: turn around, unless the road is
    // one-way (a carriageway ending at the map's edge): then over to the nearest road leading away.
    if (!best) best = hairpin || (net.canTravel(a.road, -a.dir) ? { road: a.road, dir: -a.dir } : this._wayOut(a.road, a.dir));
    if (!best) return false; // nowhere legal to go: wait here
    // Junction etiquette: wait while someone else is crossing, but not forever (the wait counts as
    // being held up). Cars following the same turn keep flowing; one merging into our exit from
    // another road is someone crossing too.
    if (net.jRoads[j].length >= 3 && a.blocked < 3) {
      const R = net.jRadius[j] + 2;
      for (const o of this.game.vehicles.list) {
        if (o === v || !o.ai || !o.ai.turn || o.ai.turn.j !== j) continue;
        if (dist(o.x, o.z, net.jx[j], net.jz[j]) < R && (o.ai.turn.road !== best.road || o.ai.road !== a.road)) { a.wait = 0.4; return false; }
      }
    }
    const lane = net.lanes[best.road] > 1 ? a.lane : 0;
    const s0 = startTrim(net, best.road, best.dir);
    net.lanePoint(best.road, best.dir, s0, net.laneOffset(best.road, lane, best.dir > 0 ? s0 : net.length[best.road] - s0), q);
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
    const y0 = net.deckAt(a.road, a.dir > 0 ? sEnd : net.length[a.road] - sEnd);
    const y2 = net.deckAt(best.road, best.dir > 0 ? s0 : net.length[best.road] - s0);
    a.turn = { x0, z0, x1, z1, x2, z2, y0, y2, len, u: 0, road: best.road, dir: best.dir, s0, j };
    a.lane = lane;
    return true;
  }

  /**
   * Where to pass something standing l metres right (+) of our lane, `clear` being the sideways
   * room the two need: the dodge (+ right of the lane) on its right, towards the middle of the
   * road, or on its left when only the kerb side has room; null when neither stays on the road.
   * `over`: how far the car's side may go past an edge onto the verge (not a median, nor a raised
   * footpath where people walk); `ok`: whether a dodge will do.
   */
  _passBy(v, l, clear, over = 0, ok = null) {
    const net = this.net, a = v.ai, s = a.dir > 0 ? a.s : net.length[a.road] - a.s;
    if (over && this.game.city.footpathRoad(a.road, v.x, v.z)) over = 0;
    // How far the car can move over each way before its side reaches the edge of the road (or the verge).
    const lane = net.laneOffset(a.road, a.lane, s) + (a.weave || 0);
    const right = net.edgeAt(a.road, s, -a.dir) + lane - v.hw + (net.paired[a.road] ? 0 : over);
    const left = net.edgeAt(a.road, s, a.dir) - lane - v.hw + over;
    if (l + clear <= right && (!ok || ok(l + clear))) return l + clear;
    if (clear - l <= left && (!ok || ok(l - clear))) return l - clear;
    return null;
  }

  /**
   * Nothing solid (a pole, a wall, a shop's platform) where we would drive alongside something f
   * metres ahead, moved `dodge` right of our lane; `len`: half the stretch we are alongside it.
   */
  _clearBeside(v, dodge, f, len) {
    const net = this.net, a = v.ai, s = Math.min(a.s + f, net.length[a.road]), at = a.dir > 0 ? s : net.length[a.road] - s;
    const q = net.lanePoint(a.road, a.dir, s, net.laneOffset(a.road, a.lane, at) + (a.weave || 0) - dodge, this._side || (this._side = {}));
    return !this.game.colliders?.boxContact(q.x, q.z, v.hw, len, q.heading, this._hit || (this._hit = {}), v.y);
  }

  /**
   * The traffic coming the other way within `reach` metres ahead, where we would be once moved
   * `dodge` metres right of our lane, or null. Of two cars each waiting for the other to come
   * through, the lower id goes first.
   */
  _oncoming(v, dodge, reach) {
    const a = v.ai, fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    for (const o of this.game.vehicles.list) {
      if (o === v || !o.ai || Math.cos(o.heading - v.heading) > -0.3 || (o.ai.waitFor === v.id && v.id < o.id)) continue;
      const dx = o.x - v.x, dz = o.z - v.z, f = dx * fx + dz * fz;
      if (f > -(v.hd + o.hd) && f < reach && Math.abs(-dx * fz + dz * fx + (a.dodge || 0) - dodge) < v.hw + o.hw + 0.3) return o;
    }
    return null;
  }

  /** A one-way road ends with no way on: the nearest road within 20 m that traffic may leave by. */
  _wayOut(road, dir) {
    const cache = this._wayOuts || (this._wayOuts = new Map()), key = road * 2 + (dir > 0 ? 1 : 0);
    if (cache.has(key)) return cache.get(key);
    const net = this.net, j = dir > 0 ? net.rb[road] : net.ra[road];
    let best = null, bestD = 20;
    for (let k = 0; k < net.junctionCount; k++) {
      const d = dist(net.jx[j], net.jz[j], net.jx[k], net.jz[k]);
      if (d >= bestD) continue;
      for (const r of net.jRoads[k]) {
        const rd = net.ra[r] === k ? 1 : -1;
        if (r === road || net.ra[r] === net.rb[r] || (net.bridge[r] && net.width[r] < 5) || !net.canTravel(r, rd)) continue;
        best = { road: r, dir: rd }; bestD = d;
        break;
      }
    }
    cache.set(key, best);
    return best;
  }

  /** A crashed car: brake to a stop, then rejoin its lane if it still can. */
  _disturbed(v, dt) {
    const a = v.ai, net = this.net;
    v.stunned = (v.stunned || 0) - dt;
    this.game.controls.set(v, { throttle: 0, brake: 1, steer: 0, handbrake: false });
    if (v.stunned > 0 || speedOf(v) > 0.6 || v.wrecked) return;
    // The nearest road on the car's own level: a flyover deck and the street under or beside it are both near.
    const level = n => n && Math.abs(net.deckAt(n.road, n.s) - v.y) < 1.5;
    let n = net.nearest(v.x, v.z, 6, this._q);
    if (n && !level(n)) n = net.nearest(v.x, v.z, 6, this._q, r => !net.raised[r] === (v.y < 1.5));
    if (!level(n)) {
      // Stranded off the road: it stays put with its driver still in it (taking it is still a
      // carjacking), and is towed with the abandoned cars once the player is well away.
      v.ai = null;
      if (!v.driver) v.role = 'abandoned';
      return;
    }
    // Rejoin: snap to the nearest lane, facing the way the car points (or the only way a one-way road allows).
    const dir = net.oneway[n.road] || (Math.cos(v.heading - Math.atan2(n.dx, n.dz)) >= 0 ? 1 : -1);
    a.road = n.road; a.dir = dir; a.s = dir > 0 ? n.s : net.length[n.road] - n.s; a.turn = null; a.speed = 0; a.lane = 0; a.pushPast = a.squeezing = null;
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
    this.stuck = 0; this.reverseT = 0; this.unsticks = 0;
    this.ignore = null; // the vehicle we mean to hit (police ramming the player)
  }
  setPath(points, lane = true) {
    this.path = lane ? this.game.net.lanePath(points) : points; this.i = 0;
    const n = points.length / 2;
    this.goal = { x: points[(n - 1) * 2], z: points[(n - 1) * 2 + 1] };
    this.offT = 0;
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
      if (o === v || (target && o === this.ignore) || Math.abs(o.y - v.y) > 2) continue;
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
      // A lane between house walls is taken slowly: about 35 km/h in a 5 m lane, more on the big roads.
      const w = net.width[here.road];
      maxV = Math.min(maxV, (w < 7 ? 3 : 6) + w * (w < 7 ? 1.4 : 1.4 + this.aggression * 0.5));
      const len = net.length[here.road], toA = here.s, toB = len - here.s;
      const jA = net.jRoads[net.ra[here.road]].length >= 3, jB = net.jRoads[net.rb[here.road]].length >= 3;
      const toJ = Math.min(jA ? toA : Infinity, jB ? toB : Infinity);
      if (toJ < 25 && Math.abs(err) > 0.25) maxV = Math.min(maxV, 8 + toJ * 0.4);
    }
    if (Math.abs(err) > 0.9) maxV = Math.min(maxV, 9);
    maxV = Math.min(maxV, arriveCap);
    let throttle = spd < maxV ? 1 : 0, brake = spd > maxV + 1.5 ? 1 : 0;
    // Stuck against something: back up and swing round.
    // Stuck: pushing at a wall, or held up for seconds by something that will not move. The count
    // of tries survives re-planning and clears once the vehicle is properly under way again.
    const slow = Math.abs(spd) < 1 && !(this.path && this.i >= this.path.length / 2 - 2);
    if (slow) this.stuck += throttle > 0 ? dt : dt * 0.3; else this.stuck = Math.max(0, this.stuck - dt * 2);
    if (Math.abs(spd) > 3) { this.moving = (this.moving || 0) + dt; if (this.moving > 2) this.unsticks = 0; } else this.moving = 0;
    if (this.stuck > 1.2) {
      this.reverseT = 1.6; this.stuck = 0;
      // Wedged again and again (against a wall on a tight corner): let the owner rescue it.
      if (++this.unsticks >= 3) { this.unsticks = 0; if (this.onStuck?.() !== true && !target) this._replan(); }
      else if (this.unsticks === 2 && !target) this._replan();
    }
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
    // Abandoned, crashed, stranded and wrecked vehicles are towed once you're well away.
    for (const v of g.vehicles.list.slice()) {
      const stranded = v.role === 'traffic' && !v.ai;
      if ((v.role === 'abandoned' || stranded || v.wrecked) && !v.keep && v.role !== 'player' && dist(v.x, v.z, pos.x, pos.z) > 280) g.vehicles.remove(v);
    }
    if (this.bySeg.size >= max) return;
    const p = {};
    net.segmentsIn(pos.x - R, pos.z - R, pos.x + R, pos.z + R, (i, road) => {
      if (this.bySeg.size >= max || this.bySeg.has(i) || net.bridge[road] || net.raised[road]) return;
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
      // Either kerb, but never on the median of a divided road.
      const side = net.kerbSide(road) || (r.chance(0.5) ? 1 : -1);
      const off = type === 'bike' || type === 'scooter' ? w / 2 + 0.55 : w / 2 - 0.95;
      const x = p.x + p.dz * off * side, z = p.z - p.dx * off * side;
      // Two-wheelers park nose-in at an angle; cars along the kerb, facing the traffic's way.
      const flow = net.oneway[road] || side;
      const along = Math.atan2(p.dx, p.dz) + (flow > 0 ? 0 : Math.PI);
      const heading = type === 'bike' || type === 'scooter' ? along + side * 1.2 : along;
      if (g.vehicles.list.some(o => dist(o.x, o.z, x, z) < 4)) return;
      if (g.colliders.blocked(x, z, 0.5)) return;
      const v = g.vehicles.spawn(type, x, z, heading, { role: 'parked', driver: false, seed: hash2(i, 7) });
      if (v.spec.two) {
        // Across the kerb of a raised footpath: each wheel stands on the road or up on the footpath.
        const half = v.spec.wheelbase / 2, hx = Math.sin(heading) * half, hz = Math.cos(heading) * half;
        const across = (wx, wz) => Math.abs((wx - p.x) * p.dz - (wz - p.z) * p.dx);
        const hf = g.city.pavementAt(i, across(x + hx, z + hz)), hr = g.city.pavementAt(i, across(x - hx, z - hz));
        v.y = (hf + hr) / 2;
        v.bumpPitch = Math.atan2(hf - hr, 2 * half);
      }
      this.bySeg.set(i, v);
    });
  }
}
