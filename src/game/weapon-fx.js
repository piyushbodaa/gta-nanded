// What weapons look like in the world: the gun in the player's hands and in armed officers',
// loot crates with their glow beams and the weapon floating over them, the air drop coming down
// under its parachute and smoking red where it lands, grenades in flight, tracers, muzzle flashes
// and the puffs where bullets land (sparks off metal, dust off walls, a splash, a grey puff off
// clothes: never blood).
//
// All of it is instanced, one draw per kind of thing, with nothing allocated per frame: a cheap
// phone pays a handful of draws while guns are out and nothing at all when there are none (empty
// meshes are switched off, and only the rows in use are sent to the graphics chip).
import * as THREE from 'three';
import { GRIPS, GUN_IDS, HAND_GRIP, gunGeometry } from '../actors/gun-models.js';
import { radialTexture } from '../world/citymat.js';
import { sendFirst } from '../core/buffers.js';
import { clamp } from '../core/math.js';

const NPC_GUNS = 12, LOOT_GUNS = 16, CRATES = 96, DROPS = 4, FLYING = 8, TRACERS = 48;
const LOOT_RANGE = 120, SHOW_RANGE = 36, NPC_RANGE = 50;
/** How rare a find is (the colour of its beam). */
const RARITY = { common: 0xdde4ec, uncommon: 0x58d65a, rare: 0x47a2ff, epic: 0xb56cff, legendary: 0xffbf2e };
const TIER = { pan: 'common', p92: 'common', uzi: 'uncommon', ump45: 'uncommon', s12k: 'uncommon', grenade: 'uncommon', akm: 'rare', m416: 'rare', kar98k: 'epic', awm: 'legendary' };
/** A muzzle flash's size by weapon (snipers and the shotgun bark loudest). */
const FLASH = { p92: 0.8, uzi: 0.8, ump45: 0.9, akm: 1.1, m416: 1, s12k: 1.5, kar98k: 1.4, awm: 1.6 };

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
const _c = new THREE.Color(), _res = new THREE.Vector2(), _te = new Float32Array(16);
const hash = (x, z) => { const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return v - Math.floor(v); };
const rnd = () => Math.random() - 0.5;

/**
 * Tracers: thin quads from tail to head, a set width on screen whatever the distance (a line is a
 * single pixel on a phone's dense screen), clipped in front of the camera, added onto the scene.
 */
function tracerMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uRes: { value: new THREE.Vector2(1, 1) }, uWidth: { value: 3 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute float side; attribute float along; attribute vec3 iA; attribute vec3 iB; attribute vec4 iC;
      uniform vec2 uRes; uniform float uWidth; varying vec4 vC; varying float vS;
      void main() {
        vec4 va = modelViewMatrix * vec4(iA, 1.0), vb = modelViewMatrix * vec4(iB, 1.0);
        // Clip the streak to just in front of the camera (an officer's shot can pass behind it).
        float n = -0.35, keep = 1.0;
        if (va.z > n && vb.z > n) keep = 0.0;
        else if (va.z > n) va = mix(va, vb, (va.z - n) / (va.z - vb.z));
        else if (vb.z > n) vb = mix(vb, va, (vb.z - n) / (vb.z - va.z));
        vec4 a = projectionMatrix * va, b = projectionMatrix * vb;
        vec2 d = b.xy / b.w * uRes - a.xy / a.w * uRes;
        d = length(d) > 1e-4 ? normalize(d) : vec2(1.0, 0.0);
        vec4 p = mix(a, b, along);
        p.xy += vec2(-d.y, d.x) * side * uWidth / uRes * p.w;
        gl_Position = p;
        vC = vec4(iC.rgb, iC.a * keep * mix(0.25, 1.0, along)); vS = side;
      }`,
    fragmentShader: /* glsl */`
      varying vec4 vC; varying float vS;
      void main() { gl_FragColor = vec4(vC.rgb, vC.a * (1.0 - vS * vS));
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
  });
}

