// Street events ("Raste pe kuch hua"): in free roam, every few minutes something happens a short
// way off — a chain-snatcher on a bike, someone hurt who needs the Civil Hospital, a student late
// for a paper, a baraat dancing down the road. A blue ! on the radar and a bark; ignore it and it
// goes away. Events run through the mission runner (def.event = kind) via draft/adopt/discard (C4),
// so they get its markers, GPS, timers, cleanup and crash safety. Without that API no event starts.
import * as Missions from './missions.js';
import { dist, clamp } from '../core/math.js';
import { speedOf } from '../actors/vehicle-physics.js';
import { HOSPITAL, GARAGE } from './story.js';
import { busy } from './mission-state.js';

const S = Missions.Steps;

// ------------------------------------------------------------------ tuning
export const FIRST_WAIT = [150, 240];
export const GAP = [180, 360];
export const OFFER_RANGE = [45, 140];
export const OFFER_LOSE_DIST = 300;
export const OFFER_LOSE_TIME = 90;
export const RETRY_WAIT = 20;
export const MAX_TRIES = 12;
export const BEAT = 0.5, BEATS = 16, BEAT_WINDOW = 0.12;
const BLUE = '#4fa3ff';

// ------------------------------------------------------------------ pure helpers
/** 23:00–05:30 nothing happens. */
export const quietHours = h => h >= 23 || h < 5.5;
const inHours = ([a, b], h) => h >= a && h < b;

/**
 * Pick a kind to offer: in its hours, not in the rain if it minds the rain, not the one before,
 * weighted. r is a 0..1 number. Returns null when nothing fits.
 */
export function pick(kinds, hours, weather, r = Math.random(), recent = [], events = EVENTS) {
  const last = recent[recent.length - 1];
  const ok = kinds.filter(k => {
    const e = events[k];
    return e && e.weight > 0 && k !== last && inHours(e.hours, hours) && !(e.dry && weather === 'rain');
  });
  const total = ok.reduce((s, k) => s + events[k].weight, 0);
  if (!total) return null;
  let x = r * total;
  for (const k of ok) { x -= events[k].weight; if (x < 0) return k; }
  return ok[ok.length - 1];
}

/** A ride's pay: ₹150 + 0.15 per metre of route, plus ₹150 and Izzat +1 for a gentle ride (comfort ≥70). */
export function rideReward({ route = 0, left = 0, limit = 1, comfort = 100 } = {}) {
  void left; void limit;
  const gentle = comfort >= 70;
  return { cash: Math.round(150 + 0.15 * route + (gentle ? 150 : 0)), izzat: gentle ? 1 : 0, gentle };
}

/** The exam ride: ₹120–300 scaled by the share of time left. */
export function examReward({ left = 0, limit = 1 } = {}) {
  return { cash: Math.round(120 + 180 * clamp(left / Math.max(1, limit), 0, 1)), izzat: 1 };
}

/** How many taps landed within ±window of a beat (one per beat at most). */
export function beatScore(taps, t0, period = BEAT, beats = BEATS, window = BEAT_WINDOW) {
  const hit = new Set();
  for (const t of taps) {
    const k = Math.round((t - t0) / period);
    if (k < 0 || k >= beats || hit.has(k)) continue;
    if (Math.abs(t - t0 - k * period) <= window) hit.add(k);
  }
  return hit.size;
}

/** C3 busy(g), from mission-state.js. */
export { busy };

/** Why no event may start or stay offered now (a short reason), or null when one may. */
export function blockedWhy(g) {
  if (busy(g)) return 'busy';
  if ((g.police?.level || 0) > 0 || g.police?.pending?.length) return 'police';
  const h = g.sky?.hours ?? 12;
  if (quietHours(h)) return 'night';
  if (!g.freeRoam && !g.save?.done?.('c1')) return 'story';
  const P = g.player?.pos;
  if (P && dist(P.x, P.z, GARAGE.x, GARAGE.z) < 40) return 'garage';
  return null;
}

