// Hand-built landmarks and named buildings for the researched places. These
// are illustrations from primitives, not surveyed replicas: what matters is
// that Hazur Sahib's golden dome, the ghats and the station are recognisable
// from the street, and that every college and coaching class has its board up.
import { ROW, TILE, SIGN_COLS } from './atlas.js';
import { rng, hash2 } from '../core/math.js';
import { STATION_HD, BUS_STAND } from './citygen.js';
import { LEAF } from './foliage.js';

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
    case 'shivaji-putla': case 'gandhi-putla': case 'ambedkar-chowk-latur-phata': return [{ x: p.x, z: p.z, r: 4.3, h: 1.2 }, box(0, 0, 2.2, 2.2, 10)];
    case 'bhagya-nagar-kaman': case 'hingoli-gate': case 'mal-tekdi': case 'vishnupuri-dam': return [];
    case 'old-mondha-clock-tower': return [box(0, 0, 2.6, 2.6, 22)];
    case 'nanded-airport': {
      const out = [box(0, 0, 18, 8, 10), box(27, 6, 1.7, 1.7, 24)];
      for (const lx of [-13, -4.5, 4.5, 13]) out.push(box(lx, -13, 0.4, 0.4, 7));
      if (p.plane) {
        const { x, z, heading } = p.plane;
        out.push({ x, z, hw: 1.4, hd: 13.6, rot: heading, h: 4 });
      }
      return out;
    }
    case 'nanded-bus-stand': {
      const k = p.fit ?? 1, HW = BUS_STAND[0] * k, HD = BUS_STAND[1] * k;
      const out = [box(0, (6.6 + HD) / 2, HW - 1, (HD - 6.6) / 2, 8), box(0, 3.4, HW - 2, 1.4, 0.32)];
      for (let lx = -HW + 4; lx <= HW - 4; lx += 6) out.push(box(lx, 2.4, 0.25, 0.25, 5));
      for (const gx of [-HW * 0.62, HW * 0.62]) for (const side of [-1, 1]) out.push(box(gx + side * 4.6, -HD, 0.45, 0.45, 6));
      return out;
    }
    case 'nanded-station': {
      if (!p.station) return [box(0, 0, p.w / 2 + 6, p.d / 2, 10)];
      const S = p.station, out = [box(0, -3.75, 34, 8, 11), box(0, -STATION_HD - 0.75, 10, 0.8, 12)];
      if (S.train) out.push(box((-S.train.a0 - S.train.a1) / 2, S.train.b, (S.train.a1 - S.train.a0) / 2, 1.6, 4.3));
      return out;
    }
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
  if (gold === GOLD) g.gilt(gold); else g.color(gold, 0);
  g.lathe(x, y, z, [[r * 0.82, 0], [r * 0.93, r * 0.16], [r * 1.0, r * 0.35], [r * 1.06, r * 0.54], [r * 1.08, r * 0.7], [r * 1.04, r * 0.88], [r * 0.95, r * 1.05], [r * 0.8, r * 1.22], [r * 0.62, r * 1.38], [r * 0.42, r * 1.51], [r * 0.25, r * 1.62], [r * 0.08, r * 1.8], [0.02, r * 1.84]], r > 2 ? 32 : 16, true);
  // Kalash finial.
  g.cyl(x, y + r * 1.8, z, r * 0.07, r * 0.5, 6, r * 0.03);
  g.blob(x, y + r * 2.1, z, r * 0.12, r * 0.14, r * 0.12, 3);
}

/** Gilded ribs down an onion dome (the same profile as onionDome), as on Hazur Sahib's fluted dome. */
function ribs(g, x, y, z, r, n) {
  const prof = [[0.82, 0], [0.93, 0.16], [1.0, 0.35], [1.06, 0.54], [1.08, 0.7], [1.04, 0.88], [0.95, 1.05], [0.8, 1.22], [0.62, 1.38], [0.42, 1.51], [0.25, 1.62], [0.08, 1.8]];
  g.gilt(0xf0c050);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2, c = Math.cos(a) * r * 1.02, s = Math.sin(a) * r * 1.02;
    for (let i = 0; i + 1 < prof.length; i++) g.beam(x + c * prof[i][0], y + r * prof[i][1], z + s * prof[i][0], x + c * prof[i + 1][0], y + r * prof[i + 1][1], z + s * prof[i + 1][0], r * 0.012);
  }
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
  onionDome(g, X(0, -R), 11.6, Z(0, -R), 2.2);
  ribs(g, X(0, -R), 11.6, Z(0, -R), 2.2, 12);
  chhatri(g, X(-5.5, -R), 11.6, Z(-5.5, -R), 1.1); chhatri(g, X(5.5, -R), 11.6, Z(5.5, -R), 1.1);
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
  g.gilt(GOLD); g.cbox(p.x, 9.9, p.z, 9.8, 0.5, 9.8, rot);
  for (let i = -3; i <= 3; i++) for (const lz of [-9.6, 9.6]) { g.gilt(GOLD); g.blob(X(i * 2.8, lz), 10.7, Z(i * 2.8, lz), 0.45, 0.6, 0.45, i); }
  for (let i = -3; i <= 3; i++) for (const lx of [-9.6, 9.6]) { g.gilt(GOLD); g.blob(X(lx, i * 2.8), 10.7, Z(lx, i * 2.8), 0.45, 0.6, 0.45, i + 9); }
  for (const [lx, lz] of [[-9.5, -9.5], [9.5, -9.5], [9.5, 9.5], [-9.5, 9.5]]) chhatri(g, X(lx, lz), 10.4, Z(lx, lz), 1.5);
  texBox(g, X, Z, rot, 0, 10.4, 0, 6.2, 4.6, 6.2, TILE.MARBLE, 0xffffff, 4);
  g.gilt(GOLD); g.cbox(p.x, 15, p.z, 6.4, 0.4, 6.4, rot);
  for (const [lx, lz] of [[-6, -6], [6, -6], [6, 6], [-6, 6]]) chhatri(g, X(lx, lz), 15.4, Z(lx, lz), 1.2);
  // The golden dome on its drum, fluted with gilded ribs.
  g.color(MARBLE, 0); g.cyl(cx, 15.4, cz, 4.2, 1.6, 14);
  onionDome(g, cx, 17, cz, 4.4);
  ribs(g, cx, 17, cz, 4.4, 16);
  // Gilded jharokhas on every face of the upper storey, a little dome over each.
  for (let q = 0; q < 4; q++) {
    const F = frame(p, rot + (q * Math.PI) / 2);
    for (const lx of [-3.6, 0, 3.6]) {
      g.color(MARBLE, 0); g.cbox(F.X(lx, -6.6), 11.2, F.Z(lx, -6.6), 0.9, 1.9, 0.5, F.rot);
      g.gilt(GOLD); g.cbox(F.X(lx, -7.12), 11.35, F.Z(lx, -7.12), 0.75, 0.12, 0.04, F.rot); g.cbox(F.X(lx, -7.12), 12.85, F.Z(lx, -7.12), 0.75, 0.12, 0.04, F.rot);
      archFace(g, F.X, F.Z, lx, -7.13, 1.1, 1.4, 11.5, 0x5b3a1e);
      onionDome(g, F.X(lx, -6.6), 13.1, F.Z(lx, -6.6), 0.45);
    }
  }
  // Angitha Sahib: a small marble shrine with its own golden dome in the courtyard.
  const ax = -R * 0.62, az = R * 0.45;
  texBox(g, X, Z, rot, ax, 0, az, 3.2, 4.4, 3.2, TILE.MARBLE, 0xffffff, 4);
  for (let q = 0; q < 4; q++) { const F = frame({ x: X(ax, az), z: Z(ax, az), rot: p.rot }, rot + (q * Math.PI) / 2); archFace(g, F.X, F.Z, 0, -3.25, 1.6, 2.8, 0.2, 0x5b3a1e); }
  g.gilt(GOLD); g.cbox(X(ax, az), 4.4, Z(ax, az), 3.3, 0.3, 3.3, rot);
  for (const [dx, dz] of [[-2.8, -2.8], [2.8, -2.8], [2.8, 2.8], [-2.8, 2.8]]) chhatri(g, X(ax + dx, az + dz), 4.7, Z(ax + dx, az + dz), 0.7);
  g.color(MARBLE, 0); g.cyl(X(ax, az), 4.7, Z(ax, az), 1.7, 0.8, 12);
  onionDome(g, X(ax, az), 5.5, Z(ax, az), 1.9);
  // Lanterns along the parikrama.
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + 0.31, rr = R * 0.78, lx = Math.cos(a) * rr, lz = Math.sin(a) * rr;
    if (Math.abs(lx) < 6 && lz < 0) continue; // keep the path from the gate clear
    g.color(0x2a2a2a, 0); g.cyl(X(lx, lz), 0.09, Z(lx, lz), 0.08, 3.4, 6);
    g.gilt(GOLD); g.blob(X(lx, lz), 3.6, Z(lx, lz), 0.28, 0.36, 0.28, k);
    pool(pg, X(lx, lz), Z(lx, lz), 4, 3.6);
  }
  // The Darshani Deori rises a storey higher, with balconies either side of its dome.
  texBox(g, X, Z, rot, 0, 9, -R, 5.2, 2.6, 1.8, TILE.MARBLE, 0xffffff, 4);
  for (const lx of [-3, 3]) { archFace(g, X, Z, lx, -R - 1.85, 1.3, 1.7, 9.4, 0x5b3a1e); g.gilt(GOLD); g.cbox(X(lx, -R - 1.9), 9.25, Z(lx, -R - 1.9), 0.9, 0.12, 0.25, rot); }
  // The tall Nishan Sahib before the gate, with a pair either side of the path.
  nishanSahib(g, X(0, -R - 9), Z(0, -R - 9), 32);
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
  g.gilt(GOLD); g.cbox(p.x, top, p.z, hw + 0.2, 0.35, hw + 0.2, rot);
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
  g.gilt(GOLD); g.cyl(x, 7.8, z, 0.12, 0.6, 5);
  g.color(SAFFRON, 0);
  const a = g.v(x, 9.6, z), b = g.v(x + 1.8, 9.1, z), c2 = g.v(x, 8.4, z);
  g.tri(a, b, c2); g.tri(a, c2, b);
  g.color(0x7a5a3c, 0); g.cyl(x, 7.8, z, 0.04, 1.9, 4);
}

