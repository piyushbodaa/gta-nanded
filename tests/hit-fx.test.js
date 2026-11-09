import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HitFx, screenAngle, flashFor, lowFor, beatPeriod, patternFor } from '../src/ui/hit-fx.js';
import { haptic, patternLength } from '../src/ui/haptics.js';

const el = () => ({ hidden: true, style: {} });
function fakeDoc() {
  const marks = [el(), el(), el(), el()];
  const els = { 'hud-dmg': { children: marks }, 'hud-hurt': el() };
  return { marks, els, getElementById: id => els[id] ?? null };
}
function fakeGame({ health = 100, level = 0 } = {}) {
  const g = {
    paused: false, respawning: false,
    player: { health, state: 'foot', pos: { x: 0, z: 0 } },
    camera: { facing: 0, shakes: [], addShake(k) { this.shakes.push(k); } },
    police: { level },
    audio: { calls: [], sfx(n, k) { this.calls.push([n, k]); } },
    hud: { flashes: 0, flashHealth() { this.flashes++; } },
    save: { data: { settings: {} } },
    input: { mode: 'touch' },
  };
  return g;
}
const make = opts => { const doc = fakeDoc(), g = fakeGame(opts); return { g, doc, fx: new HitFx(g, { doc, motion: null }) }; };
// Vibration goes to a stub navigator: haptic() reads globalThis unless given an env.
const buzzes = [];
Object.defineProperty(globalThis, 'navigator', { value: { vibrate: p => { buzzes.push(p); return true; } }, configurable: true, writable: true });

