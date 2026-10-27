// Procedural Nanded: zoning, building lots, trees and street furniture laid
// along the mapped streets. Everything is deterministic (seeded per road), so
// the city is identical on every visit and on every device.
import { SpatialGrid, rng, clamp, pointSegDist2, obbOverlap, hash2, smoothstep } from '../core/math.js';
import { MEDIAN_W } from './roadnet.js';
import { airfieldPieces } from './airfield.js';
import { RoadBumps } from './roadbumps.js';

// Building styles. The renderer maps each to facade rows in the texture atlas.
export const STYLE = {
  HOUSE: 0, // G+1/G+2 painted RCC house
  SHOPHOUSE: 1, // shops on the ground floor, homes above
  APARTMENT: 2, // G+3/G+4 block with balconies
  OLD: 3, // old-city lime-washed buildings with arches and wooden shutters
  COMMERCIAL: 4, // glassy coaching/office blocks
  SHED: 5, // tin-roofed shed, godown or workshop
  HUT: 6, // single-storey village house
  INSTITUTION: 7, // college, hospital, office
  UNFINISHED: 8, // exposed brick, rods sticking out of the roof
};

export const ZONE = { RURAL: 0, RESIDENTIAL: 1, OLD: 2, COACHING: 3, CAMPUS: 4, MARKET: 5 };
// How worn the streets are, by zone: the old town and the villages have the most potholes.
const WEAR = [1, 0.6, 1, 0.35, 0.3, 0.85];
const OLD_AREAS = new Set(['Old City', 'Old Mondha', 'Hazur Sahib', 'Vazirabad', 'Godavari riverfront', 'Riverfront', 'Old Nanded', 'Degloor Naka', 'Station Road', 'Hingoli Gate', 'Doctor Lane']);
const COACHING_AREAS = new Set(['Shyam Nagar', 'Bhagya Nagar', 'Rajendra Nagar', 'Tilak Nagar', 'Anand Nagar', 'Baba Nagar', 'VIP Road', 'Stadium Road', 'Gokul Nagar']);
const MARKET_AREAS = new Set(['New Mondha', 'Datta Nagar', 'ITI / Phule Market', 'ITI Corner', 'Workshop Corner', 'Shivaji Nagar']);
const CAMPUS_AREAS = new Set(['Vishnupuri', 'CIDCO']);
const RURAL_AREAS = new Set(['Pasadgaon', 'Puyni', 'Nasratpur', 'Maltekdi', 'Hassapur', 'Eastern river outskirts', 'Godavari outskirts']);

// Painted walls of Marathwada: pista green, sky blue, pink, haldi yellow, lavender, cream.
const PALETTES = {
  house: [0xa8cf9a, 0x9cc7e3, 0xf0b1b7, 0xf2d27a, 0xc7b6e2, 0xeee3c8, 0x8ec5bc, 0xf1c08e, 0xd9e6a6, 0xe7a5c4, 0xb9d9ea, 0xf4e6b0],
  old: [0xd8c39a, 0xe2d6bb, 0xc9a26b, 0xb9c4c2, 0xd3b48a, 0xe8dcc4, 0xb98b6a, 0xa9bfb4],
  commercial: [0xe9eef0, 0xd7dde0, 0xf3efe6, 0xc9d6dd, 0xe6dccb],
  shed: [0x9fb2b6, 0x8f9fa6, 0xb6aa98, 0x7f8f8a],
  hut: [0xd8c8a8, 0xc9b28c, 0xe0cfb0, 0xb7c9a8, 0xa9c2d4],
  institution: [0xf0e6d2, 0xe9dfcf, 0xd9cdb5, 0xf2eadb],
};

export const CHUNK = 192;
export const chunkKey = (cx, cz) => `${cx},${cz}`;
// The ground mesh is a grid of this many metres, two triangles a cell (chunks.js).
export const GROUND_CELL = 6;
/** The river valley's ground `d` metres from the bank (negative in the water): 14 m of slope down to -3.2. */
export const valleyDepth = d => (d > 14 ? 0 : d > 0 ? -3.2 * (1 - smoothstep(0, 14, d)) : -3.2 - Math.min(1.5, -d * 0.08));
// Paved footpath along the busy roads; buildings keep behind it.
export const FOOTPATH_W = 1.9;
export const WALK_Y = 0.2; // the top of a footpath: its kerb's height

export class City {
  constructor(world, net) {
    this.world = world;
    this.net = net;
    this.bounds = world.bounds;
    this.districts = world.districts.map(([name, x, z]) => ({ name, x, z }));
    this.places = world.places;
    this.rivers = world.rivers.map(r => ({ name: r.name, w: r.w, p: Float32Array.from(r.p) }));
    this.rails = world.rails.map(p => Float32Array.from(p));
    this.raisedAreas = [];
    this._buildDensity();
    this._buildWaterIndex();
    // Off the streets and decks, bodies stand on the ground as it is drawn: the river valleys.
    net.ground = (x, z) => this.groundHeight(x, z);
  }

