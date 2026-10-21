// Hand-built landmarks and named buildings for the researched places. These
// are illustrations from primitives, not surveyed replicas: what matters is
// that Hazur Sahib's golden dome, the ghats and the station are recognisable
// from the street, and that every college and coaching class has its board up.
import { ROW, TILE, SIGN_COLS } from './atlas.js';
import { rng, hash2 } from '../core/math.js';

const FLOOR = 3.2;
const GOLD = 0xe2a93b, MARBLE = 0xf4f1ea, SAFFRON = 0xff8c1a, STONE = 0x6a635b;

/** Rotation that turns a place's front (toward its approach) to local -z. */
export const placeRot = p => p.rot + Math.PI;

function frame(p, rot = placeRot(p)) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return { rot, X: (lx, lz) => p.x + lx * c + lz * s, Z: (lx, lz) => p.z - lx * s + lz * c, c, s };
}

const SPECIAL = {
  'hazur-sahib': hazurSahib,
  'nagina-ghat': (ctx, p) => { gurudwara(ctx, p, 0.75); ghat(ctx, p, 26); },
  'langar-sahib': (ctx, p) => { gurudwara(ctx, p, 0.8); langarHall(ctx, p); },
  'sangat-sahib': (ctx, p) => gurudwara(ctx, p, 0.7),
  'mata-sahib': (ctx, p) => gurudwara(ctx, p, 0.75),
  'hira-ghat': (ctx, p) => { gurudwara(ctx, p, 0.6); ghat(ctx, p, 22); },
  'shikar-ghat': (ctx, p) => { gurudwara(ctx, p, 0.6); ghat(ctx, p, 20); },
  'banda-ghat': (ctx, p) => { gurudwara(ctx, p, 0.65); ghat(ctx, p, 22); },
  'ram-ghat': (ctx, p) => { ghat(ctx, p, 34); smallTemple(ctx, p, 6, -4); },
  'govardhan-ghat': (ctx, p) => { ghat(ctx, p, 36); smallTemple(ctx, p, -8, -6); },
  'urvashi-ghat': (ctx, p) => { ghat(ctx, p, 28); smallTemple(ctx, p, 0, -6); },
  'nanded-station': station,
  'nanded-bus-stand': busStand,
  'sggs-stadium': stadium,
  'old-mondha-clock-tower': clockTower,
  'nandgiri-fort': fort,
  'kaleshwar-temple': (ctx, p) => templeShikhara(ctx, p, p.fit ?? 1),
  'vishnupuri-dam': dam,
  'mal-tekdi': hillTemple,
  'nanded-airport': airport,
  'visava-garden': garden,
  'shivaji-putla': (ctx, p) => statue(ctx, p, 'horse'),
  'gandhi-putla': (ctx, p) => statue(ctx, p, 'standing'),
  'ambedkar-chowk-latur-phata': (ctx, p) => statue(ctx, p, 'pointing'),
  'bhagya-nagar-kaman': (ctx, p) => kaman(ctx, p, 'modern'),
  'hingoli-gate': (ctx, p) => kaman(ctx, p, 'old'),
  'sarafa-bazar': bazaar,
  'godavari-river': () => {},
  'navghat-bridge': () => {},
  'govardhan-ghat-bridge': () => {},
};

export function buildPlace(ctx, p, index) {
  const special = SPECIAL[p.id];
  if (special) return special(ctx, p, index);
  switch (p.category) {
    case 'coaching': return namedBlock(ctx, p, { floors: 5, row: ROW.MODERN, color: rng(hash2(index, 9)).pick([0x1e5aa8, 0xd84315, 0x2e7d32, 0x6a1b9a, 0xc62828, 0x00838f]), banner: true });
    case 'college': return campus(ctx, p, index);
    case 'school': return campus(ctx, p, index, true);
    case 'hospital': return namedBlock(ctx, p, { floors: 4, row: ROW.RES, color: 0xf2f2ee, cross: true });
    case 'hotel': return namedBlock(ctx, p, { floors: 5, row: ROW.BALCONY, color: rng(hash2(index, 5)).pick([0xe9dcc4, 0xd8c3a5, 0xf0e6d2, 0xc9d6dd]) });
    case 'restaurant': case 'cafe': return namedBlock(ctx, p, { floors: 2, row: ROW.RES, color: rng(hash2(index, 7)).pick([0xf2d27a, 0xe5a46c, 0xa8cf9a, 0xf0b1b7]), shop: true });
    case 'cinema': case 'shopping': return mall(ctx, p);
    case 'civic': return namedBlock(ctx, p, { floors: 3, row: ROW.OLD, color: 0xe8dcc4, flag: true });
    case 'transport': return namedBlock(ctx, p, { floors: 2, row: ROW.MODERN, color: 0xe9e2d0 });
    case 'park': return garden(ctx, p);
    default: return null;
  }
}

/** Collision boxes for a place: [{x, z, hw, hd, rot, h}]. */
export function placeColliders(p) {
  const { X, Z, rot } = frame(p);
  const box = (lx, lz, hw, hd, h = 6) => ({ x: X(lx, lz), z: Z(lx, lz), hw, hd, rot, h });
  switch (p.id) {
    case 'hazur-sahib': {
      const out = [box(0, 0, 9.5, 9.5, 30)];
      // Courtyard walls with the Darshani Deori gap at the front.
      const R = 26 * (p.fit ?? 1);
      out.push(box(0, R, R, 0.6, 4), box(-R, 0, 0.6, R, 4), box(R, 0, 0.6, R, 4), box(-R / 2 - 3.5, -R, R / 2 - 3.5, 0.6, 4), box(R / 2 + 3.5, -R, R / 2 - 3.5, 0.6, 4));
      out.push(box(-6, -R + 6, 0.35, 0.35, 25), box(6, -R + 6, 0.35, 0.35, 25));
      return out;
    }
    case 'godavari-river': case 'navghat-bridge': case 'govardhan-ghat-bridge': case 'visava-garden': return [];
    case 'ram-ghat': case 'govardhan-ghat': case 'urvashi-ghat': return [];
    case 'sggs-stadium': return [box(0, -p.d / 2 + 2, p.w / 2, 2.5, 8), box(0, p.d / 2 - 2, p.w / 2, 2.5, 8), box(-p.w / 2 + 2, 0, 2.5, p.d / 2, 8), box(p.w / 2 - 2, 0, 2.5, p.d / 2, 8)];
    case 'shivaji-putla': case 'gandhi-putla': case 'ambedkar-chowk-latur-phata': return [box(0, 0, 1.6, 1.6, 8)];
    case 'bhagya-nagar-kaman': case 'hingoli-gate': case 'mal-tekdi': case 'vishnupuri-dam': return [];
    case 'old-mondha-clock-tower': return [box(0, 0, 2.6, 2.6, 22)];
    case 'nanded-station': return [box(0, 0, p.w / 2 + 6, p.d / 2, 10)];
    default:
      if (p.category === 'junction' || p.category === 'park') return [];
      return [box(0, 0, p.w / 2, p.d / 2, p.h || 10)];
  }
}

