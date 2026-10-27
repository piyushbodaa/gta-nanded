import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './helpers.js';
import { Colliders, SOLID } from '../src/world/colliders.js';
import { SOLID_BELOW } from '../src/world/roadnet.js';

// Medians, railings and ramps are solid where they are drawn, and nowhere else.

let cached = null;
const colliders = () => cached || (cached = new Colliders(world().city));

test('a median\'s colliders follow it round the bends, with no kerb in the lane and no gap through it', () => {
  const { net } = world();
  const col = colliders(), near = {};
  const wide = r => net.width[r] >= 11.5 && !net.bridge[r] && !net.oneway[r];
  let pieces = 0;
  for (let i = 0; i < col.n; i++) {
    if (col.type[i] !== SOLID.OBB || Math.abs(col.hw[i] - 0.35) > 1e-4 || Math.abs(col.h[i] - 0.35) > 1e-4) continue;
    // A centre median's piece is centred on its road's line; both its ends must be too.
    const n = net.nearest(col.x[i], col.z[i], 1, near, wide);
    if (!n || n.dist > 0.05) continue;
    for (const end of [1, -1]) {
      const x = col.x[i] + col.s[i] * col.hd[i] * end, z = col.z[i] + col.c[i] * col.hd[i] * end;
      const m = net.nearest(x, z, 5, near, wide);
      assert.ok(m && m.dist < 0.05, `median piece ${i} ends ${m ? m.dist.toFixed(2) : '5+'} m off the median at (${x.toFixed(0)}, ${z.toFixed(0)})`);
    }
    pieces++;
  }
  assert.ok(pieces > 800, `${pieces} median pieces`);
});

test('a flyover ramp\'s solid end is closed to the street under the deck, and open to the deck\'s own traffic', () => {
  const { net } = world();
  const col = colliders(), p = {}, out = {};
  let ramps = 0;
  for (let r = 0; r < net.count; r++) {
    if (!net.raised[r]) continue;
    for (let s = 1; s < net.length[r] - 1; s += 0.5) {
      const a = net.deckAt(r, s - 0.5), b = net.deckAt(r, s);
      if ((a >= SOLID_BELOW) === (b >= SOLID_BELOW)) continue;
      // From 10 m out under the deck to 10 m into the embankment, a car-sized box down the
      // middle of the carriageway and in each lane: at street level something stops it; on
      // the deck, down the middle, nothing does. (A divided road's carriageway runs from its
      // median to its kerb.)
      const dir = a >= SOLID_BELOW ? 1 : -1, eL = net.edgeAt(r, s, 1), eR = net.edgeAt(r, s, -1);
      for (const f of [0, 0.25, -0.25]) {
        let stopped = false;
        for (let u = -10; u <= 10; u += 0.3) {
          const su = s + u * dir;
          net.pointAt(r, su, p);
          const off = (eL - eR) / 2 + (eL + eR) * f, x = p.x + p.dz * off, z = p.z - p.dx * off, heading = Math.atan2(p.dx, p.dz);
          if (col.boxContact(x, z, 0.85, 2.2, heading, out, 0)) stopped = true;
          if (f === 0 && su > net.trimStart(r) + 2.2 && su < net.length[r] - net.trimEnd(r) - 2.2) {
            assert.equal(col.boxContact(x, z, 0.85, 2.2, heading, out, net.deckAt(r, su)), null, `road ${r}: deck traffic stopped ${u.toFixed(1)} m from its ramp's solid end`);
          }
        }
        assert.ok(stopped, `road ${r} at ${s}: the street under the deck runs on into the ramp (lane ${f})`);
      }
      ramps++;
    }
  }
  assert.ok(ramps >= 30, `${ramps} ramps`);
});