  // ---------------------------------------------------------------- zoning
  _buildDensity() {
    const { net, bounds } = this;
    const cell = 40;
    this.dCell = cell;
    this.dMinX = bounds.minX; this.dMinZ = bounds.minZ;
    const nx = Math.ceil((bounds.maxX - bounds.minX) / cell) + 1, nz = Math.ceil((bounds.maxZ - bounds.minZ) / cell) + 1;
    this.dNx = nx; this.dNz = nz;
    const raw = new Float32Array(nx * nz);
    for (let r = 0; r < net.count; r++) {
      const weight = net.type[r] <= 3 ? 1.4 : 1;
      for (let i = net.ptStart[r]; i < net.ptStart[r + 1] - 1; i++) {
        const mx = (net.px[i] + net.px[i + 1]) / 2, mz = (net.pz[i] + net.pz[i + 1]) / 2;
        const len = Math.hypot(net.px[i + 1] - net.px[i], net.pz[i + 1] - net.pz[i]);
        const cx = Math.floor((mx - bounds.minX) / cell), cz = Math.floor((mz - bounds.minZ) / cell);
        if (cx >= 0 && cz >= 0 && cx < nx && cz < nz) raw[cz * nx + cx] += len * weight;
      }
    }
    // Blur twice with a 3x3 box so density reads as neighbourhoods, not streets.
    let src = raw;
    for (let pass = 0; pass < 2; pass++) {
      const dst = new Float32Array(nx * nz);
      for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
        let sum = 0, n = 0;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, zz = z + dz;
          if (xx < 0 || zz < 0 || xx >= nx || zz >= nz) continue;
          sum += src[zz * nx + xx]; n++;
        }
        dst[z * nx + x] = sum / n;
      }
      src = dst;
    }
    // ~110 units of street per 40x40 cell is a fully built-up neighbourhood.
    for (let i = 0; i < src.length; i++) src[i] = clamp(src[i] / 110, 0, 1.5);
    this.density = src;
  }

  densityAt(x, z) {
    const fx = (x - this.dMinX) / this.dCell - 0.5, fz = (z - this.dMinZ) / this.dCell - 0.5;
    const x0 = clamp(Math.floor(fx), 0, this.dNx - 2), z0 = clamp(Math.floor(fz), 0, this.dNz - 2);
    const tx = clamp(fx - x0, 0, 1), tz = clamp(fz - z0, 0, 1);
    const d = this.density, nx = this.dNx;
    const a = d[z0 * nx + x0], b = d[z0 * nx + x0 + 1], c = d[(z0 + 1) * nx + x0], e = d[(z0 + 1) * nx + x0 + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + e * tx) * tz;
  }

  /** Busy roads through built-up streets get a raised footpath on each side. */
  footpathRoad(road, x, z) {
    return this.net.width[road] >= 8 && !this.net.bridge[road] && this.densityAt(x, z) > 0.2;
  }

  /** The same, for one polyline segment (judged at its midpoint). */
  footpathAt(seg) {
    const net = this.net;
    return this.footpathRoad(net.ptRoad[seg], (net.px[seg] + net.px[seg + 1]) / 2, (net.pz[seg] + net.pz[seg + 1]) / 2);
  }

  /** What someone on foot `lateral` metres from segment `seg`'s centreline stands on: its footpath's top, or the road. */
  pavementAt(seg, lateral) {
    const hw = this.net.width[this.net.ptRoad[seg]] / 2;
    return lateral > hw - 0.05 && lateral < hw + FOOTPATH_W && this.footpathAt(seg) ? WALK_Y : 0;
  }

  /**
   * Free depth in front of a street-front lot before the road or its footpath
   * (shared by the renderer and the colliders, so what you see is what you hit).
   */
  frontRoom(i) {
    const cache = this._frontRoom || (this._frontRoom = new Float32Array(this.lots.cap).fill(NaN));
    if (!Number.isNaN(cache[i])) return cache[i];
    const L = this.lots, s = Math.sin(L.rot[i]), c = Math.cos(L.rot[i]);
    const fx = L.x[i] - s * L.hd[i], fz = L.z[i] - c * L.hd[i];
    const n = this.net.nearest(fx, fz, 20, this._frontN || (this._frontN = {}));
    const room = n ? n.dist - this.net.width[n.road] / 2 - (this.footpathRoad(n.road, n.x, n.z) ? FOOTPATH_W : 0) - 0.2 : 2;
    cache[i] = room;
    return room;
  }

  /** Depth of the raised platform (ota) along a shop front; 0 when there is none. */
  shopPlatform(i) {
    if (!(this.lots.flags[i] & 1) || this.lots.style[i] === STYLE.SHED || this.lots.style[i] === STYLE.HUT) return 0;
    // Leave the kerb-side walking line (0.45 m from the road edge) clear.
    const d = Math.min(0.9, this.frontRoom(i) - 0.65);
    return d > 0.25 ? d : 0;
  }

  /** A compound wall stands 1.6 m in front of the house, only where it leaves the kerb free. */
  compoundWall(i) {
    const L = this.lots;
    return Boolean(L.flags[i] & 32) && L.style[i] !== STYLE.SHED && L.style[i] !== STYLE.HUT && this.frontRoom(i) >= 2.4;
  }

  /** True when (x, z) lies inside (or within `pad` of) a building lot or reserved landmark. */
  builtAt(x, z, pad = 0) {
    const L = this.lots;
    return Boolean(this.lotGrid.query(x - pad, z - pad, x + pad, z + pad, id => {
      if (id <= -100000) return false; // trees and props
      let cx, cz, hw, hd, rot;
      if (id < 0) { const r = this.reserved[-1 - id]; cx = r.x; cz = r.z; hw = r.hw; hd = r.hd; rot = r.rot; }
      else { cx = L.x[id]; cz = L.z[id]; hw = L.hw[id]; hd = L.hd[id]; rot = L.rot[id]; }
      const c = Math.cos(rot), s = Math.sin(rot), dx = x - cx, dz = z - cz;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      return Math.abs(lx) <= hw + pad && Math.abs(lz) <= hd + pad;
    }));
  }

  district(x, z) {
    let best = null, bd = Infinity;
    for (const d of this.districts) {
      const dd = (d.x - x) ** 2 + (d.z - z) ** 2;
      if (dd < bd) { bd = dd; best = d; }
    }
    return best;
  }

  zoneAt(x, z) {
    const d = this.district(x, z), dens = this.densityAt(x, z);
    const far = Math.hypot(d.x - x, d.z - z) > 900;
    if (dens < 0.18 || RURAL_AREAS.has(d.name) || far) return dens > 0.42 ? ZONE.RESIDENTIAL : ZONE.RURAL;
    if (OLD_AREAS.has(d.name)) return ZONE.OLD;
    if (COACHING_AREAS.has(d.name)) return ZONE.COACHING;
    if (MARKET_AREAS.has(d.name)) return ZONE.MARKET;
    if (CAMPUS_AREAS.has(d.name)) return ZONE.CAMPUS;
    return ZONE.RESIDENTIAL;
  }

  // ---------------------------------------------------------------- water & rails
  _buildWaterIndex() {
    this.waterGrid = new SpatialGrid(64);
    this.waterSegs = [];
    for (const river of this.rivers) {
      const p = river.p;
      for (let i = 0; i < p.length - 2; i += 2) {
        const id = this.waterSegs.length;
        this.waterSegs.push([p[i], p[i + 1], p[i + 2], p[i + 3], river.w]);
        const pad = river.w / 2 + 30;
        this.waterGrid.insertRect(id, Math.min(p[i], p[i + 2]) - pad, Math.min(p[i + 1], p[i + 3]) - pad, Math.max(p[i], p[i + 2]) + pad, Math.max(p[i + 1], p[i + 3]) + pad);
      }
    }
    this.railGrid = new SpatialGrid(64);
    this.railSegs = [];
    for (const p of this.rails) {
      for (let i = 0; i < p.length - 2; i += 2) {
        const id = this.railSegs.length;
        this.railSegs.push([p[i], p[i + 1], p[i + 2], p[i + 3]]);
        this.railGrid.insertRect(id, Math.min(p[i], p[i + 2]) - 12, Math.min(p[i + 1], p[i + 3]) - 12, Math.max(p[i], p[i + 2]) + 12, Math.max(p[i + 1], p[i + 3]) + 12);
      }
    }
  }

  /**
   * Signed distance to the nearest river bank: negative in the water. Returns {d, w, nx, nz}:
   * (nx, nz) points away from the river, toward the nearer bank.
   */
  riverDistance(x, z, out = {}) {
    let best = Infinity, bw = 0, bs = -1, bt = 0;
    const t = this._rt || (this._rt = [0]);
    this.waterGrid.query(x, z, x, z, id => {
      const s = this.waterSegs[id];
      const d = Math.sqrt(pointSegDist2(x, z, s[0], s[1], s[2], s[3], t)) - s[4] / 2;
      if (d < best) { best = d; bw = s[4]; bs = id; bt = t[0]; }
    });
    out.d = best; out.w = bw; out.nx = 0; out.nz = 0;
    if (bs >= 0) {
      const s = this.waterSegs[bs], dx = s[2] - s[0], dz = s[3] - s[1];
      let nx = x - (s[0] + dx * bt), nz = z - (s[1] + dz * bt), l = Math.hypot(nx, nz);
      // On the centre line itself either bank will do.
      if (l < 1e-6) { nx = dz; nz = -dx; l = Math.hypot(nx, nz) || 1; }
      out.nx = nx / l; out.nz = nz / l;
    }
    return out;
  }

  railDistance(x, z) {
    let best = Infinity;
    this.railGrid.query(x, z, x, z, id => {
      const s = this.railSegs[id];
      const d = Math.sqrt(pointSegDist2(x, z, s[0], s[1], s[2], s[3]));
      if (d < best) best = d;
    });
    return best;
  }

  /**
   * Ground height: flat city, with the river valleys cut into it exactly as the ground mesh
   * draws them, so what people walk and drive on is what they see.
   */
  groundHeight(x, z) {
    // Raised ground: the station's platforms.
    for (const a of this.raisedAreas) {
      const dx = x - a.x, dz = z - a.z;
      if (dx * dx + dz * dz > a.r2) continue;
      const u = dx * a.ux + dz * a.uz, v = dx * a.vx + dz * a.vz;
      if (Math.abs(u) <= a.hu && Math.abs(v) <= a.hv) return a.h;
    }
    // Every corner of this ground cell is out of the valley: flat.
    if (this.riverDistance(x, z, this._rd || (this._rd = {})).d > 14 + GROUND_CELL * Math.SQRT2) return 0;
    // The valley at the cell's corners, between them the triangle the mesh draws (split from
    // the cell's low corner to its high one).
    const C = GROUND_CELL, ix = Math.floor(x / C), iz = Math.floor(z / C), fx = x / C - ix, fz = z / C - iz;
    const x0 = ix * C, z0 = iz * C, h00 = this.valleyAt(x0, z0), h11 = this.valleyAt(x0 + C, z0 + C);
    if (fx >= fz) { const h10 = this.valleyAt(x0 + C, z0); return h00 + (h10 - h00) * fx + (h11 - h10) * fz; }
    const h01 = this.valleyAt(x0, z0 + C);
    return h00 + (h01 - h00) * fz + (h11 - h01) * fx;
  }

  /** The river valley at (x, z): what the ground mesh puts at its grid points. */
  valleyAt(x, z) { return valleyDepth(this.riverDistance(x, z, this._rv || (this._rv = {})).d); }

  /** True when a river valley cuts into the rectangle (anywhere else valleyAt is 0). */
  valleyIn(minX, minZ, maxX, maxZ) {
    const x = (minX + maxX) / 2, z = (minZ + maxZ) / 2, hw = (maxX - minX) / 2, hd = (maxZ - minZ) / 2;
    // Water segments are indexed 30 m beyond their banks, more than the valley's 14.
    return this.waterGrid.query(minX, minZ, maxX, maxZ, id => {
      const s = this.waterSegs[id];
      return segBoxDist(s[0], s[1], s[2], s[3], x, z, hw, hd, 1, 0) <= s[4] / 2 + 14;
    });
  }

  // ---------------------------------------------------------------- generation
  generate(onProgress) {
    const t0 = performance.now();
    this._reserve();
    this._placeLots(onProgress);
    this._infill();
    this._placeTrees();
    this._placeProps();
    this.bumps = new RoadBumps(this.net).place(this.places, (x, z) => WEAR[this.zoneAt(x, z)], (x, z) => this.railDistance(x, z));
    this._indexChunks();
    this.genTime = performance.now() - t0;
    return this;
  }

  /**
   * Largest scale k in [minK, 1] at which a place's box (hw*k, hd*k) keeps clear of
   * every mapped street. Big landmarks shrink to the ground they actually have.
   */
  fitPlace(p, hw, hd, minK = 0.35) {
    const rot = p.rot + Math.PI, c = Math.cos(rot), s = Math.sin(rot);
    const net = this.net;
    const clear = k => {
      const ext = Math.max(hw, hd) * k * 1.42 + 8;
      return !net.grid.query(p.x - ext, p.z - ext, p.x + ext, p.z + ext, i =>
        segBoxDist(net.px[i], net.pz[i], net.px[i + 1], net.pz[i + 1], p.x, p.z, hw * k, hd * k, c, s) < net.width[net.ptRoad[i]] / 2 + 0.6);
    };
    if (clear(1)) return 1;
    let lo = minK, hi = 1;
    if (!clear(lo)) return lo;
    for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (clear(mid)) lo = mid; else hi = mid; }
    return lo;
  }

  /**
   * The station building stands beside the railway, not square to the street: turn it to
   * run along the nearest track with its back to the line, and move it so Platform 1 fits
   * between them (the platform's edge 1.7 m from the track). p.station keeps the frame.
   */
  _alignStation(p) {
    let best = null;
    this.rails.forEach(line => {
      for (let i = 0; i + 3 < line.length; i += 2) {
        const len = Math.hypot(line[i + 2] - line[i], line[i + 3] - line[i + 1]);
        const mx = (line[i] + line[i + 2]) / 2, mz = (line[i + 1] + line[i + 3]) / 2;
        if (len > 20 && Math.hypot(mx - p.x, mz - p.z) < 120 && (!best || len > best.len)) best = { len, dx: (line[i + 2] - line[i]) / len, dz: (line[i + 3] - line[i + 1]) / len };
      }
    });
    if (!best) return;
    // The side the tracks are on: n points from the street toward the railway.
    let nx = best.dz, nz = -best.dx, near = Infinity;
    const lat = (x, z) => (x - p.x) * nx + (z - p.z) * nz;
    if (lat(p.ax, p.az) > 0) { nx = -nx; nz = -nz; }
    // The nearest track beside the building (sampled along each segment: some run for hundreds of metres).
    this.rails.forEach(line => {
      for (let i = 0; i + 3 < line.length; i += 2) {
        const n = Math.ceil(Math.hypot(line[i + 2] - line[i], line[i + 3] - line[i + 1]) / 4);
        for (let k = 0; k <= n; k++) {
          const x = line[i] + ((line[i + 2] - line[i]) * k) / n, z = line[i + 1] + ((line[i + 3] - line[i + 1]) * k) / n;
          const along = (x - p.x) * best.dx + (z - p.z) * best.dz, l = lat(x, z);
          if (Math.abs(along) < 40 && l > 0) near = Math.min(near, l);
        }
      }
    });
    if (!Number.isFinite(near)) return;
    const half = STATION_HD, shift = near - 1.7 - half;
    p.x += nx * shift; p.z += nz * shift;
    // Local +z (the back) toward the tracks; place rotations are turned half round.
    p.rot = Math.atan2(nx, nz) - Math.PI;
    p.station = { dx: best.dx, dz: best.dz, nx, nz, track: near - shift };
    this._stationLayout(p);
  }

  /**
   * Platforms between the tracks, a foot overbridge across them and a train at a platform,
   * in station coordinates: a along the line, b from the street (front, b < 0) toward the tracks.
   */
  _stationLayout(p) {
    const S = p.station, PLAT = 0.84; // Indian high-level platforms stand 840 mm above the rails
    const toAB = (x, z) => [(x - p.x) * S.dx + (z - p.z) * S.dz, (x - p.x) * S.nx + (z - p.z) * S.nz];
    // Every 2 m of track near the station, as (a, b).
    const pts = [];
    this.rails.forEach(line => {
      for (let i = 0; i + 3 < line.length; i += 2) {
        const n = Math.ceil(Math.hypot(line[i + 2] - line[i], line[i + 3] - line[i + 1]) / 2);
        for (let k = 0; k <= n; k++) {
          const [a, b] = toAB(line[i] + ((line[i + 2] - line[i]) * k) / n, line[i + 1] + ((line[i + 3] - line[i + 1]) * k) / n);
          if (Math.abs(a) < 70 && b > 0 && b < 80) pts.push([a, b]);
        }
      }
    });
    // Tracks: offsets where the line runs the length of the platforms (a crossover between
    // two tracks only grazes each offset, so it never counts as one).
    const BIN = 0.6, bins = [];
    for (const [a, b] of pts) {
      const k = Math.floor(b / BIN), bin = bins[k] || (bins[k] = { n: 0, sum: 0, lo: a, hi: a });
      bin.n++; bin.sum += b; bin.lo = Math.min(bin.lo, a); bin.hi = Math.max(bin.hi, a);
    }
    // A track lying a little askew spreads over neighbouring bins: merge runs of busy bins.
    const long = [];
    let run = null;
    const close = () => { if (run && run.n >= 40 && run.lo < -40 && run.hi > 40) long.push(run.sum / run.n); run = null; };
    for (let k = 0; k <= bins.length; k++) {
      const bin = bins[k];
      if (!bin || bin.n < 6) { close(); continue; }
      if (!run) run = { n: 0, sum: 0, lo: Infinity, hi: -Infinity };
      run.n += bin.n; run.sum += bin.sum; run.lo = Math.min(run.lo, bin.lo); run.hi = Math.max(run.hi, bin.hi);
    }
    const free = (b0, b1) => {
      // The stretch around the middle with no track (a crossover) across the platform.
      let lo = -48, hi = 48;
      for (const [a, b] of pts) if (b > b0 && b < b1) { if (a < 0) lo = Math.max(lo, a + 2); else hi = Math.min(hi, a - 2); }
      return hi - lo >= 40 ? [lo, hi] : null;
    };
    const platforms = [{ a0: -48, a1: 48, b0: 4.25, b1: S.track - 1.7, n: 1 }];
    for (let i = 0; i + 1 < long.length; i++) {
      const b0 = long[i] + 1.7, b1 = long[i + 1] - 1.7;
      if (b1 - b0 < 7 || b0 < S.track) continue;
      const span = free(b0, b1);
      if (span) platforms.push({ a0: span[0], a1: span[1], b0, b1, n: platforms.length + 1 });
    }
    // (At half scale the yard's tracks lie a few metres apart, too close for island platforms.)
    S.platforms = platforms;
    S.tracks = long;
    // The foot overbridge climbs from Platform 1 and spans every track to the far side.
    const far = long.length ? long[long.length - 1] + 4 : S.track + 6;
    S.fob = { a: -30, b0: 6, b1: far };
    // A train waits at Platform 1.
    S.train = { b: S.track, a0: -46, a1: 46 };
    const r = Math.hypot(48, 40);
    for (const pl of platforms) {
      const am = (pl.a0 + pl.a1) / 2, bm = (pl.b0 + pl.b1) / 2;
      this.raisedAreas.push({
        x: p.x + S.dx * am + S.nx * bm, z: p.z + S.dz * am + S.nz * bm, h: PLAT,
        ux: S.dx, uz: S.dz, vx: S.nx, vz: S.nz, hu: (pl.a1 - pl.a0) / 2, hv: (pl.b1 - pl.b0) / 2, r2: r * r,
      });
    }
  }

  /** A turboprop on the apron nearest the terminal, nose towards the building: p.plane = { x, z, heading }. */
  /**
   * Petrol pumps: forecourts beside the road at the pumps mapped in OSM, then along the
   * highways every kilometre or so where a forecourt fits. this.pumps = [{ x, z, rot, look }]
   * with local -z toward the road.
   */
  _sitePetrolPumps() {
    const net = this.net, pumps = (this.pumps = []), p = {}, ov = {};
    const ok = r => !net.bridge[r] && !net.raised[r] && net.width[r] >= 6;
    const tryAt = (road, s, side, k, spacing) => {
      const len = net.length[road];
      if (s < net.trimStart(road) + 16 * k || s > len - net.trimEnd(road) - 16 * k) return false;
      net.pointAt(road, s, p);
      const hw = PUMP_HW * k, hd = PUMP_HD * k;
      const off = net.width[road] / 2 + 1 + (this.footpathRoad(road, p.x, p.z) ? FOOTPATH_W : 0) + hd;
      const x = p.x + p.dz * off * side, z = p.z - p.dx * off * side;
      // Local -z faces the road: the forecourt's front toward (p.x, p.z).
      const rot = Math.atan2(x - p.x, z - p.z);
      if (pumps.some(q => Math.hypot(q.x - x, q.z - z) < spacing)) return false;
      if (!this._clearOfStreets(x, z, hw, hd, rot, 0.3)) return false;
      if (this.reserved.some(q => obbOverlap(x, z, hw + 2, hd + 2, rot, q.x, q.z, q.hw, q.hd, q.rot, ov))) return false;
      pumps.push({ x, z, rot, k, look: pumps.length % 3 });
      this.reserved.push({ x, z, hw: hw + 1, hd: hd + 1, rot, place: -1 });
      return true;
    };
    // At each pump mapped in OSM: the best frontage on a road within 80 m.
    for (const [fx, fz] of this.world.fuel || []) {
      const roads = new Map();
      net.segmentsIn(fx - 80, fz - 80, fx + 80, fz + 80, (i, r) => {
        if (!ok(r)) return;
        const d = Math.hypot((net.px[i] + net.px[i + 1]) / 2 - fx, (net.pz[i] + net.pz[i + 1]) / 2 - fz);
        if (!roads.has(r) || d < roads.get(r)) roads.set(r, d);
      });
      const order = [...roads.entries()].sort((a, b) => net.type[a[0]] - net.type[b[0]] || a[1] - b[1]).map(([r]) => r);
      let done = false;
      for (const k of [1, 0.8]) for (const road of order) {
        if (done) break;
        const n = net.nearest(fx, fz, 120, {}, r => r === road);
        if (!n) continue;
        const sides = net.kerbSide(road) ? [net.kerbSide(road)] : [1, -1];
        for (let ds = 0; ds <= 60 && !done; ds += 10) for (const sg of [1, -1]) for (const side of sides) if (!done && tryAt(road, n.s + ds * sg, side, k, 150)) done = true;
      }
    }
    // Along the highways and main roads, about one every 1.2 km.
    for (let r = 0; r < net.count && pumps.length < 22; r++) {
      if (net.type[r] > 1 || !ok(r) || net.length[r] < 90) continue;
      const sides = net.kerbSide(r) ? [net.kerbSide(r)] : [1, -1];
      for (let s = 45; s < net.length[r] - 45 && pumps.length < 22; s += 45) {
        if (sides.some(side => tryAt(r, s, side, 1, 600) || tryAt(r, s, side, 0.8, 600))) s += 300;
      }
    }
  }

  _parkPlane(p) {
    let best = null;
    for (const a of this.world.airfield?.aprons || []) {
      let x = 0, z = 0;
      for (let i = 0; i < a.length; i += 2) { x += a[i]; z += a[i + 1]; }
      x /= a.length / 2; z /= a.length / 2;
      const d = Math.hypot(x - p.x, z - p.z);
      if (!best || d < best.d) best = { d, x, z };
    }
    if (!best) return;
    p.plane = { x: best.x, z: best.z, heading: Math.atan2(p.x - best.x, p.z - best.z) };
    // The airside between the terminal and the apron stays open ground.
    const dx = best.x - p.x, dz = best.z - p.z, len = Math.hypot(dx, dz);
    this.reserved.push({ x: p.x + dx / 2, z: p.z + dz / 2, hw: 34, hd: len / 2, rot: Math.atan2(dx, dz), place: -1 });
  }

  /** Places, landmarks and mapped OSM footprints claim their ground first. */
  _reserve() {
    this.lotGrid = new SpatialGrid(24);
    const L = (this.lots = {
      count: 0, cap: 0,
      x: null, z: null, hw: null, hd: null, rot: null, h: null, floors: null,
      style: null, color: null, seed: null, flags: null, place: null,
    });
    this._growLots(65536);
    this.reserved = [];
    this._hazur = this.places.find(p => p.id === 'hazur-sahib');
    const net = this.net;
    for (let i = 0; i < this.places.length; i++) {
      const p = this.places[i];
      if (p.id === 'nanded-station') this._alignStation(p);
      if (p.id === 'nanded-airport') this._parkPlane(p);
      // Researched places face their approach point; our buildings face local -z.
      const rot = p.rot + Math.PI;
      const big = BIG_PLACES[p.id];
      if (big) {
        p.fit = this.fitPlace(p, big[0], big[1], big[2] ?? 0.35);
        this.reserved.push({ x: p.x, z: p.z, hw: big[0] * p.fit + 1, hd: big[1] * p.fit + 1, rot, place: i });
      } else {
        p.fit = 1;
        this.reserved.push({ x: p.x, z: p.z, hw: p.w / 2 + 2, hd: p.d / 2 + 2, rot, place: i });
      }
    }
    // The airfield: nothing is built on the runway strip, the taxiways or the aprons.
    const af = this.world.airfield;
    if (af) {
      const strip = (pts, hw) => {
        for (let i = 0; i + 3 < pts.length; i += 2) {
          const dx = pts[i + 2] - pts[i], dz = pts[i + 3] - pts[i + 1], len = Math.hypot(dx, dz);
          if (len > 0.5) this.reserved.push({ x: pts[i] + dx / 2, z: pts[i + 1] + dz / 2, hw, hd: len / 2 + hw * 0.5, rot: Math.atan2(dx, dz), place: -1 });
        }
      };
      for (const r of af.runways) strip(r.p, AIRSTRIP_HW);
      for (const t of af.taxiways) strip(t, 16);
      for (const a of af.aprons) {
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (let i = 0; i < a.length; i += 2) { x0 = Math.min(x0, a[i]); x1 = Math.max(x1, a[i]); z0 = Math.min(z0, a[i + 1]); z1 = Math.max(z1, a[i + 1]); }
        this.reserved.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, hw: (x1 - x0) / 2 + 8, hd: (z1 - z0) / 2 + 8, rot: 0, place: -1 });
      }
    }
    this._sitePetrolPumps();
    for (const r of this.reserved) {
      const id = -1 - this.reserved.indexOf(r);
      const ext = Math.max(r.hw, r.hd) * 1.42;
      this.lotGrid.insertRect(id, r.x - ext, r.z - ext, r.x + ext, r.z + ext);
    }
    // Mapped OSM buildings become lots of their own when they keep clear of the streets.
    const typeStyle = [STYLE.HOUSE, STYLE.APARTMENT, STYLE.SHOPHOUSE, STYLE.SHED, STYLE.INSTITUTION, STYLE.INSTITUTION, STYLE.SHED, STYLE.HOUSE];
    for (const f of this.world.footprints) {
      const [x, z, w, d, h, yaw, type] = f;
      const hw = Math.max(1.5, w / 2), hd = Math.max(1.5, d / 2);
      if (hw > 40 || hd > 40) continue;
      if (!this._clearOfStreets(x, z, hw, hd, yaw, 0.4)) continue;
      if (this._overlapsLots(x, z, hw, hd, yaw)) continue;
      const floors = clamp(Math.round(h / 3.2), 1, 6);
      const style = typeStyle[type] ?? STYLE.HOUSE;
      this._addLot(x, z, hw, hd, this._faceRoad(x, z, yaw), floors, style, hash2(Math.round(x * 10), Math.round(z * 10)), -1);
    }
  }

  /** Choose the box rotation (of the 4 symmetric ones) whose front (-z) faces the nearest road. */
  _faceRoad(x, z, yaw) {
    const n = this.net.nearest(x, z, 80, {});
    if (!n) return yaw;
    let best = yaw, bd = -Infinity;
    for (let k = 0; k < 4; k++) {
      const r = yaw + (k * Math.PI) / 2;
      // Front direction is local -z = -(sin r, cos r).
      const fx = -Math.sin(r), fz = -Math.cos(r);
      const d = fx * (n.x - x) + fz * (n.z - z);
      if (d > bd) { bd = d; best = r; }
    }
    return best;
  }

  _growLots(cap) {
    const L = this.lots;
    const grow = (arr, Type) => { const n = new Type(cap); if (arr) n.set(arr.subarray(0, L.count)); return n; };
    L.x = grow(L.x, Float32Array); L.z = grow(L.z, Float32Array);
    L.hw = grow(L.hw, Float32Array); L.hd = grow(L.hd, Float32Array); L.rot = grow(L.rot, Float32Array);
    L.h = grow(L.h, Float32Array); L.floors = grow(L.floors, Uint8Array);
    L.style = grow(L.style, Uint8Array); L.color = grow(L.color, Uint32Array);
    L.seed = grow(L.seed, Uint32Array); L.flags = grow(L.flags, Uint16Array); L.place = grow(L.place, Int16Array);
    L.cap = cap;
  }

  _addLot(x, z, hw, hd, rot, floors, style, seed, place, zone = ZONE.RESIDENTIAL, roadType = 5) {
    const L = this.lots;
    if (L.count === L.cap) this._growLots(L.cap * 2);
    const i = L.count++;
    const r = rng(seed);
    // Around Hazur Sahib the old town stays low, so the gurudwara stands clear above it.
    if (place < 0 && this._hazur && (x - this._hazur.x) ** 2 + (z - this._hazur.z) ** 2 < HERITAGE_R * HERITAGE_R) floors = Math.min(floors, 2);
    L.x[i] = x; L.z[i] = z; L.hw[i] = hw; L.hd[i] = hd; L.rot[i] = rot;
    L.floors[i] = floors; L.style[i] = style; L.seed[i] = seed; L.place[i] = place;
    const floorH = style === STYLE.SHED ? 4.2 : style === STYLE.HUT ? 3 : 3.2;
    L.h[i] = style === STYLE.SHED ? r.range(4.5, 7) : floors * floorH + (style === STYLE.SHOPHOUSE ? 0.4 : 0);
    const pal = style === STYLE.OLD ? PALETTES.old : style === STYLE.COMMERCIAL ? PALETTES.commercial
      : style === STYLE.SHED ? PALETTES.shed : style === STYLE.HUT ? PALETTES.hut
        : style === STYLE.INSTITUTION ? PALETTES.institution : PALETTES.house;
    L.color[i] = r.pick(pal);
    // Feature flags: 1 shops below, 2 parapet, 4 water tank, 8 stair room, 16 balconies,
    // 32 compound wall, 64 awning, 128 rooftop sign/banner, 256 dish, 512 side ad,
    // 1024 street front (set by the street-row placement).
    let flags = 0;
    if (style === STYLE.SHOPHOUSE || (style === STYLE.OLD && r.chance(0.55)) || (style === STYLE.COMMERCIAL && r.chance(0.6))) flags |= 1;
    if (style !== STYLE.SHED && style !== STYLE.HUT) flags |= 2;
    if (style !== STYLE.SHED && style !== STYLE.HUT && style !== STYLE.INSTITUTION && r.chance(0.8)) flags |= 4;
    if ((style === STYLE.HOUSE || style === STYLE.APARTMENT || style === STYLE.SHOPHOUSE) && r.chance(0.5)) flags |= 8;
    if ((style === STYLE.APARTMENT || style === STYLE.HOUSE || style === STYLE.OLD) && floors >= 2 && r.chance(0.55)) flags |= 16;
    if (style === STYLE.HOUSE && zone !== ZONE.OLD && r.chance(0.35)) flags |= 32;
    if (flags & 1 && r.chance(0.7)) flags |= 64;
    if (style === STYLE.COMMERCIAL && r.chance(0.5)) flags |= 128;
    if (style !== STYLE.SHED && r.chance(0.3)) flags |= 256;
    if (r.chance(0.12) && roadType <= 3) flags |= 512;
    L.flags[i] = flags;
    const ext = Math.max(hw, hd) * 1.42;
    this.lotGrid.insertRect(i, x - ext, z - ext, x + ext, z + ext);
    return i;
  }

  _overlapsLots(x, z, hw, hd, rot, gap = 0.15) {
    const L = this.lots;
    const ext = Math.max(hw, hd) * 1.42;
    const ov = this._ov || (this._ov = {});
    // Boxes whose bounding circles are apart can't overlap: most neighbours end there.
    return this.lotGrid.query(x - ext, z - ext, x + ext, z + ext, id => {
      if (id >= 0) {
        const dx = x - L.x[id], dz = z - L.z[id], r = Math.hypot(hw - gap, hd - gap) + Math.hypot(L.hw[id], L.hd[id]);
        if (dx * dx + dz * dz > r * r * 1.000001) return false;
      }
      if (id <= -200000) {
        const k = -200000 - id - 1, P = this.props;
        return Boolean(obbOverlap(x, z, hw, hd, rot, P.x[k], P.z[k], 1.4, 1.4, 0, ov));
      }
      if (id <= -100000) {
        const k = -100000 - id - 1, T = this.trees;
        return Boolean(obbOverlap(x, z, hw, hd, rot, T.x[k], T.z[k], 0.8, 0.8, 0, ov));
      }
      if (id < 0) {
        const r = this.reserved[-1 - id];
        return Boolean(obbOverlap(x, z, hw, hd, rot, r.x, r.z, r.hw, r.hd, r.rot, ov));
      }
      return Boolean(obbOverlap(x, z, hw - gap, hd - gap, rot, L.x[id], L.z[id], L.hw[id], L.hd[id], L.rot[id], ov));
    });
  }

  /** True when an oriented box keeps `margin` clear of every road surface, river and rail line. */
  _clearOfStreets(x, z, hw, hd, rot, margin) {
    const net = this.net;
    const c = Math.cos(rot), s = Math.sin(rot);
    const ext = Math.max(hw, hd) * 1.42 + 8;
    let blocked = false;
    // The box lies within `bound` of its centre: a segment farther than that plus the widest a
    // road reaches (half its width, the margin and a footpath) can't come within reach of it.
    const bound = Math.hypot(hw, hd) + margin + FOOTPATH_W + 1e-6;
    net.grid.query(x - ext, z - ext, x + ext, z + ext, i => {
      const ax = net.px[i], az = net.pz[i], bx = net.px[i + 1], bz = net.pz[i + 1], r = net.ptRoad[i];
      const reach = bound + net.width[r] / 2;
      if (Math.min(ax, bx) > x + reach || Math.max(ax, bx) < x - reach || Math.min(az, bz) > z + reach || Math.max(az, bz) < z - reach) return;
      const d = segBoxDist(ax, az, bx, bz, x, z, hw, hd, c, s), base = net.width[r] / 2 + margin;
      // Only a near miss needs to know whether this stretch has a footpath.
      if (d < base || (d < base + FOOTPATH_W && this.footpathAt(i))) { blocked = true; return true; }
    });
    if (blocked) return false;
    const rd = this.riverDistance(x, z, this._rd2 || (this._rd2 = {}));
    if (rd.d < Math.max(hw, hd) + 6) return false;
    if (this.railDistance(x, z) < Math.max(hw, hd) + 6) return false;
    return true;
  }

  _placeLots(onProgress) {
    const net = this.net;
    const p = {}, q = {};
    for (let road = 0; road < net.count; road++) {
      if (net.bridge[road]) continue;
      const len = net.length[road], w = net.width[road], type = net.type[road];
      if (len < 6) continue;
      for (const side of [1, -1]) {
        const r = rng(hash2(road * 2 + (side > 0 ? 1 : 0), 7919));
        let s = net.trimStart(road) + (net.jRoads[net.ra[road]].length >= 3 ? 1.5 : 0.5);
        const sEnd = len - net.trimEnd(road) - (net.jRoads[net.rb[road]].length >= 3 ? 1.5 : 0.5);
        net.pointAt(road, Math.min(len / 2, s + 5), p);
        const zone = this.zoneAt(p.x, p.z);
        const dens = this.densityAt(p.x, p.z);
        const prm = lotParams(zone, dens, type, r);
        while (s < sEnd) {
          const fw = r.range(prm.f0, prm.f1);
          if (s + fw > sEnd) break;
          net.pointAt(road, s + fw / 2, q);
          // Left of the polyline direction (dx, dz) is (dz, -dx).
          const nx = q.dz * side, nz = -q.dx * side;
          const depth = r.range(prm.d0, prm.d1);
          const setback = w / 2 + r.range(prm.s0, prm.s1) + (this.footpathRoad(road, q.x, q.z) ? FOOTPATH_W : 0);
          const cx = q.x + nx * (setback + depth / 2), cz = q.z + nz * (setback + depth / 2);
          const rot = Math.atan2(nx, nz);
          if (r.chance(prm.prob)) this._tryLot(cx, cz, fw / 2, depth / 2, rot, zone, dens, type, r, nx, nz);
          s += fw + r.range(prm.g0, prm.g1);
        }
      }
      if (onProgress && road % 2000 === 0) onProgress(road / net.count);
    }
  }

  _tryLot(cx, cz, hw, hd, rot, zone, dens, roadType, r, nx, nz) {
    // Shrink the lot until it clears its neighbours, then try a second row behind it.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (hd > 2.2 && this._clearOfStreets(cx, cz, hw, hd, rot, 0.6) && !this._overlapsLots(cx, cz, hw, hd, rot)) {
        const { style, floors } = pickStyle(zone, dens, roadType, hw, hd, r);
        const lot = this._addLot(cx, cz, hw, hd, rot, floors, style, (r() * 4294967296) >>> 0, -1, zone, roadType);
        this.lots.flags[lot] |= 1024; // first row: its front is on the street
        if (zone !== ZONE.RURAL && dens > 0.35 && r.chance(0.55)) {
          const d2 = r.range(4, 8);
          const bx = cx + nx * (hd + 0.8 + d2), bz = cz + nz * (hd + 0.8 + d2);
          if (this._clearOfStreets(bx, bz, hw, d2, rot, 0.6) && !this._overlapsLots(bx, bz, hw, d2, rot)) {
            const back = pickStyle(zone, dens, 5, hw, d2, r);
            this._addLot(bx, bz, hw, d2, rot, Math.max(1, back.floors - (r.chance(0.5) ? 1 : 0)), back.style === STYLE.SHOPHOUSE ? STYLE.HOUSE : back.style, (r() * 4294967296) >>> 0, -1, zone, 5);
          }
        }
        return true;
      }
      hd *= 0.72;
      cx -= nx * hd * 0.38; cz -= nz * hd * 0.38;
    }
    return false;
  }

  /**
   * OSM maps the streets, not every galli between them: fill the interiors of
   * built-up blocks with houses aligned to the nearest street, leaving narrow
   * gaps that read as lanes and courtyards.
   */
  _infill() {
    const net = this.net, b = this.bounds, near = {};
    const cell = 10.5;
    for (let gx = b.minX; gx < b.maxX; gx += cell) {
      for (let gz = b.minZ; gz < b.maxZ; gz += cell) {
        const dens = this.densityAt(gx + cell / 2, gz + cell / 2);
        if (dens < 0.16) continue;
        const r = rng(hash2(Math.round(gx * 3) + 17, Math.round(gz * 3) - 29));
        if (!r.chance(dens > 0.45 ? 0.82 : dens > 0.28 ? 0.55 : 0.25)) continue;
        const x = gx + r.range(1, cell - 1), z = gz + r.range(1, cell - 1);
        const n = net.nearest(x, z, 90, near);
        if (!n || n.dist < 6) continue;
        // Local x runs along the street; the front (local -z) faces it.
        let rot = Math.atan2(-n.dz, n.dx);
        const fx = -Math.sin(rot), fz = -Math.cos(rot);
        if (fx * (n.x - x) + fz * (n.z - z) < 0) rot += Math.PI;
        const zone = this.zoneAt(x, z);
        const hw = r.range(2.6, zone === ZONE.OLD ? 4.2 : 5), hd = r.range(3, 5.5);
        if (!this._clearOfStreets(x, z, hw, hd, rot, 1.4)) continue;
        if (this._overlapsLots(x, z, hw + 0.55, hd + 0.55, rot, 0)) continue;
        const { style, floors } = pickStyle(zone, dens, 5, hw, hd, r);
        this._addLot(x, z, hw, hd, rot, Math.max(1, floors - (r.chance(0.35) ? 1 : 0)), style === STYLE.SHOPHOUSE || style === STYLE.COMMERCIAL ? STYLE.HOUSE : style, (r() * 4294967296) >>> 0, -1, zone, 5);
      }
    }
  }

  _placeTrees() {
    const T = (this.trees = { x: [], z: [], kind: [], scale: [] });
    const net = this.net, p = {};
    const ok = (x, z, rad) => {
      if (net.roadClearance(x, z, 12) < rad + 0.3) return false;
      if (this.riverDistance(x, z, this._rd3 || (this._rd3 = {})).d < 2) return false;
      if (this.railDistance(x, z) < 5) return false;
      return !this._overlapsLots(x, z, rad, rad, 0, 0);
    };
    const add = (x, z, kind, scale) => {
      T.x.push(x); T.z.push(z); T.kind.push(kind); T.scale.push(scale);
      this.lotGrid.insertRect(-100000 - T.x.length, x - 1, z - 1, x + 1, z + 1);
    };
    // Avenue trees along streets, wherever the lots left a gap.
    for (let road = 0; road < net.count; road++) {
      if (net.bridge[road]) continue;
      const len = net.length[road], w = net.width[road];
      const r = rng(hash2(road, 104729));
      net.pointAt(road, len / 2, p);
      const zone = this.zoneAt(p.x, p.z);
      const spacing = zone === ZONE.RURAL ? 26 : zone === ZONE.OLD ? 60 : zone === ZONE.CAMPUS ? 14 : 22;
      for (const side of [1, -1]) {
        for (let s = net.trimStart(road) + r.range(3, spacing); s < len - net.trimEnd(road) - 3; s += spacing * r.range(0.7, 1.4)) {
          net.pointAt(road, s, p);
          const off = w / 2 + r.range(1.6, 3.2);
          const x = p.x + p.dz * side * off, z = p.z - p.dx * side * off;
          if (!ok(x, z, 0.9)) continue;
          const kind = zone === ZONE.RURAL ? (r.chance(0.5) ? 4 : 0) : net.type[road] <= 2 && r.chance(0.35) ? 1 : r.chance(0.08) ? 2 : r.chance(0.06) ? 3 : 0;
          add(x, z, kind, r.range(0.8, 1.25));
        }
      }
    }
    // Scattered trees in yards, fields and block interiors: Nanded's neighbourhoods
    // are greener from above than from the street. Shrubs (kind 5) fill the yards.
    const b = this.bounds;
    const step = 16;
    for (let gx = b.minX; gx < b.maxX; gx += step) {
      for (let gz = b.minZ; gz < b.maxZ; gz += step) {
        const r = rng(hash2(Math.round(gx), Math.round(gz)));
        const x = gx + r() * step, z = gz + r() * step;
        const dens = this.densityAt(x, z);
        if (dens < 0.02 && r.chance(0.9)) continue;
        const prob = dens > 0.6 ? 0.26 : dens > 0.3 ? 0.36 : dens > 0.12 ? 0.3 : 0.16;
        if (!r.chance(prob)) continue;
        if (!ok(x, z, 1.2)) continue;
        const zone = dens < 0.18 ? ZONE.RURAL : ZONE.RESIDENTIAL;
        if (zone !== ZONE.RURAL && r.chance(0.3)) { add(x, z, 5, r.range(0.8, 1.3)); continue; }
        add(x, z, zone === ZONE.RURAL ? (r.chance(0.55) ? 4 : r.chance(0.2) ? 2 : 0) : r.chance(0.12) ? 1 : r.chance(0.1) ? 3 : 0, r.range(0.85, 1.35));
      }
    }
    // Riverbanks: big old trees and palms near the ghats.
    for (const river of this.rivers) {
      const pts = river.p;
      for (let i = 0; i < pts.length - 2; i += 2) {
        const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3];
        const len = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / len, dz = (bz - az) / len;
        const r = rng(hash2(Math.round(ax), Math.round(az)));
        for (let s = 0; s < len; s += r.range(9, 20)) {
          for (const side of [1, -1]) {
            const off = river.w / 2 + r.range(16, 34);
            const x = ax + dx * s + dz * side * off, z = az + dz * s - dx * side * off;
            if (r.chance(0.55) && ok(x, z, 1.2)) add(x, z, r.chance(0.3) ? 3 : r.chance(0.3) ? 2 : 0, r.range(0.9, 1.4));
          }
        }
      }
    }
    for (const k of ['x', 'z', 'scale']) T[k] = Float32Array.from(T[k]);
    T.kind = Uint8Array.from(T.kind);
    T.count = T.x.length;
  }

  _placeProps() {
    // Street lamps on the big roads, MSEB poles with sagging wires on the lanes,
    // and the odd tea stall, handcart or shrine near busy corners.
    const P = (this.props = { x: [], z: [], rot: [], kind: [], road: [], y: [] });
    const net = this.net, p = {};
    const add = (x, z, rot, kind, road, y = 0) => { P.x.push(x); P.z.push(z); P.rot.push(rot); P.kind.push(kind); P.road.push(road); P.y.push(y); };
    // Nothing stands on the street under a flyover's deck.
    const clear = (x, z) => net.deckOver(x, z) < 0.3;
    for (let road = 0; road < net.count; road++) {
      const len = net.length[road], w = net.width[road], type = net.type[road];
      const r = rng(hash2(road, 15485863));
      net.pointAt(road, len / 2, p);
      const dens = this.densityAt(p.x, p.z);
      // A carriageway of a divided road has the median on one side and the kerb on the other.
      const kerb = net.kerbSide(road), ow = net.oneway[road];
      if (net.bridge[road] || net.raised[road]) {
        // Along a bridge, or a flyover's deck and ramps: lamps on the parapets, standing on the deck.
        for (let s = 6; s < len - 6; s += 24) {
          net.pointAt(road, s, p);
          for (const side of kerb ? [kerb] : [1, -1]) add(p.x + p.dz * side * (w / 2 - 0.2), p.z - p.dx * side * (w / 2 - 0.2), Math.atan2(p.dx, p.dz) + (side > 0 ? 0 : Math.PI), PROP.LAMP, road, net.deckAt(road, s));
        }
        continue;
      }
      if (w >= 12 && !ow) {
        // Twin-arm lamps down the median of the wide roads.
        for (let s = net.trimStart(road) + 8; s < len - net.trimEnd(road) - 8; s += 34) {
          net.pointAt(road, s, p);
          if (clear(p.x, p.z)) add(p.x, p.z, Math.atan2(p.dx, p.dz), PROP.MEDIAN_LAMP, road);
        }
      } else if (w >= 12 && kerb) {
        // On a divided road they stand on the median between the carriageways; the one
        // heading east (north on a due north-south road) plants them, so there is one row.
        for (let s = net.trimStart(road) + 8; s < len - net.trimEnd(road) - 8; s += 34) {
          net.pointAt(road, s, p);
          const fx = p.dx * ow, fz = p.dz * ow;
          if (fx < -1e-6 || (Math.abs(fx) <= 1e-6 && fz < 0)) continue;
          const inner = net.innerAt(road, s);
          if (inner > w / 2 - 0.05) continue;
          const m = inner + MEDIAN_W / 2;
          if (clear(p.x - fz * m, p.z + fx * m)) add(p.x - fz * m, p.z + fx * m, Math.atan2(p.dx, p.dz), PROP.MEDIAN_LAMP, road);
        }
      } else if (w >= 8 || (dens > 0.5 && type <= 4)) {
        let side = 1;
        for (let s = net.trimStart(road) + r.range(4, 14); s < len - net.trimEnd(road) - 4; s += r.range(28, 36)) {
          net.pointAt(road, s, p);
          const off = w / 2 + 0.7;
          if (kerb) side = kerb;
          const x = p.x + p.dz * side * off, z = p.z - p.dx * side * off;
          if (!this._overlapsLots(x, z, 0.3, 0.3, 0, 0) && clear(x, z)) add(x, z, Math.atan2(p.dx, p.dz) + (side > 0 ? Math.PI / 2 : -Math.PI / 2), PROP.LAMP, road);
          side = -side;
        }
      } else if (dens > 0.12) {
        const side = r.chance(0.5) ? 1 : -1;
        for (let s = net.trimStart(road) + r.range(3, 12); s < len - net.trimEnd(road) - 3; s += r.range(26, 34)) {
          net.pointAt(road, s, p);
          const off = w / 2 + 0.55;
          const x = p.x + p.dz * side * off, z = p.z - p.dx * side * off;
          if (!this._overlapsLots(x, z, 0.3, 0.3, 0, 0) && clear(x, z)) add(x, z, Math.atan2(p.dx, p.dz), PROP.POLE, road);
        }
      }
      // Life at the corners: tea stalls, vada-pav carts, shrines, hoardings.
      if (dens > 0.35 && len > 30) {
        const n = type <= 3 ? 2 : 1;
        for (let k = 0; k < n; k++) {
          if (!r.chance(type <= 3 ? 0.4 : 0.14)) continue;
          const s = r.range(net.trimStart(road) + 4, len - net.trimEnd(road) - 4);
          if (s <= 0) continue;
          net.pointAt(road, s, p);
          const side = kerb || (r.chance(0.5) ? 1 : -1);
          const kind = r.pick([PROP.STALL, PROP.STALL, PROP.CART, PROP.CART, PROP.SHRINE, PROP.HOARDING]);
          const off = w / 2 + (kind === PROP.HOARDING ? 3.5 : 1.8);
          const x = p.x + p.dz * side * off, z = p.z - p.dx * side * off;
          const rad = kind === PROP.HOARDING ? 3 : 1.4;
          if (net.roadClearance(x, z, 10) < (kind === PROP.HOARDING ? 1.2 : 0.4) || this._overlapsLots(x, z, rad, rad * 0.6, 0, 0) || !clear(x, z)) continue;
          add(x, z, Math.atan2(-p.dz * side, p.dx * side), kind, road);
          this.lotGrid.insertRect(-200000 - P.x.length, x - rad, z - rad, x + rad, z + rad);
        }
      }
    }
    this._placeMarkets(add, clear);
    for (const k of ['x', 'z', 'rot', 'y']) P[k] = Float32Array.from(P[k]);
    P.kind = Uint8Array.from(P.kind);
    P.road = Int32Array.from(P.road);
    P.count = P.x.length;
  }

  /**
   * Sabzi markets: on busy old-town and market streets, vendors line the kerb with handcarts
   * and mats of vegetables and fruit. this.markets = [{ x, z, vendors: [prop index] }].
   */
  _placeMarkets(add, clear) {
    const net = this.net, P = this.props, p = {}, markets = (this.markets = []);
    const known = ['sarafa-bazar', 'old-mondha-clock-tower', 'hazur-sahib', 'shivaji-putla'].map(id => this.places.find(q => q.id === id)).filter(Boolean);
    const cands = [];
    for (let road = 0; road < net.count; road++) {
      if (net.type[road] < 3 || net.bridge[road] || net.raised[road] || net.width[road] < 4.8 || net.length[road] < 60) continue;
      net.pointAt(road, net.length[road] / 2, p);
      const zone = this.zoneAt(p.x, p.z), dens = this.densityAt(p.x, p.z);
      if ((zone !== ZONE.MARKET && zone !== ZONE.OLD) || dens < 0.45) continue;
      const nearKnown = known.some(q => Math.hypot(q.x - p.x, q.z - p.z) < 260);
      cands.push({ road, x: p.x, z: p.z, score: dens + (nearKnown ? 1 : 0) + (hash2(road, 7717) % 100) / 400 });
    }
    cands.sort((a, b) => b.score - a.score);
    for (const c of cands) {
      if (markets.length >= 14) break;
      if (markets.some(m => Math.hypot(m.x - c.x, m.z - c.z) < 550)) continue;
      const road = c.road, w = net.width[road], len = net.length[road], r = rng(hash2(road, 424243));
      const s0 = Math.max(net.trimStart(road) + 5, len / 2 - 36), s1 = Math.min(len - net.trimEnd(road) - 5, len / 2 + 36);
      const vendors = [];
      const sides = net.kerbSide(road) ? [net.kerbSide(road)] : [1, -1];
      for (const side of sides) {
        for (let s = s0 + r.range(0, 1.5); s < s1; s += r.range(2.8, 3.8)) {
          net.pointAt(road, s, p);
          const off = w / 2 + 0.95;
          const x = p.x + p.dz * side * off, z = p.z - p.dx * side * off;
          if (!clear(x, z) || this._overlapsLots(x, z, 1.1, 0.9, Math.atan2(p.dx, p.dz), 0) || net.roadClearance(x, z, 10) < 0.25) continue;
          // Local +z toward the road: the goods face the street.
          add(x, z, Math.atan2(-p.dz * side, p.dx * side), PROP.VENDOR, road, this.pavementAt(p.seg, off));
          vendors.push(P.x.length - 1);
          this.lotGrid.insertRect(-200000 - P.x.length, x - 1.2, z - 1.2, x + 1.2, z + 1.2);
        }
      }
      if (vendors.length >= 8) markets.push({ x: c.x, z: c.z, road, vendors });
    }
  }

  _indexChunks() {
    const idx = (this.chunkIndex = new Map());
    const get = (x, z) => {
      const k = chunkKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
      let c = idx.get(k);
      if (!c) idx.set(k, (c = { lots: [], trees: [], props: [], roads: new Set(), places: [] }));
      return c;
    };
    const L = this.lots;
    for (let i = 0; i < L.count; i++) get(L.x[i], L.z[i]).lots.push(i);
    for (let i = 0; i < this.trees.count; i++) get(this.trees.x[i], this.trees.z[i]).trees.push(i);
    for (let i = 0; i < this.props.count; i++) get(this.props.x[i], this.props.z[i]).props.push(i);
    for (const pump of this.pumps) (get(pump.x, pump.z).pumps ||= []).push(pump);
    for (let i = 0; i < this.places.length; i++) get(this.places[i].x, this.places[i].z).places.push(i);
    // Each road segment belongs to the chunk holding its midpoint.
    const net = this.net;
    this.segChunk = new Map();
    for (let r = 0; r < net.count; r++) {
      for (let i = net.ptStart[r]; i < net.ptStart[r + 1] - 1; i++) {
        const c = get((net.px[i] + net.px[i + 1]) / 2, (net.pz[i] + net.pz[i + 1]) / 2);
        c.roads.add(r);
        (c.segs || (c.segs = [])).push(i);
      }
    }
    // Junction pads belong to the chunk holding the junction, railway segments to the one holding their middle.
    for (let j = 0; j < net.junctionCount; j++) (get(net.jx[j], net.jz[j]).junctions ||= []).push(j);
    this.rails.forEach((line, l) => {
      for (let i = 0; i + 3 < line.length; i += 2) (get((line[i] + line[i + 2]) / 2, (line[i + 1] + line[i + 3]) / 2).rails ||= []).push(l, i);
    });
    for (const piece of airfieldPieces(this.world.airfield)) (get(piece.x, piece.z).airfield ||= []).push(piece);
    this.bumps.bumps.forEach((b, i) => (get(b.x, b.z).bumps ||= []).push(i));
    this.bumps.holes.forEach((h, i) => (get(h.x, h.z).holes ||= []).push(i));
  }

  chunk(cx, cz) { return this.chunkIndex.get(chunkKey(cx, cz)); }
}

