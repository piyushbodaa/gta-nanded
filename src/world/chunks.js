// Builds and streams the city around the player, one 192 m chunk at a time.
// Each chunk becomes: one city mesh (everything opaque), one signboard mesh,
// one foliage mesh (leaf cards), one additive light-pool mesh for the night
// and one line mesh for the wires. Chunks away from the player get a far version
// instead: the same blocks in the same paint and windows, without the details
// that are a pixel or two at that distance.
import * as THREE from 'three';
import { Geo, setBounds } from './geo.js';
import { CHUNK, STYLE, PROP, ZONE, FOOTPATH_W, WALK_Y, PUMP_HW, PUMP_HD } from './citygen.js';
import { ROW, TILE, SIGN_COLS } from './atlas.js';
import { rng, hash2, clamp, hashFloat, smoothstep } from '../core/math.js';
import { MEDIAN_W, SOLID_BELOW } from './roadnet.js';
import { buildAirfieldPiece } from './airfield.js';
import { buildPlace } from './landmarks.js';
import { FoliageGeo, LEAF } from './foliage.js';
import { BUMP_LEN, humpAt } from './roadbumps.js';

const FLOOR = 3.2;
const ROAD_Y = [0.07, 0.068, 0.066, 0.064, 0.062, 0.06];
const PAD_Y = 0.074;
// Chunks within this many metres of the player are built at once, budget or not.
const RUSH = 48;
// A build slice hands control back after about this long (between buildings, trees or props).
const SLICE_MS = 0.75;
// Levels of detail. A chunk is built close-up when its near side comes within NEAR_D metres,
// shows that until it is beyond FAR_D (the gap stops it flickering between the two), and
// drops it for good half a chunk further out.
export const NEAR = 0, FAR = 1;
const NEAR_D = 150, FAR_D = 190;

/** One chunk's builds: a close-up and a far level, each a group of meshes, either still to come. */
class Chunk {
  constructor(cx, cz) { this.cx = cx; this.cz = cz; this.levels = [null, null]; }
  /** The meshes of the most detailed level built (for tests and tools). */
  get meshes() { return (this.levels[NEAR] || this.levels[FAR])?.meshes ?? []; }
}

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
    this.lastMs = 0; // time the last update took
    this.x = 0; this.z = 0; // where the player was at the last update
    this.night = 0;
  }

  setRadius(r) { this.radius = r; }

  /**
   * Queue chunks near (x, z), build within the time budget, drop far ones. A chunk is
   * built in slices of under a millisecond (ground and roads, then a handful of buildings,
   * trees or props at a time, each landmark, the meshes) that can span frames, so streaming
   * never stalls a frame for a whole chunk; its meshes appear only once it is complete, so
   * nothing shows up half-built.
   */
  update(x, z, budgetMs = 5) {
    const r = this.radius, C = CHUNK, t0 = performance.now();
    // Everything here was built last time and the player has hardly moved: nothing to do.
    const idle = this._idle;
    if (idle && !this.job && idle.r === r && Math.abs(x - idle.x) < 8 && Math.abs(z - idle.z) < 8) { this.lastMs = 0; return 0; }
    this.x = x; this.z = z;
    const cx0 = Math.floor((x - r) / C), cx1 = Math.floor((x + r) / C);
    const cz0 = Math.floor((z - r) / C), cz1 = Math.floor((z + r) / C);
    // How far (x, z) is from a chunk's square (0 standing on it).
    const gap = (cx, cz) => Math.hypot(Math.max(cx * C - x, 0, x - (cx + 1) * C), Math.max(cz * C - z, 0, z - (cz + 1) * C));
    const want = [];
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const d = this._dist(cx, cz);
        if (d > r) continue;
        const key = `${cx},${cz}`, ch = this.chunks.get(key), rush = gap(cx, cz) < RUSH;
        // A new chunk at its level; a far one coming close gets its close-up; a close-up left
        // behind gets its far version last of all (it stays up until that is ready).
        if (!ch) want.push({ key, cx, cz, d, rush, lod: d < NEAR_D ? NEAR : FAR });
        else if (d < NEAR_D && !ch.levels[NEAR]) want.push({ key, cx, cz, d, rush, lod: NEAR });
        else if (d > FAR_D && !ch.levels[FAR]) want.push({ key, cx, cz, d: d + 1e4, rush: false, lod: FAR });
      }
    }
    // Nearest first. The ground right around the player jumps the queue and ignores the
    // budget, so a teleport or a respawn never leaves a hole underfoot.
    want.sort((a, b) => (b.rush - a.rush) || a.d - b.d);
    const job = this.job;
    if (job) {
      job.rush = gap(job.cx, job.cz) < RUSH;
      // A half-built chunk the player has left far behind, or one holding up the ground here, is dropped.
      const far = this._dist(job.cx, job.cz) > r + C;
      if (far || (want.length && want[0].rush && !job.rush)) this.job = null;
    }
    // Falling behind (a fast drive on a slow machine): catch up at the full rate.
    const deadline = t0 + (want.length && want[0].d < r * 0.6 ? Math.max(budgetMs, 4) : budgetMs);
    let next = 0;
    while (this.job || next < want.length) {
      if (!this.job) {
        const w = want[next++];
        if (this.chunks.get(w.key)?.levels[w.lod]) continue;
        this.job = { key: w.key, cx: w.cx, cz: w.cz, lod: w.lod, rush: w.rush, steps: this._steps(w.key, w.cx, w.cz, w.lod) };
      }
      if (this.job.steps.next().done) this.job = null;
      // Out of time, unless what comes next is the ground right here.
      const rush = this.job ? this.job.rush : next < want.length && want[next].rush;
      if (!rush && performance.now() > deadline && this.chunks.size > 0) break;
    }
    // Drop chunks well outside the radius, and close-ups well behind their far versions;
    // show each chunk at its level.
    for (const [key, ch] of this.chunks) {
      const d = this._dist(ch.cx, ch.cz);
      if (d > r + C * 1.2) { this._dispose(key, ch); continue; }
      if (ch.levels[FAR] && ch.levels[NEAR] && d > FAR_D + C / 2) this._drop(ch, NEAR);
      this._pick(ch, d);
    }
    this.queue = want.slice(next);
    if (this.job) this.queue.unshift(this.job);
    this._idle = !this.job && next >= want.length ? { x, z, r } : null;
    this.lastMs = performance.now() - t0;
    return want.length;
  }

  /** How far the player is from a chunk: its centre's distance less most of its half-diagonal. */
  _dist(cx, cz) { return Math.hypot((cx + 0.5) * CHUNK - this.x, (cz + 0.5) * CHUNK - this.z) - CHUNK * 0.7; }

  /** Show the close-up inside FAR_D (or while it is all there is), else the far version. */
  _pick(ch, d) {
    const near = ch.levels[NEAR], far = ch.levels[FAR];
    const show = near && (d < FAR_D || !far) ? NEAR : FAR;
    if (near) near.group.visible = show === NEAR;
    if (far) far.group.visible = show === FAR;
  }

  _drop(ch, lod) {
    const level = ch.levels[lod];
    for (const m of level.meshes) m.geometry.dispose();
    this.group.remove(level.group);
    ch.levels[lod] = null;
  }

  /** Build everything within `radius` immediately (loading screen). */
  prime(x, z, radius, onProgress) {
    const C = CHUNK, list = [];
    this.x = x; this.z = z;
    for (let cx = Math.floor((x - radius) / C); cx <= Math.floor((x + radius) / C); cx++) {
      for (let cz = Math.floor((z - radius) / C); cz <= Math.floor((z + radius) / C); cz++) {
        if (this._dist(cx, cz) <= radius) list.push([cx, cz]);
      }
    }
    list.forEach(([cx, cz], i) => {
      const key = `${cx},${cz}`;
      if (!this.chunks.has(key)) this._build(key, cx, cz, this._dist(cx, cz) < NEAR_D ? NEAR : FAR);
      onProgress?.((i + 1) / list.length);
    });
  }

  _dispose(key, ch) {
    for (const lod of [NEAR, FAR]) if (ch.levels[lod]) this._drop(ch, lod);
    this.chunks.delete(key);
  }

  setNight(n) {
    this.mat.pools.opacity = clamp(n * 0.9, 0, 0.72);
    this.night = n;
    for (const ch of this.chunks.values()) for (const level of ch.levels) if (level?.pools) level.pools.visible = n > 0.02;
  }

  /** Build one chunk at once (loading screen, tools). */
  _build(key, cx, cz, lod = NEAR) {
    this.job = null; // its shared builders are about to be reused
    for (const _ of this._steps(key, cx, cz, lod));
  }

  /** The chunk build as resumable slices; yields (naming the work just done) between them. */
  *_steps(key, cx, cz, lod = NEAR) {
    let ms = 0, t0 = performance.now();
    const pause = () => { ms += performance.now() - t0; };
    const resume = () => { t0 = performance.now(); };
    const due = () => performance.now() - t0 > SLICE_MS;
    // Builders are reused: their buffers grow once to the size of a busy chunk.
    const B = this._builders || (this._builders = { g: new Geo(65536), sg: new Geo(1024), pg: new Geo(1024), fg: new FoliageGeo(16384) });
    const g = B.g.reset(), sg = B.sg.reset(), pg = B.pg.reset(), fg = B.fg.reset();
    const wires = [];
    const ctx = { g, sg, pg, fg, wires, city: this.city, net: this.net, signSlots: this.signSlots, cx, cz, far: lod === FAR };
    const data = this.city.chunk(cx, cz);
    buildGround(ctx);
    if (data) {
      buildRoads(ctx, data);
      buildBumps(ctx, data);
      buildRails(ctx, data);
      for (const piece of data.airfield || []) buildAirfieldPiece(g, piece);
      pause(); yield 'ground'; resume();
      for (const i of data.lots) { buildLot(ctx, i); if (due()) { pause(); yield 'lots'; resume(); } }
      for (const i of data.trees) { buildTree(ctx, i); if (due()) { pause(); yield 'trees'; resume(); } }
      for (const i of data.props) {
        // From afar only the big props: street lamps (their light at night) and hoardings.
        if (ctx.far && !FAR_PROPS.has(this.city.props.kind[i])) continue;
        buildProp(ctx, i);
        if (due()) { pause(); yield 'props'; resume(); }
      }
      for (const pump of data.pumps || []) buildPump(ctx, pump);
      let done = 'props';
      for (const i of data.places) { pause(); yield done; resume(); buildPlace(ctx, this.city.places[i], i); done = 'place'; }
      pause(); yield done; resume();
    }
    const meshes = [];
    const city = new THREE.Mesh(g.build(), this.mat.city);
    city.castShadow = true; city.receiveShadow = true;
    city.matrixAutoUpdate = false;
    meshes.push(city);
    pause(); yield 'city mesh'; resume();
    if (!sg.empty) { const m = new THREE.Mesh(sg.build(), this.mat.signs); m.receiveShadow = true; m.matrixAutoUpdate = false; meshes.push(m); }
    if (!fg.empty) { const m = new THREE.Mesh(fg.build(), this.mat.foliage); m.castShadow = true; m.receiveShadow = true; m.matrixAutoUpdate = false; meshes.push(m); }
    let pools = null;
    if (!pg.empty) { pools = new THREE.Mesh(pg.build(), this.mat.pools); pools.matrixAutoUpdate = false; pools.renderOrder = 2; meshes.push(pools); }
    if (wires.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(wires, 3));
      setBounds(geo, geo.attributes.position.array);
      const l = new THREE.LineSegments(geo, this.mat.wires); l.matrixAutoUpdate = false; meshes.push(l);
    }
    const group = new THREE.Group();
    group.matrixAutoUpdate = false;
    for (const m of meshes) { m.updateMatrix(); group.add(m); }
    if (pools) pools.visible = this.night > 0.02;
    let ch = this.chunks.get(key);
    if (!ch) this.chunks.set(key, (ch = new Chunk(cx, cz)));
    ch.levels[lod] = { group, meshes, pools };
    this.group.add(group);
    this._pick(ch, this._dist(cx, cz));
    pause();
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
  if (dens > 0.35) { r = 0.8; g = 0.71; b = 0.58; } // town dust
  else if (dens > 0.12) { r = 0.72; g = 0.67; b = 0.5; } // dry suburban scrub
  else if (h < 0.45) { r = 0.42; g = 0.35; b = 0.29; } // regur black soil
  else if (h < 0.75) { r = 0.56; g = 0.64; b = 0.36; } // standing crops
  else { r = 0.78; g = 0.72; b = 0.48; } // dry grass
  // Patches of dry grass and weeds on open ground, fewer where the town is dense.
  const gx = x / 37, gz = z / 37, ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz;
  const hv = (a, b2) => hashFloat((a * 73856093) ^ (b2 * 19349663) ^ 0x5bd1e995);
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const nv = (hv(ix, iz) * (1 - sx) + hv(ix + 1, iz) * sx) * (1 - sz) + (hv(ix, iz + 1) * (1 - sx) + hv(ix + 1, iz + 1) * sx) * sz;
  const grass = clamp((nv - 0.5) * 3.2, 0, 1) * (dens > 0.6 ? 0.35 : dens > 0.35 ? 0.65 : 0.85);
  r = r * (1 - grass) + 0.5 * grass; g = g * (1 - grass) + 0.56 * grass; b = b * (1 - grass) + 0.3 * grass;
  // Built-up blocks: concrete yards and packed grey earth between the dust.
  if (dens > 0.3) {
    const hc = (a, b2) => hashFloat((a * 2654435761) ^ (b2 * 40503) ^ 0x27d4eb2d);
    const cx = x / 21, cz = z / 21, jx = Math.floor(cx), jz = Math.floor(cz), ux = cx - jx, uz = cz - jz;
    const qx = ux * ux * (3 - 2 * ux), qz = uz * uz * (3 - 2 * uz);
    const cv = (hc(jx, jz) * (1 - qx) + hc(jx + 1, jz) * qx) * (1 - qz) + (hc(jx, jz + 1) * (1 - qx) + hc(jx + 1, jz + 1) * qx) * qz;
    const conc = clamp((cv - 0.42) * 2.6, 0, 1) * smoothstep(0.3, 0.6, dens) * (1 - grass);
    r = r * (1 - conc) + 0.64 * conc; g = g * (1 - conc) + 0.62 * conc; b = b * (1 - conc) + 0.58 * conc;
  }
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
  const { net } = ctx;
  const p = {}, q = {};
  if (data.segs) {
    for (const i of data.segs) {
      const road = net.ptRoad[i];
      const len = net.length[road];
      const s0 = Math.max(net.cum[i], net.trimStart(road)), s1 = Math.min(net.cum[i + 1], len - net.trimEnd(road));
      if (s1 - s0 < 0.05) continue;
      // A flyover's deck rises and falls along a segment: build it in short pieces.
      const n = net.raised[road] ? Math.max(1, Math.ceil((s1 - s0) / 4)) : 1;
      for (let k = 0; k < n; k++) roadPiece(ctx, road, i, s0 + ((s1 - s0) * k) / n, s0 + ((s1 - s0) * (k + 1)) / n, s0, s1, p, q);
      if (net.raised[road]) buildPiers(ctx, road, s0, s1);
    }
  }
  if (data.junctions) for (const j of data.junctions) buildJunction(ctx, j);
}

