// Builds and streams the city around the player, one 192 m chunk at a time.
// Each chunk becomes: one city mesh (everything opaque), one signboard mesh,
// one additive light-pool mesh for the night and one line mesh for the wires.
import * as THREE from 'three';
import { Geo } from './geo.js';
import { CHUNK, STYLE, PROP, ZONE } from './citygen.js';
import { ROW, TILE, SIGN_COLS } from './atlas.js';
import { rng, hash2, clamp, hashFloat } from '../core/math.js';
import { buildPlace } from './landmarks.js';

const FLOOR = 3.2;
const ROAD_Y = [0.07, 0.068, 0.066, 0.064, 0.062, 0.06];
const PAD_Y = 0.074;
const WALK_Y = 0.2;

export class ChunkManager {
  constructor(scene, city, materials, signSlots) {
    this.scene = scene;
    this.city = city;
    this.net = city.net;
    this.mat = materials;
    this.signSlots = signSlots;
    this.chunks = new Map();
    this.queue = [];
    this.radius = 520;
    this.group = new THREE.Group();
    this.group.name = 'city-chunks';
    scene.add(this.group);
    this.stats = { built: 0, triangles: 0, ms: 0 };
  }

  setRadius(r) { this.radius = r; }

  /** Queue chunks near (x, z); build some within the time budget; drop far ones. */
  update(x, z, budgetMs = 5) {
    const r = this.radius, C = CHUNK;
    const cx0 = Math.floor((x - r) / C), cx1 = Math.floor((x + r) / C);
    const cz0 = Math.floor((z - r) / C), cz1 = Math.floor((z + r) / C);
    const want = [];
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const mx = (cx + 0.5) * C, mz = (cz + 0.5) * C;
        const d = Math.hypot(mx - x, mz - z) - C * 0.7;
        if (d > r) continue;
        const key = `${cx},${cz}`;
        if (!this.chunks.has(key)) want.push({ key, cx, cz, d });
      }
    }
    want.sort((a, b) => a.d - b.d);
    const t0 = performance.now();
    for (const w of want) {
      if (performance.now() - t0 > budgetMs && this.chunks.size > 0) break;
      this._build(w.key, w.cx, w.cz);
    }
    // Drop chunks well outside the radius.
    for (const [key, ch] of this.chunks) {
      const d = Math.hypot((ch.cx + 0.5) * C - x, (ch.cz + 0.5) * C - z) - C * 0.7;
      if (d > r + C * 1.2) this._dispose(key, ch);
    }
    return want.length;
  }

  /** Build everything within `radius` immediately (loading screen). */
  prime(x, z, radius, onProgress) {
    const C = CHUNK, list = [];
    for (let cx = Math.floor((x - radius) / C); cx <= Math.floor((x + radius) / C); cx++) {
      for (let cz = Math.floor((z - radius) / C); cz <= Math.floor((z + radius) / C); cz++) {
        if (Math.hypot((cx + 0.5) * C - x, (cz + 0.5) * C - z) - C * 0.7 <= radius) list.push([cx, cz]);
      }
    }
    list.forEach(([cx, cz], i) => { const key = `${cx},${cz}`; if (!this.chunks.has(key)) this._build(key, cx, cz); onProgress?.((i + 1) / list.length); });
  }

  _dispose(key, ch) {
    for (const m of ch.meshes) { m.geometry.dispose(); this.group.remove(m); }
    this.chunks.delete(key);
  }

  setNight(n) {
    this.mat.pools.opacity = clamp(n * 1.1, 0, 0.9);
    for (const ch of this.chunks.values()) if (ch.pools) ch.pools.visible = n > 0.02;
  }

  _build(key, cx, cz) {
    const t0 = performance.now();
    const g = new Geo(16384), sg = new Geo(512), pg = new Geo(512);
    const wires = [];
    const ctx = { g, sg, pg, wires, city: this.city, net: this.net, signSlots: this.signSlots, cx, cz };
    const data = this.city.chunk(cx, cz);
    buildGround(ctx);
    if (data) {
      buildRoads(ctx, data);
      for (const i of data.lots) buildLot(ctx, i);
      for (const i of data.trees) buildTree(ctx, i);
      for (const i of data.props) buildProp(ctx, i);
      for (const i of data.places) buildPlace(ctx, this.city.places[i], i);
    }
    const meshes = [];
    const city = new THREE.Mesh(g.build(), this.mat.city);
    city.castShadow = true; city.receiveShadow = true;
    city.matrixAutoUpdate = false;
    meshes.push(city);
    if (!sg.empty) { const m = new THREE.Mesh(sg.build(), this.mat.signs); m.receiveShadow = true; m.matrixAutoUpdate = false; meshes.push(m); }
    let pools = null;
    if (!pg.empty) { pools = new THREE.Mesh(pg.build(), this.mat.pools); pools.matrixAutoUpdate = false; pools.renderOrder = 2; pools.visible = this.mat.pools.opacity > 0.02; meshes.push(pools); }
    if (wires.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(wires, 3));
      const l = new THREE.LineSegments(geo, this.mat.wires); l.matrixAutoUpdate = false; meshes.push(l);
    }
    for (const m of meshes) { m.updateMatrix(); this.group.add(m); }
    this.chunks.set(key, { cx, cz, meshes, pools });
    const ms = performance.now() - t0;
    this.stats.built++; this.stats.ms += ms;
  }
}

// ------------------------------------------------------------------ ground
const GROUND_CELL = 6;
function groundTint(city, x, z) {
  const dens = city.densityAt(x, z);
  const h = hashFloat((Math.floor(x / 23) * 73856093) ^ (Math.floor(z / 23) * 19349663));
  const h2 = hashFloat((Math.floor(x / 9) * 83492791) ^ (Math.floor(z / 9) * 2654435761));
  let r, g, b;
  if (dens > 0.35) { r = 0.9; g = 0.82; b = 0.68; } // town dust
  else if (dens > 0.12) { r = 0.8; g = 0.76; b = 0.56; } // dry suburban scrub
  else if (h < 0.45) { r = 0.42; g = 0.35; b = 0.29; } // regur black soil
  else if (h < 0.75) { r = 0.56; g = 0.64; b = 0.36; } // standing crops
  else { r = 0.78; g = 0.72; b = 0.48; } // dry grass
  const rd = city.riverDistance(x, z, groundTint._rd || (groundTint._rd = {}));
  if (rd.d < 40) { const t = 1 - rd.d / 40; r = r * (1 - t) + 0.5 * t; g = g * (1 - t) + 0.6 * t; b = b * (1 - t) + 0.38 * t; }
  if (rd.d < 4) { r = 0.46; g = 0.42; b = 0.34; }
  const j = 0.92 + h2 * 0.16;
  return ((clamp(r * j, 0, 1) * 255) << 16) | ((clamp(g * j, 0, 1) * 255) << 8) | (clamp(b * j, 0, 1) * 255);
}