const lowTier = g => /low|fast/i.test(String(g.quality?.tier ?? g.quality?.autoTier ?? ''));
const inZone = (g, x, z) => (g.weapons?.zones || []).some(s => (s.x - x) ** 2 + (s.z - z) ** 2 < s.r2);
const seen = (g, x, z) => (Missions.inSight ? Missions.inSight(g, x, 0, z) : dist(x, z, g.player.pos.x, g.player.pos.z) < 45);
const alive = (g, p) => p && p.state !== 'dead' && (!g.peds?.list || g.peds.list.includes(p));

/**
 * A kerbside spot on a ground-level road 45–140 m from the player, outside holy places, not in
 * a wall and out of the player's sight. One net.nearest per try. opts.road(net, road) filters roads.
 */
export function kerbSpot(g, r, opts = {}) {
  const net = g.net, P = g.player.pos;
  const ang = r() * Math.PI * 2, d = OFFER_RANGE[0] + r() * (OFFER_RANGE[1] - OFFER_RANGE[0]);
  const n = net.nearest(P.x + Math.cos(ang) * d, P.z + Math.sin(ang) * d, 40, {},
    road => !net.raised?.[road] && !net.bridge?.[road] && (!opts.road || opts.road(net, road)));
  if (!n) return null;
  const side = net.kerbSide?.(n.road) || 1;
  const off = (net.width[n.road] / 2 + (opts.inLane ? -1.6 : 0.6)) * side;
  const x = n.x + n.dz * off, z = n.z - n.dx * off;
  const dd = dist(x, z, P.x, P.z);
  if (dd < OFFER_RANGE[0] - 5 || dd > OFFER_RANGE[1] + 45) return null;
  if (inZone(g, x, z) || g.nearShrineAt?.(x, z)) return null;
  if (g.colliders?.blocked?.(x, z, 0.4)) return null;
  if (seen(g, x, z)) return null;
  // Along the flow of traffic on the kerb's side (left-hand traffic: side +1 is left of a->b).
  const flow = net.oneway?.[n.road] || side;
  const heading = Math.atan2(n.dx, n.dz) + (flow > 0 ? 0 : Math.PI);
  return { x, z, y: 0, road: n.road, heading, nx: n.x, nz: n.z };
}

/** Places of the given categories `min`–`max` metres (straight line) from (x, z). */
function placesNear(g, cats, x, z, min, max) {
  return (g.city?.places || []).filter(p => cats.includes(p.category) && !/veterinary/i.test(p.id) && (d => d >= min && d <= max)(dist(p.ax ?? p.x, p.az ?? p.z, x, z)));
}
const routeLen = (g, x, z, t) => { const rt = g.net.route?.(x, z, t.x, t.z); return rt ? rt.length : dist(x, z, t.x, t.z) * 1.3; };

/** The hospital for someone hurt at (x, z): the Civil Hospital, or the nearest other one if that is over 2.2 km away. */
export function hospitalFor(g, x, z) {
  const civil = { x: HOSPITAL.x, z: HOSPITAL.z, name: 'Civil Hospital' };
  if (routeLen(g, x, z, civil) <= 2200) return civil;
  let best = civil, bd = Infinity;
  for (const id of ['government-medical-hospital', 'lavekar-hospital']) {
    const p = g.city?.places?.find(q => q.id === id);
    if (!p) continue;
    const t = { x: p.ax ?? p.x, z: p.az ?? p.z, name: p.shortName || p.name };
    const d = routeLen(g, x, z, t);
    if (d < bd) { bd = d; best = t; }
  }
  return bd < routeLen(g, x, z, civil) ? best : civil;
}

/** A coaching class or college 400–1400 m from (x, z), or null. */
export function classFor(g, x, z, r = Math.random) {
  const list = placesNear(g, ['coaching', 'college'], x, z, 400, 1400);
  if (!list.length) return null;
  const p = list[Math.floor(r() * list.length) % list.length];
  return { x: p.ax ?? p.x, z: p.az ?? p.z, name: p.shortName || p.name };
}