/** The stretch of road segment i from sa to sb (s0..s1 is the whole drawn segment). */
function roadPiece(ctx, road, i, sa, sb, s0, s1, p, q) {
  const { g, city, net } = ctx;
  const w = net.width[road], hw = w / 2, len = net.length[road];
  const tile = roadTile(city, net, road);
  // Mitred offsets at interior vertices keep curves seamless.
  const start = net.ptStart[road], end = net.ptStart[road + 1] - 1;
  const off0 = offsetAt(net, road, i, sa > net.cum[i] + 1e-3, start, end, sa, p);
  const off1 = offsetAt(net, road, i + 1, sb < net.cum[i + 1] - 1e-3, start, end, sb, q);
  // Edges left and right of a->b at each end: a carriageway of a divided road stops at its median.
  const e0 = [net.edgeAt(road, sa, 1), net.edgeAt(road, sa, -1)], e1 = [net.edgeAt(road, sb, 1), net.edgeAt(road, sb, -1)];
  const d0 = net.deckAt(road, sa), d1 = net.deckAt(road, sb), y = ROAD_Y[net.type[road]] ?? 0.06;
  g.setTint(0xffffff, road & 255).setTile(tile[0], tile[1], 1, 3);
  const a = g.v(p.x + off0.nx * e0[0], y + d0, p.z + off0.nz * e0[0], 0, sa / FLOOR);
  const b = g.v(p.x - off0.nx * e0[1], y + d0, p.z - off0.nz * e0[1], 1, sa / FLOOR);
  const c = g.v(q.x - off1.nx * e1[1], y + d1, q.z - off1.nz * e1[1], 1, sb / FLOOR);
  const d = g.v(q.x + off1.nx * e1[0], y + d1, q.z + off1.nz * e1[0], 0, sb / FLOOR);
  // a,b at sa (left, right), c,d at sb (right, left): this order faces up.
  g.quad(a, b, c, d);
  // The median side of a divided road (+1 left of a->b, -1 right), where the other carriageway runs alongside.
  const ms = net.oneway[road] ? -net.oneway[road] : 0, mk = ms > 0 ? 0 : 1;
  const divided = ms !== 0 && (e0[mk] < hw - 0.05 || e1[mk] < hw - 0.05);
  if (net.bridge[road] || d0 > 0.05 || d1 > 0.05) buildBridgeSpan(ctx, p, q, off0, off1, e0, e1, divided ? ms : 0, d0, d1);
  else {
    if (city.footpathAt(i)) buildFootpaths(ctx, p, q, off0, off1, hw, divided ? [-ms] : [1, -1]);
    if (divided) buildMedianHalf(ctx, p, q, off0, off1, ms, e0[mk], e1[mk]);
    else if (w >= 11.5 && !ms) buildMedian(ctx, p, q, off0, off1);
  }
  // Zebra crossing just before a big junction (on the ground).
  if (w >= 8 && sb === s1 && d1 < 0.3 && s1 >= len - net.trimEnd(road) - 0.01 && net.jRoads[net.rb[road]].length >= 3 && s1 - s0 > 4) zebra(ctx, q, off1, e1, -1, s1);
  if (w >= 8 && sa === s0 && d0 < 0.3 && s0 <= net.trimStart(road) + 0.01 && net.jRoads[net.ra[road]].length >= 3 && s1 - s0 > 4) zebra(ctx, p, off0, e0, 1, s0);
}

/**
 * Speed breakers: a rounded hump across the carriageway in black and yellow bands. Potholes
 * (close up only): a ragged rim of broken asphalt round a dark hollow that holds rainwater.
 */