function buildGround(ctx) {
  const { g, city, cx, cz } = ctx;
  const x0 = cx * CHUNK, z0 = cz * CHUNK, n = CHUNK / GROUND_CELL;
  // Only cut the river valley where it actually runs.
  const nearRiver = city.riverDistance(x0 + CHUNK / 2, z0 + CHUNK / 2, {}).d < CHUNK;
  g.setTile(TILE.DIRT[0], TILE.DIRT[1], 1, 4);
  const base = g.n;
  for (let iz = 0; iz <= n; iz++) {
    for (let ix = 0; ix <= n; ix++) {
      const x = x0 + ix * GROUND_CELL, z = z0 + iz * GROUND_CELL;
      g.setTint(groundTint(city, x, z), 0);
      g.v(x, nearRiver ? city.groundHeight(x, z) : 0, z);
    }
  }
  const row = n + 1;
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const a = base + iz * row + ix;
      // Up-facing: (a, a+row, a+row+1, a+1).
      g.quad(a, a + row, a + row + 1, a + 1);
    }
  }
}

// ------------------------------------------------------------------ roads
function roadTile(city, net, road) {
  const type = net.type[road], w = net.width[road];
  const p = net.pointAt(road, net.length[road] / 2, roadTile._p || (roadTile._p = {}));
  const zone = city.zoneAt(p.x, p.z);
  if (w <= 5) return (hash2(road, 3) & 3) !== 0 && zone !== ZONE.RURAL ? TILE.CONCRETE_ROAD : TILE.ASPHALT;
  if (type >= 4) return zone === ZONE.RURAL ? TILE.ASPHALT : TILE.ASPHALT_DASH;
  if (w >= 9) return TILE.ASPHALT_MAIN;
  return TILE.ASPHALT_DASH;
}

function buildRoads(ctx, data) {
  const { g, city, net } = ctx;
  const p = {}, q = {};
  if (data.segs) {
    for (const i of data.segs) {
      const road = net.ptRoad[i];
      const w = net.width[road], hw = w / 2;
      const len = net.length[road];
      const s0 = Math.max(net.cum[i], net.trimStart(road)), s1 = Math.min(net.cum[i + 1], len - net.trimEnd(road));
      if (s1 - s0 < 0.05) continue;
      const tile = roadTile(city, net, road);
      const y = ROAD_Y[net.type[road]] ?? 0.06;
      // Mitred offsets at interior vertices keep curves seamless.
      const start = net.ptStart[road], end = net.ptStart[road + 1] - 1;
      const off0 = offsetAt(net, road, i, s0 > net.cum[i] + 1e-3, start, end, s0, p);
      const off1 = offsetAt(net, road, i + 1, s1 < net.cum[i + 1] - 1e-3, start, end, s1, q);
      g.setTint(0xffffff, road & 255).setTile(tile[0], tile[1], 1, 3);
      const a = g.v(p.x + off0.nx * hw, y, p.z + off0.nz * hw, 0, s0 / FLOOR);
      const b = g.v(p.x - off0.nx * hw, y, p.z - off0.nz * hw, 1, s0 / FLOOR);
      const c = g.v(q.x - off1.nx * hw, y, q.z - off1.nz * hw, 1, s1 / FLOOR);
      const d = g.v(q.x + off1.nx * hw, y, q.z + off1.nz * hw, 0, s1 / FLOOR);
      // a,b at s0 (left, right), c,d at s1 (right, left): this order faces up.
      g.quad(a, b, c, d);
      if (net.bridge[road]) buildBridgeSpan(ctx, p, q, off0, off1, hw);
      else if (w >= 8 && city.densityAt(p.x, p.z) > 0.2) buildFootpaths(ctx, p, q, off0, off1, hw);
      if (w >= 11.5 && !net.bridge[road]) buildMedian(ctx, p, q, off0, off1);
      // Zebra crossing just before a big junction.
      if (w >= 8 && s1 >= len - net.trimEnd(road) - 0.01 && net.jRoads[net.rb[road]].length >= 3 && s1 - s0 > 4) zebra(ctx, q, off1, hw, -1, s1);
      if (w >= 8 && s0 <= net.trimStart(road) + 0.01 && net.jRoads[net.ra[road]].length >= 3 && s1 - s0 > 4) zebra(ctx, p, off0, hw, 1, s0);
    }
  }
  if (data.junctions) for (const j of data.junctions) buildJunction(ctx, j);
}

/** Offset direction (unit left normal, scaled for the mitre) at polyline vertex k. */
function offsetAt(net, road, k, clipped, start, end, s, out) {
  net.pointAt(road, s, out);
  let nx = out.dz, nz = -out.dx;
  if (!clipped && k > start && k < end) {
    const ax = net.px[k] - net.px[k - 1], az = net.pz[k] - net.pz[k - 1];
    const bx = net.px[k + 1] - net.px[k], bz = net.pz[k + 1] - net.pz[k];
    const la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1;
    const n1x = az / la, n1z = -ax / la, n2x = bz / lb, n2z = -bx / lb;
    let mx = n1x + n2x, mz = n1z + n2z;
    const ml = Math.hypot(mx, mz);
    if (ml > 1e-3) {
      mx /= ml; mz /= ml;
      const cos = mx * n1x + mz * n1z;
      const scale = 1 / Math.max(cos, 0.5);
      nx = mx * scale; nz = mz * scale;
    }
    out.x = net.px[k]; out.z = net.pz[k];
  }
  return { nx, nz };
}

