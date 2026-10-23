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
    if (!this.active) {
      // Walk or drive (slowly) into a start marker.
      const markers = [];
      for (const d of this.available()) {
        const p = this.startPoint(d);
        markers.push({ x: p.x, z: p.z, r: 2.2, h: 3, color: CHARACTERS[d.giver]?.markerColor ?? 0xffc83d });
        const pos = g.player.pos;
        if (this.cooldown <= 0 && !g.jobs?.active && dist(pos.x, pos.z, p.x, p.z) < 2.6 && (!g.player.vehicle || speedOf(g.player.vehicle) < 3) && (g.police?.level || 0) === 0) this.start(d.id);
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
    for (const e of Object.values(m.ent)) {
      if (!e) continue;
      if (e.h) { e.keep = false; e.mission = false; if (e.state === 'fight') { e.state = 'flee'; e.t = 5; } }
      else if (e.id) {
        e.vital = false; e.arrow = false; e.blip = null; e.keep = false;
        if (e.role === 'mission' || e.role === 'rival') { e.role = 'abandoned'; g.controls.delete(e); }
      }
    }
    if (m.def.policeLock) { g.police.lock = false; }
    g.camera.cinematic = null;
    g.cutscene = false;
    void passed;
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
        if (opts.dynamic === false) v.kinematic = true;
        Object.assign(v, opts.props || {});
        m.ent[name] = v;
        return v;
      },
      spawnPed(name, kind, x, z, opts = {}) {
        const h = g.humans.add(makeOutfit(kind, opts.seed ?? (Math.random() * 1e9) | 0), x, z);
        if (opts.outfit) Object.assign(h.outfit, opts.outfit);
        h.yaw = opts.heading ?? 0;
        const p = g.peds._make(h, x, z, null);
        p.state = opts.state || 'scripted'; p.keep = true; p.mission = true; p.t = 999;
        h.pose = opts.pose || 'idle';
        m.ent[name] = p;
        return p;
      },
      roadPoint(x, z, side = 1, out = {}) {
        const n = g.net.nearest(x, z, 80, {});
        if (!n) return { x, z, heading: 0 };
        const off = g.net.width[n.road] / 2 - 1.2;
        out.x = n.x + n.dz * off * side; out.z = n.z - n.dx * off * side; out.heading = Math.atan2(n.dx, n.dz) + (side > 0 ? 0 : Math.PI);
        return out;
      },
      driver: (v, opts) => new DynamicDriver(g, v, opts),
    };
  }
}

// ------------------------------------------------------------------ step library
export const Steps = {
  /** Dialogue; with block, the player waits (cutscene) until it ends. */
  say(lines, { block = false, shot = null } = {}) {
    return {
      kind: 'say',
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
  chat(lines) { return { kind: 'chat', enter(c) { c.say(lines); }, update() { return 'done'; } }; },
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
        for (const n of names) { const p = c.ent[n]; if (p) { p.state = 'fight'; p.t = 60; p.grudge = 3; p.blip = '#ff4d4d'; p.hits = 0; p.needHits = hits[n] ?? 2; } }
      },
      update(c) {
        let left = 0;
        for (const n of names) {
          const p = c.ent[n];
          if (!p) continue;
          if (p.hits >= (p.needHits || 2)) { if (p.state !== 'down' && p.state !== 'getup') { p.state = 'cower'; p.t = 999; } p.blip = null; continue; }
          left++;
          if (p.state === 'flee' || p.state === 'walk' || p.state === 'cower') { p.state = 'fight'; p.t = 60; }
          if (p.state === 'down') p.after = 'fight';
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
    let idx = 0;
    return {
      kind: 'race', points,
      enter(c) {
        idx = 0;
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
        g.hud.toastRace?.(ahead + 1, rivals.length + 1);
        c.m.vars.position = ahead + 1;
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