function buildBumps(ctx, data) {
  const { g, city, net } = ctx;
  for (const i of data.bumps || []) {
    const b = city.bumps.bumps[i], y0 = (ROAD_Y[net.type[b.road]] ?? 0.06) + 0.004;
    const nx = b.dz, nz = -b.dx, w = b.left + b.right;
    g.setTint(0xffffff, 0).setTile(TILE.KERB[0], TILE.KERB[1], 1, 1);
    let pl = -1, pr = -1;
    for (let k = 0; k <= 8; k++) {
      const u = BUMP_LEN * (k / 8 - 0.5), y = y0 + humpAt(u), cx = b.x + b.dx * u, cz = b.z + b.dz * u;
      const l = g.v(cx + nx * b.left, y, cz + nz * b.left, 0, k / 8), r = g.v(cx - nx * b.right, y, cz - nz * b.right, w / 3.2, k / 8);
      if (k) g.quad(pl, pr, r, l);
      pl = l; pr = r;
    }
  }
  if (ctx.far) return;
  for (const i of data.holes || []) {
    const h = city.bumps.holes[i], y = (ROAD_Y[net.type[h.road]] ?? 0.06) + 0.003, r = rng(h.seed);
    // Plain colours are linear: these read as dusty broken asphalt and a black hollow.
    const n = 13, rim = [], pit = [];
    for (let k = 0; k < n; k++) {
      const a = h.rot + (k / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), k1 = h.r * r.range(0.7, 1.3), k2 = k1 * r.range(0.45, 0.75);
      rim.push([h.x + c * k1, h.z + s * k1]);
      pit.push([h.x + c * k2, h.z + s * k2]);
    }
    g.hollow(0x1a1916); // the broken edge gets as wet as the street
    const R = rim.map(([x, z]) => g.v(x, y, z)), Pr = pit.map(([x, z]) => g.v(x, y, z));
    for (let k = 0; k < n; k++) g.quad(R[k], Pr[k], Pr[(k + 1) % n], R[(k + 1) % n]);
    g.hollow(0x070706);
    const P = pit.map(([x, z]) => g.v(x, y + 0.001, z)), mid = g.v(h.x, y + 0.001, h.z);
    for (let k = 0; k < n; k++) g.tri(mid, P[(k + 1) % n], P[k]);
  }
}

/** Columns and caps under a flyover's raised deck, between s0 and s1. */
function buildPiers(ctx, road, s0, s1) {
  const { g, net } = ctx;
  const hw = net.width[road] / 2;
  for (const pier of net.deckPiers(road)) {
    if (pier.s < s0 || pier.s >= s1) continue;
    g.color(0xa39d90, 0);
    g.cyl(pier.x, 0, pier.z, 0.6, pier.d - 1.1, 12);
    g.color(0xb4aea1, 0);
    g.cbox(pier.x, pier.d - 1.7, pier.z, hw * 0.8, 0.6, 0.55, pier.rot + Math.PI / 2);
  }
}

// ------------------------------------------------------------------ petrol pumps
// A forecourt with a canopy over two dispenser islands, the attendant's kiosk, a price
// board at the road and an air stand. Three liveries, none of them a real company's.
const PUMP_LOOKS = [[0xf07c1e, 0x1d4f91], [0x2e8b57, 0xf2c230], [0xc62828, 0xf4f1e8]];

function buildPump(ctx, pump) {
  const { g, pg, signSlots } = ctx;
  const { x, z, rot, k } = pump, hw = PUMP_HW * k, hd = PUMP_HD * k;
  const c = Math.cos(rot), s = Math.sin(rot);
  const X = (lx, lz) => x + lx * c + lz * s, Z = (lx, lz) => z - lx * s + lz * c;
  const [band, trim] = PUMP_LOOKS[pump.look];
  g.color(0xb9b6ad, 0); g.flat(X(-hw, -hd - 1.2), Z(-hw, -hd - 1.2), X(hw, -hd - 1.2), Z(hw, -hd - 1.2), X(hw, hd), Z(hw, hd), X(-hw, hd), Z(-hw, hd), 0.085);
  // Canopy on four columns, its fascia in the livery.
  const cw = 8.5 * k, cd = 4.6 * k, cy = 5.4;
  g.color(0xe9e9e4, 0); for (const [lx, lz] of [[-cw + 1.2, -cd + 1.2], [cw - 1.2, -cd + 1.2], [-cw + 1.2, cd - 1.2], [cw - 1.2, cd - 1.2]]) g.cbox(X(lx, lz - 1.5), 0, Z(lx, lz - 1.5), 0.22, cy, 0.22, rot);
  g.color(0xf6f6f2, 0); g.cbox(X(0, -1.5), cy, Z(0, -1.5), cw, 0.25, cd, rot);
  g.color(band, 0); g.cbox(X(0, -1.5), cy + 0.25, Z(0, -1.5), cw + 0.05, 0.7, cd + 0.05, rot);
  g.color(trim, 0); g.cbox(X(0, -1.5), cy + 0.95, Z(0, -1.5), cw + 0.06, 0.18, cd + 0.06, rot);
  lightPool(pg, X(0, -1.5), Z(0, -1.5), 9 * k, cy - 0.1);
  // Two islands, two dispensers each.
  for (const lx of [-3.6 * k, 3.6 * k]) {
    g.color(0xd4cfc2, 0); g.cbox(X(lx, -1.5), 0, Z(lx, -1.5), 0.6, 0.2, 2.2, rot);
    for (const lz of [-2.6, -0.4]) {
      g.color(0xf2f2ee, 0); g.cbox(X(lx, lz), 0.2, Z(lx, lz), 0.32, 1.7, 0.42, rot);
      g.color(band, 0); g.cbox(X(lx, lz), 1.6, Z(lx, lz), 0.33, 0.3, 0.43, rot);
      g.color(0x1d2b33, 0); g.cbox(X(lx - 0.33, lz), 1.0, Z(lx - 0.33, lz), 0.02, 0.35, 0.28, rot); g.cbox(X(lx + 0.33, lz), 1.0, Z(lx + 0.33, lz), 0.02, 0.35, 0.28, rot);
      g.color(0x2b2b2b, 0); g.beam(X(lx + 0.34, lz + 0.2), 1.3, Z(lx + 0.34, lz + 0.2), X(lx + 0.5, lz + 0.35), 0.6, Z(lx + 0.5, lz + 0.35), 0.03);
    }
  }
  // The kiosk at the back, in the livery.
  g.color(0xf0eee6, 0); g.cbox(X(hw - 5 * k, hd - 2.4), 0, Z(hw - 5 * k, hd - 2.4), 3.6 * k, 3.1, 2.2, rot);
  g.color(band, 0); g.cbox(X(hw - 5 * k, hd - 2.4), 3.1, Z(hw - 5 * k, hd - 2.4), 3.65 * k, 0.45, 2.25, rot);
  g.color(0x24323c, 0); g.cbox(X(hw - 5 * k, hd - 4.62), 0.9, Z(hw - 5 * k, hd - 4.62), 2.4 * k, 1.4, 0.03, rot);
  // Price board on a totem at the road, read from both sides.
  const tx = -hw + 1.2, tz = -hd + 0.2;
  g.color(trim, 0); g.cbox(X(tx, tz), 0, Z(tx, tz), 0.5, 6.2, 0.35, rot);
  g.color(band, 0); g.cbox(X(tx, tz), 4.6, Z(tx, tz), 0.95, 1.8, 0.4, rot);
  const slot = signSlots?.get(`pump-${pump.look}`);
  if (slot !== undefined) {
    const col = slot % SIGN_COLS, row = Math.floor(slot / SIGN_COLS), sg = ctx.sg;
    sg.setTint(0xffffff, 0).setTile(col, row, 1, 2);
    for (const side of [-1, 1]) {
      const fz = tz + side * 0.42, a = side < 0 ? 1 : -1;
      sg.wall(X(tx + a * 0.9, fz), Z(tx + a * 0.9, fz), X(tx - a * 0.9, fz), Z(tx - a * 0.9, fz), 3.3, 4.5, 0, 1, 0, 1);
    }
  }
  // Air and water: a little red stand by the exit.
  g.color(0xc0392b, 0); g.cbox(X(hw - 1.4, -hd + 1.6), 0, Z(hw - 1.4, -hd + 1.6), 0.25, 1.2, 0.25, rot);
  g.color(0x2b2b2b, 0); g.cbox(X(hw - 1.4, -hd + 1.6), 1.2, Z(hw - 1.4, -hd + 1.6), 0.18, 0.2, 0.18, rot);
}

// ------------------------------------------------------------------ railway
// Indian broad gauge (1,676 mm): a ballast bed with concrete sleepers and two rails,
// set flush into the road where a street crosses the line.
const GAUGE = 1.676, BALLAST_HW = 1.6;

function buildRails(ctx, data) {
  if (!data.rails) return;
  const { g, city, net } = ctx;
  for (let k = 0; k < data.rails.length; k += 2) {
    const P = city.rails[data.rails[k]], i = data.rails[k + 1];
    const ax = P[i], az = P[i + 1], bx = P[i + 2], bz = P[i + 3];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) continue;
    const fx = (bx - ax) / len, fz = (bz - az) / len, nx = fz, nz = -fx, rot = Math.atan2(fx, fz);
    const pieces = Math.max(1, Math.ceil(len / 6));
    for (let n = 0; n < pieces; n++) {
      const s0 = (len * n) / pieces, s1 = (len * (n + 1)) / pieces, sm = (s0 + s1) / 2;
      const x0 = ax + fx * s0, z0 = az + fz * s0, x1 = ax + fx * s1, z1 = az + fz * s1;
      const crossing = net.onRoad(ax + fx * sm, az + fz * sm, 0.8);
      if (!crossing) {
        g.color(0x6b665f, 0);
        const a = g.v(x0 + nx * BALLAST_HW, 0.09, z0 + nz * BALLAST_HW), b = g.v(x0 - nx * BALLAST_HW, 0.09, z0 - nz * BALLAST_HW);
        const c = g.v(x1 - nx * BALLAST_HW, 0.09, z1 - nz * BALLAST_HW), d = g.v(x1 + nx * BALLAST_HW, 0.09, z1 + nz * BALLAST_HW);
        g.quad(a, b, c, d);
        g.color(0x8e897f, 0);
        if (!ctx.far) for (let s = s0 + 0.45; s < s1; s += 0.9) g.cbox(ax + fx * s, 0.09, az + fz * s, 1.35, 0.06, 0.12, rot);
      }
      // The rails: steel, worn bright on top.
      const y = crossing ? 0.05 : 0.15;
      for (const side of [1, -1]) {
        const cx = (x0 + x1) / 2 + nx * side * GAUGE / 2, cz = (z0 + z1) / 2 + nz * side * GAUGE / 2;
        g.color(0x5d5853, 0); g.cbox(cx, y, cz, 0.04, 0.11, (s1 - s0) / 2 + 0.02, rot);
        g.color(0xb9b6b0, 0); g.cbox(cx, y + 0.11, cz, 0.036, 0.012, (s1 - s0) / 2 + 0.02, rot);
      }
    }
  }
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