function zebra(ctx, p, off, hw, dir, s) {
  const { g } = ctx;
  // A 3 m band across the road, set back from the junction edge.
  const fx = -off.nz, fz = off.nx; // forward along the road (right of the left normal is forward? left=(fz,-fx) => f=(-nz, nx))
  const l = Math.hypot(fx, fz) || 1;
  const ux = (fx / l) * dir, uz = (fz / l) * dir;
  const nx = off.nx / Math.hypot(off.nx, off.nz), nz = off.nz / Math.hypot(off.nx, off.nz);
  const back = 0.8, depth = 3;
  const ax = p.x + ux * back, az = p.z + uz * back;
  const bx = ax + ux * depth, bz = az + uz * depth;
  g.setTint(0xffffff, 0).setTile(TILE.ZEBRA[0], TILE.ZEBRA[1], 1, 2);
  const y = PAD_Y + 0.004;
  const w = hw * 0.96;
  const v0 = g.v(ax + nx * w, y, az + nz * w, 0, 0), v1 = g.v(ax - nx * w, y, az - nz * w, 1, 0);
  const v2 = g.v(bx - nx * w, y, bz - nz * w, 1, 1), v3 = g.v(bx + nx * w, y, bz + nz * w, 0, 1);
  // Facing up regardless of dir.
  if (dir > 0) g.quad(v0, v1, v2, v3); else g.quad(v0, v3, v2, v1);
}

function buildFootpaths(ctx, p, q, o0, o1, hw) {
  const { g } = ctx;
  const width = 1.9;
  for (const side of [1, -1]) {
    const i0 = hw * side, i1 = (hw + width) * side;
    const ax = p.x + o0.nx * i0, az = p.z + o0.nz * i0, bx = q.x + o1.nx * i0, bz = q.z + o1.nz * i0;
    const cx = q.x + o1.nx * i1, cz = q.z + o1.nz * i1, dx = p.x + o0.nx * i1, dz = p.z + o0.nz * i1;
    const len = Math.hypot(bx - ax, bz - az);
    // Paver top.
    g.setTint(0xffffff, 0).setTile(TILE.PAVERS[0], TILE.PAVERS[1], 1, 4);
    const a = g.v(ax, WALK_Y, az), b = g.v(bx, WALK_Y, bz), c = g.v(cx, WALK_Y, cz), d = g.v(dx, WALK_Y, dz);
    if (side > 0) g.quad(a, b, c, d); else g.quad(a, d, c, b);
    // Kerb face, painted black and yellow, facing the road.
    g.setTile(TILE.KERB[0], TILE.KERB[1], 1, 1);
    if (side > 0) g.wall(ax, az, bx, bz, 0.02, WALK_Y, 0, len / 2.4, 0, 0.3);
    else g.wall(bx, bz, ax, az, 0.02, WALK_Y, 0, len / 2.4, 0, 0.3);
  }
}

function buildMedian(ctx, p, q, o0, o1) {
  const { g } = ctx;
  const hw = 0.35, h = 0.32;
  const ax = p.x + o0.nx * hw, az = p.z + o0.nz * hw, bx = q.x + o1.nx * hw, bz = q.z + o1.nz * hw;
  const cx = q.x - o1.nx * hw, cz = q.z - o1.nz * hw, dx = p.x - o0.nx * hw, dz = p.z - o0.nz * hw;
  const len = Math.hypot(bx - ax, bz - az);
  g.setTint(0xffffff, 0).setTile(TILE.KERB[0], TILE.KERB[1], 1, 1);
  g.wall(bx, bz, ax, az, 0.03, h, 0, len / 2.4, 0, 0.3);
  g.wall(dx, dz, cx, cz, 0.03, h, 0, len / 2.4, 0, 0.3);
  g.color(0x8c9a5a, 0);
  const a = g.v(ax, h, az), b = g.v(bx, h, bz), c = g.v(cx, h, cz), d = g.v(dx, h, dz);
  g.quad(a, d, c, b);
}

function buildBridgeSpan(ctx, p, q, o0, o1, hw) {
  const { g, city } = ctx;
  const ax = p.x, az = p.z, bx = q.x, bz = q.z;
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 0.1) return;
  const nx0 = o0.nx, nz0 = o0.nz, nx1 = o1.nx, nz1 = o1.nz;
  // Deck sides and underside.
  g.color(0xb9b3a6, 0);
  for (const side of [1, -1]) {
    const e = hw + 0.35;
    const x0 = ax + nx0 * e * side, z0 = az + nz0 * e * side, x1 = bx + nx1 * e * side, z1 = bz + nz1 * e * side;
    if (side > 0) g.wall(x1, z1, x0, z0, -1.1, 1.0, 0, 1, 0, 1); else g.wall(x0, z0, x1, z1, -1.1, 1.0, 0, 1, 0, 1);
    // Parapet top cap and inner face.
    const ie = hw + 0.05;
    const ix0 = ax + nx0 * ie * side, iz0 = az + nz0 * ie * side, ix1 = bx + nx1 * ie * side, iz1 = bz + nz1 * ie * side;
    if (side > 0) g.wall(ix0, iz0, ix1, iz1, 0.05, 1.0, 0, 1, 0, 1); else g.wall(ix1, iz1, ix0, iz0, 0.05, 1.0, 0, 1, 0, 1);
    g.color(0xd8d2c4, 0);
    const a = g.v(ix0, 1.0, iz0), b = g.v(ix1, 1.0, iz1), c = g.v(x1, 1.0, z1), d = g.v(x0, 1.0, z0);
    if (side > 0) g.quad(a, b, c, d); else g.quad(a, d, c, b);
    g.color(0xb9b3a6, 0);
  }
  // Underside slab (facing down) so the bridge reads from the ghats.
  const e = hw + 0.35;
  const a = g.v(ax + nx0 * e, -1.1, az + nz0 * e), b = g.v(bx + nx1 * e, -1.1, bz + nz1 * e);
  const c = g.v(bx - nx1 * e, -1.1, bz - nz1 * e), d = g.v(ax - nx0 * e, -1.1, az - nz0 * e);
  g.quad(a, b, c, d);
  // Piers every ~18 m where the riverbed is below.
  const steps = Math.floor(len / 18);
  for (let k = 0; k <= steps; k++) {
    const t = steps ? k / steps : 0.5;
    const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    const gh = city.groundHeight(x, z);
    if (gh > -0.8) continue;
    g.color(0xa39d90, 0);
    g.cbox(x, gh - 1.5, z, hw * 0.75, -1.1 - gh + 1.5, 0.9, Math.atan2(bx - ax, bz - az) + Math.PI / 2);
  }
}

