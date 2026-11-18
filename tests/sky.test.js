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

test('rain fades in and out while streets soak, stay wet at full saturation and then dry more slowly', () => {
  const sky = new Sky(new THREE.Scene(), null), focus = new THREE.Vector3();
  sky.setWeather('rain');
  sky.update(1, focus);
  assert.ok(sky.w.rain > 0 && sky.w.rain < 1);
  const shower = sky.w.rain, wet = sky.wet;
  sky.update(0, focus, false);
  assert.equal(sky.w.rain, shower);
  assert.equal(sky.wet, wet);
  for (let i = 0; i < 18; i++) sky.update(1, focus);
  assert.equal(sky.wet, 1);
  assert.ok(sky.sun.shadow.intensity < 0.5);
  sky.setWeather('haze');
  for (let i = 0; i < 15; i++) sky.update(1, focus);
  assert.ok(sky.w.rain < 0.001 && sky.wet > 0.7);
  sky.update(0, focus);
  assert.equal(sky.w.rain, 0);
  assert.equal(sky.wet, 0);
});

test('unlit roads and shaded figures retain diffuse light through the night, even in rain', () => {
  const sky = new Sky(new THREE.Scene(), null);
  sky.frozen = true; sky.bounceOn = false; // the phone tier without shadow maps or sun bounce
  for (const weather of ['clear', 'rain']) {
    sky.setWeather(weather);
    for (const hour of [19, 22, 0, 3, 5]) {
      sky.hours = hour; sky.update(0, new THREE.Vector3());
      const fill = sky.hemi.intensity * sky.look.exposure;
      assert.ok(fill * sky.hemi.color.g > .42, `upward-facing road, ${hour}h ${weather}`);
      assert.ok(fill * sky.hemi.groundColor.g > .25, `faces in shade, ${hour}h ${weather}`);
    }
  }
});
