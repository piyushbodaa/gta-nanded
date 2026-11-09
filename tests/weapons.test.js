// Guns: what the player carries, how it fires, what a bullet does to people, cars and the police,
// grenades, loot crates and the save. A fake game around the real Weapons, Peds and Police.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Weapons, placeLoot } from '../src/game/weapons.js';
import { Peds } from '../src/actors/peds.js';
import { Police } from '../src/game/police.js';
import { Save } from '../src/game/save.js';
import { Player } from '../src/actors/player.js';
import { WEAPONS, AMMO, interval, falloff, NO_FIRE } from '../src/game/weapon-data.js';
import { world } from './helpers.js';
import { Colliders } from '../src/world/colliders.js';

class FakeInput {
  constructor() { this.events = new Set(); this.state = { attackHeld: false, aim: false, moveX: 0, moveY: 0, sprint: false }; this.mode = 'keyboard'; this.look = { x: 0, y: 0 }; }
  pressed(a) { if (this.events.has(a)) { this.events.delete(a); return true; } return false; }
  trigger(a) { this.events.add(a); }
}

/** A camera at (x, y, z) looking along the heading `yaw` (0 = +z, π/2 = +x), level. */
function look(g, x, y, z, yaw = Math.PI / 2) {
  const t = yaw + Math.PI; // three's camera looks down its -z: turn it round
  g.camera3 = { position: { x, y, z }, quaternion: { x: 0, y: Math.sin(t / 2), z: 0, w: Math.cos(t / 2) }, fov: 62 };
}

function gunGame({ places = [], wall = null } = {}) {
  const g = {
    time: 0, cutscene: false, controls: new Map(), toasts: [], sounds: [], booms: [], hurtCars: [],
    hud: { bark() {}, toast(m) { g.toasts.push(m); }, help() {}, big() {} },
    player: { x: 0, y: 0, z: 0, heading: Math.PI / 2, state: 'foot', vehicle: null, speed: 0, onGround: true, health: 100, human: {}, damage(n) { this.health -= n; }, knockDown() { this.knocked = true; } },
    vehicles: { list: [] },
    net: { raised: [], bridge: [], width: [], nearest: () => null, surfaceAt: () => 0, deckAt: () => 0, route: () => null },
    city: { groundHeight: () => 0, pavementAt: () => 0, places },
    colliders: { raycast: () => 1, raycastSolid: wall || (() => 1), resolveCircle: () => false, blocked: () => false },
    quality: { settings: { peds: 0 } },
    humans: { add(outfit, x, z) { return { outfit, x, y: 0, z, yaw: 0, t: 0, pose: 'idle', speed: 0 }; }, remove() {} },
    audio: { sfx(n) { g.sounds.push(n); } },
    effects: { explosion(x, y, z) { g.booms.push([x, y, z]); } },
    save: { data: { stats: {} }, stat(k, d = 1) { this.data.stats[k] = (this.data.stats[k] || 0) + d; }, set(k, v) { this.data[k] = v; } },
    camera: { kick() {}, addShake() {}, facing: Math.PI / 2 },
    damageVehicle(v, dmg) { g.hurtCars.push([v, dmg]); v.health -= dmg; },
    onWantedChange() {}, onEvaded() {}, busted() {},
  };
  g.player.pos = g.player;
  g.police = new Police(g);
  g.peds = new Peds(g);
  g.weapons = new Weapons(g);
  return { g, w: g.weapons, input: new FakeInput() };
}

const person = (g, x, z, o = {}) => {
  const h = g.humans.add({ kind: o.kind || 'man' }, x, z);
  const p = g.peds._make(h, x, z, null);
  p.state = 'idle'; p.t = 999; h.yaw = Math.atan2(-x, -z); // facing the player at the origin
  return Object.assign(p, o.p);
};
/** Steps of the game: weapons (after the player, as game.js runs them), then the people. */
function run(g, input, seconds, each) {
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) { each?.(); g.time += 1 / 60; g.weapons.update(1 / 60, input); g.peds.update(1 / 60); }
}
/** One pull of the trigger, then long enough for the gun to be ready again. */
function shoot(g, input, n = 1) {
  if (g.weapons.cool > 0) run(g, input, g.weapons.cool + 1 / 60); // still bringing it up
  for (let i = 0; i < n; i++) { input.trigger('attack'); run(g, input, Math.max(interval(g.weapons.def), 1 / 12) + 0.05); }
}
/** Math.random held at v for f (the cone of fire straight down the middle at 0). */
function steady(f, v = 0) { const r = Math.random; Math.random = () => v; try { return f(); } finally { Math.random = r; } }

