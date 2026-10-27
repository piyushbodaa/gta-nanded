import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './helpers.js';
import { Colliders, SOLID } from '../src/world/colliders.js';

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
