// Own gaadi: claiming at Society Parking, the save record, towing, the Jugaad Garage's mods.
import test from 'node:test';
import assert from 'node:assert/strict';
import { VEHICLE_TYPES } from '../src/actors/vehicle-types.js';
import { tunedSpec, damageK, sanitizeFleet, findBays, CLAIMABLE, DEALER_PRICES, HORN_IDS, STICKERS, MODS } from '../src/game/garage-data.js';
import { Garage } from '../src/game/garage.js';
import { VehicleExtras, decalRect } from '../src/actors/vehicle-extras.js';
import { GarageMenu } from '../src/ui/garage-menu.js';
import { world } from './helpers.js';
import { Colliders } from '../src/world/colliders.js';
import { STORY, HOME, GARAGE } from '../src/game/story.js';
import * as THREE from 'three';

const BAYS = [0, 1, 2, 3].map(i => ({ x: i * 5, z: 0, heading: 0, i }));
let ids = 1;
function fakeGame({ cash = 50000 } = {}) {
  const toasts = [], helps = [];
  const g = {
    time: 0,
    save: { data: { cash, fleet: { cars: [], next: 1 } }, get cash() { return this.data.cash; }, set cash(v) { this.data.cash = v; }, dirty() { this.d = true; }, flush() { this.flushed = (this.flushed || 0) + 1; }, set(k, v) { this.data[k] = v; } },
    hud: { toast: t => toasts.push(t), help: t => helps.push(t), big: () => {} },
    police: { level: 0 },
    missions: null, jobs: null,
    vehicles: {
      time: 0, list: [],
      spawn(type, x, z, heading, o = {}) { const v = { id: ids++, type, x, z, heading, vx: 0, vz: 0, w: 0, y: 0, health: 1000, spec: VEHICLE_TYPES[type], role: o.role, color: o.color ?? 1, flat: 0, model: { wheels: [[0.7, 1.2, 0.3, true, 0.2], [-0.7, 1.2, 0.3, true, 0.2], [0.7, -1.2, 0.3, false, 0.2], [-0.7, -1.2, 0.3, false, 0.2]] } }; this.list.push(v); return v; },
      remove(v) { this.list = this.list.filter(o => o !== v); v.removed = true; },
    },
    player: { state: 'foot', pos: { x: 0, z: 30 }, vehicle: null, enterVehicle(v) { this.vehicle = v; this.state = 'driving'; v.role = 'player'; }, leaveVehicle() { this.vehicle.role = 'abandoned'; this.vehicle = null; this.state = 'foot'; } },
    toasts, helps,
  };
  g.addCash = d => { g.save.cash = g.save.cash + d; };
  return g;
}
const mk = (opts) => { const g = fakeGame(opts); const G = new Garage(g, { bays: BAYS, jugaad: { x: 100, z: 0, heading: 0 }, dealerLot: [{ x: 110, z: 0, heading: 0 }, { x: 115, z: 0 }, { x: 120, z: 0 }] }); g.garage = G; return { g, G }; };
const car = (g, type = 'hatch', x = 0, z = 0) => g.vehicles.spawn(type, x, z, 0, { role: 'parked' });

test('tunedSpec scales a clone and leaves VEHICLE_TYPES alone; armour lowers damage', () => {
  const base = VEHICLE_TYPES.hatch, before = { ...base };
  const s = tunedSpec(base, { engine: 3, brakes: 2, armour: 3 });
  assert.notEqual(s, base);
  assert.ok(Math.abs(s.accel - before.accel * 1.4) < 1e-9 && Math.abs(s.top - before.top * 1.18) < 1e-9);
  assert.ok(Math.abs(s.brake - before.brake * 1.4) < 1e-9 && s.mass > before.mass);
  assert.deepEqual(base, before);
  assert.equal(damageK({ armour: 0 }), 1); assert.equal(damageK({ armour: 2 }), 0.55); assert.equal(damageK(undefined), 1);
});

