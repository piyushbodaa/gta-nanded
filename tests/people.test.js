import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Humans, makeOutfit } from '../src/actors/humans.js';
import { nearGeometry, BONES, REGION, CLOTH, WOMENS, MENS } from '../src/actors/people-models.js';

// The soft shade under people is painted on a canvas; a stand-in is enough here.
globalThis.document ??= { createElement: () => ({ getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }) }) };

const BLOCK = 14 * 3 + 5;

test('people near the camera get the detailed body, the nearest first, without flickering at the edge', () => {
  const humans = new Humans(new THREE.Scene(), 16);
  humans.nearRadius = 10; humans.nearMax = 3;
  const at = [2, 4, 6, 8, 20].map((d, i) => humans.add(makeOutfit('man', i + 1), d, 0));
  const cam = { x: 0, z: 0 };
  humans.update(1 / 60, cam, null);
  assert.equal(humans.nNear, 3, 'only as many as allowed');
  assert.equal(humans.far.geometry.instanceCount, 2);
  assert.deepEqual(at.map(h => h.near), [true, true, true, false, false], 'the nearest three');
  // Their rows come first: the head bone of row k sits over a detailed person.
  const headX = k => humans.data[k * BLOCK * 4 + 2 * 12 + 3];
  for (let k = 0; k < 3; k++) assert.ok(headX(k) < 7, `row ${k} is detailed (x ${headX(k).toFixed(2)})`);
  // Just past the edge, someone already detailed stays so; someone arriving there doesn't.
  humans.nearMax = 16;
  at[2].x = 11; at[4].x = 11;
  humans.update(1 / 60, cam, null);
  assert.equal(at[2].near, true, 'kept until 2.5 m past the edge');
  assert.equal(at[4].near, false, 'not taken on until inside it');
  at[2].x = 13;
  humans.update(1 / 60, cam, null);
  assert.equal(at[2].near, false);
});

test('the detailed bodies: every vertex hangs from real bones, blends between two at most, and fits a phone', () => {
  const { geometry: g, men, women } = nearGeometry();
  detailed(g);
  // Each body draws only its own vertices: a man's leaves out saris and braids, a woman's beards and turbans.
  const show = i => g.attributes.crowdPart.array[i * 4 + 2];
  for (const [index, leave] of [[men, WOMENS], [women, MENS]]) {
    const used = new Set(index.array);
    assert.ok([...used].every(i => !(show(i) & leave)), 'nothing of the other body');
    assert.ok(used.size < 7500, `${used.size} vertices`);
    assert.ok(index.count / 3 < 13000, `${index.count / 3} triangles`);
  }
});
function detailed(g) {
  const part = g.attributes.crowdPart.array, skin = g.attributes.crowdSkin.array;
  for (const [name, a] of Object.entries(g.attributes)) assert.ok(a.array.every(Number.isFinite), `${name} is all numbers`);
  const regions = new Set(Object.values(REGION));
  for (let i = 0; i < part.length; i += 4) {
    assert.ok(part[i] >= 0 && part[i] < BONES.length && skin[i] >= 0 && skin[i] < BONES.length, 'bones exist');
    assert.ok(skin[i + 1] >= 0 && skin[i + 1] <= 0.5, 'the first bone leads');
    assert.ok(regions.has(skin[i + 2]), 'a painted region the shader knows');
    assert.ok(skin[i + 3] > 0.3 && skin[i + 3] <= 1, 'occlusion darkens, within reason');
  }
  // Every part anyone wears up close, shared by the two bodies.
  assert.ok(g.attributes.position.count < 9000, `${g.attributes.position.count} vertices`);
}