function buildJunction(ctx, j) {
  const { g, net } = ctx;
  const roads = net.jRoads[j];
  if (roads.length < 3) return;
  const jx = net.jx[j], jz = net.jz[j];
  const pts = [];
  const p = {};
  for (const r of roads) {
    const atA = net.ra[r] === j;
    const s = atA ? net.trimStart(r) : net.length[r] - net.trimEnd(r);
    net.pointAt(r, s, p);
    const hw = net.width[r] / 2 + 0.15;
    const nx = p.dz, nz = -p.dx;
    pts.push([p.x + nx * hw, p.z + nz * hw], [p.x - nx * hw, p.z - nz * hw]);
    if (net.ra[r] === j && net.rb[r] === j) break;
  }
  pts.sort((a, b) => Math.atan2(a[1] - jz, a[0] - jx) - Math.atan2(b[1] - jz, b[0] - jx));
  g.setTint(0xffffff, 0).setTile(TILE.ASPHALT[0], TILE.ASPHALT[1], 1, 4);
  const c = g.v(jx, PAD_Y, jz);
  const ids = pts.map(([x, z]) => g.v(x, PAD_Y, z));
  for (let i = 0; i < ids.length; i++) {
    const a = ids[i], b = ids[(i + 1) % ids.length];
    // Sorted by increasing atan2(z, x): counter-clockwise in x-z, which faces down; flip.
    g.tri(c, b, a);
  }
}

// ------------------------------------------------------------------ buildings
const RES_ROWS = { [STYLE.HOUSE]: ROW.RES, [STYLE.SHOPHOUSE]: ROW.RES, [STYLE.APARTMENT]: ROW.BALCONY, [STYLE.OLD]: ROW.OLD, [STYLE.COMMERCIAL]: ROW.MODERN, [STYLE.INSTITUTION]: ROW.MODERN, [STYLE.SHED]: ROW.BLANK, [STYLE.HUT]: ROW.BLANK, [STYLE.UNFINISHED]: ROW.BLANK };
const AWNINGS = [0x2f6fb5, 0x2e8b57, 0xe67e22, 0xc0392b, 0x1f9aa8, 0xf1c40f, 0x7d3c98];

