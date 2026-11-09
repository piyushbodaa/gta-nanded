// What the Jugaad Garage bolts on that the car models don't have: LED underglow (an additive
// glow on the road under the car, brighter at night) and a rear sticker (text from one small
// canvas atlas, one row per phrase). Two instanced meshes, at most 8 cars each; both skip their
// draw call when no car near needs them. Vehicles.render calls begin / add(v, matrix) / end(night).
import * as THREE from 'three';
import { NEON, STICKERS } from '../game/garage-data.js';
import { radialTexture } from '../world/citymat.js';
import { sendFirst } from '../core/buffers.js';

const CAP = 8, ROWS = 8, ATLAS = 512;
const _t = new THREE.Matrix4(), _w = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _c = new THREE.Color();
const _flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const _back = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

/** Where the sticker goes when the model gives no `decal` rectangle: [x, y, z, w, h] on the rear face. */
export function decalRect(v) {
  const d = v.model?.decal;
  if (d) return d;
  const s = v.spec || {};
  if (s.two) return [0, 0.62, -s.L / 2 + 0.12, 0.34, 0.08];
  const w = Math.min((s.W || 1.6) * 0.55, 1.0);
  return [0, (s.H || 1.5) * 0.42, -(s.L || 4) / 2 - 0.03, w, w * 0.2];
}

export class VehicleExtras {
  constructor(scene, game = null) {
    this.game = game;
    const plane = new THREE.PlaneGeometry(1, 1);
    // Underglow: the soft radial blob, additive, coloured per car.
    const glowMat = new THREE.MeshBasicMaterial({ map: typeof document !== 'undefined' ? radialTexture(64) : null, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5, fog: true });
    glowMat.polygonOffset = true; glowMat.polygonOffsetFactor = -2; glowMat.polygonOffsetUnits = -4;
    this.glow = new THREE.InstancedMesh(plane, glowMat, CAP);
    this.glow.setColorAt(0, _c.set(0xffffff));
    // Sticker: one row of the atlas per phrase, picked by the per-instance aRow.
    const geo = plane.clone();
    this.rows = new Float32Array(CAP);
    this.rowAttr = new THREE.InstancedBufferAttribute(this.rows, 1);
    this.rowAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aRow', this.rowAttr);
    this.canvas = typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: ATLAS, height: ATLAS }) : null;
    this.atlas = this.canvas ? new THREE.CanvasTexture(this.canvas) : new THREE.DataTexture(new Uint8Array([255, 255, 255, 0]), 1, 1);
    this.atlas.colorSpace = THREE.SRGBColorSpace;
    this.atlas.anisotropy = 4;
    const decalMat = new THREE.MeshBasicMaterial({ map: this.atlas, transparent: true, alphaTest: 0.05, depthWrite: false, fog: true });
    decalMat.polygonOffset = true; decalMat.polygonOffsetFactor = -1; decalMat.polygonOffsetUnits = -2;
    decalMat.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aRow;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>\n#ifdef USE_MAP\n  vMapUv.y = (vMapUv.y + ${(ROWS - 1).toFixed(1)} - aRow) / ${ROWS.toFixed(1)};\n#endif`);
    };
    decalMat.customProgramCacheKey = () => 'vehicle-sticker-atlas';
    this.decal = new THREE.InstancedMesh(geo, decalMat, CAP);
    for (const m of [this.glow, this.decal]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false;
      m.renderOrder = 2;
      scene?.add?.(m);
    }
    this.painted = false;
    this.gn = 0; this.dn = 0;
  }

  /** Paint the sticker atlas: once, the first time a sticker shows, and again when the fonts arrive. */
  paint() {
    if (this.painted || !this.canvas) { this.painted = true; return; }
    this.painted = true;
    const draw = () => {
      const x = this.canvas.getContext('2d');
      if (!x) return;
      const h = ATLAS / ROWS;
      x.clearRect(0, 0, ATLAS, ATLAS);
      STICKERS.forEach((text, i) => {
        const y = i * h;
        x.fillStyle = 'rgba(12, 12, 14, 0.85)';
        x.beginPath(); x.roundRect ? x.roundRect(4, y + 6, ATLAS - 8, h - 12, 10) : x.rect(4, y + 6, ATLAS - 8, h - 12); x.fill();
        let size = 40;
        x.font = `800 ${size}px "Noto Sans Devanagari", system-ui, sans-serif`;
        while (size > 18 && x.measureText(text).width > ATLAS - 36) { size -= 2; x.font = `800 ${size}px "Noto Sans Devanagari", system-ui, sans-serif`; }
        x.textAlign = 'center'; x.textBaseline = 'middle';
        x.lineWidth = 4; x.strokeStyle = '#111';
        x.fillStyle = i % 2 ? '#ffd54f' : '#ffffff';
        x.strokeText(text, ATLAS / 2, y + h / 2 + 2);
        x.fillText(text, ATLAS / 2, y + h / 2 + 2);
      });
      this.atlas.needsUpdate = true;
    };
    draw();
    globalThis.document?.fonts?.ready?.then?.(draw);
  }

  begin() { this.gn = 0; this.dn = 0; }

  /** Vehicles.render, for a car with neon or a sticker: `matrix` is the car's world matrix. */
  add(v, matrix) {
    const m = v.mods;
    if (!m) return;
    const s = v.spec || {};
    if (m.neon && NEON[m.neon] && this.gn < CAP) {
      _p.set(0, 0.05, 0); // on the road under the body (the car's origin is on the ground)
      _s.set((s.W || 1.6) * (s.two ? 2.6 : 1.9), (s.L || 4) * (s.two ? 1.3 : 1.35), 1);
      _t.compose(_p, _flat, _s);
      _w.multiplyMatrices(matrix, _t);
      this.glow.setMatrixAt(this.gn, _w);
      this.glow.setColorAt(this.gn, _c.set(NEON[m.neon].color));
      this.gn++;
    }
    if (m.sticker != null && m.sticker >= 0 && m.sticker < STICKERS.length && this.dn < CAP) {
      if (!this.painted) this.paint();
      const [x, y, z, w, h] = decalRect(v);
      _p.set(x, y, z); _s.set(w, h, 1);
      _t.compose(_p, _back, _s);
      _w.multiplyMatrices(matrix, _t);
      this.decal.setMatrixAt(this.dn, _w);
      this.rows[this.dn] = m.sticker;
      this.dn++;
    }
  }

  end(night = 0) {
    const warm = !(this.game?.started ?? true); // the start rehearsal compiles both while hidden-by-count
    this.glow.count = this.gn; this.decal.count = this.dn;
    sendFirst(this.glow.instanceMatrix, this.gn);
    if (this.glow.instanceColor) sendFirst(this.glow.instanceColor, this.gn);
    sendFirst(this.decal.instanceMatrix, this.dn);
    sendFirst(this.rowAttr, this.dn);
    this.glow.material.opacity = 0.32 + 0.5 * Math.min(1, Math.max(0, night));
    this.glow.visible = this.gn > 0 || warm;
    this.decal.visible = this.dn > 0 || warm;
  }
}