// ------------------------------------------------------------------ event-only steps
/** Pull up beside `name` (within 7 m, nearly stopped, a free seat) and they climb in. */
function board(name, text) {
  return {
    kind: 'board',
    enter(c) { c.objective(text); },
    update(c) {
      const g = c.g, p = c.ent[name];
      if (!alive(g, p)) return 'fail:They could not wait.';
      c.m.target = { x: p.h.x, z: p.h.z, r: 4, h: 3, markerColor: 0x64b5f6 };
      const v = g.player.vehicle;
      if (!v) { c.objective(`${text} <i>(you need a vehicle)</i>`); return null; }
      if (dist(v.x, v.z, p.h.x, p.h.z) > 7 || speedOf(v) > 2) { c.objective(text); return null; }
      if (!((v.model?.passengers?.length || 0) > (v.passengers?.length || 0))) { c.objective('No free seat. Bring a car, auto or bike with room.'); return null; }
      const h = g.vehicles.addPassenger(v, p.h.outfit);
      if (!h) return null;
      g.peds.remove(p); delete c.ent[name];
      c.m.vars.rider = h; c.m.vars.rideV = v;
      return 'done';
    },
  };
}

/** Put a passenger back on their feet beside the car. */
function unload(g, v, h) {
  if (!v || !h) return;
  const i = v.passengers?.indexOf(h);
  if (i == null || i < 0) return;
  v.passengers.splice(i, 1);
  const p = g.peds._make(h, h.x, h.z, null);
  h.pose = 'walk'; p.state = 'walk';
}

/**
 * Drive the passenger to `dest` before the timer runs out, in the same vehicle. Tracks a comfort
 * meter in m.vars.comfort (jolts come through StreetEvents.jolt) and records route/limit/left.
 */
function ride(destFn, { label, timeFor, text, chatter = [], groan = null, fail = 'Too late.' }) {
  let said, groanT;
  return {
    kind: 'ride',
    enter(c) {
      const g = c.g, v = c.m.vars.rideV, t = destFn(c);
      c.m.vars.dest = t;
      c.m.vars.route = routeLen(g, v.x, v.z, t);
      c.m.vars.limit = timeFor(c.m.vars.route);
      c.m.vars.comfort = 100;
      c.m.vars.start = dist(v.x, v.z, t.x, t.z);
      said = new Set(); groanT = 0;
      c.setTarget({ x: t.x, z: t.z, r: 5, h: 4 });
      c.timer(c.m.vars.limit, label, fail);
      c.objective(text(t));
    },
    update(c, dt) {
      const g = c.g, vars = c.m.vars, v = vars.rideV, t = vars.dest, P = g.player;
      if (!v || v.wrecked || (g.vehicles.list && !g.vehicles.list.includes(v))) return 'fail:The ride is wrecked.';
      if (!v.passengers?.includes(vars.rider)) return 'fail:The passenger got out.';
      if (P.vehicle !== v) { c.objective('Get back in.'); c.m.target = { x: v.x, z: v.z, marker: false }; return null; }
      c.m.target = { x: t.x, z: t.z, r: 5, h: 4 };
      if ((v.slip || 0) > 0.35) vars.comfort = Math.max(0, vars.comfort - dt);
      groanT -= dt;
      if (groan && vars.comfort < 30 && groanT <= 0) { groanT = 7; c.chatter([groan]); }
      const d = dist(v.x, v.z, t.x, t.z);
      for (const [frac, lines] of chatter) if (!said.has(frac) && d < vars.start * frac) { said.add(frac); c.chatter(lines); }
      if (d > 6.5 || speedOf(v) > 4) return null;
      vars.left = Math.max(0, c.m.timer ?? 0);
      return 'done';
    },
    exit(c) { c.stopTimer(); unload(c.g, c.m.vars.rideV, c.m.vars.rider); c.m.vars.rider = null; },
  };
}

/** A step that ends early (done) when `name` is shot dead, noting it in m.vars.shot. */
function unlessDead(step, name) {
  const up = step.update;
  return { ...step, update(c, dt) {
    const p = c.ent[name];
    if (p && p.state === 'dead') { c.m.vars.shot = true; p.blip = null; return 'done'; }
    return up ? up.call(step, c, dt) : 'done';
  } };
}