test('only short, non-sarkari cars are claimable; the dealer sells exactly those', () => {
  for (const t of ['police', 'ambulance', 'bus', 'truck']) assert.ok(!CLAIMABLE.includes(t), t);
  assert.deepEqual([...CLAIMABLE].sort(), Object.keys(DEALER_PRICES).sort());
});

test('sanitizeFleet drops junk, police and duplicates, clamps levels, keeps four', () => {
  assert.deepEqual(sanitizeFleet(null), { cars: [], next: 1 });
  const f = sanitizeFleet({ next: 3, cars: [null, 'x', { type: 'police', id: 9 }, { type: 'hatch', id: 1, bay: 0, mods: { engine: 9, armour: -2, horn: 'film', neon: 'pink', sticker: 99 } },
    { type: 'suv', id: 1, bay: 0 }, { type: 'bike' }, { type: 'auto' }, { type: 'sedan' }] });
  assert.equal(f.cars.length, 4);
  assert.equal(new Set(f.cars.map(c => c.id)).size, 4);
  assert.equal(new Set(f.cars.map(c => c.bay)).size, 4);
  const h = f.cars[0];
  assert.equal(h.mods.engine, 3); assert.equal(h.mods.armour, 0); assert.equal(h.mods.horn, null); assert.equal(h.mods.neon, 'pink'); assert.equal(h.mods.sticker, null);
  assert.ok(f.next > Math.max(...f.cars.map(c => c.id)));
});

test('claim: succeeds, or is refused while wanted, during a mission, for a police jeep, with the bays full', () => {
  const { g, G } = mk();
  const v = car(g);
  g.police.level = 2; assert.equal(G.claim(v), null); assert.match(G.lastRefusal, /police/i); g.police.level = 0;
  g.missions = { active: {} }; assert.equal(G.claim(v), null); g.missions = null;
  assert.equal(G.claim(car(g, 'police')), null); assert.match(G.lastRefusal, /sarkari/);
  const r = G.claim(v);
  assert.ok(r && v.owned === r.id && v.keep && v.role === 'owned' && v.spec !== VEHICLE_TYPES.hatch && v.dmgK === 1);
  assert.equal(g.save.data.fleet.cars.length, 1);
  for (let i = 0; i < 3; i++) assert.ok(G.claim(car(g, 'bike')));
  assert.equal(G.claim(car(g, 'sedan')), null); assert.match(G.lastRefusal, /full/i);
});

test('stopping in a free bay for a second claims the car you drive', () => {
  const { g, G } = mk();
  const v = car(g, 'sedan', 5, 0.5);
  g.player.enterVehicle(v); g.player.pos = v;
  for (let i = 0; i < 70; i++) G.update(1 / 60);
  assert.ok(v.owned);
  assert.equal(G.record(v).bay, 1);
});

test('save round trip: fromSave + spawnAll puts the cars back in their bays with colour and mods', () => {
  const { g, G } = mk();
  const v = car(g, 'suv'); v.color = 0x123456; G.claim(v);
  G.buyMod(v, 'engine', 1);
  const saved = JSON.parse(JSON.stringify(g.save.data.fleet));
  const { g: g2, G: G2 } = mk();
  G2.fromSave(saved); G2.spawnAll();
  const back = g2.vehicles.list[0];
  assert.equal(back.type, 'suv'); assert.equal(back.color, 0x123456); assert.equal(back.mods.engine, 1);
  assert.equal(back.x, BAYS[0].x); assert.ok(back.spec.accel > VEHICLE_TYPES.suv.accel);
  assert.equal(G2.vehicleById(saved.cars[0].id), back);
});