// ------------------------------------------------------------------ transport & civic
function station(ctx, p) {
  const { g, pg } = ctx;
  const S = p.station;
  if (!S) return;
  const { X, Z, rot } = frame(p);
  const CREAM = 0xf1e6c8, MAROON = 0x7a2a26, TRIM = 0xf8f4ea, STONE2 = 0xc9bfa8;
  const front = -STATION_HD, back = 4.25;
  // Plinth and forecourt pavers.
  g.color(STONE2, 0); g.cbox(X(0, (front + back) / 2), 0, Z(0, (front + back) / 2), 33, 0.6, (back - front) / 2, rot);
  texBox(g, X, Z, rot, 0, 0, front - 2.2, 34, 0.08, 2.2, TILE.PAVERS, 0xffffff, 2);
  // The wings: two storeys of arched windows over a ground-floor arcade, maroon bands.
  for (const side of [-1, 1]) {
    const cx = side * 21, hw = 11;
    facadeBox(g, X, Z, rot, cx, (front + back) / 2, hw, (back - front) / 2, 8.4, ROW.OLD, CREAM, 41 + side);
    for (let i = -2; i <= 2; i++) {
      archFace(g, X, Z, cx + i * 4.2, front - 0.05, 2.6, 3.6, 0.6, 0x3a2e24);
      archFace(g, X, Z, cx + i * 4.2, front - 0.06, 1.5, 2.2, 4.9, 0x2c3a40);
    }
    g.color(MAROON, 0);
    g.cbox(X(cx, front - 0.1), 4.1, Z(cx, front - 0.1), hw, 0.32, 0.12, rot);
    g.cbox(X(cx, front - 0.1), 8.1, Z(cx, front - 0.1), hw, 0.3, 0.12, rot);
    // Domelets along the parapet.
    for (let i = -1; i <= 1; i++) { g.color(TRIM, 0); g.cyl(X(cx + i * 7, front + 0.4), 9.3, Z(cx + i * 7, front + 0.4), 0.5, 0.5, 8); onionDome(g, X(cx + i * 7, front + 0.4), 9.8, Z(cx + i * 7, front + 0.4), 0.55); }
    // End pavilions with chhatris.
    texBox(g, X, Z, rot, side * 32.5, 0, (front + back) / 2, 3.2, 10.4, (back - front) / 2 + 0.3, TILE.COMPOUND, CREAM, 3);
    archFace(g, X, Z, side * 32.5, front - 0.4, 2.2, 3.4, 0.6, 0x3a2e24);
    g.color(MAROON, 0); g.cbox(X(side * 32.5, front - 0.35), 9.4, Z(side * 32.5, front - 0.35), 3.25, 0.4, 0.1, rot);
    chhatri(g, X(side * 32.5, front + 2), 10.4, Z(side * 32.5, front + 2), 1.6, TRIM);
    chhatri(g, X(side * 32.5, back - 2), 10.4, Z(side * 32.5, back - 2), 1.6, TRIM);
  }
  // The entrance pavilion: a tall arch, a clock, a golden dome and chhatris over the booking hall.
  texBox(g, X, Z, rot, 0, 0, (front - 1.5 + back) / 2, 10, 12.4, (back - front + 1.5) / 2, TILE.COMPOUND, CREAM, 3);
  const pf = front - 1.55;
  archFace(g, X, Z, 0, pf, 6.4, 8.6, 0.6, 0x2e2620);
  archFace(g, X, Z, -6.6, pf, 3.4, 6.2, 0.6, 0x3a2e24); archFace(g, X, Z, 6.6, pf, 3.4, 6.2, 0.6, 0x3a2e24);
  for (let i = -2; i <= 2; i++) if (i) archFace(g, X, Z, i * 3.4, pf - 0.01, 1.4, 1.9, 10.0, 0x2c3a40);
  g.color(MAROON, 0); g.cbox(X(0, pf - 0.05), 9.3, Z(0, pf - 0.05), 10.05, 0.4, 0.12, rot);
  disc(g, X, Z, 0, pf - 0.06, 11.2, 1.05, 0x2a2420); disc(g, X, Z, 0, pf - 0.08, 11.2, 0.9, 0xf8f4e6);
  g.color(0x1a1a1a, 0); g.beam(X(0, pf - 0.12), 11.2, Z(0, pf - 0.12), X(0, pf - 0.12), 11.85, Z(0, pf - 0.12), 0.04); g.beam(X(0, pf - 0.12), 11.2, Z(0, pf - 0.12), X(0.45, pf - 0.12), 11.2, Z(0.45, pf - 0.12), 0.05);
  // Cantilevered canopy over the doors, on steel brackets.
  g.color(0xd9d3c6, 0); g.cbox(X(0, pf - 1.6), 6.9, Z(0, pf - 1.6), 8, 0.3, 1.6, rot);
  g.color(0x4a4f52, 0); for (const lx of [-7, -2.4, 2.4, 7]) g.beam(X(lx, pf), 8.2, Z(lx, pf), X(lx, pf - 3), 7.2, Z(lx, pf - 3), 0.06);
  sign(ctx, p, X, Z, 0, pf - 0.12, 8.6, 12.4, 13.9);
  // Dome on its drum, chhatris at the corners, gilded domelets on the parapet.
  g.color(TRIM, 0); g.cyl(p.x, 12.4, p.z, 3.1, 1.4, 16);
  onionDome(g, p.x, 13.8, p.z, 3.3);
  for (const [lx, lz] of [[-8.6, pf + 1.4], [8.6, pf + 1.4], [-8.6, back - 1.4], [8.6, back - 1.4]]) chhatri(g, X(lx, lz), 12.4, Z(lx, lz), 1.4, TRIM);
  // Platform 1: 840 mm high, pavers with a yellow edge, a canopy on steel columns, benches and boards.
  for (const pl of S.platforms) {
    const lx0 = -pl.a1, lx1 = -pl.a0, cx = (lx0 + lx1) / 2, hw = (lx1 - lx0) / 2, cz = (pl.b0 + pl.b1) / 2, hd = (pl.b1 - pl.b0) / 2;
    g.color(0xb4ad9e, 0); g.cbox(X(cx, cz), 0, Z(cx, cz), hw, 0.8, hd, rot);
    texBox(g, X, Z, rot, cx, 0.8, cz, hw, 0.04, hd, TILE.PAVERS, 0xffffff, 2);
    g.color(0xf2c230, 0); g.cbox(X(cx, pl.b1 - 0.45), 0.845, Z(cx, pl.b1 - 0.45), hw, 0.01, 0.15, rot);
    for (let lx = lx0 + 4; lx <= lx1 - 4; lx += 8) {
      g.color(0x55635f, 0); g.cyl(X(lx, cz), 0.84, Z(lx, cz), 0.14, 4.9, 6);
      g.beam(X(lx, cz), 5.6, Z(lx, cz), X(lx, pl.b0 + 0.3), 5.25, Z(lx, pl.b0 + 0.3), 0.07);
      g.beam(X(lx, cz), 5.6, Z(lx, cz), X(lx, pl.b1 - 0.3), 5.25, Z(lx, pl.b1 - 0.3), 0.07);
      if ((lx - lx0) % 16 < 8) { g.color(0x6b4a2e, 0); g.cbox(X(lx + 2.5, cz + 1.2), 0.84, Z(lx + 2.5, cz + 1.2), 1.1, 0.45, 0.25, rot); g.cbox(X(lx + 2.5, cz + 1.45), 1.29, Z(lx + 2.5, cz + 1.45), 1.1, 0.4, 0.05, rot); }
    }
    // Corrugated roof sheets sloping to both edges, with a fascia.
    g.color(0x768c84, 0);
    for (const [z0, z1] of [[cz, pl.b0 - 0.4], [cz, pl.b1 + 0.6]]) {
      const a = g.v(X(lx0 - 1, z0), 5.75, Z(lx0 - 1, z0)), b = g.v(X(lx1 + 1, z0), 5.75, Z(lx1 + 1, z0));
      const c = g.v(X(lx1 + 1, z1), 5.3, Z(lx1 + 1, z1)), d = g.v(X(lx0 - 1, z1), 5.3, Z(lx0 - 1, z1));
      g.quad(a, b, c, d); g.quad(a, d, c, b);
    }
    for (const lx of [lx0 + 1.5, lx1 - 1.5]) stationBoard(g, X, Z, lx, pl.b1 - 1.6, 0.84);
    for (let lx = lx0 + 10; lx < lx1 - 6; lx += 20) pool(pg, X(lx, cz), Z(lx, cz), 6);
  }
  // The foot overbridge: a covered deck on piers between the tracks, stairs at each end.
  if (S.fob) {
    const fx = -S.fob.a, D = 7.2, b0 = S.fob.b0, b1 = S.fob.b1;
    g.color(0xb8b2a6, 0); g.cbox(X(fx, (b0 + b1) / 2), D - 0.4, Z(fx, (b0 + b1) / 2), 1.6, 0.4, (b1 - b0) / 2, rot);
    g.color(0x9fb0aa, 0);
    for (const side of [-1, 1]) g.cbox(X(fx + side * 1.55, (b0 + b1) / 2), D, Z(fx + side * 1.55, (b0 + b1) / 2), 0.06, 1.1, (b1 - b0) / 2, rot);
    g.color(0x768c84, 0); g.cbox(X(fx, (b0 + b1) / 2), D + 2.5, Z(fx, (b0 + b1) / 2), 1.9, 0.12, (b1 - b0) / 2 + 0.3, rot);
    g.color(0x55635f, 0);
    for (let b = b0 + 1; b <= b1 - 1; b += 6) for (const side of [-1, 1]) g.cyl(X(fx + side * 1.5, b), D, Z(fx + side * 1.5, b), 0.07, 2.5, 5);
    // Piers stand in the gaps between the tracks.
    const gaps = [S.track - 1.9, ...S.tracks.slice(0, -1).map((t, i) => (t + S.tracks[i + 1]) / 2).filter((m, i) => S.tracks[i + 1] - S.tracks[i] > 2.6), b1 - 1];
    g.color(0xa39d90, 0);
    for (const b of gaps) g.cbox(X(fx, b), 0, Z(fx, b), 0.35, D - 0.4, 0.35, rot);
    // Stairs: down onto Platform 1, and down to the street beyond the yard.
    stairs(g, X, Z, rot, fx - 1.6, b0 + 1.5, -1, D, 0.84);
    stairs(g, X, Z, rot, fx + 1.6, b1 - 1.5, 1, D, 0);
  }
  // Overhead line: portal masts across the tracks, a contact wire over each.
  if (S.tracks.length) {
    const t0 = S.tracks[0] - 2.4, t1 = S.tracks[S.tracks.length - 1] + 2.4;
    for (let lx = -60; lx <= 60; lx += 30) {
      g.color(0x4c5355, 0);
      g.cbox(X(lx, t0), 0, Z(lx, t0), 0.18, 7.8, 0.18, rot); g.cbox(X(lx, t1), 0, Z(lx, t1), 0.18, 7.8, 0.18, rot);
      g.cbox(X(lx, (t0 + t1) / 2), 7.5, Z(lx, (t0 + t1) / 2), 0.15, 0.3, (t1 - t0) / 2, rot);
    }
    g.color(0x3c3a36, 0);
    for (const t of S.tracks) g.cbox(X(0, t), 6.1, Z(0, t), 62, 0.03, 0.02, rot);
  }
  // A train in at Platform 1: an electric loco and three coaches.
  if (S.train) train(g, X, Z, rot, -S.train.a1, -S.train.a0, S.train.b);
  pool(pg, X(0, front - 4), Z(0, front - 4), 12);
}