function buildLot(ctx, i) {
  const { g, sg, city } = ctx;
  const L = city.lots;
  const x = L.x[i], z = L.z[i], hw = L.hw[i], hd = L.hd[i], rot = L.rot[i];
  const h = L.h[i], floors = L.floors[i], style = L.style[i], color = L.color[i], seed = L.seed[i], flags = L.flags[i];
  const r = rng(seed);
  const c = Math.cos(rot), s = Math.sin(rot);
  const X = (lx, lz) => x + lx * c + lz * s, Z = (lx, lz) => z - lx * s + lz * c;
  const sb = seed & 255;
  g.setTint(color, sb);

  if (style === STYLE.SHED || style === STYLE.HUT) return buildShed(ctx, x, z, hw, hd, rot, h, color, sb, style, r);

  const upperRow = style === STYLE.HOUSE && flags & 16 ? (r.chance(0.5) ? ROW.BALCONY : ROW.RES) : RES_ROWS[style];
  const shops = flags & 1;
  const groundRow = shops ? ROW.SHOP : style === STYLE.OLD ? ROW.OLD : style === STYLE.COMMERCIAL || style === STYLE.INSTITUTION ? ROW.MODERN : ROW.GROUND;
  const unfinished = style === STYLE.UNFINISHED;
  const P = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  const walls = [[1, 0, 'front'], [0, 3, 'side'], [3, 2, 'back'], [2, 1, 'side']];
  for (const [a, b, kind] of walls) {
    const ax = X(P[a][0], P[a][1]), az = Z(P[a][0], P[a][1]), bx = X(P[b][0], P[b][1]), bz = Z(P[b][0], P[b][1]);
    const len = Math.hypot(bx - ax, bz - az);
    const bays = Math.max(1, Math.round(len / FLOOR));
    if (unfinished) {
      g.setTile(TILE.BRICK[0], TILE.BRICK[1], 1, 1);
      g.wall(ax, az, bx, bz, 0, h, 0, len / FLOOR, 0, h / FLOOR);
      continue;
    }
    let row = upperRow, gRow = groundRow, variants = 8;
    if (kind === 'side') {
      // Party walls in dense rows stay blank; corners and free-standing houses get windows.
      const blank = style === STYLE.OLD ? r.chance(0.5) : r.chance(0.6);
      if (blank) { row = ROW.BLANK; gRow = ROW.BLANK; }
      else gRow = row === ROW.OLD ? ROW.OLD : ROW.RES;
    } else if (kind === 'back') { gRow = row === ROW.OLD ? ROW.OLD : ROW.RES; if (row === ROW.BALCONY) row = ROW.RES; }
    if (row === ROW.BLANK) variants = flags & 512 ? 8 : 2;
    if (floors >= 2 || (kind === 'front' && shops)) {
      g.setTile(0, gRow, gRow === ROW.BLANK ? variants : 8, 1);
      g.wall(ax, az, bx, bz, 0, FLOOR, 0, bays, 0, 1);
      if (h > FLOOR + 0.01) {
        g.setTile(0, row, row === ROW.BLANK ? variants : 8, 1);
        g.wall(ax, az, bx, bz, FLOOR, h, 0, bays, 1, h / FLOOR);
      }
    } else {
      g.setTile(0, kind === 'front' ? groundRow === ROW.GROUND ? (r.chance(0.6) ? ROW.GROUND : ROW.RES) : groundRow : row, row === ROW.BLANK ? variants : 8, 1);
      g.wall(ax, az, bx, bz, 0, h, 0, bays, 0, h / FLOOR);
    }
  }
  // Parapet and roof.
  const parapet = flags & 2 ? 0.95 : 0;
  g.setTile(TILE.ROOF[0], TILE.ROOF[1], 1, 1).setTint(0xffffff, sb);
  g.flat(X(-hw, -hd), Z(-hw, -hd), X(hw, -hd), Z(hw, -hd), X(hw, hd), Z(hw, hd), X(-hw, hd), Z(-hw, hd), h, FLOOR, x, z);
  if (parapet) {
    g.setTint(color, sb).setTile(TILE.COMPOUND[0], TILE.COMPOUND[1], 1, 1);
    const t = 0.22;
    for (const [a, b] of walls) {
      const ax = X(P[a][0], P[a][1]), az = Z(P[a][0], P[a][1]), bx = X(P[b][0], P[b][1]), bz = Z(P[b][0], P[b][1]);
      const len = Math.hypot(bx - ax, bz - az);
      g.wall(ax, az, bx, bz, h, h + parapet, 0, len / FLOOR, 0.7, 1);
    }
    // Inner faces (reverse direction, inset) and the coping on top.
    const Q = [[-hw + t, -hd + t], [hw - t, -hd + t], [hw - t, hd - t], [-hw + t, hd - t]];
    for (const [a, b] of walls) {
      const ax = X(Q[b][0], Q[b][1]), az = Z(Q[b][0], Q[b][1]), bx = X(Q[a][0], Q[a][1]), bz = Z(Q[a][0], Q[a][1]);
      g.wall(ax, az, bx, bz, h, h + parapet, 0, Math.hypot(bx - ax, bz - az) / FLOOR, 0.7, 0.95);
    }
    g.color(mix(color, 0xffffff, 0.35), sb);
    for (const [a, b] of walls) {
      const o0x = X(P[a][0], P[a][1]), o0z = Z(P[a][0], P[a][1]), o1x = X(P[b][0], P[b][1]), o1z = Z(P[b][0], P[b][1]);
      const i0x = X(Q[a][0], Q[a][1]), i0z = Z(Q[a][0], Q[a][1]), i1x = X(Q[b][0], Q[b][1]), i1z = Z(Q[b][0], Q[b][1]);
      const y = h + parapet;
      const v0 = g.v(o0x, y, o0z), v1 = g.v(o1x, y, o1z), v2 = g.v(i1x, y, i1z), v3 = g.v(i0x, y, i0z);
      g.quad(v0, v1, v2, v3);
    }
  }
  if (unfinished) {
    // Rebar sticking out of the roof: the next floor is always "coming soon".
    g.color(0x5b4636, 0);
    for (const [px, pz] of [[-hw + 0.3, -hd + 0.3], [hw - 0.3, -hd + 0.3], [hw - 0.3, hd - 0.3], [-hw + 0.3, hd - 0.3], [0, -hd + 0.3], [0, hd - 0.3]]) g.cbox(X(px, pz), h, Z(px, pz), 0.05, 1.3, 0.05, rot);
  }
  // Rooftop: black Sintex tank, stair room, dish.
  if (flags & 4) {
    const tx = r.range(-hw + 1, hw - 1), tz = r.range(0, hd - 1.1);
    const rad = r.range(0.55, 0.85);
    g.color(0x4a4a4a, 0); g.cbox(X(tx, tz), h, Z(tx, tz), rad * 0.8, 0.5, rad * 0.8, rot);
    g.color(0x1d1f20, 0); g.cyl(X(tx, tz), h + 0.5, Z(tx, tz), rad, rad * 1.5, 8, rad * 0.92);
  }
  if (flags & 8 && hw > 2.4 && hd > 2.6) {
    const sx = r.chance(0.5) ? -hw + 1.4 : hw - 1.4, sz = hd - 1.5;
    g.setTint(color, sb).setTile(0, ROW.BLANK, 2, 1);
    g.box(X(sx, sz), h, Z(sx, sz), 1.2, 2.5, 1.25, rot, FLOOR);
    g.color(0x6b4a33, 0);
    // Door facing forward.
    g.wall(X(sx + 0.45, sz - 1.27), Z(sx + 0.45, sz - 1.27), X(sx - 0.45, sz - 1.27), Z(sx - 0.45, sz - 1.27), h, h + 2.0, 0, 1, 0, 1);
  }
  if (flags & 256) {
    const dx = r.range(-hw + 0.6, hw - 0.6), dz = -hd + 0.6;
    g.color(0x777b7c, 0); g.cbox(X(dx, dz), h, Z(dx, dz), 0.04, 1.0, 0.04, rot);
    g.color(0xd9d9d6, 0); g.cyl(X(dx, dz), h + 0.9, Z(dx, dz), 0.4, 0.15, 7, 0.05);
  }
  // Balconies on the street face.
  if (flags & 16 && floors >= 2 && style !== STYLE.COMMERCIAL) {
    const bw = Math.min(hw * 0.75, 3.4), bd = 1.0;
    for (let f = 1; f < floors; f++) {
      const y = f * FLOOR;
      g.color(mix(color, 0xffffff, 0.25), sb);
      g.cbox(X(0, -hd - bd / 2), y - 0.12, Z(0, -hd - bd / 2), bw, 0.16, bd / 2, rot);
      g.color(style === STYLE.OLD ? 0x5b3a24 : r.pick([0x222222, 0xe8e8e8, 0x2d5d8a, 0x7d2f2f]), 0);
      g.cbox(X(0, -hd - bd + 0.04), y + 0.04, Z(0, -hd - bd + 0.04), bw, 0.95, 0.04, rot);
      g.cbox(X(-bw + 0.04, -hd - bd / 2), y + 0.04, Z(-bw + 0.04, -hd - bd / 2), 0.04, 0.95, bd / 2, rot);
      g.cbox(X(bw - 0.04, -hd - bd / 2), y + 0.04, Z(bw - 0.04, -hd - bd / 2), 0.04, 0.95, bd / 2, rot);
    }
  }
  // Shopfront: awning and signboard.
  if (shops) {
    const sw = hw - 0.3;
    if (flags & 64) {
      g.color(r.pick(AWNINGS), 0);
      const y0 = 2.95, y1 = 2.35, out = 1.5;
      const a = g.v(X(-sw, -hd), y0, Z(-sw, -hd)), b = g.v(X(sw, -hd), y0, Z(sw, -hd));
      const c2 = g.v(X(sw, -hd - out), y1, Z(sw, -hd - out)), d = g.v(X(-sw, -hd - out), y1, Z(-sw, -hd - out));
      g.quad(a, b, c2, d); g.quad(a, d, c2, b);
    }
    const slot = (seed >>> 8) % 32;
    const col = slot % SIGN_COLS, row = Math.floor(slot / SIGN_COLS);
    sg.setTint(0xffffff, 0).setTile(col, row, 1, 2);
    const y0 = 3.0, y1 = 3.75, f = -hd - 0.14;
    sg.wall(X(sw, f), Z(sw, f), X(-sw, f), Z(-sw, f), y0, y1, 0, 1, 0, 1);
    g.color(0x2a2a2a, 0); g.cbox(X(0, -hd - 0.07), y0, Z(0, -hd - 0.07), sw, y1 - y0, 0.07, rot);
  }
  // Compound wall with a gate gap.
  if (flags & 32) {
    const f = -hd - 1.6, gap = 1.6;
    g.setTint(color, sb).setTile(TILE.COMPOUND[0], TILE.COMPOUND[1], 1, 1);
    for (const [l0, l1] of [[-hw, -gap / 2], [gap / 2, hw]]) {
      const ax = X(l1, f), az = Z(l1, f), bx = X(l0, f), bz = Z(l0, f);
      const len = Math.hypot(bx - ax, bz - az);
      g.wall(ax, az, bx, bz, 0, 1.25, 0, len / FLOOR, 0.6, 1);
      g.wall(bx + (X(0, f + 0.2) - X(0, f)), bz + (Z(0, f + 0.2) - Z(0, f)), ax + (X(0, f + 0.2) - X(0, f)), az + (Z(0, f + 0.2) - Z(0, f)), 0, 1.25, 0, len / FLOOR, 0.6, 1);
    }
    g.color(r.pick([0x2d5d8a, 0x7d2f2f, 0x2f6b3a, 0x333333]), 0);
    g.cbox(X(0, f), 0, Z(0, f), gap / 2, 1.2, 0.04, rot);
  }
  // Rooftop hoarding on commercial blocks.
  if (flags & 128) {
    const tile = [TILE.HOARD_A, TILE.HOARD_B, TILE.HOARD_C, TILE.HOARD_D][seed % 4];
    const bw = Math.min(hw - 0.3, 4.5), y0 = h + 1.2, y1 = y0 + bw * 1.1;
    g.color(0x3b3f42, 0);
    g.cbox(X(-bw + 0.3, -hd + 0.6), h, Z(-bw + 0.3, -hd + 0.6), 0.08, y1 - h, 0.08, rot);
    g.cbox(X(bw - 0.3, -hd + 0.6), h, Z(bw - 0.3, -hd + 0.6), 0.08, y1 - h, 0.08, rot);
    g.setTint(0xffffff, 0).setTile(tile[0], tile[1], 1, 2);
    g.wall(X(bw, -hd + 0.5), Z(bw, -hd + 0.5), X(-bw, -hd + 0.5), Z(-bw, -hd + 0.5), y0, y1, 0, 1, 0, 1);
  }
}