// ------------------------------------------------------------------ helpers
function sign(ctx, p, X, Z, lx, lz, halfW, y0, y1) {
  const slot = ctx.signSlots?.get(p.id);
  if (slot === undefined) return;
  const { sg, g } = ctx;
  const col = slot % SIGN_COLS, row = Math.floor(slot / SIGN_COLS);
  sg.setTint(0xffffff, 0).setTile(col, row, 1, 2);
  sg.wall(X(lx + halfW, lz), Z(lx + halfW, lz), X(lx - halfW, lz), Z(lx - halfW, lz), y0, y1, 0, 1, 0, 1);
  g.color(0x2a2a2a, 0);
  g.cbox(X(lx, lz + 0.08), y0, Z(lx, lz + 0.08), halfW, y1 - y0, 0.07, placeRot(p));
}

/** Facade box with atlas windows; front faces local -z. */
function facadeBox(g, X, Z, rot, lx, lz, hw, hd, h, row, color, seed, groundRow = row) {
  const P = [[lx - hw, lz - hd], [lx + hw, lz - hd], [lx + hw, lz + hd], [lx - hw, lz + hd]];
  g.setTint(color, seed & 255);
  for (const [a, b] of [[1, 0], [0, 3], [3, 2], [2, 1]]) {
    const ax = X(P[a][0], P[a][1]), az = Z(P[a][0], P[a][1]), bx = X(P[b][0], P[b][1]), bz = Z(P[b][0], P[b][1]);
    const len = Math.hypot(bx - ax, bz - az), bays = Math.max(1, Math.round(len / FLOOR));
    g.setTile(0, a === 1 ? groundRow : row, 8, 1);
    g.wall(ax, az, bx, bz, 0, Math.min(h, FLOOR), 0, bays, 0, Math.min(h, FLOOR) / FLOOR);
    if (h > FLOOR) { g.setTile(0, row, 8, 1); g.wall(ax, az, bx, bz, FLOOR, h, 0, bays, 1, h / FLOOR); }
  }
  g.setTint(0xffffff, seed & 255).setTile(TILE.ROOF[0], TILE.ROOF[1], 1, 1);
  g.flat(X(P[0][0], P[0][1]), Z(P[0][0], P[0][1]), X(P[1][0], P[1][1]), Z(P[1][0], P[1][1]), X(P[2][0], P[2][1]), Z(P[2][0], P[2][1]), X(P[3][0], P[3][1]), Z(P[3][0], P[3][1]), h, FLOOR, X(lx, lz), Z(lx, lz));
  // Parapet.
  g.setTint(color, seed & 255).setTile(TILE.COMPOUND[0], TILE.COMPOUND[1], 1, 1);
  for (const [a, b] of [[1, 0], [0, 3], [3, 2], [2, 1]]) {
    const ax = X(P[a][0], P[a][1]), az = Z(P[a][0], P[a][1]), bx = X(P[b][0], P[b][1]), bz = Z(P[b][0], P[b][1]);
    g.wall(ax, az, bx, bz, h, h + 0.9, 0, Math.hypot(bx - ax, bz - az) / FLOOR, 0.72, 1);
  }
}

function texBox(g, X, Z, rot, lx, y0, lz, hw, h, hd, tile, tint = 0xffffff, scale = FLOOR) {
  g.setTint(tint, 0).setTile(tile[0], tile[1], 1, 1);
  g.box(X(lx, lz), y0, Z(lx, lz), hw, h, hd, rot, scale);
}

function onionDome(g, x, y, z, r, gold = GOLD) {
  g.color(gold, 0);
  g.lathe(x, y, z, [[r * 0.82, 0], [r * 1.0, r * 0.35], [r * 1.08, r * 0.7], [r * 0.95, r * 1.05], [r * 0.62, r * 1.38], [r * 0.25, r * 1.62], [r * 0.08, r * 1.8], [0.02, r * 1.84]], 14);
  // Kalash finial.
  g.cyl(x, y + r * 1.8, z, r * 0.07, r * 0.5, 6, r * 0.03);
  g.blob(x, y + r * 2.1, z, r * 0.12, r * 0.14, r * 0.12, 3);
}

function chhatri(g, x, y, z, r, pillar = MARBLE) {
  g.color(pillar, 0);
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.cyl(x + dx * r * 0.75, y, z + dz * r * 0.75, r * 0.1, r * 1.3, 5);
  g.cbox(x, y + r * 1.3, z, r * 0.95, r * 0.18, r * 0.95);
  onionDome(g, x, y + r * 1.48, z, r * 0.75);
}

function nishanSahib(g, x, z, h = 24) {
  // Flagpole clad in saffron cloth, steel khanda on top, triangular saffron flag.
  g.color(0xff9b30, 0); g.cyl(x, 0, z, 0.3, h, 8, 0.16);
  g.color(0xd9d9d6, 0); g.cone(x, h, z, 0.35, 1.0, 6);
  g.color(SAFFRON, 0);
  const a = g.v(x, h - 0.6, z), b = g.v(x + 4.2, h - 2.0, z + 0.3), c = g.v(x, h - 3.6, z);
  g.tri(a, b, c); g.tri(a, c, b);
  g.color(0xc0392b, 0); g.cbox(x, 0, z, 0.9, 0.6, 0.9);
}

