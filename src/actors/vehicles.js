// Every vehicle in the city: physics bodies, instanced rendering, drivers and riders.
import * as THREE from 'three';
import { VEHICLE_TYPES, TYPE_KEYS } from './vehicle-types.js';
import { vehicleModel } from './vehicle-models.js';
import { createBody, stepBody, collideStatic, collidePair, closingSpeed, speedOf, forwardSpeed } from './vehicle-physics.js';
import { makeOutfit, inShadowBox } from './humans.js';
import { radialTexture } from '../world/citymat.js';
import { WATER_Y } from '../world/water.js';
import { clamp, rng } from '../core/math.js';
import { sendFirst } from '../core/buffers.js';

// Instance slots per type. Police: a 5-star hunt's 8 units, the jeeps officers left at the
// roadside, a wreck or two and a stolen one (police.js spawns no unit past this).
const CAPACITY = { hatch: 40, sedan: 30, suv: 20, police: 20, auto: 48, bike: 50, scooter: 40, bus: 16, truck: 10, tractor: 6, tempo: 12, ambulance: 4 };
const _m = new THREE.Matrix4(), _w = new THREE.Matrix4(), _t = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const _axles = new THREE.Matrix4();
const WRECK = 0x2a2624;
const BEAM_CAPACITY = Object.values(CAPACITY).reduce((n, cap) => n + 2 * cap, 0);

let nextId = 1;
// In the river: how hard the water holds a body back (per second, once most of it is under); how
// much of its height is "most"; how long that far under before its engine has drowned and it is a
// write-off (rules.js reads the same clock to drown a player still at the wheel); and where the
// clock is held while it is merely stuck in the shallows: past rules.js's splash (0.4 s), short of
// drowning.
const WATER_DRAG = 3, UNDER = 0.6, DROWNED = 1.5, STUCK = 1;

