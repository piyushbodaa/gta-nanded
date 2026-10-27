// Mission runtime: start markers around the city, a step machine for each
// mission, dialogue, objectives, GPS, timers, and pass/fail bookkeeping.
import * as THREE from 'three';
import { dist, clamp, headingTo, rng } from '../core/math.js';
import { track } from '../core/analytics.js';
import { makeOutfit } from '../actors/humans.js';
import { speedOf } from '../actors/vehicle-physics.js';
import { DynamicDriver } from '../actors/traffic.js';
import { CHARACTERS } from './story.js';

export class Missions {
  constructor(game, defs) {
    this.game = game;
    this.defs = defs;
    this.active = null;
    this.dialog = [];
    this.dialogT = 0;
    this.routeT = 0;
    this.cooldown = 0;
    this._leftovers = []; // the last mission's cast and props, cleared when the next one starts
    this._driven = new WeakSet(); // mission vehicles the player has driven: theirs to keep
  }

  get byId() { return this._byId || (this._byId = new Map(this.defs.map(d => [d.id, d]))); }

  available() {
    const s = this.game.save;
    return this.defs.filter(d => !s.done(d.id) && (d.requires || []).every(r => s.done(r)));
  }

  /** Where a mission begins: { x, z } (start markers and map blips). */
  startPoint(def) { return typeof def.start === 'function' ? def.start(this.game) : def.start; }

  blips() {
    const out = [];
    if (this.active) {
      const t = this.active.target;
      if (t) out.push({ x: t.x, z: t.z, color: t.color || '#f4c430' });
      for (const e of Object.values(this.active.ent)) if (e && e.blip) out.push({ x: e.x ?? e.h?.x, z: e.z ?? e.h?.z, color: e.blip, kind: 'dot', size: 4.5 });
      return out;
    }
    for (const d of this.available()) {
      const p = this.startPoint(d);
      const ch = CHARACTERS[d.giver];
      out.push({ x: p.x, z: p.z, kind: 'icon', label: ch?.initial || '!', color: ch?.color || '#f4c430', clamp: true });
    }
    return out;
  }

  update(dt) {
    const g = this.game;
    this._dialog(dt);
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (g.player.vehicle) this._driven.add(g.player.vehicle);
    if (!this.active) {
      // Walk or drive (slowly) into a start marker. Not while lying WASTED or BUSTED, nor with the
      // police after you or a witness still calling a crime in (it would land mid-cutscene).
      const markers = [];
      const ready = this.cooldown <= 0 && !g.respawning && !g.jobs?.active && (g.police?.level || 0) === 0 && !g.police?.pending?.length;
      for (const d of this.available()) {
        const p = this.startPoint(d);
        markers.push({ x: p.x, z: p.z, r: 2.2, h: 3, color: CHARACTERS[d.giver]?.markerColor ?? 0xffc83d });
        const pos = g.player.pos;
        if (ready && dist(pos.x, pos.z, p.x, p.z) < 2.6 && (!g.player.vehicle || speedOf(g.player.vehicle) < 3)) this.start(d.id);
      }
      g.effects?.markers.set([...markers, ...(g.jobs?.markers?.() || [])]);
      return;
    }
    const m = this.active;
    m.time += dt;
    if (m.timer !== null) {
      m.timer -= dt;
      g.hud.setTimer(m.timer, m.timerLabel);
      if (m.timer <= 0) { this.fail(m.timerFail || 'Time ran out.'); return; }
    }
    // Vital entities.
    for (const [name, e] of Object.entries(m.ent)) {
      if (e && e.vital && e.wrecked) { this.fail(e.vitalMsg || `${e.label || 'The vehicle'} was wrecked.`); return; }
    }
    const step = m.steps[m.i];
    if (!step) { this.pass(); return; }
    let r;
    try { r = step.update ? step.update(m.ctx, dt) : 'done'; } catch (err) { this._crash(err); return; }
    if (r === 'done') this._next();
    else if (typeof r === 'string' && r.startsWith('fail:')) this.fail(r.slice(5));
    // Failed or passed just now: no markers or GPS line to the old target.
    if (this.active !== m) return;
    // Markers and GPS for the current target.
    const markers = [];
    if (m.target && m.target.marker !== false) markers.push({ x: m.target.x, z: m.target.z, r: m.target.r ?? 3, h: m.target.h ?? 4, color: m.target.markerColor ?? 0xffc83d });
    for (const e of Object.values(m.ent)) if (e && e.arrow) markers.push({ kind: 'arrow', x: e.x ?? e.h.x, z: e.z ?? e.h.z, y: (e.spec?.H ?? 1.8) + 1.4, color: 0x64b5f6 });
    g.effects?.markers.set(markers);
    this.routeT -= dt;
    if (this.routeT <= 0) {
      this.routeT = 1.2;
      const t = m.target, pos = g.player.pos;
      g.hud.route = t && t.gps !== false && dist(pos.x, pos.z, t.x, t.z) > 25 ? g.net.route(pos.x, pos.z, t.x, t.z) : null;
      if (g.hud.route) g.hud.route.color = '#f4c430';
    }
  }