function archFace(g, X, Z, lx, lz, w, h, y0, color) {
  // A dark arched opening as a flat fan on a front face (local -z), slightly proud.
  g.color(color, 0);
  const r = w / 2, steps = 8;
  const cx = lx, cy = y0 + h - r;
  const pts = [[lx - r, y0], [lx + r, y0], [lx + r, cy]];
  for (let i = 0; i <= steps; i++) { const a = (i / steps) * Math.PI; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  pts.push([lx - r, cy]);
  const ids = pts.map(([px, py]) => g.v(X(px, lz), py, Z(px, lz)));
  for (let i = 1; i < ids.length - 1; i++) g.tri(ids[0], ids[i + 1], ids[i]);
}

// ------------------------------------------------------------------ Hazur Sahib
function hazurSahib(ctx, p) {
  const { g, pg } = ctx;
  const { X, Z, rot } = frame(p);
  const cx = p.x, cz = p.z;
  const R = 26 * (p.fit ?? 1);
  // Parikrama: marble courtyard.
  g.setTint(0xffffff, 0).setTile(TILE.MARBLE[0], TILE.MARBLE[1], 1, 4);
  g.flat(X(-R, -R), Z(-R, -R), X(R, -R), Z(R, -R), X(R, R), Z(R, R), X(-R, R), Z(-R, R), 0.09);
  // Courtyard walls with small domes on the corners and the Darshani Deori gate.
  const wall = (lx, lz, hw, hd) => texBox(g, X, Z, rot, lx, 0, lz, hw, 3.6, hd, TILE.MARBLE, 0xffffff, 4);
  wall(0, R, R, 0.6); wall(-R, 0, 0.6, R); wall(R, 0, 0.6, R);
  wall(-R / 2 - 3.5, -R, R / 2 - 3.5, 0.6); wall(R / 2 + 3.5, -R, R / 2 - 3.5, 0.6);
  for (const [lx, lz] of [[-R, -R], [R, -R], [R, R], [-R, R]]) chhatri(g, X(lx, lz), 3.6, Z(lx, lz), 1.6);
  // Darshani Deori: a tall arched gateway with a golden dome.
  texBox(g, X, Z, rot, 0, 0, -R, 7, 9, 2.2, TILE.MARBLE, 0xffffff, 4);
  archFace(g, X, Z, 0, -R - 2.25, 5, 7, 0, 0x3a2e24);
  onionDome(g, X(0, -R), 9, Z(0, -R), 2.2);
  chhatri(g, X(-5.5, -R), 9, Z(-5.5, -R), 1.1); chhatri(g, X(5.5, -R), 9, Z(5.5, -R), 1.1);
  // Plinth and the two tiers of the Takht.
  texBox(g, X, Z, rot, 0, 0, 0, 12, 1.4, 12, TILE.MARBLE, 0xffffff, 4);
  g.color(0xe8e2d4, 0);
  for (let k = 0; k < 3; k++) g.cbox(X(0, -12.4 - k * 0.6), 0, Z(0, -12.4 - k * 0.6), 4, 1.4 - k * 0.45, 0.32, rot);
  texBox(g, X, Z, rot, 0, 1.4, 0, 9.5, 8.6, 9.5, TILE.MARBLE, 0xffffff, 4);
  // Arcades on every face: frame helpers rotated a quarter turn at a time.
  for (let q = 0; q < 4; q++) {
    const F = frame(p, rot + (q * Math.PI) / 2);
    for (let i = -2; i <= 2; i++) {
      archFace(g, F.X, F.Z, i * 3.6, -9.55, 2.2, 4.6, 2.2, i === 0 && q === 0 ? 0x5b3a1e : 0x3d3a36);
      archFace(g, F.X, F.Z, i * 3.6, -9.56, 1.4, 2.1, 7.2, 0x3d3a36);
    }
    for (let i = -1; i <= 1; i++) archFace(g, F.X, F.Z, i * 3.6, -6.25, 1.8, 3.2, 11.1, 0x3d3a36);
  }
  // Gold band and parapet domelets.
  g.color(GOLD, 0); g.cbox(p.x, 9.9, p.z, 9.8, 0.5, 9.8, rot);
  for (let i = -3; i <= 3; i++) for (const lz of [-9.6, 9.6]) { g.color(GOLD, 0); g.blob(X(i * 2.8, lz), 10.7, Z(i * 2.8, lz), 0.45, 0.6, 0.45, i); }
  for (let i = -3; i <= 3; i++) for (const lx of [-9.6, 9.6]) { g.color(GOLD, 0); g.blob(X(lx, i * 2.8), 10.7, Z(lx, i * 2.8), 0.45, 0.6, 0.45, i + 9); }
  for (const [lx, lz] of [[-9.5, -9.5], [9.5, -9.5], [9.5, 9.5], [-9.5, 9.5]]) chhatri(g, X(lx, lz), 10.4, Z(lx, lz), 1.5);
  texBox(g, X, Z, rot, 0, 10.4, 0, 6.2, 4.6, 6.2, TILE.MARBLE, 0xffffff, 4);
  g.color(GOLD, 0); g.cbox(p.x, 15, p.z, 6.4, 0.4, 6.4, rot);
  for (const [lx, lz] of [[-6, -6], [6, -6], [6, 6], [-6, 6]]) chhatri(g, X(lx, lz), 15.4, Z(lx, lz), 1.2);
  // The golden dome on its drum.
  g.color(MARBLE, 0); g.cyl(cx, 15.4, cz, 4.2, 1.6, 14);
  onionDome(g, cx, 17, cz, 4.4);
  // Nishan Sahib pair before the gate.
  nishanSahib(g, X(-6, -R + 6), Z(-6, -R + 6), 25);
  nishanSahib(g, X(6, -R + 6), Z(6, -R + 6), 25);
  // Night: the complex glows.
  for (const [lx, lz, r] of [[0, -14, 9], [-14, 0, 8], [14, 0, 8], [0, 14, 8], [0, -R - 3, 7]]) pool(pg, X(lx, lz), Z(lx, lz), r);
}

function gurudwara(ctx, p, s = 0.7) {
  const { g, pg } = ctx;
  const { X, Z, rot } = frame(p);
  const hw = 7 * s;
  texBox(g, X, Z, rot, 0, 0, 0, hw + 1.5, 0.9, hw + 1.5, TILE.MARBLE, 0xffffff, 4);
  texBox(g, X, Z, rot, 0, 0.9, 0, hw, 6.5 * s + 2, hw, TILE.MARBLE, 0xffffff, 4);
  const top = 0.9 + 6.5 * s + 2;
  for (let i = -1; i <= 1; i++) archFace(g, X, Z, i * hw * 0.62, -hw - 0.05, hw * 0.36, 3.6 * s + 1, 1.3, i ? 0x3d3a36 : 0x5b3a1e);
  g.color(GOLD, 0); g.cbox(p.x, top, p.z, hw + 0.2, 0.35, hw + 0.2, rot);
  for (const [lx, lz] of [[-hw, -hw], [hw, -hw], [hw, hw], [-hw, hw]]) chhatri(g, X(lx, lz), top + 0.35, Z(lx, lz), 1.0 * s + 0.3);
  g.color(MARBLE, 0); g.cyl(p.x, top + 0.35, p.z, hw * 0.45, 1.0, 12);
  onionDome(g, p.x, top + 1.35, p.z, hw * 0.5);
  nishanSahib(g, X(hw + 4, -hw - 2), Z(hw + 4, -hw - 2), 18 * s + 6);
  pool(pg, X(0, -hw - 4), Z(0, -hw - 4), 7);
}

function langarHall(ctx, p) {
  const { g } = ctx;
  const { X, Z, rot } = frame(p);
  facadeBox(g, X, Z, rot, 0, 14, 10, 5, 4, ROW.OLD, 0xf0e6d2, 7);
  g.color(0x8d9ea4, 0); g.cbox(X(0, 8), 3.4, Z(0, 8), 10.5, 0.15, 1.8, rot);
}

/** Ghat steps from street level down to the river, laid toward the water. */
function ghat(ctx, p, width) {
  const { g, city, pg } = ctx;
  // Find the direction to the river.
  let best = null, bd = Infinity;
  for (const s of city.waterSegs) {
    const dx = s[2] - s[0], dz = s[3] - s[1], l2 = dx * dx + dz * dz;
    let t = l2 ? ((p.x - s[0]) * dx + (p.z - s[1]) * dz) / l2 : 0; t = Math.max(0, Math.min(1, t));
    const qx = s[0] + dx * t, qz = s[1] + dz * t, d = Math.hypot(qx - p.x, qz - p.z) - s[4] / 2;
    if (d < bd) { bd = d; best = { qx, qz, w: s[4], dx, dz }; }
  }
  if (!best || bd > 140) return;
  const len = Math.hypot(best.qx - p.x, best.qz - p.z) || 1;
  const ux = (best.qx - p.x) / len, uz = (best.qz - p.z) / len; // toward water
  const rot = Math.atan2(ux, uz); // local +z toward water
  const c = Math.cos(rot), s = Math.sin(rot);
  const edge = len - best.w / 2; // distance to the water's edge from the place
  const startD = Math.max(0, edge - 22), endD = edge + 2;
  const X = (lx, lz) => p.x + lx * c + lz * s, Z = (lx, lz) => p.z - lx * s + lz * c;
  const hw = width / 2;
  const steps = 12;
  for (let k = 0; k < steps; k++) {
    const d0 = startD + ((endD - startD) * k) / steps, d1 = startD + ((endD - startD) * (k + 1)) / steps;
    const y = city.groundHeight(X(0, d0), Z(0, d0)) + 0.05;
    // Sandstone steps, a shade darker every other tread.
    g.color(k % 2 ? 0xcdb894 : 0xd9c7a3, 0);
    g.cbox(X(0, (d0 + d1) / 2), y - 0.6, Z(0, (d0 + d1) / 2), hw, 0.6, (d1 - d0) / 2 + 0.02, rot);
  }
  // Side walls with a lamp at each end, and a couple of umbrellas for the pandas.
  for (const sx of [-hw - 0.5, hw + 0.5]) {
    g.color(0xb8ad98, 0);
    for (let k = 0; k < steps; k += 2) {
      const d = startD + ((endD - startD) * k) / steps;
      const y = city.groundHeight(X(sx, d), Z(sx, d));
      g.cbox(X(sx, d + 1), y - 0.4, Z(sx, d + 1), 0.5, 1.6, (endD - startD) / steps, rot);
    }
    g.color(0x6f7779, 0); g.cyl(X(sx, startD), 0, Z(sx, startD), 0.08, 4.2, 5);
    pool(pg, X(sx, startD), Z(sx, startD), 5, 4.2);
  }
  const r = rng(hash2(Math.round(p.x), Math.round(p.z)));
  for (let k = 0; k < 3; k++) {
    const lx = r.range(-hw + 3, hw - 3), d = startD + r.range(4, 12);
    const y = city.groundHeight(X(lx, d), Z(lx, d));
    g.color(0x6b5440, 0); g.cyl(X(lx, d), y, Z(lx, d), 0.05, 2.2, 4);
    g.color(r.pick([0xc0392b, 0xf1c40f, 0xe67e22]), 0); g.cone(X(lx, d), y + 2.0, Z(lx, d), 1.5, 0.6, 8);
  }
}

function smallTemple(ctx, p, lx, lz) {
  const { g } = ctx;
  const { X, Z } = frame(p);
  const x = X(lx, lz), z = Z(lx, lz);
  g.color(0xf2efe6, 0); g.cbox(x, 0, z, 2.2, 3.2, 2.2);
  g.color(0xe0773a, 0); g.lathe(x, 3.2, z, [[2.2, 0], [1.9, 1.6], [1.2, 3.2], [0.4, 4.2], [0.05, 4.6]], 4);
  g.color(GOLD, 0); g.cyl(x, 7.8, z, 0.12, 0.6, 5);
  g.color(SAFFRON, 0);
  const a = g.v(x, 9.6, z), b = g.v(x + 1.8, 9.1, z), c2 = g.v(x, 8.4, z);
  g.tri(a, b, c2); g.tri(a, c2, b);
  g.color(0x7a5a3c, 0); g.cyl(x, 7.8, z, 0.04, 1.9, 4);
}

// ------------------------------------------------------------------ transport & civic
function station(ctx, p) {
  const { g, pg, sg } = ctx;
  const { X, Z, rot } = frame(p);
  const hw = p.w / 2 + 6, hd = p.d / 2;
  // Main building: cream with maroon bands, a central clock gable.
  facadeBox(g, X, Z, rot, 0, 0, hw, hd, 7.2, ROW.OLD, 0xf0dca8, 41);
  g.color(0x7a2e2e, 0); g.cbox(p.x, 3.0, p.z, hw + 0.05, 0.35, hd + 0.05, rot);
  texBox(g, X, Z, rot, 0, 0, -0.5, 5, 11, hd + 0.6, TILE.COMPOUND, 0xf0dca8, 4);
  g.color(0xffffff, 0); g.cyl(X(0, -hd - 1.2), 9.2, Z(0, -hd - 1.2), 1.2, 0.15, 14);
  // Portico.
  g.color(0xe8d6a8, 0);
  for (let i = -2; i <= 2; i++) g.cyl(X(i * 3, -hd - 4), 0, Z(i * 3, -hd - 4), 0.35, 4.5, 8);
  g.cbox(X(0, -hd - 2.5), 4.5, Z(0, -hd - 2.5), 8, 0.5, 2.8, rot);
  // Station name boards in front.
  for (const lx of [-12, 12]) {
    g.color(0x1a1a1a, 0); g.cyl(X(lx - 1.6, -hd - 8), 0, Z(lx - 1.6, -hd - 8), 0.08, 3.6, 4); g.cyl(X(lx + 1.6, -hd - 8), 0, Z(lx + 1.6, -hd - 8), 0.08, 3.6, 4);
    g.setTint(0xffffff, 0).setTile(TILE.STATION_BOARD[0], TILE.STATION_BOARD[1], 1, 2);
    g.wall(X(lx + 2, -hd - 8.05), Z(lx + 2, -hd - 8.05), X(lx - 2, -hd - 8.05), Z(lx - 2, -hd - 8.05), 1.6, 3.6, 0, 1, 0, 1);
    g.wall(X(lx - 2, -hd - 7.95), Z(lx - 2, -hd - 7.95), X(lx + 2, -hd - 7.95), Z(lx + 2, -hd - 7.95), 1.6, 3.6, 0, 1, 0, 1);
  }
  // Platform and shelters behind.
  g.color(0xb7ab92, 0); g.cbox(X(0, hd + 6), 0, Z(0, hd + 6), hw + 30, 0.9, 4, rot);
  g.color(0x7d8a8f, 0);
  for (let i = -6; i <= 6; i++) g.cyl(X(i * 6, hd + 6), 0.9, Z(i * 6, hd + 6), 0.15, 3.4, 5);
  g.color(0x5f6f75, 0); g.cbox(X(0, hd + 6), 4.3, Z(0, hd + 6), hw + 24, 0.15, 3.4, rot);
  sign(ctx, p, X, Z, 0, -hd - 0.7, 7, 7.4, 8.6);
  pool(pg, X(0, -hd - 6), Z(0, -hd - 6), 10);
  pool(pg, X(-14, hd + 6), Z(-14, hd + 6), 7); pool(pg, X(14, hd + 6), Z(14, hd + 6), 7);
}

function busStand(ctx, p) {
  const { g, pg } = ctx;
  const { X, Z, rot } = frame(p);
  const hw = p.w / 2 + 6, hd = p.d / 2;
  facadeBox(g, X, Z, rot, 0, hd - 3, hw, 3, 6.4, ROW.MODERN, 0xe9e2d0, 44, ROW.SHOP);
  // The big bay shed on columns, painted MSRTC red and cream.
  g.color(0xb03a2e, 0);
  for (let i = -4; i <= 4; i++) for (const lz of [-hd + 2, hd - 7]) g.cyl(X(i * hw / 4.5, lz), 0, Z(i * hw / 4.5, lz), 0.3, 5.2, 6);
  g.color(0xe8e2d0, 0); g.cbox(X(0, -2.5), 5.2, Z(0, -2.5), hw + 1, 0.4, hd - 1, rot);
  g.color(0xb03a2e, 0); g.cbox(X(0, -2.5), 5.6, Z(0, -2.5), hw + 1.1, 0.5, hd - 0.9, rot);
  // Bay platforms.
  g.color(0xb7ab92, 0); g.cbox(X(0, hd - 8.5), 0, Z(0, hd - 8.5), hw, 0.25, 1.2, rot);
  sign(ctx, p, X, Z, 0, -hd + 0.3, 8, 6.2, 7.4);
  pool(pg, X(0, -2), Z(0, -2), 12);
}

function stadium(ctx, p) {
  const { g, pg } = ctx;
  const { X, Z, rot } = frame(p);
  const hw = p.w / 2, hd = p.d / 2;
  g.color(0x6d9b48, 0); g.flat(X(-hw + 5, -hd + 5), Z(-hw + 5, -hd + 5), X(hw - 5, -hd + 5), Z(hw - 5, -hd + 5), X(hw - 5, hd - 5), Z(hw - 5, hd - 5), X(-hw + 5, hd - 5), Z(-hw + 5, hd - 5), 0.1);
  g.color(0xc9b07a, 0); g.flat(X(-3, -6), Z(-3, -6), X(3, -6), Z(3, -6), X(3, 6), Z(3, 6), X(-3, 6), Z(-3, 6), 0.13);
  // Stepped stands on all four sides.
  const stand = (lx, lz, hw2, hd2, along) => {
    for (let k = 0; k < 4; k++) {
      const off = k * 1.1;
      g.color([0x9aa3a6, 0xb6bec1, 0xd0d6d8, 0x8a9396][k], 0);
      if (along) g.cbox(X(lx, lz + Math.sign(lz) * off), 0, Z(lx, lz + Math.sign(lz) * off), hw2, 1.6 + k * 1.6, 0.6, rot);
      else g.cbox(X(lx + Math.sign(lx) * off, lz), 0, Z(lx + Math.sign(lx) * off, lz), 0.6, 1.6 + k * 1.6, hd2, rot);
    }
  };
  stand(0, -hd + 2, hw - 2, 0, true); stand(0, hd - 2, hw - 2, 0, true);
  stand(-hw + 2, 0, 0, hd - 6, false); stand(hw - 2, 0, 0, hd - 6, false);
  // Floodlight towers.
  for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) {
    g.color(0x8a9396, 0); g.cyl(X(lx, lz), 0, Z(lx, lz), 0.35, 22, 5, 0.25);
    g.color(0xe8e8e8, 0); g.cbox(X(lx, lz), 22, Z(lx, lz), 1.6, 1.6, 0.4, rot + Math.PI / 4);
    pool(pg, X(lx * 0.5, lz * 0.5), Z(lx * 0.5, lz * 0.5), 14);
  }
}

