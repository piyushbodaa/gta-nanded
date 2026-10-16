/** Geometry/collision smoke only. This canvas mock does not render or test WebGL. */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { NETWORK, PLACES, BOUNDS, SPAWN } from '../src/city-data.js';
import { blocked } from '../src/mechanics.js';
import { indexColliders } from '../src/navigation.js';

// createCityLabels only needs these drawing methods to build its atlas geometry.
// Text metrics are deliberately approximate; font appearance requires a browser.
globalThis.document = {
  createElement(type) {
    assert.equal(type, 'canvas');
    return {
      width: 0, height: 0,
      getContext(kind) {
        assert.equal(kind, '2d');
        return { fillRect() {}, strokeRect() {}, fillText() {}, measureText(text) { return { width: String(text).length * 17 }; } };
      },
    };
  },
};
const { createWorld } = await import('../src/world.js');
const started = performance.now();
const world = createWorld(new THREE.Scene());
indexColliders(world.colliders);
const issues = [];
const report = (kind, detail) => { issues.push({ kind, ...detail }); };
const finite = value => typeof value === 'number' && Number.isFinite(value);
const inside = (p, radius = 0) => p.x >= BOUNDS.minX + radius && p.x <= BOUNDS.maxX - radius && p.z >= BOUNDS.minZ + radius && p.z <= BOUNDS.maxZ - radius;

assert.ok(PLACES.length > 0, 'No researched places loaded');
assert.ok(NETWORK.nodes.length > 0 && NETWORK.edges.length > 0, 'No road graph loaded');
for (let index = 0; index < world.colliders.length; index++) {
  const c = world.colliders[index];
  if (!['x', 'z', 'w', 'd', 'h', 'rotation'].every(key => finite(c[key]))) report('nonfinite-collider', { index, collider: c });
  else if (c.w <= 0 || c.d <= 0 || c.h <= 0) report('nonpositive-collider', { index, collider: c });
  else {
    const cos = Math.cos(c.rotation), sin = Math.sin(c.rotation);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const p = { x: c.x + sx * c.w / 2 * cos + sz * c.d / 2 * sin, z: c.z - sx * c.w / 2 * sin + sz * c.d / 2 * cos };
      if (!inside(p)) report('collider-outside-bounds', { index, corner: p });
    }
  }
}

const approachRadius = 3.5;
for (const p of PLACES) {
  if (!p.approach || !finite(p.approach.x) || !finite(p.approach.z)) { report('missing-approach', { id: p.id }); continue; }
  if (!inside(p.approach, approachRadius)) report('approach-outside-bounds', { id: p.id, approach: p.approach });
  if (blocked(p.approach.x, p.approach.z, approachRadius, world.colliders, BOUNDS)) report('blocked-approach', { id: p.id, name: p.name, approach: p.approach });
}
if (!SPAWN || !inside(SPAWN, approachRadius) || blocked(SPAWN.x, SPAWN.z, approachRadius, world.colliders, BOUNDS)) report('unsafe-spawn', { spawn: SPAWN });

// A 1.7-unit disc covers the largest car radius (1.6) with a small margin.
// Sample every 2 units, preserving both ends of every segment, including bends.
let roadSamples = 0, obstructedEdges = 0;
const roadRadius = 1.7, sampleInterval = 2;
for (let index = 0; index < NETWORK.edges.length; index++) {
  const e = NETWORK.edges[index], a = NETWORK.nodes[e.a], b = NETWORK.nodes[e.b];
  if (!a || !b || ![a.x, a.z, b.x, b.z].every(finite)) { report('invalid-road-edge', { index }); continue; }
  const length = Math.hypot(b.x - a.x, b.z - a.z), samples = Math.max(1, Math.ceil(length / sampleInterval));
  let firstObstruction = null;
  for (let n = 0; n <= samples; n++) {
    const t = n / samples, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
    roadSamples++;
    if (blocked(x, z, roadRadius, world.colliders, BOUNDS) && !firstObstruction) firstObstruction = { x, z };
  }
  if (firstObstruction) {
    obstructedEdges++;
    const nearestPlace = PLACES.reduce((best, p) => Math.hypot(p.x - firstObstruction.x, p.z - firstObstruction.z) < best.distance ? { id: p.id, distance: Math.hypot(p.x - firstObstruction.x, p.z - firstObstruction.z) } : best, { id: null, distance: Infinity });
    if (obstructedEdges <= 20) report('road-centerline-obstructed', { edge: index, name: e.name, position: firstObstruction, nearestPlace });
  }
}

let checkedMeshes = 0, checkedInstances = 0;
world.group.traverse(object => {
  if (!object.isInstancedMesh) return;
  checkedMeshes++; checkedInstances += object.count;
  if (!object.boundingSphere || !finite(object.boundingSphere.radius) || ![object.boundingSphere.center.x, object.boundingSphere.center.y, object.boundingSphere.center.z].every(finite)) report('invalid-instance-bounds', { name: object.name });
  if (!object.instanceColor) report('missing-instance-colors', { name: object.name });
  for (const value of object.instanceMatrix.array) if (!Number.isFinite(value)) { report('nonfinite-instance-matrix', { name: object.name }); break; }
});
const stats = world.getStats();
if (stats.placeCount !== PLACES.length || stats.signs < PLACES.length || stats.atlases !== 1) report('missing-place-signs', { stats });
const visibleAtSpawn = stats.visibleBatches;
world.setFocus({ x: BOUNDS.maxX + 20000, z: BOUNDS.maxZ + 20000 });
const visibleFarAway = world.getStats().visibleBatches;
if (visibleFarAway >= visibleAtSpawn) report('distance-culling-not-working', { visibleAtSpawn, visibleFarAway });
world.setFocus(SPAWN);

const result = {
  check: 'Node geometry and collision smoke — no WebGL rendering',
  result: issues.length ? 'FAIL' : 'PASS',
  elapsedMs: Math.round(performance.now() - started),
  places: PLACES.length, approachesChecked: PLACES.length, approachRadius,
  colliders: world.colliders.length, roadEdges: NETWORK.edges.length, roadSamples, roadRadius, obstructedEdges,
  checkedMeshes, checkedInstances, visibleAtSpawn, visibleFarAway, ...stats,
};
console.log(JSON.stringify(result, null, 2));
if (issues.length) {
  console.error(JSON.stringify({ issueCount: issues.length, issues: issues.slice(0, 40) }, null, 2));
  process.exitCode = 1;
}