test('everyone starts with a loaded P92; calibres are shared, magazines are each gun\'s own', () => {
  const { w } = gunGame();
  assert.deepEqual(w.owned, ['fist', 'p92']);
  assert.deepEqual(w.ammoOf('p92'), { mag: 15, reserve: 30 });
  assert.equal(w.current, 'fist');
  w.give('uzi');
  assert.equal(w.ammoOf('uzi').mag, 25, 'a found gun comes loaded');
  assert.equal(w.ammoOf('p92').reserve, 30 + WEAPONS.uzi.start, 'the UZI\'s 9mm feeds the P92 too');
  assert.equal(w.current, 'uzi', 'empty-handed, a new gun comes out at once');
  w.give('akm'); w.give('kar98k');
  assert.equal(w.ammoOf('akm').reserve, WEAPONS.akm.start + WEAPONS.kar98k.start);
  assert.equal(w.ammoOf('akm').reserve, w.ammoOf('kar98k').reserve, 'a box of 7.62 feeds the AKM and the Kar98k');
  assert.deepEqual([w.ammoOf('akm').mag, w.ammoOf('kar98k').mag], [30, 5]);
  const room = AMMO['762'].max - w.ammoOf('akm').reserve;
  assert.equal(w.giveAmmo('762', 10000), room, 'up to what can be carried');
  assert.equal(w.ammoOf('akm').reserve, AMMO['762'].max);
  // The wheel's slots: a slot shows the gun in hand or the last picked; picking it again cycles inside it.
  w.give('m416');
  assert.ok(w.selectSlot('rifle'));
  assert.equal(w.current, 'akm');
  w.selectSlot('rifle');
  assert.equal(w.current, 'm416');
  assert.equal(w.slotWeapon('smg'), 'uzi');
  assert.equal(w.slotWeapon('shotgun'), null);
  w.equip('p92'); assert.equal(w.slotWeapon('rifle'), 'm416', 'remembers the last rifle picked');
  w.cycle(1); assert.equal(w.current, 'uzi');
  w.cycle(-1); w.cycle(-1); assert.equal(w.current, 'fist');
  w.cycle(-1); assert.equal(w.current, 'kar98k', 'round the end of the list');
  // Grenades are carried as a count.
  assert.equal(w.give('grenade'), 2);
  w.equip('grenade');
  assert.deepEqual([w.mag, w.reserve], [2, 0]);
  w.giveAll();
  assert.equal(w.owned.length, 11);
  assert.equal(w.ammoOf('awm').reserve, AMMO['300mag'].max);
});

test('reloading takes the gun\'s time, comes out of the shared reserve, and an empty trigger pull reloads by itself', () => {
  const { g, w, input } = gunGame();
  w.equip('p92');
  shoot(g, input, 5);
  assert.deepEqual(w.ammoOf('p92'), { mag: 10, reserve: 30 });
  input.trigger('reload');
  run(g, input, 1 / 60);
  assert.ok(w.reloading > 0, 'reloading');
  shoot(g, input);
  assert.equal(w.ammoOf('p92').mag, 10, 'no shot mid-reload');
  run(g, input, WEAPONS.p92.reload);
  assert.equal(w.reloading, 0);
  assert.deepEqual(w.ammoOf('p92'), { mag: 15, reserve: 25 });
  assert.equal(w.reload(), false, 'a full magazine');
  // R is the radio in a vehicle and the reload on foot.
  shoot(g, input, 15);
  assert.equal(w.mag, 0);
  shoot(g, input);
  assert.ok(w.reloading > 0, 'the empty trigger pull reloaded');
  run(g, input, WEAPONS.p92.reload);
  assert.deepEqual(w.ammoOf('p92'), { mag: 15, reserve: 10 });
  shoot(g, input, 2);
  input.trigger('radio');
  run(g, input, 1 / 60);
  assert.ok(w.reloading > 0, 'R on foot');
  // Getting into a vehicle stops it.
  g.player.state = 'driving';
  run(g, input, 1 / 60);
  assert.equal(w.reloading, 0);
  // Nothing left to load: a dry click.
  g.player.state = 'foot';
  w.ammo['9mm'] = 0; w.mags.p92 = 0; g.sounds.length = 0;
  shoot(g, input);
  assert.ok(g.sounds.includes('empty'));
});