// Half the width of the cleared strip along a runway: the 45 m runway and its grass shoulders.
export const AIRSTRIP_HW = 46;

// A petrol pump's forecourt: [half along the road, half deep].
export const PUMP_HW = 14, PUMP_HD = 9.5;

// Lots this close to Hazur Sahib keep to two storeys.
const HERITAGE_R = 140;

// The station's ground: its building (16 m deep) and Platform 1 (7.5 m) between the street and the line.
export const STATION_HD = 11.75;
// The bus stand's: [half width, half depth] for its bays, shed and building.
export const BUS_STAND = [26, 13];

// Landmarks that need more ground than their catalogue footprint: [half width, half depth, min scale].
export const BIG_PLACES = {
  'hazur-sahib': [26, 26, 0.42], 'sggs-stadium': [21, 17.5], 'nanded-station': [34, STATION_HD], 'nandgiri-fort': [34, 14],
  'visava-garden': [18.5, 17], 'nanded-bus-stand': BUS_STAND, 'kaleshwar-temple': [10, 13, 0.6], 'nanded-airport': [22, 12],
  'langar-sahib': [12, 14], 'nagina-ghat': [8, 8], 'sangat-sahib': [8, 8], 'mata-sahib': [8, 8], 'old-mondha-clock-tower': [3.4, 3.4],
};

