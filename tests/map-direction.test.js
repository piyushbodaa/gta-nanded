import test from 'node:test';
import assert from 'node:assert/strict';
import { mapHeading, destinationBearing } from '../src/map-direction.js';
import { driveStep } from '../src/mechanics.js';
import { SPAWN } from '../src/city-data.js';

// The marker's nose is at (0, -1) before CanvasRenderingContext2D.rotate().
function markerDirection(heading) {
  const angle = mapHeading(heading);
  return { x: Math.sin(angle), y: -Math.cos(angle) };
}

const diagonal = Math.SQRT1_2;
const directions = [
  ['north', 0, 0, -1],
  ['north-west', Math.PI / 4, -diagonal, -diagonal],
  ['west', Math.PI / 2, -1, 0],
  ['south-west', Math.PI * 3 / 4, -diagonal, diagonal],
  ['south', Math.PI, 0, 1],
  ['south-east', -Math.PI * 3 / 4, diagonal, diagonal],
  ['east', -Math.PI / 2, 1, 0],
  ['north-east', -Math.PI / 4, diagonal, -diagonal],
];

test('north-up map marker faces every cardinal and diagonal world direction', () => {
  for (const [name, heading, x, y] of directions) {
    const marker = markerDirection(heading);
    assert.ok(Math.abs(marker.x - x) < 1e-12, `${name}: horizontal direction`);
    assert.ok(Math.abs(marker.y - y) < 1e-12, `${name}: vertical direction`);
  }
});

test('map marker follows forward vehicle movement after steering and full rotations', () => {
  for (const heading of [SPAWN.heading, ...directions.map(([, angle]) => angle), Math.PI * 9, -Math.PI * 12.3]) {
    for (const input of [{ up: true }, { up: true, left: true }, { up: true, right: true }]) {
      const car = { kind: 'hatchback', speed: 12, heading, nitro: 100 };
      const movement = driveStep(car, input, 0.05);
      const length = Math.hypot(movement.dx, movement.dz);
      const marker = markerDirection(car.heading);
      // Screen y follows world z in both minimap and city guide projection.
      assert.ok(Math.abs(marker.x - movement.dx / length) < 1e-12);
      assert.ok(Math.abs(marker.y - movement.dz / length) < 1e-12);
    }
  }
});

test('map marker preserves vehicle facing when reversing', () => {
  const car = { kind: 'hatchback', speed: -8, heading: -Math.PI / 2, nitro: 100 };
  const movement = driveStep(car, { down: true }, 0.05);
  const marker = markerDirection(car.heading);
  assert.ok(marker.x > 0.99, 'east-facing vehicle arrow still points east');
  assert.ok(movement.dx < 0, 'reverse travel moves west');
});

test('destination arrow points toward all cardinal targets relative to the camera', () => {
  const position = { x: 43, z: -15 };
  // Destination order: north, east, south, west.
  const targets = [{ x: 43, z: -25 }, { x: 53, z: -15 }, { x: 43, z: -5 }, { x: 33, z: -15 }];
  const up = [0, -1], right = [1, 0], down = [0, 1], left = [-1, 0];
  const views = [
    [0, [up, right, down, left]],
    [Math.PI / 2, [right, down, left, up]],
    [Math.PI, [down, left, up, right]],
    [-Math.PI / 2, [left, up, right, down]],
  ];
  for (const [view, expected] of views) {
    targets.forEach((target, index) => {
      const angle = destinationBearing(position, target, view);
      assert.ok(Math.abs(Math.sin(angle) - expected[index][0]) < 1e-12);
      assert.ok(Math.abs(-Math.cos(angle) - expected[index][1]) < 1e-12);
      assert.ok(angle >= -Math.PI && angle <= Math.PI);
    });
  }
});

test('destination bearing wraps repeated camera rotations and stays neutral at arrival', () => {
  const position = { x: -9, z: 31 }, target = { x: 3, z: 19 };
  const expected = destinationBearing(position, target, 0.42);
  for (const turns of [-10, -1, 0, 1, 10]) {
    assert.ok(Math.abs(destinationBearing(position, target, 0.42 + turns * Math.PI * 2) - expected) < 1e-12);
    assert.equal(destinationBearing(position, position, turns * Math.PI * 2), 0);
  }
});