test('guns fire at their own rate: automatic ones while held, no faster than 12 a second; a pistol once per pull', () => {
  const { g, w, input } = gunGame();
  w.give('m416'); w.giveAmmo('556', 300); w.equip('m416');
  run(g, input, 0.3);
  input.state.attackHeld = true;
  run(g, input, 1);
  const auto = g.save.data.stats.shots;
  assert.ok(Math.abs(auto - 690 / 60) <= 1.5, `${auto} shots in a second from an M416`);
  w.equip('p92'); g.save.data.stats.shots = 0;
  run(g, input, 1.5);
  assert.equal(g.save.data.stats.shots || 0, 0, 'holding the trigger fires no pistol on a keyboard');
  input.trigger('attack');
  run(g, input, 1);
  assert.equal(g.save.data.stats.shots, 1);
  // On a phone a held FIRE keeps a pistol going, a little slower than it can be tapped.
  input.mode = 'touch'; g.save.data.stats.shots = 0;
  run(g, input, 1);
  const held = g.save.data.stats.shots;
  assert.ok(held >= 3 && held < 420 / 60, `${held} pistol shots held for a second`);
  input.state.attackHeld = false;
  // A tap just before the gun is ready still fires.
  input.mode = 'keyboard'; run(g, input, 0.3); g.save.data.stats.shots = 0;
  input.trigger('attack'); run(g, input, 0.05); input.trigger('attack'); run(g, input, 0.3);
  assert.equal(g.save.data.stats.shots, 2);
});

test('a wall stops a bullet: the man behind it isn\'t hurt, and is once it\'s gone', () => {
  let wall = true;
  const { g, w, input } = gunGame({ wall: (ax, ay, az, bx) => (wall && ax < 5 && bx >= 5 ? (5 - ax) / (bx - ax) : 1) });
  look(g, 0, 1.0, 0); // low enough to hit him ducking at the first shot
  const p = person(g, 8, 0);
  w.equip('p92'); input.state.aim = true;
  steady(() => shoot(g, input));
  assert.equal(p.health, undefined, 'never touched');
  assert.equal(w.hitMarker, null);
  const hit = w.trace(0, 1.0, 0, 1, 0, 0, 90, {});
  assert.equal(hit.kind, 'wall');
  assert.ok(Math.abs(hit.x - 5) < 1e-6);
  wall = false;
  steady(() => shoot(g, input));
  assert.equal(p.health, 100 - WEAPONS.p92.damage);
  assert.ok(w.hitMarker && !w.hitMarker.kill);
});

test('a headshot does 2.3 times the damage: one AKM round to the head knocks a man out, one to the body doesn\'t', () => {
  const { g, w, input } = gunGame();
  w.give('akm'); input.state.aim = true;
  const a = person(g, 6, 0), b = person(g, 6, 3);
  look(g, 0, 1.65, 0);
  steady(() => shoot(g, input));
  assert.equal(a.state, 'dead');
  assert.ok(w.hitMarker.head && w.hitMarker.kill);
  assert.equal(g.save.data.stats.headshots, 1);
  assert.equal(g.save.data.stats.kills, 1);
  look(g, 0, 1.0, 3);
  steady(() => shoot(g, input));
  assert.notEqual(b.state, 'dead');
  assert.equal(b.health, 100 - falloff(WEAPONS.akm, 6));
  assert.equal(w.hitMarker.head, false);
});

test('at no health a man is knocked out for good: he lies still, bullets pass him by, and he goes once out of sight', () => {
  const { g, w, input } = gunGame();
  look(g, 0, 1.0, 0);
  // Someone squaring up to the player: hit, not knocked down (a bullet doesn't hit a man on the ground), fights on.
  const p = person(g, 6, 0, { p: { state: 'fight', t: 30, grudge: 1 } });
  w.equip('p92'); input.state.aim = true;
  steady(() => shoot(g, input, 4), 0.99);
  assert.equal(p.state, 'dead');
  assert.equal(p.h.pose, 'lie');
  assert.equal(p.keep, false);
  // Shot again, the bullet carries on past him (nothing else is there to hit).
  const marked = w.hitMarker.t;
  steady(() => shoot(g, input));
  assert.equal(w.hitMarker.t, marked);
  assert.equal(w.trace(0, 0.3, 0, 1, 0, 0, 60, {}).kind, null);
  // Left lying while the camera looks at him...
  run(g, input, 10);
  assert.equal(p.state, 'dead');
  assert.ok(g.peds.list.includes(p));
  // ...and gone once it looks away.
  look(g, 0, 1.2, 0, -Math.PI / 2);
  run(g, input, 0.1);
  assert.ok(!g.peds.list.includes(p));
});

