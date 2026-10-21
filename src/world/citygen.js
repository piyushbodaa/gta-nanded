// Procedural Nanded: zoning, building lots, trees and street furniture laid
// along the mapped streets. Everything is deterministic (seeded per road), so
// the city is identical on every visit and on every device.
import { SpatialGrid, rng, clamp, pointSegDist2, obbOverlap, hash2, smoothstep } from '../core/math.js';

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

export class City {
  constructor(world, net) {
    this.world = world;
    this.net = net;
    this.bounds = world.bounds;
    this.districts = world.districts.map(([name, x, z]) => ({ name, x, z }));
    this.places = world.places;
    this.rivers = world.rivers.map(r => ({ name: r.name, w: r.w, p: Float32Array.from(r.p) }));
    this.rails = world.rails.map(p => Float32Array.from(p));
    this._buildDensity();
    this._buildWaterIndex();
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

  /** Signed distance to the nearest river bank: negative in the water. Returns {d, w}. */
  riverDistance(x, z, out = {}) {
    let best = Infinity, bw = 0;
    this.waterGrid.query(x, z, x, z, id => {
      const s = this.waterSegs[id];
      const d = Math.sqrt(pointSegDist2(x, z, s[0], s[1], s[2], s[3])) - s[4] / 2;
      if (d < best) { best = d; bw = s[4]; }
    });
    out.d = best; out.w = bw;
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

  /** Ground height: flat city, with the river valleys cut into it. */
  groundHeight(x, z) {
    const r = this.riverDistance(x, z, this._rd || (this._rd = {}));
    if (r.d > 14) return 0;
    if (r.d > 0) return -3.2 * (1 - smoothstep(0, 14, r.d));
    return -3.2 - Math.min(1.5, -r.d * 0.08);
  }

  // ---------------------------------------------------------------- generation
  generate(onProgress) {
    const t0 = performance.now();
    this._reserve();
    this._placeLots(onProgress);
    this._infill();
    this._placeTrees();
    this._placeProps();
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
    const net = this.net;
    for (let i = 0; i < this.places.length; i++) {
      const p = this.places[i];
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
    L.x[i] = x; L.z[i] = z; L.hw[i] = hw; L.hd[i] = hd; L.rot[i] = rot;
    L.floors[i] = floors; L.style[i] = style; L.seed[i] = seed; L.place[i] = place;
    const floorH = style === STYLE.SHED ? 4.2 : style === STYLE.HUT ? 3 : 3.2;
    L.h[i] = style === STYLE.SHED ? r.range(4.5, 7) : floors * floorH + (style === STYLE.SHOPHOUSE ? 0.4 : 0);
    const pal = style === STYLE.OLD ? PALETTES.old : style === STYLE.COMMERCIAL ? PALETTES.commercial
      : style === STYLE.SHED ? PALETTES.shed : style === STYLE.HUT ? PALETTES.hut
        : style === STYLE.INSTITUTION ? PALETTES.institution : PALETTES.house;
    L.color[i] = r.pick(pal);
    // Feature flags: 1 shops below, 2 parapet, 4 water tank, 8 stair room, 16 balconies,
    // 32 compound wall, 64 awning, 128 rooftop sign/banner, 256 dish, 512 side ad.
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
    return this.lotGrid.query(x - ext, z - ext, x + ext, z + ext, id => {
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
    net.grid.query(x - ext, z - ext, x + ext, z + ext, i => {
      const r = net.ptRoad[i];
      const rad = net.width[r] / 2 + margin;
      if (segBoxDist(net.px[i], net.pz[i], net.px[i + 1], net.pz[i + 1], x, z, hw, hd, c, s) < rad) { blocked = true; return true; }
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
          const setback = w / 2 + r.range(prm.s0, prm.s1);
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
        this._addLot(cx, cz, hw, hd, rot, floors, style, (r() * 4294967296) >>> 0, -1, zone, roadType);
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
    // Scattered trees in yards, fields and block interiors.
    const b = this.bounds;
    const step = 22;
    for (let gx = b.minX; gx < b.maxX; gx += step) {
      for (let gz = b.minZ; gz < b.maxZ; gz += step) {
        const r = rng(hash2(Math.round(gx), Math.round(gz)));
        const x = gx + r() * step, z = gz + r() * step;
        const dens = this.densityAt(x, z);
        if (dens < 0.02 && r.chance(0.85)) continue;
        const prob = dens > 0.6 ? 0.18 : dens > 0.3 ? 0.3 : 0.22;
        if (!r.chance(prob)) continue;
        if (!ok(x, z, 1.2)) continue;
        const zone = dens < 0.18 ? ZONE.RURAL : ZONE.RESIDENTIAL;
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
    const P = (this.props = { x: [], z: [], rot: [], kind: [], road: [] });
    const net = this.net, p = {};
    const add = (x, z, rot, kind, road) => { P.x.push(x); P.z.push(z); P.rot.push(rot); P.kind.push(kind); P.road.push(road); };
    for (let road = 0; road < net.count; road++) {
      const len = net.length[road], w = net.width[road], type = net.type[road];
      const r = rng(hash2(road, 15485863));
      net.pointAt(road, len / 2, p);
      const dens = this.densityAt(p.x, p.z);
      if (net.bridge[road]) {
        for (let s = 6; s < len - 6; s += 24) {
          net.pointAt(road, s, p);
          for (const side of [1, -1]) add(p.x + p.dz * side * (w / 2 - 0.2), p.z - p.dx * side * (w / 2 - 0.2), Math.atan2(p.dx, p.dz) + (side > 0 ? 0 : Math.PI), PROP.LAMP, road);
        }
        continue;
      }
      if (w >= 12) {
        // Twin-arm lamps down the median of the wide roads.
        for (let s = net.trimStart(road) + 8; s < len - net.trimEnd(road) - 8; s += 34) {
          net.pointAt(road, s, p);
          add(p.x, p.z, Math.atan2(p.dx, p.dz), PROP.MEDIAN_LAMP, road);
        }
      } else if (w >= 8 || (dens > 0.5 && type <= 4)) {
        let side = 1;
        for (let s = net.trimStart(road) + r.range(4, 14); s < len - net.trimEnd(road) - 4; s += r.range(28, 36)) {
          net.pointAt(road, s, p);
          const off = w / 2 + 0.7;
          const x = p.x + p.dz * side * off, z = p.z - p.dx * side * off;
          if (!this._overlapsLots(x, z, 0.3, 0.3, 0, 0)) add(x, z, Math.atan2(p.dx, p.dz) + (side > 0 ? Math.PI / 2 : -Math.PI / 2), PROP.LAMP, road);
          side = -side;
        }
      } else if (dens > 0.12) {
        const side = r.chance(0.5) ? 1 : -1;
        for (let s = net.trimStart(road) + r.range(3, 12); s < len - net.trimEnd(road) - 3; s += r.range(26, 34)) {
          net.pointAt(road, s, p);
          const off = w / 2 + 0.55;
          const x = p.x + p.dz * side * off, z = p.z - p.dx * side * off;
          if (!this._overlapsLots(x, z, 0.3, 0.3, 0, 0)) add(x, z, Math.atan2(p.dx, p.dz), PROP.POLE, road);
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
          const side = r.chance(0.5) ? 1 : -1;
          const kind = r.pick([PROP.STALL, PROP.STALL, PROP.CART, PROP.CART, PROP.SHRINE, PROP.HOARDING]);
          const off = w / 2 + (kind === PROP.HOARDING ? 3.5 : 1.8);
          const x = p.x + p.dz * side * off, z = p.z - p.dx * side * off;
          const rad = kind === PROP.HOARDING ? 3 : 1.4;
          if (net.roadClearance(x, z, 10) < (kind === PROP.HOARDING ? 1.2 : 0.4) || this._overlapsLots(x, z, rad, rad * 0.6, 0, 0)) continue;
          add(x, z, Math.atan2(-p.dz * side, p.dx * side), kind, road);
          this.lotGrid.insertRect(-200000 - P.x.length, x - rad, z - rad, x + rad, z + rad);
        }
      }
    }
    for (const k of ['x', 'z', 'rot']) P[k] = Float32Array.from(P[k]);
    P.kind = Uint8Array.from(P.kind);
    P.road = Int32Array.from(P.road);
    P.count = P.x.length;
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
    // Junction pads belong to the chunk holding the junction.
    for (let j = 0; j < net.junctionCount; j++) (get(net.jx[j], net.jz[j]).junctions ||= []).push(j);
  }

  chunk(cx, cz) { return this.chunkIndex.get(chunkKey(cx, cz)); }
}

// Landmarks that need more ground than their catalogue footprint: [half width, half depth, min scale].
export const BIG_PLACES = {
  'hazur-sahib': [26, 26, 0.42], 'sggs-stadium': [21, 17.5], 'nanded-station': [17, 13], 'nandgiri-fort': [34, 14],
  'visava-garden': [18.5, 17], 'nanded-bus-stand': [17, 6], 'kaleshwar-temple': [10, 13, 0.6], 'nanded-airport': [22, 12],
  'langar-sahib': [12, 14], 'nagina-ghat': [8, 8], 'sangat-sahib': [8, 8], 'mata-sahib': [8, 8], 'old-mondha-clock-tower': [3.4, 3.4],
};

export const PROP = { LAMP: 0, MEDIAN_LAMP: 1, POLE: 2, STALL: 3, CART: 4, SHRINE: 5, HOARDING: 6, SIGNAL: 7 };

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
