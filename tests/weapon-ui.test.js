import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS, ORDER, SLOTS } from '../src/game/weapon-data.js';

// Just enough of a browser for the input, the touch buttons, the HUD and the wheel: listeners, elements that
// count their writes, a clock and a gamepad.
class El {
  constructor() { this.on = {}; }
  addEventListener(type, f) { (this.on[type] ||= []).push(f); }
}
class FakeEl extends El {
  constructor(id) {
    super();
    this.id = id; this.hidden = true; this.writes = 0; this.html = ''; this.dataset = {}; this.children = []; this.cls = '';
    this.offsetWidth = 0; this.offsetTop = 0; this.offsetHeight = 0;
    this.style = { setProperty(k, v) { this[k] = v; } };
    const classes = new Set();
    this.classList = { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) };
    this.parentElement = { classList: this.classList, getBoundingClientRect: () => ({ bottom: 0 }) };
  }
  get innerHTML() { return this.html; }
  set innerHTML(v) {
    this.html = String(v); this.writes++;
    // The wheel builds its slots from markup: make them findable.
    const slots = [...this.html.matchAll(/data-slot="(\w+)"/g)];
    if (slots.length) this.children = slots.map(m => Object.assign(new FakeEl(), { dataset: { slot: m[1] } }));
  }
  get textContent() { return this.html; }
  set textContent(v) { this.html = String(v); this.writes++; }
  get className() { return this.cls; }
  set className(v) { this.cls = v; this.writes++; }
  querySelectorAll() { return this.children; }
  querySelector() { return null; }
  closest() { return this.dataset.slot ? this : null; }
  getContext() { return {}; }
  getBoundingClientRect() { return { width: 100, height: 100, top: 0, bottom: 0 }; }
}
for (const name of ['HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLButtonElement']) globalThis[name] = class extends El {};
const win = new El();
const els = {};
globalThis.addEventListener = (type, f) => win.addEventListener(type, f);
globalThis.document = Object.assign(new El(), { body: new FakeEl('body'), hidden: false, pointerLockElement: null, getElementById: id => (els[id] ??= new FakeEl(id)) });
globalThis.matchMedia = () => ({ matches: false });
globalThis.requestAnimationFrame = () => 0;
globalThis.innerWidth = 568; globalThis.innerHeight = 320;
let now = 1000;
globalThis.performance = { now: () => now };
let pads = [];
navigator.getGamepads = () => pads;

const { Input } = await import('../src/core/input.js');
const { TouchControls } = await import('../src/ui/touch.js');
const { Hud } = await import('../src/ui/hud.js');
const { WeaponWheel, slotAt, slotOwned, ammoText } = await import('../src/ui/weapon-wheel.js');

function fire(target, type, props = {}) {
  const e = { type, target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...props };
  for (const f of target.on[type] || []) f(e);
  if (target !== win) for (const f of win.on[type] || []) f(e);
  return e;
}
const key = (type, code, target = document.body) => fire(target, type, { code });
const pad = (pressed, axes = [0, 0, 0, 0], values = {}) => ({ index: 0, connected: true, axes,
  buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: pressed.includes(i), value: values[i] ?? (pressed.includes(i) ? 1 : 0) })) });
function freshInput() {
  win.on = {}; document.on = {};
  const canvas = new El();
  const input = new Input(canvas);
  input.live = true;
  return { input, canvas };
}