export class WeaponFx {
  constructor(game) {
    this.game = game;
    const scene = game.scene;
    this.t = 0;
    this.low = false;
    // One material for every gun, crate and the parachute: colours are in the vertices.
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.15 });
    const inst = (geo, mat, n, name) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0; m.frustumCulled = false; m.name = name;
      scene.add(m);
      return m;
    };
    // --- guns: one instanced mesh per weapon (the player's, officers', and those floating over loot).
    this.guns = {}; this.gunN = {};
    for (const id of GUN_IDS) { this.guns[id] = inst(gunGeometry(id), this.mat, 1 + NPC_GUNS + LOOT_GUNS, 'gun-' + id); this.gunN[id] = 0; }
    this.flying = inst(gunGeometry('grenade'), this.mat, FLYING, 'grenades');
    // --- loot: crates, air-drop crates, and the soft beams and ground glow that find them.
    this.crates = inst(gunGeometry('crate'), this.mat, CRATES, 'loot-crates');
    this.drops = inst(gunGeometry('airdrop'), this.mat, DROPS, 'air-drops');
    this.chute = new THREE.Mesh(gunGeometry('parachute'), this.mat);
    this.chute.frustumCulled = false; this.chute.visible = false; this.chute.name = 'parachute';
    scene.add(this.chute);
    this.chuteT = 0; this.smokeAcc = 0;
    const beam = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true).translate(0, 0.5, 0);
    const fade = [], bp = beam.attributes.position;
    for (let i = 0; i < bp.count; i++) { const a = Math.pow(1 - bp.getY(i), 1.6); fade.push(a, a, a); }
    beam.setAttribute('color', new THREE.Float32BufferAttribute(fade, 3));
    const glowMat = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false };
    this.beams = inst(beam, new THREE.MeshBasicMaterial({ ...glowMat, vertexColors: true, side: THREE.DoubleSide, opacity: 0.55 }), CRATES + DROPS, 'loot-beams');
    this.beams.renderOrder = 4;
    const disc = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.glows = inst(disc, new THREE.MeshBasicMaterial({ ...glowMat, map: radialTexture(64), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), CRATES + DROPS, 'loot-glows');
    this.glows.renderOrder = 3;
    for (const m of [this.beams, this.glows]) { m.setColorAt(0, _c.set(0xffffff)); m.instanceColor.setUsage(THREE.DynamicDrawUsage); }
    // --- tracers: a ring of streaks.
    const tg = new THREE.InstancedBufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
    tg.setAttribute('side', new THREE.Float32BufferAttribute([-1, 1, -1, 1], 1));
    tg.setAttribute('along', new THREE.Float32BufferAttribute([0, 0, 1, 1], 1));
    tg.setIndex([0, 2, 1, 1, 2, 3]);
    const ia = n => new THREE.InstancedBufferAttribute(new Float32Array(TRACERS * n), n).setUsage(THREE.DynamicDrawUsage);
    tg.setAttribute('iA', ia(3)); tg.setAttribute('iB', ia(3)); tg.setAttribute('iC', ia(4));
    tg.instanceCount = 0;
    this.tracers = new THREE.Mesh(tg, tracerMaterial());
    this.tracers.frustumCulled = false; this.tracers.renderOrder = 6; this.tracers.name = 'tracers';
    scene.add(this.tracers);
    this.tr = { a: new Float32Array(TRACERS * 3), b: new Float32Array(TRACERS * 3), age: new Float32Array(TRACERS), life: new Float32Array(TRACERS).fill(-1), w: new Float32Array(TRACERS), next: 0 };
    this._flashT = -1;
    // The player's gun this frame (for muzzle()), as a column-major 4x4.
    this.placed = false; this.pm = new Float32Array(16); this.pid = null;
    this._all = [...Object.values(this.guns), this.flying, this.crates, this.drops, this.beams, this.glows];
    this._shadowed = [...Object.values(this.guns), this.flying, this.crates, this.drops, this.chute];
  }

  /** Place everything for this frame: called after humans.update, so the bones are this frame's. */
  update(dt) {
    const g = this.game, W = g.weapons, H = g.humans, q = g.quality?.settings;
    this.t += dt;
    this.low = g.quality?.tier === 'low';
    for (const id in this.gunN) this.gunN[id] = 0;
    // The player's gun: in the right fist, hidden while looking through a scope (muzzle() still knows it).
    this.placed = false;
    const ph = g.player?.human;
    if (ph && this._held(ph)) {
      const id = ph.anim.gunId;
      this._gunMatrix(ph, this.pm, 0);
      this.placed = true; this.pid = id;
      if (!W?.scoped) this._put(id, this.pm);
    }
    // Officers (and anyone else) with a gun out, close enough to make it out.
    if (H) {
      const cam = g.camera3?.position;
      let n = 0;
      for (const h of H.list) {
        if (n >= NPC_GUNS || h === ph || !h.gun || !this._held(h) || h._lod > 1) continue;
        if (cam && (h.x - cam.x) ** 2 + (h.z - cam.z) ** 2 > NPC_RANGE * NPC_RANGE) continue;
        this._gunMatrix(h, _te, 0);
        this._put(h.anim.gunId, _te);
        n++;
      }
    }
    this._loot(dt, W);
    this._grenades(W);
    this._tracers(dt);
    // Counts in, empty draws off, only the rows in use sent (and nothing hidden before play: the
    // shaders compile on the menu, which skips what isn't shown).
    const live = g.started ?? true;
    for (const id in this.guns) this.guns[id].count = this.gunN[id];
    for (const m of this._all) {
      m.visible = !live || m.count > 0;
      sendFirst(m.instanceMatrix, m.count);
      if (m.instanceColor) sendFirst(m.instanceColor, m.count);
    }
    const shadows = Boolean(q?.dynamicShadows);
    for (const m of this._shadowed) m.castShadow = shadows;
  }

  /** Is h holding something with a model, posed this frame? */
  _held(h) { return h._row >= 0 && h.anim?.gun.on && GRIPS[h.anim.gunId] !== undefined; }

  /** One more of weapon id at the matrix te. */
  _put(id, te) {
    const m = this.guns[id], i = this.gunN[id];
    if (!m || i >= m.instanceMatrix.count) return;
    m.instanceMatrix.array.set(te, i * 16);
    this.gunN[id] = i + 1;
  }

  /**
   * h's weapon as a column-major 4x4 into te at o: in the right fist (the forearm bone from the
   * shared bone texture), pointing the way anim.js turned it (in the forearm's frame for a pan or
   * a grenade, in the body's for a gun).
   */
  _gunMatrix(h, te, o) {
    const A = h.anim, gn = A.gun, d = this.game.humans.data, b = h._row + 6 * 12;
    const m0 = d[b], m1 = d[b + 1], m2 = d[b + 2], m4 = d[b + 4], m5 = d[b + 5], m6 = d[b + 6], m8 = d[b + 8], m9 = d[b + 9], m10 = d[b + 10];
    const gx = HAND_GRIP[0], gy = HAND_GRIP[1], gz = HAND_GRIP[2];
    const px = m0 * gx + m1 * gy + m2 * gz + d[b + 3], py = m4 * gx + m5 * gy + m6 * gz + d[b + 7], pz = m8 * gx + m9 * gy + m10 * gz + d[b + 11];
    let dx, dy, dz, ux, uy, uz;
    if (gn.arm) {
      const s = 1 / (Math.hypot(m0, m4, m8) || 1);
      dx = (m0 * gn.dx + m1 * gn.dy + m2 * gn.dz) * s; dy = (m4 * gn.dx + m5 * gn.dy + m6 * gn.dz) * s; dz = (m8 * gn.dx + m9 * gn.dy + m10 * gn.dz) * s;
      ux = (m0 * gn.ux + m1 * gn.uy + m2 * gn.uz) * s; uy = (m4 * gn.ux + m5 * gn.uy + m6 * gn.uz) * s; uz = (m8 * gn.ux + m9 * gn.uy + m10 * gn.uz) * s;
    } else {
      const Y = h.yaw + (A.root?.yaw || 0), c = Math.cos(Y), s = Math.sin(Y);
      dx = gn.dx * c + gn.dz * s; dy = gn.dy; dz = -gn.dx * s + gn.dz * c;
      ux = gn.ux * c + gn.uz * s; uy = gn.uy; uz = -gn.ux * s + gn.uz * c;
    }
    te[o] = uy * dz - uz * dy; te[o + 1] = uz * dx - ux * dz; te[o + 2] = ux * dy - uy * dx; te[o + 3] = 0; // the gun's left
    te[o + 4] = ux; te[o + 5] = uy; te[o + 6] = uz; te[o + 7] = 0;
    te[o + 8] = dx; te[o + 9] = dy; te[o + 10] = dz; te[o + 11] = 0;
    te[o + 12] = px; te[o + 13] = py; te[o + 14] = pz; te[o + 15] = 1;
  }

  /** The player's muzzle in the world, into out {x, y, z}; false when no gun is in hand this frame. */
  muzzle(out) {
    if (!this.placed) return false;
    return mul(this.pm, GRIPS[this.pid].muzzle, out);
  }
  /** Anyone's muzzle (an officer firing back), false if they have no gun posed this frame. */
  muzzleOf(h, out) {
    if (!h || !this._held(h)) return false;
    this._gunMatrix(h, _te, 0);
    return mul(_te, GRIPS[h.anim.gunId].muzzle, out);
  }

  // ---------------------------------------------------------------- loot and the air drop
  _loot(dt, W) {
    const g = this.game, focus = g.player?.pos ?? g.player, cam = g.camera3?.position ?? focus;
    let nc = 0, nd = 0, nb = 0, shown = 0, dropTaken = false;
    const loot = W?.loot;
    if (loot && focus) {
      for (let i = 0; i < loot.length; i++) {
        const L = loot[i], drop = L.kind === 'airdrop';
        if (L.taken) { if (drop) dropTaken = true; continue; }
        const dx = L.x - focus.x, dz = L.z - focus.z, d2 = dx * dx + dz * dz;
        if (d2 > LOOT_RANGE * LOOT_RANGE) continue;
        const ph = hash(L.x, L.z), y = L.y ?? 0, d = Math.sqrt(d2);
        _q.setFromAxisAngle(_Y, ph * Math.PI * 2);
        if (drop) { if (nd < DROPS) this.drops.setMatrixAt(nd++, _m.compose(_p.set(L.x, y, L.z), _q, _ONE)); }
        else if (nc < CRATES) this.crates.setMatrixAt(nc++, _m.compose(_p.set(L.x, y, L.z), _q, _ONE));
        else continue;
        // The beam: rarer finds glow in rarer colours, the air drop tallest; full to 50 m, gone by 110.
        if (nb < this.beams.instanceMatrix.count) {
          const k = clamp((110 - d) / 60, 0, 1) * (0.85 + 0.15 * Math.sin(this.t * 2.6 + ph * 6)), tall = drop ? 38 : 7, r = drop ? 0.55 : 0.2;
          _c.set(RARITY[drop ? 'legendary' : TIER[L.id] || 'common']).multiplyScalar(k);
          _q.identity();
          this.beams.setMatrixAt(nb, _m.compose(_p.set(L.x, y + 0.05, L.z), _q, _s.set(r, tall, r)));
          this.beams.setColorAt(nb, _c);
          this.glows.setMatrixAt(nb, _m.compose(_p.set(L.x, y + 0.04, L.z), _q, _s.set(drop ? 4 : 1.8, 1, drop ? 4 : 1.8)));
          this.glows.setColorAt(nb, _c.multiplyScalar(0.8));
          _s.set(1, 1, 1);
          nb++;
        }
        // Close by, the weapon itself turns slowly over its crate.
        if (L.id && GRIPS[L.id] && d < SHOW_RANGE && shown < LOOT_GUNS && !drop) {
          _q.setFromEuler(_e.set(0.25, this.t * 1.3 + ph * 6, 0));
          _m.compose(_p.set(L.x, y + 0.62 + 0.07 * Math.sin(this.t * 2 + ph * 9), L.z), _q, _ONE);
          this._put(L.id, _m.elements);
          shown++;
        }
      }
    }
    this.crates.count = nc; this.drops.count = nd; this.beams.count = nb; this.glows.count = nb;
    // Coming down: the crate under its canopy, swaying; landed, the canopy folds away and red smoke rises.
    const A = W?.airdrop, chute = this.chute;
    chute.visible = false;
    if (!A) { this.chuteT = 0; return; }
    const y = A.y ?? 0;
    if (!A.landed) {
      this.chuteT = 0;
      if (nd < DROPS) { _q.setFromAxisAngle(_Y, hash(A.x, A.z) * 6.28); this.drops.setMatrixAt(nd++, _m.compose(_p.set(A.x, y, A.z), _q, _ONE)); this.drops.count = nd; }
      chute.visible = true;
      chute.position.set(A.x, y + 0.95, A.z);
      chute.rotation.set(0.06 * Math.sin(this.t * 0.9), this.t * 0.15, 0.06 * Math.cos(this.t * 0.7));
      chute.scale.set(1, 1, 1);
    } else {
      this.chuteT += dt;
      const k = this.chuteT / 1.6;
      if (k < 1) {
        chute.visible = true;
        chute.position.set(A.x + 2.2 * k, y + 0.95 - 0.4 * k, A.z);
        chute.rotation.set(0, chute.rotation.y, 1.2 * k);
        chute.scale.set(1 + 0.2 * k, Math.max(0.05, 1 - k), 1 + 0.2 * k);
      }
      if (A.smoke !== false && !dropTaken && g.effects) {
        this.smokeAcc += dt * (this.low ? 5 : 10);
        while (this.smokeAcc >= 1) {
          this.smokeAcc -= 1;
          g.effects.spawn(A.x + rnd() * 0.4, y + 1.05, A.z + rnd() * 0.4, rnd() * 0.5 + 0.5, 2.2 + Math.random() * 1.2, rnd() * 0.5,
            3.6, 1.1, 0.9, 0.14, 0.1, 0.6, { grow: 3.2, drag: 0.55, buoy: 0.35 });
        }
      }
    }
  }

  _grenades(W) {
    const list = W?.grenades;
    let n = 0;
    if (list) {
      for (const G of list) {
        if (n >= FLYING) break;
        // Tumbling end over end as it flies (its own clock, so each one turns differently).
        const t = G.t ?? this.t, yaw = Math.atan2(G.vx || 0, G.vz || 0);
        _q.setFromEuler(_e.set(t * 9, yaw, t * 4, 'YXZ'));
        this.flying.setMatrixAt(n++, _m.compose(_p.set(G.x, G.y, G.z), _q, _ONE));
      }
    }
    this.flying.count = n;
  }

  // ---------------------------------------------------------------- shots
  /** A bullet from the muzzle (a) to where it landed (b): a tracer streak, and a flash at the muzzle. */
  shot(ax, ay, az, bx, by, bz, id) {
    const T = this.tr, i = T.next;
    T.next = (i + 1) % TRACERS;
    T.a[i * 3] = ax; T.a[i * 3 + 1] = ay; T.a[i * 3 + 2] = az;
    T.b[i * 3] = bx; T.b[i * 3 + 1] = by; T.b[i * 3 + 2] = bz;
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    T.age[i] = 0; T.life[i] = 0.06 + Math.min(len, 400) / 2000; T.w[i] = id === 'awm' || id === 'kar98k' ? 1.4 : id === 's12k' ? 0.7 : 1;
    // One flash a frame however many pellets.
    const E = this.game.effects;
    if (!E || this._flashT === this.t) return;
    this._flashT = this.t;
    const k = FLASH[id] ?? 1, ux = len > 0 ? (bx - ax) / len : 0, uy = len > 0 ? (by - ay) / len : 0, uz = len > 0 ? (bz - az) / len : 0;
    E.spawn(ax, ay, az, 0, 0, 0, 0.05, 0.38 * k, 1, 0.86, 0.45, 1, { grow: 0.5 });
    E.spawn(ax + ux * 0.12 * k, ay + uy * 0.12 * k, az + uz * 0.12 * k, ux * 2, uy * 2, uz * 2, 0.045, 0.26 * k, 1, 0.95, 0.7, 1, { grow: 0.3 });
    if (!this.low) E.spawn(ax, ay, az, 0, 0, 0, 0.07, 0.75 * k, 1, 0.6, 0.2, 0.35, { grow: 0.4 }); // the soft glow round it
  }

  /** Where a bullet stopped: 'metal' | 'wall' | 'ground' | 'body' | 'water'. */
  impact(x, y, z, kind) {
    const E = this.game.effects;
    if (!E) return;
    const lo = this.low;
    if (kind === 'metal') {
      E.sparks(x, y, z, lo ? 3 : 6);
      E.spawn(x, y, z, 0, 0, 0, 0.05, 0.28, 1, 0.9, 0.6, 0.9, { grow: 0.3 });
    } else if (kind === 'water') {
      for (let k = lo ? 3 : 6; k > 0; k--) E.spawn(x, y, z, rnd() * 1.2, 2.4 + Math.random() * 2, rnd() * 1.2, 0.6, 0.22, 0.82, 0.9, 1, 0.75, { grow: 1.2, buoy: -9 });
    } else if (kind === 'body') {
      // A puff of dust off clothes: grey, small and gone in a moment.
      for (let k = lo ? 2 : 3; k > 0; k--) E.spawn(x, y, z, rnd() * 0.7, 0.3 + Math.random() * 0.4, rnd() * 0.7, 0.45, 0.28, 0.74, 0.72, 0.68, 0.5, { grow: 2, drag: 2 });
    } else {
      const ground = kind === 'ground';
      E.dust(x, z, lo ? 1 : 2, ground ? [0.62, 0.55, 0.44] : [0.68, 0.65, 0.6], y - 0.2);
      for (let k = lo ? 1 : 3; k > 0; k--) E.spawn(x, y, z, rnd() * 2.2, 1 + Math.random() * 2, rnd() * 2.2, 0.4, 0.06, 0.48, 0.46, 0.42, 1, { grow: 0, buoy: -9 });
    }
  }

  _tracers(dt) {
    const T = this.tr, g = this.tracers.geometry, A = g.attributes.iA.array, B = g.attributes.iB.array, Cc = g.attributes.iC.array;
    let hi = 0;
    for (let i = 0; i < TRACERS; i++) {
      if (T.life[i] < 0) continue;
      T.age[i] += dt;
      const u = T.age[i] / T.life[i];
      if (u >= 1) { T.life[i] = -1; Cc[i * 4 + 3] = 0; continue; }
      // The head races out to the hit, a streak (8 m at most) behind it.
      const ax = T.a[i * 3], ay = T.a[i * 3 + 1], az = T.a[i * 3 + 2], dx = T.b[i * 3] - ax, dy = T.b[i * 3 + 1] - ay, dz = T.b[i * 3 + 2] - az;
      const len = Math.hypot(dx, dy, dz) || 1, head = Math.min(1, u / 0.6 + 0.12), tail = Math.max(0, head - 8 / len, (u - 0.3) / 0.7);
      A[i * 3] = ax + dx * tail; A[i * 3 + 1] = ay + dy * tail; A[i * 3 + 2] = az + dz * tail;
      B[i * 3] = ax + dx * head; B[i * 3 + 1] = ay + dy * head; B[i * 3 + 2] = az + dz * head;
      const f = 1 - Math.max(0, (u - 0.55) / 0.45);
      Cc[i * 4] = 1.6 * T.w[i]; Cc[i * 4 + 1] = 1.35 * T.w[i]; Cc[i * 4 + 2] = 0.75 * T.w[i]; Cc[i * 4 + 3] = f;
      hi = i + 1;
    }
    g.instanceCount = hi;
    this.tracers.visible = hi > 0 || !(this.game.started ?? true);
    for (const k of ['iA', 'iB', 'iC']) sendFirst(g.attributes[k], hi);
    if (hi > 0) {
      const r = this.game.renderer;
      if (r) { r.getDrawingBufferSize(_res); this.tracers.material.uniforms.uRes.value.copy(_res); this.tracers.material.uniforms.uWidth.value = 2.4 * r.getPixelRatio(); }
    }
  }
}

const _Y = new THREE.Vector3(0, 1, 0), _ONE = new THREE.Vector3(1, 1, 1);
/** Point p (weapon frame) through the column-major 4x4 te into out. */
function mul(te, p, out) {
  out.x = te[0] * p[0] + te[4] * p[1] + te[8] * p[2] + te[12];
  out.y = te[1] * p[0] + te[5] * p[1] + te[9] * p[2] + te[13];
  out.z = te[2] * p[0] + te[6] * p[1] + te[10] * p[2] + te[14];
  return true;
}
