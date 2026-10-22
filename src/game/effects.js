// Particles (smoke, dust, sparks, fire, rain), skid marks and mission markers.
import * as THREE from 'three';
import { clamp, rng } from '../core/math.js';
import { radialTexture } from '../world/citymat.js';

const MAX = 2400;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    // --- particles: one Points draw call.
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 3); this.col = new Float32Array(MAX * 4); this.size = new Float32Array(MAX);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('psize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const tex = radialTexture(64);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, scale: { value: 600 }, ...THREE.UniformsLib.fog },
      transparent: true, depthWrite: false, fog: true,
      vertexShader: /* glsl */`
        attribute vec4 pcolor; attribute float psize; uniform float scale; varying vec4 vC;
        #include <fog_pars_vertex>
        void main() { vC = pcolor; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_PointSize = psize * scale / -mvPosition.z; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D map; varying vec4 vC;
        #include <fog_pars_fragment>
        void main() { vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC.rgb, vC.a * t.a); if (gl_FragColor.a < 0.01) discard;
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
        }`,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.p = []; // live particles
    this.free = [];
    for (let i = MAX - 1; i >= 0; i--) this.free.push(i);
    // --- skid marks: ring buffer of dark quads.
    const SK = 600;
    this.skids = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -3 }), SK);
    this.skids.count = 0; this.skids.frustumCulled = false; this.skidI = 0; this.skidN = SK;
    this.skids.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.skids);
    this.lastSkid = new Map();
    // --- rain: a column of streaks that follows the camera.
    const RN = 4200;
    const rg = new THREE.BufferGeometry();
    const rp = new Float32Array(RN * 6);
    for (let i = 0; i < RN; i++) {
      // Denser close to the camera, where streaks read best.
      const rr = Math.pow(Math.random(), 0.7) * 30, a = Math.random() * Math.PI * 2;
      const x = Math.cos(a) * rr, y = Math.random() * 30, z = Math.sin(a) * rr;
      rp.set([x, y, z, x + 0.06, y - 1.3, z + 0.04], i * 6);
    }
    rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xb4c2cc, transparent: true, opacity: 0.4, fog: false, depthWrite: false }));
    this.rain.frustumCulled = false; this.rain.visible = false;
    scene.add(this.rain);
    this.rainY = 0;
    // --- mission markers.
    this.markers = new Markers(scene);
    this.flashes = [];
    this.light = new THREE.PointLight(0xffa040, 0, 30, 2);
    scene.add(this.light);
  }

  spawn(x, y, z, vx, vy, vz, life, size, r, g, b, a, { grow = 1, drag = 1, buoy = 0, fade = 1 } = {}) {
    if (!this.free.length) return;
    const i = this.free.pop();
    this.p.push({ i, x, y, z, vx, vy, vz, life, max: life, size, r, g, b, a, grow, drag, buoy, fade });
  }

  smoke(x, y, z, dark = 0.3, n = 1) {
    for (let k = 0; k < n; k++) this.spawn(x + (Math.random() - 0.5) * 0.4, y, z + (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.6, 1.4 + Math.random(), (Math.random() - 0.5) * 0.6, 2.2, 1.0, dark, dark, dark * 1.05, 0.55, { grow: 2.2, drag: 0.8, buoy: 0.3 });
  }
  dust(x, z, n = 1, color = [0.72, 0.62, 0.48]) {
    for (let k = 0; k < n; k++) this.spawn(x, 0.2, z, (Math.random() - 0.5) * 1.5, 0.4 + Math.random() * 0.4, (Math.random() - 0.5) * 1.5, 1.1, 0.9, color[0], color[1], color[2], 0.35, { grow: 2.5, drag: 1.5 });
  }
  tyreSmoke(x, z) { this.spawn(x, 0.3, z, (Math.random() - 0.5) * 0.8, 0.5, (Math.random() - 0.5) * 0.8, 1.4, 0.8, 0.85, 0.85, 0.85, 0.32, { grow: 3, drag: 1.2 }); }
  sparks(x, y, z, n = 8) {
    for (let k = 0; k < n; k++) this.spawn(x, y, z, (Math.random() - 0.5) * 7, 2 + Math.random() * 3, (Math.random() - 0.5) * 7, 0.35 + Math.random() * 0.3, 0.12, 1, 0.75, 0.3, 1, { grow: 0.3, drag: 0.5, buoy: -9 });
  }
  fire(x, y, z) {
    this.spawn(x + (Math.random() - 0.5) * 0.6, y, z + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.4, 1.8 + Math.random(), (Math.random() - 0.5) * 0.4, 0.6, 0.9, 1, 0.55 + Math.random() * 0.2, 0.15, 0.8, { grow: 0.6, drag: 0.5 });
  }
  explosion(x, y, z) {
    for (let k = 0; k < 40; k++) {
      const a = Math.random() * 6.28, s = 2 + Math.random() * 7;
      this.spawn(x, y + 0.5, z, Math.cos(a) * s, 2 + Math.random() * 6, Math.sin(a) * s, 0.7 + Math.random() * 0.5, 1.6, 1, 0.5 + Math.random() * 0.3, 0.1, 0.95, { grow: 2.2, drag: 2.5 });
    }
    for (let k = 0; k < 24; k++) this.smoke(x + (Math.random() - 0.5) * 3, y + 1, z + (Math.random() - 0.5) * 3, 0.15, 1);
    this.sparks(x, y + 1, z, 30);
    this.flashes.push({ x, y: y + 2, z, t: 0.5 });
  }
  splash(x, z) {
    for (let k = 0; k < 20; k++) this.spawn(x, -2.6, z, (Math.random() - 0.5) * 4, 3 + Math.random() * 3, (Math.random() - 0.5) * 4, 0.9, 0.5, 0.8, 0.9, 1, 0.7, { grow: 1.5, buoy: -9 });
  }

  skid(vehicle, x, z, heading, width = 0.22) {
    const key = vehicle.id * 10 + Math.round(x * 0) ;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    m.compose(new THREE.Vector3(x, 0.085, z), q, new THREE.Vector3(width, 1, 0.55));
    this.skids.setMatrixAt(this.skidI, m);
    this.skidI = (this.skidI + 1) % this.skidN;
    this.skids.count = Math.min(this.skidN, this.skids.count + 1);
    this.skids.instanceMatrix.needsUpdate = true;
    void key;
  }

  update(dt, camera, weather = {}) {
    const P = this.p;
    for (let k = P.length - 1; k >= 0; k--) {
      const p = P[k];
      p.life -= dt;
      if (p.life <= 0) { this.size[p.i] = 0; this.col[p.i * 4 + 3] = 0; this.free.push(p.i); P[k] = P[P.length - 1]; P.pop(); continue; }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vz *= d; p.vy = p.vy * d + p.buoy * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const t = 1 - p.life / p.max;
      const i = p.i;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      this.size[i] = p.size * (1 + t * p.grow);
      this.col[i * 4] = p.r; this.col[i * 4 + 1] = p.g; this.col[i * 4 + 2] = p.b; this.col[i * 4 + 3] = p.a * (1 - t * t);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.pcolor.needsUpdate = true; g.attributes.psize.needsUpdate = true;
    this.mat.uniforms.scale.value = innerHeight * 0.9;
    // Explosion flashes light the street.
    let li = 0;
    for (let k = this.flashes.length - 1; k >= 0; k--) {
      const f = this.flashes[k]; f.t -= dt;
      if (f.t <= 0) { this.flashes.splice(k, 1); continue; }
      this.light.position.set(f.x, f.y, f.z); li = Math.max(li, f.t * 60);
    }
    this.light.intensity = li;
    // Rain follows the camera.
    const rainOn = weather.rain > 0.3;
    this.rain.visible = rainOn;
    if (rainOn) {
      this.rainY = (this.rainY - dt * 22) % 30;
      this.rain.position.set(camera.position.x, camera.position.y - 8 + ((this.rainY + 30) % 30) - 15, camera.position.z);
      this.rain.material.opacity = 0.16 + weather.rain * 0.22;
    }
    this.markers.update(dt);
  }
}

/** Mission markers: glowing columns on the ground and bobbing arrows over targets. */
export class Markers {
  constructor(scene) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffc83d, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 32, 1, true);
    cyl.translate(0, 0.5, 0);
    // Fade toward the top with vertex colours.
    const cols = [];
    const pos = cyl.attributes.position;
    for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); const a = 1 - y; cols.push(a, a, a); }
    cyl.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    mat.vertexColors = true;
    this.column = new THREE.InstancedMesh(cyl, mat, 32);
    this.column.count = 0; this.column.frustumCulled = false; this.column.renderOrder = 4;
    scene.add(this.column);
    const ring = new THREE.RingGeometry(0.85, 1, 40).rotateX(-Math.PI / 2);
    this.ring = new THREE.InstancedMesh(ring, new THREE.MeshBasicMaterial({ color: 0xffc83d, transparent: true, opacity: 0.85, depthWrite: false }), 32);
    this.ring.count = 0; this.ring.frustumCulled = false;
    scene.add(this.ring);
    const arrow = new THREE.ConeGeometry(0.45, 0.9, 4).rotateX(Math.PI);
    this.arrow = new THREE.InstancedMesh(arrow, new THREE.MeshBasicMaterial({ color: 0xffc83d }), 32);
    this.arrow.count = 0; this.arrow.frustumCulled = false;
    scene.add(this.arrow);
    this.list = [];
    this.t = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._c = new THREE.Color();
  }
  /** kind: 'column' (go here), 'arrow' (target above x/y/z). color hex. */
  set(list) { this.list = list; }
  update(dt) {
    this.t += dt;
    let c = 0, a = 0;
    const m = this._m, q = this._q;
    for (const mk of this.list) {
      const col = this._c.set(mk.color ?? 0xffc83d);
      if (mk.kind === 'arrow') {
        if (a >= 32) continue;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.t * 2.5);
        m.compose(new THREE.Vector3(mk.x, (mk.y ?? 2.6) + Math.sin(this.t * 4) * 0.25, mk.z), q, new THREE.Vector3(1, 1, 1));
        this.arrow.setMatrixAt(a, m); this.arrow.setColorAt(a, col); a++;
      } else {
        if (c >= 32) continue;
        const r = mk.r ?? 2.5, h = mk.h ?? 3.2;
        q.identity();
        m.compose(new THREE.Vector3(mk.x, (mk.y ?? 0) + 0.05, mk.z), q, new THREE.Vector3(r, h * (0.94 + Math.sin(this.t * 3) * 0.06), r));
        this.column.setMatrixAt(c, m); this.column.setColorAt(c, col);
        m.compose(new THREE.Vector3(mk.x, (mk.y ?? 0) + 0.12, mk.z), q, new THREE.Vector3(r, 1, r));
        this.ring.setMatrixAt(c, m); this.ring.setColorAt(c, col);
        c++;
      }
    }
    this.column.count = c; this.ring.count = c; this.arrow.count = a;
    for (const o of [this.column, this.ring, this.arrow]) { o.instanceMatrix.needsUpdate = true; if (o.instanceColor) o.instanceColor.needsUpdate = true; }
  }
}