test('a knocked-out officer is off the job: no witness, no arrest, out of the count', () => {
  const { g, w, input } = gunGame();
  const cop = person(g, 1, 0, { kind: 'police', p: { cop: true, keep: true, state: 'fight', t: 30 } });
  g.police.foot.push(cop);
  assert.ok(g.police._copNear(0, 0, 55));
  g.peds.kill(cop, 0, 0);
  assert.equal(g.police._copNear(0, 0, 55), false);
  g.police.setLevel(1);
  g.police.update(1 / 60);
  assert.equal(g.police.foot.length, 0);
  assert.equal(g.police.bustT, 0);
  void w; void input;
});

test('the story\'s own people take no bullets; a fight\'s targets count every hit and are never knocked out', () => {
  const { g, w, input } = gunGame();
  w.give('awm'); input.state.aim = true;
  const pakya = person(g, 8, 0, { p: { mission: true, state: 'scripted' } });
  look(g, 0, 1.2, 0);
  steady(() => shoot(g, input));
  assert.equal(pakya.health, undefined);
  assert.equal(pakya.state, 'scripted');
  assert.equal(w.hitMarker, null);
  // A goon the story wants beaten with three hits: three shots, three hits, on the ground or not.
  const goon = person(g, 8, 0, { p: { mission: true, needHits: 3, hits: 0, state: 'fight', grudge: 3 } });
  pakya.h.x = 30;
  look(g, 0, 0.3, 0);
  for (let i = 0; i < 3; i++) { steady(() => shoot(g, input)); run(g, input, 0.2); }
  assert.equal(goon.hits, 3);
  assert.notEqual(goon.state, 'dead');
  // The goon's beating is no crime.
  assert.equal(g.police.heat, 0);
  // A grenade only knocks the story's people over.
  w.blast(30, 0, 0.5);
  assert.notEqual(pakya.state, 'dead');
  // Mid-cutscene nothing fires.
  g.cutscene = true; g.save.data.stats.shots = 0;
  w.mags.awm = 5; run(g, input, 2);
  steady(() => shoot(g, input));
  assert.equal(g.save.data.stats.shots, 0);
});

test('gunfire is a crime the police hear 120 m off; hitting and knocking out people are worse; nobody about, nobody calls it in', () => {
  const { g, w, input } = gunGame();
  w.equip('p92');
  // Shots out in the fields with nobody to hear.
  shoot(g, input, 3);
  assert.equal(g.police.heat, 0);
  assert.equal(g.police.pending.length, 0);
  run(g, input, 2.1);
  // An officer in a jeep 90 m off hears them.
  g.vehicles.list.push({ type: 'police', driver: {}, role: 'police-idle', x: 0, z: 90, y: 0 });
  shoot(g, input);
  assert.ok(Math.abs(g.police.heat - 0.6) < 1e-9, `heat ${g.police.heat}`);
  run(g, input, 2.1);
  shoot(g, input);
  assert.equal(g.police.level, 1, 'keep shooting: a star');
  // Knocking someone out in sight of the officer is two stars at least.
  const { g: g2, w: w2, input: in2 } = gunGame();
  g2.vehicles.list.push({ type: 'police', driver: {}, role: 'police-idle', x: 0, z: 60, y: 0 });
  w2.give('awm'); in2.state.aim = true;
  const p = person(g2, 10, 0);
  const walker = person(g2, 15, 10, { p: { state: 'walk' } });
  look(g2, 0, 1.2, 0);
  steady(() => shoot(g2, in2));
  assert.equal(p.state, 'dead');
  assert.ok(g2.police.level >= 2, `level ${g2.police.level}`);
  assert.ok(walker.state === 'flee' || walker.state === 'cower', 'people near gunfire run or duck');
});

test('guns stay holstered at holy places', () => {
  const { g, w, input } = gunGame({ places: [{ id: 'hazur-sahib', x: 0, z: 0 }] });
  w.equip('p92');
  run(g, input, 0.3);
  assert.equal(w.blocked, 'holy');
  g.sounds.length = 0;
  shoot(g, input);
  assert.equal(w.mag, 15);
  assert.ok(g.sounds.includes('empty'));
  g.player.x = NO_FIRE['hazur-sahib'] + 5;
  run(g, input, 0.3);
  assert.equal(w.blocked, null);
  shoot(g, input);
  assert.equal(w.mag, 14);
});

