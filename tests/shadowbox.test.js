import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Sky } from '../src/world/sky.js';
import { inShadowBox } from '../src/actors/humans.js';

test('people and vehicles skip the shadow pass only where the sun camera cannot see them', () => {
  const sky = new Sky(new THREE.Scene(), null);
  sky.frozen = true;
  const focus = { x: 140, y: 0, z: -60 }, v = new THREE.Vector3();
  let inside = 0, outside = 0;
  // Morning, mid-morning, noon, evening and moonlight.
  for (const hours of [7.2, 10.5, 12.5, 17.6, 23]) {
    sky.hours = hours;
    sky.update(0.016, focus);
    sky.sun.updateMatrixWorld();
    sky.sun.shadow.updateMatrices(sky.sun);
    const cam = sky.sun.shadow.camera;
    for (let i = 0; i < 3000; i++) {
      const x = focus.x + (i % 60 - 30) * 10 + 0.37, z = focus.z + (Math.floor(i / 60) - 25) * 12 + 0.61, y = (i % 7) * 0.4;
      v.set(x, y, z).applyMatrix4(cam.matrixWorldInverse);
      const seen = Math.abs(v.x) <= cam.right && Math.abs(v.y) <= cam.top;
      // Float error only matters right on the edge.
      if (Math.abs(Math.abs(v.x) - cam.right) < 0.01 || Math.abs(Math.abs(v.y) - cam.top) < 0.01) continue;
      assert.equal(inShadowBox(sky.shadowBox, x, y, z, 0), seen, `${hours} h at ${x.toFixed(1)}, ${z.toFixed(1)}`);
      if (seen) inside++; else outside++;
    }
  }
  assert.ok(inside > 1000 && outside > 1000, `${inside} inside, ${outside} outside`);
  // Without a box (no shadows yet), everything casts.
  assert.equal(inShadowBox(null, 1e4, 0, 1e4, 0), true);
});