/** A stand-in for game.weapons with the contract's fields: owned weapons with their magazines and reserves. */
function fakeWeapons(owned = ['fist', 'p92'], current = 'p92') {
  const ammo = Object.fromEntries(ORDER.map(id => [id, { mag: WEAPONS[id].mag || (WEAPONS[id].hold === 'throw' ? 2 : 0), reserve: WEAPONS[id].start || 0 }]));
  const picked = {};
  const log = [];
  const w = {
    current, owned, ammo, log, reloading: 0, aiming: false, scoped: false, spread: 0.03, blocked: null, wheelOpen: false, hitMarker: null, active: true, foot: true,
    get def() { return WEAPONS[this.current]; },
    get mag() { return ammo[this.current].mag; },
    get reserve() { return ammo[this.current].reserve; },
    get armed() { return this.foot && this.current !== 'fist'; },
    has(id) { return owned.includes(id); },
    ammoOf(id) { return ammo[id]; },
    slotWeapon(slot) { const list = slotOwned(this, slot); return list.includes(this.current) ? this.current : picked[slot] ?? list[0] ?? null; },
    equip(id) { this.current = id; picked[WEAPONS[id].slot] = id; },
    selectSlot(slot) {
      log.push(['selectSlot', slot]);
      const list = slotOwned(this, slot);
      this.equip(list.includes(this.current) ? list[(list.indexOf(this.current) + 1) % list.length] : list[0]);
    },
    openWheel() { log.push(['open']); this.wheelOpen = true; },
    closeWheel(id) { log.push(id === undefined ? ['close'] : ['close', id]); this.wheelOpen = false; if (id) this.equip(id); },
  };
  return w;
}
function wheelGame(w, input) {
  return { weapons: w, paused: false, cutscene: false, player: { vehicle: null, state: 'foot', x: 0, z: 0 }, input: input ?? freshInput().input };
}

// ---------------------------------------------------------------- input

test('held Tab is the weapon wheel and M stays the map', () => {
  const { input, canvas } = freshInput();
  const e = key('keydown', 'Tab', canvas);
  input.update();
  assert.ok(e.defaultPrevented, 'Tab does not move focus off the street');
  assert.equal(input.state.wheelHeld, true);
  assert.equal(input.pressed('map'), false);
  assert.equal(input.events.size, 0, 'held, not pressed');
  key('keyup', 'Tab');
  input.update();
  assert.equal(input.state.wheelHeld, false);
  key('keydown', 'KeyM');
  assert.equal(input.pressed('map'), true);
});

test('number keys 1 to 7 pick wheel slots; R stays the radio key', () => {
  const { input } = freshInput();
  for (let i = 1; i <= 7; i++) {
    key('keydown', `Digit${i}`); key('keyup', `Digit${i}`);
    assert.equal(input.pressed(`slot${i}`), true, `Digit${i}`);
  }
  key('keydown', 'Numpad3');
  assert.equal(input.pressed('slot3'), true);
  key('keydown', 'Digit8');
  assert.equal(input.events.size, 0);
  key('keydown', 'KeyR');
  assert.equal(input.pressed('radio'), true, 'the game reads it as reload on foot');
});

test('the mouse wheel changes weapon on foot, a notch at a time, and zooms otherwise', () => {
  const { input, canvas } = freshInput();
  fire(canvas, 'wheel', { deltaY: 100, deltaMode: 0 });
  assert.equal(input.zoom, 1, 'in a vehicle it is the camera zoom');
  assert.equal(input.pressed('weaponNext'), false);
  input.zoom = 0; input.weaponScroll = true;
  fire(canvas, 'wheel', { deltaY: 100, deltaMode: 0 });
  assert.ok(!input.zoom, 'no zoom on foot');
  assert.equal(input.pressed('weaponNext'), true, 'down is next');
  fire(canvas, 'wheel', { deltaY: -100, deltaMode: 0 });
  assert.equal(input.pressed('weaponPrev'), true);
  // A trackpad's small steps add up to one notch.
  for (let i = 0; i < 9; i++) fire(canvas, 'wheel', { deltaY: 10, deltaMode: 0 });
  assert.equal(input.pressed('weaponNext'), false);
  fire(canvas, 'wheel', { deltaY: 10, deltaMode: 0 });
  assert.equal(input.pressed('weaponNext'), true);
  // With the wheel held it moves within the highlighted slot instead.
  key('keydown', 'Tab', canvas);
  fire(canvas, 'wheel', { deltaY: 100, deltaMode: 0 });
  assert.equal(input.pressed('wheelNext'), true);
  assert.equal(input.pressed('weaponNext'), false);
  fire(new El(), 'wheel', { deltaY: 100, deltaMode: 0 }); // the pause menu's map
  assert.equal(input.events.size, 0);
});