/** A clock face or round window on a front face (local -z), as a flat disc. */
function disc(g, X, Z, lx, lz, y, r, color) {
  g.color(color, 0);
  const n = 20, c = g.v(X(lx, lz), y, Z(lx, lz)), ids = [];
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; ids.push(g.v(X(lx + Math.cos(a) * r, lz), y + Math.sin(a) * r, Z(lx + Math.cos(a) * r, lz))); }
  for (let i = 0; i < n; i++) g.tri(c, ids[i + 1], ids[i]);
}

/** The yellow station name board on two posts. */
function stationBoard(g, X, Z, lx, lz, y0) {
  g.color(0x1a1a1a, 0);
  g.cyl(X(lx - 1.5, lz), y0, Z(lx - 1.5, lz), 0.06, 3.2, 4); g.cyl(X(lx + 1.5, lz), y0, Z(lx + 1.5, lz), 0.06, 3.2, 4);
  g.setTint(0xffffff, 0).setTile(TILE.STATION_BOARD[0], TILE.STATION_BOARD[1], 1, 2);
  g.wall(X(lx + 1.8, lz - 0.05), Z(lx + 1.8, lz - 0.05), X(lx - 1.8, lz - 0.05), Z(lx - 1.8, lz - 0.05), y0 + 1.6, y0 + 3.2, 0, 1, 0, 1);
  g.wall(X(lx - 1.8, lz + 0.05), Z(lx - 1.8, lz + 0.05), X(lx + 1.8, lz + 0.05), Z(lx + 1.8, lz + 0.05), y0 + 1.6, y0 + 3.2, 0, 1, 0, 1);
}