test('buyMod charges cash, re-tunes, refuses when short; revert undoes a preview', () => {
  const { g, G } = mk({ cash: 3000 });
  const v = car(g); G.claim(v);
  G.preview(v, 'paint', 0xff3fb4); assert.equal(v.color, 0xff3fb4);
  G.revert(v); assert.notEqual(v.color, 0xff3fb4);
  G.preview(v, 'neon', 'green'); assert.equal(v.mods.neon, 'green'); G.revert(v); assert.equal(v.mods.neon, null);
  assert.ok(G.buyMod(v, 'engine', 1));
  assert.equal(g.save.cash, 500);
  assert.ok(Math.abs(v.spec.accel - VEHICLE_TYPES.hatch.accel * MODS.engine.accel[1]) < 1e-9);
  assert.equal(G.buyMod(v, 'armour', 1), false);
  assert.equal(g.save.cash, 500);
  assert.ok(G.buyMod(v, 'sticker', 1)); assert.equal(v.mods.sticker, 1); assert.equal(G.record(v).spent, 2900);
  assert.equal(G.buyMod(v, 'engine', 1), false, 'a fitted level is not sold twice');
});

test('armour sets dmgK; a buy repairs flats and health; bulletproof tyres refuse bursts', () => {
  const { g, G } = mk();
  const v = car(g); G.claim(v);
  assert.ok(G.buyMod(v, 'armour', 3)); assert.equal(v.dmgK, 0.4);
  assert.ok(G.burst(v, 0)); assert.ok(v.flat & 1);
  v.health = 400;
  assert.ok(G.buyMod(v, 'brakes', 1));
  assert.equal(v.flat, 0); assert.equal(v.health, 1000);
  assert.ok(G.buyMod(v, 'tyres', true));
  assert.equal(G.burst(v, 1), false); assert.equal(v.flat, 0);
});

test('a car left far away is towed to its bay after three minutes; a wreck comes back for a fee', () => {
  const { g, G } = mk({ cash: 1000 });
  const v = car(g, 'hatch'); G.claim(v);
  v.x = 900; v.z = 900; g.player.pos = { x: 0, z: 0 };
  for (let t = 0; t < 200; t += 0.5) G.update(0.5);
  assert.equal(v.x, BAYS[0].x); assert.equal(g.save.cash, 900);
  v.wrecked = true; v.x = 500;
  for (let t = 0; t < 200; t += 0.5) G.update(0.5);
  assert.ok(v.removed, 'the wreck is cleared');
  const back = G.record(g.vehicles.list.find(o => o.owned));
  assert.ok(back && back.v.health === 1000 && back.v.x === BAYS[0].x);
  assert.equal(g.save.cash, 0, '20% of the value, but never more than you have');
});

test('lock on foot, alarm when hit, getting in unlocks; busted in your car: back in its bay', () => {
  const { g, G } = mk();
  const v = car(g, 'bike', 0, 28); G.claim(v);
  const a = G.contextAction();
  assert.equal(a.label, 'LOCK CAR'); a.run();
  assert.ok(v.locked && G.record(v).locked);
  assert.equal(G.contextAction().label, 'UNLOCK CAR');
  G.alarm(v); assert.ok(G.alarmT > 0);
  G.onEnter(v); assert.equal(v.locked, false); assert.equal(G.alarmT, 0);
  v.x = 300;
  G.onRespawn('busted', v);
  assert.equal(v.x, BAYS[0].x); assert.equal(g.save.cash, 50000 - 300);
});

test('dealer: display cars near the lot; buying one makes it yours and puts you in', () => {
  const { g, G } = mk();
  g.player.pos = { x: 110, z: 2 };
  G.update(0.5);
  assert.equal(G.dealerCars.length, 3);
  const a = G.contextAction();
  assert.match(a.label, /^Buy · ₹/); assert.ok(a.label.length <= 18);
  const v = G.dealerCars[0], price = DEALER_PRICES[v.type];
  a.run();
  assert.ok(v.owned); assert.equal(g.player.vehicle, v); assert.equal(g.save.cash, 50000 - price);
});

test('sell pays 40% of price plus spend and frees the bay', () => {
  const { g, G } = mk();
  const v = car(g, 'sedan'); G.claim(v); G.buyMod(v, 'brakes', 1);
  const before = g.save.cash;
  const pay = G.sell(v);
  assert.equal(pay, Math.round((DEALER_PRICES.sedan + 1500) * 0.4));
  assert.equal(g.save.cash, before + pay); assert.equal(G.owned.length, 0); assert.ok(v.removed);
});