test('a gamepad on foot fires with RT, aims with LT, reloads with B and holds the wheel on RB', () => {
  const { input } = freshInput();
  input.weaponScroll = true;
  pads = [pad([7], [0, 0, 0, 0], { 7: 0.8 })];
  input.update();
  assert.equal(input.pressed('attack'), true, 'pulling RT fires once');
  assert.equal(input.state.attackHeld, true, 'held for automatic fire');
  input.update();
  assert.equal(input.pressed('attack'), false, 'one press, however long it is held');
  pads = [pad([], [0, 0, 0, 0], { 6: 0.6 })];
  input.update();
  assert.equal(input.state.aim, true);
  assert.equal(input.state.attackHeld, false);
  pads = [pad([1])];
  input.update();
  assert.equal(input.pressed('reload'), true);
  assert.equal(input.pressed('attack'), false, 'B is reload (the game punches with it bare-handed)');
  pads = [pad([5])];
  input.update();
  assert.equal(input.state.wheelHeld, true);
  assert.equal(input.pressed('radio'), false, "RB on foot is not the radio, which the game would read as reload");
  pads = [pad([5, 15], [0, 0, 0.9, 0])];
  input.update();
  assert.equal(input.pressed('wheelNext'), true, 'D-pad moves within the slot while the wheel is up');
  assert.ok(input.state.stickX > 0.8, 'the right stick points the wheel');
  pads = [pad([])]; input.update();
  pads = [pad([14])]; input.update();
  assert.equal(input.pressed('weaponPrev'), true);
  pads = [pad([15])]; input.update();
  assert.equal(input.pressed('weaponNext'), true);
  pads = [];
});

test('behind the wheel RT and LT stay the pedals and RB the radio', () => {
  const { input } = freshInput();
  input.weaponScroll = false;
  pads = [pad([5, 7], [0, 0, 0, 0], { 7: 1 })];
  input.update();
  assert.equal(input.state.throttle, 1);
  assert.equal(input.pressed('attack'), false);
  assert.equal(input.state.attackHeld, false);
  assert.equal(input.state.wheelHeld, false);
  assert.equal(input.pressed('radio'), true);
  // Getting out with RT (the throttle), LT and RB still down neither fires, aims nor opens the wheel...
  pads = [pad([5, 6, 7], [0, 0, 0, 0], { 6: 1, 7: 1 })];
  input.update();
  input.weaponScroll = true;
  input.update(); input.update();
  assert.equal(input.pressed('attack'), false);
  assert.deepEqual([input.state.attackHeld, input.state.aim, input.state.wheelHeld], [false, false, false]);
  // ...until each is let go and pulled again on foot.
  pads = [pad([])]; input.update();
  pads = [pad([5, 6, 7], [0, 0, 0, 0], { 6: 1, 7: 1 })]; input.update();
  assert.deepEqual([input.state.attackHeld, input.state.aim, input.state.wheelHeld], [true, true, true]);
  pads = [];
});

test('with a free cursor the mouse wheel still moves within the weapon wheel over its overlay', () => {
  const { input, canvas } = freshInput();
  input.weaponScroll = true;
  const overlay = Object.assign(new El(), { closest: sel => (sel === '#weapon-wheel' ? overlay : null) });
  key('keydown', 'Tab', canvas);
  fire(overlay, 'wheel', { deltaY: 100, deltaMode: 0 });
  assert.equal(input.pressed('wheelNext'), true);
});

test('the touch FIRE buttons hold the trigger, and a menu opening lets go of them', () => {
  const { input } = freshInput();
  input.touch.active = true;
  input.touch.fire = true;
  input.update();
  assert.equal(input.state.attackHeld, true);
  input.touch.fire = false; input.touch.fire2 = true;
  input.update();
  assert.equal(input.state.attackHeld, true, 'the left-hand FIRE too');
  input.touch.aim = true;
  input.clear();
  input.update();
  assert.equal(input.state.attackHeld, false);
  assert.equal(input.touch.fire2, false);
  assert.equal(input.touch.aim, false);
});

// ---------------------------------------------------------------- wheel

test('a direction points at the slot round the wheel that way, clockwise from the top', () => {
  const n = SLOTS.length, step = Math.PI * 2 / n;
  for (let i = 0; i < n; i++) {
    for (const off of [-0.45, 0, 0.45]) { // anywhere within the slot's sector
      const a = (i + off) * step;
      assert.equal(slotAt(Math.sin(a) * 100, -Math.cos(a) * 100), i, `slot ${i} at ${off}`);
    }
  }
  assert.equal(slotAt(0, -1), 0, 'up is melee');
  assert.equal(SLOTS[slotAt(1, 0)].id, 'smg', 'right, a quarter turn, is the third slot');
  assert.equal(SLOTS[slotAt(-1, 0)].id, 'sniper');
  assert.equal(slotAt(5, 5, 20), -1, 'inside the dead zone: none');
  assert.equal(slotAt(0, 0), -1);
});