/** A straight flight of steps along local x from (lx, lz) going `dir`, from height top down to bottom. */
function stairs(g, X, Z, rot, lx, lz, dir, top, bottom) {
  const steps = Math.round((top - bottom) / 0.3), run = 0.42;
  g.color(0xb4aea1, 0);
  for (let k = 0; k < steps; k++) {
    const y = top - (k + 1) * ((top - bottom) / steps);
    g.cbox(X(lx + dir * (k + 0.5) * run, lz), bottom, Z(lx + dir * (k + 0.5) * run, lz), run / 2 + 0.01, y - bottom + 0.15, 1.3, rot);
  }
  g.color(0x9fb0aa, 0);
  for (const side of [-1, 1]) g.beam(X(lx, lz + side * 1.3), top + 1.0, Z(lx, lz + side * 1.3), X(lx + dir * steps * run, lz + side * 1.3), bottom + 1.0, Z(lx + dir * steps * run, lz + side * 1.3), 0.04);
}

/** An Indian Railways train along local x from lx0 to lx1 on the track at lz: WAP-7 style loco and LHB coaches. */
function train(g, X, Z, rot, lx0, lx1, lz) {
  const LOCO = 20, COACH = 23.5, GAP = 0.7, hw = 1.6;
  let x = lx1;
  // Bogies: a frame over its axles and a wheel on each rail of the broad gauge (1.676 m).
  const ux = X(0, 1) - X(0, 0), uz = Z(0, 1) - Z(0, 0);
  const bogie = (bx, axles, spacing, r) => {
    g.color(0x2a2a2a, 0); g.cbox(X(bx, lz), 0.1 + r, Z(bx, lz), ((axles - 1) * spacing) / 2 + 0.6, 0.45, 1.15, rot);
    g.color(0x161616, 0);
    for (let a = 0; a < axles; a++) {
      const ax = bx + (a - (axles - 1) / 2) * spacing;
      for (const side of [-1, 1]) g.wheel(X(ax, lz + side * 0.76), 0.2 + r, Z(ax, lz + side * 0.76), r, 0.14, ux, uz, 12);
    }
  };
  // The loco: red with a white band, a cab at each end, a pantograph.
  const loco = (x0, x1) => {
    const cx = (x0 + x1) / 2, half = (x1 - x0) / 2;
    for (const k of [-1, 1]) bogie(cx + k * (half - 3.5), 3, 1.9, 0.55); // Co-Co: three axles a bogie
    g.color(0xb8322a, 0); g.cbox(X(cx, lz), 1.1, Z(cx, lz), half, 3.0, hw, rot);
    g.color(0xf2efe6, 0); g.cbox(X(cx, lz), 2.15, Z(cx, lz), half + 0.01, 0.35, hw + 0.01, rot);
    g.color(0x1d2b33, 0); for (const k of [-1, 1]) g.cbox(X(cx + k * (half - 0.05), lz), 2.7, Z(cx + k * (half - 0.05), lz), 0.06, 0.9, 1.25, rot);
    g.color(0x9a9890, 0); g.cbox(X(cx, lz), 4.1, Z(cx, lz), half - 0.6, 0.18, hw - 0.3, rot);
    g.color(0x3c3a36, 0); g.beam(X(cx - 4, lz), 4.3, Z(cx - 4, lz), X(cx - 2.5, lz), 5.6, Z(cx - 2.5, lz), 0.05); g.beam(X(cx - 2.5, lz), 5.6, Z(cx - 2.5, lz), X(cx - 1, lz), 6.05, Z(cx - 1, lz), 0.05);
  };
  const coach = (x0, x1) => {
    const cx = (x0 + x1) / 2, half = (x1 - x0) / 2;
    for (const k of [-1, 1]) bogie(cx + k * (half - 3), 2, 2.56, 0.46);
    g.color(0x2f4e86, 0); g.cbox(X(cx, lz), 1.05, Z(cx, lz), half, 2.95, hw, rot);
    g.color(0xe9e6dc, 0); g.cbox(X(cx, lz), 2.25, Z(cx, lz), half + 0.01, 0.85, hw + 0.01, rot);
    g.color(0x22313b, 0);
    for (let w = x0 + 2.5; w < x1 - 2; w += 1.9) for (const k of [-1, 1]) g.cbox(X(w, lz + k * (hw + 0.02)), 2.35, Z(w, lz + k * (hw + 0.02)), 0.55, 0.62, 0.02, rot);
    g.color(0xb9bcbd, 0); g.cbox(X(cx, lz), 4.0, Z(cx, lz), half - 0.3, 0.25, hw - 0.2, rot);
    g.color(0x1a1a1a, 0); g.cbox(X(x1 + GAP / 2, lz), 1.3, Z(x1 + GAP / 2, lz), GAP / 2 + 0.05, 2.5, 0.8, rot);
  };
  loco(x - LOCO, x); x -= LOCO + GAP;
  while (x - COACH >= lx0) { coach(x - COACH, x); x -= COACH + GAP; }
}

