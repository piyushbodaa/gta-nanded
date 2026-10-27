import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/ui/game.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
// Innermost rule blocks (those inside @media too) as [selectors, declarations].
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => [sel.trim().split(/\s*,\s*/), body]);
const lastClass = sel => sel.split(/[\s>+~]+/).pop().match(/\.([\w-]+)/)?.[1];

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
