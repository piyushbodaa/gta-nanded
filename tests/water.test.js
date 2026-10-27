import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './helpers.js';
import { createRivers } from '../src/world/water.js';

test('the river surface covers the water round every bend, with foam only along the banks', () => {
  const { city } = world();
  const rivers = createRivers({ add() {} }, city, null);
  const STEP = 4, rd = {};
  for (const [ri, mesh] of rivers.meshes.entries()) {
    const pos = mesh.geometry.getAttribute('position').array, edge = mesh.geometry.getAttribute('edge').array, idx = mesh.geometry.index.array;
    // The strip's bank shading (edge: 0 at the bank, 1 mid-river) at each grid point it covers.
    const cover = new Map();
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
      const ax = pos[a * 3], az = pos[a * 3 + 2], bx = pos[b * 3], bz = pos[b * 3 + 2], cx = pos[c * 3], cz = pos[c * 3 + 2];
      const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (!det) continue;
      for (let x = Math.ceil(Math.min(ax, bx, cx) / STEP) * STEP; x <= Math.max(ax, bx, cx); x += STEP) {
        for (let z = Math.ceil(Math.min(az, bz, cz) / STEP) * STEP; z <= Math.max(az, bz, cz); z += STEP) {
          const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det, l3 = 1 - l1 - l2;
          if (l1 >= 0 && l2 >= 0 && l3 >= 0) cover.set(`${x},${z}`, edge[a] * l1 + edge[b] * l2 + edge[c] * l3);
        }
      }
    }
    // Every point of this reach's water, away from its ends (where another reach takes over).
    const { p, w, name } = city.rivers[ri];
    const n = p.length / 2;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); }
    let water = 0;
    for (let x = Math.ceil((x0 - w) / STEP) * STEP; x <= x1 + w; x += STEP) {
      for (let z = Math.ceil((z0 - w) / STEP) * STEP; z <= z1 + w; z += STEP) {
        city.riverDistance(x, z, rd);
        if (rd.d > -1 || rd.w !== w) continue;
        let own = Infinity, end = false;
        for (let i = 0; i < n - 1; i++) {
          const ax = p[i * 2], az = p[i * 2 + 1], dx = p[i * 2 + 2] - ax, dz = p[i * 2 + 3] - az, l2 = dx * dx + dz * dz;
          const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
          const d = Math.hypot(ax + dx * t - x, az + dz * t - z) - w / 2;
          if (d < own) { own = d; end = (i === 0 && t === 0) || (i === n - 2 && t === 1); }
        }
        if (own > rd.d + 0.5 || end) continue;
        water++;
        const e = cover.get(`${x},${z}`);
        assert.ok(e !== undefined, `${name} ${ri}: open river bed with no water over it at ${x}, ${z}`);
        assert.ok(!(e < 0.08 && rd.d < -8), `${name} ${ri}: bank foam ${(-rd.d).toFixed(0)} m out in the water at ${x}, ${z}`);
      }
    }
    assert.ok(water > 1000, `${name} ${ri}: ${water} points of water`);
  }
});