export const PROP = { LAMP: 0, MEDIAN_LAMP: 1, POLE: 2, STALL: 3, CART: 4, SHRINE: 5, HOARDING: 6, SIGNAL: 7, VENDOR: 8 };

function lotParams(zone, dens, roadType, r) {
  const major = roadType <= 3;
  switch (zone) {
    case ZONE.OLD: return { f0: 4.5, f1: 8.5, d0: 7, d1: 13, s0: 0.5, s1: 1.2, g0: 0, g1: 0.3, prob: 0.96 };
    case ZONE.COACHING: return major ? { f0: 8, f1: 15, d0: 10, d1: 16, s0: 1.6, s1: 3, g0: 0.2, g1: 1.5, prob: 0.95 } : { f0: 6, f1: 11, d0: 8, d1: 14, s0: 1.2, s1: 2.6, g0: 0.3, g1: 2.5, prob: 0.92 };
    case ZONE.MARKET: return { f0: 5, f1: 10, d0: 8, d1: 15, s0: 0.8, s1: 1.8, g0: 0, g1: 0.8, prob: 0.95 };
    case ZONE.CAMPUS: return { f0: 10, f1: 20, d0: 10, d1: 18, s0: 3, s1: 8, g0: 4, g1: 14, prob: 0.6 };
    case ZONE.RURAL: return { f0: 6, f1: 11, d0: 6, d1: 10, s0: 2, s1: 6, g0: 8, g1: 40, prob: dens > 0.08 ? 0.45 : 0.2 };
    default: {
      const tight = dens > 0.55;
      return major
        ? { f0: 6, f1: 11, d0: 9, d1: 15, s0: 1.2, s1: 2.2, g0: 0, g1: tight ? 0.8 : 2.5, prob: 0.93 }
        : { f0: 6.5, f1: 10.5, d0: 8, d1: 13, s0: 1, s1: 2.6, g0: tight ? 0.4 : 1.2, g1: tight ? 2 : 5, prob: tight ? 0.9 : 0.75 };
    }
  }
}

