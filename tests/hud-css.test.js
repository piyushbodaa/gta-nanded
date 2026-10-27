import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/ui/game.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
// Innermost rule blocks (those inside @media too) as [selectors, declarations].
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => [sel.trim().split(/\s*,\s*/), body]);
const lastClass = sel => sel.split(/[\s>+~]+/).pop().match(/\.([\w-]+)/)?.[1];

// The same rule blocks in source order, each with the @media test it sits in (null outside any).
const mediaRules = [];
{
  let media = null;
  for (const m of css.matchAll(/@media([^{]+)\{|([^{}]+)\{([^{}]*)\}|\}/g)) {
    if (m[1] !== undefined) media = m[1].trim();
    else if (m[2] !== undefined) mediaRules.push({ media, sels: m[2].trim().split(/\s*,\s*/), body: m[3] });
    else media = null;
  }
}
// Does a media query match a w x h viewport? Only the size and orientation tests the HUD uses.
const mediaMatches = (query, w, h) => query.split(',').some(q => q.trim().split(/\s+and\s+/).every(f => {
  const [, name, v] = f.match(/^\(\s*([\w-]+)\s*:\s*([\w.]+)\s*\)$/) ?? assert.fail(`can't read media test ${f}`);
  if (name === 'orientation') return (v === 'portrait') === (h >= w);
  const px = parseFloat(v), size = name.endsWith('height') ? h : w;
  if (name.startsWith('max-')) return size <= px;
  if (name.startsWith('min-')) return size >= px;
  return assert.fail(`can't read media test ${f}`);
}));
// The last value a selector gets for a property at a viewport size (rules for that exact selector only).
const valueAt = (sel, prop, w, h) => {
  let value;
  for (const r of mediaRules) {
    if (!r.sels.includes(sel) || (r.media && !mediaMatches(r.media, w, h))) continue;
    const m = [...r.body.matchAll(/(?:^|;)\s*([\w-]+)\s*:\s*([^;]+)/g)].filter(d => d[1] === prop).pop();
    if (m) value = m[2].trim();
  }
  return value;
};

test('cards that fade with areafade are not centred with transform, which the animation owns', () => {
  // While an animation runs, its transform replaces the element's: a card centred with
  // translateX(-50%) would sit with its left edge at the middle, over the cash and stars.
  const faded = new Set();
  for (const [sels, body] of rules) if (/animation:\s*areafade\b/.test(body)) for (const s of sels) faded.add(lastClass(s));
  assert.ok(['area-name', 'vehicle-name', 'radio-card', 'rotate'].every(c => faded.has(c)), [...faded].join(' '));
  for (const [sels, body] of rules) {
    const t = body.match(/(?:^|;)\s*transform:\s*([^;]+)/)?.[1].trim();
    if (!t || t === 'none') continue;
    for (const s of sels) assert.ok(!faded.has(lastClass(s)), `${s} { transform: ${t} } fights areafade`);
  }
});

test('the middle column clears the driving buttons at every landscape phone height, fractions of a pixel too', () => {
  // The button grid's width follows the button sizes; the column's right margin (--clear-r) has to switch
  // at exactly the same height. Android phones can be 420.2 px tall, so test between whole pixels too.
  const px = v => parseFloat(v.match(/([\d.]+)px/)[1]);
  const seen = new Map();
  for (let tenth = 3000; tenth <= 5000; tenth++) {
    const h = tenth / 10;
    const buttons = px(valueAt('.tb', 'width', 915, h)) + px(valueAt('.tb.pedal', 'width', 915, h));
    const clear = px(valueAt('body.touch-ui .hud-stack', '--clear-r', 915, h));
    seen.set(`${buttons} ${clear}`, { h, buttons, clear });
  }
  const sizes = [...seen.values()];
  assert.ok(sizes.length >= 2, 'expected the buttons to shrink on short phones');
  for (const a of sizes) for (const b of sizes) {
    assert.equal(Math.sign(a.buttons - b.buttons), Math.sign(a.clear - b.clear),
      `${a.h} px tall: buttons ${a.buttons}, clearance ${a.clear}; ${b.h} px tall: buttons ${b.buttons}, clearance ${b.clear}`);
  }
});
