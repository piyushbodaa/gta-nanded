// Side-job step types: TAIL (follow without being seen), ESCORT (see a slow vehicle through an
// ambush) and DEFEND (hold a handcart against waves of extortion boys). Same {kind, enter, update,
// exit} shape as the steps in missions.js; installSideSteps(Steps) adds them as S.tail, S.escort and
// S.defend. Everything cross-feature is guarded (hud.meter, weapons, weaponFx, missions.inSight).
// No per-frame allocation: paths are planned at enter and at wave spawns only.
import * as M from './missions.js';
import { dist, clamp } from '../core/math.js';

const BLUE = '#64b5f6', RED = '#ff4d4d';

// ------------------------------------------------------------------ pure helpers
/**
 * One tick of the TAIL suspicion meter. in: { d (m to target), stopped (target waiting), bumped,
 * shot (a gun fired near it, or it was hurt), sprint (running close on foot) }. Mutates and returns
 * s = { sus 0..1, nearT, farT, result: null | 'spotted' | 'lost' }.
 */
export function tailTick(s, { d, stopped = false, bumped = false, shot = false, sprint = false }, dt, opts = {}) {
  const near = opts.near ?? 12, nearFor = opts.nearFor ?? 2.5, far = opts.far ?? 90, farFor = opts.farFor ?? 7;
  if (shot) { s.sus = 1; s.result = 'spotted'; return s; }
  s.nearT = d < near ? (s.nearT || 0) + dt : 0;
  let rate = 0;
  if (d < near) rate += s.nearT > nearFor ? 0.45 : 0.12;
  if (stopped && d < 25) rate += 0.1;
  if (sprint && d < 20) rate += 0.25;
  if (bumped) s.sus = (s.sus || 0) + 0.35;
  if (!rate && d >= 25 && d <= far) rate = -0.06;
  s.sus = clamp((s.sus || 0) + rate * dt, 0, 1);
  s.farT = d > far ? (s.farT || 0) + dt : 0;
  s.result = s.sus >= 1 ? 'spotted' : s.farT > farFor ? 'lost' : null;
  return s;
}

/** Cumulative lengths along a flat [x0,z0,x1,z1,...] path: out[k] = metres from the start to point k. */
export function pathLengths(p) {
  const out = [0];
  for (let i = 2; i < p.length; i += 2) out.push(out[out.length - 1] + Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]));
  return out;
}

/** How far along a path (0..1) someone at (x, z) heading for point idx is. */
export function routeProgress(lens, path, idx, x, z) {
  const n = lens.length, total = lens[n - 1] || 1;
  const k = clamp(idx, 1, n - 1);
  const left = Math.min(dist(x, z, path[k * 2], path[k * 2 + 1]), lens[k] - lens[k - 1]);
  return clamp((lens[k] - left) / total, 0, 1);
}

/** The point `metres` along a path (clamped to its ends), written into out. */
export function pointAlong(lens, path, metres, out = {}) {
  const n = lens.length;
  metres = clamp(metres, 0, lens[n - 1]);
  let k = 1;
  while (k < n - 1 && lens[k] < metres) k++;
  const seg = lens[k] - lens[k - 1] || 1, t = (metres - lens[k - 1]) / seg;
  out.x = path[k * 2 - 2] + (path[k * 2] - path[k * 2 - 2]) * t;
  out.z = path[k * 2 - 1] + (path[k * 2 + 1] - path[k * 2 - 1]) * t;
  out.k = k;
  return out;
}

/** A road path through the points (each leg by the road network, straight where it has none). */
export function planRoute(g, from, pts) {
  const out = [from.x, from.z];
  let a = from;
  for (const p of pts) {
    const r = g.net?.route?.(a.x, a.z, p.x, p.z);
    if (r?.points?.length >= 4) for (let i = 2; i < r.points.length; i += 2) out.push(r.points[i], r.points[i + 1]);
    else out.push(p.x, p.z);
    a = p;
  }
  return out;
}

/** At most this many attackers at once: 4, or 3 on the Fast tier. */
export const attackerCap = g => (g.quality?.tier === 'low' ? 3 : 4);

