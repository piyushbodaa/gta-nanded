// Every vehicle in the city: physics bodies, instanced rendering, drivers and riders.
import * as THREE from 'three';
import { VEHICLE_TYPES, TYPE_KEYS } from './vehicle-types.js';
import { vehicleModel } from './vehicle-models.js';
import { createBody, stepBody, collideStatic, collidePair, speedOf } from './vehicle-physics.js';
import { makeOutfit, inShadowBox } from './humans.js';
import { radialTexture } from '../world/citymat.js';
import { WATER_Y } from '../world/water.js';
import { clamp, rng } from '../core/math.js';
import { sendFirst } from '../core/buffers.js';

const CAPACITY = { hatch: 40, sedan: 30, suv: 20, police: 14, auto: 48, bike: 50, scooter: 40, bus: 16, truck: 10, tractor: 6, tempo: 12, ambulance: 4 };
const _m = new THREE.Matrix4(), _w = new THREE.Matrix4(), _t = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const WRECK = 0x2a2624;

let nextId = 1;

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
    const glass = new THREE.MeshStandardMaterial({ color: 0x0e1418, roughness: 0.04, metalness: 0.3 });
    const lit = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
    for (const type of TYPE_KEYS) {
      const model = vehicleModel(type);
      const cap = CAPACITY[type] || 10;
      const mk = (geo, mat) => {
        const m = new THREE.InstancedMesh(geo, mat, cap);
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.setColorAt(0, _c.set(0xffffff));
        m.count = 0; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
        scene.add(m);
        return m;
      };
      const M = (this.meshes[type] = { paint: mk(model.geos.paint, lambert), glass: mk(model.geos.glass, glass), fixed: mk(model.geos.fixed, vcol), lights: mk(model.geos.lights, lit), n: 0, nShadow: 0, model, cap });
      M.lights.castShadow = false;
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
    this.beams = new THREE.InstancedMesh(plane, new THREE.MeshBasicMaterial({ map: tex, color: 0xfff1c8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }), 300);
    this.beams.count = 0; this.beams.frustumCulled = false; this.beams.renderOrder = 2;
    this.beams.material.polygonOffset = true; this.beams.material.polygonOffsetFactor = -2; this.beams.material.polygonOffsetUnits = -4;
    scene.add(this.beams);
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
    if (v.driver) this.humans.remove(v.driver);
    for (const p of v.passengers) this.humans.remove(p);
    v.driver = null; v.passengers = [];
  }

  /** Seat position of the driver in world space. */
  seatWorld(v, out = {}) {
    const s = v.model.seat, c = Math.cos(v.heading), sn = Math.sin(v.heading);
    out.x = v.x + s.x * c + s.z * sn; out.z = v.z - s.x * sn + s.z * c;
    return out;
  }
  /** Door position (driver's side, right-hand drive) where people get in and out. */
  doorWorld(v, out = {}) {
    const s = v.model.seat, c = Math.cos(v.heading), sn = Math.sin(v.heading);
    const side = v.spec.two ? -(v.hw + 0.5) : s.x <= 0 ? -(v.hw + 0.55) : v.hw + 0.55;
    out.x = v.x + side * c + s.z * sn; out.z = v.z - side * sn + s.z * c;
    return out;
  }

  /** Physics for every non-kinematic body, then collisions. */
  step(dt, controls) {
    const sub = 2, h = dt / sub;
    for (let k = 0; k < sub; k++) {
      for (const v of this.list) {
        if (v.kinematic) continue;
        const ctl = controls.get(v) || IDLE;
        stepBody(v, ctl, h, v.role === 'player' ? 1 : 1.3);
        // Up a flyover's ramp and along its deck, on the street beneath it or down a riverbank; over a speed
        // breaker the body rises with the hump, and taken fast it leaves the road for a moment.
        v.y = this.city.net.surfaceAt(v.x, v.z, v.y - (v.hop || 0));
        this._ride(v, h);
        v.y += v.hop;
        const hit = collideStatic(v, this.colliders, this._contact);
        if (hit > 4) this._impact(v, hit, null);
        // Water: down the bank and into the channel, a body sinks. A bridge deck stands clear of it.
        const rd = this.city.riverDistance(v.x, v.z, this._rd || (this._rd = {}));
        if (rd.d < -1.5 && v.y < WATER_Y) v.sinking = (v.sinking || 0) + h; else v.sinking = 0;
      }
    }
    // Vehicle-vehicle (only pairs involving a dynamic body).
    const dyn = this.list.filter(v => !v.kinematic);
    for (const a of dyn) {
      for (const b of this.list) {
        if (a === b || (!b.kinematic && b.id < a.id)) continue;
        const dx = a.x - b.x, dz = a.z - b.z, rr = a.hd + b.hd + 0.5;
        if (dx * dx + dz * dz > rr * rr || Math.abs(a.y - b.y) > 2) continue; // on a flyover and under it
        const was = b.kinematic;
        if (was) { b.vx = b.kinematic ? (b.vx || 0) : b.vx; }
        const imp = collidePair(a, b);
        if (imp > 1.5) {
          this._impact(a, imp, b);
          this._impact(b, imp, a);
          if (b.kinematic && b.role !== 'parked-static') this.wake(b);
        }
      }
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
    const base = (hf + hr) / 2;
    v.hopV = (v.hopV || 0) - 9.81 * h;
    v.hop = (v.hop || 0) + v.hopV * h;
    if (v.hop <= base) {
      if (v.air && v.hopV < -1.6) this.onBump?.(v, -v.hopV);
      const rise = (base - (v.base ?? base)) / h;
      v.hop = base; v.hopV = Math.max(v.hopV, rise * 1.2); v.air = false;
      v.bumpPitch = Math.atan2(hf - hr, 2 * half);
    } else {
      if (v.hop > base + 0.03) v.air = true; // off the road (until it lands)
      v.bumpPitch = (v.bumpPitch || 0) * (1 - Math.min(1, h * 3));
    }
    v.base = base;
    // Potholes under the front wheels (the rear ones follow the same line).
    const speed = speedOf(v), tw = v.spec.two ? 0 : v.hw * 0.78;
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
    const dmg = Math.max(0, speed - 3) * (v.spec.mass > 5000 ? 2 : 9) * (other && other.mass > v.mass * 3 ? 1.6 : 1);
    v.health = Math.max(0, v.health - dmg);
    v.lastHit = this.time;
    v.lastImpact = Math.max(v.lastImpact || 0, speed);
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
    const maxD2 = this.drawDistance * this.drawDistance;
    // Vehicles inside the sun's shadow map first: the shadow pass draws only those.
    for (let pass = 0; pass < 2; pass++) {
      if (pass === 1) { for (const t of TYPE_KEYS) this.meshes[t].nShadow = this.meshes[t].n; this.wheelsShadow = wn; }
      for (const v of this.list) {
        const dx = v.x - cam.x, dz = v.z - cam.z;
        if ((pass === 0) !== inShadowBox(shadowBox, v.x, v.y, v.z, 8)) continue;
        const near = dx * dx + dz * dz < maxD2;
        const M = this.meshes[v.type];
        // Body transform with suspension pitch/roll and two-wheeler lean. A two-wheeler stopped with
        // a rider tips onto the rider's left foot.
        if (v.spec.two) v.standLean = (v.standLean || 0) + ((v.driver && speedOf(v) < 0.8 ? 0.09 : 0) - (v.standLean || 0)) * Math.min(1, dt * 4);
        const lean = v.spec.two ? -(v.lean + v.standLean) : v.roll;
        _e.set(v.pitch - (v.bumpPitch || 0), v.heading, lean, 'YXZ');
        _q.setFromEuler(_e);
        const bob = v.kinematic ? 0 : Math.sin(this.time * 18 + v.id) * 0.006 * Math.min(1, speedOf(v) / 8);
        const sink = v.sinking ? Math.min(2.5, v.sinking * 0.8) : 0;
        _p.set(v.x, v.y + bob - sink, v.z);
        _s.set(1, 1, 1);
        _m.compose(_p, _q, _s);
        // Seat people even when the body is far (they're culled by their own distance check).
        this._seat(v, _m);
        if (!near || !v.visible || M.n >= M.cap) continue;
        const i = M.n++;
        M.paint.setMatrixAt(i, _m); M.glass.setMatrixAt(i, _m); M.fixed.setMatrixAt(i, _m); M.lights.setMatrixAt(i, _m);
        M.paint.setColorAt(i, _c.setHex(v.wrecked ? WRECK : v.color));
        M.fixed.setColorAt(i, v.wrecked ? _c.setHex(0x444444) : _c.setHex(0xffffff));
        // Lamps: brighter at night and when braking; light bars flash.
        let lamp = 0.55 + night * 0.9 + (v.braking ? 0.5 : 0);
        if (v.wrecked) lamp = 0.15;
        if (v.sirenOn) {
          const ph = Math.floor(this.time * 7 + v.id) % 2;
          _c.setRGB(ph ? 2.4 : 0.25, 0.45, ph ? 0.25 : 2.6);
        } else _c.setRGB(lamp, lamp, lamp);
        M.lights.setColorAt(i, _c);
        // Wheels.
        const model = v.model;
        for (const [wx, wz, r, front, width] of model.wheels) {
          if (wn >= this.wheels.instanceMatrix.count) break;
          _e.set(v.wheelSpin || 0, front ? v.steer : 0, 0, 'YXZ');
          _q.setFromEuler(_e);
          _p.set(wx, r, wz);
          _s.set(width, r, r);
          _t.compose(_p, _q, _s);
          _w.multiplyMatrices(_m, _t);
          this.wheels.setMatrixAt(wn++, _w);
        }
        // Contact shadow.
        if (bn < this.blobs.instanceMatrix.count) {
          _e.set(0, v.heading, 0); _q.setFromEuler(_e);
          _p.set(v.x, v.y + 0.09, v.z); _s.set(v.spec.W * 1.5, 1, v.spec.L * 1.25); // above the road surface (6-7 cm)
          _t.compose(_p, _q, _s);
          this.blobs.setMatrixAt(bn++, _t);
        }
        // Headlight pool ahead at night.
        if (night > 0.05 && !v.wrecked && hn < this.beams.instanceMatrix.count) {
          const ahead = v.hd + 5;
          _e.set(0, v.heading, 0); _q.setFromEuler(_e);
          _p.set(v.x + Math.sin(v.heading) * ahead, v.y + 0.09, v.z + Math.cos(v.heading) * ahead);
          _s.set(v.spec.two ? 4 : 7, 1, 11);
          _t.compose(_p, _q, _s);
          this.beams.setMatrixAt(hn++, _t);
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
    // Nothing to draw: skip the draw call (WebGL warns about every empty instanced draw).
    this.wheels.visible = wn > 0; this.blobs.visible = bn > 0; this.beams.visible = hn > 0;
    this.beams.material.opacity = clamp(night * 0.55, 0, 0.55);
    this.beams.visible = hn > 0 && night > 0.05;
  }

  _seat(v, M) {
    const speed = speedOf(v);
    const place = (h, sx, sy, sz) => {
      if (!h) return;
      _p.set(sx, 0, sz).applyMatrix4(M);
      h.x = _p.x; h.y = _p.y; h.z = _p.z;
      h.yaw = v.heading; h.speed = 0;
      h.roll = v.spec.two ? -(v.lean + (v.standLean || 0)) : 0;
      h.pitch = 0; h.air = false;
      // What anim.js needs to put hands on the bars and sway with the ride.
      h.vType = v.type; h.vDriver = h === v.driver; h.vSteer = v.steer; h.vSpeed = speed; h.vLat = v.latAcc; h.vLong = v.longAcc;
    };
    const s = v.model.seat;
    place(v.driver, s.x, s.y, s.z);
    v.passengers.forEach((h, i) => { const p = v.model.passengers[i]; if (p) place(h, p[0], p[1], p[2]); });
  }
}

const IDLE = { throttle: 0, brake: 0, steer: 0, handbrake: false };

/**
 * Unit wheel (radius 1, width 1, axle along x): a tyre with rounded shoulders and
 * a five-spoke silver rim on both faces. Instances scale it per vehicle.
 */
function wheelGeometry() {
  const pos = [], col = [];
  const push = (g, c) => { const p = (g.index ? g.toNonIndexed() : g).attributes.position.array; pos.push(...p); for (let i = 0; i < p.length / 3; i++) col.push(c[0], c[1], c[2]); };
  const tyre = new THREE.LatheGeometry([[0.6, -0.5], [0.9, -0.5], [1, -0.3], [1, 0.3], [0.9, 0.5], [0.6, 0.5]].map(([r, y]) => new THREE.Vector2(r, y)), 14);
  tyre.rotateZ(Math.PI / 2);
  push(tyre, [0.05, 0.05, 0.055]);
  for (const side of [1, -1]) {
    const dish = new THREE.CylinderGeometry(0.62, 0.62, 0.04, 12, 1, true).rotateZ(Math.PI / 2).translate(side * 0.42, 0, 0);
    const face = new THREE.CircleGeometry(0.62, 12).rotateY(side * Math.PI / 2).translate(side * 0.4, 0, 0);
    push(face, [0.16, 0.16, 0.17]);
    push(dish, [0.2, 0.2, 0.21]);
    const hub = new THREE.CylinderGeometry(0.16, 0.18, 0.08, 6).rotateZ(Math.PI / 2).translate(side * 0.46, 0, 0);
    push(hub, [0.75, 0.76, 0.78]);
    for (let k = 0; k < 5; k++) {
      const spoke = new THREE.BoxGeometry(0.06, 0.46, 0.12).translate(0, 0.33, 0).rotateX((k / 5) * Math.PI * 2).translate(side * 0.45, 0, 0);
      push(spoke, [0.7, 0.71, 0.73]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
