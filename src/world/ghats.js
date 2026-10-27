// Ghats: broad stone stairs from the street down a riverbank into the water. Laid out once,
// when the city is (City.ghats), so the treads landmarks.js draws are the treads
// City.groundHeight stands people, animals and vehicles on.

/** How wide each ghat's stairs are, by place. */
export const GHAT_WIDTH = { 'nagina-ghat': 26, 'hira-ghat': 22, 'shikar-ghat': 20, 'banda-ghat': 22, 'ram-ghat': 34, 'govardhan-ghat': 36, 'urvashi-ghat': 28 };

// A riser: a walker's step down, not a jump (Player stays on its feet down 0.3 m).
const RISE = 0.2;
// The longest tread: the level landing at the top is paved in slabs this long.
const TREAD = 2;
// A tread stands this proud of the bank at its upper edge.
const LIP = 0.05;
// How often the bank is looked at along the stairs (metres); between looks it is a straight
// slope, as the ground mesh's triangles are.
const LOOK = 0.5;

/**
 * Place p's ghat, `width` metres wide, from 22 m short of the nearest river's edge to 2 m into
 * the water, or null when no river runs within 140 m. Along u (toward the water, from the place)
 * it is a run of treads { d0, d1, top, low }: each level at `top`, the bank's highest across
 * the stairs at its upper edge plus a lip, so no tread is buried in the bank, and the next one
 * starts where the bank has fallen a riser below it. `low` is the lowest bank under the tread,
 * where its stone has to reach down to.
 */
export function layGhat(city, p, width) {
  let best = null, bd = Infinity;
  for (const s of city.waterSegs) {
    const dx = s[2] - s[0], dz = s[3] - s[1], l2 = dx * dx + dz * dz;
    let t = l2 ? ((p.x - s[0]) * dx + (p.z - s[1]) * dz) / l2 : 0; t = Math.max(0, Math.min(1, t));
    const qx = s[0] + dx * t, qz = s[1] + dz * t, d = Math.hypot(qx - p.x, qz - p.z) - s[4] / 2;
    if (d < bd) { bd = d; best = { qx, qz, w: s[4] }; }
  }
  if (!best || bd > 140) return null;
  const len = Math.hypot(best.qx - p.x, best.qz - p.z) || 1;
  const ux = (best.qx - p.x) / len, uz = (best.qz - p.z) / len; // toward the water
  const edge = len - best.w / 2; // from the place to the water's edge
  const start = Math.max(0, edge - 22), end = edge + 2, hw = width / 2;
  // The bank's highest and lowest across the stairs, d metres down them.
  let hi = 0, lo = 0;
  const across = d => {
    hi = -Infinity; lo = Infinity;
    for (let k = 0; k <= 4; k++) {
      const lx = -hw + (width * k) / 4, y = city.bareGround(p.x + lx * uz + d * ux, p.z - lx * ux + d * uz);
      hi = Math.max(hi, y); lo = Math.min(lo, y);
    }
  };
  const treads = [];
  across(start);
  let from = start, top = hi + LIP, low = lo, was = start, wasHi = hi;
  for (let d = Math.min(start + LOOK, end); ; d = Math.min(d + LOOK, end)) {
    across(d);
    low = Math.min(low, lo);
    // The bank has fallen a riser below this tread: the next one starts where it did.
    while (hi + LIP <= top - RISE) {
      const at = was + ((d - was) * (top - RISE - LIP - wasHi)) / (hi - wasHi);
      treads.push({ d0: from, d1: at, top, low });
      from = at; top -= RISE; low = lo;
    }
    if (d >= end) break;
    // A long level stretch (the landing at the top) is paved in slabs.
    if (d - from >= TREAD - 1e-6) { treads.push({ d0: from, d1: d, top, low }); from = d; top = hi + LIP; low = lo; }
    was = d; wasHi = hi;
  }
  treads.push({ d0: from, d1: end, top, low });
  const mid = (start + end) / 2, half = (end - start) / 2;
  return {
    x: p.x, z: p.z, ux, uz, rot: Math.atan2(ux, uz), hw, start, end, treads,
    // A circle round the stairs, to pass most of the city by at a glance.
    cx: p.x + ux * mid, cz: p.z + uz * mid, r2: half * half + hw * hw + 1,
  };
}

/** The top of ghat gh's tread under (x, z), or -Infinity off its stairs. */
export function ghatTop(gh, x, z) {
  const dx = x - gh.x, dz = z - gh.z, u = dx * gh.ux + dz * gh.uz;
  if (u < gh.start || u > gh.end || Math.abs(dx * gh.uz - dz * gh.ux) > gh.hw) return -Infinity;
  const T = gh.treads;
  let k = 0;
  while (k < T.length - 1 && u >= T[k].d1) k++;
  return T[k].top;
}