const meter = (g, v, label, urgent) => g.hud?.meter?.(v, label, urgent);
const shotSince = (g, t) => (g.weapons?.lastShotT ?? -99) > t;
const inSight = (g, x, z) => (M.inSight ? M.inSight(g, x, 0, z) : dist(x, z, g.player.pos.x, g.player.pos.z) < 45);
const STOP = { throttle: 0, brake: 1, steer: 0, handbrake: false };

// ------------------------------------------------------------------ TAIL
/**
 * Follow `name` (a vehicle, or with onFoot a scripted ped) along `route` ([{x, z, wait?, lines?}],
 * last point = where it is going) without being seen. No GPS line: a blue arrow and dot.
 */
export function tail(name, route, text, opts = {}) {
  const { speed = 0.55, onFoot = false, failText = 'They spotted you.', lostText = 'You lost them.' } = opts;
  const s = { sus: 0, nearT: 0, farT: 0, result: null };
  let path = null, lens = null, drv = null, idx = 0, waitT = 0, startT = 0, hp0 = 0, lastHit = 0, label = '';
  const end = route[route.length - 1];
  return {
    kind: 'tail', name, route, opts, target: end,
    enter(c) {
      const g = c.g, e = c.ent[name];
      s.sus = 0; s.nearT = 0; s.farT = 0; s.result = null; idx = 0; waitT = 0; label = '';
      startT = g.time ?? 0;
      c.objective(text);
      c.m.target = null;
      if (!e) return;
      e.arrow = true; e.blip = BLUE; e.vital = false;
      if (onFoot) {
        const h = e.h;
        path = planRoute(g, { x: h.x, z: h.z }, route); lens = pathLengths(path);
        e.state = 'scripted'; e.t = 999; e.walked = 0;
      } else {
        e.kinematic = false; e.role = 'mission'; hp0 = e.health ?? 1000; lastHit = e.lastHit || 0;
        drv = c.driver(e, { aggression: 0.3, maxSpeed: (e.spec?.top ?? 20) * speed });
        path = planRoute(g, e, route); lens = pathLengths(path);
        drv.setPath?.(path);
      }
    },
    update(c, dt) {
      const g = c.g, e = c.ent[name], P = g.player, pos = P.pos;
      if (!e || e.wrecked || e.state === 'dead') return 'fail:You were meant to follow them, not stop them.';
      c.m.target = null;
      const ex = onFoot ? e.h.x : e.x, ez = onFoot ? e.h.z : e.z;
      const d = dist(pos.x, pos.z, ex, ez);
      // Waiting at a stop on the way (a paan shop): stopped, lines said once.
      const wp = route[idx];
      if (wp && dist(ex, ez, wp.x, wp.z) < (onFoot ? 2.5 : 10)) {
        if (wp.wait && waitT <= 0 && !wp._done) { waitT = wp.wait; if (wp.lines) c.chatter(wp.lines); }
        if (waitT > 0) { waitT -= dt; if (waitT <= 0) { wp._done = true; idx++; } }
        else idx++;
      }
      const stopped = waitT > 0;
      const bumped = !onFoot && (e.lastHit || 0) !== lastHit && P.vehicle && dist(P.vehicle.x, P.vehicle.z, ex, ez) < 8;
      if (!onFoot) lastHit = e.lastHit || 0;
      const hurt = onFoot ? e.state === 'down' || (e.hits || 0) > 0 : (e.health ?? hp0) < hp0 - 150;
      const shot = hurt || (shotSince(g, startT) && d < 80);
      tailTick(s, { d, stopped, bumped, shot, sprint: !P.vehicle && (P.speed || 0) > 4.5 }, dt, opts);
      meter(g, s.farT > 0 ? 1 - s.farT / (opts.farFor ?? 7) : s.sus, s.farT > 0 ? 'LOSING THEM' : 'SUSPICION', s.sus > 0.7 || s.farT > 0);
      if (s.result === 'spotted') return `fail:${failText}`;
      if (s.result === 'lost') return `fail:${lostText}`;
      // Fair on a phone: slower when you fall behind, a little quicker when you crowd it.
      const band = d > 60 ? 0.7 : d < 15 ? 1.1 : 1;
      const arrived = dist(ex, ez, end.x, end.z) < (onFoot ? 2.5 : 12) && idx >= route.length - 1;
      if (arrived) return 'done';
      if (onFoot) {
        const h = e.h;
        if (stopped) { h.pose = 'idle'; h.speed = 0; return null; }
        const sp = 1.3 * band;
        e.walked = Math.min(e.walked + sp * dt, lens[lens.length - 1]);
        const at = pointAlong(lens, path, e.walked, c.vars._tailPt || (c.vars._tailPt = {}));
        h.yaw = Math.atan2(at.x - h.x, at.z - h.z); h.x = at.x; h.z = at.z; h.pose = 'walk'; h.speed = sp;
        if (e.walked >= lens[lens.length - 1]) idx = route.length - 1;
        return null;
      }
      if (stopped) { g.controls.set(e, STOP); return null; }
      drv.maxSpeed = (e.spec?.top ?? 20) * speed * band;
      g.controls.set(e, drv.control(dt));
      if (drv.done) idx = route.length - 1;
      return null;
    },
    exit(c) {
      const e = c.ent[name];
      meter(c.g, null);
      if (e) { e.arrow = false; e.blip = null; if (!e.h && c.g.player.vehicle !== e) c.g.controls?.delete(e); }
    },
  };
}

