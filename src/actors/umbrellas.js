// A rain canopy has eight slightly bowed panels, a bound hem and a metal shaft.
// The origin is the grip in the right hand. All the umbrellas share one mesh.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from '../core/math.js';
import { HAND_GRIP } from './gun-models.js';

const COLOURS = [0x263952, 0x394351, 0x23696e, 0x92464f, 0x4d5784, 0xb7853c];

export function rainGearFor(seed) {
  const r = rng(seed ^ 0x4714d2c9);
  return r.chance(0.58) ? { colour: r.pick(COLOURS), threshold: r.range(0.18, 0.57) } : null;
}

function canopyGeometry() {
  const pos = [], shades = [], indices = [];
  const rings = [[0.009, 0.95], [0.3, 0.914], [0.49, 0.827], [0.608, 0.698], [0.616, 0.675]];
  for (let panel = 0; panel < 8; panel++) {
    const first = pos.length / 3;
    for (let row = 0; row < rings.length; row++) {
      const [radius, height] = rings[row];
      for (let col = 0; col <= 4; col++) {
        const t = col / 4, angle = (panel + t) * Math.PI / 4;
        const bow = Math.sin(t * Math.PI), r = radius * (1 - 0.052 * bow);
        pos.push(r * Math.sin(angle), height + bow * radius * 0.049, r * Math.cos(angle));
        const shade = (row === 4 ? 0.39 : panel % 2 ? 0.87 : 1) * (col === 0 || col === 4 ? 0.79 : 1);
        shades.push(shade, shade, shade);
        if (row < rings.length - 1 && col < 4) {
          const i = first + row * 5 + col;
          indices.push(i, i + 5, i + 6, i, i + 6, i + 1);
        }
      }
    }
  }
  const clothVertices = pos.length / 3;
  // The sliding runner braces the eight ribs from below. Two crossed strips keep each
  // thin spoke visible edge-on, without paying for a cylinder at every joint.
  for (let rib = 0; rib < 8; rib++) {
    const a = rib * Math.PI / 4, x = Math.sin(a), z = Math.cos(a);
    for (const [r0, y0, r1, y1] of [[0.009, 0.53, 0.295, 0.895], [0.295, 0.895, 0.49, 0.814], [0.49, 0.814, 0.611, 0.675]]) {
      for (const [dx, dy, dz] of [[z * 0.0035, 0, -x * 0.0035], [0, 0.0035, 0]]) {
        const first = pos.length / 3;
        pos.push(r0 * x - dx, y0 - dy, r0 * z - dz, r0 * x + dx, y0 + dy, r0 * z + dz,
          r1 * x + dx, y1 + dy, r1 * z + dz, r1 * x - dx, y1 - dy, r1 * z - dz);
        for (let i = 0; i < 4; i++) shades.push(0.27, 0.28, 0.29);
        indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
      }
    }
  }
  const canopy = new THREE.BufferGeometry();
  canopy.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  canopy.setAttribute('color', new THREE.Float32BufferAttribute(shades, 3));
  canopy.setAttribute('hardware', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3).fill(1, clothVertices), 1));
  canopy.setIndex(indices);
  canopy.computeVertexNormals();
  const parts = [canopy];
  for (const [radius, bottom, top, shade] of [[0.009, -0.07, 0.97, 0.62], [0.023, -0.11, 0.065, 0.095], [0.014, 0.94, 0.983, 0.11]]) {
    const part = new THREE.CylinderGeometry(radius, radius, top - bottom, 7).translate(0, (bottom + top) / 2, 0);
    part.deleteAttribute('uv');
    part.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(part.attributes.position.count * 3).fill(shade), 3));
    part.setAttribute('hardware', new THREE.Float32BufferAttribute(new Float32Array(part.attributes.position.count).fill(1), 1));
    parts.push(part);
  }
  return mergeGeometries(parts);
}

export function makeUmbrellas(capacity) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.47, side: THREE.DoubleSide });
  // The nylon takes each walker's colour; all handles and spokes retain their own finish.
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'attribute float hardware;\n' + shader.vertexShader.replace('#include <color_vertex>',
      '#include <color_vertex>\nvColor.rgb = mix(vColor.rgb, color.rgb, hardware);');
  };
  const mesh = new THREE.InstancedMesh(canopyGeometry(), material, capacity);
  mesh.name = 'rain-umbrellas';
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.setColorAt(0, new THREE.Color());
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.visible = false;
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  return mesh;
}

const position = new THREE.Vector3(), rotation = new THREE.Euler(0, 0, 0, 'YXZ');
const quaternion = new THREE.Quaternion(), scale = new THREE.Vector3(), matrix = new THREE.Matrix4(), colour = new THREE.Color();
const [gx, gy, gz] = HAND_GRIP;

/** The handle follows the animated fist while the canopy tips back over the walker's head. */
export function placeUmbrella(mesh, h, bones, arm) {
  const d = bones;
  position.set(d[arm + 3] + gx * d[arm] + gy * d[arm + 1] + gz * d[arm + 2],
    d[arm + 7] + gx * d[arm + 4] + gy * d[arm + 5] + gz * d[arm + 6],
    d[arm + 11] + gx * d[arm + 8] + gy * d[arm + 9] + gz * d[arm + 10]);
  const sway = Math.min(1, h.anim.spd) * Math.cos(h.anim.ph);
  rotation.set(-0.15, h.yaw + h.anim.root.yaw, -0.24 + 0.022 * sway);
  const width = 0.1 + 0.9 * h.umbrellaLift, s = h.outfit.scale;
  scale.set(width * s, s, width * s);
  mesh.setMatrixAt(mesh.count, matrix.compose(position, quaternion.setFromEuler(rotation), scale));
  mesh.setColorAt(mesh.count++, colour.setHex(h.rainGear.colour));
}