function busStand(ctx, p) {
  const { g, pg } = ctx;
  const { X, Z, rot } = frame(p);
  const k = p.fit ?? 1, HW = BUS_STAND[0] * k, HD = BUS_STAND[1] * k;
  const RED = 0xb03a2e, CREAM = 0xf0e6cc, GREY = 0xb7ab92;
  // The apron where the buses turn, and the raised platform along the bays.
  g.color(0x45484a, 0); g.flat(X(-HW, -HD), Z(-HW, -HD), X(HW, -HD), Z(HW, -HD), X(HW, 2), Z(HW, 2), X(-HW, 2), Z(-HW, 2), 0.075);
  g.color(GREY, 0); g.cbox(X(0, 3.4), 0, Z(0, 3.4), HW - 2, 0.32, 1.4, rot);
  g.color(0xf2c230, 0); g.cbox(X(0, 2.05), 0.32, Z(0, 2.05), HW - 2, 0.01, 0.06, rot);
  // Bay lines, numbered posts on the platform edge.
  for (const bay of busBays(p)) {
    g.color(0xe8e6dc, 0);
    const a = Math.atan2(bay.dx, bay.dz), lx = bay.lx, lz = bay.lz;
    for (const side of [-1, 1]) {
      const ox = Math.cos(a) * 1.9 * side, oz = -Math.sin(a) * 1.9 * side;
      g.beam(X(lx + ox - bay.dx * 5.5, lz + oz - bay.dz * 5.5), 0.08, Z(lx + ox - bay.dx * 5.5, lz + oz - bay.dz * 5.5), X(lx + ox + bay.dx * 4.6, lz + oz + bay.dz * 4.6), 0.08, Z(lx + ox + bay.dx * 4.6, lz + oz + bay.dz * 4.6), 0.07);
    }
    g.color(RED, 0); g.cbox(X(lx + bay.dx * 6.3, 2.6), 0.32, Z(lx + bay.dx * 6.3, 2.6), 0.18, 2.1, 0.18, rot);
    g.color(0xf4f1e6, 0); g.cbox(X(lx + bay.dx * 6.3, 2.6), 1.9, Z(lx + bay.dx * 6.3, 2.6), 0.35, 0.45, 0.2, rot);
  }
  // The bay shed: a long roof over the platform and the buses' noses, red fascia, cream soffit.
  for (let lx = -HW + 4; lx <= HW - 4; lx += 6) { g.color(CREAM, 0); g.cyl(X(lx, 2.4), 0.32, Z(lx, 2.4), 0.22, 5.0, 8); }
  g.color(0xe0d9c6, 0); g.cbox(X(0, 2.5), 5.3, Z(0, 2.5), HW - 1, 0.35, 4.2, rot);
  g.color(RED, 0); g.cbox(X(0, -1.75), 5.1, Z(0, -1.75), HW - 1, 0.75, 0.12, rot);
  g.color(CREAM, 0); g.cbox(X(0, -1.75), 5.85, Z(0, -1.75), HW - 1, 0.12, 0.13, rot);
  // The building behind: a waiting hall open on columns below, offices above, red bands.
  const b0 = 6.6, b1 = HD;
  facadeBox(g, X, Z, rot, 0, (b0 + b1) / 2, HW - 1, (b1 - b0) / 2, 7.2, ROW.MODERN, CREAM, 44, ROW.SHOP);
  g.color(0x2b2f31, 0); g.cbox(X(0, b0 - 0.02), 0.32, Z(0, b0 - 0.02), HW - 7, 2.9, 0.02, rot);
  g.color(CREAM, 0); for (let lx = -HW + 7; lx <= HW - 7; lx += 4.5) g.cbox(X(lx, b0 - 0.25), 0.32, Z(lx, b0 - 0.25), 0.3, 3.2, 0.3, rot);
  g.color(RED, 0); g.cbox(X(0, b0 - 0.12), 3.55, Z(0, b0 - 0.12), HW - 1, 0.35, 0.14, rot); g.cbox(X(0, b0 - 0.12), 7.05, Z(0, b0 - 0.12), HW - 1, 0.3, 0.14, rot);
  // Enquiry and booking windows at one end of the hall, benches along it.
  for (let i = 0; i < 4; i++) { g.color(0x1d2b33, 0); g.cbox(X(-HW + 2.4 + i * 1.6, b0 - 0.05), 1.1, Z(-HW + 2.4 + i * 1.6, b0 - 0.05), 0.55, 1.0, 0.04, rot); }
  g.color(0x6b4a2e, 0); for (let lx = -HW + 9; lx <= HW - 8; lx += 6) g.cbox(X(lx, b0 + 1.4), 0.32, Z(lx, b0 + 1.4), 1.4, 0.45, 0.3, rot);
  sign(ctx, p, X, Z, 0, b0 - 0.2, 10, 7.6, 8.9);
  // Boundary wall to the street, with entry and exit arches.
  const gates = [-HW * 0.62, HW * 0.62];
  g.setTint(CREAM, 0).setTile(TILE.COMPOUND[0], TILE.COMPOUND[1], 1, 1);
  let x0 = -HW;
  for (const gx of [...gates, HW + 4.5]) {
    const x1 = gx - 4.5;
    if (x1 > x0) { g.wall(X(x1, -HD), Z(x1, -HD), X(x0, -HD), Z(x0, -HD), 0, 1.5, 0, (x1 - x0) / FLOOR, 0.55, 1); g.wall(X(x0, -HD), Z(x0, -HD), X(x1, -HD), Z(x1, -HD), 0, 1.5, 0, (x1 - x0) / FLOOR, 0.55, 1); }
    x0 = gx + 4.5;
  }
  for (const gx of gates) {
    g.color(RED, 0); for (const side of [-1, 1]) g.cbox(X(gx + side * 4.6, -HD), 0, Z(gx + side * 4.6, -HD), 0.45, 5.6, 0.45, rot);
    g.color(CREAM, 0); g.cbox(X(gx, -HD), 5.6, Z(gx, -HD), 5.2, 1.1, 0.5, rot);
    g.color(RED, 0); g.cbox(X(gx, -HD - 0.02), 5.85, Z(gx, -HD - 0.02), 4.4, 0.6, 0.5, rot);
  }
  pool(pg, X(0, -2), Z(0, -2), 14); pool(pg, X(-HW / 2, 3), Z(-HW / 2, 3), 9); pool(pg, X(HW / 2, 3), Z(HW / 2, 3), 9);
}