/** The baraat: walk 4 s, dance 6 s, round again; wait behind it, honk at it, or dance with it. */
function procession() {
  let honkWas = false;
  return {
    kind: 'baraat',
    enter(c) {
      const v = c.m.vars;
      v.t = 0; v.waitT = 0; v.honks = 0; v.taps = []; v.danceT0 = null; v.beatK = -1;
      c.objective('A <b>baraat</b>! Wait behind it, or get out and dance.');
    },
    update(c, dt) {
      const g = c.g, v = c.m.vars, P = g.player, pos = P.pos, ms = v.members || [];
      v.t += dt;
      const lead = ms.find(p => alive(g, p));
      if (!lead) return 'fail:Lagna bigadla!';
      // Scatter: three or more knocked down, or a gun fired close by.
      const down = ms.filter(p => !alive(g, p) || p.state === 'down' || p.state === 'getup' || p.state === 'flee' || p.state === 'dive').length;
      const shot = g.weapons && g.time != null && g.time - (g.weapons.lastShotT ?? -99) < 0.15 && dist(pos.x, pos.z, lead.h.x, lead.h.z) < 40;
      if (down >= 3 || shot) {
        for (const p of ms) if (alive(g, p)) { p.state = 'flee'; p.t = 6; }
        return 'fail:Lagna bigadla!';
      }
      // Move: one loop over the members.
      const walking = (v.t % 10) < 4, fx = Math.sin(v.heading), fz = Math.cos(v.heading);
      const beat = Math.floor(v.t / BEAT);
      for (let i = 0; i < ms.length; i++) {
        const p = ms[i];
        if (!alive(g, p) || p.state !== 'scripted') continue;
        const h = p.h;
        if (walking) { h.x += fx * 0.8 * dt; h.z += fz * 0.8 * dt; h.pose = 'walk'; h.speed = 0.8; h.yaw = v.heading; h.armsUp = 0; }
        else { h.pose = 'idle'; h.speed = 0; h.armsUp = (beat + i) % 2 ? 1 : 0.3; h.yaw = v.heading + Math.sin(v.t * 6.3 + i) * 0.6; }
      }
      if (!walking && beat !== v.beatK) { v.beatK = beat; g.audio?.sfxAt?.('dhol', lead.h.x, lead.h.z); }
      // Honks.
      const horn = Boolean(g.input?.state?.horn) && P.vehicle && dist(pos.x, pos.z, lead.h.x, lead.h.z) < 50;
      if (horn && !honkWas) {
        v.honks++;
        c.chatter([['Baraati', v.honks >= 3 ? 'Ata kahi nahi milnar, bhau!' : 'Arre, lagna aahe! Thamba jara!']]);
      }
      honkWas = horn;
      // Waiting behind it, stopped, within 30 m.
      if (P.vehicle && v.honks < 3 && speedOf(P.vehicle) < 1 && dist(pos.x, pos.z, lead.h.x, lead.h.z) < 30
        && (pos.x - lead.h.x) * fx + (pos.z - lead.h.z) * fz < 0) {
        v.waitT += dt;
        if (v.waitT >= 20) { v.reward = { cash: 100, heal: 40, line: 'Mithai box for waiting! +40 health' }; return 'done'; }
      }
      // A dance session runs 16 beats from the first tap.
      if (v.danceT0 != null) {
        const tt = g.time - v.danceT0;
        if (tt > BEATS * BEAT + 0.2) {
          const good = beatScore(v.taps, v.danceT0);
          v.reward = { cash: good * 10, izzat: good >= 14 ? 1 : 0, line: good >= 14 ? 'Naach King!' : `${good}/16 steps on the beat` };
          return 'done';
        }
      }
      return v.t > 90 ? 'fail:The baraat moved on.' : null;
    },
    exit(c) {
      for (const p of c.m.vars.members || []) if (p?.h) p.h.armsUp = 0;
      if (c.g.player?.human) c.g.player.human.armsUp = 0;
    },
  };
}