test('screenAngle: ahead is 0, the camera\'s right is +90°, behind is ±180°', () => {
  assert.ok(Math.abs(screenAngle(0, 10, 0, 0, 0)) < 1e-9);
  // facing 0 looks down +z; right is facing - π/2, i.e. towards -x.
  assert.ok(Math.abs(screenAngle(-10, 0, 0, 0, 0) - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(Math.abs(screenAngle(0, -10, 0, 0, 0)) - Math.PI) < 1e-9);
  // It follows the camera: turn to face the attacker and it's ahead again.
  assert.ok(Math.abs(screenAngle(-10, 0, 0, 0, -Math.PI / 2)) < 1e-9);
});

test('the flash rises with damage, is capped at 1 and is gone within a second', () => {
  assert.ok(flashFor(5) < flashFor(20) && flashFor(20) < flashFor(30));
  assert.equal(flashFor(500), 1);
  assert.equal(flashFor(1), 0.25);
  const { fx } = make();
  fx.hurt(30, 'police', null);
  fx.update(0.016);
  assert.ok(fx.edge > 0.5);
  for (let i = 0; i < 60; i++) fx.update(1 / 60);
  assert.equal(fx.flash, 0);
  // A weaker hit doesn't add on top of a stronger one.
  fx.hurt(35, 'police'); fx.hurt(5, 'police');
  assert.equal(fx.flash, 1);
});

test('low health starts under 30 hp; the heartbeat quickens', () => {
  assert.equal(lowFor(30), 0);
  assert.ok(lowFor(29) > 0);
  assert.ok(beatPeriod(lowFor(29)) > beatPeriod(lowFor(5)));
  assert.ok(Math.abs(beatPeriod(lowFor(5)) - 0.6) < 1e-9);
  assert.ok(Math.abs(beatPeriod(0) - 0.95) < 1e-9);
});

test('the heartbeat plays only when low and lately hit (or wanted), and stops 10 s after', () => {
  const { g, fx } = make({ health: 50 });
  for (let i = 0; i < 120; i++) fx.update(1 / 60);
  assert.equal(g.audio.calls.length, 0, 'healthy: no heartbeat');
  g.player.health = 12;
  for (let i = 0; i < 120; i++) fx.update(1 / 60);
  assert.equal(g.audio.calls.length, 0, 'low but not hit lately and not wanted: quiet');
  fx.hurt(5, 'police');
  for (let i = 0; i < 120; i++) fx.update(1 / 60);
  assert.ok(g.audio.calls.some(c => c[0] === 'heartbeat'));
  for (let i = 0; i < 60 * 11; i++) fx.update(1 / 60);
  const n = g.audio.calls.length;
  for (let i = 0; i < 120; i++) fx.update(1 / 60);
  assert.equal(g.audio.calls.length, n, 'stopped after 10 s without a hit at 0 stars');
  g.police.level = 2;
  for (let i = 0; i < 120; i++) fx.update(1 / 60);
  assert.ok(g.audio.calls.length > n, 'wanted keeps it going');
});

test('markers: pooled, a hit within 25° refreshes one, a fifth replaces the oldest', () => {
  const { fx, doc } = make();
  fx.hurt(8, 'police', { x: 0, z: 10 });
  assert.equal(fx.dirs.filter(m => m.t > 0).length, 1);
  fx.hurt(8, 'police', { x: 1, z: 10 }); // ~6° away: the same marker
  assert.equal(fx.dirs.filter(m => m.t > 0).length, 1);
  fx.update(0.1);
  fx.hurt(8, 'police', { x: -10, z: 0 });
  fx.update(0.1);
  fx.hurt(8, 'police', { x: 0, z: -10 });
  fx.update(0.1);
  fx.hurt(8, 'police', { x: 10, z: 0 });
  assert.equal(fx.dirs.filter(m => m.t > 0).length, 4);
  const oldest = fx.dirs.reduce((a, b) => (a.t < b.t ? a : b));
  fx.hurt(8, 'police', { x: 7, z: 7 }); // 45° off the nearest: a new one, in the oldest's place
  assert.equal(oldest.fx, 7);
  fx.update(0.016);
  assert.ok(doc.marks.every(m => +m.style.opacity > 0));
  assert.match(doc.marks[0].style.transform, /^rotate\(-?[\d.]+deg\) translateY/);
  // No marker for falls and crashes.
  const b = make();
  b.fx.hurt(20, 'fall', { x: 0, z: 5 }); b.fx.hurt(20, 'crash', null);
  assert.equal(b.fx.dirs.filter(m => m.t > 0).length, 0);
});

test('the marker points right for an attacker on the right, and fades out', () => {
  const { fx, doc } = make();
  fx.hurt(8, 'police', { x: -10, z: 0 });
  fx.update(0.016);
  const m = doc.marks.find(e => +e.style.opacity > 0);
  assert.match(m.style.transform, /^rotate\(90\.0deg\)/);
  for (let i = 0; i < 90; i++) fx.update(1 / 60);
  assert.equal(+m.style.opacity, 0);
});

test('incoming: a marker with no red edge; reset clears everything', () => {
  const { fx, g } = make();
  fx.incoming(5, 5);
  fx.update(0.016);
  assert.equal(fx.flash, 0);
  assert.equal(fx.dirs.filter(m => m.t > 0).length, 1);
  assert.equal(g.hud.flashes, 0);
  fx.hurt(30, 'police', { x: 0, z: 3 });
  fx.reset();
  fx.update(0.016);
  assert.equal(fx.flash, 0); assert.equal(fx.edge, 0);
  assert.equal(fx.dirs.filter(m => m.t > 0).length, 0);
});

test('fallback edges: shown during a hit, hidden at rest; post.setHurt takes over when there', () => {
  const { fx, doc, g } = make();
  fx.hurt(35, 'police');
  fx.update(0.016);
  assert.equal(doc.els['hud-hurt'].hidden, false);
  for (let i = 0; i < 60; i++) fx.update(1 / 60);
  assert.equal(doc.els['hud-hurt'].hidden, true);
  const calls = [];
  g.post = { enabled: true, setHurt: (...a) => calls.push(a) };
  fx.hurt(35, 'police', { x: 0, z: 5 });
  fx.update(0.016);
  assert.ok(calls.at(-1)[0] > 0.9);
  assert.ok(calls.at(-1)[4] > 0.9, 'direction weight');
  for (let i = 0; i < 90; i++) fx.update(1 / 60);
  assert.deepEqual(calls.at(-1).slice(0, 2), [0, 0], 'back to bit-identical rest');
});

test('big hits shake (halved for reduced motion); explosions shake at their own call site', () => {
  const { fx, g } = make();
  fx.hurt(30, 'police'); fx.hurt(10, 'police'); fx.hurt(70, 'explosion');
  assert.deepEqual(g.camera.shakes, [0.5]);
  const doc = fakeDoc(), g2 = fakeGame();
  const calm = new HitFx(g2, { doc, motion: () => ({ matches: true }) });
  calm.hurt(30, 'police');
  assert.deepEqual(g2.camera.shakes, [0.25]);
});

test('near death drains colour briefly, then eases back', () => {
  const { fx, g } = make();
  g.player.health = 10;
  fx.hurt(5, 'police');
  assert.equal(fx.desat, 0.35);
  for (let i = 0; i < 90; i++) fx.update(1 / 60);
  assert.equal(fx.desat, 0);
});

test('vibration patterns, the setting, the rate limit, WASTED through it', () => {
  assert.equal(patternFor('police', 8), 18);
  assert.equal(patternFor('police', 25), 40);
  assert.deepEqual(patternFor('explosion', 70), [70, 40, 90]);
  assert.equal(patternFor('crash', 10), 30);
  assert.deepEqual(patternLength([120, 80, 220]), { total: 420, on: 340 });
  let now = 1000;
  const calls = [];
  const env = { navigator: { vibrate: p => { calls.push(p); return true; } }, performance: { now: () => now }, document: { hidden: false } };
  const g = fakeGame();
  g.save.data.settings.haptics = false;
  assert.equal(haptic(g, 18, false, env), false);
  assert.equal(calls.length, 0, 'off: no buzz');
  g.save.data.settings.haptics = true;
  assert.equal(haptic(g, 18, false, env), true);
  now += 50;
  assert.equal(haptic(g, 18, false, env), false, 'within 100 ms');
  assert.equal(haptic(g, [120, 80, 220], true, env), true, 'WASTED goes through');
  now += 150;
  g.paused = true;
  assert.equal(haptic(g, 18, false, env), false, 'paused');
  g.paused = false; env.document.hidden = true;
  assert.equal(haptic(g, 18, false, env), false, 'in the background');
  assert.deepEqual(calls, [18, [120, 80, 220]]);
  // A gamepad rumbles instead.
  env.document.hidden = false; now += 500;
  const fx = [];
  env.navigator.getGamepads = () => [null, { vibrationActuator: { playEffect: (t, o) => fx.push([t, o]) } }];
  g.input.mode = 'gamepad';
  assert.equal(haptic(g, 40, false, env), true);
  assert.equal(fx[0][0], 'dual-rumble');
  assert.equal(calls.length, 2);
});

test('hits buzz through HitFx; WASTED buzzes the long pattern and clears markers', () => {
  buzzes.length = 0;
  const { fx } = make();
  fx.hurt(25, 'police', { x: 0, z: 4 });
  fx.wasted();
  assert.deepEqual(buzzes, [40, [120, 80, 220]]);
  assert.equal(fx.dirs.filter(m => m.t > 0).length, 0);
  assert.equal(fx.flash, 1);
});
