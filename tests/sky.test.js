import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Sky } from '../src/world/sky.js';

test('at dusk and dawn the light fades between sun and moon instead of jumping across the sky', () => {
  const sky = new Sky(new THREE.Scene(), null);
  sky.frozen = true;
  const focus = new THREE.Vector3();
  // The direct light as one vector: where it comes from, as long as it is strong.
  const light = () => sky.sun.position.clone().normalize().multiplyScalar(sky.sun.intensity);
  for (const [from, to] of [[17.5, 18.75], [5.25, 6.5]]) {
    let prev = null, worst = 0;
    for (let m = 0; m <= (to - from) * 60; m++) {
      sky.hours = from + m / 60;
      sky.update(0, focus);
      const v = light();
      if (prev) worst = Math.max(worst, v.distanceTo(prev));
      prev = v;
    }
    assert.ok(worst < 0.5, `${from}-${to} h: the light changes by up to ${worst.toFixed(2)} in a game minute`);
  }
  // Night keeps its moonlight, and day its sun.
  sky.hours = 23; sky.update(0, focus);
  assert.ok(sky.sun.intensity > 0.1 && sky.sun.position.y > 0, 'moonlight from above at night');
  sky.hours = 17.5; sky.update(0, focus);
  assert.ok(sky.sun.intensity > 2, 'evening sun at full strength');
});