// ------------------------------------------------------------------ ESCORT
/**
 * See the vehicle `name` along `route` to its end. It drives at `speed` of its top speed, waits while
 * you're over waitFar away, and the job fails after failFarFor s over failFar. Ambush waves come at
 * fractions of the route: [{ at, bikes, type='bike', gunner=null|'p92'|'uzi', from='behind'|'ahead', lines }].
 */
export function escort(name, route, text, opts = {}) {
  const { speed = 0.5, waitFar = 55, failFar = 220, failFarFor = 15, meterLabel = 'TEMPO', ambush = [] } = opts;
  let path = null, lens = null, drv = null, far = 0, wave = 0, n = 0;
  const end = route[route.length - 1], pt = {};
  return {
    kind: 'escort', name, route, opts, target: end,
    enter(c) {
      const g = c.g, v = c.ent[name];
      far = 0; wave = 0; n = 0;
      c.objective(text);
      if (!v) return;
      v.vital = true; v.arrow = true; v.blip = BLUE; v.kinematic = false; v.role = 'mission';
      v.vitalMsg ??= `The ${(v.label || 'convoy').replace(/^(the|your)\s+/i, '')} was wrecked.`;
      drv = c.driver(v, { aggression: 0.25, maxSpeed: (v.spec?.top ?? 20) * speed });
      path = planRoute(g, v, route); lens = pathLengths(path);
      drv.setPath?.(path);
    },
    update(c, dt) {
      const g = c.g, v = c.ent[name], pos = g.player.pos;
      if (!v) return 'fail:The convoy is gone.';
      if (v.wrecked) return `fail:${v.vitalMsg}`;
      c.m.target = { x: v.x, z: v.z, marker: false };
      meter(g, clamp((v.health ?? 1000) / 1000, 0, 1), meterLabel, (v.health ?? 1000) < 350);
      if (dist(v.x, v.z, end.x, end.z) < 12) return 'done';
      const d = dist(pos.x, pos.z, v.x, v.z);
      far = d > failFar ? far + dt : 0;
      if (far > failFarFor) return `fail:You left the ${(v.label || 'convoy').replace(/^(the|your)\s+/i, '')} behind.`;
      // Ambush waves by how far along it is.
      const prog = routeProgress(lens, path, drv?.i ?? 1, v.x, v.z);
      while (wave < ambush.length && prog >= ambush[wave].at) spawnWave(c, ambush[wave++], v);
      driveAmbushers(c, v, dt);
      if (d > waitFar || g.player.vehicle === v) { if (g.player.vehicle !== v) g.controls.set(v, STOP); return null; }
      g.controls.set(v, drv.control(dt));
      return null;
    },
    exit(c) {
      const v = c.ent[name];
      meter(c.g, null);
      if (v) { v.arrow = false; if (c.g.player.vehicle !== v) c.g.controls?.delete(v); }
      for (const e of Object.values(c.ent)) if (e?.ambush) { e.ambush = null; e.huntTarget = null; e.gunner = null; }
    },
  };

  function spawnWave(c, w, v) {
    const g = c.g, live = Object.values(c.ent).filter(e => e?.ambush && !e.wrecked).length;
    const count = Math.min(w.bikes ?? 2, attackerCap(g) - live);
    if (w.lines) c.chatter(w.lines);
    const along = routeProgress(lens, path, drv?.i ?? 1, v.x, v.z) * lens[lens.length - 1];
    for (let k = 0; k < count; k++) {
      // Out of sight where we can: further back (or on ahead) along the route.
      let spot = null;
      for (const m of [70, 95, 120, 150]) {
        pointAlong(lens, path, along + (w.from === 'ahead' ? m : -m) + k * 7, pt);
        const rp = c.roadPoint(pt.x, pt.z, 1);
        spot = rp;
        if (!inSight(g, rp.x, rp.z)) break;
      }
      const type = w.type || 'bike';
      const a = c.spawnVehicle(`amb${n++}`, type, spot.x, spot.z, spot.heading, { driver: true, label: type === 'suv' ? 'gang SUV' : 'gang bike', color: 0x1b1b1b });
      a.kinematic = false; a.role = 'mission'; a.blip = RED; a.keep = true;
      a.ambush = c.driver(a, { aggression: 0.9, maxSpeed: (a.spec?.top ?? 25) * 0.95 });
      a.huntTarget = v; a.gunner = w.gunner || null; a.fireT = 1 + Math.random();
    }
  }

  function driveAmbushers(c, v, dt) {
    const g = c.g, P = g.player;
    for (const a of Object.values(c.ent)) {
      if (!a?.ambush || a.wrecked) continue;
      if (a === P.vehicle) { a.ambush = null; a.blip = null; continue; } // carjacked: out of it
      if (!a.driver && a.pilot) { a.ambush = null; a.blip = null; continue; } // rider knocked off
      const tgt = a.huntTarget && !a.huntTarget.wrecked ? a.huntTarget : P.vehicle || P.pos;
      a.ambush.ignore = null;
      g.controls.set(a, a.ambush.control(dt, { x: tgt.x, z: tgt.z }));
      if (a.gunner) gunnerFire(g, a, v, dt);
    }
  }
}