/** The bays at the bus stand: buses nose in at 30 degrees to the platform. { lx, lz, dx, dz } in place coordinates. */
export function busBays(p) {
  const k = p.fit ?? 1, out = [];
  const a = -Math.PI / 6, dx = Math.sin(a), dz = Math.cos(a);
  for (let i = 0; i < 8; i++) out.push({ lx: (-19.5 + i * 5.6) * k, lz: -3.3, dx, dz });
  return out;
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
  g.gilt(GOLD); g.cyl(X(0, 4 * s), 1.2 + 18.8 * s, Z(0, 4 * s), 0.25, 1.4, 6, 0.06);
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
  const hw = 18, d0 = -8, d1 = 8, H = 9.5;
  // The hall: cream side and back walls, a full-height glass curtain wall to the street.
  texBox(g, X, Z, rot, 0, 0, 0, hw, H, d1, TILE.COMPOUND, 0xeceeeb, 3);
  g.color(0x2c3e4c, 0); g.cbox(X(0, d0 - 0.05), 0.15, Z(0, d0 - 0.05), hw - 0.4, H - 0.4, 0.05, rot);
  g.color(0xb9c0c4, 0);
  for (let lx = -hw + 1; lx <= hw - 1; lx += 2.2) g.cbox(X(lx, d0 - 0.12), 0.15, Z(lx, d0 - 0.12), 0.07, H - 0.4, 0.06, rot);
  for (const y of [3.4, 6.6]) g.cbox(X(0, d0 - 0.12), y, Z(0, d0 - 0.12), hw - 0.4, 0.12, 0.06, rot);
  g.color(0x1b262d, 0); for (const lx of [-7, -3.5, 3.5, 7]) g.cbox(X(lx, d0 - 0.15), 0.15, Z(lx, d0 - 0.15), 1.4, 2.8, 0.04, rot);
  // A great overhanging roof, slightly arched, on tree columns over the drop-off lane.
  g.color(0xd3d7d8, 0);
  const roofY = z => H + 0.9 + 1.4 * Math.cos(((z + 2) / 12) * (Math.PI / 2)) ** 2;
  for (let z = -15; z < 10; z += 2.5) {
    const a = g.v(X(-hw - 2, z), roofY(z), Z(-hw - 2, z)), b = g.v(X(hw + 2, z), roofY(z), Z(hw + 2, z));
    const c = g.v(X(hw + 2, z + 2.5), roofY(z + 2.5), Z(hw + 2, z + 2.5)), d = g.v(X(-hw - 2, z + 2.5), roofY(z + 2.5), Z(-hw - 2, z + 2.5));
    g.quad(a, b, c, d); g.quad(a, d, c, b);
  }
  g.color(0x8b9297, 0); g.cbox(X(0, -15.1), roofY(-15) - 0.6, Z(0, -15.1), hw + 2, 0.6, 0.12, rot);
  g.color(0xe6e9ea, 0);
  for (const lx of [-13, -4.5, 4.5, 13]) {
    g.cyl(X(lx, -13), 0, Z(lx, -13), 0.32, 7.2, 10, 0.26);
    for (const [ox, oz] of [[-1.6, -1.2], [1.6, -1.2], [-1.4, 1.4], [1.4, 1.4]]) g.beam(X(lx, -13), 7.2, Z(lx, -13), X(lx + ox, -13 + oz), roofY(-13 + oz) - 0.05, Z(lx + ox, -13 + oz), 0.1);
  }
  sign(ctx, p, X, Z, 0, -15.25, 12, roofY(-15) - 0.55, roofY(-15) + 0.75);
  // Flags in front: the tricolour.
  for (const lx of [-11, 0, 11]) {
    g.color(0xd9d9d6, 0); g.cyl(X(lx, -19), 0, Z(lx, -19), 0.07, 9, 6);
    const band = (y0, color) => { g.color(color, 0); const a = g.v(X(lx, -19), y0, Z(lx, -19)), b = g.v(X(lx + 2.4, -19), y0, Z(lx + 2.4, -19)), c = g.v(X(lx + 2.4, -19), y0 + 0.5, Z(lx + 2.4, -19)), d = g.v(X(lx, -19), y0 + 0.5, Z(lx, -19)); g.quad(a, b, c, d); g.quad(a, d, c, b); };
    band(8.5, 0xff9933); band(8.0, 0xf6f6f2); band(7.5, 0x138808);
    g.color(0x000080, 0); g.blob(X(lx + 1.2, -19.02), 8.25, Z(lx + 1.2, -19.02), 0.16, 0.16, 0.04, 2);
  }
  // Air traffic control tower on the airside.
  const tx = hw + 9, tz = 6;
  g.color(0xf0eee8, 0); g.cbox(X(tx, tz), 0, Z(tx, tz), 1.7, 20, 1.7, rot);
  g.color(0xd5d2c8, 0); g.cyl(X(tx, tz), 20, Z(tx, tz), 3.4, 0.6, 8);
  g.color(0x24323c, 0); g.cyl(X(tx, tz), 20.6, Z(tx, tz), 3.3, 3.0, 8, 3.7);
  g.color(0xe8e6de, 0); g.cyl(X(tx, tz), 23.6, Z(tx, tz), 3.9, 0.5, 8);
  g.color(0x5f6668, 0); g.beam(X(tx, tz), 24.1, Z(tx, tz), X(tx, tz), 27.5, Z(tx, tz), 0.06); g.beam(X(tx + 1.4, tz), 24.1, Z(tx + 1.4, tz), X(tx + 1.4, tz), 26, Z(tx + 1.4, tz), 0.05);
  // An airliner waits on the apron, across the concrete from the terminal's airside doors.
  if (p.plane) {
    const { x, z, heading } = p.plane, len = Math.hypot(p.x - x, p.z - z);
    g.color(0xa9a69c, 0);
    const ux = (p.x - x) / len, uz = (p.z - z) / len, w = 26;
    const a = g.v(x - uz * w, 0.082, z + ux * w), b = g.v(x + uz * w, 0.082, z - ux * w);
    const c = g.v(p.x + uz * w, 0.082, p.z - ux * w), d = g.v(p.x - uz * w, 0.082, p.z + ux * w);
    g.quad(a, b, c, d); g.quad(a, d, c, b);
    aircraft(g, x, z, heading);
  }
  pool(pg, X(0, -13), Z(0, -13), 14); pool(pg, X(0, 12), Z(0, 12), 10);
}

/**
 * A twin turboprop regional airliner (ATR 72 class, 27 m long, 27 m span) at (x, z) facing
 * heading: white with an orange tail and cheatline, high wing, T-tail. Fictional livery.
 */
