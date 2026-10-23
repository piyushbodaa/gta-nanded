// The player: on-foot movement and combat, getting in and out of anything with
// wheels (politely or not), and driving it.
import { clamp, damp, dampAngle, wrapAngle, dist } from '../core/math.js';
import { makeOutfit } from './humans.js';
import { speedOf, forwardSpeed } from './vehicle-physics.js';

const WALK = 1.9, JOG = 4.4, SPRINT = 7.4;

export class Player {
  constructor(game, x, z, heading) {
    this.game = game;
    this.human = game.humans.add(makeOutfit('player', 7), x, z);
    this.x = x; this.z = z; this.y = 0; this.heading = heading;
    this.vx = 0; this.vz = 0; this.vy = 0; this.onGround = true;
    this.speed = 0; this.sprinting = false; this.stamina = 1;
    this.health = 100; this.maxHealth = 100;
    this.state = 'foot'; // foot | entering | driving | exiting | down | dead
    this.vehicle = null; this.enterTarget = null; this.stateT = 0;
    this.punchT = 0; this.punchCooldown = 0; this.combo = 0;
    this.groundY = 0;
    this.downT = 0;
    this.invuln = 0;
    this.human.yaw = heading;
  }

  get pos() { return this.vehicle ? this.vehicle : this; }

  teleport(x, z, heading) {
    if (this.vehicle) this.leaveVehicle(true);
    this.x = x; this.z = z; this.heading = heading; this.vx = this.vz = 0;
    this.y = this.groundY = this.game.city.groundHeight(x, z);
    this.state = 'foot';
    this.human.visible = true; this.human.pose = 'idle'; this.human.pitch = 0; this.human.roll = 0;
    this.game.camera.reset(heading);
  }

  damage(amount, source) {
    if (this.invuln > 0 || this.state === 'dead') return;
    this.health = Math.max(0, this.health - amount);
    this.game.onPlayerDamage?.(amount, source);
    if (this.health <= 0) this.game.wasted?.(source);
  }

  heal(amount) { this.health = Math.min(this.maxHealth, this.health + amount); }

  /** The top of the footpath we are on, if we are on one (0 on the road). */
  _pavement(g) {
    this._onGround ||= r => !g.net.raised[r];
    const n = g.net.nearest(this.x, this.z, 14, this._near || (this._near = {}), this._onGround);
    return n ? g.city.pavementAt(n.seg, n.dist) : 0;
  }

  update(dt, input) {
    const g = this.game;
    this.invuln = Math.max(0, this.invuln - dt);
    this.punchCooldown = Math.max(0, this.punchCooldown - dt);
    if (this.state === 'dead') return;
    if (this.state === 'driving') return this._drive(dt, input);
    if (this.state === 'entering') return this._entering(dt);
    if (this.state === 'down') return this._down(dt);
    this._foot(dt, input);
  }

