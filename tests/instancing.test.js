import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// Vehicles colour an instanced part only at index 0 when they make it (actors/vehicles.js) and never
// recolour the glass afterwards, so every later car's glass relies on the rest starting white.
test('instances that are never recoloured start white, so car glass keeps its tint', () => {
  const m = new THREE.InstancedMesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial(), 12);
  m.setColorAt(0, new THREE.Color(0xffffff));
  assert.deepEqual(Array.from(m.instanceColor.array), new Array(36).fill(1));
});