function clockTower(ctx, p) {
  const { g, pg } = ctx;
  const { X, Z, rot } = frame(p);
  texBox(g, X, Z, rot, 0, 0, 0, 3.2, 1.2, 3.2, TILE.STONE, 0xffffff, 2);
  facadeBox(g, X, Z, rot, 0, 0, 2.4, 2.4, 16, ROW.OLD, 0xd9c49a, 77);
  g.color(0x7a5a3c, 0); g.cbox(p.x, 16, p.z, 2.8, 0.4, 2.8, rot);
  g.color(0xd9c49a, 0); g.cbox(p.x, 16.4, p.z, 2.2, 3.2, 2.2, rot);
  // Four clock faces.
  for (const [lx, lz, a] of [[0, -2.25, 0], [0, 2.25, Math.PI], [-2.25, 0, -Math.PI / 2], [2.25, 0, Math.PI / 2]]) {
    const x = X(lx, lz), z = Z(lx, lz);
    g.color(0xf8f4e8, 0);
    const n = 12, base = g.n;
    const fr = rot + a;
    const cx2 = Math.cos(fr), sx2 = Math.sin(fr);
    g.v(x - sx2 * 0.06, 18, z - cx2 * 0.06);
    for (let i = 0; i < n; i++) { const t = (i / n) * Math.PI * 2; g.v(x + cx2 * Math.cos(t) * 1.3 - sx2 * 0.06, 18 + Math.sin(t) * 1.3, z - sx2 * Math.cos(t) * 1.3 - cx2 * 0.06); }
    for (let i = 0; i < n; i++) g.tri(base, base + 1 + i, base + 1 + ((i + 1) % n));
    g.color(0x1a1a1a, 0);
    g.beam(x - sx2 * 0.1, 18, z - cx2 * 0.1, x - sx2 * 0.1 + cx2 * 0.5, 18.75, z - cx2 * 0.1 - sx2 * 0.5, 0.05);
    g.beam(x - sx2 * 0.1, 18, z - cx2 * 0.1, x - sx2 * 0.1 - cx2 * 0.2, 17.1, z - cx2 * 0.1 + sx2 * 0.2, 0.05);
  }
  g.color(0xb8613f, 0); g.lathe(p.x, 19.6, p.z, [[2.5, 0], [1.6, 1.4], [0.3, 2.8], [0.02, 3.2]], 4);
  pool(pg, p.x, p.z, 9);
}