function aircraft(g, x, z, heading) {
  const fx = Math.sin(heading), fz = Math.cos(heading), rx = -fz, rz = fx; // forward, right
  const P = (s, u, y) => [x + fx * s + rx * u, y, z + fz * s + rz * u];
  const WHITE = 0xf3f3f1, BELLY = 0xc6c9cb, TAIL = 0xe8702a;
  // Fuselage: rings along s with radius r around (centre line height y).
  tube(g, P, [[13.6, 0.12, 2.75], [13.1, 0.62, 2.7], [12.2, 1.05, 2.66], [11, 1.26, 2.62], [9.5, 1.3, 2.6], [-6.5, 1.3, 2.6], [-9.5, 1.05, 2.85], [-12, 0.62, 3.25], [-13.6, 0.2, 3.6]], WHITE, 14);
  // Cheatline and windows down both sides, cockpit glazing.
  for (const side of [-1, 1]) {
    g.color(TAIL, 0); band3(g, P(-8, side * 1.31, 2.2), P(10.5, side * 1.31, 2.2), 0.16, heading);
    g.color(0x1f2a33, 0);
    for (let s = -7.4; s < 9.2; s += 0.76) { const [wx, wy, wz] = P(s, side * 1.315, 2.95); g.cbox(wx, wy - 0.17, wz, 0.02, 0.34, 0.16, heading); }
    const [cx, cy, cz] = P(12.15, side * 0.62, 3.35); g.cbox(cx, cy, cz, 0.25, 0.32, 0.4, heading + side * 0.7);
  }
  // High wing on top of the fuselage, a nacelle and six-bladed propeller under each side.
  g.color(WHITE, 0);
  for (const side of [-1, 1]) {
    const [wx, , wz] = P(1.0, side * 7.2, 0); g.cbox(wx, 3.9, wz, 6.6, 0.32, 1.25, heading);
    tube(g, (s, u, y) => P(s, side * 4.1 + u, y), [[4.6, 0.12, 3.45], [4.1, 0.48, 3.45], [2.5, 0.58, 3.5], [-1.2, 0.5, 3.55], [-2.6, 0.18, 3.6]], WHITE, 10);
    g.color(0x2a2a2a, 0);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.3, [bx, by, bz] = P(4.7, side * 4.1 + Math.cos(a) * 1.95, 3.45 + Math.sin(a) * 1.95), [ox, oy, oz] = P(4.7, side * 4.1, 3.45);
      g.beam(ox, oy, oz, bx, by, bz, 0.09);
    }
    const [px, , pz] = P(-0.4, side * 1.45, 0);
    g.color(BELLY, 0); g.blob(px, 1.55, pz, 0.6, 0.45, 1.6, side + 4); // main gear sponson
    g.color(0x1a1a1a, 0); const [mx, , mz] = P(-0.4, side * 1.75, 0); g.cbox(mx, 0, mz, 0.3, 0.9, 0.45, heading);
  }
  // Fin and T-tail.
  g.color(TAIL, 0);
  const fin = [P(-9.2, 0, 3.7), P(-13.3, 0, 3.7), P(-13.7, 0, 7.6), P(-11.8, 0, 7.6)].map(([a, b, c]) => g.v(a, b, c));
  g.quad(fin[0], fin[1], fin[2], fin[3]); g.quad(fin[0], fin[3], fin[2], fin[1]);
  g.color(WHITE, 0); const [sx, , sz] = P(-12.9, 0, 0); g.cbox(sx, 7.55, sz, 3.65, 0.16, 0.9, heading);
  // Nose gear.
  g.color(0x1a1a1a, 0); const [nx, , nz] = P(11.2, 0, 0); g.cbox(nx, 0, nz, 0.2, 1.4, 0.3, heading);
}

/** A tube along an aircraft's axis: stations [s, r, y]; P(s, u, y) maps aircraft coordinates to world [x, y, z]. */
function tube(g, P, stations, color, sides = 12) {
  g.color(color, 0);
  const rings = stations.map(([s, r, y]) => {
    const out = [];
    for (let k = 0; k < sides; k++) { const a = (k / sides) * Math.PI * 2; out.push(g.v(...P(s, Math.cos(a) * r, y + Math.sin(a) * r))); }
    return out;
  });
  for (let i = 0; i + 1 < rings.length; i++) {
    for (let k = 0; k < sides; k++) {
      const j = (k + 1) % sides;
      // Rings run nose-first, so this order faces outward.
      g.quad(rings[i][k], rings[i][j], rings[i + 1][j], rings[i + 1][k]);
    }
  }
}