// ------------------------------------------------------------------ the events
/**
 * Each kind: hours, weight, dry (not in rain), needs(g), place(g, r) -> spot | null,
 * setup(c, at, r) (spawns the offer's cast through the draft's ctx), engaged(g, m) -> bool,
 * bark ([who, line]), steps(at, r) -> steps, reward(m, r) -> { cash, izzat, heal, line }.
 */
export const EVENTS = {
  snatch: {
    hours: [9, 21], weight: 3,
    title: 'Chain-snatcher',
    needs: g => Boolean(g.player?.vehicle),
    place: (g, r) => kerbSpot(g, r),
    bark: ['Tai', 'चोर! चोर! माझं मंगळसूत्र!'],
    setup(c, at) {
      const rp = c.roadPoint(at.x, at.z);
      const bike = c.spawnVehicle('bike', 'bike', rp.x, rp.z, rp.heading ?? at.heading, { driver: true, label: "the snatcher's bike" });
      bike.kinematic = true;
      const tai = c.spawnPed('tai', 'woman', at.x + Math.cos(at.heading) * 1.4, at.z - Math.sin(at.heading) * 1.4, { pose: 'idle' });
      c.vars.taiAt = { x: tai.h.x, z: tai.h.z };
    },
    engaged(g, m) {
      const b = m.ent.bike, P = g.player.pos;
      return Boolean(b && g.player.vehicle && dist(P.x, P.z, b.x, b.z) < 60 && seen(g, b.x, b.z));
    },
    steps(at, r) {
      const flee = c => {
        const far = placesNear(c.g, ['landmark', 'transport', 'shopping', 'restaurant', 'hotel', 'junction'], at.x, at.z, 600, 1300);
        const p = far.length ? far[Math.floor(r() * far.length) % far.length] : null;
        return p ? { x: p.ax ?? p.x, z: p.az ?? p.z } : { x: at.x + 700 * Math.sin(at.heading), z: at.z + 700 * Math.cos(at.heading) };
      };
      return [
        S.chat([['Tai', 'चोर! चोर! माझं मंगळसूत्र!']]),
        S.call(c => { const t = c.ent.tai; if (t) { t.state = 'hail'; t.h.pose = 'wave'; t.role = 'hail'; } }),
        S.chase('bike', flee, 'Catch the <b>chain-snatcher</b>!', { rams: 2, stopAt: 600, lose: 200, loseAfter: 10, speed: 0.75, driverAs: 'snatcher' }),
        S.call(c => {
          const p = c.ent.snatcher;
          if (!p || p.state === 'dead') { c.m.vars.shot = Boolean(p); return; }
          p.eventTarget = true;
        }),
        unlessDead(S.fight(['snatcher'], 'Get the chain back from him.', { snatcher: 1 }), 'snatcher'),
        S.goTo(c => c.vars.taiAt || at, 'Give the chain back to <b>Tai</b>.', { radius: 3 }),
      ];
    },
    reward(m, r) {
      const cash = Math.round(300 + r() * 300);
      if (m.vars.shot) return { cash: Math.round(cash / 2), izzat: 0, line: 'Bhau, chain pahije hoti, encounter nahi!' };
      return { cash, izzat: 2, line: 'Dev bhala karo, bala! Chain returned.' };
    },
  },

  injured: {
    hours: [6, 23], weight: 3,
    title: 'Accident',
    needs: () => true,
    place: (g, r) => kerbSpot(g, r),
    bark: ['Helper', 'Bhau, accident jhala! Hospital la nya na!'],
    setup(c, at) {
      c.spawnPed('hurt', 'man', at.x, at.z, { pose: 'cower', heading: at.heading });
      c.spawnPed('helper', 'man', at.x + Math.sin(at.heading) * 1.5, at.z + Math.cos(at.heading) * 1.5, { state: 'hail', pose: 'wave' });
      const rp = c.roadPoint(at.x + Math.sin(at.heading) * 4, at.z + Math.cos(at.heading) * 4);
      c.spawnVehicle('scooty', 'scooter', rp.x, rp.z, (rp.heading ?? 0) + 0.6, { driver: false, dynamic: false, label: 'the scooter' });
    },
    engaged(g, m) { const p = m.ent.hurt, P = g.player.pos; return Boolean(p && dist(P.x, P.z, p.h.x, p.h.z) < 35); },
    steps() {
      return [
        S.chat([['Helper', 'Bhau, accident jhala! Hospital la nya na!']]),
        board('hurt', 'Stop beside the <b>injured man</b> to pick him up.'),
        ride(c => hospitalFor(c.g, c.m.vars.rideV.x, c.m.vars.rideV.z), {
          label: 'HOSPITAL', timeFor: d => 25 + d / 8, fail: 'He needed the hospital sooner.',
          text: t => `Drive gently to <b>${t.name}</b>.`, groan: ['Passenger', 'आई गं! हळू!'],
        }),
      ];
    },
    reward(m) { const r = rideReward(m.vars); return { cash: r.cash, izzat: r.izzat, line: r.gentle ? 'Smooth ride. The doctors are impressed.' : 'Made it to the hospital.' }; },
  },

  exam: {
    hours: [7, 15], weight: 2,
    title: 'Late for the paper',
    needs: g => Boolean(classFor(g, g.player.pos.x, g.player.pos.z, () => 0)),
    place: (g, r) => kerbSpot(g, r),
    bark: ['Student', 'Dada! Paper aahe, lift dya na!'],
    setup(c, at) { c.spawnPed('student', 'student', at.x, at.z, { state: 'hail', pose: 'wave' }); },
    engaged(g, m) { const p = m.ent.student, P = g.player.pos; return Boolean(p && dist(P.x, P.z, p.h.x, p.h.z) < 35); },
    steps(at, r) {
      return [
        S.chat([['Student', 'Dada! Paper aahe, lift dya na!']]),
        board('student', 'Pick up the <b>student</b> waving at the kerb.'),
        ride(c => classFor(c.g, c.m.vars.rideV.x, c.m.vars.rideV.z, r) || { x: HOSPITAL.x, z: HOSPITAL.z, name: 'the college' }, {
          label: 'PAPER', timeFor: d => 15 + d / 10, fail: 'The exam hall doors closed.',
          text: t => `Get the student to <b>${t.name}</b> before the paper.`,
          chatter: [[0.7, [['Student', 'Physics cha paper aahe!']]], [0.35, [['Student', 'Signal todu naka, pan lavkar!']]]],
        }),
      ];
    },
    reward(m) { const r = examReward(m.vars); return { cash: r.cash, izzat: r.izzat, line: 'ALL THE BEST!' }; },
  },

  baraat: {
    hours: [16, 23], weight: 2, dry: true,
    title: 'Baraat',
    needs: () => true,
    place: (g, r) => kerbSpot(g, r, { inLane: true, road: (net, road) => !net.oneway?.[road] && (net.length?.[road] ?? 999) >= 120 }),
    bark: ['Baraati', 'Dhol baja re! Navrdev aale!'],
    setup(c, at, r, g) {
      const n = lowTier(g) ? 5 : 8, members = [];
      const fx = Math.sin(at.heading), fz = Math.cos(at.heading), sx = fz, sz = -fx;
      for (let i = 0; i < n; i++) {
        const row = Math.floor(i / 2), col = i % 2 ? 0.8 : -0.8;
        const kind = i === 0 ? 'man' : i % 3 === 0 ? 'woman' : 'man';
        const p = c.spawnPed(`b${i}`, kind, at.x - fx * row * 1.6 + sx * col, at.z - fz * row * 1.6 + sz * col, { heading: at.heading, pose: 'idle' });
        p.mission = false; p.baraat = true; // running them over stays a crime
        if (i === 2) Object.assign(p.h.outfit, { top: 0xf1e3c4, turban: 0xf28c28 }), p.h.outfit.flags?.add?.('pheta'), p.groom = true;
        members.push(p);
      }
      c.vars.members = members; c.vars.heading = at.heading;
    },
    engaged(g, m) { const p = m.vars.members?.[0], P = g.player.pos; return Boolean(p && dist(P.x, P.z, p.h.x, p.h.z) < 60); },
    steps() { return [S.chat([['Baraati', 'Dhol baja re! Navrdev aale!']]), procession()]; },
    reward(m) { return { cash: 0, izzat: 0, ...(m.vars.reward || {}) }; },
  },

  // Stretch goal: needs E.catchOnFoot; shipped with weight 0 per plan §2.
  pickpocket: { hours: [8, 20], weight: 0, title: 'Pickpocket', needs: () => false, place: () => null, setup() {}, engaged: () => false, steps: () => [], reward: () => ({ cash: 0 }) },
};

