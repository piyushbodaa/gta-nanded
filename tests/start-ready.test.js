import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// Just enough of a browser for game.js to load.
const store = new Map();
globalThis.localStorage ??= { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
globalThis.document ??= { hidden: false };
globalThis.matchMedia ??= () => ({ matches: true });
const { Game } = await import('../src/game/game.js');
const { startSpot } = await import('../src/game/start-spot.js');
const { HOME } = await import('../src/game/story.js');
const { Markers } = await import('../src/game/effects.js');

/** Idle callbacks the test runs by hand, one at a time. */
function idlePump() {
  const queue = [];
  const was = globalThis.requestIdleCallback;
  globalThis.requestIdleCallback = f => queue.push(f);
  return {
    queue,
    step() { const f = queue.shift(); f?.({ timeRemaining: () => 50 }); return !!f; },
    drain(max = 500) { let n = 0; while (n < max && this.step()) n++; return n; },
    restore() { if (was) globalThis.requestIdleCallback = was; else delete globalThis.requestIdleCallback; },
  };
}

/** A fake game around a real scene holding the kinds of weapon meshes WeaponFx adds. */
function fakeGame() {
  const scene = new THREE.Scene(), log = [];
  const box = new THREE.BoxGeometry(1, 1, 1), vbox = box.clone();
  vbox.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(vbox.attributes.position.count * 3).fill(1), 3));
  const gunMat = new THREE.MeshStandardMaterial({ vertexColors: true });
  const inst = (geo, mat, name, colored) => {
    const m = new THREE.InstancedMesh(geo, mat, 4); m.name = name; m.count = 0;
    if (colored) m.setColorAt(0, new THREE.Color(0xffffff));
    scene.add(m); return m;
  };
  inst(vbox, gunMat, 'gun-pistol'); inst(vbox, gunMat, 'gun-akm'); inst(vbox, gunMat, 'loot-crates'); // one program
  const chute = new THREE.Mesh(vbox, gunMat); chute.name = 'parachute'; chute.visible = false; scene.add(chute); // a second
  inst(box, new THREE.MeshBasicMaterial({ vertexColors: true }), 'loot-beams', true); // a third
  const vcol = new THREE.MeshLambertMaterial({ vertexColors: true });
  inst(vbox, vcol, 'car-fixed', true); inst(vbox, vcol, 'car-wheels', false); // a fourth and a fifth: one material, two variants
  const rt = { rt: true };
  let target = null;
  const props = new WeakMap();
  const renderer = {
    getRenderTarget: () => target,
    setRenderTarget(t) { target = t; log.push(['target', t]); },
    compile(o) {
      log.push(['compile', o.name, target]);
      const p = { getUniforms: () => log.push(['link', o.name]) };
      props.set(o.material, { programs: new Map([[o.uuid, p]]) });
    },
    properties: { get: m => props.get(m) ?? {} },
  };
  const g = Object.create(Game.prototype);
  Object.assign(g, {
    scene, renderer, camera3: new THREE.PerspectiveCamera(), post: { enabled: true, rt },
    world: { chunks: {
      prepare(x, z) { log.push(['prepare', x, z]); return true; },
      showFrom(x, z) { log.push(['showFrom', x, z]); },
    } },
    player: { human: {}, x: 0, y: 0, z: 0, heading: 0, groundY: 0, teleport(x, z, h) { this.x = x; this.z = z; this.heading = h; } },
    camera: { update() {} }, input: {},
    traffic: { update() { log.push(['traffic']); } }, peds: { update() {} }, parked: { t: 5, update() { log.push(['parked']); } },
    renderWorld(dt, post) { log.push(['render', g.player.x, g.player.z, dt, post]); },
  });
  return { g, log, rt };
}

const spots = [{ key: 'station', x: 1.3, z: 12.9, heading: 2 }, { key: 'home', x: -930, z: -1830, heading: 0 }];

