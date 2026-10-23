// Shri Guru Gobind Singh Ji Airport's airfield from OpenStreetMap (research/osm-airport.json):
// runway 10/28 with its markings, the taxiways and the concrete aprons. Cut into pieces that
// the chunk index hands out like road segments, so the airfield streams in with the city.
import * as THREE from 'three';

export const RUNWAY_HW = 22.5; // a 45 m runway
const TAXI_HW = 9, PIECE = 100;
const ASPHALT = 0x34373a, TAXI = 0x3c3f42, APRON = 0xa9a69c, WHITE = 0xe8e8e2, YELLOW = 0xe0b42a;
const Y = 0.09;

/** The airfield's drawable pieces: [{ kind, x, z, ... }] placed by their middle. */
export function airfieldPieces(af) {
  const out = [];
  if (!af) return out;
  for (const r of af.runways) {
    // Drawn as one straight strip from end to end, numbered from each end: "10" at the west.
    const p = r.p, ax = p[0], az = p[1], bx = p[p.length - 2], bz = p[p.length - 1];
    const len = Math.hypot(bx - ax, bz - az), n = Math.ceil(len / PIECE);
    const [refA, refB] = (r.ref || '').split('/');
    for (let k = 0; k < n; k++) {
      const s0 = (len * k) / n, s1 = (len * (k + 1)) / n;
      out.push({ kind: 'runway', ax, az, bx, bz, len, s0, s1, refA, refB, x: ax + ((bx - ax) * (s0 + s1)) / 2 / len, z: az + ((bz - az) * (s0 + s1)) / 2 / len });
    }
  }
  // Across an apron a taxiway is only its painted guide line; elsewhere it is paved.
  const onApron = (x, z) => af.aprons.some(a => inside(a, x, z));
  for (const t of af.taxiways) {
    for (let i = 0; i + 3 < t.length; i += 2) {
      const x = (t[i] + t[i + 2]) / 2, z = (t[i + 1] + t[i + 3]) / 2;
      out.push({ kind: 'taxiway', ax: t[i], az: t[i + 1], bx: t[i + 2], bz: t[i + 3], x, z, line: onApron(x, z) });
    }
  }
  for (const a of af.aprons) {
    let x = 0, z = 0;
    for (let i = 0; i < a.length; i += 2) { x += a[i]; z += a[i + 1]; }
    out.push({ kind: 'apron', p: a, x: (x * 2) / a.length, z: (z * 2) / a.length });
  }
  return out;
}

/** Is (x, z) inside the polygon [x0, z0, x1, z1, ...]? */
function inside(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i], zi = poly[i + 1], xj = poly[j], zj = poly[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/** A flat strip from A to B, hw either side, at height y. */
function strip(g, ax, az, bx, bz, hw, y) {
  const len = Math.hypot(bx - ax, bz - az) || 1, nx = (bz - az) / len * hw, nz = -(bx - ax) / len * hw;
  const a = g.v(ax + nx, y, az + nz), b = g.v(ax - nx, y, az - nz), c = g.v(bx - nx, y, bz - nz), d = g.v(bx + nx, y, bz + nz);
  g.quad(a, b, c, d);
}

// Seven-segment digits for the runway numbers: segments a b c d e f g.
const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };

/** A runway number painted across the runway at `along` metres from end (ex, ez), read by pilots landing toward (fx, fz). */
function numerals(g, text, ex, ez, fx, fz, along) {
  const H = 9, W = 4.5, T = 0.9; // digit height and width, stroke
  const lx = -fz, lz = fx; // pilot's right
  const at = (u, v) => [ex + fx * (along + v) + lx * u, ez + fz * (along + v) + lz * u];
  const bar = (u0, v0, u1, v1) => { const [x0, z0] = at(u0, v0), [x1, z1] = at(u1, v1); strip(g, x0, z0, x1, z1, T / 2, Y + 0.012); };
  const n = text.length;
  for (let k = 0; k < n; k++) {
    const u = (k - (n - 1) / 2) * (W + 2.4);
    const L = u - W / 2, R = u + W / 2;
    for (const s of SEG[text[k]] || '') {
      if (s === 'a') bar(L, H, R, H);
      if (s === 'g') bar(L, H / 2, R, H / 2);
      if (s === 'd') bar(L, 0, R, 0);
      if (s === 'b') bar(R, H, R, H / 2);
      if (s === 'c') bar(R, H / 2, R, 0);
      if (s === 'f') bar(L, H, L, H / 2);
      if (s === 'e') bar(L, H / 2, L, 0);
    }
  }
}