function fort(ctx, p) {
  const { g, city } = ctx;
  const { X, Z, rot } = frame(p);
  // Basalt curtain walls with round bastions, open toward the street.
  const k = p.fit ?? 1;
  const segs = [[-30 * k, 10 * k, -30 * k, -10 * k], [-30 * k, 10 * k, 30 * k, 10 * k], [30 * k, 10 * k, 30 * k, -10 * k]];
  for (const [ax, az, bx, bz] of segs) {
    const len = Math.hypot(bx - ax, bz - az), n = Math.ceil(len / 12);
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n;
      const lx = ax + (bx - ax) * (t0 + t1) / 2, lz = az + (bz - az) * (t0 + t1) / 2;
      const ang = Math.atan2(bx - ax, bz - az);
      const h = 7 + ((k * 37) % 5) - (k % 3 === 2 ? 2.5 : 0);
      g.setTint(0xffffff, 0).setTile(TILE.STONE[0], TILE.STONE[1], 1, 1);
      g.box(X(lx, lz), city.groundHeight(X(lx, lz), Z(lx, lz)) - 0.5, Z(lx, lz), 1.4, h, len / n / 2 + 0.1, rot + ang, 2.5);
    }
  }
  for (const [lx, lz] of [[-30 * k, 10 * k], [30 * k, 10 * k], [-30 * k, -10 * k], [30 * k, -10 * k], [0, 10 * k]]) {
    g.setTint(0xffffff, 0).setTile(TILE.STONE[0], TILE.STONE[1], 1, 1);
    const x = X(lx, lz), z = Z(lx, lz);
    g.color(STONE, 0); g.cyl(x, -0.5, z, 4, 9.5, 10, 3.6);
    g.color(0x5c5650, 0);
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; g.cbox(x + Math.cos(a) * 3.3, 9, z + Math.sin(a) * 3.3, 0.5, 0.9, 0.5, a); }
  }
  // Arched gate.
  texBox(g, X, Z, rot, 0, 0, -10 * k, 6, 9, 2, TILE.STONE, 0xffffff, 2.5);
  archFace(g, X, Z, 0, -10 * k - 2.05, 4, 6, 0, 0x2a2622);
}