function buildShed(ctx, x, z, hw, hd, rot, h, color, sb, style, r) {
  const { g } = ctx;
  const c = Math.cos(rot), s = Math.sin(rot);
  const X = (lx, lz) => x + lx * c + lz * s, Z = (lx, lz) => z - lx * s + lz * c;
  const wallH = style === STYLE.HUT ? 2.7 : h * 0.72;
  const P = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  g.setTint(color, sb).setTile(0, style === STYLE.HUT ? ROW.GROUND : ROW.BLANK, style === STYLE.HUT ? 8 : 2, 1);
  for (const [a, b] of [[1, 0], [0, 3], [3, 2], [2, 1]]) {
    const ax = X(P[a][0], P[a][1]), az = Z(P[a][0], P[a][1]), bx = X(P[b][0], P[b][1]), bz = Z(P[b][0], P[b][1]);
    const len = Math.hypot(bx - ax, bz - az);
    g.wall(ax, az, bx, bz, 0, wallH, 0, Math.max(1, Math.round(len / FLOOR)), 0, wallH / FLOOR);
  }
  // Gable roof along the long axis, corrugated tin (huts get Mangalore-tile red).
  const ridge = wallH + Math.min(hw, hd) * 0.45;
  const roofColor = style === STYLE.HUT ? (r.chance(0.5) ? 0xb8613f : 0x9aa6aa) : r.pick([0xa7b3b6, 0x8d9ea4, 0xb0a08a, 0x9c5a3c]);
  g.setTint(roofColor, sb).setTile(TILE.TIN[0], TILE.TIN[1], 1, 1);
  const o = 0.35;
  const alongX = hw >= hd;
  if (alongX) {
    // Ridge runs along local x at lz = 0.
    const q = (lx, ly, lz) => [X(lx, lz), ly, Z(lx, lz)];
    const quadRoof = (p0, p1, p2, p3) => { const ids = [p0, p1, p2, p3].map(([px, py, pz], k) => g.v(px, py, pz, [0, 1, 1, 0][k] * hw / 1.6, [0, 0, 1, 1][k] * hd / 1.6)); g.quad(...ids); };
    quadRoof(q(hw + o, wallH, -hd - o), q(-hw - o, wallH, -hd - o), q(-hw - o, ridge, 0), q(hw + o, ridge, 0));
    quadRoof(q(-hw - o, wallH, hd + o), q(hw + o, wallH, hd + o), q(hw + o, ridge, 0), q(-hw - o, ridge, 0));
    g.setTint(color, sb).setTile(0, ROW.BLANK, 2, 1);
    for (const sx of [-hw, hw]) {
      const a = g.v(X(sx, sx < 0 ? -hd : hd), wallH, Z(sx, sx < 0 ? -hd : hd), 0, wallH / FLOOR);
      const b = g.v(X(sx, sx < 0 ? hd : -hd), wallH, Z(sx, sx < 0 ? hd : -hd), 1, wallH / FLOOR);
      const tip = g.v(X(sx, 0), ridge, Z(sx, 0), 0.5, ridge / FLOOR);
      g.tri(a, b, tip);
    }
  } else {
    const q = (lx, ly, lz) => [X(lx, lz), ly, Z(lx, lz)];
    const quadRoof = (p0, p1, p2, p3) => { const ids = [p0, p1, p2, p3].map(([px, py, pz], k) => g.v(px, py, pz, [0, 1, 1, 0][k] * hd / 1.6, [0, 0, 1, 1][k] * hw / 1.6)); g.quad(...ids); };
    quadRoof(q(-hw - o, wallH, -hd - o), q(-hw - o, wallH, hd + o), q(0, ridge, hd + o), q(0, ridge, -hd - o));
    quadRoof(q(hw + o, wallH, hd + o), q(hw + o, wallH, -hd - o), q(0, ridge, -hd - o), q(0, ridge, hd + o));
    g.setTint(color, sb).setTile(0, ROW.BLANK, 2, 1);
    for (const sz of [-hd, hd]) {
      const a = g.v(X(sz < 0 ? hw : -hw, sz), wallH, Z(sz < 0 ? hw : -hw, sz), 0, wallH / FLOOR);
      const b = g.v(X(sz < 0 ? -hw : hw, sz), wallH, Z(sz < 0 ? -hw : hw, sz), 1, wallH / FLOOR);
      const tip = g.v(X(0, sz), ridge, Z(0, sz), 0.5, ridge / FLOOR);
      g.tri(a, b, tip);
    }
  }
}