export class Vehicles {
  constructor(scene, humans, colliders, city) {
    this.scene = scene;
    this.humans = humans;
    this.colliders = colliders;
    this.city = city;
    this.list = [];
    this.meshes = {};
    // Glossy clear-coated paint, dark mirror-smooth glass, and a vertex-coloured
    // material for trim, tyres and canopies.
    const lambert = new THREE.MeshPhysicalMaterial({ roughness: 0.4, metalness: 0.12, clearcoat: 1, clearcoatRoughness: 0.06 });
    const vcol = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x253c47, roughness: 0.13, metalness: 0.24 });
    const glazing = glass.clone();
    glazing.transparent = true; glazing.opacity = 0.64; glazing.depthWrite = false;
    const lit = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
    lit.onBeforeCompile = lampShader;
    for (const type of TYPE_KEYS) {
      const model = vehicleModel(type);
      const cap = CAPACITY[type] || 10;
      const openCabin = ['hatch', 'sedan', 'suv', 'police', 'auto'].includes(type);
      const mk = (geo, mat) => {
        const m = new THREE.InstancedMesh(geo, mat, cap);
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.setColorAt(0, _c.set(0xffffff));
        m.count = 0; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
        scene.add(m);
        return m;
      };
      const M = (this.meshes[type] = { paint: mk(model.geos.paint, lambert), glass: mk(model.geos.glass, openCabin ? glazing : glass), fixed: mk(model.geos.fixed, vcol), lights: mk(model.geos.lights, lit), n: 0, nShadow: 0, model, cap });
      M.lights.castShadow = false;
      M.glass.castShadow = !openCabin;
      for (const k of ['paint', 'glass', 'fixed']) {
        M[k].onBeforeShadow = () => { M[k].count = M.nShadow; };
        M[k].onAfterShadow = () => { M[k].count = M.n; };
      }
    }
    this.wheels = new THREE.InstancedMesh(wheelGeometry(), vcol, 900);
    this.wheelsShadow = 0; this.wheelsN = 0;
    this.wheels.onBeforeShadow = () => { this.wheels.count = this.wheelsShadow; };
    this.wheels.onAfterShadow = () => { this.wheels.count = this.wheelsN; };
    this.wheels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.wheels.count = 0; this.wheels.castShadow = true; this.wheels.frustumCulled = false;
    scene.add(this.wheels);
    // Soft contact shadows and night headlight beams.
    const tex = radialTexture(64);
    const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.blobs = new THREE.InstancedMesh(plane, new THREE.MeshBasicMaterial({ map: tex, color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false }), 400);
    this.blobs.count = 0; this.blobs.frustumCulled = false; this.blobs.renderOrder = 1;
    this.blobs.material.polygonOffset = true; this.blobs.material.polygonOffsetFactor = -1; this.blobs.material.polygonOffsetUnits = -2;
    scene.add(this.blobs);
    const beamPlane = plane.clone().translate(0, 0, 0.5);
    this.beamLimit = new THREE.InstancedBufferAttribute(new Float32Array(BEAM_CAPACITY), 1).setUsage(THREE.DynamicDrawUsage);
    beamPlane.setAttribute('beamLimit', this.beamLimit);
    const beamMaterial = new THREE.MeshBasicMaterial({ map: headlightTexture(), color: 0xffedcb, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    beamMaterial.onBeforeCompile = s => {
      s.vertexShader = s.vertexShader.replace('#include <common>', 'attribute float beamLimit;\n#include <common>')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.z *= beamLimit; vMapUv.y = mix(1.0, vMapUv.y, beamLimit);');
    };
    this.beams = new THREE.InstancedMesh(beamPlane, beamMaterial, BEAM_CAPACITY);
    this.beams.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.beams.count = 0; this.beams.frustumCulled = false; this.beams.renderOrder = 2;
    this.beams.material.polygonOffset = true; this.beams.material.polygonOffsetFactor = -2; this.beams.material.polygonOffsetUnits = -4;
    scene.add(this.beams);
    this.lampGlows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }), BEAM_CAPACITY);
    this.lampGlows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.lampGlows.setColorAt(0, _c.setHex(0xffffff));
    this.lampGlows.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.lampGlows.count = 0; this.lampGlows.frustumCulled = false; this.lampGlows.renderOrder = 3;
    scene.add(this.lampGlows);
    // A single unshadowed light lets the player's lamps pick out pedestrians, other cars and walls.
    this.drivingLight = new THREE.SpotLight(0xffedce, 0, 28, 0.40, 0.72, 2);
    this.drivingLight.position.set(0, -100, 0);
    this.drivingLight.target.position.set(0, -101, 0);
    scene.add(this.drivingLight, this.drivingLight.target);
    this.night = 0;
    this.time = 0;
    this._contact = {};
    this.drawDistance = 260;
  }

  spawn(type, x, z, heading, { color, role = 'parked', driver = true, seed = nextId * 7919 } = {}) {
    const spec = VEHICLE_TYPES[type];
    const r = rng(seed);
    const body = createBody(type, x, z, heading);
    const v = Object.assign(body, {
      id: nextId++, role, color: color ?? r.pick(spec.colors), visible: true, driver: null, passengers: [],
      kinematic: role !== 'player', ai: null, siren: false, sirenOn: false, horn: 0, lightsOn: false,
      smoke: 0, model: vehicleModel(type), lastHit: 0, seed,
    });
    if (driver) this.seatDriver(v, makeOutfit(type === 'police' ? 'police' : r.pick(['man', 'man', 'man', 'sikh', 'elder', 'student', 'woman']), seed + 1));
    this.list.push(v);
    return v;
  }

  seatDriver(v, outfit) {
    if (v.driver) return v.driver;
    const h = this.humans.add(outfit, v.x, v.z);
    h.pose = v.model.seat.pose;
    h.seatY = v.model.seat.y;
    v.driver = h;
    return h;
  }
  addPassenger(v, outfit) {
    const seats = v.model.passengers;
    if (v.passengers.length >= seats.length) return null;
    const h = this.humans.add(outfit, v.x, v.z);
    h.pose = v.model.seat.pose === 'ride' ? 'ride' : 'sit';
    h.seatY = seats[v.passengers.length][1];
    v.passengers.push(h);
    return h;
  }
  /** Remove and return the driver's human (for carjacking / exiting). */
  ejectDriver(v) {
    const h = v.driver;
    v.driver = null;
    return h;
  }
  remove(v) {
    const i = this.list.indexOf(v);
    if (i >= 0) this.list.splice(i, 1);
    // The player's own body stays: they step off where it stood on their next update (Player.update).
    if (v.driver && v.role !== 'player') this.humans.remove(v.driver);
    for (const p of v.passengers) this.humans.remove(p);
    v.driver = null; v.passengers = [];
    v.removed = true;
  }

  /** Seat position of the driver in world space. */
  seatWorld(v, out = {}) {
    const s = v.model.seat, c = Math.cos(v.heading), sn = Math.sin(v.heading);
    out.x = v.x + s.x * c + s.z * sn; out.z = v.z - s.x * sn + s.z * c;
    return out;
  }
  /** Centre of wheel i (an index into v.model.wheels) in world space, out = {x, y, z}; a flat one sits lower. */
  wheelWorld(v, i, out = {}) {
    const w = v.model.wheels[i];
    if (!w) return null;
    setAxleMatrix(v);
    _p.set(w[0], v.flat & (1 << i) ? w[2] * 0.78 : w[2], w[1]).applyMatrix4(_axles);
    out.x = _p.x; out.y = _p.y; out.z = _p.z;
    return out;
  }
  /** The wheel whose tyre (x, y, z) is within r of, the nearest of them, or -1. */
  wheelNear(v, x, y, z, r) {
    const W = v.model.wheels, p = this._wn || (this._wn = {});
    let best = -1, bestD = Infinity;
    for (let i = 0; i < W.length; i++) {
      this.wheelWorld(v, i, p);
      const d = Math.hypot(p.x - x, p.y - y, p.z - z) - W[i][2];
      if (d < r && d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /**
   * Door position where people get in and out: the driver's side (right-hand drive), and the left of
   * a two-wheeler, the side its stand and the rider's foot are on (local +x is the vehicle's left).
   */
  doorWorld(v, out = {}) {
    return local(v, doorSide(v), v.model.seat.z, out);
  }
  /**
   * Where someone getting out stands, {x, z, y}: the door, or else the other side, behind or ahead,
   * whichever is first on the vehicle's own level (not off a flyover's deck), clear of walls and
   * railings, and out of the river. Hemmed in all round, the door.
   */
  exitWorld(v, out = {}) {
    const city = this.city, rd = this._rd || (this._rd = {}), s = v.model.seat, side = doorSide(v);
    const ground = () => Math.max(city.groundHeight(out.x, out.z), city.net.surfaceAt(out.x, out.z, v.y));
    // On a bridge over the river everything around is water: its parapets decide.
    const dry = city.riverDistance(v.x, v.z, rd).d >= -1;
    for (const [lx, lz] of [[side, s.z], [-side, s.z], [0, -v.hd - 0.6], [0, v.hd + 0.6]]) {
      local(v, lx, lz, out);
      const y = ground();
      if (Math.abs(y - v.y) > 1 || this.colliders.blocked(out.x, out.z, 0.34, y)) continue;
      if (dry && city.riverDistance(out.x, out.z, rd).d < -1) continue;
      out.y = y;
      return out;
    }
    local(v, side, s.z, out);
    out.y = ground();
    return out;
  }

  /** Physics for every non-kinematic body, then collisions, in substeps. */
  step(dt, controls) {
    if (!(dt > 0)) return;
    const sub = this._nearPairs(dt), h = dt / sub;
    for (let k = 0; k < sub; k++) {
      for (const v of this.list) {
        // Driven along its lane, a body forgets its last ride: woken again on a speed breaker, it
        // would otherwise take the whole hump as one substep's rise and fly.
        if (v.kinematic) { if (v.base !== undefined) v.base = undefined; continue; }
        // No controls this frame: lane traffic (its driver takes over next frame), the player's car and
        // one they bailed out of roll on; anything parked or left waiting holds still.
        const rolls = v.ai || v.role === 'player' || v.role === 'abandoned';
        const ctl = controls.get(v) || (rolls ? IDLE : parked(v));
        stepBody(v, ctl, h, v.role === 'player' ? 1 : 1.3);
        // Up a flyover's ramp and along its deck, on the street beneath it or down a riverbank; over a speed
        // breaker the body rises with the hump, and taken fast it leaves the road for a moment.
        v.y = this.city.net.surfaceAt(v.x, v.z, v.y - (v.hop || 0));
        this._ride(v, h);
        v.y += v.hop;
        const hit = collideStatic(v, this.colliders, this._contact);
        if (hit > 4) this._impact(v, hit, null);
        // Water: down the bank and into the channel, a body sinks. A bridge deck stands clear of it.
        // It drowns only once the water is over most of it (drawn on the riverbed, it is then mostly
        // under): a truck, or an SUV a few metres out in waist-deep water, is merely stuck, and can
        // crawl back out or be left there. Nothing burns in the river (rules.js draws no fire there).
        const rd = this.city.riverDistance(v.x, v.z, this._rd || (this._rd = {}));
        const depth = WATER_Y - v.y, under = depth / (UNDER * v.spec.H);
        if (rd.d < -1.5 && depth > 0) {
          v.sinking = (v.sinking || 0) + h;
          if (under < 1) v.sinking = Math.min(v.sinking, STUCK);
          v.onFire = 0;
        } else v.sinking = 0;
        // The water holds it back, the more of it under the harder: rolled in, it stops a few metres
        // out instead of crossing the riverbed and climbing the far bank, a tall truck further out
        // than a hatch.
        if (depth > 0) {
          const k = Math.exp(-WATER_DRAG * Math.min(1, under) * h);
          v.vx *= k; v.vz *= k; v.w *= k;
        }
        // Under for good, its engine drowned: a write-off where it lies, and no blast goes off under the river.
        if (v.sinking > DROWNED) { v.wrecked = true; v.explodeAt = 0; }
      }
      // Lane traffic was placed where it will be at the end of the frame: meet it where it is now.
      this._collidePairs(dt - (k + 1) * h);
    }
  }

  /**
   * The pairs of vehicles (at least one dynamic) near enough to touch this frame, and the substeps it
   * needs: two, or more while a pair closes fast on a collision course, so that vehicles about to meet
   * are checked every 35 cm of closing. At a slow phone's 20 fps a bike meeting an oncoming bike closes
   * 2.5 m between frames; checked only then, they would slip through each other.
   */
  _nearPairs(dt) {
    const pairs = this._pairs || (this._pairs = []);
    pairs.length = 0;
    let closing = 0;
    for (const a of this.list) {
      if (a.kinematic) continue;
      // Near enough to meet in this frame even head-on at full speed (90 m/s), lane traffic counted
      // from where it was before it moved on (up to 40 m/s).
      const ax = a.x, az = a.z, reach = a.hd + 0.5 + 130 * dt;
      for (const b of this.list) {
        if (a === b || (!b.kinematic && b.id < a.id)) continue;
        let dx = ax - b.x, dz = az - b.z;
        const near = reach + b.hd;
        if (dx * dx + dz * dz > near * near || Math.abs(a.y - b.y) > 2) continue;
        pairs.push(a, b);
        // Where b was as the frame began.
        if (b.kinematic) { dx += b.vx * dt; dz += b.vz * dt; }
        const rvx = a.vx - b.vx, rvz = a.vz - b.vz, rv = Math.hypot(rvx, rvz);
        if (rv * dt <= 0.7 || rv <= closing) continue; // two substeps are enough
        // On a collision course: their paths overlap side to side (oncoming traffic in its own
        // lane passes by), and b is ahead within this frame's travel.
        const ux = rvx / rv, uz = rvz / rv, side = Math.abs(dz * ux - dx * uz), ahead = -(dx * ux + dz * uz);
        const width = span(a, -uz, ux) + span(b, -uz, ux), length = span(a, ux, uz) + span(b, ux, uz);
        if (side < width && ahead > -length && ahead - length < rv * dt) closing = rv;
      }
    }
    return clamp(Math.ceil((closing * dt) / 0.35), 2, 8);
  }

  /** Vehicle-vehicle, for this frame's near pairs; kinematic ones are met `lag` seconds back along their way. */
  _collidePairs(lag) {
    const pairs = this._pairs;
    for (let i = 0; i < pairs.length; i += 2) {
      const a = pairs[i], b = pairs[i + 1];
      const back = b.kinematic ? lag : 0, x = b.x, z = b.z;
      const dx = a.x - x + b.vx * back, dz = a.z - z + b.vz * back, rr = a.hd + b.hd + 0.5;
      if (dx * dx + dz * dz > rr * rr || Math.abs(a.y - b.y) > 2) continue; // on a flyover and under it
      b.x = x - b.vx * back; b.z = z - b.vz * back;
      // Traffic and parked vehicles meet a crash with their real mass: as walls, a scooter would throw
      // a hatch back the way it came. A brush leaves them to their drivers.
      // A nakabandi's jeep is a wall to a car nosing into it; rammed hard (over 6 m/s) it is shoved aside.
      const wakes = b.kinematic && b.role !== 'parked-static' && closingSpeed(a, b) > (b.role === 'roadblock' ? 6 : 1.5);
      if (wakes) b.kinematic = false;
      const imp = collidePair(a, b);
      if (imp > 1.5) {
        this._impact(a, imp, b);
        this._impact(b, imp, a);
      }
      if (wakes) { b.kinematic = true; this.wake(b); }
      if (b.kinematic) { b.x = x; b.z = z; }
    }
  }

  /**
   * Speed breakers and potholes under a physics body. v.hop is the body's height above the road:
   * a hump under its axles pushes it up, the springs give back a little more than they took,
   * gravity brings it down, and a hard landing or a wheel dropping into a pothole jolts (onBump).
   */
  _ride(v, h) {
    const B = this.city.bumps, fx = Math.sin(v.heading), fz = Math.cos(v.heading), half = v.spec.wheelbase / 2;
    const hf = B.heightAt(v.x + fx * half, v.z + fz * half), hr = B.heightAt(v.x - fx * half, v.z - fz * half);
    const base = (hf + hr) / 2, speed = speedOf(v);
    v.hopV = (v.hopV || 0) - 9.81 * h;
    v.hop = (v.hop || 0) + v.hopV * h;
    if (v.hop <= base) {
      if (v.air && v.hopV < -1.6) this.onBump?.(v, -v.hopV);
      // No faster than a hump can rise under wheels at this speed (its steepest slope is about 1 in 6):
      // a body put down on one (a police jeep unstuck out of sight) must not take it as one substep's rise.
      const rise = Math.min((base - (v.base ?? base)) / h, speed * 0.2 + 0.3);
      v.hop = base; v.hopV = Math.max(v.hopV, rise * 1.2); v.air = false;
      v.bumpPitch = Math.atan2(hf - hr, 2 * half);
    } else {
      if (v.hop > base + 0.03) v.air = true; // off the road (until it lands)
      v.bumpPitch = (v.bumpPitch || 0) * (1 - Math.min(1, h * 3));
    }
    v.base = base;
    // Potholes under the front wheels (the rear ones follow the same line).
    const tw = v.spec.two ? 0 : v.hw * 0.78;
    for (const side of v.spec.two ? [0] : [-1, 1]) {
      const hole = B.holeAt(v.x + fx * half - fz * tw * side, v.z + fz * half + fx * tw * side);
      const key = side < 0 ? 'holeL' : 'holeR';
      if (hole && hole !== v[key] && speed > 2.5 && !v.air) {
        v.hopV = Math.max(v.hopV, 0.35 + speed * 0.03);
        v.vx *= 0.985; v.vz *= 0.985;
        if (v.spec.two) v.lean += (Math.random() - 0.5) * 0.2;
        this.onBump?.(v, 0.8 + speed * 0.1, true);
      }
      v[key] = hole;
    }
  }

  /** Turn a lane-following AI vehicle into a free physics body after a crash. */
  wake(v) {
    if (!v.kinematic) return;
    v.kinematic = false;
    v.stunned = 3 + Math.random() * 2;
    if (v.ai) v.ai.disturbed = true;
  }

  _impact(v, speed, other) {
    const dmg = Math.max(0, speed - 3) * (v.spec.mass > 5000 ? 2 : 9) * (other && other.mass > v.mass * 3 ? 1.6 : 1) * (v.dmgK ?? 1);
    v.health = Math.max(0, v.health - dmg);
    v.lastHit = this.time;
    v.lastImpact = Math.max(v.lastImpact || 0, speed);
    // Rammed by the player: when it goes up in flames, that is the player's crime (rules.js).
    if (other?.role === 'player') v.lastHitBy = 'player';
    if (this.onImpact) this.onImpact(v, speed, other);
    if (v.health <= 0 && !v.wrecked) {
      v.wrecked = true;
      v.onFire = 0;
      if (this.onWreck) this.onWreck(v);
    } else if (v.health < 250 && !v.onFire && !v.wrecked) v.onFire = 0.01;
  }

  /** Write instance transforms; also syncs drivers and passengers into their seats. */
  render(dt, cam, shadowBox) {
    this.time += dt;
    for (const t of TYPE_KEYS) this.meshes[t].n = 0;
    let wn = 0, bn = 0, hn = 0;
    const night = this.night;
    // Keep the light count stable so entering a car never recompiles the city's shaders.
    // When off, aim below the world so every street fragment is outside its cone.
    this.drivingLight.intensity = 0;
    this.drivingLight.position.set(0, -100, 0);
    this.drivingLight.target.position.set(0, -101, 0);
    this.lampGlows.count = 0;
    const maxD2 = this.drawDistance * this.drawDistance;
    this.extras?.begin(); // owned cars' underglow and stickers (garage)
    // Vehicles inside the sun's shadow map first: the shadow pass draws only those.
    for (let pass = 0; pass < 2; pass++) {
      if (pass === 1) { for (const t of TYPE_KEYS) this.meshes[t].nShadow = this.meshes[t].n; this.wheelsShadow = wn; }
      for (const v of this.list) {
        const dx = v.x - cam.x, dz = v.z - cam.z;
        if ((pass === 0) !== inShadowBox(shadowBox, v.x, v.y, v.z, 8)) continue;
        const near = dx * dx + dz * dz < maxD2;
        const M = this.meshes[v.type];
        // Body transform with suspension pitch/roll and two-wheeler lean. A two-wheeler stopped with
        // a rider tips onto the rider's left foot; parked, it leans further onto its side stand.
        if (v.spec.two) {
          const spd = speedOf(v), stand = v.driver ? (spd < 0.8 ? 0.09 : 0) : !v.wrecked && spd < 0.3 ? 0.2 : 0;
          const was = v.standLean ?? stand; // one parked as we came near is already on its stand
          v.standLean = was + (stand - was) * Math.min(1, dt * 4);
        }
        const groundY = v.kinematic ? (v.deckY ?? v.y) : v.y - (v.hop || 0);
        // The city is flat apart from ramps and riverbanks. Sample those at the front and rear axles.
        v.roadPitch = 0;
        if (near && Math.abs(groundY) > 0.025) {
          const half = v.spec.wheelbase * 0.5, sx = Math.sin(v.heading) * half, sz = Math.cos(v.heading) * half;
          const f = this.city.net.surfaceAt(v.x + sx, v.z + sz, groundY);
          const r = this.city.net.surfaceAt(v.x - sx, v.z - sz, groundY);
          v.roadPitch = clamp(Math.atan2(f - r, 2 * half), -0.35, 0.35);
        }
        const lean = v.spec.two ? -(v.lean + v.standLean) : v.roll;
        _e.set(v.pitch - v.roadPitch - (v.bumpPitch || 0), v.heading, lean, 'YXZ');
        _q.setFromEuler(_e);
        _p.set(v.x, v.y, v.z);
        _s.set(1, 1, 1);
        _m.compose(_p, _q, _s);
        // Seat people even when the body is far (they're culled by their own distance check).
        this._seat(v, _m, _e);
        if (!near || !v.visible || M.n >= M.cap) continue;
        const i = M.n++;
        M.paint.setMatrixAt(i, _m); M.glass.setMatrixAt(i, _m); M.fixed.setMatrixAt(i, _m); M.lights.setMatrixAt(i, _m);
        M.paint.setColorAt(i, _c.setHex(v.wrecked ? WRECK : v.color));
        M.fixed.setColorAt(i, v.wrecked ? _c.setHex(0x444444) : _c.setHex(0xffffff));
        // Lamps (the colour is decoded per kind of lamp, see lampShader): switched on, and brighter at
        // night, only with someone at the wheel (off, they darken with the night like the paint);
        // tail lamps brighter braking; the light bar flashing red (1) and blue (2) with the siren.
        const lit = Boolean(v.driver) && !v.wrecked;
        // An owned car's lock chirp and alarm blink its lamps (garage: v.flashT).
        const blink = v.flashT > this.time && Math.floor(this.time * 8) % 2;
        const lamp = (v.wrecked ? 0.15 : lit ? 0.55 + night * 0.9 : 0.55 - night * 0.4) + (blink ? 0.8 : 0);
        const flash = v.sirenOn && !v.wrecked ? 1 + (Math.floor(this.time * 7 + v.id) % 2) : 0;
        M.lights.setColorAt(i, _c.setRGB(lamp, lamp * 0.65 + (lit && v.braking ? 1.8 : 0), flash));
        // The tyres follow the road while the suspended cabin rolls and pitches above them.
        setAxleMatrix(v);
        const model = v.model;
        const steerTan = Math.tan(v.steer);
        for (let k = 0; k < model.wheels.length; k++) {
          const [wx, wz, r, front, width] = model.wheels[k];
          if (wn >= this.wheels.instanceMatrix.count) break;
          // The inside front wheel traces a tighter arc; each wheel turns by distance / its own radius.
          const steer = front ? Math.atan2(v.spec.wheelbase * steerTan, v.spec.wheelbase - wx * steerTan) : 0;
          const spin = (front ? v.wheelSpin : v.rearWheelSpin) * v.spec.wheelR / r;
          _e.set(spin, steer, 0, 'YXZ');
          _q.setFromEuler(_e);
          // A burst tyre is squashed flat, the rim nearly on the road.
          const fr = v.flat & (1 << k) ? r * 0.78 : r;
          _p.set(wx, fr, wz);
          _s.set(width, fr, fr);
          _t.compose(_p, _q, _s);
          _w.multiplyMatrices(_axles, _t);
          this.wheels.setMatrixAt(wn++, _w);
        }
        if (v.mods && (v.mods.neon || v.mods.sticker != null)) this.extras?.add(v, _m);
        // Contact shadow.
        if (bn < this.blobs.instanceMatrix.count) {
          _e.set(-v.roadPitch, v.heading, 0, 'YXZ'); _q.setFromEuler(_e);
          _p.set(v.x, groundY + 0.09, v.z); _s.set(v.spec.W * 1.5, 1, v.spec.L * 1.25); // above the road surface (6-7 cm)
          _t.compose(_p, _q, _s);
          this.blobs.setMatrixAt(bn++, _t);
        }
        if (night > 0.05 && lit) {
          hn = this._headlights(v, groundY, dx * dx + dz * dz, hn);
          this._lensGlow(v, -dx, -dz);
        }
      }
    }
    for (const t of TYPE_KEYS) {
      const M = this.meshes[t];
      for (const k of ['paint', 'glass', 'fixed', 'lights']) {
        M[k].count = M.n;
        sendFirst(M[k].instanceMatrix, M.n);
        // Glass is never recoloured: its white colours went up once, with the first frame.
        if (k !== 'glass') sendFirst(M[k].instanceColor, M.n);
        M[k].visible = M.n > 0;
      }
    }
    this.wheels.count = this.wheelsN = wn; sendFirst(this.wheels.instanceMatrix, wn);
    this.blobs.count = bn; sendFirst(this.blobs.instanceMatrix, bn);
    this.beams.count = hn; sendFirst(this.beams.instanceMatrix, hn);
    sendFirst(this.beamLimit, hn);
    sendFirst(this.lampGlows.instanceMatrix, this.lampGlows.count);
    sendFirst(this.lampGlows.instanceColor, this.lampGlows.count);
    this.lampGlows.visible = this.lampGlows.count > 0;
    this.lampGlows.material.opacity = night * 0.54;
    // Nothing to draw: skip the draw call (WebGL warns about every empty instanced draw).
    this.wheels.visible = wn > 0; this.blobs.visible = bn > 0; this.beams.visible = hn > 0;
    this.beams.material.opacity = clamp((night - 0.05) * 0.37, 0, 0.35);
    this.extras?.end(night);
  }

  _lensGlow(v, dx, dz) {
    const distance = Math.hypot(dx, dz);
    const facing = (dx * Math.sin(v.heading) + dz * Math.cos(v.heading)) / Math.max(0.01, distance);
    if (Math.abs(facing) < 0.25) return;
    const front = facing > 0, direction = front ? 1 : -1;
    const lenses = front ? v.model.headlamps : v.model.taillamps;
    const strength = (Math.abs(facing) - 0.25) / 0.75;
    const size = (front ? 0.72 : v.braking ? 0.60 : 0.36) + Math.min(distance * 0.004, 0.4);
    _c.setHex(front ? 0xffebc7 : 0xff2518).multiplyScalar(strength * (front || v.braking ? 1 : 0.5));
    _q.setFromEuler(_e.set(0, Math.atan2(dx, dz), 0));
    _s.set(size, size * 0.83, 1);
    for (const [x, y, z] of lenses) {
      _p.set(x, y, z + direction * 0.045).applyMatrix4(_m);
      const index = this.lampGlows.count++;
      this.lampGlows.setMatrixAt(index, _t.compose(_p, _q, _s));
      this.lampGlows.setColorAt(index, _c);
    }
  }

  _headlights(v, groundY, dist2, index) {
    const lamps = v.model.headlamps, single = lamps.length === 1, player = v.role === 'player';
    const reach = single ? 17 : 23, yaw = v.heading + (v.spec.two ? v.steer : 0);
    const grade = Math.tan(v.roadPitch), slope = grade * Math.cos(yaw - v.heading);
    const nearby = dist2 < 75 * 75, sample = nearby && (player || v.nextBeamCast == null || this.time >= v.nextBeamCast);
    if (sample) {
      v.beamLimits ??= new Float32Array(lamps.length);
      v.nextBeamCast = this.time + 0.1;
    }
    let hit = 1;
    for (let k = 0; k < lamps.length; k++) {
      const [lx, ly, lz] = lamps[k], aim = yaw + Math.sign(lx) * 0.035;
      _p.set(lx, ly, lz).applyMatrix4(_m);
      const roadY = groundY + lz * grade + 0.095;
      if (sample) {
        const endX = _p.x + reach * Math.sin(aim), endZ = _p.z + reach * Math.cos(aim);
        v.beamLimits[k] = this.colliders.raycast(_p.x, _p.y, _p.z, endX, roadY + reach * slope, endZ, 0);
      }
      const limit = nearby ? v.beamLimits[k] : 1;
      hit = Math.min(hit, limit);
      if (limit < 0.01) continue;
      _p.y = roadY;
      _e.set(-Math.atan(slope), aim, 0, 'YXZ');
      _t.compose(_p, _q.setFromEuler(_e), _s.set(single ? 6.8 : 7.8, 1, reach));
      this.beamLimit.setX(index, limit);
      this.beams.setMatrixAt(index++, _t);
    }
    if (player) {
      const light = this.drivingLight, [, ly, lz] = lamps[0];
      light.position.set(0, ly, lz + 0.05).applyMatrix4(_m);
      light.target.position.copy(light.position);
      light.target.position.x += Math.sin(yaw) * reach;
      light.target.position.z += Math.cos(yaw) * reach;
      light.target.position.y += reach * (slope - 0.12);
      light.distance = Math.min(reach + 4, reach * hit + 3.5);
      light.intensity = (single ? 80 : 135) * (this.night - 0.05) / 0.95;
    }
    return index;
  }

  _seat(v, M, rotation) {
    const speed = speedOf(v);
    const place = (h, sx, sy, sz) => {
      if (!h) return;
      // Bank the saddle with the frame. The ride pose adds its height back along world Y.
      const saddleHeight = v.spec.two ? sy : 0;
      _p.set(sx, saddleHeight, sz).applyMatrix4(M);
      h.x = _p.x; h.y = _p.y - saddleHeight; h.z = _p.z;
      h.yaw = v.heading; h.speed = 0;
      h.roll = v.spec.two ? rotation.z : 0;
      h.pitch = v.spec.two ? rotation.x : 0; h.air = false;
      // What anim.js needs to put hands on the bars and sway with the ride.
      h.vType = v.type; h.vDriver = h === v.driver; h.vSteer = v.steer; h.vSpeed = speed; h.vLat = v.latAcc; h.vLong = v.longAcc;
    };
    const s = v.model.seat;
    place(v.driver, s.x, s.y, s.z);
    v.passengers.forEach((h, i) => { const p = v.model.passengers[i]; if (p) place(h, p[0], p[1], p[2]); });
  }
}

const IDLE = { throttle: 0, brake: 0, steer: 0, handbrake: false };
const PARKED = { throttle: 0, brake: 0, steer: 0, handbrake: true };

/** Ground illuminance of a dipped beam. It widens away from the lens, reaches its
 * brightest patch a few metres down the road and falls off toward the cutoff. */
function headlightTexture() {
  const width = 64, height = 128, pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const along = 1 - y / (height - 1);
    const throwWidth = 0.09 + along * 0.88;
    const fade = (1 - Math.exp(-along * 27)) * Math.exp(-along * 2.7)
      * (1 - THREE.MathUtils.smoothstep(along, 0.73, 1));
    for (let x = 0; x < width; x++) {
      const across = Math.abs(2 * x / (width - 1) - 1) / throwWidth;
      const profile = Math.exp(-3.1 * across * across) + 0.24 * Math.exp(-across * across);
      const i = (y * width + x) * 4;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
      pixels[i + 3] = Math.round(Math.min(1, fade * profile) * 255);
    }
  }
  const texture = new THREE.DataTexture(pixels, width, height);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function setAxleMatrix(v) {
  const lean = v.spec.two ? -(v.lean + (v.standLean || 0)) : 0;
  _e.set(-(v.roadPitch || 0) - (v.bumpPitch || 0), v.heading, lean, 'YXZ');
  _axles.compose(_p.set(v.x, v.y, v.z), _q.setFromEuler(_e), _s.set(1, 1, 1));
}

/**
 * A parked vehicle is left in gear with its handbrake on: every wheel drags, so a crash shoves it a few
 * metres instead of sending it gliding down the street. The pedals brake whichever way it rolls (held
 * at a stop, the brake pedal would reverse it).
 */
function parked(v) {
  const f = forwardSpeed(v);
  PARKED.throttle = f < -0.5 ? 1 : 0; PARKED.brake = f > 0.5 ? 1 : 0;
  return PARKED;
}

/**
 * A vehicle's lamps are one instanced part, so its instance colour carries levels instead of a tint:
 * x for the lamps in front (head lamps, indicators), y for the tail lamps, z for the light bar (0: lit
 * like the rest; 1 flashing red, 2 blue). Each lamp's kind is in its geometry (vehicle-models.js).
 */
function lampShader(s) {
  s.vertexShader = s.vertexShader.replace('#include <common>', 'attribute float lamp;\n#include <common>').replace('#include <color_vertex>', `
    vec3 bar = instanceColor.z > 1.5 ? vec3(0.25, 0.45, 2.6) : instanceColor.z > 0.5 ? vec3(2.4, 0.45, 0.25) : instanceColor.xxx;
    vColor = color * (lamp > 1.5 ? bar : lamp > 0.5 ? instanceColor.yyy : instanceColor.xxx);`);
}

/** Half the vehicle's extent along the unit direction (px, pz). */
const span = (v, px, pz) => {
  const s = Math.sin(v.heading), c = Math.cos(v.heading);
  return v.hd * Math.abs(s * px + c * pz) + v.hw * Math.abs(c * px - s * pz);
};

/** The door's sideways offset in the vehicle's frame (+x is its left). */
const doorSide = v => (v.spec.two ? v.hw + 0.5 : v.model.seat.x <= 0 ? -(v.hw + 0.55) : v.hw + 0.55);
/** A point (lx to the left, lz ahead) of the vehicle, in world space. */
function local(v, lx, lz, out) {
  const c = Math.cos(v.heading), s = Math.sin(v.heading);
  out.x = v.x + lx * c + lz * s; out.z = v.z - lx * s + lz * c;
  return out;
}

/**
 * Unit wheel (radius 1, width 1, axle along x): a tyre with rounded shoulders and
 * a five-spoke silver rim on both faces. Instances scale it per vehicle.
 */
function wheelGeometry() {
  const pos = [], norm = [], col = [], indices = [];
  function push(g, hex) {
    const offset = pos.length / 3, p = g.attributes.position, c = _c.setHex(hex);
    pos.push(...p.array); norm.push(...g.attributes.normal.array);
    for (let i = 0; i < p.count; i++) col.push(c.r, c.g, c.b);
    for (const i of g.index.array) indices.push(offset + i);
  }
  const ring = (profile, segments = 20) => new THREE.LatheGeometry(
    profile.map(([radius, x]) => new THREE.Vector2(radius, x)), segments).rotateZ(-Math.PI / 2);
  const tyre = ring([[0.62, -0.46], [0.77, -0.50], [0.93, -0.45], [0.99, -0.32],
    [1, -0.23], [1, 0.23], [0.99, 0.32], [0.93, 0.45], [0.77, 0.5], [0.62, 0.46]]);
  push(tyre, 0x343538);
  for (const side of [1, -1]) {
    const dish = new THREE.CircleGeometry(0.61, 16).rotateY(side * Math.PI / 2).translate(side * 0.27, 0, 0);
    push(dish, 0x50555a);
    const lip = ring([[0.56, 0.36], [0.60, 0.49], [0.66, 0.50], [0.68, 0.45]].reverse());
    if (side < 0) lip.rotateY(Math.PI);
    push(lip, 0xb9bfc1);
    const hub = new THREE.CylinderGeometry(0.16, 0.18, 0.08, 6).rotateZ(Math.PI / 2).translate(side * 0.46, 0, 0);
    push(hub, 0xb5bdc0);
    for (let k = 0; k < 5; k++) {
      const spoke = new THREE.BoxGeometry(0.06, 0.46, 0.12).translate(0, 0.33, 0).rotateX((k / 5) * Math.PI * 2).translate(side * 0.45, 0, 0);
      push(spoke, 0x9ca3a6);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(indices);
  return g;
}