/**
 * A pillion rider fires every 0.9-1.5 s within 28 m: 65% at the convoy, the rest at the player.
 * Exported for tests. Draws a tracer and plays the shot when the game has them.
 */
export function gunnerFire(g, a, convoy, dt, rnd = Math.random) {
  if ((a.fireT = (a.fireT ?? 1) - dt) > 0) return null;
  a.fireT = 0.9 + rnd() * 0.6;
  const P = g.player, atConvoy = convoy && !convoy.wrecked && rnd() < 0.65;
  const t = atConvoy ? convoy : P.vehicle || P.pos;
  if (dist(a.x, a.z, t.x, t.z) > 28) return null;
  if (g.weapons?.inHoly?.(a.x, a.z) || g.weapons?.inHoly?.(t.x, t.z)) return null;
  if (g.colliders?.raycast && g.colliders.raycast(a.x, 1.5, a.z, t.x, 1.2, t.z, 0.05) < 0.999) return null;
  g.weaponFx?.shot?.(a.x, 1.5, a.z, t.x, 1.2, t.z, a.gunner);
  g.audio?.sfxAt?.(a.gunner, a.x, a.z);
  if (atConvoy) { g.damageVehicle?.(convoy, 12, false); return 'convoy'; }
  if (P.vehicle) g.damageVehicle?.(P.vehicle, 10, false);
  else P.damage?.(8, 'gang', a);
  return 'player';
}

// ------------------------------------------------------------------ DEFEND
/**
 * Hold the handcart at `stall` ({x, z}) against waves: [{ n, armed=null|'p92'|'uzi', hits=2,
 * boss: { name, hits, look }, lines, delay=4 }]. Unarmed goons run in and smash the cart (draining
 * its health while at it) and turn on you within 6 m or once hit; armed ones shoot from range.
 */