  // ---------------------------------------------------------------- on foot
  _foot(dt, input) {
    const g = this.game, s = input.state, h = this.human;
    // Movement relative to the camera.
    const face = g.camera.facing;
    const fx = Math.sin(face), fz = Math.cos(face), rx = -Math.cos(face), rz = Math.sin(face);
    let mx = s.moveX, my = s.moveY;
    const mag = Math.min(1, Math.hypot(mx, my));
    let dirX = fx * my + rx * mx, dirZ = fz * my + rz * mx;
    const dl = Math.hypot(dirX, dirZ);
    if (dl > 1e-4) { dirX /= dl; dirZ /= dl; }
    this.sprinting = s.sprint && mag > 0.3 && this.stamina > 0.05;
    const target = mag < 0.05 ? 0 : (this.sprinting ? SPRINT : mag < 0.55 && input.mode !== 'keyboard' ? WALK : JOG) * (g.energy > 0 ? 1.15 : 1);
    this.stamina = clamp(this.stamina + (this.sprinting ? -0.16 : 0.12) * dt, 0, 1);
    const accel = this.onGround ? 14 : 3;
    const tvx = dirX * target, tvz = dirZ * target;
    this.vx += clamp(tvx - this.vx, -accel * dt, accel * dt);
    this.vz += clamp(tvz - this.vz, -accel * dt, accel * dt);
    if (mag > 0.05 && this.punchT <= 0) this.heading = dampAngle(this.heading, Math.atan2(dirX, dirZ), 14, dt);
    // Jump.
    if (input.pressed('jump') && this.onGround) { this.vy = 4.6; this.onGround = false; g.audio?.sfx('jump'); }
    this.vy -= 15 * dt;
    this.x += this.vx * dt; this.z += this.vz * dt; this.y += this.vy * dt;
    // The ground, or a flyover deck if that is where we are walking.
    const gy = Math.max(g.city.groundHeight(this.x, this.z), g.net.surfaceAt(this.x, this.z, this.groundY ?? 0), this._pavement(g));
    this.groundY = gy;
    if (this.y <= gy) { if (!this.onGround && this.vy < -9) this.damage((-this.vy - 9) * 6, 'fall'); this.y = gy; this.vy = 0; this.onGround = true; }
    // Collide: buildings and props, then vehicles, then keep out of deep water.
    const p = this._p || (this._p = { x: 0, z: 0 }), o = this._o || (this._o = {});
    p.x = this.x; p.z = this.z;
    if (g.colliders.resolveCircle(p, 0.34, o, Infinity, this.groundY)) {
      // Slide along the wall: remove the into-wall velocity.
      const vn = this.vx * o.nx + this.vz * o.nz;
      if (vn < 0) { this.vx -= vn * o.nx; this.vz -= vn * o.nz; }
      this.x = p.x; this.z = p.z;
    }
    g.pushOutOfVehicles(this, 0.34);
    const rd = g.city.riverDistance(this.x, this.z, this._rd || (this._rd = {}));
    if (rd.d < -1) { // wade no further than the ghat steps
      const back = 0.8 * dt * 10;
      this.x -= this.vx * dt * 1.05; this.z -= this.vz * dt * 1.05; this.vx *= 0.3; this.vz *= 0.3;
      void back;
    }
    this.speed = Math.hypot(this.vx, this.vz);
    // Punch.
    if (this.punchT > 0) this.punchT -= dt;
    if (input.pressed('attack') && this.punchCooldown <= 0) {
      this.punchT = 0.32; this.punchCooldown = 0.38; this.combo = (this.combo + 1) % 3;
      g.playerPunch?.(this);
    }
    // Enter / carjack.
    if (input.pressed('enter')) {
      const v = g.nearestEnterable(this.x, this.z, 4.2);
      if (v) this._beginEnter(v);
    }
    // Animate.
    h.x = this.x; h.y = this.y; h.z = this.z; h.yaw = this.heading;
    h.speed = this.speed;
    h.pose = !this.onGround ? 'run' : this.speed > 0.3 ? (this.speed > 3.2 ? 'run' : 'walk') : 'idle';
    h.punch = this.punchT > 0 ? 1 - this.punchT / 0.32 : 0;
    h.t += dt;
  }

  _beginEnter(v) {
    this.state = 'entering';
    this.enterTarget = v;
    this.stateT = 0;
    this.vx = this.vz = 0;
    const door = this.game.vehicles.doorWorld(v);
    this.enterFrom = { x: this.x, z: this.z, door };
    this.game.onBeginEnter?.(v);
  }

  _entering(dt) {
    const g = this.game, v = this.enterTarget, h = this.human;
    this.stateT += dt;
    const door = g.vehicles.doorWorld(v);
    const d = dist(this.x, this.z, door.x, door.z);
    if (d > 0.35 && this.stateT < 1.6) {
      // Walk (briskly) to the door.
      const sp = 5;
      const ux = (door.x - this.x) / d, uz = (door.z - this.z) / d;
      this.x += ux * Math.min(d, sp * dt); this.z += uz * Math.min(d, sp * dt);
      this.heading = Math.atan2(ux, uz);
      h.x = this.x; h.z = this.z; h.yaw = this.heading; h.speed = sp; h.pose = 'run';
      return;
    }
    // At the door: pull out whoever is driving, then get in.
    if (v.driver && v.driver !== h) g.carjack(v, this);
    this.enterVehicle(v);
  }