function pickStyle(zone, dens, roadType, hw, hd, r) {
  const major = roadType <= 3;
  switch (zone) {
    case ZONE.OLD:
      return r.chance(major ? 0.35 : 0.15) ? { style: STYLE.SHOPHOUSE, floors: r.int(2, 3) } : { style: STYLE.OLD, floors: r.int(1, 3) };
    case ZONE.COACHING:
      if (major) return r.chance(0.55) ? { style: STYLE.COMMERCIAL, floors: r.int(3, 6) } : { style: STYLE.SHOPHOUSE, floors: r.int(2, 4) };
      return r.chance(0.3) ? { style: STYLE.APARTMENT, floors: r.int(3, 5) } : r.chance(0.25) ? { style: STYLE.SHOPHOUSE, floors: r.int(2, 3) } : { style: STYLE.HOUSE, floors: r.int(1, 3) };
    case ZONE.MARKET:
      if (major) return r.chance(0.75) ? { style: STYLE.SHOPHOUSE, floors: r.int(1, 3) } : { style: STYLE.SHED, floors: 1 };
      return r.chance(0.35) ? { style: STYLE.SHED, floors: 1 } : r.chance(0.4) ? { style: STYLE.SHOPHOUSE, floors: r.int(1, 2) } : { style: STYLE.HOUSE, floors: r.int(1, 2) };
    case ZONE.CAMPUS:
      return r.chance(0.6) ? { style: STYLE.INSTITUTION, floors: r.int(2, 4) } : { style: STYLE.APARTMENT, floors: r.int(2, 4) };
    case ZONE.RURAL:
      return r.chance(0.5) ? { style: STYLE.HUT, floors: 1 } : r.chance(0.2) ? { style: STYLE.SHED, floors: 1 } : r.chance(0.15) ? { style: STYLE.UNFINISHED, floors: 1 } : { style: STYLE.HOUSE, floors: r.int(1, 2) };
    default:
      if (major) return r.chance(0.6) ? { style: STYLE.SHOPHOUSE, floors: r.int(1, 3) } : r.chance(0.4) ? { style: STYLE.APARTMENT, floors: r.int(3, 4) } : { style: STYLE.HOUSE, floors: r.int(2, 3) };
      if (r.chance(0.08)) return { style: STYLE.UNFINISHED, floors: r.int(1, 2) };
      if (dens > 0.6 && r.chance(0.18)) return { style: STYLE.APARTMENT, floors: r.int(3, 4) };
      return r.chance(0.08) ? { style: STYLE.SHOPHOUSE, floors: r.int(1, 2) } : { style: STYLE.HOUSE, floors: r.int(1, 3) };
  }
}