test('the inventory survives a save, and an old save without one starts with the P92', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const s = new Save();
  assert.deepEqual(s.data.inventory, { weapons: ['p92'], mags: { p92: 15 }, ammo: { '9mm': 30 }, equipped: 'fist' });
  assert.equal(s.data.stats.shots, 0);
  const { g, w, input } = gunGame();
  g.save = s;
  w.fromSave(s.data.inventory);
  w.give('akm'); w.give('grenade', 3); w.equip('akm');
  shoot(g, input, 2);
  run(g, input, 2); // the inventory is written into the save a moment after it changes
  s.flush();
  const back = new Save(), w2 = gunGame().w;
  w2.fromSave(back.data.inventory);
  assert.deepEqual(w2.owned, ['fist', 'p92', 'akm', 'grenade']);
  assert.equal(w2.current, 'akm');
  assert.deepEqual(w2.ammoOf('akm'), { mag: 28, reserve: WEAPONS.akm.start });
  assert.equal(w2.ammoOf('grenade').mag, 3);
  assert.equal(back.data.stats.shots, 2);
  // A save from before guns: the starter pistol, and the rest of it as it was.
  store.set('gta-nanded-save-v2', JSON.stringify({ version: 2, cash: 777, story: ['c1'], stats: { punches: 4 } }));
  const old = new Save();
  assert.equal(old.cash, 777);
  w2.fromSave(old.data.inventory);
  assert.deepEqual(w2.owned, ['fist', 'p92']);
  assert.deepEqual(w2.ammoOf('p92'), { mag: 15, reserve: 30 });
  // Nonsense in a save (a hand-edited one) doesn't break the game.
  w2.fromSave({ weapons: ['rpg', 'akm'], mags: { akm: 999 }, ammo: { '762': -5, '9mm': 'lots' }, equipped: 'rpg' });
  assert.deepEqual(w2.owned, ['fist', 'akm']);
  assert.deepEqual(w2.ammoOf('akm'), { mag: 30, reserve: 0 });
  assert.equal(w2.current, 'fist');
});

test('walking over a crate picks it up, a full pocket leaves it, and it comes back five minutes later', () => {
  const { g, w, input } = gunGame();
  w.loot.push({ x: 0.8, y: 0, z: 0, id: 'akm', ammo: null, n: 60, taken: false, kind: 'crate', i: 0, gen: 0, respawnAt: 0 });
  w.loot.push({ x: 0, y: 0, z: 0.5, id: null, ammo: '9mm', n: 45, taken: false, kind: 'crate', i: 1, gen: 0, respawnAt: 0 });
  w.ammo['9mm'] = AMMO['9mm'].max;
  g.player.state = 'driving';
  run(g, input, 0.1);
  assert.ok(!w.loot[0].taken, 'not from a car');
  g.player.state = 'foot';
  run(g, input, 0.1);
  assert.ok(w.loot[0].taken);
  assert.ok(w.has('akm'));
  assert.equal(w.current, 'akm');
  assert.ok(g.toasts.some(t => t.includes('AKM + 60 7.62mm')), g.toasts.join());
  assert.ok(g.sounds.includes('pickup'));
  assert.ok(!w.loot[1].taken, 'no room for more 9mm');
  // Back after five minutes, once the player is away from it.
  g.time += 301;
  run(g, input, 0.1);
  assert.ok(w.loot[0].taken, 'not while the player stands on it');
  g.player.x = 100;
  run(g, input, 0.1);
  assert.equal(w.loot[0].taken, false);
  assert.ok(w.loot[0].id || w.loot[0].ammo);
  // Crates near the player show on the radar, far ones don't.
  g.player.x = 200;
  run(g, input, 0.6);
  assert.equal(w.blips().length, 0);
  g.player.x = 10;
  run(g, input, 0.6);
  assert.equal(w.blips().length, 2);
});