function templeShikhara(ctx, p, s = 1) {
  const { g, pg } = ctx;
  const { X, Z, rot } = frame(p);
  texBox(g, X, Z, rot, 0, 0, 0, 9 * s, 1.2, 12 * s, TILE.STONE, 0xffffff, 2);
  // Pillared mandapa in front, garbhagriha with the spire behind.
  g.color(0xe8dcc4, 0);
  for (let i = -2; i <= 2; i++) for (const lz of [-10 * s, -4 * s]) g.cyl(X(i * 2.6 * s, lz), 1.2, Z(i * 2.6 * s, lz), 0.35 * s, 3.6 * s, 6);
  g.color(0xd8c8a8, 0); g.cbox(X(0, -7 * s), 1.2 + 3.6 * s, Z(0, -7 * s), 6.6 * s, 0.6, 4 * s, rot);
  g.color(0xe0773a, 0); g.lathe(X(0, -7 * s), 1.8 + 3.6 * s, Z(0, -7 * s), [[5 * s, 0], [3.5 * s, 1.8 * s], [0.2, 2.6 * s]], 4);
  g.color(0xefe4cc, 0); g.cbox(X(0, 4 * s), 1.2, Z(0, 4 * s), 5 * s, 6 * s, 5 * s, rot);
  g.color(0xe9dcc0, 0);
  g.lathe(X(0, 4 * s), 1.2 + 6 * s, Z(0, 4 * s), [[5.4 * s, 0], [5.0 * s, 3 * s], [4.1 * s, 6.5 * s], [2.8 * s, 9.5 * s], [1.4 * s, 11.6 * s], [0.6 * s, 12.4 * s], [0.05, 12.8 * s]], 8);
  g.color(GOLD, 0); g.cyl(X(0, 4 * s), 1.2 + 18.8 * s, Z(0, 4 * s), 0.25, 1.4, 6, 0.06);
  g.color(SAFFRON, 0);
  const x = X(0, 4 * s), z = Z(0, 4 * s), y = 1.2 + 20.4 * s;
  const a = g.v(x, y + 1.6, z), b = g.v(x + 2.2, y + 1.0, z), c = g.v(x, y + 0.2, z);
  g.tri(a, b, c); g.tri(a, c, b);
  g.color(0x7a5a3c, 0); g.cyl(x, y - 1.4, z, 0.05, 3.2, 4);
  pool(pg, X(0, -12 * s), Z(0, -12 * s), 8);
}

function dam(ctx, p) {
  const { g, city } = ctx;
  // Span the river where it passes the place, perpendicular to the flow.
  let best = null, bd = Infinity;
  for (const s of city.waterSegs) {
    const dx = s[2] - s[0], dz = s[3] - s[1], l2 = dx * dx + dz * dz;
    let t = l2 ? ((p.x - s[0]) * dx + (p.z - s[1]) * dz) / l2 : 0; t = Math.max(0, Math.min(1, t));
    const qx = s[0] + dx * t, qz = s[1] + dz * t, d = Math.hypot(qx - p.x, qz - p.z);
    if (d < bd) { bd = d; best = { qx, qz, w: s[4], dx, dz }; }
  }
  if (!best || bd > 200) return;
  const fl = Math.hypot(best.dx, best.dz);
  const rot = Math.atan2(best.dx / fl, best.dz / fl); // local z along the flow, local x across
  const span = best.w / 2 + 18;
  g.color(0xb4ad9f, 0);
  g.cbox(best.qx, -6, best.qz, span, 7.5, 3, rot);
  g.color(0x8f897d, 0);
  const c = Math.cos(rot), s = Math.sin(rot);
  for (let k = -5; k <= 5; k++) {
    const lx = (k / 5.5) * (best.w / 2);
    g.cbox(best.qx + lx * c + 3.1 * s, -4, best.qz - lx * s + 3.1 * c, 1.4, 4.6, 0.2, rot);
    g.color(0x5f6f75, 0); g.cbox(best.qx + lx * c, 1.5, best.qz - lx * s, 0.5, 2.5, 0.5, rot);
    g.color(0x8f897d, 0);
  }
  g.color(0x6f7779, 0); g.cbox(best.qx, 1.5, best.qz, span, 0.25, 1.2, rot);
}

function hillTemple(ctx, p) {
  const { g } = ctx;
  g.color(0x8a7a5c, 0); g.blob(p.x, -6, p.z, 34, 16, 30, 11);
  g.color(0x7d8a4a, 0); g.blob(p.x + 8, -4, p.z - 6, 22, 13, 20, 12);
  const top = 8.5;
  g.color(0xf2efe6, 0); g.cbox(p.x, top, p.z, 2.4, 3, 2.4);
  g.color(0xe0773a, 0); g.lathe(p.x, top + 3, p.z, [[2.4, 0], [1.4, 2.4], [0.05, 4.2]], 4);
  g.color(SAFFRON, 0);
  const a = g.v(p.x, top + 9, p.z), b = g.v(p.x + 2, top + 8.4, p.z), c = g.v(p.x, top + 7.8, p.z);
  g.tri(a, b, c); g.tri(a, c, b);
  g.color(0x7a5a3c, 0); g.cyl(p.x, top + 7, p.z, 0.05, 2.2, 4);
}

function airport(ctx, p) {
  const { g, pg } = ctx;
  const { X, Z, rot } = frame(p);
  facadeBox(g, X, Z, rot, 0, 0, p.w / 2, p.d / 2, 7, ROW.MODERN, 0xe9eef0, 91, ROW.MODERN);
  g.color(0x2a5d8f, 0); g.cbox(X(0, -p.d / 2 - 2), 6, Z(0, -p.d / 2 - 2), p.w / 2, 0.35, 2.4, rot);
  // Control tower.
  g.color(0xe9eef0, 0); g.cyl(X(p.w / 2 + 8, 4), 0, Z(p.w / 2 + 8, 4), 1.6, 16, 8);
  g.color(0x2f4f5f, 0); g.cyl(X(p.w / 2 + 8, 4), 16, Z(p.w / 2 + 8, 4), 3, 2.6, 8, 3.4);
  g.color(0xe9eef0, 0); g.cyl(X(p.w / 2 + 8, 4), 18.6, Z(p.w / 2 + 8, 4), 3.4, 0.4, 8, 2);
  sign(ctx, p, X, Z, 0, -p.d / 2 - 0.1, 10, 7.4, 8.8);
  pool(pg, X(0, -p.d / 2 - 6), Z(0, -p.d / 2 - 6), 12);
}