// ------------------------------------------------------------------ trees
const LEAF = [0x4f7a3a, 0x5d8a44, 0x466f35, 0x6b9449, 0x3d6430];
function buildTree(ctx, i) {
  const { g, city } = ctx;
  const T = city.trees;
  const x = T.x[i], z = T.z[i], kind = T.kind[i], sc = T.scale[i];
  const seed = hash2(Math.round(x * 10), Math.round(z * 10));
  const r = rng(seed);
  const y0 = city.groundHeight(x, z);
  if (kind === 3) {
    // Coconut palm: leaning trunk, a crown of fronds.
    const lean = r.range(-0.6, 0.6), h = 7 * sc;
    const tx = x + lean, tz = z + lean * 0.4;
    g.color(0x8a7458, 0); g.beam(x, y0, z, tx, y0 + h, tz, 0.17 * sc);
    g.color(0x4c8a3a, 0);
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + r() * 0.4;
      g.beam(tx, y0 + h, tz, tx + Math.cos(a) * 3.2 * sc, y0 + h - 1.2 * sc, tz + Math.sin(a) * 3.2 * sc, 0.16 * sc);
    }
    g.color(0x6b5a2a, 0); g.blob(tx, y0 + h - 0.2, tz, 0.5, 0.4, 0.5, seed);
    return;
  }
  const trunkH = (kind === 2 ? 2.8 : kind === 4 ? 2.2 : 2.4) * sc;
  const trunkR = (kind === 2 ? 0.55 : 0.2) * sc;
  g.color(kind === 4 ? 0x5e4b3a : 0x6b5440, 0); g.cyl(x, y0 - 0.1, z, trunkR, trunkH + 0.6, 5, trunkR * 0.65, false);
  const cy = y0 + trunkH;
  if (kind === 1) {
    // Gulmohar: a wide umbrella of flame-red flowers over feathery green.
    g.color(0x5d8a44, 0); g.blob(x, cy + 1.1 * sc, z, 3.0 * sc, 1.1 * sc, 3.0 * sc, seed);
    g.color(r.chance(0.5) ? 0xd9482b : 0xe8622e, 0); g.blob(x + 0.4, cy + 1.6 * sc, z - 0.3, 2.5 * sc, 0.9 * sc, 2.4 * sc, seed + 1);
  } else if (kind === 4) {
    // Babool: flat-topped thorny acacia of the dry fields.
    g.color(0x7a8a4a, 0); g.blob(x, cy + 0.8 * sc, z, 2.6 * sc, 0.7 * sc, 2.4 * sc, seed);
  } else if (kind === 2) {
    // Banyan: huge, dark and wide, with hanging roots.
    g.color(0x3d6430, 0);
    g.blob(x, cy + 2.4 * sc, z, 4.6 * sc, 2.4 * sc, 4.4 * sc, seed);
    g.color(0x4f7a3a, 0); g.blob(x + 2 * sc, cy + 2 * sc, z + 1.2 * sc, 3 * sc, 1.8 * sc, 3 * sc, seed + 2);
    g.color(0x6b5440, 0);
    for (let k = 0; k < 5; k++) { const a = r() * 6.28, d = r.range(1.5, 3.5) * sc; g.beam(x + Math.cos(a) * d, y0, z + Math.sin(a) * d, x + Math.cos(a) * d, cy + 1.2 * sc, z + Math.sin(a) * d, 0.06 * sc); }
  } else {
    // Neem: a dense, rounded crown built from several lobes, darker underneath.
    g.color(0x3d6430, 0); g.blob(x, cy + 1.2 * sc, z, 2.1 * sc, 1.25 * sc, 2.1 * sc, seed);
    const n = 4 + (seed % 3);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + r() * 0.6, d = r.range(0.7, 1.4) * sc;
      g.color(LEAF[(seed + k) % LEAF.length], 0);
      g.blob(x + Math.cos(a) * d, cy + (1.6 + r() * 0.7) * sc, z + Math.sin(a) * d, (1.1 + r() * 0.35) * sc, (0.95 + r() * 0.3) * sc, (1.1 + r() * 0.35) * sc, seed + k);
    }
    g.color(0x6b9449, 0); g.blob(x + r.range(-0.4, 0.4), cy + 2.5 * sc, z + r.range(-0.4, 0.4), 1.1 * sc, 0.8 * sc, 1.1 * sc, seed + 9);
    // Two forks in the trunk.
    g.color(0x6b5440, 0);
    g.beam(x, cy - 0.4 * sc, z, x + 0.7 * sc, cy + 1.0 * sc, z + 0.3 * sc, 0.09 * sc);
    g.beam(x, cy - 0.4 * sc, z, x - 0.5 * sc, cy + 0.9 * sc, z - 0.5 * sc, 0.08 * sc);
  }
}

