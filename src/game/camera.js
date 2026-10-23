// Third-person camera: orbit on foot, chase behind vehicles, pull in before walls.
import * as THREE from 'three';
import { clamp, damp, dampAngle, wrapAngle } from '../core/math.js';

const DIST = { hatch: 6.4, sedan: 6.8, suv: 7.4, police: 7.4, auto: 5.6, bike: 4.6, scooter: 4.4, bus: 13, truck: 11.5, tractor: 7, tempo: 7.6, ambulance: 8 };
const HEIGHT = { hatch: 1.6, sedan: 1.6, suv: 2.0, police: 2.0, auto: 1.8, bike: 1.5, scooter: 1.5, bus: 3.2, truck: 3.2, tractor: 2.2, tempo: 2.0, ambulance: 2.2 };

export class GameCamera {
  constructor(camera, colliders) {
    this.camera = camera;
    this.colliders = colliders;
    this.yaw = Math.PI; // orbit angle around the target; heading + PI sits behind
    this.pitch = 0.22;
    this.dist = 4.4;
    this.curDist = 4.4;
    this.target = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();
    this.shake = 0;
    this.fovBase = 62;
    this.cinematic = null;
    this.lastManual = -10;
    this.time = 0;
    this.mode = 'foot';
    this.zoom = 1;
  }

  /** Next camera distance: normal, far, close (the camera button). */
  cycleView() {
    const views = [1, 1.35, 0.8];
    const i = views.findIndex(z => Math.abs(z - this.zoom) < 0.01);
    this.zoom = views[(i + 1) % views.length];
  }

  /** Snap behind a heading (spawns, teleports, mission starts). */
  reset(heading, pitch = 0.22) { this.yaw = heading + Math.PI; this.pitch = pitch; this._snap = true; }
  addShake(v) { this.shake = Math.min(1.2, this.shake + v); }

  /** Facing direction (the way "forward" input moves on foot). */
  get facing() { return this.yaw + Math.PI; }

  update(dt, input, subject) {
    this.time += dt;
    const cam = this.camera;
    if (this.cinematic) return this._cinematic(dt);
    const look = input.look;
    const manual = Math.abs(look.x) + Math.abs(look.y) > 1e-5;
    if (manual) this.lastManual = this.time;
    this.yaw = wrapAngle(this.yaw + look.x);
    this.pitch = clamp(this.pitch - look.y, -0.5, 1.25);
    look.x = 0; look.y = 0;
    if (input.zoom) { this.zoom = clamp(this.zoom + input.zoom * 0.08, 0.7, 1.6); input.zoom = 0; }

    const vehicle = subject.vehicle;
    let tx, ty, tz, dist, fov = this.fovBase;
    if (vehicle) {
      this.mode = 'vehicle';
      const type = vehicle.type;
      const spd = Math.hypot(vehicle.vx, vehicle.vz);
      dist = (DIST[type] || 6.5) * this.zoom + Math.min(spd * 0.04, 1.6);
      tx = vehicle.x; tz = vehicle.z; ty = vehicle.y + (HEIGHT[type] || 1.7);
      // Swing back behind the car after a moment without manual look; follow the slide direction a little.
      const idle = this.time - this.lastManual > (input.pointerLocked ? 2.2 : 1.2);
      if (idle || spd > 12) {
        let want = vehicle.heading;
        if (spd > 3) {
          const velDir = Math.atan2(vehicle.vx, vehicle.vz);
          const fwd = vehicle.vx * Math.sin(vehicle.heading) + vehicle.vz * Math.cos(vehicle.heading);
          if (fwd > 0) want = vehicle.heading + wrapAngle(velDir - vehicle.heading) * 0.55;
          else if (fwd < -2) want = vehicle.heading; // reversing: keep looking forward
        }
        if (input.state.lookBack) want += Math.PI;
        const rate = idle ? 3.2 : 1.2;
        this.yaw = dampAngle(this.yaw, want + Math.PI, rate, dt);
        this.pitch = damp(this.pitch, 0.18, idle ? 2 : 0.6, dt);
      }
      fov += clamp((spd - 10) / 30, 0, 1) * 12;
    } else {
      this.mode = 'foot';
      const h = subject.human;
      dist = 4.3 * this.zoom;
      tx = h.x; tz = h.z; ty = h.y + 1.55;
      // Keyboard and touch players get a gentle follow when they run; mouse-look players steer it themselves.
      if (!input.pointerLocked && subject.speed > 2.5 && this.time - this.lastManual > 1.5) {
        this.yaw = dampAngle(this.yaw, subject.heading + Math.PI, 1.2, dt);
      }
      if (subject.sprinting) fov += 4;
    }
    if (this._snap) {
      this.target.set(tx, ty, tz);
      this.curDist = dist;
      this._snap = false;
    } else {
      // Track the subject tightly; vertical a little softer.
      this.target.x = damp(this.target.x, tx, 18, dt);
      this.target.z = damp(this.target.z, tz, 18, dt);
      this.target.y = damp(this.target.y, ty, 10, dt);
    }
    // Collision: pull in before walls, ease back out.
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const ox = Math.sin(this.yaw) * cp, oy = sp, oz = Math.cos(this.yaw) * cp;
    const t = this.colliders.raycast(this.target.x, this.target.y, this.target.z, this.target.x + ox * dist, this.target.y + oy * dist, this.target.z + oz * dist, 0.3);
    const want = Math.max(0.8, dist * t - 0.25);
    this.curDist = want < this.curDist ? want : damp(this.curDist, want, 3, dt);
    let px = this.target.x + ox * this.curDist, py = this.target.y + oy * this.curDist, pz = this.target.z + oz * this.curDist;
    // Squeezed by walls: rise up and look down over the shoulder instead of into the back of the head.
    const squeeze = clamp(1 - this.curDist / dist, 0, 1);
    py += squeeze * (vehicle ? 1.6 : 1.1);
    py = Math.max(py, (subject.groundY ?? 0) + 0.4);
    // Shake.
    if (this.shake > 0.001) {
      const s = this.shake * 0.25;
      px += (Math.sin(this.time * 47) + Math.sin(this.time * 31)) * s;
      py += Math.sin(this.time * 53) * s;
      pz += (Math.cos(this.time * 41) + Math.sin(this.time * 23)) * s;
      this.shake = damp(this.shake, 0, 6, dt);
    }
    cam.position.set(px, py, pz);
    this.lookAt.set(this.target.x, this.target.y + (vehicle ? 0.2 : 0.05), this.target.z);
    cam.lookAt(this.lookAt);
    const f = damp(cam.fov, fov, 4, dt);
    if (Math.abs(f - cam.fov) > 0.01) { cam.fov = f; cam.updateProjectionMatrix(); }
  }

  /** Scripted shot: { from: Vector3, to: Vector3, look: Vector3, duration, t } */
  playShot(shot) { this.cinematic = { ...shot, t: 0 }; }
  endShot(heading) { this.cinematic = null; if (heading !== undefined) this.reset(heading); this._snap = true; }
  _cinematic(dt) {
    const c = this.cinematic;
    c.t += dt;
    const k = clamp(c.t / (c.duration || 3), 0, 1), e = k * k * (3 - 2 * k);
    this.camera.position.lerpVectors(c.from, c.to || c.from, e);
    this.camera.lookAt(c.look);
  }
}
