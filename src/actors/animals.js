// Cows and street dogs. Cows amble along the kerbs and sometimes settle down in
// the middle of the road, where traffic waits and honks; dogs trot about and bark.
import * as THREE from 'three';
import { clamp, dist, rng, hash2, dampAngle, wrapAngle } from '../core/math.js';

const _m = new THREE.Matrix4(), _a = new THREE.Matrix4(), _e = new THREE.Euler(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const COW = [0xf2efe6, 0xe8dcc8, 0x8a6a4f, 0xd8c8b0, 0x5a4636];
const DOG = [0xc49a6c, 0x8a6a4f, 0x2b2622, 0xd8c8b0, 0xa0764a];

function ell(rx, ry, rz, x = 0, y = 0, z = 0) { const g = new THREE.SphereGeometry(1, 10, 7); g.scale(rx, ry, rz); g.translate(x, y, z); return g; }
function leg(r, len) { const g = new THREE.CylinderGeometry(r, r * 0.75, len, 6); g.translate(0, -len / 2, 0); return g; }

export class Animals {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.seed = 1;
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
    const mk = (geo, n) => { const m = new THREE.InstancedMesh(geo, mat, n); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.setColorAt(0, _c.set(0xffffff)); m.count = 0; m.frustumCulled = false; m.castShadow = true; game.scene.add(m); return m; };
    // Unit parts, scaled per species.
    this.parts = {
      body: mk(ell(0.5, 0.42, 1, 0, 0, 0), 40),
      head: mk(ell(0.42, 0.42, 0.62, 0, 0, 0.25), 40),
      leg: mk(leg(0.1, 1), 160),
      horn: mk(new THREE.ConeGeometry(0.05, 0.32, 5).rotateX(-0.5).translate(0, 0.14, 0), 80),
      hump: mk(ell(0.22, 0.2, 0.28), 40),
      tail: mk(new THREE.CylinderGeometry(0.03, 0.02, 0.8, 4).translate(0, -0.4, 0), 40),
    };
    this.n = {};
  }

  update(dt) {
    const g = this.game, pos = g.player.pos;
    const target = Math.round(g.quality.settings.peds / 6);
    for (let i = this.list.length - 1; i >= 0; i--) if (dist(this.list[i].x, this.list[i].z, pos.x, pos.z) > 170) this.list.splice(i, 1);
    if (this.list.length < target) this._spawn(pos);
    for (const a of this.list) this._step(a, dt);
    this._render(g.camera3.position);
  }

  _spawn(pos) {
    const g = this.game, net = g.net;
    const r = rng(hash2(this.seed++, 9091));
    const ang = r() * Math.PI * 2, d = r.range(50, 130);
    const n = net.nearest(pos.x + Math.cos(ang) * d, pos.z + Math.sin(ang) * d, 40, {});
    if (!n || net.bridge[n.road]) return;
    const cow = r.chance(0.6);
    const side = net.kerbSide(n.road) || (r.chance(0.5) ? 1 : -1), off = net.width[n.road] / 2 + (cow ? 0.6 : 1.0);
    const x = n.x + n.dz * off * side, z = n.z - n.dx * off * side;
    if (g.colliders.blocked(x, z, 0.7)) return;
    this.list.push({
      cow, x, z, heading: Math.atan2(n.dx, n.dz) * (r.chance(0.5) ? 1 : -1), speed: 0, state: 'walk', t: r.range(3, 10),
      color: cow ? r.pick(COW) : r.pick(DOG), scale: cow ? r.range(0.9, 1.1) : r.range(0.8, 1.1), phase: r() * 6, road: n.road, id: this.seed, bark: 0,
    });
  }

  /** Does anything with legs block this point? (traffic look-ahead) */
  forEachNear(x, z, r, fn) { for (const a of this.list) if (Math.abs(a.x - x) < r && Math.abs(a.z - z) < r) fn(a); }

  _step(a, dt) {
    const g = this.game, P = g.player;
    a.t -= dt; a.bark -= dt;
    const dP = dist(a.x, a.z, P.pos.x, P.pos.z);
    if (a.cow) {
      // Cows: walk a while, graze, or sit down — sometimes right on the road.
      if (a.t <= 0) {
        const r = Math.random();
        a.state = r < 0.45 ? 'walk' : r < 0.75 ? 'graze' : 'sit';
        if (a.state === 'sit' && Math.random() < 0.5) {
          // Wander onto the road to sit, as cows do.
          const n = g.net.nearest(a.x, a.z, 12, {});
          if (n && !g.player.vehicle || (n && dist(n.x, n.z, P.pos.x, P.pos.z) > 25)) { a.tx = n.x; a.tz = n.z; a.state = 'toRoad'; }
        }
        a.t = 6 + Math.random() * 14;
      }
      let sp = 0;
      if (a.state === 'walk') sp = 0.7;
      if (a.state === 'toRoad') {
        const d = dist(a.x, a.z, a.tx, a.tz);
        a.heading = dampAngle(a.heading, Math.atan2(a.tx - a.x, a.tz - a.z), 2, dt);
        sp = d > 0.5 ? 0.7 : 0;
        if (d <= 0.5) { a.state = 'sit'; a.t = 20 + Math.random() * 30; }
      }
      a.speed = sp;
    } else {
      // Dogs: trot, nap, and bark at whoever comes close.
      if (dP < 7 && a.bark <= 0) { a.bark = 2 + Math.random() * 3; g.audio?.bark?.(a); if (dP < 4 && P.state === 'foot' && Math.random() < 0.3) g.hud?.bark('भो! भो! 🐕'); }
      if (a.t <= 0) { a.state = Math.random() < 0.7 ? 'walk' : 'sit'; a.t = 3 + Math.random() * 8; a.heading += (Math.random() - 0.5) * 2; }
      a.speed = a.state === 'walk' ? (dP < 10 && P.vehicle ? 4.5 : 1.6) : 0;
      if (dP < 10 && P.vehicle && a.state === 'walk') a.heading = dampAngle(a.heading, Math.atan2(P.pos.x - a.x, P.pos.z - a.z), 3, dt); // chase the bike
    }
    if (a.speed > 0) {
      a.x += Math.sin(a.heading) * a.speed * dt; a.z += Math.cos(a.heading) * a.speed * dt;
      const c = this._c || (this._c = { x: 0, z: 0 }), o = this._o || (this._o = {});
      c.x = a.x; c.z = a.z;
      if (g.colliders.resolveCircle(c, a.cow ? 0.7 : 0.35, o)) { a.x = c.x; a.z = c.z; a.heading += 1.2 + Math.random(); }
      a.phase += a.speed * dt * 3.5;
    }
    // Vehicles: cows are immovable and unbothered; dogs scatter.
    for (const v of g.vehicles.list) {
      const dx = a.x - v.x, dz = a.z - v.z, rr = v.hd + (a.cow ? 1.1 : 0.5);
      if (dx * dx + dz * dz > rr * rr) continue;
      const c2 = Math.cos(v.heading), s2 = Math.sin(v.heading);
      const lx = dx * c2 - dz * s2, lz = dx * s2 + dz * c2;
      const ew = v.hw + (a.cow ? 0.55 : 0.3), ed = v.hd + (a.cow ? 1.0 : 0.4);
      if (Math.abs(lx) > ew || Math.abs(lz) > ed) continue;
      if (a.cow) {
        // The car stops dead; the cow looks round, faintly annoyed.
        const nx = Math.sign(lz) * s2, nz = Math.sign(lz) * c2;
        const push = ed - Math.abs(lz);
        v.x -= nx * push; v.z -= nz * push;
        const vn = v.vx * -nx + v.vz * -nz;
        if (vn > 0) { v.vx += nx * vn * 1.3; v.vz += nz * vn * 1.3; if (vn > 4 && v.role === 'player') { g.audio?.sfx('crash', 0.4); g.audio?.moo?.(); g.camera.addShake(0.4); v.health -= vn * 6; } }
      } else if (Math.hypot(v.vx, v.vz) > 2) { a.heading = Math.atan2(dx, dz); a.state = 'walk'; a.t = 2; a.speed = 6; }
    }
  }

  _render(cam) {
    const P = this.parts;
    for (const k in P) this.n[k] = 0;
    const emit = (k, m, col) => { const mesh = P[k]; const i = this.n[k]++; if (i >= mesh.instanceMatrix.count) return; mesh.setMatrixAt(i, m); mesh.setColorAt(i, _c.setHex(col)); };
    for (const a of this.list) {
      if (dist(a.x, a.z, cam.x, cam.z) > 120) continue;
      const cow = a.cow, s = a.scale * (cow ? 1 : 0.42);
      const sit = a.state === 'sit';
      const legLen = 0.75;
      const bodyY = sit ? (cow ? 0.46 : 0.5) : legLen + 0.34;
      _e.set(0, a.heading, 0, 'YXZ'); _q.setFromEuler(_e);
      _v.set(a.x, 0, a.z); _s.set(s, s, s);
      _a.compose(_v, _q, _s);
      // Body: a deep barrel for a cow, a compact one for a dog.
      _m.makeScale(cow ? 0.82 : 0.82, cow ? 1.05 : 0.9, cow ? 1.1 : 0.78); _m.setPosition(0, bodyY, 0);
      emit('body', _m.premultiply(_a), a.color);
      // Head on a short neck (a grazing cow drops its head).
      const graze = a.state === 'graze' ? 0.6 : 0;
      _e.set(0.35 + graze, 0, 0); _q.setFromEuler(_e);
      _m.compose(_v.set(0, bodyY + (cow ? 0.3 : 0.32) - graze * 0.55, cow ? 1.12 : 0.82), _q, _s.set(cow ? 0.55 : 0.62, cow ? 0.62 : 0.6, cow ? 0.85 : 0.75));
      const head = _m.clone().premultiply(_a);
      emit('head', head, cow && a.color === 0x5a4636 ? 0x4a3a2c : a.color);
      if (cow) {
        for (const sx of [-0.2, 0.2]) { _m.makeRotationZ(sx * 3.2); _m.setPosition(sx, 0.36, 0.15); emit('horn', _m.clone().premultiply(head), 0xd8ccb0); }
        _m.makeScale(1.3, 1.1, 1.2); _m.setPosition(0, bodyY + 0.42, 0.55); emit('hump', _m.premultiply(_a), a.color);
      }
      // Legs: a walk cycle standing; tucked out of sight lying down.
      const swing = a.speed > 0 ? Math.sin(a.phase) * 0.45 : 0;
      for (const [lx, lz, ph] of [[-0.3, 0.72, 0], [0.3, 0.72, Math.PI], [-0.3, -0.72, Math.PI], [0.3, -0.72, 0]]) {
        const ang = sit ? 0 : swing * Math.cos(ph);
        _e.set(ang, 0, 0); _q.setFromEuler(_e);
        const zz = lz * (cow ? 1 : 0.62);
        _m.compose(_v.set(lx * (cow ? 1 : 0.9), bodyY - 0.2, zz), _q, _s.set(cow ? 1 : 0.85, sit ? 0.3 : legLen, cow ? 1 : 0.85));
        emit('leg', _m.premultiply(_a), a.color === 0xf2efe6 ? 0xe0d8c8 : a.color);
      }
      // Tail: a swishing rope for a cow, curled up over a dog's back.
      const t = performance.now();
      _e.set(cow ? 0.3 + Math.sin(t / 400 + a.id) * 0.2 : 2.5, 0, Math.sin(t / (cow ? 300 : 120) + a.id) * 0.3); _q.setFromEuler(_e);
      _m.compose(_v.set(0, bodyY + (cow ? 0.3 : 0.2), cow ? -1.12 : -0.72), _q, _s.set(1, cow ? 1 : 0.55, 1));
      emit('tail', _m.premultiply(_a), a.color);
    }
    for (const k in P) { P[k].count = Math.min(this.n[k], P[k].instanceMatrix.count); P[k].instanceMatrix.needsUpdate = true; if (P[k].instanceColor) P[k].instanceColor.needsUpdate = true; }
  }
}