/** Vertical wall from A to B facing the right of A->B, its bottom and top sloping from (ya0, ya1) at A to (yb0, yb1) at B. */
function slope(g, ax, az, bx, bz, ya0, ya1, yb0, yb1) {
  const len = Math.hypot(bx - ax, bz - az);
  const a = g.v(ax, ya0, az, 0, 0), b = g.v(bx, yb0, bz, len / 4, 0), c = g.v(bx, yb1, bz, len / 4, 1), d = g.v(ax, ya1, az, 0, 1);
  g.quad(a, b, c, d);
}

function zebra(ctx, p, off, edges, dir, s) {
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
  const wl = edges[0] * 0.96, wr = edges[1] * 0.96;
  const v0 = g.v(ax + nx * wl, y, az + nz * wl, 0, 0), v1 = g.v(ax - nx * wr, y, az - nz * wr, 1, 0);
  const v2 = g.v(bx - nx * wr, y, bz - nz * wr, 1, 1), v3 = g.v(bx + nx * wl, y, bz + nz * wl, 0, 1);
  // Facing up regardless of dir.
  if (dir > 0) g.quad(v0, v1, v2, v3); else g.quad(v0, v3, v2, v1);
}

function buildFootpaths(ctx, p, q, o0, o1, hw, sides) {
  const { g } = ctx;
  const width = FOOTPATH_W;
  for (const side of sides) {
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

/**
 * This carriageway's half of a divided road's median, on `side` (+1 left of a->b, -1 right)
 * from its edge (e0, e1 at each end) to the middle: a kerb facing the traffic and a planted
 * top. The other carriageway builds the other half.
 */
function buildMedianHalf(ctx, p, q, o0, o1, side, e0, e1) {
  const { g } = ctx;
  const h = 0.32, f0 = (e0 + MEDIAN_W / 2 + 0.05) * side, f1 = (e1 + MEDIAN_W / 2 + 0.05) * side;
  const ax = p.x + o0.nx * e0 * side, az = p.z + o0.nz * e0 * side, bx = q.x + o1.nx * e1 * side, bz = q.z + o1.nz * e1 * side;
  const cx = q.x + o1.nx * f1, cz = q.z + o1.nz * f1, dx = p.x + o0.nx * f0, dz = p.z + o0.nz * f0;
  const len = Math.hypot(bx - ax, bz - az);
  g.setTint(0xffffff, 0).setTile(TILE.KERB[0], TILE.KERB[1], 1, 1);
  if (side > 0) g.wall(ax, az, bx, bz, 0.03, h, 0, len / 2.4, 0, 0.3); else g.wall(bx, bz, ax, az, 0.03, h, 0, len / 2.4, 0, 0.3);
  g.color(0x8c9a5a, 0);
  const a = g.v(ax, h, az), b = g.v(bx, h, bz), c = g.v(cx, h, cz), d = g.v(dx, h, dz);
  if (side > 0) g.quad(a, b, c, d); else g.quad(a, d, c, b);
}

/**
 * Deck, parapets and piers under a bridge segment. e0/e1: the deck's edges [left, right]
 * at each end; `median` is the side (+1 left, -1 right) where the other carriageway of a
 * divided bridge runs alongside, whose parapet then stands on the deck edge between the two.
 */
function buildBridgeSpan(ctx, p, q, o0, o1, e0, e1, median, d0 = 0, d1 = 0) {
  const { g, city } = ctx;
  const ax = p.x, az = p.z, bx = q.x, bz = q.z;
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 0.1) return;
  const nx0 = o0.nx, nz0 = o0.nz, nx1 = o1.nx, nz1 = o1.nz;
  const hw = Math.max(e0[0], e0[1], e1[0], e1[1]);
  // Where a flyover's deck is low the ramp is a solid embankment walled to the ground;
  // higher up it is a deck on piers you can drive under. A bridge over water hangs 1.1 m deep.
  const foot = dk => (dk <= 0.05 ? -1.1 : dk < SOLID_BELOW ? -0.3 : dk - 1.1);
  // Deck sides and underside.
  g.color(0xb9b3a6, 0);
  for (const side of [1, -1]) {
    const k = side > 0 ? 0 : 1, inset = side === median ? 0.35 : 0;
    const eA = e0[k] + 0.35 - inset, eB = e1[k] + 0.35 - inset;
    const x0 = ax + nx0 * eA * side, z0 = az + nz0 * eA * side, x1 = bx + nx1 * eB * side, z1 = bz + nz1 * eB * side;
    if (side > 0) slope(g, x1, z1, x0, z0, foot(d1), d1 + 1.0, foot(d0), d0 + 1.0); else slope(g, x0, z0, x1, z1, foot(d0), d0 + 1.0, foot(d1), d1 + 1.0);
    // Parapet top cap and inner face.
    const iA = e0[k] + 0.05 - inset, iB = e1[k] + 0.05 - inset;
    const ix0 = ax + nx0 * iA * side, iz0 = az + nz0 * iA * side, ix1 = bx + nx1 * iB * side, iz1 = bz + nz1 * iB * side;
    if (side > 0) slope(g, ix0, iz0, ix1, iz1, d0 + 0.05, d0 + 1.0, d1 + 0.05, d1 + 1.0); else slope(g, ix1, iz1, ix0, iz0, d1 + 0.05, d1 + 1.0, d0 + 0.05, d0 + 1.0);
    g.color(0xd8d2c4, 0);
    const a = g.v(ix0, d0 + 1.0, iz0), b = g.v(ix1, d1 + 1.0, iz1), c = g.v(x1, d1 + 1.0, z1), d = g.v(x0, d0 + 1.0, z0);
    if (side > 0) g.quad(a, b, c, d); else g.quad(a, d, c, b);
    g.color(0xb9b3a6, 0);
  }
  // Underside slab (facing down) so the bridge reads from the ghats and from the street below.
  const out = side => (side === median ? 0 : 0.35);
  const l0 = e0[0] + out(1), l1 = e1[0] + out(1), r0 = e0[1] + out(-1), r1 = e1[1] + out(-1);
  const u0 = foot(d0), u1 = foot(d1);
  const a = g.v(ax + nx0 * l0, u0, az + nz0 * l0), b = g.v(bx + nx1 * l1, u1, bz + nz1 * l1);
  const c = g.v(bx - nx1 * r1, u1, bz - nz1 * r1), d = g.v(ax - nx0 * r0, u0, az - nz0 * r0);
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
  const lift = net.jDeck[j];
  const roads = net.jRoads[j];
  if (roads.length < 3) return;
  const jx = net.jx[j], jz = net.jz[j];
  const pts = [];
  const p = {};
  for (const r of roads) {
    const atA = net.ra[r] === j;
    const s = atA ? net.trimStart(r) : net.length[r] - net.trimEnd(r);
    net.pointAt(r, s, p);
    const el = net.edgeAt(r, s, 1) + 0.15, er = net.edgeAt(r, s, -1) + 0.15;
    const nx = p.dz, nz = -p.dx;
    pts.push([p.x + nx * el, p.z + nz * el], [p.x - nx * er, p.z - nz * er]);
    if (net.ra[r] === j && net.rb[r] === j) break;
  }
  pts.sort((a, b) => Math.atan2(a[1] - jz, a[0] - jx) - Math.atan2(b[1] - jz, b[0] - jx));
  g.setTint(0xffffff, 0).setTile(TILE.ASPHALT[0], TILE.ASPHALT[1], 1, 4);
  const c = g.v(jx, PAD_Y + lift, jz);
  const ids = pts.map(([x, z]) => g.v(x, PAD_Y + lift, z));
  for (let i = 0; i < ids.length; i++) {
    const a = ids[i], b = ids[(i + 1) % ids.length];
    // Sorted by increasing atan2(z, x): counter-clockwise in x-z, which faces down; flip.
    g.tri(c, b, a);
  }
}


// ------------------------------------------------------------------ facade relief
// Depth on the faces that front open ground: a plinth the building stands on,
// slab edges at every floor, chajja sunshades over the windows, corner
// pilasters and a projecting roof slab. Party walls against a neighbour stay
// flat. Original illustration of the common Marathwada RCC street building,
// not a survey of any particular facade.
const PLINTH = 0.45;
// Local box corners and walls (front faces local -z); n = outward normal.
const CORNERS = (hw, hd) => [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
const WALLS = [[1, 0, 'front', 0, -1], [0, 3, 'side', -1, 0], [3, 2, 'back', 0, 1], [2, 1, 'side', 1, 0]];

/** True when a wall looks onto open ground (street, yard) rather than a neighbour 1 m away. */
function wallOpen(city, X, Z, A, B, nx, nz) {
  for (const t of [0.3, 0.7]) {
    const lx = A[0] + (B[0] - A[0]) * t + nx * 1.3, lz = A[1] + (B[1] - A[1]) * t + nz * 1.3;
    if (city.builtAt(X(lx, lz), Z(lx, lz), 0.25)) return false;
  }
  return true;
}

/**
 * A horizontal band standing `out` proud of the walls flagged in `on`, from y0 to y1:
 * outer face, top, and underside when raised. Mitred where two banded walls meet,
 * capped where a band stops; `trim` shortens each run (chajjas between pilasters).
 */
function band(g, X, Z, hw, hd, on, y0, y1, out, trim = 0, under = true) {
  const P = CORNERS(hw, hd);
  for (let k = 0; k < 4; k++) {
    if (!on[k]) continue;
    const [a, b, , nx, nz] = WALLS[k];
    const prevOn = !trim && on[(k + 3) % 4], nextOn = !trim && on[(k + 1) % 4];
    const A = P[a], B = P[b], len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const dx = (B[0] - A[0]) / len, dz = (B[1] - A[1]) / len;
    const a0 = prevOn ? -out : trim, b0 = nextOn ? -out : trim;
    // Wall-line and outer-line end points (local).
    const wA = [A[0] + dx * trim, A[1] + dz * trim], wB = [B[0] - dx * trim, B[1] - dz * trim];
    const oA = [A[0] + dx * a0 + nx * out, A[1] + dz * a0 + nz * out], oB = [B[0] - dx * b0 + nx * out, B[1] - dz * b0 + nz * out];
    const W = q => [X(q[0], q[1]), Z(q[0], q[1])];
    const [wAx, wAz] = W(wA), [wBx, wBz] = W(wB), [oAx, oAz] = W(oA), [oBx, oBz] = W(oB);
    const olen = Math.hypot(oBx - oAx, oBz - oAz);
    g.wall(oAx, oAz, oBx, oBz, y0, y1, 0, olen / FLOOR, y0 / FLOOR, y1 / FLOOR);
    g.flat(oBx, oBz, oAx, oAz, wAx, wAz, wBx, wBz, y1, FLOOR, 0, 0);
    if (under && y0 > 0.05) {
      // Underside, facing down: the part of a chajja you see from the street.
      const v0 = g.v(wBx, y0, wBz, 0, 0), v1 = g.v(wAx, y0, wAz, 1, 0), v2 = g.v(oAx, y0, oAz, 1, 0.1), v3 = g.v(oBx, y0, oBz, 0, 0.1);
      g.quad(v0, v3, v2, v1);
    }
    if (!prevOn) g.wall(wAx, wAz, oAx, oAz, y0, y1, 0, out / FLOOR, y0 / FLOOR, y1 / FLOOR);
    if (!nextOn) g.wall(oBx, oBz, wBx, wBz, y0, y1, 0, out / FLOOR, y0 / FLOOR, y1 / FLOOR);
  }
}

/** A thin vertical bar as two back-to-back quads (railing balusters, terrace railings). */
function slat(g, x, z, y0, y1, ux, uz, w = 0.022) {
  const ax = x - ux * w, az = z - uz * w, bx = x + ux * w, bz = z + uz * w;
  g.wall(ax, az, bx, bz, y0, y1, 0, 1, 0, 1);
  g.wall(bx, bz, ax, az, y0, y1, 0, 1, 0, 1);
}

/** Contact shadow where walls meet bare ground: ground-textured strips, darker at the wall. */
function skirt(ctx, X, Z, hw, hd, on, width = 1.1) {
  const { g, city } = ctx;
  const P = CORNERS(hw, hd);
  g.setTile(TILE.DIRT[0], TILE.DIRT[1], 1, 4);
  for (let k = 0; k < 4; k++) {
    if (!on[k]) continue;
    const [a, b, , nx, nz] = WALLS[k];
    const A = P[a], B = P[b];
    const pts = [[A[0], A[1], 0.56], [B[0], B[1], 0.56], [B[0] + nx * width, B[1] + nz * width, 1], [A[0] + nx * width, A[1] + nz * width, 1]];
    const ids = pts.map(([lx, lz, k2]) => {
      const x = X(lx, lz), z = Z(lx, lz), t = groundTint(city, x, z);
      g.setTint(mix(0, t, k2), 0);
      return g.v(x, 0.035, z);
    });
    // Up-facing (the wall runs A->B with the outside on its right).
    g.quad(ids[0], ids[3], ids[2], ids[1]);
  }
}

// ------------------------------------------------------------------ buildings
const RES_ROWS = { [STYLE.HOUSE]: ROW.RES, [STYLE.SHOPHOUSE]: ROW.RES, [STYLE.APARTMENT]: ROW.BALCONY, [STYLE.OLD]: ROW.OLD, [STYLE.COMMERCIAL]: ROW.MODERN, [STYLE.INSTITUTION]: ROW.MODERN, [STYLE.SHED]: ROW.BLANK, [STYLE.HUT]: ROW.BLANK, [STYLE.UNFINISHED]: ROW.BLANK };
const AWNINGS = [0x2f6fb5, 0x2e8b57, 0xe67e22, 0xc0392b, 0x1f9aa8, 0xf1c40f, 0x7d3c98];

/**
 * A building on its lot. From afar (ctx.far) the same block in the same paint and windows,
 * with its roof, parapet, tank, stair room and hoarding, but none of the relief, balconies,
 * awnings, signs, compound walls or contact shading. Every random choice is still made, in
 * the same order, so the two versions match.
 */
function buildLot(ctx, i) {
  const { g, sg, pg, city, far } = ctx;
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
  const P = CORNERS(hw, hd);
  // Faces that look onto a street or yard get windows and relief; party walls stay blank.
  const open = WALLS.map(([a, b, kind, nx, nz]) => kind === 'front' || wallOpen(city, X, Z, P[a], P[b], nx, nz));
  const windows = [false, false, false, false];
  for (let k = 0; k < 4; k++) {
    const [a, b, kind] = WALLS[k];
    const ax = X(P[a][0], P[a][1]), az = Z(P[a][0], P[a][1]), bx = X(P[b][0], P[b][1]), bz = Z(P[b][0], P[b][1]);
    const len = Math.hypot(bx - ax, bz - az);
    const bays = Math.max(1, Math.round(len / FLOOR));
    g.setTint(color, sb);
    if (unfinished) {
      g.setTile(TILE.BRICK[0], TILE.BRICK[1], 1, 1);
      g.wall(ax, az, bx, bz, 0, h, 0, len / FLOOR, 0, h / FLOOR);
      continue;
    }
    let row = upperRow, gRow = groundRow, variants = 8;
    if (kind === 'side') {
      if (!open[k]) { row = ROW.BLANK; gRow = ROW.BLANK; variants = 2; }
      // Some open flanks carry painted ads and posters instead of windows.
      else if (r.chance(style === STYLE.OLD ? 0.3 : 0.2)) { row = ROW.BLANK; gRow = ROW.BLANK; }
      else gRow = row === ROW.OLD ? ROW.OLD : ROW.RES;
    } else if (kind === 'back') {
      if (!open[k] && r.chance(0.6)) { row = ROW.BLANK; gRow = ROW.BLANK; variants = 2; }
      else { gRow = row === ROW.OLD ? ROW.OLD : ROW.RES; if (row === ROW.BALCONY) row = ROW.RES; }
    }
    windows[k] = row === ROW.RES || row === ROW.BALCONY;
    const groundTop = floors >= 2 || (kind === 'front' && shops) ? FLOOR : h;
    if (kind === 'front') frontage(ctx, i, ax, az, bx, bz, len, groundRow, groundTop, r);
    else {
      g.setTile(0, gRow, gRow === ROW.BLANK ? variants : 8, 1);
      g.wall(ax, az, bx, bz, 0, groundTop, 0, bays, 0, groundTop / FLOOR);
    }
    if (h > groundTop + 0.01) {
      g.setTile(0, row, row === ROW.BLANK ? variants : 8, 1);
      g.wall(ax, az, bx, bz, groundTop, h, 0, bays, groundTop / FLOOR, h / FLOOR);
    }
  }
  // Relief: plinth (shops stand on their platform instead) and roof slab edge on every
  // open face; slab edges, chajjas and pilasters only where the building fronts a street.
  const street = flags & 1024;
  if (!unfinished && !far) {
    g.setTint(mix(color, 0x6b6359, 0.5), sb).setTile(TILE.COMPOUND[0], TILE.COMPOUND[1], 1, 1);
    band(g, X, Z, hw, hd, open.map((o, k) => o && !(k === 0 && shops)), 0, PLINTH, 0.06);
  }
  if (!unfinished && street && !far) {
    g.setTint(mix(color, 0xffffff, 0.2), sb);
    band(g, X, Z, hw, hd, open, h - 0.14, h + 0.03, 0.11, 0, false);
    const edge = style === STYLE.OLD ? 0.12 : 0.07;
    for (let f = 1; f < floors; f++) band(g, X, Z, hw, hd, open, f * FLOOR - 0.07, f * FLOOR + 0.09, edge, 0, false);
    if (style !== STYLE.OLD && style !== STYLE.COMMERCIAL && style !== STYLE.INSTITUTION) {
      const on = open.map((o, k) => o && windows[k] && !(k === 0 && flags & 16));
      for (let f = 1; f < floors; f++) band(g, X, Z, hw, hd, on, f * FLOOR + 2.42, f * FLOOR + 2.5, 0.42, 0.32);
    }
    if (floors >= 2) {
      g.setTint(mix(color, 0xffffff, 0.12), sb);
      const pr = style === STYLE.OLD ? 0.2 : 0.15;
      for (const [cx2, cz2, k1] of [[-hw, -hd, 0], [hw, -hd, 0]]) {
        const sx = Math.sign(cx2), sz = Math.sign(cz2);
        const lx = cx2 - sx * (pr - 0.05), lz = cz2 - sz * (pr - 0.05);
        g.box(X(lx, lz), shops && k1 === 0 ? 0 : PLINTH, Z(lx, lz), pr, h - (shops && k1 === 0 ? 0 : PLINTH) - 0.14, pr, rot, FLOOR, false);
      }
    }
  }
  // Parapet and roof.
  const parapet = flags & 2 ? 0.95 : 0;
  g.setTile(TILE.ROOF[0], TILE.ROOF[1], 1, 1).setTint(0xffffff, sb);
  g.flat(X(-hw, -hd), Z(-hw, -hd), X(hw, -hd), Z(hw, -hd), X(hw, hd), Z(hw, hd), X(-hw, hd), Z(-hw, hd), h, FLOOR, x, z);
  if (parapet) {
    // Low wall with an MS railing on some terraces, a full solid parapet on most.
    const railing = !unfinished && street && r.chance(0.25);
    const ph = railing ? 0.5 : parapet;
    g.setTint(color, sb).setTile(TILE.COMPOUND[0], TILE.COMPOUND[1], 1, 1);
    const t = 0.22;
    for (const [a, b] of WALLS) {
      const ax = X(P[a][0], P[a][1]), az = Z(P[a][0], P[a][1]), bx = X(P[b][0], P[b][1]), bz = Z(P[b][0], P[b][1]);
      const len = Math.hypot(bx - ax, bz - az);
      g.wall(ax, az, bx, bz, h, h + ph, 0, len / FLOOR, 0.7, 1);
    }
    // Inner faces (reverse direction, inset) and the coping on top, a little proud of the wall.
    const Q = [[-hw + t, -hd + t], [hw - t, -hd + t], [hw - t, hd - t], [-hw + t, hd - t]];
    for (const [a, b] of far ? [] : WALLS) {
      const ax = X(Q[b][0], Q[b][1]), az = Z(Q[b][0], Q[b][1]), bx = X(Q[a][0], Q[a][1]), bz = Z(Q[a][0], Q[a][1]);
      g.wall(ax, az, bx, bz, h, h + ph, 0, Math.hypot(bx - ax, bz - az) / FLOOR, 0.7, 0.95);
    }
    g.color(mix(color, 0xffffff, 0.35), sb);
    for (const [a, b] of far ? [] : WALLS) {
      const o0x = X(P[a][0], P[a][1]), o0z = Z(P[a][0], P[a][1]), o1x = X(P[b][0], P[b][1]), o1z = Z(P[b][0], P[b][1]);
      const i0x = X(Q[a][0], Q[a][1]), i0z = Z(Q[a][0], Q[a][1]), i1x = X(Q[b][0], Q[b][1]), i1z = Z(Q[b][0], Q[b][1]);
      const y = h + ph;
      const v0 = g.v(o0x, y, o0z), v1 = g.v(o1x, y, o1z), v2 = g.v(i1x, y, i1z), v3 = g.v(i0x, y, i0z);
      g.quad(v0, v1, v2, v3);
    }
    if (railing) {
      g.color(r.pick([0x2b2d2e, 0x3b4a57, 0x5a3a2a]), 0);
      for (const [k, [a, b]] of far ? [] : WALLS.entries()) {
        if (!open[k]) continue;
        const ax = P[a][0] * 0.98, az = P[a][1] * 0.98, bx = P[b][0] * 0.98, bz = P[b][1] * 0.98;
        g.beam(X(ax, az), h + ph + 0.85, Z(ax, az), X(bx, bz), h + ph + 0.85, Z(bx, bz), 0.025);
        const len2 = Math.hypot(bx - ax, bz - az), n = Math.max(2, Math.round(len2 / 1.8));
        const ux = (X(bx, bz) - X(ax, az)) / len2, uz = (Z(bx, bz) - Z(ax, az)) / len2;
        for (let k = 0; k < n; k++) { const t2 = k / n, px = ax + (bx - ax) * t2, pz = az + (bz - az) * t2; slat(g, X(px, pz), Z(px, pz), h + ph, h + ph + 0.85, ux, uz); }
      }
    }
  }
  if (unfinished && !far) {
    // Rebar sticking out of the roof: the next floor is always "coming soon".
    g.color(0x5b4636, 0);
    for (const [px, pz] of [[-hw + 0.3, -hd + 0.3], [hw - 0.3, -hd + 0.3], [hw - 0.3, hd - 0.3], [-hw + 0.3, hd - 0.3], [0, -hd + 0.3], [0, hd - 0.3]]) g.cbox(X(px, pz), h, Z(px, pz), 0.05, 1.3, 0.05, rot);
  }
  // Rooftop: black Sintex tank, stair room, dish.
  if (flags & 4) {
    const tx = r.range(-hw + 1, hw - 1), tz = r.range(0, hd - 1.1);
    const rad = r.range(0.55, 0.85);
    if (far) { g.color(0x1d1f20, 0); g.cbox(X(tx, tz), h, Z(tx, tz), rad * 0.9, 0.5 + rad * 1.5, rad * 0.9, rot); } else {
      g.color(0x4a4a4a, 0); g.cbox(X(tx, tz), h, Z(tx, tz), rad * 0.8, 0.5, rad * 0.8, rot);
      g.color(0x1d1f20, 0); g.cyl(X(tx, tz), h + 0.5, Z(tx, tz), rad, rad * 1.5, 8, rad * 0.92);
    }
  }
  if (flags & 8 && hw > 2.4 && hd > 2.6) {
    const sx = r.chance(0.5) ? -hw + 1.4 : hw - 1.4, sz = hd - 1.5;
    g.setTint(color, sb).setTile(0, ROW.BLANK, 2, 1);
    g.box(X(sx, sz), h, Z(sx, sz), 1.2, 2.5, 1.25, rot, FLOOR);
    g.color(0x6b4a33, 0);
    // Door facing forward.
    if (!far) g.wall(X(sx + 0.45, sz - 1.27), Z(sx + 0.45, sz - 1.27), X(sx - 0.45, sz - 1.27), Z(sx - 0.45, sz - 1.27), h, h + 2.0, 0, 1, 0, 1);
  }
  if (flags & 256) {
    const dx = r.range(-hw + 0.6, hw - 0.6), dz = -hd + 0.6;
    if (!far) {
      g.color(0x777b7c, 0); g.cbox(X(dx, dz), h, Z(dx, dz), 0.04, 1.0, 0.04, rot);
      g.color(0xd9d9d6, 0); g.cyl(X(dx, dz), h + 0.9, Z(dx, dz), 0.4, 0.15, 7, 0.05);
    }
  }
  // Balconies on the street face: a thin slab with an MS railing or a concrete balustrade.
  if (flags & 16 && floors >= 2 && style !== STYLE.COMMERCIAL) {
    const bw = Math.min(hw * 0.7, 3.2), bd = 0.95;
    const concrete = style !== STYLE.OLD && r.chance(0.6);
    const rail = style === STYLE.OLD ? 0x4a3020 : r.pick([0x26292b, 0x2d4b66, 0x5e2a24, 0xd9d9d4]);
    for (let f = 1; f < (far ? 1 : floors); f++) {
      const y = f * FLOOR;
      g.setTint(mix(color, 0xffffff, 0.22), sb).setTile(TILE.COMPOUND[0], TILE.COMPOUND[1], 1, 1);
      g.box(X(0, -hd - bd / 2), y - 0.14, Z(0, -hd - bd / 2), bw, 0.14, bd / 2, rot, FLOOR, true, true);
      if (concrete) {
        g.setTint(color, sb);
        g.box(X(0, -hd - bd + 0.06), y, Z(0, -hd - bd + 0.06), bw, 0.9, 0.06, rot, FLOOR);
        for (const sx2 of [-1, 1]) g.box(X(sx2 * (bw - 0.06), -hd - bd / 2), y, Z(sx2 * (bw - 0.06), -hd - bd / 2), 0.06, 0.9, bd / 2 - 0.06, rot, FLOOR);
      } else {
        g.color(rail, 0);
        const fz = -hd - bd + 0.04;
        g.beam(X(-bw, fz), y + 0.92, Z(-bw, fz), X(bw, fz), y + 0.92, Z(bw, fz), 0.03);
        g.beam(X(-bw, fz), y + 0.1, Z(-bw, fz), X(bw, fz), y + 0.1, Z(bw, fz), 0.02);
        for (const sx2 of [-bw, bw]) g.beam(X(sx2, fz), y + 0.92, Z(sx2, fz), X(sx2, -hd), y + 0.92, Z(sx2, -hd), 0.03);
        const n = Math.max(3, Math.round(bw / 0.4));
        for (let k = 0; k <= n; k++) { const px = -bw + (2 * bw * k) / n; slat(g, X(px, fz), Z(px, fz), y, y + 0.92, c, -s, 0.014); }
      }
    }
  }
  // Shopfront: awning on brackets, signboard, and light spilling onto the street at night.
  if (shops) {
    const sw = hw - 0.3;
    if (flags & 64) {
      const cloth = mix(r.pick(AWNINGS), 0x8a8a84, 0.3);
      if (!far) {
        const y0 = 3.0, y1 = 2.66, out = 1.1;
        const A0 = [X(-sw, -hd), Z(-sw, -hd)], B0 = [X(sw, -hd), Z(sw, -hd)], C0 = [X(sw, -hd - out), Z(sw, -hd - out)], D0 = [X(-sw, -hd - out), Z(-sw, -hd - out)];
        g.color(cloth, 0);
        g.quad(g.v(A0[0], y0, A0[1]), g.v(B0[0], y0, B0[1]), g.v(C0[0], y1, C0[1]), g.v(D0[0], y1, D0[1]));
        // Underside a little lighter: sun through the cloth.
        g.color(mix(cloth, 0xfff2d8, 0.35), 0);
        g.quad(g.v(A0[0], y0 - 0.01, A0[1]), g.v(D0[0], y1 - 0.01, D0[1]), g.v(C0[0], y1 - 0.01, C0[1]), g.v(B0[0], y0 - 0.01, B0[1]));
        g.color(cloth, 0);
        // Valance along the front edge and two steel brackets.
        g.box(X(0, -hd - out), y1 - 0.16, Z(0, -hd - out), sw, 0.16, 0.012, rot);
        g.color(0x3a3d3f, 0);
        for (const bx2 of [-sw + 0.3, sw - 0.3]) g.beam(X(bx2, -hd), y0 - 0.55, Z(bx2, -hd), X(bx2, -hd - out * 0.6), y0 - (y0 - y1) * 0.6 - 0.03, Z(bx2, -hd - out * 0.6), 0.018);
      }
    }
    const slot = (seed >>> 8) % 32;
    const col = slot % SIGN_COLS, row = Math.floor(slot / SIGN_COLS);
    if (!far) {
      sg.setTint(0xffffff, 0).setTile(col, row, 1, 2);
      const y0 = 3.0, y1 = 3.75, f = -hd - 0.14;
      sg.wall(X(sw, f), Z(sw, f), X(-sw, f), Z(-sw, f), y0, y1, 0, 1, 0, 1);
      g.color(0x2a2a2a, 0); g.cbox(X(0, -hd - 0.07), y0, Z(0, -hd - 0.07), sw, y1 - y0, 0.07, rot);
      lightPool(pg, X(0, -hd - 1.6), Z(0, -hd - 1.6), Math.min(3.6, hw + 0.8));
    }
  }
  // Compound wall with a gate gap (only where it keeps off the road).
  if (city.compoundWall(i)) {
    const f = -hd - 1.6, gap = 1.6;
    g.setTint(color, sb).setTile(TILE.COMPOUND[0], TILE.COMPOUND[1], 1, 1);
    for (const [l0, l1] of far ? [] : [[-hw, -gap / 2], [gap / 2, hw]]) {
      const ax = X(l1, f), az = Z(l1, f), bx = X(l0, f), bz = Z(l0, f);
      const len = Math.hypot(bx - ax, bz - az);
      g.wall(ax, az, bx, bz, 0, 1.25, 0, len / FLOOR, 0.6, 1);
      g.wall(bx + (X(0, f + 0.2) - X(0, f)), bz + (Z(0, f + 0.2) - Z(0, f)), ax + (X(0, f + 0.2) - X(0, f)), az + (Z(0, f + 0.2) - Z(0, f)), 0, 1.25, 0, len / FLOOR, 0.6, 1);
    }
    g.color(r.pick([0x2d5d8a, 0x7d2f2f, 0x2f6b3a, 0x333333]), 0);
    if (!far) g.cbox(X(0, f), 0, Z(0, f), gap / 2, 1.2, 0.04, rot);
    // Bougainvillea spilling over the wall beside the gate.
    if (r.chance(0.6)) {
      const side = r.chance(0.5) ? 1 : -1, bx = side * r.range(gap / 2 + 0.9, Math.max(gap / 2 + 1, hw - 0.8));
      if (!far) ctx.fg.crown(X(bx, f + 0.3), 1.5, Z(bx, f + 0.3), 1.3, 0.85, 0.75, 12, 1.3, LEAF.BOUGAIN, 0xffffff, seed + 3, 0.4);
    }
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
  // Ground contact: darker earth along walls that stand on open ground.
  if (!unfinished && !far) skirt(ctx, X, Z, hw + 0.06, hd + 0.06, open.map((o, k) => o && !(k === 0 && shops)));
}

/**
 * The ground floor of the street face, bay by bay with chosen tiles, so the
 * geometry knows where the door is: homes get a door with a step and a canopy,
 * shops a raised platform (ota) along the shutters.
 */
function frontage(ctx, i, ax, az, bx, bz, len, groundRow, top, r) {
  const { g, city } = ctx;
  const L = city.lots;
  const hw = L.hw[i], hd = L.hd[i], rot = L.rot[i], x = L.x[i], z = L.z[i];
  const c = Math.cos(rot), s = Math.sin(rot);
  const X = (lx, lz) => x + lx * c + lz * s, Z = (lx, lz) => z - lx * s + lz * c;
  const bays = Math.max(1, Math.round(len / FLOOR)), bw = len / bays;
  const shop = groundRow === ROW.SHOP;
  const door = shop ? -1 : r.int(0, bays - 1);
  const dx = (bx - ax) / len, dz = (bz - az) / len;
  for (let k = 0; k < bays; k++) {
    let col, row = groundRow;
    if (shop) col = r.chance(0.14) ? 7 : r.int(0, 6);
    else if (k === door) { row = ROW.GROUND; col = 0; }
    else if (groundRow === ROW.GROUND) col = r.pick([3, 3, 3, 3, 2, 4, 7]);
    else col = r.int(0, 7);
    g.setTile(col, row, 1, 1);
    const x0 = ax + dx * bw * k, z0 = az + dz * bw * k, x1 = ax + dx * bw * (k + 1), z1 = az + dz * bw * (k + 1);
    g.wall(x0, z0, x1, z1, 0, top, k, k + 1, 0, top / FLOOR);
  }
  if (ctx.far || (!shop && !(L.flags[i] & 1024))) return;
  g.setTint(mix(L.color[i], 0x6b6359, 0.5), L.seed[i] & 255).setTile(TILE.COMPOUND[0], TILE.COMPOUND[1], 1, 1);
  if (shop) {
    const depth = city.shopPlatform(i);
    if (depth > 0) g.box(X(0, -hd - depth / 2), 0, Z(0, -hd - depth / 2), hw - 0.05, 0.3, depth / 2, rot, FLOOR);
  } else {
    const room = city.frontRoom(i);
    // Door bay: a step up to the threshold and a small canopy over it.
    const t = (door + 0.5) / bays, lx = hw - 2 * hw * t; // front runs from +hw to -hw
    if (room > 0.3) g.box(X(lx, -hd - 0.22), 0, Z(lx, -hd - 0.22), 0.7, 0.12, 0.22, rot, FLOOR);
    g.box(X(lx, -hd - 0.27), 2.62, Z(lx, -hd - 0.27), 0.8, 0.08, 0.27, rot, FLOOR, true, true);
  }
}

function buildShed(ctx, x, z, hw, hd, rot, h, color, sb, style, r) {
  const { g } = ctx;
  const c = Math.cos(rot), s = Math.sin(rot);
  const X = (lx, lz) => x + lx * c + lz * s, Z = (lx, lz) => z - lx * s + lz * c;
  if (style === STYLE.HUT && r.chance(0.35)) {
    const side = r.chance(0.5) ? 1 : -1;
    for (let k = 0; k < r.int(1, 3); k++) if (!ctx.far) banana(ctx, X(side * (hw + 1.2 + k * 0.4), -hd + 1 + k * 1.6), Z(side * (hw + 1.2 + k * 0.4), -hd + 1 + k * 1.6), hash2(Math.round(x * 7) + k, 77));
  }
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
// Leaf tints vary a little from tree to tree; crowns are leaf cards (foliage.js).
const LEAF_TINT = [0xffffff, 0xeef5e4, 0xe2ecd6, 0xfff8ea, 0xd8e4cc, 0xf4f0dc];
function buildTree(ctx, i) {
  const { g, fg, city } = ctx;
  const T = city.trees;
  const x = T.x[i], z = T.z[i], kind = T.kind[i], sc = T.scale[i];
  const seed = hash2(Math.round(x * 10), Math.round(z * 10));
  const r = rng(seed);
  const y0 = city.groundHeight(x, z);
  const tint = LEAF_TINT[seed % LEAF_TINT.length];
  if (kind === 3) {
    // Coconut palm: a leaning, slightly curved trunk and a crown of drooping fronds.
    const lean = r.range(-0.6, 0.6), h = 7 * sc;
    const mx = x + lean * 0.35, mz = z + lean * 0.12, tx = x + lean, tz = z + lean * 0.4;
    g.color(0x7d6a52, 0);
    g.beam(x, y0 - 0.1, z, mx, y0 + h * 0.5, mz, 0.19 * sc);
    g.beam(mx, y0 + h * 0.5, mz, tx, y0 + h, tz, 0.16 * sc);
    g.color(0x5a4a2a, 0); g.blob(tx, y0 + h - 0.1, tz, 0.42 * sc, 0.35 * sc, 0.42 * sc, seed);
    g.color(0x6f7d2c, 0);
    for (let k = 0; k < 4; k++) { const a = k * 1.7 + r(); g.blob(tx + Math.cos(a) * 0.3, y0 + h - 0.35, tz + Math.sin(a) * 0.3, 0.16, 0.18, 0.16, seed + k); }
    const n = 12;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + r() * 0.45;
      fg.frond(tx, y0 + h, tz, a, r.range(3.3, 4.3) * sc, 1.25 * sc, r.range(0.55, 1.0), LEAF.PALM, tint, 4, r.range(0.25, 0.6));
    }
    return;
  }
  if (kind === 5) {
    // Yard shrub: hibiscus, tulsi or curry-leaf bush.
    fg.crown(x, y0 + 0.75 * sc, z, 1.15 * sc, 0.8 * sc, 1.1 * sc, 12, 1.25 * sc, r.chance(0.25) ? LEAF.BOUGAIN : LEAF.BUSH, tint, seed, 0.3);
    return;
  }
  const trunkH = (kind === 2 ? 2.8 : kind === 4 ? 2.2 : 2.5) * sc;
  const trunkR = (kind === 2 ? 0.55 : kind === 4 ? 0.15 : 0.21) * sc;
  g.color(kind === 4 ? 0x463a2f : 0x4a3f36, 0); g.cyl(x, y0 - 0.1, z, trunkR, trunkH + 0.7, 7, trunkR * 0.62, false);
  const cy = y0 + trunkH;
  // Main limbs forking up into the crown.
  const limbs = kind === 2 ? 5 : 3;
  for (let k = 0; k < limbs; k++) {
    const a = (k / limbs) * Math.PI * 2 + r() * 0.8, spread = (kind === 2 ? 2.6 : kind === 1 ? 1.8 : 1.1) * sc;
    g.beam(x, cy - 0.3 * sc, z, x + Math.cos(a) * spread, cy + (kind === 4 ? 0.4 : 0.9) * sc, z + Math.sin(a) * spread, trunkR * 0.22);
  }
  if (kind === 1) {
    // Gulmohar: a wide umbrella of feathery leaves and flame-red flowers.
    fg.crown(x, cy + 1.5 * sc, z, 3.5 * sc, 1.35 * sc, 3.3 * sc, 50, 2.4 * sc, LEAF.GULMOHAR, tint, seed, 0.9);
  } else if (kind === 4) {
    // Babool: flat-topped thorny acacia of the dry fields.
    fg.crown(x, cy + 0.9 * sc, z, 2.8 * sc, 0.75 * sc, 2.6 * sc, 26, 2.1 * sc, LEAF.BABOOL, tint, seed, 1.3);
  } else if (kind === 2) {
    // Banyan: huge, dark and wide, with aerial roots dropping from its limbs.
    fg.crown(x, cy + 2.7 * sc, z, 5.0 * sc, 2.8 * sc, 4.8 * sc, 84, 3.0 * sc, LEAF.BROAD, mix(tint, 0xc8d8bc, 0.5), seed, 0.35);
    g.color(0x6b5440, 0);
    for (let k = 0; k < 7; k++) { const a = r() * 6.28, d = r.range(1.5, 3.8) * sc; g.beam(x + Math.cos(a) * d, y0, z + Math.sin(a) * d, x + Math.cos(a) * d, cy + 1.3 * sc, z + Math.sin(a) * d, 0.05 * sc); }
  } else {
    // Neem: a dense, rounded crown of drooping compound leaves.
    fg.crown(x, cy + 1.6 * sc, z, 2.6 * sc, 1.85 * sc, 2.6 * sc, 54, 2.4 * sc, LEAF.NEEM, tint, seed, 0.25);
  }
}

/** Banana plants: a green pseudo-stem with big arching leaves. */
function banana(ctx, x, z, seed) {
  const { g, fg } = ctx;
  const r = rng(seed);
  const h = r.range(1.6, 2.4);
  g.color(0x6f8a3a, 0); g.cyl(x, 0, z, 0.13, h, 6, 0.09, false);
  const n = r.int(5, 7);
  for (let k = 0; k < n; k++) fg.frond(x, h, z, (k / n) * Math.PI * 2 + r(), r.range(1.6, 2.2), 0.9, r.range(0.4, 0.8), LEAF.BANANA, 0xffffff, 3, r.range(0.5, 0.9));
}

// ------------------------------------------------------------------ props
// The props a far chunk keeps: street lamps (their light pools at night) and hoardings.
const FAR_PROPS = new Set([PROP.LAMP, PROP.MEDIAN_LAMP, PROP.HOARDING]);

function buildProp(ctx, i) {
  const { g, pg, city, net } = ctx;
  const P = city.props;
  const x = P.x[i], z = P.z[i], rot = P.rot[i], kind = P.kind[i], y0 = P.y[i]; // y0: on a flyover's deck
  const r = rng(hash2(i, 31337));
  const c = Math.cos(rot), s = Math.sin(rot);
  switch (kind) {
    case PROP.LAMP: {
      g.color(0x6f7779, 0); g.cyl(x, y0, z, 0.09, 7.2, 5, 0.06);
      // Arm reaches over the road (local -z of rot is toward the road for side lamps).
      const ax = x - s * 1.8, az = z - c * 1.8;
      g.beam(x, y0 + 7.1, z, ax, y0 + 7.4, az, 0.06);
      g.color(0x3a3f40, 0); g.cbox(ax, y0 + 7.2, az, 0.35, 0.18, 0.18, rot);
      lightPool(pg, ax, az, 8.5, 7.15, y0);
      break;
    }
    case PROP.MEDIAN_LAMP: {
      g.color(0x6f7779, 0); g.cyl(x, y0 + 0.3, z, 0.1, 8, 5, 0.07);
      for (const side of [1, -1]) {
        const ax = x + c * 2.2 * side, az = z - s * 2.2 * side;
        g.beam(x, y0 + 8.1, z, ax, y0 + 8.3, az, 0.06);
        g.color(0x3a3f40, 0); g.cbox(ax, y0 + 8.1, az, 0.35, 0.18, 0.18, rot + Math.PI / 2);
        g.color(0x6f7779, 0);
        lightPool(pg, ax, az, 10, 8.05, y0);
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
      // Every other pole carries a street light on a short arm over the lane.
      const near = r.chance(0.55) && net.nearest(x, z, 20, ctx._near || (ctx._near = {}));
      if (near) {
        const l = Math.hypot(near.x - x, near.z - z) || 1;
        const ax = x + (near.x - x) / l * 1.3, az = z + (near.z - z) / l * 1.3;
        g.color(0x6f7779, 0); g.beam(x, 6.6, z, ax, 6.9, az, 0.04);
        g.color(0x3a3f40, 0); g.cbox(ax, 6.75, az, 0.26, 0.14, 0.14, rot);
        lightPool(pg, ax, az, 7, 6.72);
      }
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
      for (const [lx, lz] of [[-0.6, -0.61], [0.6, -0.61], [-0.6, 0.61], [0.6, 0.61]]) g.wheel(x + lx * c + lz * s, 0.32, z - lx * s + lz * c, 0.32, 0.07, s, c);
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
    case PROP.VENDOR: {
      // A sabzi vendor at the kerb: a handcart, a mat on the ground or a crate stall, piled with produce.
      // y0: up on the footpath, where the street has one.
      const kind = hash2(i, 911) % 3, piles = [0xd63a2a, 0x4f8f3a, 0x9b4a5f, 0xb08a5a, 0xe8c33a, 0xf28c28, 0x5b2a5a, 0x2d7a2d, 0xe9e2c8];
      const pile = (lx, lz, y, rx, rz) => { g.color(r.pick(piles), 0); g.blob(x + lx * c + lz * s, y0 + y, z - lx * s + lz * c, rx, 0.2, rz, i + lx * 7); };
      if (kind === 0) {
        g.color(0x7a5a34, 0); g.cbox(x, y0 + 0.75, z, 1.0, 0.18, 0.6, rot);
        g.color(0x2b2b2b, 0);
        for (const [lx, lz] of [[-0.7, -0.66], [0.7, -0.66], [-0.7, 0.66], [0.7, 0.66]]) g.wheel(x + lx * c + lz * s, y0 + 0.36, z - lx * s + lz * c, 0.36, 0.07, s, c);
        g.color(0x5a4630, 0); g.beam(x + 1.0 * c, y0 + 0.85, z - 1.0 * s, x + 1.7 * c, y0 + 0.65, z - 1.7 * s, 0.04);
        for (const lx of [-0.55, 0, 0.55]) pile(lx, 0, 1.05, 0.38, 0.45);
      } else if (kind === 1) {
        g.color(r.pick([0x2f6fb5, 0xb03a2e, 0x2e8b57, 0x6a4c93]), 0);
        const a = g.v(x - 1.1 * c - 0.8 * s, y0 + 0.1, z + 1.1 * s - 0.8 * c), b = g.v(x + 1.1 * c - 0.8 * s, y0 + 0.1, z - 1.1 * s - 0.8 * c);
        const d = g.v(x + 1.1 * c + 0.8 * s, y0 + 0.1, z - 1.1 * s + 0.8 * c), e = g.v(x - 1.1 * c + 0.8 * s, y0 + 0.1, z + 1.1 * s + 0.8 * c);
        g.quad(a, b, d, e); g.quad(a, e, d, b);
        for (const [lx, lz] of [[-0.6, -0.35], [0, -0.35], [0.6, -0.35], [-0.35, 0.35], [0.35, 0.35]]) pile(lx, lz, 0.18, 0.3, 0.26);
      } else {
        g.color(0x9a7a4c, 0);
        for (const lx of [-0.55, 0.55]) { g.cbox(x + lx * c, y0, z - lx * s, 0.5, 0.42, 0.4, rot); g.cbox(x + lx * c + 0.1 * s, y0 + 0.42, z - lx * s + 0.1 * c, 0.48, 0.4, 0.38, rot); }
        for (const lx of [-0.55, 0.55]) pile(lx, 0.05, 0.92, 0.42, 0.34);
      }
      // A big umbrella over the goods, its pole behind them (local +z faces the road).
      g.color(0x555555, 0); g.cyl(x - 0.9 * s, y0, z - 0.9 * c, 0.03, 2.3, 4);
      g.color(r.pick([0xc0392b, 0x2f6fb5, 0xf1c40f, 0x27ae60, 0xe67e22, 0x8e44ad]), 0); g.cone(x - 0.35 * s, y0 + 2.15, z - 0.35 * c, 1.45, 0.5, 8);
      // A weighing scale on the cart or the mat's corner.
      g.color(0x8f9496, 0); g.beam(x - 0.2 * s, y0 + (kind === 1 ? 0.6 : 1.4), z - 0.2 * c, x - 0.2 * s, y0 + (kind === 1 ? 0.15 : 0.95), z - 0.2 * c, 0.02);
      if ((i & 3) === 0) lightPool(pg, x, z, 3.5, 2.0, y0);
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

function lightPool(pg, x, z, radius, headY, base = 0) {
  // Ground pool, and a small bright quad under the lamp head (base: the deck it stands on).
  pg.setTint(0xffffff, 0).setTile(0, 0, 1, 0);
  const y = base + 0.12;
  if (headY) headY += base;
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
