// The game: owns the renderer, the world and every system, and runs the frame loop.
import * as THREE from 'three';
import { createWorld } from '../world/world.js';
import { Humans, makeOutfit, NO_SHADOW_BOX } from '../actors/humans.js';
import { Vehicles } from '../actors/vehicles.js';
import { Player } from '../actors/player.js';
import { GameCamera } from './camera.js';
import { Input } from '../core/input.js';
import { speedOf } from '../actors/vehicle-physics.js';
import { clamp, dist, rng, hash2 } from '../core/math.js';
import { Quality, ORDER, MIN_SCALE } from '../core/quality.js';
import { Post } from '../world/post.js';

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.input = new Input(canvas);
    this.quality = new Quality();
    // Anti-aliasing happens in the post-processing buffer, where tiers can switch it on and off.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    // Which GPU this is decides where the automatic quality starts. Chrome and Safari mask
    // the plain RENDERER string; Firefox gives the real one and deprecates the extension.
    const gl = this.renderer.getContext();
    let gpu = gl.getParameter(gl.RENDERER);
    if (/^webkit webgl$/i.test(gpu)) { const info = gl.getExtension('WEBGL_debug_renderer_info'); if (info) gpu = gl.getParameter(info.UNMASKED_RENDERER_WEBGL); }
    this.quality.setGpu(gpu);
    this.renderer.setPixelRatio(this.quality.pixelRatio());
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = this.quality.settings.shadows > 0;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.scene = new THREE.Scene();
    this.camera3 = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 900);
    this.clock = new THREE.Clock();
    this.time = 0;
    this.paused = true;
    this.started = false;
    this.controls = new Map();
    this.shadowAt = new THREE.Vector3(1e9, 0, 0);
    this._frameMs = 0;
    this.cpuMs = 0; // the game's own work per frame, smoothed (the performance readout)
    this.perf = { n: 0, t: 0, worst: 0, fps: 0, ms: 0, worstMs: 0 };
    this._fails = 0; // frames in a row that threw
    this.energy = 0;
    addEventListener('resize', () => this.resize());
    addEventListener('blur', () => { if (this.started && !this.paused && !this.respawning) this.pause?.openMenu(this.pause.tab); });
    // A hidden page may never come back (Android discards background tabs): keep what was
    // earned since the last autosave, whether or not the game was paused already.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.save?.flush();
      if (document.hidden && this.started && !this.paused && !this.respawning) this.pause?.openMenu(this.pause.tab);
    });
    addEventListener('pagehide', () => this.save?.flush());
  }

  resize() {
    this._pauseDrawn = false; // a resized canvas is blank: draw it again even behind the menu
    this.camera3.aspect = innerWidth / innerHeight;
    this.camera3.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.quality.pixelRatio());
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.post?.configure(this._postSettings());
  }

  /** The final pass sharpens in proportion to how far the browser will stretch the frame. */
  _postSettings() {
    const q = this.quality, s = q.settings;
    return { msaa: s.msaa, bloom: s.bloom, sharpen: Math.min(0.4, (q.upscale() - 1) * 0.3) };
  }

  async load(stage) {
    const spawn = { x: 463, z: 300 };
    const q = this.quality;
    // Only a phone settled on Fast paints the city at half resolution. A first guess may not
    // last: calibration, before play, often moves a first launch (or a promoted one) off Fast.
    const settled = q.mode !== 'auto' || (q.learned && !q.learned.promote);
    this.world = await createWorld(this.scene, this.renderer, { stage, focus: spawn, sharp: !(q.phone && q.tier === 'low' && settled) });
    const w = this.world;
    this.city = w.city; this.net = w.net; this.colliders = w.colliders; this.sky = w.sky;
    this.post = new Post(this.renderer, this.sky);
    this.post.setDetail(w.textures.detail);
    this.sky.useSceneFog(!this.post.enabled);
    this.applyQuality();
    this.humans = new Humans(this.scene, 220);
    this.vehicles = new Vehicles(this.scene, this.humans, this.colliders, this.city);
    this.camera = new GameCamera(this.camera3, this.colliders);
    this.player = new Player(this, spawn.x, spawn.z, 0);
    this.camera.reset(0);
    return this;
  }

  applyQuality() {
    const q = this.quality.settings;
    this._pauseDrawn = false;
    this.renderer.setPixelRatio(this.quality.pixelRatio());
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.world.chunks.setRadius(q.viewDistance);
    this.world.sky.setViewDistance(q.viewDistance);
    this.post.configure(this._postSettings());
    this.camera3.far = q.viewDistance + 150;
    this.camera3.updateProjectionMatrix();
    const sun = this.world.sky.sun;
    this.renderer.shadowMap.enabled = q.shadows > 0;
    sun.castShadow = q.shadows > 0;
    // The bounce fill lights cast shade; without a shadow map it would only flatten the picture.
    this.world.sky.bounceOn = q.shadows > 0;
    // A wider filter on the coarser map: soft edges instead of stair-steps, for the same 17 taps.
    sun.shadow.radius = q.shadows >= 2048 ? 1.3 : 1.8;
    if (q.shadows > 0 && sun.shadow.mapSize.x !== q.shadows) {
      sun.shadow.mapSize.set(q.shadows, q.shadows);
      sun.shadow.map?.dispose(); sun.shadow.map = null;
    } else if (q.shadows === 0 && sun.shadow.map) {
      // A tier without shadows gives back the map's memory too (it's made again if they return).
      sun.shadow.map.dispose(); sun.shadow.map = null;
    }
    this.renderer.shadowMap.needsUpdate = true;
  }

  start() {
    this.started = true;
    this.paused = false;
    this.clock.getDelta();
    // A browser that won't keep the game's data (blocked site storage): say so once, rather
    // than let the player find a fresh save next time.
    if (this.save) {
      this.save.onFail = () => this.hud?.toast("<b>Progress isn't being saved:</b> this browser blocks the game's storage.", 8);
      if (!this.save.available) this.save.onFail();
    }
    if (!this._loop) {
      this._loop = t => {
        // The frame-rate cap: on 90 and 120 Hz screens, and in battery saver, skip the display
        // refreshes that come too early instead of drawing frames nobody needs. Timed by the
        // refresh (the browser's timestamp), not by when this callback got to run.
        if (!this.quality.frameDue(t ?? performance.now())) return;
        try {
          this.frame();
          this._fails = 0;
        } catch (err) {
          // One fault in one system mustn't stop the whole game: three.js asks for the next frame
          // only after this one returns. Drop what the broken frame left half done and carry on;
          // a fault that comes back every frame for a second stops the game with a message.
          console.error('GTA Nanded: a frame failed', err);
          this.controls.clear();
          this.input.endFrame();
          this.save?.flush();
          if (++this._fails >= 60) this._fatal(err);
        }
      };
      this.renderer.setAnimationLoop(this._loop);
    }
  }

  /** A fault that won't go away: stop, and say so instead of leaving a frozen picture. */
  _fatal(err) {
    this.renderer.setAnimationLoop(null);
    const box = document.getElementById('fatal');
    if (!box) return;
    box.querySelector('h2').textContent = 'The game stopped on an error.';
    document.getElementById('fatal-msg').textContent = `${err?.message || err}. Reload to carry on from your last save.`;
    box.hidden = false;
  }

  /**
   * The first launch on a GPU: time a few frames behind the cover and settle the automatic
   * setting before play, so nobody spends their first minute in a stuttering city. Later
   * launches start where the governor last settled, unless it found room for a tier up.
   * Tier changes recompile shaders, which belongs here, not in the middle of a chase.
   */
  calibrate(spot) {
    const q = this.quality;
    if (q.mode !== 'auto' || (q.learned && !q.learned.promote)) return;
    // Time the view play opens on: the player at `spot`, the camera behind them, the streets
    // filled. Before the first frame the camera sits at the origin at road level and draws a
    // fraction of what play does, and a tier picked from that frame doesn't hold in play.
    if (spot) {
      const P = this.player, h = P.human;
      P.teleport(spot.x, spot.z, spot.heading);
      h.x = P.x; h.y = P.y; h.z = P.z; h.yaw = P.heading;
      this.camera.update(0, this.input, { human: h, speed: 0, heading: P.heading, groundY: P.groundY });
      for (let i = 0; i < 40; i++) { this.traffic?.update(0.05); this.peds?.update(0.05); }
      if (this.parked) { this.parked.t = 0; this.parked.update(1); }
    }
    const gl = this.renderer.getContext(), chunks = this.world.chunks, p = this.player.pos;
    const budget = 1000 / (q.fpsCap || 60);
    // Milliseconds per frame: the median of three short runs, so one busy moment can't decide.
    // Reading back a pixel waits for the GPU to finish drawing; gl.finish() doesn't always.
    const px = new Uint8Array(4), sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const time = () => {
      // The nearest streets in first (the rest streams in during play anyway).
      for (const until = performance.now() + 700; chunks.queue.length && performance.now() < until;) chunks.update(p.x, p.z, 50);
      for (let i = 0; i < 5; i++) this.renderWorld(0, false); // compile, and let the GPU clock up
      sync();
      const runs = [];
      for (let k = 0; k < 3; k++) {
        const t0 = performance.now();
        for (let i = 0; i < 4; i++) this.renderWorld(0, false);
        sync();
        runs.push((performance.now() - t0) / 4);
      }
      return runs.sort((a, b) => a - b)[1];
    };
    const set = tier => { q.autoTier = tier; q.scale = 1; this.applyQuality(); };
    const up = t => ORDER[ORDER.indexOf(t) + 1], down = t => ORDER[ORDER.indexOf(t) - 1];
    const heavy = new Set(q.tooHeavy), first = !q.learned;
    set(q.learned?.promote && up(q.autoTier) && !heavy.has(up(q.autoTier)) ? up(q.autoTier) : q.autoTier);
    let ms = time();
    while (ms > budget * 0.8 && down(q.autoTier)) { heavy.add(q.autoTier); set(down(q.autoTier)); ms = time(); }
    // Plenty of room on a first launch: try one tier up, and keep it only if it still fits.
    const next = up(q.autoTier);
    if (first && next && !heavy.has(next) && ms < budget * 0.3) {
      const was = q.autoTier;
      set(next);
      const tried = time();
      if (tried > budget * 0.6) { heavy.add(next); set(was); } else ms = tried;
    }
    // Whatever doesn't fit in two thirds of the frame comes off the resolution.
    if (ms > budget * 0.66) { q.scale = Math.max(MIN_SCALE, Math.round(Math.sqrt((budget * 0.66) / ms) * 20) / 20); this.resize(); }
    q.learn({ tooHeavy: [...heavy], promote: false, frameMs: Math.round(ms * 10) / 10 });
  }

  /**
   * While the menu is up, compile one at a time the shaders of everything the city hasn't drawn
   * yet. The crowd, cars and animals would otherwise compile the first time each comes into
   * view, and a phone that can't compile in the background stops for every one (Test Lab,
   * 2026-10-25: a dozen programs in the first seconds of play, frames of up to a second).
   * `going()` says whether to carry on; whatever is left compiles on first use, as before.
   */
  warmShaders(going) {
    const r = this.renderer, seen = new Set(), todo = [];
    this.scene.traverse(o => {
      const m = o.material;
      if (!(o.isMesh || o.isLine || o.isPoints) || !m || Array.isArray(m) || seen.has(m)) return;
      seen.add(m);
      if (!r.properties.get(m).programs) todo.push(o);
    });
    const later = f => (window.requestIdleCallback ? requestIdleCallback(f, { timeout: 100 }) : setTimeout(f, 16));
    const next = () => {
      const o = todo.shift();
      if (!o || !going()) return;
      // The scene is drawn into the post-processing buffer, and the target decides the program
      // (tone mapping, colour space): compiled for the screen, it would be compiled again.
      const was = r.getRenderTarget();
      r.setRenderTarget(this.post.enabled ? this.post.rt : null);
      r.compile(o, this.camera3, this.scene);
      r.setRenderTarget(was);
      later(next);
    };
    later(next);
  }

  // ---------------------------------------------------------------- helpers for actors
  nearestEnterable(x, z, radius) {
    let best = null, bd = radius;
    for (const v of this.vehicles.list) {
      if (v === this.player.vehicle || v.wrecked) continue;
      const door = this.vehicles.doorWorld(v, this._door || (this._door = {}));
      const d = Math.min(dist(x, z, door.x, door.z), dist(x, z, v.x, v.z) - v.hd * 0.5);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  carjack(v, player) {
    const h = this.vehicles.ejectDriver(v);
    if (!h) return;
    const door = this.vehicles.doorWorld(v);
    h.x = door.x; h.z = door.z; h.pose = 'lie';
    this.peds?.adoptEjected(h, v, player);
    this.onCarjack?.(v);
  }

  pushOutOfVehicles(actor, r) {
    for (const v of this.vehicles.list) {
      if (Math.abs((actor.y ?? 0) - v.y) > 2) continue; // one of us is up on a flyover
      const dx = actor.x - v.x, dz = actor.z - v.z;
      if (dx * dx + dz * dz > (v.hd + r + 1) ** 2) continue;
      const c = Math.cos(v.heading), s = Math.sin(v.heading);
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      const ex = Math.abs(lx) - (v.hw + r), ez = Math.abs(lz) - (v.hd + r);
      if (ex >= 0 || ez >= 0) continue;
      // Push out along the shallower axis.
      let nlx = 0, nlz = 0, d;
      if (ex > ez) { nlx = Math.sign(lx) || 1; d = -ex; } else { nlz = Math.sign(lz) || 1; d = -ez; }
      const nx = nlx * c + nlz * s, nz = -nlx * s + nlz * c;
      actor.x += nx * d; actor.z += nz * d;
      const spd = speedOf(v);
      if (spd > 4 && actor.knockDown && actor === this.player) {
        actor.damage(spd * 2.2, 'vehicle');
        actor.knockDown(v.vx * 0.6 + nx * 3, v.vz * 0.6 + nz * 3, 1.4);
      }
    }
  }

  /**
   * Advance the game by `seconds` of fixed steps without waiting for the display
   * (automated tests and the dev console). Renders once at the end.
   */
  simulate(seconds, step = 1 / 60) {
    const n = Math.round(seconds / step);
    for (let i = 0; i < n; i++) this.frame(step, i < n - 1);
  }

  // ---------------------------------------------------------------- frame
  frame(fixedDt, skipRender = false) {
    this._frameStart = performance.now();
    const raw = fixedDt ?? this.clock.getDelta();
    const dt = Math.min(raw, 1 / 20);
    if (fixedDt === undefined) {
      this.quality.sample(raw, this);
      const pf = this.perf;
      pf.n++; pf.t += raw; pf.worst = Math.max(pf.worst, raw);
      if (pf.t >= 0.5) { pf.fps = pf.n / pf.t; pf.ms = (pf.t / pf.n) * 1000; pf.worstMs = pf.worst * 1000; pf.n = pf.t = pf.worst = 0; }
    }
    const input = this.input;
    input.update();
    // Menus: Esc pauses, M opens the map, and either closes the menu again.
    if (this.started && this.pause && !this.respawning) {
      if (input.pressed('pause')) this.pause.toggle(this.pause.tab);
      if (input.pressed('map')) this.pause.open ? this.pause.close() : this.pause.openMenu('map');
    }
    document.body.classList.toggle('cutscene', Boolean(this.cutscene));
    if (this.cutscene) {
      // Scripted moments: the player stands still and the camera tells the story.
      const s = input.state;
      s.moveX = s.moveY = s.throttle = s.steer = 0; s.brake = this.player.vehicle ? 1 : 0; s.handbrake = false;
      for (const a of ['enter', 'attack', 'jump', 'action', 'job']) input.events.delete(a);
    }
    if (!this.paused) {
      this.time += dt;
      this.energy = Math.max(0, this.energy - dt);
      this.player.update(dt, input);
      if (this.player.vehicle) this.controls.set(this.player.vehicle, this.player.controls);
      // Everything that drives a vehicle writes its controls before physics reads them.
      this.traffic?.update(dt);
      this.parked?.update(dt);
      this.stands?.update(dt);
      this.markets?.update(dt);
      this.police?.update(dt);
      this.missions?.update(dt);
      this.hooks?.forEach(f => f(dt));
      this.vehicles.step(dt, this.controls);
      this.controls.clear();
      this.peds?.update(dt);
      this.animals?.update(dt);
    }
    this.touch?.update();
    const subject = this.player.vehicle ? { vehicle: this.player.vehicle, groundY: this.player.vehicle.y } : { human: this.player.human, speed: this.player.speed, heading: this.player.heading, sprinting: this.player.sprinting, groundY: this.player.groundY };
    if (this.paused) input.look.x = input.look.y = 0;
    this.camera.update(this.paused ? 0 : dt, input, subject);
    this.audio?.update(dt, this);
    input.endFrame();
    if (skipRender) { this.vehicles.render(dt, this.camera3.position); return; }
    // Behind the pause menu nothing moves and the menu all but covers it: draw the city once,
    // then let the phone's graphics chip rest until play resumes.
    if (this.paused && this._pauseDrawn) return;
    this.renderWorld(this.paused ? 0 : dt);
    this._pauseDrawn = this.paused;
  }

  renderWorld(dt, stream = true) {
    const w = this.world, cam = this.camera3;
    const focus = this.player.pos;
    // Stream with what the frame can spare: up to 4 ms, less when frames are already long.
    if (stream) w.chunks.update(focus.x, focus.z, this.started ? clamp(13 - this._frameMs, 1, 4) : 30);
    w.sky.update(dt, focus);
    this.signals?.update(dt, this.time);
    w.sky.placeDome(cam);
    w.rivers.update(dt);
    w.cityUniforms.uNight.value = w.sky.night;
    w.cityUniforms.uWet.value = w.sky.wet;
    w.cityUniforms.uTime.value += dt;
    w.chunks.setNight(w.sky.night);
    this.vehicles.night = w.sky.night;
    // People and vehicles cast only into a shadow map that refreshes with them (High and up);
    // a static one would leave their shadows behind as they move.
    const q = this.quality.settings, casters = q.dynamicShadows ? w.sky.shadowBox : NO_SHADOW_BOX;
    this.humans.blobsOn = !q.dynamicShadows;
    this.humans.nearRadius = q.nearRadius; this.humans.nearMax = q.nearPeople;
    this.vehicles.render(dt, cam.position, casters);
    this.humans.update(dt, cam.position, casters);
    this.effects?.update(dt, cam, { rain: w.sky.weather === 'rain' ? w.sky.w.grey : 0 });
    // Shadows: static city refreshed as the focus moves; dynamic actors on high settings.
    if (q.shadows > 0) {
      // Moving shadows refresh every other frame: half the cost, and nobody can tell.
      this._shadowFrame = !this._shadowFrame;
      if ((q.dynamicShadows && this._shadowFrame) || this.shadowAt.distanceToSquared(cam.position) > 36 || (this._sunTick = (this._sunTick || 0) + dt) > 2) {
        this.renderer.shadowMap.needsUpdate = true; this.shadowAt.copy(cam.position); this._sunTick = 0;
      }
    }
    this.hud?.update(dt);
    this.post.render(this.scene, cam, dt);
    // How long a frame takes besides streaming (smoothed), for the streaming budget.
    if (this._frameStart) {
      const spent = performance.now() - this._frameStart;
      this._frameMs += (spent - w.chunks.lastMs - this._frameMs) * 0.1;
      this.cpuMs += (spent - this.cpuMs) * 0.1;
    }
  }
}
