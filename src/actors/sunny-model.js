// Sunny's shirt and jeans each form one continuous skinned surface. Shared vertices at the
// armholes and crotch keep the garment together when the shoulders or hips rotate.
import * as THREE from 'three';
import { BODY } from './anim.js';

const TAU = Math.PI * 2;

function garment() {
  const positions = [], indices = [], uv = [];
  return {
    point(x, y, z, limbWeight = 0) {
      positions.push(x, y, z);
      uv.push(limbWeight, 0);
      return uv.length / 2 - 1;
    },
    quad(a, b, c, d, reverse = false) {
      if (reverse) indices.push(a, c, b, a, d, c);
      else indices.push(a, b, c, a, c, d);
    },
    finish() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(indices);
      g.computeVertexNormals();
      return g;
    },
  };
}

export function sunnyShirt(torso, ringPoint) {
  const g = garment(), n = 48, first = 7, last = 15;
  const rings = torso.map(([y, rx, rf, rb, dz = 0], j) => Array.from({ length: n }, (_, i) => {
    const a = i * TAU / n;
    const [x, z] = ringPoint(a, rx, rf, rb, 2.3);
    const fold = 1 + (0.018 * Math.sin(7 * a + 8 * y) + 0.013 * Math.sin(13 * a - 5 * y)) * Math.max(0, 1 - y / 0.48);
    const arm = Math.max(0, (Math.abs(x) - 0.12) / 0.12) * (j >= first && j <= last ? 0.55 : 0);
    return g.point(x * fold, y - (j === 0 ? 0.024 * Math.cos(a) ** 2 : 0), z * fold + dz, arm);
  }));
  for (let j = 0; j < rings.length - 1; j++) {
    for (let i = 0; i < n; i++) {
      const quadrant = i % (n / 2);
      if (j >= first && j < last && quadrant >= 6 && quadrant < 18) continue;
      const k = (i + 1) % n;
      g.quad(rings[j][i], rings[j][k], rings[j + 1][k], rings[j + 1][i]);
    }
  }
  // Turn the neckband in under the collar so the shirt is closed where it meets the neck.
  const neck = Array.from({ length: n }, (_, i) => {
    const a = i * TAU / n;
    return g.point(0.044 * Math.sin(a), 0.623, 0.043 * Math.cos(a) - 0.006);
  });
  const top = rings.at(-1);
  for (let i = 0; i < n; i++) { const k = (i + 1) % n; g.quad(top[i], top[k], neck[k], neck[i]); }
  // Trace each opening from the top front, round the back and under the arm. Continue
  // the very same ring down the upper arm, ending in a doubled-over cuff.
  for (const side of [1, -1]) {
    let previous = [];
    const angles = [];
    const edge = (j, i, a) => { previous.push(rings[j][(side * i + n) % n]); angles.push(a); };
    for (let i = 6; i < 18; i++) edge(last, i, Math.PI * (0.25 + 0.5 * (i - 6) / 12));
    for (let j = last; j > first; j--) edge(j, 18, Math.PI * (0.75 + 0.5 * (last - j) / (last - first)));
    for (let i = 18; i > 6; i--) edge(first, i, Math.PI * (1.25 + 0.5 * (18 - i) / 12));
    for (let j = first; j < last; j++) edge(j, 6, Math.PI * (1.75 + 0.5 * (j - first) / (last - first)));
    for (const [y, x, radius, slope, weight] of [
      [0.478, 0.192, 0.054, 0.090, 0.50], [0.462, 0.206, 0.066, 0.089, 0.65],
      [0.450, 0.220, 0.066, 0.074, 0.78], [0.437, 0.227, 0.071, 0.040, 0.88],
      [0.401, 0.233, 0.067, 0.021, 1], [0.364, 0.235, 0.069, 0.012, 1],
      [0.334, 0.235, 0.063, 0.008, 1], [0.330, 0.235, 0.068, 0.008, 1],
      [0.302, 0.235, 0.067, 0.007, 1], [0.299, 0.235, 0.059, 0.007, 1],
    ]) {
      const row = angles.map(a => g.point(side * (x + radius * Math.sin(a)), y + slope * Math.sin(a), radius * 1.14 * Math.cos(a), weight));
      row.forEach((v, i) => { const k = (i + 1) % row.length; g.quad(v, row[k], previous[k], previous[i], side < 0); });
      previous = row;
    }
  }
  return g.finish();
}

export function sunnyJeans(leg) {
  const g = garment(), n = 32, half = n / 2, waist = [], seam = [];
  // Each leg shares half the waistband and the inseam between the legs.
  for (let k = 0; k <= half; k++) {
    const a = k * Math.PI / half;
    seam.push(g.point(0, -0.045 - 0.097 * Math.sin(a) ** 2, -0.104 * Math.cos(a)));
  }
  for (const side of [1, -1]) {
    let previous = [];
    const rim = [];
    for (let i = 0; i < n; i++) {
      const a = i * TAU / n;
      if (i === 0) rim.push(seam[half]);
      else if (i >= half) rim.push(seam[i - half]);
      else rim.push(g.point(side * 0.165 * Math.sin(a), -0.045, 0.104 * Math.cos(a)));
    }
    waist.push(rim.slice(0, half + 1));
    previous = rim;
    for (const [dy, rx, rf, rb] of leg.filter((r, i) => r[0] <= -0.13 && r[0] !== leg[i - 1]?.[0])) {
      const row = Array.from({ length: n }, (_, i) => {
        const a = i * TAU / n;
        const fold = 1 + 0.045 * Math.sin(3 * a + 62 * dy) + 0.018 * Math.cos(7 * a - 18 * dy);
        const front = Math.cos(a);
        return g.point(side * (BODY.hipX + rx * 1.15 * fold * Math.sin(a)), BODY.hipY + dy + 0.004 * Math.sin(2 * a + 13 * dy),
          (front > 0 ? rf : rb) * 1.15 * fold * front);
      });
      for (let i = 0; i < n; i++) { const k = (i + 1) % n; g.quad(row[i], row[k], previous[k], previous[i], side < 0); }
      previous = row;
    }
  }
  let previous = waist[0].concat(waist[1].slice(1, -1).reverse());
  for (const [y, rx, rz] of [[0, 0.171, 0.110], [0.07, 0.161, 0.100]]) {
    const row = Array.from({ length: n }, (_, i) => g.point(rx * Math.sin(i * TAU / n), y, rz * Math.cos(i * TAU / n)));
    for (let i = 0; i < n; i++) { const k = (i + 1) % n; g.quad(previous[i], previous[k], row[k], row[i]); }
    previous = row;
  }
  return g.finish();
}