test('the menu rehearses the start: ground, one shader per material and kind of mesh, streets, then each spot drawn', () => {
  const idle = idlePump();
  try {
    const { g, log, rt } = fakeGame();
    g.getReady(spots, () => true);
    assert.deepEqual(g.ready, { filled: null, done: false }, 'nothing happens before the browser is idle');
    idle.drain();
    const compiles = log.filter(e => e[0] === 'compile');
    assert.equal(compiles.length, 5, compiles.map(e => e[1]).join());
    assert.ok(compiles.every(e => e[2] === rt), 'compiled for the post-processing buffer');
    assert.equal(log.filter(e => e[0] === 'link').length, 5, 'each link waited for');
    assert.equal(g.renderer.getRenderTarget(), null, 'the target put back');
    const firstCompile = log.findIndex(e => e[0] === 'compile');
    assert.deepEqual(log.filter((e, i) => e[0] === 'prepare' && i < firstCompile).map(e => [e[1], e[2]]), spots.map(s => [s.x, s.z]), 'the ground at both spots first');
    assert.equal(log.filter(e => e[0] === 'traffic').length, 40);
    assert.equal(log.filter(e => e[0] === 'parked').length, 1);
    const renders = log.filter(e => e[0] === 'render');
    assert.deepEqual(renders.map(e => [e[1], e[2], e[3], e[4]]), spots.map(s => [s.x, s.z, 0, false]), 'each spot drawn once');
    assert.deepEqual(g.ready, { filled: 'station', done: true });
  } finally { idle.restore(); }
});

test('a tap stops the rehearsal where it is; the start does the rest', () => {
  const idle = idlePump();
  try {
    const { g, log } = fakeGame();
    let going = true;
    g.getReady(spots, () => going);
    going = false;
    idle.drain();
    assert.equal(log.length, 0);
    assert.equal(g.ready.done, false);
    assert.equal(g.ready.filled, null);
  } finally { idle.restore(); }
});

test('warmShaders only compiles: no teleport, no streets, no drawing', () => {
  const idle = idlePump();
  try {
    const { g, log } = fakeGame();
    let done = 0;
    g.warmShaders(() => true, () => done++);
    idle.drain();
    assert.equal(done, 1);
    assert.equal(log.filter(e => e[0] === 'compile').length, 5);
    assert.ok(!log.some(e => ['prepare', 'showFrom', 'traffic', 'parked', 'render'].includes(e[0])));
    assert.equal(g.player.x, 0);
  } finally { idle.restore(); }
});

test('fillStreets is two seconds of traffic and people in steps, then the parked cars', () => {
  const { g, log } = fakeGame();
  const it = g.fillStreets();
  for (let i = 0; i < 40; i++) assert.equal(it.next().done, false);
  assert.equal(log.filter(e => e[0] === 'parked').length, 0);
  assert.equal(it.next().done, true);
  assert.equal(g.parked.t, 0, 'parked cars placed afresh');
  assert.equal(log.filter(e => e[0] === 'parked').length, 1);
});

test('play begins on the station forecourt for a new story, at home otherwise', () => {
  const net = { nearest: () => ({ dx: 1, dz: 0 }) };
  assert.deepEqual(startSpot(net, 'new'), { key: 'station', x: 5.3 - 4, z: 10.9 + 2, heading: Math.PI * 0.75 });
  for (const mode of ['continue', 'free', 'resume']) {
    const s = startSpot(net, mode);
    assert.equal(s.key, 'home');
    assert.ok(Math.hypot(s.x - HOME.x, s.z - HOME.z) <= 6, mode);
    assert.equal(s.heading, Math.atan2(1, 0));
  }
  assert.deepEqual(startSpot({ nearest: () => null }, 'free'), { key: 'home', x: HOME.x, z: HOME.z, heading: 0 });
  startSpot(net, 'new').x = 99;
  assert.equal(startSpot(net, 'new').x, 5.3 - 4, 'a fresh object each time');
});

test('mission markers are coloured per instance from the start, so the shader compiled ahead is the one used', () => {
  const mk = new Markers(new THREE.Scene());
  for (const o of [mk.column, mk.ring, mk.arrow]) assert.ok(o.instanceColor, o.name || 'marker part');
});