/** Build one airfield piece into the chunk's geometry. */
export function buildAirfieldPiece(g, k) {
  if (k.kind === 'apron') {
    const pts = [];
    for (let i = 0; i < k.p.length; i += 2) pts.push(new THREE.Vector2(k.p[i], k.p[i + 1]));
    if (pts.length > 2 && pts[0].equals(pts[pts.length - 1])) pts.pop();
    const tris = THREE.ShapeUtils.triangulateShape(pts, []);
    g.color(APRON, 0);
    const ids = pts.map(p => g.v(p.x, Y - 0.005, p.y));
    // Face up: clockwise in (x, z), like every other ground quad.
    for (const [a, b, c] of tris) {
      const A = pts[a], B = pts[b], C = pts[c];
      if ((B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x) < 0) g.tri(ids[a], ids[b], ids[c]); else g.tri(ids[a], ids[c], ids[b]);
    }
    return;
  }
  if (k.kind === 'taxiway') {
    if (!k.line) { g.color(TAXI, 0); strip(g, k.ax, k.az, k.bx, k.bz, TAXI_HW, Y - 0.002); }
    g.color(YELLOW, 0); strip(g, k.ax, k.az, k.bx, k.bz, 0.15, Y + 0.008);
    return;
  }
  // Runway: asphalt, edge lines, centre-line dashes, threshold stripes, aiming points, numbers.
  const fx = (k.bx - k.ax) / k.len, fz = (k.bz - k.az) / k.len, lx = -fz, lz = fx;
  const P = s => [k.ax + fx * s, k.az + fz * s];
  const [x0, z0] = P(k.s0), [x1, z1] = P(k.s1);
  g.color(ASPHALT, 0); strip(g, x0, z0, x1, z1, RUNWAY_HW, Y);
  g.color(WHITE, 0);
  for (const side of [1, -1]) strip(g, x0 + lx * side * 21.6, z0 + lz * side * 21.6, x1 + lx * side * 21.6, z1 + lz * side * 21.6, 0.45, Y + 0.01);
  for (let s = 60; s < k.len - 60; s += 50) {
    const a = Math.max(s, k.s0), b = Math.min(s + 30, k.s1);
    if (b <= a) continue;
    const [ax, az] = P(a), [bx, bz] = P(b);
    strip(g, ax, az, bx, bz, 0.45, Y + 0.01);
  }
  // A windsock beside the runway, halfway along.
  if (k.s0 <= k.len / 2 && k.len / 2 < k.s1) {
    const [mx, mz] = P(k.len / 2), wx = mx - lx * 48, wz = mz - lz * 48;
    g.color(0xd6d6d0, 0); g.cyl(wx, 0, wz, 0.08, 6, 6);
    for (let i = 0; i < 5; i++) { g.color(i % 2 ? WHITE : 0xe8642a, 0); g.cyl(wx + fx * (0.3 + i * 0.55), 5.7 - i * 0.12, wz + fz * (0.3 + i * 0.55), 0.42 - i * 0.06, 0.5, 8); }
  }
  // Each end: piano keys, the number, and the aiming point beyond.
  for (const [end, dir, ref] of [[0, 1, k.refA], [k.len, -1, k.refB]]) {
    const ex = k.ax + fx * end, ez = k.az + fz * end, dx = fx * dir, dz = fz * dir;
    const inPiece = (a, b) => Math.max(Math.min(end + dir * a, end + dir * b), k.s0) < Math.min(Math.max(end + dir * a, end + dir * b), k.s1);
    if (inPiece(6, 36)) for (let i = 0; i < 8; i++) for (const side of [1, -1]) {
      const u = side * (2.6 + i * 2.4);
      strip(g, ex + dx * 6 + lx * u, ez + dz * 6 + lz * u, ex + dx * 36 + lx * u, ez + dz * 36 + lz * u, 0.8, Y + 0.012);
    }
    if (ref && inPiece(44, 54)) numerals(g, ref, ex, ez, dx, dz, 44);
    if (inPiece(150, 195)) for (const side of [1, -1]) strip(g, ex + dx * 150 + lx * side * 8, ez + dz * 150 + lz * side * 8, ex + dx * 195 + lx * side * 8, ez + dz * 195 + lz * side * 8, 3, Y + 0.012);
  }
}