test('blips are pooled, clamped and skip the car you drive; static P and J', () => {
  const { g, G } = mk();
  const a = car(g), b = car(g, 'bike'); G.claim(a); G.claim(b);
  const one = G.blips();
  assert.equal(one.length, 2); assert.ok(one.every(x => x.clamp && x.label === '◆'));
  const first = one[0];
  g.player.enterVehicle(a);
  const two = G.blips();
  assert.equal(two.length, 1); assert.equal(two[0], first);
  assert.deepEqual(G.staticBlips().map(x => x.label), ['P', 'J']);
});

test('menu: first tap previews, second buys; leaving a category reverts', () => {
  const { g, G } = mk();
  const v = car(g); G.claim(v);
  g.player.enterVehicle(v);
  const M = new GarageMenu(g); g.garageMenu = M;
  M.show(v);
  assert.ok(M.open);
  M.setCat('neon');
  const i = M.rows().findIndex(r => r.val === 'blue');
  M.tap(i); assert.equal(v.mods.neon, 'blue'); assert.equal(G.record(v).mods.neon, null);
  M.setCat('paint'); assert.equal(v.mods.neon, null);
  M.setCat('neon'); M.tap(i); M.tap(i);
  assert.equal(G.record(v).mods.neon, 'blue');
  M.close(); assert.equal(M.open, false); assert.equal(v.mods.neon, 'blue');
});

test('the Jugaad pad opens the menu when you stop in it, not while wanted', () => {
  const { g, G } = mk();
  const v = car(g, 'hatch', 100, 0); g.player.enterVehicle(v); g.player.pos = v;
  let opened = null; g.garageMenu = { open: false, show: c => { opened = c; } };
  g.police.level = 1; G.update(0.1); assert.equal(opened, null);
  v.x = 120; G.update(0.1); v.x = 100; g.police.level = 0; G.update(0.1);
  assert.equal(opened, v);
});

test('VehicleExtras: glow and sticker instances only for cars that need them', () => {
  const scene = new THREE.Scene();
  const X = new VehicleExtras(scene);
  const m = new THREE.Matrix4();
  X.begin();
  X.add({ spec: VEHICLE_TYPES.hatch, mods: { neon: 'pink', sticker: 2 } }, m);
  X.add({ spec: VEHICLE_TYPES.bike, mods: { neon: null, sticker: null } }, m);
  X.end(1);
  assert.equal(X.glow.count, 1); assert.equal(X.decal.count, 1); assert.equal(X.rows[0], 2);
  assert.ok(X.glow.visible && X.decal.visible);
  X.begin(); X.end(0);
  assert.equal(X.glow.visible, false); assert.equal(X.decal.visible, false);
  assert.equal(X.decal.material.customProgramCacheKey(), 'vehicle-sticker-atlas');
  const r = decalRect({ spec: VEHICLE_TYPES.sedan });
  assert.ok(r[2] < -VEHICLE_TYPES.sedan.L / 2 + 0.01);
  assert.ok(STICKERS.length <= 8 && HORN_IDS.length === 4);
});

test('real world: four bays near home, off the road, clear, away from mission starts; Jugaad 9 m+ from Anna', () => {
  const { net, city } = world();
  const colliders = new Colliders(city);
  const g = { net, colliders, save: { data: {} }, missions: null };
  const G = new Garage(g);
  assert.equal(G.bays.length, 4);
  for (const b of G.bays) {
    assert.ok(Math.hypot(b.x - HOME.x, b.z - HOME.z) < 60, 'near home');
    assert.ok(!net.onRoad(b.x, b.z, 1.5), 'off the road');
    assert.ok(!colliders.blocked(b.x, b.z, 2.2), 'clear');
    for (const d of STORY) if (d.start && typeof d.start === 'object') assert.ok(Math.hypot(b.x - d.start.x, b.z - d.start.z) >= 10, `away from ${d.id}`);
  }
  assert.ok(Math.hypot(G.jugaad.x - GARAGE.x, G.jugaad.z - GARAGE.z) >= 9);
  assert.equal(findBays(net, colliders, HOME, 4).length, 4);
});