test('slots list what is owned, and the ammo line reads as magazine over reserve', () => {
  const w = fakeWeapons(['fist', 'pan', 'p92', 'akm', 'm416', 'grenade'], 'akm');
  assert.deepEqual(slotOwned(w, 'rifle'), ['akm', 'm416']);
  assert.deepEqual(slotOwned(w, 'sniper'), []);
  assert.equal(ammoText(w, 'akm'), '30 / 60');
  assert.equal(ammoText(w, 'grenade'), '×2');
  assert.equal(ammoText(w, 'fist'), '');
});

test('holding Tab opens the wheel, the mouse points and letting go takes that weapon', () => {
  const w = fakeWeapons(['fist', 'p92', 'uzi'], 'p92');
  const { input, canvas } = freshInput();
  const g = wheelGame(w, input);
  const wheel = new WeaponWheel(g);
  input.pointerLocked = true;
  key('keydown', 'Tab', canvas); input.update();
  wheel.update(1 / 60);
  assert.equal(w.wheelOpen, true);
  assert.equal(els['weapon-wheel'].hidden, false);
  assert.equal(SLOTS[wheel.hl].id, 'pistol', 'it opens on the weapon in hand');
  // A little nudge is not a choice; a real move to the right points at the SMG slot.
  fire(win, 'mousemove', { movementX: 10, movementY: 0 });
  assert.equal(SLOTS[wheel.hl].id, 'pistol');
  fire(win, 'mousemove', { movementX: 80, movementY: 0 });
  assert.equal(SLOTS[wheel.hl].id, 'smg');
  wheel.update(1 / 60);
  assert.match(els['ww-name'].html, /Micro UZI/);
  key('keyup', 'Tab'); input.update();
  wheel.update(1 / 60);
  assert.deepEqual(w.log.at(-1), ['close', 'uzi']);
  assert.equal(w.current, 'uzi');
  assert.equal(els['weapon-wheel'].hidden, true);
});

test('letting go on an empty slot keeps the weapon in hand; next and previous move within a slot', () => {
  const w = fakeWeapons(['fist', 'p92', 'akm', 'm416'], 'p92');
  const g = wheelGame(w), input = g.input;
  const wheel = new WeaponWheel(g);
  input.held.add('wheelHold'); input.update();
  wheel.update(0);
  wheel._highlight(SLOTS.findIndex(s => s.id === 'sniper'));
  input.held.delete('wheelHold'); input.update();
  wheel.update(0);
  assert.deepEqual(w.log.at(-1), ['close'], 'nothing there: close without changing');
  assert.equal(w.current, 'p92');
  // The rifle slot holds two: the wheel shows one and next shows the other.
  input.held.add('wheelHold'); input.update();
  wheel.update(0);
  wheel._highlight(SLOTS.findIndex(s => s.id === 'rifle'));
  assert.equal(wheel.chosen(), 'akm');
  input.trigger('wheelNext');
  wheel.update(0);
  assert.equal(wheel.chosen(), 'm416');
  const rifleSlot = wheel.slots[SLOTS.findIndex(s => s.id === 'rifle')];
  assert.match(rifleSlot.html, /M416.*2\/2/);
  input.held.delete('wheelHold'); input.update();
  wheel.update(0);
  assert.equal(w.current, 'm416');
});

test('a number key held in the wheel points at its slot, and letting go takes it', () => {
  const w = fakeWeapons(['fist', 'p92', 's12k'], 'p92');
  const g = wheelGame(w), input = g.input;
  const wheel = new WeaponWheel(g);
  input.held.add('wheelHold'); input.update(); wheel.update(0);
  input.trigger('slot5'); wheel.update(0);
  assert.equal(SLOTS[wheel.hl].id, 'shotgun');
  assert.equal(w.wheelOpen, true, 'still up while Tab is held');
  input.held.delete('wheelHold'); input.update(); wheel.update(0);
  assert.equal(w.current, 's12k');
});