test('an air drop comes down by parachute near the player, out of missions, and holds a rifle', () => {
  const { g, w, input } = gunGame();
  g.net.nearest = (x, z) => ({ x, z, dx: 1, dz: 0, road: 0, s: 0 });
  g.net.width = [8];
  g.missions = { active: {} };
  run(g, input, 1);
  w.airdropT = 0.01;
  run(g, input, 1);
  assert.equal(w.airdrop, null, 'not during a mission');
  g.missions.active = null;
  run(g, input, 0.1);
  const a = w.airdrop;
  assert.ok(a && !a.landed && a.y > 100);
  const d = Math.hypot(a.x, a.z);
  assert.ok(d > 140 && d < 360, `${d.toFixed(0)} m away`);
  run(g, input, 25);
  assert.ok(a.landed && a.crate && ['awm', 'm416', 'akm'].includes(a.crate.id));
  assert.ok(w.loot.includes(a.crate));
  g.player.x = a.x; g.player.z = a.z;
  run(g, input, 0.1);
  assert.ok(w.has(a.crate.id));
  assert.ok(!w.loot.includes(a.crate));
  assert.ok(a.taken);
  run(g, input, 5);
  assert.equal(w.airdrop, null);
});

test('a grenade flies along the aim, lands, and blows up after its fuse: people near it out, further off knocked over, cars hurt', () => {
  const { g, w, input } = gunGame();
  w.give('grenade', 2); w.equip('grenade');
  run(g, input, 0.3);
  input.trigger('attack');
  run(g, input, 1 / 60);
  assert.equal(w.grenades.length, 1);
  assert.equal(w.mag, 1);
  run(g, input, 1.5);
  const gr = w.grenades[0];
  assert.ok(gr.x > 5 && Math.abs(gr.y - 0.07) < 0.05, `on the ground ${gr.x.toFixed(1)} m ahead`);
  run(g, input, 2.5);
  assert.equal(w.grenades.length, 0);
  assert.equal(g.booms.length, 1);
  // The blast itself.
  const near = person(g, 51, 0), far = person(g, 56, 0), car = { x: 52, z: 2, y: 0, vx: 0, vz: 0, heading: 0, hw: 0.8, hd: 2, health: 1000 };
  g.vehicles.list.push(car);
  g.player.x = 47;
  w.blast(50, 0, 0);
  assert.equal(near.state, 'dead');
  assert.equal(far.state, 'down');
  assert.ok(car.health < 1000 && Math.abs(car.vx) + Math.abs(car.vz) > 0);
  assert.ok(g.player.health < 100 && g.player.knocked);
  // The last one thrown, the hand goes back to a gun.
  w.equip('grenade');
  run(g, input, 1.5);
  input.trigger('attack');
  run(g, input, 1 / 60);
  assert.ok(!w.has('grenade'));
  assert.equal(w.current, 'p92');
});

test('bullets hit cars (not the one the player sits in) and an officer\'s pistol hits back', () => {
  const { g, w, input } = gunGame();
  w.give('akm'); input.state.aim = true;
  look(g, 0, 1.0, 0);
  const car = { x: 10, z: 0, y: 0, heading: 0, hw: 0.85, hd: 2.1, health: 1000, spec: { H: 1.5 } };
  g.vehicles.list.push(car);
  steady(() => shoot(g, input));
  assert.equal(g.hurtCars.length, 1);
  assert.equal(g.hurtCars[0][1], falloff(WEAPONS.akm, 8.15 - 0) * WEAPONS.akm.vehicle);
  car.vital = true;
  steady(() => shoot(g, input));
  assert.equal(g.hurtCars.length, 1, 'never a mission\'s vital car');
  // An armed officer at range stops and shoots, when he can see the player.
  let shots = 0;
  g.pedShoots = () => { shots++; };
  const cop = person(g, 20, 0, { kind: 'police', p: { cop: true, keep: true, state: 'fight', t: 30 } });
  g.police.level = 3;
  g.police._footCop(cop);
  assert.equal(cop.armed, 'p92');
  run(g, input, 3);
  assert.ok(shots >= 2, `${shots} shots`);
  assert.ok(Math.hypot(cop.h.x, cop.h.z) > 15, 'stayed at range');
  assert.equal(cop.h.gun, 'p92');
  assert.equal(cop.h.aim, 1);
  // Out of sight he runs in instead.
  g.colliders.raycast = () => 0.5;
  run(g, input, 0.45); // he looks again every 0.4 s (and the real pedShoots checks the line itself)
  shots = 0;
  const at = Math.hypot(cop.h.x, cop.h.z);
  run(g, input, 1.5);
  assert.equal(shots, 0);
  assert.ok(Math.hypot(cop.h.x, cop.h.z) < at - 3, 'came in closer');
  g.peds.kill(cop);
  assert.equal(cop.h.gun, null);
});