const KINDS = Object.keys(EVENTS);
const rand = (r, [a, b]) => a + r() * (b - a);

// ------------------------------------------------------------------ the director
export class StreetEvents {
  constructor(game, { random = Math.random } = {}) {
    this.game = game;
    this.r = random;
    this.t = rand(this.r, FIRST_WAIT); // seconds until the next attempt
    this.offer = null; // { m, kind, t0, at }
    this.recent = [];
    this._blip = { x: 0, z: 0, kind: 'icon', label: '!', color: BLUE, clamp: true };
    this._blips = [this._blip];
    this._none = [];
    this._dance = { label: 'DANCE', run: () => this._tap() };
    this._beatOn = false;
  }

  get api() { const M = this.game.missions; return M && typeof M.draft === 'function' && typeof M.adopt === 'function' ? M : null; }
  /** The event running now (its kind), or null. */
  get running() { return this.game.missions?.active?.def?.event || null; }

  update(dt) {
    const g = this.game;
    if (this.offer) { this._watchOffer(dt); return; }
    if (this.running) { this._danceTick(); return; }
    this.t -= dt;
    if (this.t > 0) return;
    if (blockedWhy(g) || !this.api) { this.t = RETRY_WAIT; return; }
    if (!this._try()) this.t = RETRY_WAIT;
  }

