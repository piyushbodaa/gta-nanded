import test from 'node:test';
import assert from 'node:assert/strict';
import { PHOTO_FILTERS, nextPhotoFilter, photoFilterCss } from '../src/photo-filters.js';
import { racePosition, rubberBand, raceProgress } from '../src/mechanics.js';
import { daypart, pathSampler } from '../src/street-life.js';

test('photo filters cycle through every look and wrap around', () => {
  let filter = PHOTO_FILTERS[0];
  const seen = [filter.id];
  for (let i = 1; i < PHOTO_FILTERS.length; i++) { filter = nextPhotoFilter(filter.id); seen.push(filter.id); }
  assert.deepEqual(seen, PHOTO_FILTERS.map(f => f.id));
  assert.equal(nextPhotoFilter(filter.id).id, 'none', 'wraps back to the original');
  assert.equal(photoFilterCss('none'), 'none');
  assert.match(photoFilterCss('mono'), /grayscale/);
  assert.equal(photoFilterCss('nope'), 'none', 'unknown filters fall back to the original photo');
});

test('race position follows checkpoints first, then distance to the next ring', () => {
  assert.equal(raceProgress(2, 50) > raceProgress(1, 0), true, 'a later checkpoint always beats an earlier one');
  assert.equal(racePosition(1, 100, []), 1);
  assert.equal(racePosition(1, 100, [{ stage: 1, distance: 40 }]), 2, 'same checkpoint, rival closer');
  assert.equal(racePosition(2, 900, [{ stage: 1, distance: 5 }, { stage: 2, distance: 950 }]), 1);
  assert.equal(racePosition(0, 10, [{ stage: 3, distance: 0 }, { stage: 1, distance: 0 }, { stage: 0, distance: 5 }]), 4);
});

test('rubber-banding hurries a trailing rival and relaxes a runaway leader, within bounds', () => {
  assert.ok(rubberBand(2, 0, 1, 0) > 1.1, 'a checkpoint behind means full hurry');
  assert.ok(rubberBand(0, 0, 2, 0) < 0.95, 'a checkpoint ahead means ease off');
  assert.equal(rubberBand(1, 100, 1, 100), 1, 'level rivals run at base pace');
  assert.ok(rubberBand(9, 0, 0, 0) <= 1.16 && rubberBand(0, 0, 9, 0) >= 0.86, 'always clamped');
});

test('the Nanded day has a school rush, a Friday market and a slow Sunday', () => {
  const friday8 = daypart(new Date(2026, 9, 16, 8)); // Fri 16 Oct 2026, 08:00
  assert.equal(friday8.part, 'school-rush');
  assert.equal(friday8.schoolTime, true);
  assert.equal(friday8.marketDay, true);
  assert.ok(friday8.crowd > 1 && friday8.horns < 1, 'crowded and horn-happy');
  const sundayNoon = daypart(new Date(2026, 9, 18, 12));
  assert.equal(sundayNoon.sunday, true);
  assert.ok(sundayNoon.crowd < 1, 'Sunday is calmer');
  const night = daypart(new Date(2026, 9, 17, 2));
  assert.equal(night.part, 'night');
  assert.ok(night.horns > 1, 'long quiet gaps between horns at night (scale stretches the timer)');
  assert.equal(daypart(new Date(2026, 9, 17, 18)).part, 'bazaar-evening');
});

test('the train path sampler walks arc length and reports heading', () => {
  const sampler = pathSampler([{ x: 0, z: 0 }, { x: 0, z: -30 }, { x: 40, z: -30 }]);
  assert.equal(sampler.total, 70);
  const start = sampler.at(0);
  assert.deepEqual([start.x, start.z], [0, 0]);
  const mid = sampler.at(15);
  assert.deepEqual([mid.x, mid.z], [0, -15]);
  assert.equal(Math.abs(mid.heading), 0, 'heading points along -z');
  const corner = sampler.at(45);
  assert.deepEqual([corner.x, corner.z], [15, -30]);
  assert.equal(sampler.at(9999).x, 40, 'clamps at the end of the line');
  assert.equal(pathSampler([]).total, 0);
});