test('on a touch screen the weapon button opens the wheel, a tap chooses, a tap outside closes', () => {
  const w = fakeWeapons(['fist', 'p92', 'akm', 'm416'], 'akm');
  const g = wheelGame(w), input = g.input;
  input.mode = 'touch';
  const wheel = new WeaponWheel(g);
  input.trigger('wheel');
  wheel.update(0);
  assert.equal(w.wheelOpen, true);
  assert.equal(wheel.mode, 'tap');
  wheel.update(0);
  assert.equal(w.wheelOpen, true, 'stays up with no button held');
  // Tapping the slot in hand, which holds two, swaps within it and stays open to show which.
  const rifle = wheel.slots[SLOTS.findIndex(s => s.id === 'rifle')];
  fire(els['weapon-wheel'], 'pointerdown', { target: rifle });
  assert.deepEqual(w.log.at(-1), ['selectSlot', 'rifle']);
  assert.equal(w.current, 'm416');
  assert.equal(w.wheelOpen, true);
  // Another slot: take it and close.
  fire(els['weapon-wheel'], 'pointerdown', { target: wheel.slots[SLOTS.findIndex(s => s.id === 'pistol')] });
  assert.deepEqual(w.log.at(-1), ['close', 'p92']);
  assert.equal(els['weapon-wheel'].hidden, true);
  // An empty slot does nothing; a tap off the slots closes.
  input.trigger('wheel'); wheel.update(0);
  fire(els['weapon-wheel'], 'pointerdown', { target: wheel.slots[SLOTS.findIndex(s => s.id === 'shotgun')] });
  assert.equal(w.wheelOpen, true);
  fire(els['weapon-wheel'], 'pointerdown', { target: els['weapon-wheel'] });
  assert.deepEqual(w.log.at(-1), ['close']);
  assert.equal(w.current, 'p92');
});

test('the wheel closes for the pause menu, a vehicle or a cutscene, and Tab must come up before it reopens', () => {
  const w = fakeWeapons(['fist', 'p92'], 'p92');
  const g = wheelGame(w), input = g.input;
  const wheel = new WeaponWheel(g);
  for (const [set, unset] of [[() => { g.paused = true; }, () => { g.paused = false; }], [() => { g.player.vehicle = {}; }, () => { g.player.vehicle = null; }], [() => { g.cutscene = {}; }, () => { g.cutscene = false; }]]) {
    input.trigger('wheel'); wheel.update(0);
    assert.equal(w.wheelOpen, true);
    set(); wheel.update(0);
    assert.equal(w.wheelOpen, false);
    assert.equal(els['weapon-wheel'].hidden, true);
    unset();
  }
  // Closed by a click while Tab is still held: it waits for Tab to come up.
  input.held.add('wheelHold'); input.update();
  wheel.update(0);
  wheel.tapSlot(SLOTS.findIndex(s => s.id === 'melee'));
  assert.equal(w.current, 'fist');
  wheel.update(0);
  assert.equal(w.wheelOpen, false, 'not straight back open');
  input.held.delete('wheelHold'); input.update(); wheel.update(0);
  input.held.add('wheelHold'); input.update(); wheel.update(0);
  assert.equal(w.wheelOpen, true);
});

test('the right stick points the wheel, and a stick at rest keeps the highlight', () => {
  const w = fakeWeapons(['fist', 'p92', 'kar98k'], 'p92');
  const g = wheelGame(w), input = g.input;
  const wheel = new WeaponWheel(g);
  input.weaponScroll = true;
  pads = [pad([5], [0, 0, -0.9, 0])];
  input.update(); wheel.update(0);
  assert.equal(SLOTS[wheel.hl].id, 'sniper');
  pads = [pad([5], [0, 0, 0.1, 0])];
  input.update(); wheel.update(0);
  assert.equal(SLOTS[wheel.hl].id, 'sniper');
  pads = [pad([])];
  input.update(); wheel.update(0);
  assert.deepEqual(w.log.at(-1), ['close', 'kar98k']);
  pads = [];
});

// ---------------------------------------------------------------- HUD

