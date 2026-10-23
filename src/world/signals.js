// Traffic signals at the big chowks: a pole on the left-hand kerb of every road
// into a signalled crossing, its head facing the oncoming traffic, lit with the
// same cycle the traffic obeys (Traffic.signalState).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const LAMP_Y = [3.38, 3.1, 2.82]; // red, amber, green from the top
const LIT = { red: [2.8, 0.16, 0.1], amber: [2.6, 1.25, 0.08], green: [0.15, 2.4, 0.9] };
const DIM = [[0.16, 0.02, 0.02], [0.16, 0.09, 0.01], [0.01, 0.12, 0.05]];

export class Signals {
  constructor(scene, net, traffic, colliders) {
    this.net = net;
    this.traffic = traffic;
    this.heads = [];
    const p = {};
    for (const [j, sig] of traffic.signals) {
      for (const road of net.jRoads[j]) {
        // Only roads that bring traffic into the crossing, and not the short links within it.
        const dir = net.rb[road] === j ? 1 : -1;
        if (net.ra[road] === net.rb[road] || !net.canTravel(road, dir) || traffic._link(sig.junctions, road)) continue;
        const s = dir > 0 ? net.length[road] - net.trimEnd(road) : net.trimStart(road);
        net.pointAt(road, s, p);
        const fx = p.dx * dir, fz = p.dz * dir;
        // On the kerb to the drivers' left, just short of the stop line.
        const off = net.edgeAt(road, s, dir) + 0.55;
        const x = p.x + fz * off - fx * 1.2, z = p.z - fx * off - fz * 1.2;
        this.heads.push({ j, road, x, z, rot: Math.atan2(-fx, -fz), state: '' });
        colliders?.addCircle(x, z, 0.12, 3.6);
      }
    }
    const n = this.heads.length;
    // Grey pole with a black head and visor; three lamps on its face.
    const pole = new THREE.CylinderGeometry(0.06, 0.07, 3.6, 8).translate(0, 1.8, 0);
    const head = new THREE.BoxGeometry(0.34, 0.92, 0.22).translate(0, 3.1, 0.02);
    const visor = new THREE.BoxGeometry(0.4, 0.04, 0.16).translate(0, 3.58, 0.18);
    this.poles = new THREE.InstancedMesh(mergeGeometries([pole, head, visor]), new THREE.MeshStandardMaterial({ color: 0x23272a, roughness: 0.6, metalness: 0.4 }), Math.max(1, n));
    this.lamps = new THREE.InstancedMesh(new THREE.CircleGeometry(0.1, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true }), Math.max(1, n * 3));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), c = new THREE.Color();
    this.heads.forEach((h, i) => {
      q.setFromEuler(e.set(0, h.rot, 0));
      this.poles.setMatrixAt(i, m.compose(v.set(h.x, 0, h.z), q, one));
      for (let k = 0; k < 3; k++) {
        v.set(0, LAMP_Y[k], 0.135).applyQuaternion(q).add(new THREE.Vector3(h.x, 0, h.z));
        this.lamps.setMatrixAt(i * 3 + k, m.compose(v, q, one));
        this.lamps.setColorAt(i * 3 + k, c.setRGB(...DIM[k]));
      }
    });
    this.poles.count = n; this.lamps.count = n * 3;
    this.poles.castShadow = true;
    for (const mesh of [this.poles, this.lamps]) { mesh.frustumCulled = false; mesh.visible = n > 0; scene.add(mesh); }
    this._c = c;
    this.t = 0;
  }

  /** Relight the lamps for game time t (a few times a second is plenty). */
  update(dt, t) {
    if ((this.t -= dt) > 0 || !this.heads.length) return;
    this.t = 0.2;
    let changed = false;
    this.heads.forEach((h, i) => {
      const state = this.traffic.signalState(h.j, h.road, t);
      if (state === h.state) return;
      h.state = state; changed = true;
      const lit = state === 'red' ? 0 : state === 'amber' ? 1 : 2;
      for (let k = 0; k < 3; k++) this.lamps.setColorAt(i * 3 + k, k === lit ? this._c.setRGB(...LIT[state]) : this._c.setRGB(...DIM[k]));
    });
    if (changed) this.lamps.instanceColor.needsUpdate = true;
  }
}
