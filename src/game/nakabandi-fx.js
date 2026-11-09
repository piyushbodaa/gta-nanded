// What a nakabandi looks like: yellow-black steel barricades, the tyre-killer strip and the police
// drone. Three instanced meshes on one vertex-coloured material, empty and hidden until in use,
// added before the menu rehearses the start so their shaders compile there (game.getReady).
import * as THREE from 'three';
import { sendFirst } from '../core/buffers.js';

const BARS = 24, STRIPS = 2;
const YELLOW = [0.95, 0.75, 0.05], BLACK = [0.06, 0.06, 0.06], STEEL = [0.55, 0.56, 0.58], DARK = [0.12, 0.12, 0.13];
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler(), _c = new THREE.Color();

/** Merge boxes [w, h, d, x, y, z, colour, rotY?] into one vertex-coloured geometry. */
function boxes(list) {
  const pos = [], col = [];
  for (const [w, h, d, x, y, z, c, ry = 0] of list) {
    const g = new THREE.BoxGeometry(w, h, d).rotateY(ry).translate(x, y, z).toNonIndexed();
    const p = g.attributes.position.array;
    pos.push(...p);
    for (let i = 0; i < p.length / 3; i++) col.push(c[0], c[1], c[2]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** A 2 m steel barricade across local x: two striped rails on splayed black feet. */
export function barricadeGeometry() {
  const list = [];
  for (const y of [0.95, 0.5]) for (let k = 0; k < 8; k++) list.push([0.25, y > 0.7 ? 0.24 : 0.16, 0.06, -0.875 + k * 0.25, y, 0, k % 2 ? BLACK : YELLOW]);
  for (const x of [-0.92, 0.92]) {
    list.push([0.06, 1.08, 0.06, x, 0.54, 0, STEEL]);
    list.push([0.1, 0.05, 0.6, x, 0.025, 0, BLACK]);
  }
  return boxes(list);
}

/** The tyre killer, 2 m long across local x (scaled to the road): a dark mat with rows of steel teeth. */
export function stripGeometry() {
  const list = [[2, 0.03, 0.56, 0, 0.015, 0, DARK]];
  for (let k = 0; k < 20; k++) for (const z of [-0.14, 0.14]) list.push([0.03, 0.09, 0.03, -0.95 + k * 0.1, 0.06, z + (k % 2) * 0.05, STEEL]);
  return boxes(list);
}

/** A quadcopter about a metre across with red and blue lamps (the instance colour flashes it). */
export function droneGeometry() {
  const list = [[0.45, 0.16, 0.45, 0, 0, 0, DARK], [0.2, 0.1, 0.2, 0, -0.12, 0.1, BLACK]];
  for (const a of [Math.PI / 4, -Math.PI / 4]) list.push([1.3, 0.05, 0.07, 0, 0.04, 0, STEEL, a]);
  for (const [x, z] of [[0.46, 0.46], [-0.46, 0.46], [0.46, -0.46], [-0.46, -0.46]]) list.push([0.42, 0.015, 0.42, x, 0.1, z, [0.3, 0.3, 0.32]]);
  list.push([0.1, 0.06, 0.1, 0.12, -0.1, 0.24, [1, 0.15, 0.1]], [0.1, 0.06, 0.1, -0.12, -0.1, 0.24, [0.15, 0.3, 1]]);
  return boxes(list);
}

export class NakabandiFx {
  constructor(game) {
    this.game = game;
    this.t = 0;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 });
    const inst = (geo, n, name, shadow) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0; m.frustumCulled = false; m.name = name; m.castShadow = shadow; m.receiveShadow = true;
      game.scene?.add(m);
      return m;
    };
    this.bars = inst(barricadeGeometry(), BARS, 'naka-barricades', true);
    this.strips = inst(stripGeometry(), STRIPS, 'naka-strips', false);
    this.drone = inst(droneGeometry(), 1, 'naka-drone', false);
    this.drone.setColorAt(0, _c.setRGB(1, 1, 1));
    this._all = [this.bars, this.strips, this.drone];
    this.update(0);
  }

  update(dt) {
    const g = this.game, N = g.nakabandi;
    this.t += dt;
    let nb = 0, ns = 0, nd = 0;
    if (N) {
      for (const b of N.blocks) {
        const y = 0.02;
        for (const bar of b.bars) {
          if (nb >= BARS) break;
          _e.set(0, bar.rot, 0); _q.setFromEuler(_e); _p.set(bar.x, y, bar.z); _s.set(1, 1, 1);
          this.bars.setMatrixAt(nb++, _m.compose(_p, _q, _s));
        }
        const S = b.strip;
        if (S?.live && ns < STRIPS) {
          _e.set(0, S.rot, 0); _q.setFromEuler(_e); _p.set(S.x, 0.02, S.z); _s.set(S.hw, 1, 1);
          this.strips.setMatrixAt(ns++, _m.compose(_p, _q, _s));
        }
      }
      const D = N.drone;
      if (D) {
        // Nose down into its flight, a wobble when it falls.
        const fall = D.state === 'fall';
        _e.set(fall ? Math.sin(this.t * 9) * 0.6 : (D.vz || 0) * 0.02, Math.atan2(D.vx || 0, D.vz || 1), fall ? this.t * 4 : -(D.vx || 0) * 0.02, 'YXZ');
        _q.setFromEuler(_e); _p.set(D.x, D.y, D.z); _s.set(1.4, 1.4, 1.4);
        this.drone.setMatrixAt(nd++, _m.compose(_p, _q, _s));
        const red = Math.floor(this.t * 6) % 2 === 0;
        this.drone.setColorAt(0, fall ? _c.setRGB(0.5, 0.5, 0.5) : red ? _c.setRGB(1.25, 0.8, 0.8) : _c.setRGB(0.8, 0.85, 1.3));
        sendFirst(this.drone.instanceColor, 1);
      }
    }
    this.bars.count = nb; this.strips.count = ns; this.drone.count = nd;
    // Shown while the menu compiles shaders (nothing drawn: count 0), then only when in use.
    const live = g.started ?? true;
    for (const m of this._all) {
      m.visible = !live || m.count > 0;
      sendFirst(m.instanceMatrix, m.count);
    }
  }
}
