// Every vehicle in the city: physics bodies, instanced rendering, drivers and riders.
import * as THREE from 'three';
import { VEHICLE_TYPES, TYPE_KEYS } from './vehicle-types.js';
import { vehicleModel } from './vehicle-models.js';
import { createBody, stepBody, collideStatic, collidePair, speedOf } from './vehicle-physics.js';
import { makeOutfit } from './humans.js';
import { radialTexture } from '../world/citymat.js';
import { clamp, rng } from '../core/math.js';

const CAPACITY = { hatch: 40, sedan: 30, suv: 20, police: 14, auto: 40, bike: 50, scooter: 40, bus: 8, truck: 10, tractor: 6, tempo: 12, ambulance: 4 };
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
    const lambert = new THREE.MeshLambertMaterial({ flatShading: true });
    const vcol = new THREE.MeshLambertMaterial({ flatShading: true, vertexColors: true });
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
      this.meshes[type] = { paint: mk(model.geos.paint, lambert), fixed: mk(model.geos.fixed, vcol), lights: mk(model.geos.lights, lit), n: 0, model, cap };
      this.meshes[type].lights.castShadow = false;
    }
    const wheelGeo = new THREE.CylinderGeometry(1, 1, 1, 12).rotateZ(Math.PI / 2);
    const hub = new THREE.CylinderGeometry(0.55, 0.55, 1.02, 6).rotateZ(Math.PI / 2);
    const wg = new THREE.BufferGeometry();
    const flat = g2 => (g2.index ? g2.toNonIndexed() : g2).attributes.position;
    const merged = [...flat(wheelGeo).array, ...flat(hub).array];
    wg.setAttribute('position', new THREE.Float32BufferAttribute(merged, 3));
    const cols = []; const nt = flat(wheelGeo).count;
    for (let i = 0; i < merged.length / 3; i++) { const c = i < nt ? 0.09 : 0.62; cols.push(c, c, c * 1.02); }
    wg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    this.wheels = new THREE.InstancedMesh(wg, vcol, 900);
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
        const hit = collideStatic(v, this.colliders, this._contact);
        if (hit > 4) this._impact(v, hit, null);
        // Water: the riverbank is a hard edge for anything with wheels.
        const rd = this.city.riverDistance(v.x, v.z, this._rd || (this._rd = {}));
        if (rd.d < -1.5) v.sinking = (v.sinking || 0) + h; else v.sinking = 0;
      }
    }
    // Vehicle-vehicle (only pairs involving a dynamic body).
    const dyn = this.list.filter(v => !v.kinematic);
    for (const a of dyn) {
      for (const b of this.list) {
        if (a === b || (!b.kinematic && b.id < a.id)) continue;
        const dx = a.x - b.x, dz = a.z - b.z, rr = a.hd + b.hd + 0.5;
        if (dx * dx + dz * dz > rr * rr) continue;
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
  render(dt, cam) {
    this.time += dt;
    for (const t of TYPE_KEYS) this.meshes[t].n = 0;
    let wn = 0, bn = 0, hn = 0;
    const night = this.night;
    const maxD2 = this.drawDistance * this.drawDistance;
    for (const v of this.list) {
      const dx = v.x - cam.x, dz = v.z - cam.z;
      const near = dx * dx + dz * dz < maxD2;
      const M = this.meshes[v.type];
      // Body transform with suspension pitch/roll and two-wheeler lean.
      const lean = v.spec.two ? -v.lean : v.roll;
      _e.set(v.pitch, v.heading, lean, 'YXZ');
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
      M.paint.setMatrixAt(i, _m); M.fixed.setMatrixAt(i, _m); M.lights.setMatrixAt(i, _m);
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
        _p.set(v.x, v.y + 0.03, v.z); _s.set(v.spec.W * 1.5, 1, v.spec.L * 1.25);
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
    for (const t of TYPE_KEYS) {
      const M = this.meshes[t];
      for (const k of ['paint', 'fixed', 'lights']) {
        M[k].count = M.n;
        M[k].instanceMatrix.needsUpdate = true;
        if (M[k].instanceColor) M[k].instanceColor.needsUpdate = true;
        M[k].visible = M.n > 0;
      }
    }
    this.wheels.count = wn; this.wheels.instanceMatrix.needsUpdate = true;
    this.blobs.count = bn; this.blobs.instanceMatrix.needsUpdate = true;
    this.beams.count = hn; this.beams.instanceMatrix.needsUpdate = true;
    this.beams.material.opacity = clamp(night * 0.55, 0, 0.55);
    this.beams.visible = hn > 0 && night > 0.05;
  }

  _seat(v, M) {
    const place = (h, sx, sy, sz) => {
      if (!h) return;
      _p.set(sx, 0, sz).applyMatrix4(M);
      h.x = _p.x; h.y = _p.y - sy * 0 + (v.spec.two ? 0 : 0); h.z = _p.z;
      h.yaw = v.heading; h.speed = 0;
      h.roll = v.spec.two ? -v.lean : 0;
      h.pitch = 0;
    };
    const s = v.model.seat;
    place(v.driver, s.x, s.y, s.z);
    v.passengers.forEach((h, i) => { const p = v.model.passengers[i]; if (p) place(h, p[0], p[1], p[2]); });
  }
}

const IDLE = { throttle: 0, brake: 0, steer: 0, handbrake: false };