test('a shirt hangs outside the trousers down to its hem, and a tucked-in one stays inside them', () => {
  const { TORSO, PELVIS, n, radiusAt, torsoFemale, torsoHeavy, torsoTuck, pelvisFemale, pelvisHeavy } = CLOTH;
  // How far out a loft's surface is in direction a, with a build's offsets added.
  const radius = (rings, a, y, offsets) => {
    const r = radiusAt(rings, n, a, y), x = r * Math.sin(a), z = r * Math.cos(a);
    let px = x, pz = z;
    for (const [f, w] of offsets) { const d = f(x, y, z); px += d[0] * w; pz += d[2] * w; }
    return Math.hypot(px, pz);
  };
  const builds = { average: [0, 0], female: [1, 0], heavy: [0, 1], both: [1, 1] };
  for (const [name, [fe, he]] of Object.entries(builds)) {
    for (let y = TORSO[0][0]; y <= PELVIS[PELVIS.length - 1][0]; y += 0.005) {
      for (let a = 0; a < Math.PI * 2; a += 0.05) {
        const pel = radius(PELVIS, a, y, [[pelvisFemale, fe], [pelvisHeavy, he]]);
        const loose = radius(TORSO, a, y, [[torsoFemale, fe], [torsoHeavy, he]]);
        const at = `at y ${y.toFixed(3)}, angle ${a.toFixed(2)}`;
        assert.ok(loose - pel > 0.004, `${name}: untucked shirt ${((loose - pel) * 1000).toFixed(1)} mm outside ${at}`);
        // Tucked: inside the trousers below the belt (y 0.033-0.074, 7 mm out), inside the belt
        // behind it, and out over it above.
        const tucked = radius(TORSO, a, y, [[torsoFemale, fe], [torsoHeavy, he], [torsoTuck, 1]]);
        if (y <= 0.02) assert.ok(pel - tucked > 0.003, `${name}: tucked shirt ${((pel - tucked) * 1000).toFixed(1)} mm inside ${at}`);
        else if (y >= 0.04 && y <= 0.072) assert.ok(tucked < pel + 0.0055, `${name}: tucked shirt behind the belt ${at}`);
        else if (y >= 0.08) assert.ok(tucked - pel > 0.0015, `${name}: tucked shirt out over the belt ${at}`);
      }
    }
  }
});

test('everyone wears one kind of footwear, and what they wear fits who they are', () => {
  const kinds = ['man', 'woman', 'sikh', 'student', 'elder', 'farmer', 'police', 'goon', 'player', 'friend'];
  for (const kind of kinds) {
    for (let seed = 1; seed <= 40; seed++) {
      const o = makeOutfit(kind, seed), f = o.flags;
      assert.equal(Number(f.has('shoes')) + Number(f.has('chappal')), 1, `${kind} ${seed}: one pair`);
      const neck = (o.code >> 4) & 3;
      if (f.has('skirt')) assert.equal(neck, 2, 'a sari has a blouse');
      if (f.has('kurta')) assert.equal(neck, 3, 'a kurta has its slit');
      if (f.has('belt')) assert.equal(o.tuck, 1, 'a belt only shows on a tucked-in shirt');
      if (kind === 'woman') { assert.ok(f.has('chappal')); assert.equal(o.female, 1); }
      if (kind === 'police') assert.ok(f.has('pcap') && f.has('belt') && f.has('shoes') && f.has('collar'));
      if (kind === 'sikh') assert.ok(f.has('dastar') && !f.has('pheta'));
      if (kind === 'farmer') assert.ok(f.has('pheta') && !f.has('dastar'));
      if (kind === 'elder') assert.ok(f.has('topi'));
      if (f.has('short')) assert.equal(o.sleeve, o.skin, 'short sleeves show the arms');
      assert.ok(o.heavy >= 0 && o.heavy <= 1 && Number.isInteger(o.code) && o.code < 256);
    }
  }
  // The same seed still gives the same colours it always did.
  const o = makeOutfit('man', 5);
  assert.deepEqual([o.skin, o.shirt, o.pants], [makeOutfit('man', 5).skin, makeOutfit('man', 5).shirt, makeOutfit('man', 5).pants]);
});