// ------------------------------------------------------------------ props
function buildProp(ctx, i) {
  const { g, pg, city, net } = ctx;
  const P = city.props;
  const x = P.x[i], z = P.z[i], rot = P.rot[i], kind = P.kind[i];
  const r = rng(hash2(i, 31337));
  const c = Math.cos(rot), s = Math.sin(rot);
  switch (kind) {
    case PROP.LAMP: {
      g.color(0x6f7779, 0); g.cyl(x, 0, z, 0.09, 7.2, 5, 0.06);
      // Arm reaches over the road (local -z of rot is toward the road for side lamps).
      const ax = x - s * 1.8, az = z - c * 1.8;
      g.beam(x, 7.1, z, ax, 7.4, az, 0.06);
      g.color(0x3a3f40, 0); g.cbox(ax, 7.2, az, 0.35, 0.18, 0.18, rot);
      lightPool(pg, ax, az, 8.5, 7.15);
      break;
    }
    case PROP.MEDIAN_LAMP: {
      g.color(0x6f7779, 0); g.cyl(x, 0.3, z, 0.1, 8, 5, 0.07);
      for (const side of [1, -1]) {
        const ax = x + c * 2.2 * side, az = z - s * 2.2 * side;
        g.beam(x, 8.1, z, ax, 8.3, az, 0.06);
        g.color(0x3a3f40, 0); g.cbox(ax, 8.1, az, 0.35, 0.18, 0.18, rot + Math.PI / 2);
        g.color(0x6f7779, 0);
        lightPool(pg, ax, az, 10, 8.05);
      }
      break;
    }
    case PROP.POLE: {
      // Concrete MSEB pole with a cross-arm; wires run to the next pole on the road.
      g.color(0x9a9890, 0); g.cyl(x, 0, z, 0.14, 8.2, 4, 0.08);
      g.color(0x4b4f50, 0); g.beam(x - c * 0.8, 7.7, z + s * 0.8, x + c * 0.8, 7.7, z - s * 0.8, 0.05);
      // Find the next pole on the same road, in either chunk.
      const road = P.road[i];
      if (P.kind[i + 1] === PROP.POLE && P.road[i + 1] === road) {
        const nx = P.x[i + 1], nz = P.z[i + 1];
        if (Math.hypot(nx - x, nz - z) < 45) wire(ctx.wires, x, z, nx, nz, c, s);
      }
      if (r.chance(0.12)) { g.color(0x666a6b, 0); g.cbox(x, 5.2, z, 0.35, 0.8, 0.3, rot); } // transformer box
      break;
    }
    case PROP.STALL: {
      // Tea stall: tin box, overhanging roof, a bench and a kettle on the counter.
      const col = r.pick([0x2f6fb5, 0x2e8b57, 0xc0392b, 0xd4a017, 0x1f9aa8]);
      g.color(col, 0); g.cbox(x, 0, z, 1.0, 2.1, 0.8, rot);
      g.color(0x8d9ea4, 0); g.cbox(x - s * 0.5, 2.1, z - c * 0.5, 1.4, 0.08, 1.4, rot);
      g.color(0x7a5a3c, 0); g.cbox(x - s * 1.0, 0.9, z - c * 1.0, 1.0, 0.1, 0.22, rot);
      g.color(0xc0c4c6, 0); g.cyl(x - s * 0.95, 1.0, z - c * 0.95, 0.18, 0.3, 6);
      g.color(0x6d4c33, 0); g.cbox(x - s * 2.2 + c * 0.3, 0, z - c * 2.2 - s * 0.3, 0.9, 0.45, 0.2, rot);
      lightPool(pg, x - s * 1.2, z - c * 1.2, 4, 2.0);
      break;
    }
    case PROP.CART: {
      // Vada-pav / fruit handcart with a big umbrella.
      g.color(0x8a6a3a, 0); g.cbox(x, 0.7, z, 0.9, 0.25, 0.55, rot);
      g.color(0x2b2b2b, 0);
      for (const [lx, lz] of [[-0.6, -0.5], [0.6, -0.5], [-0.6, 0.5], [0.6, 0.5]]) g.cyl(x + lx * c + lz * s, 0, z - lx * s + lz * c, 0.32, 0.08, 6);
      const goods = r.pick([0xe67e22, 0xf1c40f, 0xc0392b, 0x27ae60]);
      g.color(goods, 0); g.blob(x, 1.05, z, 0.7, 0.18, 0.4, i);
      g.color(0x555555, 0); g.cyl(x, 0.95, z, 0.03, 1.6, 4);
      g.color(r.pick([0xc0392b, 0xf1c40f, 0x2f6fb5, 0x8e44ad]), 0); g.cone(x, 2.4, z, 1.35, 0.55, 8);
      break;
    }
    case PROP.SHRINE: {
      // Roadside shrine: whitewashed plinth, saffron spire, a little flag.
      g.color(0xf2efe6, 0); g.cbox(x, 0, z, 0.7, 1.1, 0.7, rot);
      g.color(0xe8892b, 0); g.cone(x, 1.1, z, 0.75, 1.3, 4);
      g.color(0x7a5a3c, 0); g.cyl(x + 0.5, 0, z + 0.5, 0.03, 3.2, 4);
      g.color(0xff8c1a, 0); g.beam(x + 0.5, 2.9, z + 0.5, x + 1.2, 2.7, z + 0.5, 0.18);
      g.color(0xd35400, 0); g.cbox(x - s * 0.72, 0.25, z - c * 0.72, 0.25, 0.45, 0.02, rot);
      lightPool(pg, x - s * 0.9, z - c * 0.9, 2.5, 0.8);
      break;
    }
    case PROP.HOARDING: {
      const tile = [TILE.HOARD_A, TILE.HOARD_B, TILE.HOARD_C, TILE.HOARD_D][i % 4];
      g.color(0x3b3f42, 0);
      g.cyl(x + c * 2.2, 0, z - s * 2.2, 0.12, 8.6, 5);
      g.cyl(x - c * 2.2, 0, z + s * 2.2, 0.12, 8.6, 5);
      g.cbox(x + s * 0.06, 4.4, z + c * 0.06, 3.1, 4.4, 0.06, rot);
      g.setTint(0xffffff, 0).setTile(tile[0], tile[1], 1, 2);
      // Face toward the road (local -z).
      const fx = x - s * 0.02, fz = z - c * 0.02;
      g.wall(fx + c * 3.0, fz - s * 3.0, fx - c * 3.0, fz + s * 3.0, 4.5, 8.6, 0, 1, 0, 1);
      break;
    }
  }
}

function wire(out, x0, z0, x1, z1, c, s) {
  for (const k of [-0.7, 0, 0.7]) {
    const ax = x0 - c * k, az = z0 + s * k, bx = x1 - c * k, bz = z1 + s * k;
    let px = ax, py = 7.8, pz = az;
    const steps = 6;
    for (let t = 1; t <= steps; t++) {
      const u = t / steps;
      const nx = ax + (bx - ax) * u, nz = az + (bz - az) * u;
      const ny = 7.8 - Math.sin(u * Math.PI) * 0.7;
      out.push(px, py, pz, nx, ny, nz);
      px = nx; py = ny; pz = nz;
    }
  }
}

function lightPool(pg, x, z, radius, headY) {
  // Ground pool, and a small bright quad under the lamp head.
  pg.setTint(0xffffff, 0).setTile(0, 0, 1, 0);
  const y = 0.12;
  const a = pg.v(x - radius, y, z - radius, 0, 0), b = pg.v(x - radius, y, z + radius, 0, 1);
  const c = pg.v(x + radius, y, z + radius, 1, 1), d = pg.v(x + radius, y, z - radius, 1, 0);
  pg.quad(a, b, c, d);
  if (headY) {
    const r = 0.55;
    const e = pg.v(x - r, headY, z - r, 0, 0), f = pg.v(x + r, headY, z - r, 1, 0);
    const h = pg.v(x + r, headY, z + r, 1, 1), k = pg.v(x - r, headY, z + r, 0, 1);
    pg.quad(e, f, h, k);
  }
}

export function mix(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}
