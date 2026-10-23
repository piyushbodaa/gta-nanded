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
import { Quality } from '../core/quality.js';
import { Post } from '../world/post.js';

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.input = new Input(canvas);
    this.quality = new Quality();
    // Anti-aliasing happens in the post-processing buffer, where tiers can switch it on and off.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
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
    this.energy = 0;
    addEventListener('resize', () => this.resize());
    addEventListener('blur', () => { if (this.started && !this.paused && !this.respawning) this.pause?.openMenu(this.pause.tab); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.started && !this.paused && !this.respawning) this.pause?.openMenu(this.pause.tab); });
  }

  resize() {
    this.camera3.aspect = innerWidth / innerHeight;
    this.camera3.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.quality.pixelRatio());
    this.renderer.setSize(innerWidth, innerHeight, false);
  }

  async load(stage) {
    const spawn = { x: 463, z: 300 };
    this.world = await createWorld(this.scene, this.renderer, { stage, focus: spawn });
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
    this.renderer.setPixelRatio(this.quality.pixelRatio());
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.world.chunks.setRadius(q.viewDistance);
    this.world.sky.setViewDistance(q.viewDistance);
    this.post.configure({ msaa: q.msaa, bloom: q.bloom });
    this.camera3.far = q.viewDistance + 150;
    this.camera3.updateProjectionMatrix();
    const sun = this.world.sky.sun;
    sun.castShadow = q.shadows > 0;
    // The bounce fill lights cast shade; without a shadow map it would only flatten the picture.
    this.world.sky.bounceOn = q.shadows > 0;
    if (q.shadows > 0 && sun.shadow.mapSize.x !== q.shadows) {
      sun.shadow.mapSize.set(q.shadows, q.shadows);
      sun.shadow.map?.dispose(); sun.shadow.map = null;
    }
    this.renderer.shadowMap.needsUpdate = true;
  }

  start() {
    this.started = true;
    this.paused = false;
    this.clock.getDelta();
    if (!this._loop) { this._loop = () => this.frame(); this.renderer.setAnimationLoop(this._loop); }
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
    h.x = door.x; h.z = door.z; h.pose = 'lie'; h.pitch = -1.4;
    this.peds?.adoptEjected(h, v, player);
    this.onCarjack?.(v);
  }

  pushOutOfVehicles(actor, r) {
    for (const v of this.vehicles.list) {
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
    if (fixedDt === undefined) this.quality.sample(raw, this);
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
    this.renderWorld(this.paused ? 0 : dt);
  }

  renderWorld(dt) {
    const w = this.world, cam = this.camera3;
    const focus = this.player.pos;
    // Stream with what the frame can spare: up to 4 ms, less when frames are already long.
    w.chunks.update(focus.x, focus.z, this.started ? clamp(13 - this._frameMs, 1, 4) : 30);
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
    if (this._frameStart) this._frameMs += (performance.now() - this._frameStart - w.chunks.lastMs - this._frameMs) * 0.1;
  }
}