/** A thin stripe along the fuselage between two points (both faces). */
function band3(g, a, b, h, heading) {
  const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
  g.cbox((a[0] + b[0]) / 2, a[1] - h / 2, (a[2] + b[2]) / 2, 0.02, h, len / 2, heading);
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
    g.color(0x5c4a3a, 0); g.cyl(x, 0, z, 0.18, 2.6, 7, 0.12);
    if (ctx.fg) ctx.fg.crown(x, 3.9, z, 2.0, 1.4, 2.0, 22, 1.8, r.pick([LEAF.NEEM, LEAF.GULMOHAR, LEAF.BUSH]), 0xffffff, hash2(k, Math.round(p.x)), 0.4);
    else { g.color(r.pick([0x4f7a3a, 0x5d8a44, 0xd9482b]), 0); g.blob(x, 3.6, z, 1.8, 1.4, 1.8, k); }
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
  const BRONZE = 0x4c4637, GRANITE = 0x5d5a55, PALE = 0xe8e2d4;
  // A round garden island with a low railing, flowers round the foot of the pedestal.
  g.color(0xd8d0bc, 0); g.cyl(p.x, 0, p.z, 4.3, 0.35, 24);
  g.color(0x6f9e4c, 0); g.cyl(p.x, 0.35, p.z, 3.9, 0.05, 24);
  for (let k = 0; k < 18; k++) {
    const a = (k / 18) * Math.PI * 2;
    g.color(k % 3 ? 0xff9b1a : 0xf5d33b, 0); g.blob(p.x + Math.cos(a) * 3.3, 0.5, p.z + Math.sin(a) * 3.3, 0.35, 0.22, 0.35, k);
  }
  g.color(0x2b2b2b, 0);
  for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; g.cyl(p.x + Math.cos(a) * 4.15, 0.35, p.z + Math.sin(a) * 4.15, 0.03, 0.9, 4); }
  for (const y of [0.75, 1.2]) { for (let k = 0; k < 24; k++) { const a0 = (k / 24) * Math.PI * 2, a1 = ((k + 1) / 24) * Math.PI * 2; g.beam(p.x + Math.cos(a0) * 4.15, y, p.z + Math.sin(a0) * 4.15, p.x + Math.cos(a1) * 4.15, y, p.z + Math.sin(a1) * 4.15, 0.025); } }
  // Stepped pedestal: granite tiers, a gilded inscription band, a garland of marigolds.
  g.color(GRANITE, 0); g.cbox(p.x, 0.35, p.z, 2.2, 0.5, 2.2, rot);
  g.color(0x6b6862, 0); g.cbox(p.x, 0.85, p.z, 1.8, 0.45, 1.8, rot);
  g.color(GRANITE, 0); g.cbox(p.x, 1.3, p.z, 1.45, 3.2, 1.45, rot);
  g.gilt(GOLD); for (const lz of [-1.47, 1.47]) g.cbox(X(0, lz), 2.6, Z(0, lz), 1.1, 0.5, 0.03, rot);
  g.color(0x7a756c, 0); g.cbox(p.x, 4.5, p.z, 1.7, 0.35, 1.7, rot);
  g.color(0xff8c1a, 0);
  for (let k = 0; k < 4; k++) { const F = frame(p, rot + (k * Math.PI) / 2); g.beam(F.X(-1.4, -1.5), 4.4, F.Z(-1.4, -1.5), F.X(0, -1.55), 3.9, F.Z(0, -1.55), 0.09); g.beam(F.X(0, -1.55), 3.9, F.Z(0, -1.55), F.X(1.4, -1.5), 4.4, F.Z(1.4, -1.5), 0.09); }
  const top = 4.85;
  if (kind === 'horse') {
    // A rearing horse, its hind legs planted, Maharaj in the saddle with his sword raised.
    g.color(BRONZE, 0);
    const Y = top;
    g.blob(X(0, 0.3), Y + 2.3, Z(0, 0.3), 0.72, 0.78, 1.55, 1); // barrel
    g.blob(X(0, -1.0), Y + 2.85, Z(0, -1.0), 0.66, 0.8, 0.75, 2); // chest, rising
    g.beam(X(0, -1.3), Y + 3.2, Z(0, -1.3), X(0, -1.9), Y + 4.3, Z(0, -1.9), 0.36); // neck
    g.blob(X(0, -2.15), Y + 4.45, Z(0, -2.15), 0.26, 0.3, 0.55, 3); // head
    g.blob(X(0, -2.6), Y + 4.25, Z(0, -2.6), 0.17, 0.19, 0.25, 4); // muzzle
    for (const ex of [-0.11, 0.11]) g.beam(X(ex, -2.0), Y + 4.7, Z(ex, -2.0), X(ex, -1.95), Y + 5.0, Z(ex, -1.95), 0.04); // ears
    g.beam(X(0, -1.3), Y + 3.75, Z(0, -1.3), X(0, -1.95), Y + 4.75, Z(0, -1.95), 0.12); // mane
    // Hind legs planted on the plinth, forelegs pawing the air.
    for (const lx of [-0.34, 0.34]) {
      g.beam(X(lx, 1.3), Y + 2.0, Z(lx, 1.3), X(lx, 1.6), Y + 1.0, Z(lx, 1.6), 0.17);
      g.beam(X(lx, 1.6), Y + 1.0, Z(lx, 1.6), X(lx, 1.2), Y + 0.08, Z(lx, 1.2), 0.11);
      g.beam(X(lx, -1.0), Y + 2.6, Z(lx, -1.0), X(lx, -1.75), Y + 2.5, Z(lx, -1.75), 0.15);
      g.beam(X(lx, -1.75), Y + 2.5, Z(lx, -1.75), X(lx, -1.85), Y + 1.75, Z(lx, -1.85), 0.1);
    }
    g.beam(X(0, 1.7), Y + 2.6, Z(0, 1.7), X(0, 2.4), Y + 0.9, Z(0, 2.4), 0.13); // tail, sweeping to the plinth
    g.color(0x8a2a1e, 0); g.blob(X(0, 0.2), Y + 2.95, Z(0, 0.2), 0.8, 0.12, 0.7, 5); // saddle cloth
    // The rider: legs in the stirrups, torso, shela over the shoulders, beard and pagdi.
    g.color(BRONZE, 0);
    for (const lx of [-0.55, 0.55]) { g.beam(X(lx * 0.7, 0.1), Y + 3.15, Z(lx * 0.7, 0.1), X(lx, -0.35), Y + 2.6, Z(lx, -0.35), 0.13); g.beam(X(lx, -0.35), Y + 2.6, Z(lx, -0.35), X(lx, 0.0), Y + 1.95, Z(lx, 0.0), 0.1); }
    g.blob(X(0, 0.15), Y + 3.75, Z(0, 0.15), 0.38, 0.62, 0.3, 6);
    g.blob(X(0, 0.35), Y + 3.9, Z(0, 0.35), 0.48, 0.5, 0.2, 7); // shela flowing behind
    g.blob(X(0, 0.05), Y + 4.55, Z(0, 0.05), 0.2, 0.24, 0.21, 8); // head
    g.blob(X(0, -0.08), Y + 4.38, Z(0, -0.08), 0.15, 0.14, 0.12, 9); // beard
    g.blob(X(0, 0.05), Y + 4.82, Z(0, 0.05), 0.26, 0.17, 0.26, 10); // pagdi
    g.beam(X(0, 0.05), Y + 4.95, Z(0, 0.05), X(0, 0.2), Y + 5.2, Z(0, 0.2), 0.06); // its turra
    // Right arm raised with the sword; left on the reins.
    g.beam(X(0.36, 0.05), Y + 4.15, Z(0.36, 0.05), X(0.55, -0.1), Y + 4.8, Z(0.55, -0.1), 0.09);
    g.beam(X(0.55, -0.1), Y + 4.8, Z(0.55, -0.1), X(0.6, -0.35), Y + 5.35, Z(0.6, -0.35), 0.08);
    g.gilt(0xc8c8c0); g.beam(X(0.6, -0.35), Y + 5.35, Z(0.6, -0.35), X(0.75, -1.2), Y + 6.5, Z(0.75, -1.2), 0.035);
    g.color(BRONZE, 0); g.beam(X(-0.34, 0.05), Y + 4.1, Z(-0.34, 0.05), X(-0.3, -0.75), Y + 3.6, Z(-0.3, -0.75), 0.08);
    // Bhagwa flag beside the island.
    g.color(0xd9d9d6, 0); g.cyl(X(3.1, 2.4), 0.35, Z(3.1, 2.4), 0.05, 7.5, 5);
    g.color(SAFFRON, 0);
    const fa = g.v(X(3.1, 2.4), 7.8, Z(3.1, 2.4)), fb = g.v(X(4.9, 2.4), 7.0, Z(4.9, 2.4)), fc = g.v(X(3.1, 2.4), 6.2, Z(3.1, 2.4));
    g.tri(fa, fb, fc); g.tri(fa, fc, fb);
  } else {
    // A standing figure: dhoti or coat, a shawl, one arm raised or pointing the way.
    g.color(BRONZE, 0);
    g.beam(X(-0.15, 0), top, Z(-0.15, 0), X(-0.15, 0), top + 1.0, Z(-0.15, 0), 0.13); g.beam(X(0.15, 0), top, Z(0.15, 0), X(0.15, 0), top + 1.0, Z(0.15, 0), 0.13);
    g.blob(p.x, top + 1.55, p.z, 0.42, 0.75, 0.3, 5);
    g.blob(p.x, top + 2.55, p.z, 0.22, 0.27, 0.22, 6);
    g.beam(X(-0.4, 0), top + 2.0, Z(-0.4, 0), X(-0.45, -0.25), top + 1.3, Z(-0.45, -0.25), 0.07);
    if (kind === 'pointing') g.beam(X(0.38, 0), top + 2.1, Z(0.38, 0), X(0.55, -0.95), top + 2.75, Z(0.55, -0.95), 0.07);
    else { g.beam(X(0.38, 0), top + 2.0, Z(0.38, 0), X(0.5, -0.4), top + 1.3, Z(0.5, -0.4), 0.06); g.color(0x3d2b1f, 0); g.beam(X(0.5, -0.4), top + 1.3, Z(0.5, -0.4), X(0.55, -0.55), top, Z(0.55, -0.55), 0.03); }
  }
  // Floodlights at night.
  pool(pg, p.x, p.z, 7, 0);
  for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + 0.785; pool(pg, p.x + Math.cos(a) * 3.6, p.z + Math.sin(a) * 3.6, 2.5, 0.6); }
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
    g.gilt(GOLD); onionDome(g, X(0, 0), 8.7, Z(0, 0), 1.2);
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
