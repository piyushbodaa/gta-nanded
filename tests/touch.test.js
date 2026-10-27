import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TouchControls } from '../src/ui/touch.js';

// Just enough DOM for the touch buttons.
class FakeEl {
  constructor() {
    this.hidden = true; this.textContent = ''; this.style = {}; this.dataset = {};
    const classes = new Set();
    this.classList = { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) };
  }
  addEventListener() {}
  querySelectorAll() { return []; }
}
const els = {};
globalThis.document = { getElementById: id => (els[id] ??= new FakeEl()), body: new FakeEl() };
globalThis.addEventListener ??= () => {};

function driving(type, act = null) {
  const v = { type, sirenOn: false };
  const game = {
    input: { touch: {}, mode: 'touch' },
    player: { state: 'driving', vehicle: v, x: 0, z: 0 },
    jobs: { active: null },
    nearestEnterable: () => null,
    contextAction: () => act,
  };
  const t = new TouchControls(game);
  t.active = true;
  return { t, game, v };
}
const shown = id => (els[id].hidden ? null : els[id].textContent);

test('a police jeep at a race start shows START RACE without the siren, so EXIT keeps under the stars', () => {
  // Three wide rows (EXIT, START RACE, SIREN) pushed EXIT up over the wanted stars and cash on a phone.
  const race = { key: 'N', label: 'Start race: Ring Road Sprint · ₹800' };
  const { t, game, v } = driving('police', race);
  t.update();
  assert.equal(shown('tb-job'), 'START RACE');
  assert.equal(shown('tb-siren'), null);
  // Racing: STOP JOB, still no third row.
  game.jobs.active = { label: 'race' };
  t.update();
  assert.equal(shown('tb-job'), 'STOP JOB');
  assert.equal(shown('tb-siren'), null);
  // Off the marker the siren comes back, and says what a tap will do.
  game.jobs.active = null; game.contextAction = () => null; v.sirenOn = true;
  t.update();
  assert.equal(shown('tb-job'), null);
  assert.equal(shown('tb-siren'), 'SIREN OFF');
  // An ambulance away from any job: SIREN; an auto never has one.
  driving('ambulance').t.update();
  assert.equal(shown('tb-siren'), 'SIREN');
  const auto = driving('auto', { key: 'N', label: 'Start rickshaw fares' });
  auto.t.update();
  assert.equal(shown('tb-job'), 'START JOB');
  assert.equal(shown('tb-siren'), null);
});
