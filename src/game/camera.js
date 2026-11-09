// Third-person camera: orbit on foot, chase behind vehicles, pull in before walls. With a weapon
// up it comes in over the right shoulder (the crosshair at the screen's centre is where bullets
// go), looks through a sniper's scope from the eye, and kicks up with each shot.
import * as THREE from 'three';
import { clamp, damp, dampAngle, wrapAngle } from '../core/math.js';
import { WATER_Y } from '../world/water.js';

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
    // Weapons (main.js sets this to game.weapons; without it none of this happens): how far into
    // the shoulder aim and the scope the view is, the shoulder offset now, and recoil still to recover.
    this.weapons = undefined;
    this.aimK = 0; this.scopeK = 0; this.shoulder = 0; this.kickBack = 0;
    this._fov = null;
  }

  /** A shot's recoil: the view jumps up by rad and settles back most of the way over a quarter second. */
  kick(rad) {
    if (!(rad > 0)) return;
    this.pitch = clamp(this.pitch - rad, -0.5 - 0.35 * this.aimK, 1.25);
    this.kickBack += rad * 0.6;
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
    if (this.cinematic) {
      // The shot owns the camera: drags and wheel turns during it are dropped, not saved up
      // to swing the view somewhere random the moment it ends.
      input.look.x = input.look.y = 0; input.zoom = 0;
      return this._cinematic(dt);
    }
    const look = input.look, W = this.weapons;
    const aiming = Boolean(W?.aiming) && !subject.vehicle, scoped = aiming && Boolean(W?.scoped);
    const manual = Math.abs(look.x) + Math.abs(look.y) > 1e-5;
    if (manual) this.lastManual = this.time;
    // Down the sights or through a scope a drag turns the view as much less as the view is narrower.
    const sens = aiming ? cam.fov / this.fovBase : 1;
    // Recoil settling back.
    if (this.kickBack > 1e-5) { const r = this.kickBack * (1 - Math.exp(-14 * dt)); this.pitch += r; this.kickBack -= r; }
    this.yaw = wrapAngle(this.yaw + look.x * sens);
    // Aiming, the view goes further up (the camera is in at the shoulder, not out on its orbit).
    this.pitch = clamp(this.pitch - look.y * sens, -0.5 - 0.35 * this.aimK, 1.25);
    look.x = 0; look.y = 0;
    this.aimK = damp(this.aimK, aiming ? 1 : 0, aiming ? 12 : 8, dt);
    this.scopeK = damp(this.scopeK, scoped ? 1 : 0, scoped ? 26 : 16, dt);
    if (this.aimK < 1e-3) this.aimK = 0;
    if (this.scopeK < 1e-3) this.scopeK = 0;
    const aimK = this.aimK;
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
      this.mode = aimK > 0.5 ? (this.scopeK > 0.5 ? 'scope' : 'aim') : 'foot';
      const h = subject.human;
      dist = 4.3 * this.zoom + (1.65 - 4.3 * this.zoom) * aimK;
      tx = h.x; tz = h.z; ty = h.y + 1.55 - 0.12 * aimK;
      // Keyboard and touch players get a gentle follow when they run; mouse-look players steer it
      // themselves, and so does anyone aiming.
      if (!input.pointerLocked && aimK < 0.05 && subject.speed > 2.5 && this.time - this.lastManual > 1.5) {
        this.yaw = dampAngle(this.yaw, subject.heading + Math.PI, 1.2, dt);
      }
      if (subject.sprinting && aimK < 0.5) fov += 4;
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
    // Over the right shoulder while aiming: the target the view turns about moves out to the right,
    // short of any wall there.
    let cx = this.target.x, cy = this.target.y, cz = this.target.z;
    if (aimK > 0 || this.shoulder > 0) {
      const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw), want = 0.52 * aimK;
      const t = want > 0 ? this.colliders.raycast(cx, cy, cz, cx + rx * (want + 0.2), cy, cz + rz * (want + 0.2), 0.05) : 1;
      const s = Math.max(0, Math.min(want, (want + 0.2) * t - 0.2));
      this.shoulder = s < this.shoulder ? s : damp(this.shoulder, s, 10, dt);
      cx += rx * this.shoulder; cz += rz * this.shoulder;
    }
    // Collision: pull in before walls, ease back out.
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const ox = Math.sin(this.yaw) * cp, oy = sp, oz = Math.cos(this.yaw) * cp;
    const t = this.colliders.raycast(cx, cy, cz, cx + ox * dist, cy + oy * dist, cz + oz * dist, 0.3);
    const want = Math.max(aimK > 0.5 ? 0.6 : 0.8, dist * t - 0.25);
    this.curDist = want < this.curDist || aimK > 0 ? Math.min(want, damp(this.curDist, want, aimK > 0 ? 14 : 3, dt)) : damp(this.curDist, want, 3, dt);
    let px = cx + ox * this.curDist, py = cy + oy * this.curDist, pz = cz + oz * this.curDist;
    // Squeezed by walls: rise up and look down over the shoulder instead of into the back of the head.
    const squeeze = clamp(1 - this.curDist / dist, 0, 1);
    py += squeeze * (vehicle ? 1.6 : 1.1 * (1 - aimK)); // (aiming, it stays in at the shoulder)
    // Above the ground, and above the river (its surface is drawn from above only).
    py = Math.max(py, (subject.groundY ?? 0) + 0.4, WATER_Y + 0.3);
    // Shake.
    if (this.shake > 0.001) {
      const s = this.shake * 0.25;
      px += (Math.sin(this.time * 47) + Math.sin(this.time * 31)) * s;
      py += Math.sin(this.time * 53) * s;
      pz += (Math.cos(this.time * 41) + Math.sin(this.time * 23)) * s;
      this.shake = damp(this.shake, 0, 6, dt);
    }
    this.lookAt.set(cx, cy + (vehicle ? 0.2 : 0.05), cz);
    // Through a scope: from just in front of the eye (the body falls behind the near plane, and
    // weapon-fx.js hides the gun), straight along the view.
    const sk = vehicle ? 0 : this.scopeK;
    if (sk > 0) {
      const h = subject.human, fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      const ex = h.x + fx * 0.32, ey = h.y + 1.6 * (h.outfit?.scale || 1), ez = h.z + fz * 0.32;
      const lx = ex + fx * cp * 10, ly = ey - sp * 10, lz = ez + fz * cp * 10;
      px += (ex - px) * sk; py += (ey - py) * sk; pz += (ez - pz) * sk;
      this.lookAt.set(this.lookAt.x + (lx - this.lookAt.x) * sk, this.lookAt.y + (ly - this.lookAt.y) * sk, this.lookAt.z + (lz - this.lookAt.z) * sk);
    }
    cam.position.set(px, py, pz);
    cam.lookAt(this.lookAt);
    // The view narrows down the sights (48°) and to the scope's zoom (62° at 1x); the plain view
    // eases (4/s) as it always has, the aim and the scope ride their own quick blends.
    this._fov = damp(this._fov ?? cam.fov, fov, 4, dt);
    const zoomX = Math.max(1, W?.def?.scope || 1);
    let f = this._fov + (48 - this._fov) * aimK;
    if (sk > 0) f += (this.fovBase / zoomX - f) * sk;
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