  start(id) {
    const g = this.game, def = this.byId.get(id);
    if (!def || this.active) return;
    this._clearLeftovers();
    g.jobs?.stop?.(true);
    const m = {
      def, i: -1, time: 0, timer: null, timerLabel: '', vars: {}, ent: {}, target: null, steps: def.steps(g),
    };
    m.ctx = this._ctx(m);
    this.active = m;
    g.hud.big(def.title, def.subtitle || '', 'title', 3.2);
    g.audio?.sfx('mission');
    def.onStart?.(m.ctx);
    this._next();
  }

  _next() {
    const m = this.active;
    if (!m) return;
    m.steps[m.i]?.exit?.(m.ctx);
    m.i++;
    m.target = null;
    const step = m.steps[m.i];
    if (!step) { this.pass(); return; }
    try { step.enter?.(m.ctx); } catch (err) { this._crash(err); }
  }

  /** A scripting error should never strand the player in a half-started mission. */
  _crash(err) {
    console.error('Mission script error', err);
    this.fail('Something went wrong with this mission. Try it again.');
  }

  pass() {
    const g = this.game, m = this.active;
    if (!m) return;
    const def = m.def;
    this._cleanup(m, true);
    this.active = null;
    g.save.complete(def.id);
    track('mission_complete');
    if (def.reward) g.addCash(def.reward);
    g.hud.big('MISSION PASSED', def.reward ? `₹${def.reward.toLocaleString('en-IN')}` : def.passText || 'RESPECT +', 'passed', 5);
    g.audio?.sfx('passed');
    g.hud.objective('');
    g.hud.setTimer(null);
    g.hud.route = null;
    def.onPass?.(g);
    this.cooldown = 4;
    g.save.flush();
  }

  fail(reason) {
    const g = this.game, m = this.active;
    if (!m) return;
    this._cleanup(m, false);
    this.active = null;
    g.hud.big('MISSION FAILED', reason || '', 'failed', 5);
    g.audio?.sfx('failed');
    g.hud.objective('');
    g.hud.setTimer(null);
    g.hud.route = null;
    g.cutscene = false;
    this.cooldown = 6;
  }

  _cleanup(m, passed) {
    const g = this.game;
    m.steps[m.i]?.exit?.(m.ctx);
    this.dialog.length = 0;
    g.hud.clearSubtitle();
    this._leftovers = [];
    for (const e of Object.values(m.ent)) {
      if (!e) continue;
      if (e.h) {
        e.keep = false; e.mission = false;
        // The scene is over: nobody stands frozen in it (a posed actor would until you were
        // 150 m off), nobody fights on, and the beaten get up from cowering before long.
        if (e.state === 'fight') { e.state = 'flee'; e.t = 5; }
        else if (e.state === 'scripted') { e.state = 'walk'; g.peds._resnap?.(e); }
        else if (e.state === 'cower' && e.t > 30) e.t = 4;
        if (e.after === 'fight') e.after = 'flee';
        e.role = null; // and never back to the spot they had in it
        this._leftovers.push(e);
      } else if (e.id) {
        e.vital = false; e.arrow = false; e.blip = null; e.keep = false;
        if (e.role === 'mission' || e.role === 'rival') { e.role = 'abandoned'; g.controls.delete(e); }
        this._leftovers.push(e);
      }
    }
    if (m.def.policeLock) { g.police.lock = false; }
    g.camera.cinematic = null;
    g.cutscene = false;
    void passed;
  }