function hudGame(w) {
  return {
    time: 10, waypoint: null, weapons: w, cutscene: false,
    input: { mode: 'keyboard', touch: { active: false } }, save: { cash: 0 }, sky: { clockText: () => '17:00' },
    player: { pos: { x: 0, z: 0 }, x: 0, z: 0, state: 'foot', vehicle: null, health: 100, maxHealth: 100, stamina: 1 },
    city: { district: () => ({ name: 'Taroda Khurd' }) }, missions: { active: null, blips: () => [] }, jobs: { active: null },
    net: { route: () => null }, nearestEnterable: () => null,
  };
}
function hudFor(g) {
  for (const k in els) delete els[k];
  const hud = new Hud(g);
  hud.radar = { draw() {}, resize() {} };
  return hud;
}

test('the ammo readout touches the DOM only when the ammo changes', () => {
  const w = fakeWeapons(['fist', 'akm'], 'akm'), g = hudGame(w), hud = hudFor(g);
  for (let i = 0; i < 100; i++) hud.update(1 / 60);
  assert.equal(els['hud-weapon'].hidden, false);
  assert.equal(els['hud-wammo'].writes, 1);
  assert.equal(els['hud-wname'].writes, 1);
  assert.match(els['hud-wammo'].html, /<b>30<\/b> \/ 60/);
  assert.match(els['hud-wname'].html, /AKM <small>7\.62mm<\/small>/);
  w.ammo.akm.mag = 29;
  for (let i = 0; i < 10; i++) hud.update(1 / 60);
  assert.equal(els['hud-wammo'].writes, 2);
  // Reloading: dim, with a bar; then back.
  w.reloading = 0.5;
  hud.update(1 / 60);
  assert.equal(els['hud-wammo'].html, 'Reloading');
  assert.ok(els['hud-weapon'].classList.contains('reloading'));
  assert.equal(els['hud-wbar'].style.transform, 'scaleX(0.5)');
  w.reloading = 0; w.ammo.akm.mag = 30; w.ammo.akm.reserve = 30;
  hud.update(1 / 60);
  assert.ok(!els['hud-weapon'].classList.contains('reloading'));
  // Bare hands: no readout.
  w.current = 'fist';
  hud.update(1 / 60);
  assert.equal(els['hud-weapon'].hidden, true);
});

test('the crosshair shows for a gun, parts as the shots spread, and gives way to the scope', () => {
  const w = fakeWeapons(['fist', 'p92', 'kar98k'], 'fist'), g = hudGame(w), hud = hudFor(g);
  hud.update(1 / 60);
  assert.equal(els['hud-crosshair'].hidden, true, 'not with bare hands');
  w.current = 'p92'; w.spread = 0.03;
  hud.update(1 / 60);
  assert.equal(els['hud-crosshair'].hidden, false);
  const narrow = parseFloat(els['hud-crosshair'].style['--gap']);
  w.spread = 0.08;
  hud.update(1 / 60);
  assert.ok(parseFloat(els['hud-crosshair'].style['--gap']) > narrow, 'wider spread, wider gap');
  w.current = 'kar98k'; w.aiming = true; w.scoped = true;
  hud.update(1 / 60);
  assert.equal(els['hud-crosshair'].hidden, true);
  assert.equal(els['hud-scope'].hidden, false);
  assert.equal(els['hud-scope-zoom'].html, '4×');
  w.scoped = false;
  hud.update(1 / 60);
  assert.equal(els['hud-scope'].hidden, true);
  // In a vehicle the guns are holstered.
  g.player.vehicle = { vx: 0, vz: 0, heading: 0, gear: 1, health: 1000 }; g.player.state = 'driving';
  hud.update(1 / 60);
  assert.equal(els['hud-crosshair'].hidden, true);
  assert.equal(els['hud-weapon'].hidden, true);
});

test('the hit marker flashes for a quarter second, red for a knock-out; holy places say why guns are quiet', () => {
  const w = fakeWeapons(['fist', 'p92'], 'p92'), g = hudGame(w), hud = hudFor(g);
  w.hitMarker = { t: g.time, kill: false, head: false };
  hud.update(1 / 60);
  assert.equal(els['hud-hitmark'].hidden, false);
  assert.ok(!els['hud-hitmark'].classList.contains('kill'));
  g.time += 0.3;
  hud.update(1 / 60);
  assert.equal(els['hud-hitmark'].hidden, true);
  w.hitMarker = { t: g.time, kill: true };
  hud.update(1 / 60);
  assert.ok(els['hud-hitmark'].classList.contains('kill'));
  w.blocked = 'holy';
  for (let i = 0; i < 30; i++) hud.update(1 / 60);
  assert.equal(els['hud-notice'].hidden, false);
  assert.equal(els['hud-notice'].writes, 1);
  assert.match(els['hud-notice'].html, /holy places/);
  w.blocked = null;
  hud.update(1 / 60);
  assert.equal(els['hud-notice'].hidden, true);
});