test('with a gun out the attack button fires instead of punching, and the player turns to the camera', () => {
  const { g, w, input } = gunGame();
  let punches = 0;
  Object.assign(g, {
    city: { ...g.city, riverDistance: (x, z, o) => { o.d = 99; return o; } },
    camera: { facing: 1.2, reset() {}, kick() {}, addShake() {} },
    pushOutOfVehicles() {}, playerPunch() { punches++; },
  });
  g.humans.add = (outfit, x, z) => ({ outfit, x, y: 0, z, yaw: 0, t: 0, pose: 'idle', speed: 0 });
  const P = new Player(g, 0, 0, 0);
  g.player = P;
  const step = () => { g.time += 1 / 60; P.update(1 / 60, input); w.update(1 / 60, input); };
  input.trigger('attack'); step();
  assert.equal(punches, 1, 'fists punch');
  for (let i = 0; i < 30; i++) step();
  input.mode = 'gamepad'; input.trigger('reload'); step(); input.mode = 'keyboard';
  assert.equal(punches, 2, 'and so does a gamepad\'s B, with empty hands');
  w.equip('p92');
  for (let i = 0; i < 30; i++) step();
  input.trigger('attack'); step();
  assert.equal(punches, 2);
  assert.equal(w.mag, 14);
  for (let i = 0; i < 30; i++) step();
  assert.ok(Math.abs(P.heading - 1.2) < 0.05, `heading ${P.heading.toFixed(2)}`);
  assert.equal(P.human.gun, 'p92');
  assert.equal(P.human.hold, 'pistol');
  assert.equal(P.human.aim, 1);
  // In a car the gun is put away.
  P.enterVehicle({ model: { seat: { pose: 'sit', y: 0.5 } } });
  assert.equal(P.human.gun, null);
  assert.equal(P.human.aim, 0);
});

test('a bullet\'s ray stops at posts, trunks and low walls the camera looks past', () => {
  const { city } = world();
  const c = new Colliders(city);
  c.addCircle(9000, 9000, 0.15, 4); // a pole
  c.addBox(9100, 9000, 3, 0.2, 0, 0.6); // a low wall across +z
  c.addBox(9200, 9000, 2, 2, 0, 3, 0); // a kiosk 3 m tall
  assert.equal(c.raycast(8990, 1.5, 9000, 9010, 1.5, 9000), 1, 'the camera looks past a pole');
  assert.ok(Math.abs(c.raycastSolid(8990, 1.5, 9000, 9010, 1.5, 9000) - (10 - 0.15) / 20) < 1e-3, 'a bullet stops on it');
  assert.ok(c.raycastSolid(9100, 0.4, 8990, 9100, 0.4, 9010) < 1, 'low on the wall');
  assert.equal(c.raycastSolid(9100, 1.0, 8990, 9100, 1.0, 9010), 1, 'over it');
  // Down through the kiosk's roof: where it passes the top.
  const t = c.raycastSolid(9200, 6, 8990, 9200, 0, 9010);
  assert.ok(Math.abs(t - 0.5) < 1e-3, `t ${t}`);
});

test('about seventy crates lie on footpaths, the same every game, thickest round the station', () => {
  const { city, net } = world();
  const c = new Colliders(city);
  const zones = city.places.filter(p => NO_FIRE[p.id]).map(p => ({ x: p.x, z: p.z, r2: NO_FIRE[p.id] ** 2 }));
  const loot = placeLoot(net, city, c, zones), again = placeLoot(net, city, c, zones);
  assert.ok(loot.length >= 60 && loot.length <= 72, `${loot.length} crates`);
  assert.deepEqual(loot.map(l => [l.x, l.z, l.id, l.ammo]), again.map(l => [l.x, l.z, l.id, l.ammo]));
  const nearStation = loot.filter(l => Math.hypot(l.x - 1.3, l.z - 12.9) < 520).length;
  assert.ok(nearStation >= 20, `${nearStation} near the station`);
  for (const l of loot) {
    assert.ok(!c.blocked(l.x, l.z, 0.4), `crate at ${l.x.toFixed(0)}, ${l.z.toFixed(0)} is clear of walls`);
    assert.ok(l.y >= -0.4 && l.y < 1, `and at ground level (${l.y})`);
    assert.ok(!zones.some(s => (s.x - l.x) ** 2 + (s.z - l.z) ** 2 < s.r2), 'not at a holy place');
    assert.ok(l.id ? WEAPONS[l.id] && l.n === (WEAPONS[l.id].start || 0) : AMMO[l.ammo] && l.n > 0);
    assert.ok(l.id !== 'awm', 'the AWM only comes by air');
  }
  for (let i = 0; i < loot.length; i++) for (let j = i + 1; j < loot.length; j++) assert.ok(Math.hypot(loot[i].x - loot[j].x, loot[i].z - loot[j].z) >= 40);
});