function garden(ctx, p) {
  const { g } = ctx;
  const { X, Z, rot } = frame(p);
  const hw = (p.w / 2 + 6) * (p.fit ?? 1), hd = (p.d / 2 + 6) * (p.fit ?? 1);
  g.color(0x6f9e4c, 0); g.flat(X(-hw, -hd), Z(-hw, -hd), X(hw, -hd), Z(hw, -hd), X(hw, hd), Z(hw, hd), X(-hw, hd), Z(-hw, hd), 0.08);
  g.color(0xc9b896, 0); g.flat(X(-1.2, -hd), Z(-1.2, -hd), X(1.2, -hd), Z(1.2, -hd), X(1.2, hd), Z(1.2, hd), X(-1.2, hd), Z(-1.2, hd), 0.1);
  g.flat(X(-hw, -1.2), Z(-hw, -1.2), X(hw, -1.2), Z(hw, -1.2), X(hw, 1.2), Z(hw, 1.2), X(-hw, 1.2), Z(-hw, 1.2), 0.1);
  // Fountain.
  g.color(0xd8d2c4, 0); g.cyl(p.x, 0, p.z, 3.4, 0.6, 14);
  g.color(0x4f8fa0, 0); g.cyl(p.x, 0.5, p.z, 3.0, 0.15, 14);
  g.color(0xd8d2c4, 0); g.cyl(p.x, 0.5, p.z, 0.4, 1.6, 8); g.cyl(p.x, 2.1, p.z, 1.2, 0.2, 10);
  const r = rng(hash2(Math.round(p.x), 7));
  for (let k = 0; k < 14; k++) {
    const lx = r.range(-hw + 2, hw - 2), lz = r.range(-hd + 2, hd - 2);
    if (Math.abs(lx) < 3 || Math.abs(lz) < 3) continue;
    const x = X(lx, lz), z = Z(lx, lz);
    g.color(0x6b5440, 0); g.cyl(x, 0, z, 0.18, 2.4, 5, 0.12);
    g.color(r.pick([0x4f7a3a, 0x5d8a44, 0xd9482b]), 0); g.blob(x, 3.6, z, 1.8, 1.4, 1.8, k);
  }
  // Compound wall with a painted gate.
  g.setTint(0xe8dcc4, 0).setTile(TILE.COMPOUND[0], TILE.COMPOUND[1], 1, 1);
  for (const [ax, az, bx, bz] of [[hw, hd, -hw, hd], [-hw, hd, -hw, -hd], [hw, -hd, hw, hd], [-hw, -hd, -3, -hd], [3, -hd, hw, -hd]]) {
    g.wall(X(ax, az), Z(ax, az), X(bx, bz), Z(bx, bz), 0, 1.4, 0, Math.hypot(bx - ax, bz - az) / FLOOR, 0.55, 1);
    g.wall(X(bx, bz), Z(bx, bz), X(ax, az), Z(ax, az), 0, 1.4, 0, Math.hypot(bx - ax, bz - az) / FLOOR, 0.55, 1);
  }
}

function statue(ctx, p, kind) {
  const { g, pg } = ctx;
  const { X, Z, rot } = frame(p);
  // A garlanded figure on a tall pedestal: kept as an elegant silhouette.
  g.color(0xe8e2d4, 0); g.cbox(p.x, 0, p.z, 1.8, 0.6, 1.8, rot);
  g.color(0xd8d0bc, 0); g.cbox(p.x, 0.6, p.z, 1.3, 3.4, 1.3, rot);
  g.color(0x6a6f63, 0);
  const bronze = 0x5d5a4a;
  if (kind === 'horse') {
    g.color(bronze, 0);
    g.blob(p.x, 5.6, p.z, 0.75, 0.75, 1.7, 1); // horse body
    g.beam(X(0, -1.5), 5.9, Z(0, -1.5), X(0, -2.2), 7.0, Z(0, -2.2), 0.32); // neck
    g.blob(X(0, -2.5), 7.1, Z(0, -2.5), 0.3, 0.32, 0.55, 2); // head
    for (const [lx, lz, up] of [[-0.4, -1.1, 1], [0.4, -1.1, 0], [-0.4, 1.1, 0], [0.4, 1.1, 0]]) g.beam(X(lx, lz), 5.2, Z(lx, lz), X(lx, lz - (up ? 0.9 : 0)), up ? 4.6 : 4.0, Z(lx, lz - (up ? 0.9 : 0)), 0.13);
    g.beam(X(0, 1.6), 5.8, Z(0, 1.6), X(0, 2.2), 4.6, Z(0, 2.2), 0.1); // tail
    g.blob(p.x, 6.9, p.z, 0.4, 0.62, 0.36, 3); // rider
    g.blob(p.x, 7.75, p.z, 0.24, 0.27, 0.24, 4);
    g.beam(X(0.3, 0), 7.3, Z(0.3, 0), X(0.5, -0.9), 8.6, Z(0.5, -0.9), 0.07); // raised sword
    g.color(0xff8c1a, 0); g.cyl(p.x, 4.05, p.z, 1.05, 0.25, 10); // marigold garland
  } else {
    g.color(bronze, 0);
    g.blob(p.x, 4.9, p.z, 0.42, 0.8, 0.32, 5);
    g.beam(X(-0.2, 0), 4.0, Z(-0.2, 0), X(-0.2, 0), 4.6, Z(-0.2, 0), 0.14);
    g.blob(p.x, 6.0, p.z, 0.24, 0.28, 0.24, 6);
    if (kind === 'pointing') g.beam(X(0.38, 0), 5.4, Z(0.38, 0), X(0.5, -0.9), 6.2, Z(0.5, -0.9), 0.08);
    else g.beam(X(0.36, 0), 5.3, Z(0.36, 0), X(0.45, -0.3), 4.1, Z(0.45, -0.3), 0.06);
    g.color(0xff8c1a, 0); g.cyl(p.x, 5.35, p.z, 0.46, 0.12, 10);
  }
  pool(pg, p.x, p.z, 6);
}

/** Gateway arch spanning the street at the place's approach. */
function kaman(ctx, p, style) {
  const { g, net, pg } = ctx;
  const n = net.nearest(p.ax, p.az, 40, {});
  if (!n) return;
  const w = net.width[n.road];
  const rot = Math.atan2(n.dx, n.dz); // local z along the road, local x across it
  const c = Math.cos(rot), s = Math.sin(rot);
  const X = (lx, lz) => n.x + lx * c + lz * s, Z = (lx, lz) => n.z - lx * s + lz * c;
  const span = w / 2 + (style === 'old' ? 2.2 : 1.6);
  if (style === 'old') {
    for (const sx of [-span, span]) texBox(g, X, Z, rot, sx, 0, 0, 1.6, 9.5, 2.6, TILE.STONE, 0xffffff, 2.5);
    texBox(g, X, Z, rot, 0, 7.2, 0, span + 1.6, 3.4, 2.6, TILE.STONE, 0xffffff, 2.5);
    g.color(0x5c5650, 0);
    for (let k = -3; k <= 3; k++) g.cbox(X(k * span / 3.2, 0), 10.6, Z(k * span / 3.2, 0), 0.5, 0.8, 2.6, rot);
  } else {
    g.color(0xe9dcc0, 0);
    for (const sx of [-span, span]) { g.cbox(X(sx, 0), 0, Z(sx, 0), 0.9, 8, 0.9, rot); onionDome(g, X(sx, 0), 8, Z(sx, 0), 1.0, 0xe0773a); }
    g.color(0xd8c8a8, 0); g.cbox(X(0, 0), 6.4, Z(0, 0), span, 1.4, 0.7, rot);
    g.color(0xc0392b, 0); g.cbox(X(0, 0), 7.8, Z(0, 0), span * 0.6, 0.9, 0.5, rot);
    g.color(GOLD, 0); onionDome(g, X(0, 0), 8.7, Z(0, 0), 1.2);
  }
  pool(pg, X(-span, 0), Z(-span, 0), 5); pool(pg, X(span, 0), Z(span, 0), 5);
}