  /** Try to set up an offer now (kind given: dev / tests). True when one is up. */
  _try(kind = null) {
    const g = this.game, r = this.r;
    const hours = g.sky?.hours ?? 12, weather = g.sky?.weather;
    kind ||= pick(KINDS.filter(k => EVENTS[k].needs(g)), hours, weather, r(), this.recent);
    if (!kind) return false;
    const E = EVENTS[kind];
    let at = null;
    for (let i = 0; i < MAX_TRIES && !at; i++) at = E.place(g, r);
    if (!at) return false;
    const def = { id: `event-${kind}`, event: kind, title: E.title, subtitle: '', steps: () => E.steps(at, r) };
    const m = this.api.draft(def);
    if (!m) return false;
    try { E.setup(m.ctx, at, r, g); } catch (err) { console.error('Street event setup', err); this.api.discard?.(m); return false; }
    this.offer = { m, kind, t0: g.time ?? 0, age: 0, at };
    this.recent.push(kind); if (this.recent.length > 2) this.recent.shift();
    const [who, line] = E.bark;
    g.hud?.subtitle?.(who, line, 4, BLUE);
    if (!g.save?.data?.seenEventHelp) {
      g.hud?.help?.('<b>Street events.</b> Something is happening nearby: the blue <b>!</b> on the radar. Help out for cash and Izzat, or just carry on.', 7);
      g.save?.set?.('seenEventHelp', true);
    }
    return true;
  }

  _watchOffer(dt) {
    const g = this.game, o = this.offer, P = g.player.pos;
    o.age += dt;
    if (busy(g) || (g.police?.level || 0) > 0 || o.age > OFFER_LOSE_TIME || dist(P.x, P.z, o.at.x, o.at.z) > OFFER_LOSE_DIST) { this.discardOffer(); return; }
    if (EVENTS[o.kind].engaged(g, o.m)) {
      const m = o.m;
      this.offer = null;
      this.t = rand(this.r, GAP);
      if (this.api.adopt(m) === false) this.api.discard?.(m);
    }
  }