test('rules: a shot car\'s driver gets out and runs, officers hit back only in sight, and HATHIYAAR fills the armoury', async () => {
  const el = () => ({ addEventListener() {}, hidden: true });
  globalThis.document ??= { getElementById: el, body: { classList: { add() {}, remove() {} } } };
  globalThis.addEventListener ??= () => {};
  const { installRules } = await import('../src/game/rules.js');
  const { g, w } = gunGame();
  const made = [];
  Object.assign(g, {
    city: { ...g.city, places: [] }, jobs: { update() {}, stop() {} }, missions: { active: null }, input: { pressed: () => false },
    camera: { addShake() {}, kick() {} }, effects: { sparks() {}, explosion() {}, fire() {}, smoke() {}, dust() {} },
  });
  g.hud.cashChange = () => {};
  g.save.stat = () => {};
  g.peds = { list: [], _make(h, x, z) { const p = { h, x, z }; made.push(p); return p; }, bark() {} };
  Object.assign(g.vehicles, { wake(v) { v.kinematic = false; }, ejectDriver(v) { const h = v.driver; v.driver = null; return h; }, exitWorld: v => ({ x: v.x + 2, z: v.z, y: 0 }) });
  installRules(g);
  const driver = { pose: 'sit' }, rider = { pose: 'sit' };
  const car = { type: 'hatch', role: 'traffic', x: 10, z: 0, y: 0, health: 1000, kinematic: true, ai: {}, driver, passengers: [rider] };
  g.damageVehicle(car, 100, true);
  assert.equal(car.health, 900);
  assert.equal(car.kinematic, false);
  assert.equal(car.driver, null);
  assert.deepEqual(made.map(p => [p.h, p.state]), [[driver, 'flee'], [rider, 'flee']]);
  assert.deepEqual([car.role, car.ai], ['abandoned', null]);
  assert.equal(car.rammedT, g.time, 'if it blows up now, that\'s the player\'s doing');
  // A story's car keeps its driver (the chase decides when it is caught); shot to nothing, it burns.
  const chased = { type: 'sedan', role: 'mission', x: 0, z: 0, y: 0, health: 300, driver: {}, passengers: [] };
  g.damageVehicle(chased, 400, true);
  assert.ok(chased.driver && chased.wrecked);
  // An officer shoots at the player only with a clear line.
  const cop = { armed: 'p92', h: { x: 8, z: 0, y: 0, yaw: -Math.PI / 2 } };
  let hits = 0, tries = 0;
  g.player.damage = () => hits++;
  for (; tries < 200; tries++) g.pedShoots(cop);
  assert.ok(hits > 40 && hits < 160, `${hits} of ${tries} hit from 8 m`);
  g.colliders.raycast = () => 0.4; hits = 0;
  for (let i = 0; i < 50; i++) g.pedShoots(cop);
  assert.equal(hits, 0, 'not through a wall');
  assert.ok(g.cheat('hathiyaar'));
  assert.equal(w.owned.length, 11);
});

test('with the wheel up the game runs slow, next and previous are the wheel\'s, and nothing fires', () => {
  const { g, w, input } = gunGame();
  w.give('uzi'); w.equip('p92');
  run(g, input, 0.3);
  w.openWheel();
  assert.equal(g.timeScale, 0.25);
  input.trigger('weaponNext'); input.trigger('attack');
  run(g, input, 0.3);
  assert.equal(w.current, 'p92');
  assert.equal(w.mag, 15);
  assert.ok(input.events.has('weaponNext'), 'left for the wheel to read');
  input.events.clear();
  w.closeWheel('uzi');
  assert.deepEqual([g.timeScale, w.current], [1, 'uzi']);
  // In a car the wheel shuts.
  w.openWheel(); g.player.state = 'driving';
  run(g, input, 1 / 60);
  assert.deepEqual([w.wheelOpen, g.timeScale], [false, 1]);
});