function bazaar(ctx, p) {
  const { g } = ctx;
  const { X, Z, rot } = frame(p);
  const r = rng(hash2(Math.round(p.x), Math.round(p.z)));
  // A row of cloth-roofed stalls in front of the shops.
  for (let k = -3; k <= 3; k++) {
    const x = X(k * 3.4, -8), z = Z(k * 3.4, -8);
    g.color(0x7a5a3c, 0); g.cbox(x, 0, z, 1.4, 0.9, 1.0, rot);
    g.color(r.pick([0xe67e22, 0xf1c40f, 0xc0392b, 0x27ae60, 0xecf0f1]), 0); g.blob(x, 1.0, z, 1.2, 0.25, 0.8, k);
    g.color(r.pick([0x2f6fb5, 0xc0392b, 0xf39c12, 0x16a085]), 0);
    const a = g.v(X(k * 3.4 - 1.6, -9.3), 2.6, Z(k * 3.4 - 1.6, -9.3)), b = g.v(X(k * 3.4 + 1.6, -9.3), 2.6, Z(k * 3.4 + 1.6, -9.3));
    const c = g.v(X(k * 3.4 + 1.6, -6.7), 3.0, Z(k * 3.4 + 1.6, -6.7)), d = g.v(X(k * 3.4 - 1.6, -6.7), 3.0, Z(k * 3.4 - 1.6, -6.7));
    g.quad(a, d, c, b); g.quad(a, b, c, d);
    g.color(0x6b5440, 0);
    for (const [lx, lz] of [[-1.5, -9.2], [1.5, -9.2], [-1.5, -6.8], [1.5, -6.8]]) g.cyl(X(k * 3.4 + lx, lz), 0, Z(k * 3.4 + lx, lz), 0.05, 2.8, 4);
  }
  namedBlock(ctx, p, { floors: 2, row: ROW.OLD, color: 0xd8c39a, shop: true });
}

// ------------------------------------------------------------------ named buildings
function namedBlock(ctx, p, { floors, row, color, banner = false, cross = false, shop = false, flag = false }) {
  const { g, pg } = ctx;
  const { X, Z, rot } = frame(p);
  const hw = Math.max(4, p.w / 2), hd = Math.max(3.5, p.d / 2);
  const h = floors * FLOOR;
  facadeBox(g, X, Z, rot, 0, 0, hw, hd, h, row, color, hash2(Math.round(p.x), Math.round(p.z)), shop ? ROW.SHOP : row === ROW.BALCONY ? ROW.MODERN : row);
  // Entrance canopy and the board.
  g.color(0xd8d2c4, 0); g.cbox(X(0, -hd - 1.3), 3.0, Z(0, -hd - 1.3), Math.min(hw - 0.5, 3.5), 0.2, 1.3, rot);
  sign(ctx, p, X, Z, 0, -hd - 0.12, Math.min(hw - 0.2, 6), shop ? 3.1 : h - 1.8, shop ? 3.95 : h - 0.6);
  if (banner) {
    // Toppers' hoarding down the facade, as every coaching class has.
    g.setTint(0xffffff, 0).setTile(TILE.HOARD_A[0], TILE.HOARD_A[1], 1, 2);
    const bw = Math.min(hw - 0.6, 4.2);
    g.wall(X(bw, -hd - 0.08), Z(bw, -hd - 0.08), X(-bw, -hd - 0.08), Z(-bw, -hd - 0.08), 4, 4 + bw * 1.6, 0, 1, 0, 1);
  }
  if (cross) {
    g.color(0xd32f2f, 0);
    g.cbox(X(hw - 1.4, -hd - 0.1), h - 3.6, Z(hw - 1.4, -hd - 0.1), 0.35, 1.8, 0.08, rot);
    g.cbox(X(hw - 1.4, -hd - 0.1), h - 3.0, Z(hw - 1.4, -hd - 0.1), 0.9, 0.6, 0.08, rot);
  }
  if (flag) {
    const x = X(-hw - 3, -hd - 3), z = Z(-hw - 3, -hd - 3);
    g.color(0xe8e8e8, 0); g.cyl(x, 0, z, 0.08, 9, 5);
    const stripe = (y, col) => { g.color(col, 0); const a = g.v(x, y, z), b = g.v(x + 2.4, y, z), c = g.v(x + 2.4, y - 0.5, z), d = g.v(x, y - 0.5, z); g.quad(a, b, c, d); g.quad(a, d, c, b); };
    stripe(8.9, 0xff9933); stripe(8.4, 0xffffff); stripe(7.9, 0x138808);
  }
  pool(pg, X(0, -hd - 3), Z(0, -hd - 3), 6);
}

function campus(ctx, p, index, school = false) {
  const { g } = ctx;
  const { X, Z, rot } = frame(p);
  const r = rng(hash2(index, 77));
  const color = r.pick([0xf0e6d2, 0xe8d8b8, 0xdce3e6, 0xf2d27a, 0xe9c9b2]);
  namedBlock(ctx, p, { floors: school ? 2 : 3, row: school ? ROW.RES : r.chance(0.5) ? ROW.MODERN : ROW.OLD, color, flag: !school && r.chance(0.5) });
  // A wing behind and a gate pillar pair in front.
  const hw = Math.max(4, p.w / 2), hd = Math.max(3.5, p.d / 2);
  facadeBox(g, X, Z, rot, hw * 0.6, hd + 6, hw * 0.55, 4, FLOOR * (school ? 2 : 3), ROW.RES, color, index * 7);
  g.color(0xd8d0bc, 0);
  for (const sx of [-4, 4]) g.cbox(X(sx, -hd - 7), 0, Z(sx, -hd - 7), 0.6, 2.8, 0.6, rot);
  g.color(0x2d5d8a, 0); g.cbox(X(0, -hd - 7), 2.6, Z(0, -hd - 7), 4.2, 0.5, 0.15, rot);
}

function mall(ctx, p) {
  const { g, pg } = ctx;
  const { X, Z, rot } = frame(p);
  const hw = p.w / 2 + 4, hd = p.d / 2 + 3;
  facadeBox(g, X, Z, rot, 0, 0, hw, hd, 14, ROW.MODERN, 0xd7dde0, hash2(Math.round(p.x), 3), ROW.SHOP);
  // Glass atrium on the front.
  g.color(0x3f6f86, 0); g.cbox(X(0, -hd - 1), 0, Z(0, -hd - 1), hw * 0.4, 13, 1, rot);
  sign(ctx, p, X, Z, 0, -hd - 2.1, Math.min(hw * 0.6, 8), 10.5, 12.4);
  pool(pg, X(0, -hd - 6), Z(0, -hd - 6), 12);
}

function pool(pg, x, z, radius, headY = 0) {
  pg.setTint(0xffffff, 0).setTile(0, 0, 1, 0);
  const y = 0.14;
  const a = pg.v(x - radius, y, z - radius, 0, 0), b = pg.v(x - radius, y, z + radius, 0, 1);
  const c = pg.v(x + radius, y, z + radius, 1, 1), d = pg.v(x + radius, y, z - radius, 1, 0);
  pg.quad(a, b, c, d);
  if (headY) {
    const r = 0.5;
    const e = pg.v(x - r, headY, z - r, 0, 0), f = pg.v(x + r, headY, z - r, 1, 0);
    const h = pg.v(x + r, headY, z + r, 1, 1), k = pg.v(x - r, headY, z + r, 0, 1);
    pg.quad(e, f, h, k);
  }
}