test('an air drop shows on the radar until it is taken', () => {
  const w = fakeWeapons(), g = hudGame(w), hud = hudFor(g);
  assert.equal(hud.collectBlips().length, 0);
  w.airdrop = { x: 100, z: -50, y: 30, landed: false };
  const b = hud.collectBlips();
  assert.equal(b.length, 1);
  assert.deepEqual([b[0].x, b[0].z, b[0].color], [100, -50, '#ff4d3d']);
});

// ---------------------------------------------------------------- touch buttons

function touchFor(w, state = 'foot') {
  for (const k in els) delete els[k];
  const game = {
    weapons: w, input: { touch: {}, mode: 'touch', look: { x: 0, y: 0 }, lookScale: 1, enabled: true },
    player: { state, vehicle: state === 'driving' ? { type: 'auto' } : null, x: 0, z: 0 },
    jobs: { active: null }, nearestEnterable: () => null, contextAction: () => null,
  };
  const t = new TouchControls(game);
  t.active = true;
  return { t, game };
}
const shown = id => (els[id].hidden ? null : els[id].textContent);

test('bare-handed the trigger is PUNCH and the gun buttons hide; the weapon button still opens the wheel', () => {
  const w = fakeWeapons(['fist', 'p92'], 'fist');
  const { t } = touchFor(w);
  t.update();
  assert.equal(shown('tb-fire'), 'PUNCH');
  assert.equal(shown('tb-fire2'), null);
  assert.equal(shown('tb-aim'), null);
  assert.equal(shown('tb-reload'), null);
  assert.equal(shown('tb-weapon'), 'FIST');
});

test('with a gun the trigger is FIRE, with a left-hand FIRE, AIM (SCOPE for a sniper) and RELOAD', () => {
  const w = fakeWeapons(['fist', 'p92', 'kar98k', 'pan', 'grenade'], 'p92');
  const { t } = touchFor(w);
  t.update();
  assert.equal(shown('tb-fire'), 'FIRE');
  assert.equal(shown('tb-fire2'), 'FIRE');
  assert.equal(shown('tb-aim'), 'AIM');
  assert.equal(shown('tb-reload'), 'RELOAD');
  assert.equal(shown('tb-weapon'), 'P92\n15/30');
  // Written only when it changes.
  const writes = els['tb-weapon'].writes;
  for (let i = 0; i < 30; i++) t.update();
  assert.equal(els['tb-weapon'].writes, writes);
  w.ammo.p92.mag = 14;
  t.update();
  assert.equal(shown('tb-weapon'), 'P92\n14/30');
  w.aiming = true; t.update();
  assert.ok(els['tb-aim'].classList.contains('on'));
  w.current = 'kar98k'; t.update();
  assert.equal(shown('tb-aim'), 'SCOPE');
  w.current = 'pan'; t.update();
  assert.equal(shown('tb-fire'), 'SWING');
  assert.equal(shown('tb-aim'), null);
  assert.equal(shown('tb-weapon'), 'PAN');
  w.current = 'grenade'; t.update();
  assert.equal(shown('tb-fire'), 'THROW');
  assert.equal(shown('tb-reload'), null);
  assert.equal(shown('tb-weapon'), 'FRAG\n×2');
});

test('driving holsters the gun: the weapon buttons hide and PUNCH is back for when you get out', () => {
  const w = fakeWeapons(['fist', 'akm'], 'akm');
  w.foot = false; // game.weapons.armed is false off foot
  const { t } = touchFor(w, 'driving');
  t.update();
  assert.equal(shown('tb-weapon'), null);
  assert.equal(shown('tb-fire2'), null);
  assert.equal(shown('tb-aim'), null);
  assert.equal(shown('tb-reload'), null);
});