export function defend(stall, text, opts = {}) {
  const { radius = 18, leaveFor = 8, stallLabel = 'TAPRI', stallFail = 'They smashed the cart.', smash = 2.5, waves = [], kind = 'thug' } = opts;
  let wave = -1, gap = 0, hp = 1, away = 0, n = 0;
  let goons = [];
  return {
    kind: 'defend', stall, opts, target: stall,
    enter(c) {
      wave = -1; gap = 1.5; hp = 1; away = 0; n = 0; goons = [];
      c.objective(text);
      c.setTarget({ x: stall.x, z: stall.z, r: radius, h: 0.4, gps: false, marker: false });
    },
    update(c, dt) {
      const g = c.g, pos = g.player.pos;
      c.m.target = null;
      // Settle the beaten; count who's left.
      let left = 0;
      for (const p of goons) {
        if (!p || p.settled) continue;
        if ((p.hits || 0) >= (p.needHits || 2) || p.state === 'dead') { settle(p); continue; }
        left++;
        if (p.goal === 'cart') {
          const h = p.h, d = dist(h.x, h.z, stall.x, stall.z), dp = dist(h.x, h.z, pos.x, pos.z);
          if (dp < 6 || (p.hits || 0) > 0 || p.state === 'down' || p.state === 'getup') { p.goal = 'you'; p.state = p.state === 'down' || p.state === 'getup' ? p.state : 'fight'; p.after = 'fight'; p.t = 60; continue; }
          if (d > 1.6) {
            const sp = 2.8;
            h.yaw = Math.atan2(stall.x - h.x, stall.z - h.z);
            h.x += Math.sin(h.yaw) * sp * dt; h.z += Math.cos(h.yaw) * sp * dt; h.pose = 'run'; h.speed = sp;
          } else { h.pose = 'idle'; h.speed = 0; h.punch = 1; hp -= smash / 100 * dt; }
        } else {
          // On you (or armed from range): never wandering off mid-wave.
          if (p.state === 'flee' || p.state === 'walk' || p.state === 'cower' || p.state === 'scripted') { p.state = 'fight'; p.t = 60; }
          if (p.state === 'down' || p.state === 'getup') p.after = 'fight';
        }
      }
      meter(g, clamp(hp, 0, 1), stallLabel, hp < 0.35);
      if (hp <= 0) return `fail:${stallFail}`;
      away = dist(pos.x, pos.z, stall.x, stall.z) > radius + 12 ? away + dt : 0;
      if (away > leaveFor) return `fail:You left ${stallLabel === 'TAPRI' ? 'the tapri' : 'them'} to it.`;
      if (left) return null;
      if (wave >= waves.length - 1) return 'done';
      if ((gap -= dt) > 0) return null;
      const w = waves[++wave];
      gap = w.delay ?? 4;
      if (w.lines) c.chatter(w.lines);
      const cap = attackerCap(g), total = Math.min(w.n ?? 3, cap) + (w.boss ? 1 : 0);
      for (let k = 0; k < total; k++) {
        const boss = w.boss && k === total - 1 ? w.boss : null;
        const a = (k / total) * Math.PI * 2 + wave;
        const rp = c.roadPoint(stall.x + Math.sin(a) * 40, stall.z + Math.cos(a) * 40, 1);
        const name = boss?.name || `goon${n++}`;
        const p = c.spawnPed(name, kind, rp.x, rp.z, { state: 'scripted' });
        if (boss?.look) Object.assign(p.h.outfit, boss.look);
        p.needHits = boss?.hits ?? w.hits ?? 2; p.hits = 0; p.grudge = 3; p.blip = RED; p.t = 60;
        p.armed = boss ? (w.armed || null) : w.armed || null;
        if (p.armed) { p.goal = 'you'; p.state = 'fight'; } else { p.goal = 'cart'; p.state = 'scripted'; }
        goons.push(p);
      }
      return null;
    },
    exit(c) { meter(c.g, null); },
  };
}

/** Beaten for good: no grudge left, no gun, cowering a moment then off (never knocked out for good). */
export function settle(p) {
  p.settled = true; p.grudge = 0; p.blip = null; p.armed = null; p.goal = null;
  if (p.state === 'dead') return p;
  if (p.state === 'down' || p.state === 'getup') p.after = 'cower';
  else { p.state = 'cower'; p.t = 3; }
  return p;
}

/** Add tail, escort and defend to the Steps object (missions.js). Idempotent. */
export function installSideSteps(Steps) {
  Steps.tail ??= tail;
  Steps.escort ??= escort;
  Steps.defend ??= defend;
  return Steps;
}