  enterVehicle(v) {
    const g = this.game;
    this.state = 'driving';
    this.vehicle = v;
    v.role = 'player';
    v.kinematic = false;
    v.ai = null;
    v.sirenOn = false;
    if (v.driver && v.driver !== this.human) g.humans.remove(v.driver);
    v.driver = this.human;
    this.human.pose = v.model.seat.pose;
    this.human.seatY = v.model.seat.y;
    this.human.punch = 0;
    g.onEnteredVehicle?.(v);
  }

  /** Get out; `instant` skips the walk (teleports, respawns). */
  leaveVehicle(instant = false) {
    const g = this.game, v = this.vehicle;
    if (!v) return;
    const spd = speedOf(v);
    const door = g.vehicles.doorWorld(v);
    v.driver = null;
    v.role = 'abandoned';
    this.vehicle = null;
    this.x = door.x; this.z = door.z; this.y = Math.max(g.city.groundHeight(door.x, door.z), g.net.surfaceAt(door.x, door.z, v.y));
    this.groundY = this.y;
    this.heading = v.heading;
    this.human.pose = 'idle'; this.human.pitch = 0; this.human.roll = 0;
    this.state = 'foot';
    if (!instant && spd > 7) {
      // Bail out of a moving car: roll on the tarmac, the car rolls on without you.
      this.state = 'down'; this.downT = 1.1;
      this.vx = v.vx * 0.5; this.vz = v.vz * 0.5;
      this.damage(Math.min(30, spd * 0.9), 'bail');
    }
    // Keep moving if we jumped out of a moving car; otherwise stand still.
    if (this.state === 'foot') { this.vx = 0; this.vz = 0; }
    g.onExitedVehicle?.(v, spd);
  }

  _down(dt) {
    const h = this.human;
    this.downT -= dt;
    this.x += this.vx * dt; this.z += this.vz * dt;
    this.vx = damp(this.vx, 0, 3, dt); this.vz = damp(this.vz, 0, 3, dt);
    const p = this._p || (this._p = { x: 0, z: 0 }), o = this._o || (this._o = {});
    p.x = this.x; p.z = this.z;
    if (this.game.colliders.resolveCircle(p, 0.34, o)) { this.x = p.x; this.z = p.z; this.vx *= -0.2; this.vz *= -0.2; }
    h.x = this.x; h.z = this.z; h.y = this.game.city.groundHeight(this.x, this.z);
    h.pose = 'lie'; h.pitch = -1.45 * clamp(this.downT * 2, 0, 1); h.speed = 0;
    if (this.downT <= 0) { this.state = 'foot'; h.pitch = 0; }
  }

  /** Knocked down by a car or a hard punch. */
  knockDown(vx, vz, seconds = 1.6) {
    if (this.state !== 'foot') return;
    this.state = 'down'; this.downT = seconds;
    this.vx = vx; this.vz = vz;
  }

  // ---------------------------------------------------------------- driving
  _drive(dt, input) {
    const g = this.game, v = this.vehicle, s = input.state;
    if (input.pressed('enter')) { this.leaveVehicle(); return; }
    this.controls = {
      throttle: s.throttle, brake: s.brake, steer: -s.steer, handbrake: s.handbrake,
      analog: input.mode !== 'keyboard',
    };
    // Horn and siren.
    if (s.horn) g.audio?.horn(v);
    if (input.pressed('action') && (v.type === 'police' || v.type === 'ambulance')) v.sirenOn = !v.sirenOn;
    this.x = v.x; this.z = v.z; this.y = v.y; this.heading = v.heading;
    this.speed = Math.abs(forwardSpeed(v));
    this.groundY = v.y;
    this.human.t += dt;
    if (v.sinking > 1.2) g.vehicleSank?.(v);
  }
}