  /**
   * The last mission's cast and cars go when the next one starts: a retry where it failed would
   * otherwise stand a second Shera on the first and drop the new cars onto the old ones. Not a
   * car the player is in, walking to or has driven (theirs now), nor anything claimed since.
   */
  _clearLeftovers() {
    const g = this.game, P = g.player;
    for (const e of this._leftovers) {
      if (e.h) { if (!e.keep) g.peds.remove(e); }
      else if (!e.keep && e !== P.vehicle && e !== P.enterTarget && e.role !== 'player' && !this._driven.has(e)) { g.vehicles.remove(e); g.controls.delete(e); }
    }
    this._leftovers = [];
  }

  // ---------------------------------------------------------------- dialogue
  /** Queue lines. Chatter (non-blocking banter) replaces older chatter still waiting. */
  say(lines, chatter = false) {
    if (chatter) this.dialog = this.dialog.filter(l => !l.chatter);
    for (const l of lines) { const line = [...l]; line.chatter = chatter; this.dialog.push(line); }
    if (this.dialogT <= 0) this.dialogT = 0.01;
  }
  get talking() { return this.dialog.length > 0 || this.dialogT > 0; }
  _dialog(dt) {
    if (this.dialogT <= 0) return;
    this.dialogT -= dt;
    if (this.dialogT > 0) return;
    const line = this.dialog.shift();
    if (!line) { this.game.hud.clearSubtitle(); return; }
    const [who, text] = line;
    const ch = CHARACTERS[who];
    const secs = clamp(1.8 + text.length * 0.052, 2.2, 7);
    this.game.hud.subtitle(ch ? ch.name : who, text, secs + 0.1, ch?.color);
    this.dialogT = secs;
  }

  // ---------------------------------------------------------------- step context
  _ctx(m) {
    const g = this.game, self = this;
    return {
      g, m, vars: m.vars, ent: m.ent,
      say: lines => self.say(lines),
      chatter: lines => self.say(lines, true),
      get talking() { return self.talking; },
      objective: text => g.hud.objective(text),
      setTarget: t => { m.target = t; self.routeT = 0; },
      timer: (seconds, label = '', fail) => { m.timer = seconds; m.timerLabel = label; m.timerFail = fail; },
      stopTimer: () => { m.timer = null; g.hud.setTimer(null); },
      place: id => g.city.places.find(p => p.id === id),
      spawnVehicle(name, type, x, z, heading, opts = {}) {
        const v = g.vehicles.spawn(type, x, z, heading, { role: 'mission', driver: opts.driver ?? false, color: opts.color, seed: opts.seed });
        v.kinematic = !opts.dynamic && false; v.keep = true; v.label = opts.label;
        v.pilot = v.driver; // who the script put at the wheel (a carjack swaps v.driver)
        if (opts.dynamic === false) v.kinematic = true;
        Object.assign(v, opts.props || {});
        m.ent[name] = v;
        return v;
      },
      spawnPed(name, kind, x, z, opts = {}) {
        const P = g.player.pos;
        if (g.colliders?.blocked(x, z, 0.3)) ({ x, z } = clearOf(g.colliders, x, z, P));
        const h = g.humans.add(makeOutfit(kind, opts.seed ?? (Math.random() * 1e9) | 0), x, z);
        if (opts.outfit) Object.assign(h.outfit, opts.outfit);
        h.yaw = opts.heading ?? headingTo(x, z, P.x, P.z); // facing whoever they're talking to
        const p = g.peds._make(h, x, z, null);
        p.state = opts.state || 'scripted'; p.keep = true; p.mission = true; p.t = 999;
        h.pose = opts.pose || 'idle';
        m.ent[name] = p;
        return p;
      },
      /** A kerbside spot near (x, z), facing the way traffic flows there (side +1: left of the road's a->b). */
      roadPoint(x, z, side = 1, out = {}) {
        const net = g.net, n = net.nearest(x, z, 80, {}, r => !net.raised[r]);
        if (!n) return { x, z, heading: 0 };
        side = net.kerbSide(n.road) || side;
        const off = net.width[n.road] / 2 - 1.2, flow = net.oneway[n.road] || side;
        out.x = n.x + n.dz * off * side; out.z = n.z - n.dx * off * side; out.heading = Math.atan2(n.dx, n.dz) + (flow > 0 ? 0 : Math.PI);
        return out;
      },
      driver: (v, opts) => new DynamicDriver(g, v, opts),
    };
  }
}