/** Distance between a segment and an oriented box (0 when they touch). c/s = cos/sin of box rot. */
export function segBoxDist(ax, az, bx, bz, x, z, hw, hd, c, s) {
  // Into box space (local x = (c, -s), local z = (s, c)).
  let dx = ax - x, dz = az - z;
  const lax = dx * c - dz * s, laz = dx * s + dz * c;
  dx = bx - x; dz = bz - z;
  const lbx = dx * c - dz * s, lbz = dx * s + dz * c;
  // Liang-Barsky clip: does the segment cross the box?
  const ddx = lbx - lax, ddz = lbz - laz;
  let t0 = 0, t1 = 1, inside = true;
  if (Math.abs(ddx) < 1e-9) { if (Math.abs(lax) > hw) inside = false; }
  else {
    let ta = (-hw - lax) / ddx, tb = (hw - lax) / ddx;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
    if (t0 > t1) inside = false;
  }
  if (inside) {
    if (Math.abs(ddz) < 1e-9) { if (Math.abs(laz) > hd) inside = false; }
    else {
      let ta = (-hd - laz) / ddz, tb = (hd - laz) / ddz;
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
      if (t0 > t1) inside = false;
    }
  }
  if (inside) return 0;
  let ex = Math.max(Math.abs(lax) - hw, 0), ez = Math.max(Math.abs(laz) - hd, 0);
  let best = ex * ex + ez * ez;
  ex = Math.max(Math.abs(lbx) - hw, 0); ez = Math.max(Math.abs(lbz) - hd, 0);
  best = Math.min(best, ex * ex + ez * ez);
  best = Math.min(best, pointSegDist2(-hw, -hd, lax, laz, lbx, lbz));
  best = Math.min(best, pointSegDist2(hw, -hd, lax, laz, lbx, lbz));
  best = Math.min(best, pointSegDist2(hw, hd, lax, laz, lbx, lbz));
  best = Math.min(best, pointSegDist2(-hw, hd, lax, laz, lbx, lbz));
  return Math.sqrt(best);
}