  /** Drop the offer and its cast quietly (a mission or job is starting, a retry, out of range). */
  discardOffer() {
    const o = this.offer;
    if (!o) return;
    this.offer = null;
    this.api?.discard?.(o.m);
    this.t = rand(this.r, GAP); // ignored or overtaken: the next one comes 3-6 minutes on
  }

  blips() {
    if (!this.offer) return this._none;
    this._blip.x = this.offer.at.x; this._blip.z = this.offer.at.z;
    return this._blips;
  }

  /** DANCE beside the baraat, on foot within 4 m of a member. */
  contextAction() {
    const g = this.game, m = g.missions?.active;
    if (m?.def?.event !== 'baraat' || g.player.vehicle) return null;
    const P = g.player.pos;
    if (!(m.vars.members || []).some(p => alive(g, p) && dist(P.x, P.z, p.h.x, p.h.z) < 4)) return null;
    return this._dance;
  }

  _tap() {
    const g = this.game, v = g.missions?.active?.vars;
    if (!v) return;
    const now = g.time ?? 0;
    if (v.danceT0 == null) { v.danceT0 = now; v.taps = []; }
    v.taps.push(now);
    const h = g.player?.human;
    if (h) { h.armsUp = 1; h.yaw += (v.taps.length % 2 ? 0.35 : -0.35); }
  }

  /** The button pulses on the dhol beat while dancing (class `beat` on #tb-action). */
  _danceTick() {
    const g = this.game, v = g.missions?.active?.vars;
    const on = Boolean(v && v.danceT0 != null && (((g.time - v.danceT0) % BEAT) + BEAT) % BEAT < BEAT_WINDOW);
    if (on === this._beatOn) return;
    this._beatOn = on;
    if (typeof document !== 'undefined') document.getElementById('tb-action')?.classList.toggle('beat', on);
    if (on && g.player?.human) g.player.human.armsUp = g.player.human.armsUp > 0.5 ? 0.4 : 1;
  }

  /** A knock to the car: 'bump' (k ignored) or 'crash' (k = speed, > 5). */
  jolt(k, kind = 'bump') {
    const v = this.game.missions?.active?.def?.event ? this.game.missions.active.vars : null;
    if (!v || v.comfort == null || !v.rider) return;
    v.comfort = Math.max(0, v.comfort - (kind === 'crash' ? 15 : 8));
    void k;
  }

  /** Called by missions.pass for an event. */
  passed(def, m) {
    const g = this.game, kind = def.event, E = EVENTS[kind];
    if (!E) return;
    const rw = E.reward(m, this.r) || {};
    if (rw.cash) g.addCash?.(rw.cash);
    if (rw.heal) g.player?.heal?.(rw.heal);
    const ev = this._save();
    if (ev) { ev.done[kind] = (ev.done[kind] || 0) + 1; ev.izzat = (ev.izzat || 0) + (rw.izzat || 0); }
    g.save?.stat?.('events');
    g.save?.dirty?.();
    const bits = [rw.line, rw.cash ? `+₹${rw.cash.toLocaleString('en-IN')}` : '', rw.izzat ? `Izzat +${rw.izzat}` : ''].filter(Boolean);
    g.hud?.toast?.(bits.join(' · '), 4);
    g.audio?.sfx?.('passed');
    this._clearBeat();
  }

  /** Called by missions.fail for an event (a toast only). */
  failed(def, why) {
    this.game.hud?.toast?.(why || 'Never mind.', 3);
    this._clearBeat();
  }

  _clearBeat() {
    this._beatOn = false;
    if (typeof document !== 'undefined') document.getElementById('tb-action')?.classList.remove('beat');
  }

  _save() {
    const d = this.game.save?.data;
    if (!d) return null;
    d.events ||= { done: {}, izzat: 0 };
    d.events.done ||= {};
    return d.events;
  }

  /** DEV: set up an offer of `kind` now, ignoring the timer and the hours (still needs a place). */
  force(kind) {
    if (!EVENTS[kind] || !this.api || this.running) return false;
    this.discardOffer();
    return this._try(kind);
  }
}