/**
 * Scripted people never step out of a wall by themselves, so one asked to stand inside a wall
 * moves toward the player (who stands somewhere clear) until free, appearing on the player's side.
 * If the wall reaches right up to the player, they stand beside the player instead.
 */
function clearOf(colliders, x, z, P) {
  for (let k = 0; k < 40; k++) {
    const d = dist(x, z, P.x, P.z);
    if (d < 1) break;
    x += (P.x - x) / d * 0.4; z += (P.z - z) / d * 0.4;
    if (!colliders.blocked(x, z, 0.3)) return { x, z };
  }
  const a0 = Math.atan2(x - P.x, z - P.z);
  for (const r of [1.3, 2.2]) {
    for (let k = 0; k < 12; k++) {
      const a = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.52, cx = P.x + Math.sin(a) * r, cz = P.z + Math.cos(a) * r;
      if (!colliders.blocked(cx, cz, 0.3)) return { x: cx, z: cz };
    }
  }
  return { x, z };
}

// ------------------------------------------------------------------ step library
export const Steps = {
  /** Dialogue; with block, the player waits (cutscene) until it ends. */
  say(lines, { block = false, shot = null } = {}) {
    return {
      kind: 'say', lines,
      enter(c) {
        c.say(lines);
        if (block) c.g.cutscene = true;
        if (shot) c.g.camera.playShot(shot(c));
      },
      update(c) { return c.talking ? null : 'done'; },
      exit(c) { if (block) c.g.cutscene = false; if (shot) c.g.camera.endShot(c.g.player.vehicle?.heading ?? c.g.player.heading); },
    };
  },
  /** Chatter that plays while the next steps continue. */
  chat(lines) { return { kind: 'chat', lines, enter(c) { c.say(lines); }, update() { return 'done'; } }; },
  call(fn) { return { kind: 'call', enter: fn, update() { return 'done'; } }; },
  wait(seconds) { let t = 0; return { kind: 'wait', enter() { t = 0; }, update(c, dt) { t += dt; return t >= seconds ? 'done' : null; } }; },

  /** Get into a named vehicle. */
  enter(name, text) {
    return {
      kind: 'enter', vehicle: name,
      enter(c) { const v = c.ent[name]; if (v) { v.arrow = true; v.vital = true; } c.objective(text); },
      update(c) {
        const v = c.ent[name];
        if (!v) return 'fail:The vehicle is gone.';
        c.m.target = { x: v.x, z: v.z, marker: false };
        return c.g.player.vehicle === v ? 'done' : null;
      },
      exit(c) { const v = c.ent[name]; if (v) v.arrow = false; },
    };
  },

  /**
   * Go to a point. opts: { radius, vehicle (entity name that must be driven), onFoot, stop (must slow down),
   * timer, timerFail, chatter: [[metresLeftFraction, lines]], maxDamage }
   */
  goTo(target, text, opts = {}) {
    let start = 0;
    const said = new Set();
    return {
      kind: 'goTo', target, opts,
      enter(c) {
        const t = typeof target === 'function' ? target(c) : target;
        c.m.vars._t = t;
        c.setTarget({ x: t.x, z: t.z, r: opts.radius ?? 3, h: 4 });
        c.objective(text);
        start = dist(c.g.player.pos.x, c.g.player.pos.z, t.x, t.z);
        if (opts.timer) c.timer(opts.timer, opts.timerLabel || '', opts.timerFail);
      },
      update(c) {
        const g = c.g, t = c.m.vars._t, P = g.player, pos = P.pos;
        if (opts.vehicle) {
          const v = c.ent[opts.vehicle];
          if (v && P.vehicle !== v) {
            c.objective(`Get back in the ${v.label || 'vehicle'}.`);
            c.m.target = { x: v.x, z: v.z, marker: false };
            v.arrow = true;
            return null;
          }
          if (v) { v.arrow = false; c.m.target = { x: t.x, z: t.z, r: opts.radius ?? 3, h: 4 }; c.objective(text); }
          if (v && opts.maxDamage && v.health < 1000 * (1 - opts.maxDamage)) return `fail:${opts.damageFail || 'The cargo was ruined.'}`;
        }
        if (opts.onFoot && P.vehicle) { c.objective(text + ' <i>(on foot)</i>'); }
        const d = dist(pos.x, pos.z, t.x, t.z);
        // Chatter by progress.
        for (const [frac, lines] of opts.chatter || []) {
          if (!said.has(frac) && d < start * frac) { said.add(frac); c.chatter(lines); }
        }
        if (d > (opts.radius ?? 3) + (P.vehicle ? 1.5 : 0)) return null;
        if (opts.onFoot && P.vehicle) return null;
        if (P.vehicle && opts.stop !== false && speedOf(P.vehicle) > 4) { c.objective('Slow down to stop.'); return null; }
        return 'done';
      },
      exit(c) { if (opts.timer && !opts.keepTimer) c.stopTimer(); },
    };
  },

  /** Knock down a group of named enemies. */
  fight(names, text, hits = {}) {
    return {
      kind: 'fight', names,
      enter(c) {
        c.objective(text);
        for (const n of names) {
          const p = c.ent[n];
          if (!p) continue;
          p.grudge = 3; p.blip = '#ff4d4d'; p.hits = 0; p.needHits = hits[n] ?? 2;
          // Thrown off a bike at the end of a chase (or pulled from a car): down first, then up
          // swinging, not snapped upright mid-fall.
          if (p.state === 'down' || p.state === 'getup') p.after = 'fight';
          else { p.state = 'fight'; p.t = 60; }
        }
      },
      update(c) {
        let left = 0;
        for (const n of names) {
          const p = c.ent[n];
          if (!p) continue;
          if (p.hits >= (p.needHits || 2)) {
            // Beaten for good: no grudge left, and one still on the ground cowers once up (the
            // knockdown had queued a fight, which went on through the next scene).
            p.grudge = 0; p.blip = null;
            if (p.state === 'down' || p.state === 'getup') p.after = 'cower';
            else { p.state = 'cower'; p.t = 999; }
            continue;
          }
          left++;
          if (p.state === 'flee' || p.state === 'walk' || p.state === 'cower') { p.state = 'fight'; p.t = 60; }
          if (p.state === 'down' || p.state === 'getup') p.after = 'fight';
        }
        c.m.target = null;
        return left ? null : 'done';
      },
    };
  },

  /** Lose the police: sets the level (unless already higher) and waits until clear. */
  escape(level, text = 'Lose the police.') {
    return {
      kind: 'escape',
      enter(c) { if (c.g.police.level < level) c.g.police.setLevel(level); c.objective(text); c.m.target = null; },
      update(c) { c.m.target = null; return c.g.police.level === 0 ? 'done' : null; },
    };
  },

  /**
   * Checkpoint race against rivals (entity names already spawned as rivals).
   * points: [{x, z}] ; finish = last point.
   */
  race(points, rivals, text = 'Win the race.') {
    let idx = 0, shown = '';
    return {
      kind: 'race', points,
      enter(c) {
        idx = 0; shown = '';
        c.objective(text);
        for (const n of rivals) {
          const v = c.ent[n];
          if (!v) continue;
          v.kinematic = false; v.role = 'rival';
          const pts = [];
          let from = { x: v.x, z: v.z };
          for (const p of points) { const r = c.g.net.route(from.x, from.z, p.x, p.z); if (r) pts.push(...r.points); from = p; }
          v.raceDriver = c.driver(v, { aggression: 0.75, maxSpeed: v.spec.top * 0.92 });
          v.raceDriver.setPath(pts);
          v.raceIdx = 0;
        }
      },
      update(c, dt) {
        const g = c.g, pos = g.player.pos;
        const p = points[idx];
        c.m.target = { x: p.x, z: p.z, r: 6, h: 7, markerColor: idx === points.length - 1 ? 0xff5252 : 0xffc83d };
        // Rivals drive the route with a little rubber band.
        let ahead = 0;
        for (const n of rivals) {
          const v = c.ent[n];
          if (!v || v.wrecked || g.player.vehicle === v) continue;
          const rp = points[Math.min(v.raceIdx, points.length - 1)];
          if (dist(v.x, v.z, rp.x, rp.z) < 14) v.raceIdx++;
          if (v.raceIdx >= points.length) { if (!c.m.vars.lost) { c.m.vars.lost = true; } return `fail:${v.label || 'A rival'} won the race.`; }
          const mine = idx * 1e5 - dist(pos.x, pos.z, p.x, p.z), theirs = v.raceIdx * 1e5 - dist(v.x, v.z, rp.x, rp.z);
          if (theirs > mine) ahead++;
          const band = clamp(1 + (mine - theirs) / 900, 0.82, 1.18);
          v.raceDriver.maxSpeed = v.spec.top * 0.92 * band;
          g.controls.set(v, v.raceDriver.control(dt));
        }
        // Your place and the checkpoints left, as the street races show them.
        const place = `${ahead + 1}/${rivals.length + 1}`;
        if (`${place} ${idx}` !== shown) { shown = `${place} ${idx}`; c.objective(`${text} Position <b>${place}</b> · checkpoint ${idx + 1}/${points.length}`); }
        if (dist(pos.x, pos.z, p.x, p.z) < 8 && g.player.vehicle) {
          idx++;
          g.audio?.sfx('checkpoint');
          if (idx >= points.length) return 'done';
        }
        return null;
      },
      exit(c) { for (const n of rivals) { const v = c.ent[n]; if (v) c.g.controls.delete(v); } },
    };
  },

  /**
   * Run down a vehicle fleeing toward `to`: keep within `lose` metres (or it gets away) and ram it
   * `rams` times (or batter it under `stopAt` health any other way). Its driver then bails out, as
   * entity `driverAs` (for a fight on foot) when given.
   */
  chase(name, to, text, { lose = 170, loseAfter = 6, rams = 3, stopAt = 450, driverAs = null, speed = 0.85 } = {}) {
    let far = 0, hits = 0, seen = 0, last = -9, pilot = null;
    /** Caught: the chase AI lets go, the car you chased in is no longer needed, the driver `p` is on foot. */
    const caught = (c, v, p) => {
      if (c.g.player.vehicle !== v) c.g.controls.delete(v);
      v.flee = null; v.arrow = false; v.blip = null;
      for (const e of Object.values(c.ent)) if (e?.id && e !== v) e.vital = false;
      if (p) { p.keep = true; p.mission = true; if (driverAs) c.ent[driverAs] = p; }
      return 'done';
    };
    return {
      kind: 'chase', vehicle: name,
      enter(c) {
        const v = c.ent[name];
        if (!v) return;
        pilot = v.pilot ?? v.driver;
        const dest = typeof to === 'function' ? to(c) : to, r = c.g.net.route(v.x, v.z, dest.x, dest.z);
        v.kinematic = false; v.role = 'mission'; v.vital = false; v.blip = '#ff4d4d'; v.arrow = true;
        v.flee = c.driver(v, { aggression: 0.8, maxSpeed: v.spec.top * speed });
        if (r) v.flee.setPath(r.points);
        c.objective(text);
        far = 0; hits = 0; seen = v.lastHit || 0; last = -9;
      },
      update(c, dt) {
        const g = c.g, v = c.ent[name], pos = g.player.pos, mine = g.player.vehicle;
        if (!v) return 'fail:They got away.';
        // Pulled out of the seat (the player carjacked it, now or before the chase): caught, and the
        // driver is already on foot. Never drive the player's car or eject the player's own body.
        if (mine === v || (pilot && v.driver !== pilot)) return caught(c, v, g.peds.list.find(p => p.h === pilot));
        c.m.target = { x: v.x, z: v.z, marker: false };
        // A fresh knock while we're alongside counts as a ram (grinding along it counts once).
        if ((v.lastHit || 0) !== seen) {
          seen = v.lastHit;
          if (mine && dist(mine.x, mine.z, v.x, v.z) < v.hd + mine.hd + 2.5 && c.m.time - last > 0.7) { hits++; last = c.m.time; }
        }
        if (hits >= rams || v.health < stopAt || v.wrecked) {
          v.role = 'abandoned';
          const h = g.vehicles.ejectDriver(v);
          let p = null;
          if (h) {
            const door = g.vehicles.doorWorld(v);
            h.x = door.x; h.z = door.z; h.pose = 'lie';
            p = g.peds._make(h, h.x, h.z, null);
            p.state = 'down'; p.t = 1.2; p.after = 'flee';
          }
          return caught(c, v, p);
        }
        far = dist(pos.x, pos.z, v.x, v.z) > lose ? far + dt : 0;
        if (far > loseAfter || !v.flee || v.flee.done) return `fail:${v.label || 'They'} got away.`;
        g.controls.set(v, v.flee.control(dt));
        return null;
      },
      exit(c) { const v = c.ent[name]; if (v) { if (c.g.player.vehicle !== v) c.g.controls.delete(v); v.arrow = false; } },
    };
  },

  /** Get out of whatever you're driving. */
  leave(text) {
    return {
      kind: 'leave',
      enter(c) { c.objective(text); },
      update(c) { return c.g.player.vehicle ? null : 'done'; },
    };
  },

  /** A hostile vehicle that tries to ram the player while the given steps run. */
  hunters(names) {
    return {
      kind: 'hunters',
      enter(c) { for (const n of names) { const v = c.ent[n]; if (v) { v.kinematic = false; v.role = 'mission'; v.hunt = c.driver(v, { aggression: 0.9, maxSpeed: v.spec.top }); v.blip = '#ff4d4d'; } } },
      update() { return 'done'; },
    };
  },
};

/** Drive hunter vehicles each frame (called from the game loop while a mission is active). */
export function driveHunters(game, dt) {
  const m = game.missions.active;
  if (!m) return;
  const pos = game.player.pos;
  for (const v of Object.values(m.ent)) {
    if (!v || !v.hunt || v.wrecked) continue;
    // Carjacked by the player: the hunt is over (and the AI must not steer the player's car).
    if (v === game.player.vehicle) { v.hunt = null; v.blip = null; continue; }
    const d = dist(v.x, v.z, pos.x, pos.z);
    if (d > 300) continue;
    v.hunt.ignore = game.player.vehicle;
    if (d < 45) game.controls.set(v, v.hunt.control(dt, { x: pos.x, z: pos.z }));
    else {
      if (!v.huntT || (v.huntT -= dt) <= 0) { v.huntT = 1.5; const r = game.net.route(v.x, v.z, pos.x, pos.z, { plain: true }); if (r) v.hunt.setPath(r.points); }
      game.controls.set(v, v.hunt.control(dt));
    }
  }
}
