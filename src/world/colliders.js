// Static collision world: every building, wall, tree trunk, pole, stall,
// bridge railing and median as an oriented box or a circle on the ground plane,
// standing from a base height y0 (0 on the ground; a flyover's railings ride on
// its deck) up h metres. Queries say at what level they are asked, so a car on a
// flyover and a car on the street beneath it never meet each other's walls.
import { SpatialGrid, clamp, pointSegDist2 } from '../core/math.js';
import { PROP, PUMP_HW, PUMP_HD, BENCH } from './citygen.js';
import { MEDIAN_W, SOLID_BELOW } from './roadnet.js';
import { placeColliders } from './landmarks.js';

export const SOLID = { OBB: 0, CIRCLE: 1 };

export class Colliders {
  constructor(city) {
    this.city = city;
    this.grid = new SpatialGrid(16);
    const cap = city.lots.count + city.trees.count + city.props.count + 20000;
    this.type = new Uint8Array(cap);
    this.x = new Float32Array(cap); this.z = new Float32Array(cap);
    this.hw = new Float32Array(cap); this.hd = new Float32Array(cap);
    this.c = new Float32Array(cap); this.s = new Float32Array(cap);
    this.h = new Float32Array(cap);
    this.y0 = new Float32Array(cap);
    this.n = 0;
    this._q = 0; // resolveCircle's query number
    this._build();
  }

  /** Double the arrays when full (a busy city outgrows any fixed estimate). */
  _grow() {
    const cap = this.type.length * 2;
    for (const k of ['type', 'x', 'z', 'hw', 'hd', 'c', 's', 'h', 'y0']) { const a = new this[k].constructor(cap); a.set(this[k]); this[k] = a; }
    this._mark = null;
  }

  addBox(x, z, hw, hd, rot, h, y0 = 0) {
    if (this.n >= this.type.length) this._grow();
    const i = this.n++;
    this.type[i] = SOLID.OBB; this.x[i] = x; this.z[i] = z; this.hw[i] = hw; this.hd[i] = hd;
    this.c[i] = Math.cos(rot); this.s[i] = Math.sin(rot); this.h[i] = h; this.y0[i] = y0;
    const e = Math.abs(hw * this.c[i]) + Math.abs(hd * this.s[i]), f = Math.abs(hw * this.s[i]) + Math.abs(hd * this.c[i]);
    this.grid.insertRect(i, x - e, z - f, x + e, z + f);
    return i;
  }
  addCircle(x, z, r, h, y0 = 0) {
    if (this.n >= this.type.length) this._grow();
    const i = this.n++;
    this.type[i] = SOLID.CIRCLE; this.x[i] = x; this.z[i] = z; this.hw[i] = r; this.hd[i] = r; this.c[i] = 1; this.s[i] = 0; this.h[i] = h; this.y0[i] = y0;
    this.grid.insertRect(i, x - r, z - r, x + r, z + r);
    return i;
  }

  _build() {
    const { city } = this;
    const L = city.lots;
    for (let i = 0; i < L.count; i++) {
      // A building on the river valley's slope stands on its plinth, down to the ground.
      const base = city.footing(i);
      this.addBox(L.x[i], L.z[i], L.hw[i], L.hd[i], L.rot[i], L.h[i] + 1 - base, base);
      const c = Math.cos(L.rot[i]), s = Math.sin(L.rot[i]);
      const front = (lz, d) => [L.x[i] + (lz - d / 2) * s, L.z[i] + (lz - d / 2) * c];
      // The raised platform along a shop front (too high to drive or walk through).
      const ota = city.shopPlatform(i);
      if (ota > 0) { const [x, z] = front(-L.hd[i], ota); this.addBox(x, z, L.hw[i] - 0.05, ota / 2, L.rot[i], 0.35); }
      // Compound wall in front of a house, and its gate (drawn shut, so it is solid too).
      if (city.compoundWall(i)) {
        const f = -L.hd[i] - 1.6 + 0.1, half = (L.hw[i] - 0.8) / 2;
        for (const side of [-1, 1]) {
          const lx = side * (0.8 + half);
          this.addBox(L.x[i] + lx * c + f * s, L.z[i] - lx * s + f * c, half, 0.12, L.rot[i], 1.25);
        }
        const fg = -L.hd[i] - 1.6; // the gate hangs on the wall's outer face
        this.addBox(L.x[i] + fg * s, L.z[i] + fg * c, 0.8, 0.06, L.rot[i], 1.2);
      }
    }
    for (const p of city.places) for (const b of placeColliders(p)) b.r ? this.addCircle(b.x, b.z, b.r, b.h) : this.addBox(b.x, b.z, b.hw, b.hd, b.rot, b.h);
    // Petrol pumps: canopy columns, dispenser islands, the kiosk and the price board.
    for (const pump of city.pumps || []) {
      const { x, z, rot, k } = pump, c = Math.cos(rot), s = Math.sin(rot), at = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
      const cw = 8.5 * k, cd = 4.6 * k;
      for (const [lx, lz] of [[-cw + 1.2, -cd + 1.2], [cw - 1.2, -cd + 1.2], [-cw + 1.2, cd - 1.2], [cw - 1.2, cd - 1.2]]) { const [px, pz] = at(lx, lz - 1.5); this.addCircle(px, pz, 0.25, 5); }
      for (const lx of [-3.6 * k, 3.6 * k]) { const [px, pz] = at(lx, -1.5); this.addBox(px, pz, 0.6, 2.2, rot, 1.9); }
      { const [px, pz] = at(PUMP_HW * k - 5 * k, PUMP_HD * k - 2.4); this.addBox(px, pz, 3.6 * k, 2.2, rot, 3.5); }
      { const [px, pz] = at(-PUMP_HW * k + 1.2, -PUMP_HD * k + 0.2); this.addBox(px, pz, 0.95, 0.4, rot, 6.4); }
    }
    const T = city.trees;
    for (let i = 0; i < T.count; i++) {
      // A tree down the riverbank stands from the ground there, as tall as ever above the street.
      const base = Math.min(0, city.groundHeight(T.x[i], T.z[i]));
      this.addCircle(T.x[i], T.z[i], T.kind[i] === 2 ? 0.75 : T.kind[i] === 5 ? 0.6 : 0.32, (T.kind[i] === 5 ? 1.2 : 2.5) - base, base);
    }
    const P = city.props;
    for (let i = 0; i < P.count; i++) {
      const k = P.kind[i], x = P.x[i], z = P.z[i], rot = P.rot[i];
      if (k === PROP.LAMP || k === PROP.POLE) this.addCircle(x, z, 0.18, 8, P.y[i]);
      else if (k === PROP.MEDIAN_LAMP) this.addCircle(x, z, 0.3, 8, P.y[i]);
      else if (k === PROP.STALL) {
        this.addBox(x, z, 1.05, 0.85, rot, 2.2);
        // Its bench, where chunks.js draws it (if it has one).
        const side = city.stallBench(i), c = Math.cos(rot), s = Math.sin(rot), lx = side * BENCH.x;
        if (side) this.addBox(x + lx * c + BENCH.z * s, z - lx * s + BENCH.z * c, BENCH.hw, BENCH.hd, rot, BENCH.h);
      }
      else if (k === PROP.CART) this.addBox(x, z, 0.95, 0.6, rot, 1.2);
      else if (k === PROP.SHRINE) this.addBox(x, z, 0.75, 0.75, rot, 2.5);
      else if (k === PROP.VENDOR) this.addBox(x, z, 1.0, 0.75, rot, 1.2);
      else if (k === PROP.HOARDING) { const c = Math.cos(rot), s = Math.sin(rot); this.addCircle(x + c * 2.2, z - s * 2.2, 0.15, 8); this.addCircle(x - c * 2.2, z + s * 2.2, 0.15, 8); }
    }
    // Bridge railings and flyover ramps, piece by piece along each straight stretch of the
    // polyline as chunks.js draws them (a flyover in 4 m pieces), and the medians along the runs
    // chunks.js draws them in (see medianRuns). One piece laid across a bend would leave the drawn
    // line: an invisible wall in the lane on one side of it and a gap through it on the other.
    const net = city.net, p = {}, q = {}, { others, gather, onOther } = otherStreets(net);
    // clear[j] says whether the j-th of a piece's evenly spaced cross-sections is clear: lay(j, k)
    // each run between two of them with every one in between clear too.
    const clear = [];
    const runs = lay => {
      for (let j = 0, n = clear.length - 1; j < n; j++) {
        if (!clear[j] || !clear[j + 1]) continue;
        let k = j + 1;
        while (k < n && clear[k + 1]) k++;
        lay(j, k);
        j = k;
      }
    };
    for (let r = 0; r < net.count; r++) {
      const w = net.width[r], lift = net.raised[r];
      // A carriageway of a divided road has its half of the median on its right (ms: +1 left of a->b, -1 right).
      const ms = net.oneway[r] ? -net.oneway[r] : 0;
      const bridge = net.bridge[r];
      if (!bridge && !lift) continue;
      const s0 = net.trimStart(r), s1 = net.length[r] - net.trimEnd(r), step = lift ? 4 : 8;
      for (let i = net.ptStart[r]; i < net.ptStart[r + 1] - 1; i++) {
        const sa = Math.max(net.cum[i], s0), sb = Math.min(net.cum[i + 1], s1);
        if (sb - sa < 0.05) continue;
        const n = Math.ceil((sb - sa) / step);
        for (let k = 0; k < n; k++) {
          const s = sa + ((sb - sa) * k) / n, e = sa + ((sb - sa) * (k + 1)) / n, sm = (s + e) / 2;
          net.pointAt(r, sm, p);
          const rot = Math.atan2(p.dx, p.dz);
          const half = (e - s) / 2;
          const inner = ms ? net.innerAt(r, sm) : w / 2, divided = inner < w / 2 - 0.05;
          const dA = lift ? net.deckAt(r, s) : 0, dB = lift ? net.deckAt(r, e) : 0, lo = Math.min(dA, dB), hi = Math.max(dA, dB);
          if (bridge || hi > 0.05) {
            // Railings ride on a deck you can pass under; a low ramp is walled down to the ground.
            const y0 = lo >= SOLID_BELOW ? lo - 0.3 : 0, top = hi + 1.0, low = lift && y0 === 0;
            for (const side of [1, -1]) {
              const mid = side === ms && divided, off = mid ? inner - 0.15 : w / 2 + 0.2, hw = mid ? 0.15 : 0.2;
              const x = p.x + p.dz * off * side, z = p.z - p.dx * off * side, len = half + 0.3;
              // A low ramp's wall down to the ground is left open to a street that runs through it,
              // as its closing box is (below): the map lays service roads half under their ramps,
              // and their traffic drives on through. Only to a street that never leaves the ground
              // (onOther counts no deck at all): another ramp beside it, such as the other
              // carriageway of its divided road coming down, is no street. There the deck keeps a
              // parapet for its own traffic, from 2 m up (or on a deck higher than that), out of
              // the way of anything on the street (see _atLevel); but none where the deck is still
              // within a STEP of the street, where a car just drives on or off it. Tested every
              // 0.25 m along the wall, on both faces and down the middle.
              if (low) gather(r, x, z, len + hw);
              if (!low || !others.length) { this.addBox(x, z, hw, len, rot, top - y0, y0); continue; }
              const m = Math.ceil((2 * len) / 0.25), along = j => -len + (2 * len * j) / m;
              clear.length = 0;
              for (let j = 0; j <= m; j++) {
                const lz = along(j);
                clear.push([-hw, 0, hw].every(lx => !onOther(x + p.dz * lx + p.dx * lz, z - p.dx * lx + p.dz * lz, 0, 0)));
              }
              const box = (j, k, from, to) => {
                const lz = (along(j) + along(k)) / 2;
                this.addBox(x + p.dx * lz, z + p.dz * lz, hw, (along(k) - along(j)) / 2, rot, to - from, from);
              };
              const rail = Math.max(lo - 0.3, 2);
              const parapet = (j, k) => { if (k > j && lo >= STEP) box(j, k, rail, Math.max(top, rail + 0.5)); };
              let last = 0;
              runs((j, k) => { parapet(last, j); box(j, k, 0, top); last = k; });
              parapet(last, m);
            }
            if (lo < SOLID_BELOW && hi >= SOLID_BELOW) {
              // Here the deck comes down onto its solid embankment, and chunks.js slopes the
              // underside from the deck to the ground across this piece. Close its lower half,
              // where the slope comes down below a car's roof, across the carriageway: else a car
              // or someone on foot under the deck goes on into the ramp. It stays below the deck,
              // so the deck's own traffic passes over it. Out to the embankment's sides: 0.35 m
              // past the kerb edge, and on the edge on a divided road's median side. But not across
              // a street that runs on under the ramp here (a service road the map lays half under
              // it): its traffic drives on through, and so must everyone else. Tested every 0.25 m
              // across, at the box's front, middle and back.
              net.pointAt(r, dA > dB ? (sm + e) / 2 : (s + sm) / 2, q);
              const out = side => (side === ms && divided ? 0 : 0.35);
              const eL = net.edgeAt(r, sm, 1) + out(1), eR = net.edgeAt(r, sm, -1) + out(-1);
              const m = Math.ceil((eL + eR) / 0.25), across = j => -eR + ((eL + eR) * j) / m;
              gather(r, q.x, q.z, Math.hypot(Math.max(eL, eR), half / 2));
              clear.length = 0;
              for (let j = 0; j <= m; j++) {
                const lx = across(j);
                clear.push(!others.length || [-half / 2, 0, half / 2].every(lz => !onOther(q.x + p.dz * lx + p.dx * lz, q.z - p.dx * lx + p.dz * lz, 0)));
              }
              runs((j, k) => {
                const off = (across(j) + across(k)) / 2;
                this.addBox(q.x + p.dz * off, q.z - p.dx * off, (across(k) - across(j)) / 2, half / 2, rot, Math.max(0.5, lo - 1.1));
              });
            }
          }
        }
      }
      if (lift) for (const pier of net.deckPiers(r)) this.addCircle(pier.x, pier.z, 0.6, pier.d - 1.1);
      // A river bridge's piers, span by span as chunks.js draws them: in the way down on the bank.
      else if (bridge) {
        for (let i = net.ptStart[r]; i < net.ptStart[r + 1] - 1; i++) {
          const sa = Math.max(net.cum[i], s0), sb = Math.min(net.cum[i + 1], s1);
          if (sb - sa < 0.05) continue;
          const a = net.pointAt(r, sa, {}), b = net.pointAt(r, sb, {});
          const hw = Math.max(net.edgeAt(r, sa, 1), net.edgeAt(r, sa, -1), net.edgeAt(r, sb, 1), net.edgeAt(r, sb, -1));
          city.riverPiers(a.x, a.z, b.x, b.z, hw, (x, z, y0, y1, hx, hz, rot) => this.addBox(x, z, hx, hz, rot, y1 - y0, y0));
        }
      }
    }
    // The medians, along the runs chunks.js draws them in: a divided carriageway's half from its
    // edge out to the middle, or a wide two-way road's whole median down the centre line, hw
    // either side of `edge + out` (left of the centre line). In pieces at most 8 m long, and where
    // the carriageways close in and the median narrows towards a junction, short enough for its
    // slanting edge to stay within TAPER / 2 of them (else one end of a long one stands in the lane).
    const TAPER = 0.2, all = medianRuns(net);
    for (let r = 0; r < net.count; r++) {
      const lay = all[r];
      if (!lay) continue;
      const ms = net.oneway[r] ? -net.oneway[r] : 0, hw = ms ? MEDIAN_W / 4 : 0.35, out = ms ? ms * hw : hw;
      for (let k = 0; k < lay.length; k += 2) {
        for (let i = net.pointAt(r, lay[k], p).seg; i < net.ptStart[r + 1] - 1 && net.cum[i] < lay[k + 1]; i++) {
          const a = Math.max(lay[k], net.cum[i]), b = Math.min(lay[k + 1], net.cum[i + 1]);
          if (b - a < 0.01) continue;
          const dk = (net.inner[i + 1] - net.inner[i]) / (net.cum[i + 1] - net.cum[i]); // net.innerAt, read off this segment
          const n = Math.ceil((b - a) / (ms && dk ? Math.min(8, Math.max(1, TAPER / Math.abs(dk))) : 8));
          for (let j = 0; j < n; j++) {
            const u = a + ((b - a) * (j + 0.5)) / n, off = (ms ? ms * (net.inner[i] + dk * (u - net.cum[i])) : -0.35) + out;
            net.pointAt(r, u, p);
            this.addBox(p.x + p.dz * off, p.z - p.dx * off, hw, (b - a) / n / 2, Math.atan2(p.dx, p.dz), 0.35);
          }
        }
      }
    }
  }

  /** fn(i) for colliders near the rect. Indices may repeat. */
  near(minX, minZ, maxX, maxZ, fn) { return this.grid.query(minX, minZ, maxX, maxZ, fn); }

  /** Does collider i stand in the way of something at height `level` (about 2 m tall)? */
  _atLevel(i, level) { return this.y0[i] < level + 2 && this.y0[i] + this.h[i] > level + 0.3; }

  /**
   * Push a circle out of everything it overlaps. Mutates pos {x, z}; returns the
   * accumulated push normal (out.nx/out.nz) and whether anything was hit.
   */
  resolveCircle(pos, r, out, maxH = Infinity, level = 0) {
    let hit = false;
    out.nx = 0; out.nz = 0;
    // Walks the grid cells itself, marking each collider with this query's number so one that
    // spans several cells is resolved once: no closure or set per call, as every walker,
    // vehicle and the player call this each frame.
    const mark = this._mark || (this._mark = new Uint32Array(this.type.length));
    let q = (this._q + 1) >>> 0;
    if (q === 0) { mark.fill(0); q = 1; }
    this._q = q;
    const G = this.grid, C = G.cell;
    const x0 = Math.floor((pos.x - r) / C), x1 = Math.floor((pos.x + r) / C), z0 = Math.floor((pos.z - r) / C), z1 = Math.floor((pos.z + r) / C);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gz = z0; gz <= z1; gz++) {
        const list = G.map.get(G.key(gx, gz));
        if (!list) continue;
        for (let k = 0; k < list.length; k++) {
          const i = list[k];
          if (mark[i] === q) continue;
          mark[i] = q;
          if (this.h[i] < 0.3 || this.h[i] > maxH + 100 || !this._atLevel(i, level)) continue;
          if (this.type[i] === SOLID.CIRCLE) {
            const dx = pos.x - this.x[i], dz = pos.z - this.z[i];
            const rr = r + this.hw[i], d2 = dx * dx + dz * dz;
            if (d2 >= rr * rr) continue;
            const d = Math.sqrt(d2) || 1e-4;
            const push = rr - d;
            pos.x += (dx / d) * push; pos.z += (dz / d) * push;
            out.nx += dx / d; out.nz += dz / d; hit = true;
            continue;
          }
          const c = this.c[i], s = this.s[i];
          const dx = pos.x - this.x[i], dz = pos.z - this.z[i];
          const lx = dx * c - dz * s, lz = dx * s + dz * c;
          const hw = this.hw[i], hd = this.hd[i];
          const cx = clamp(lx, -hw, hw), cz = clamp(lz, -hd, hd);
          const ex = lx - cx, ez = lz - cz;
          const d2 = ex * ex + ez * ez;
          if (d2 >= r * r) continue;
          let nlx, nlz, depth;
          if (d2 > 1e-10) { const d = Math.sqrt(d2); nlx = ex / d; nlz = ez / d; depth = r - d; }
          else {
            const px = hw - Math.abs(lx), pz = hd - Math.abs(lz);
            if (px < pz) { nlx = lx < 0 ? -1 : 1; nlz = 0; depth = px + r; } else { nlx = 0; nlz = lz < 0 ? -1 : 1; depth = pz + r; }
          }
          const nx = nlx * c + nlz * s, nz = -nlx * s + nlz * c;
          pos.x += nx * depth; pos.z += nz * depth;
          out.nx += nx; out.nz += nz; hit = true;
        }
      }
    }
    if (hit) { const l = Math.hypot(out.nx, out.nz) || 1; out.nx /= l; out.nz /= l; }
    return hit;
  }

  /**
   * Deepest penetration of an oriented box (a vehicle) into the static world.
   * Writes {nx, nz, depth, px, pz} (normal pushes the vehicle out; p = contact point).
   */
  boxContact(x, z, hw, hd, rot, out, level = 0) {
    const ca = Math.cos(rot), sa = Math.sin(rot);
    const ext = Math.abs(hw * ca) + Math.abs(hd * sa) + 0.5, ezt = Math.abs(hw * sa) + Math.abs(hd * ca) + 0.5;
    let best = 0;
    const seen = this._seen2 || (this._seen2 = new Set());
    seen.clear();
    // Vehicle axes: local x = (ca, -sa), local z = (sa, ca).
    this.grid.query(x - ext, z - ezt, x + ext, z + ezt, i => {
      if (seen.has(i)) return;
      seen.add(i);
      if (this.h[i] < 0.3 || !this._atLevel(i, level)) return;
      if (this.type[i] === SOLID.CIRCLE) {
        // Circle vs vehicle box.
        const dx = this.x[i] - x, dz = this.z[i] - z;
        const lx = dx * ca - dz * sa, lz = dx * sa + dz * ca;
        const cx = clamp(lx, -hw, hw), cz = clamp(lz, -hd, hd);
        const ex = lx - cx, ez = lz - cz, d2 = ex * ex + ez * ez, r = this.hw[i];
        let nlx, nlz, depth;
        if (d2 > 1e-10) { if (d2 >= r * r) return; const d = Math.sqrt(d2); nlx = -ex / d; nlz = -ez / d; depth = r - d; }
        else { const px = hw - Math.abs(lx), pz = hd - Math.abs(lz); if (px < pz) { nlx = lx > 0 ? -1 : 1; nlz = 0; depth = px + r; } else { nlx = 0; nlz = lz > 0 ? -1 : 1; depth = pz + r; } }
        if (depth > best) {
          best = depth;
          out.nx = nlx * ca + nlz * sa; out.nz = -nlx * sa + nlz * ca; out.depth = depth;
          out.px = this.x[i] - out.nx * r; out.pz = this.z[i] - out.nz * r;
        }
        return;
      }
      const res = obbSat(x, z, hw, hd, ca, sa, this.x[i], this.z[i], this.hw[i], this.hd[i], this.c[i], this.s[i], this._sat || (this._sat = {}));
      if (res && res.depth > best) {
        best = res.depth;
        out.nx = res.nx; out.nz = res.nz; out.depth = res.depth;
        // Contact point: the vehicle corner deepest along -n.
        let bestP = -Infinity;
        for (const [u, v] of CORNERS) {
          const px = x + u * hw * ca + v * hd * sa, pz = z - u * hw * sa + v * hd * ca;
          const d = -(px * res.nx + pz * res.nz);
          if (d > bestP) { bestP = d; out.px = px; out.pz = pz; }
        }
      }
    });
    return best > 0 ? out : null;
  }

  /** First hit along a 3D segment (camera occlusion). Returns t in [0,1] or 1. */
  raycast(ax, ay, az, bx, by, bz, pad = 0.25) {
    let tmin = 1;
    const minX = Math.min(ax, bx) - pad, maxX = Math.max(ax, bx) + pad, minZ = Math.min(az, bz) - pad, maxZ = Math.max(az, bz) + pad;
    const seen = this._seen3 || (this._seen3 = new Set());
    seen.clear();
    this.grid.query(minX, minZ, maxX, maxZ, i => {
      if (seen.has(i)) return;
      seen.add(i);
      // Only walls block the view (thin compound walls included): poles, trunks and low kerbs never do.
      if (this.h[i] < 1.2 || this.type[i] === SOLID.CIRCLE) return;
      const hw = this.hw[i] + pad, hd = this.hd[i] + pad;
      const c = this.c[i], s = this.s[i];
      const ox = ax - this.x[i], oz = az - this.z[i];
      const lax = ox * c - oz * s, laz = ox * s + oz * c;
      const ex = bx - ax, ez = bz - az;
      const ldx = ex * c - ez * s, ldz = ex * s + ez * c;
      let t0 = 0, t1 = tmin;
      if (Math.abs(ldx) < 1e-9) { if (Math.abs(lax) > hw) return; }
      else { let ta = (-hw - lax) / ldx, tb = (hw - lax) / ldx; if (ta > tb) { const t = ta; ta = tb; tb = t; } t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return; }
      if (Math.abs(ldz) < 1e-9) { if (Math.abs(laz) > hd) return; }
      else { let ta = (-hd - laz) / ldz, tb = (hd - laz) / ldz; if (ta > tb) { const t = ta; ta = tb; tb = t; } t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return; }
      // Height check: the segment must pass between the obstacle's base and top.
      const y = ay + (by - ay) * t0, y1 = ay + (by - ay) * t1, top = this.y0[i] + this.h[i];
      if ((y > top && y1 > top) || (y < this.y0[i] && y1 < this.y0[i])) return;
      if (t0 < tmin) tmin = t0;
    });
    return tmin;
  }

  /** True when a circle at (x, z) overlaps anything solid (at height `level`). */
  blocked(x, z, r, level = 0) {
    const p = this._bp || (this._bp = { x: 0, z: 0 });
    p.x = x; p.z = z;
    return this.resolveCircle(p, r, this._bo || (this._bo = {}), Infinity, level);
  }
}

const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

// Half the width of the widest vehicle in a lane (a bus or truck): how far either side of a lane's
// line traffic reaches. And half a truck's length.
const LANE_HW = 1.25, LANE_HD = 3.8;
// A deck this little above the street is driven or walked straight onto (as net.surfaceAt steps).
const STEP = 0.6;

/**
 * Tests against the other roads at street level, for laying a median, a ramp's side wall or its
 * closing box. The map is at half scale and the road widths are not, so roads overlap: the arms
 * of a junction that meet at a narrow angle run into each other for metres before it, a divided
 * road's two carriageways converge into the one street they came from, a service road runs half
 * under its flyover's ramp. A median laid there, or a ramp's wall, stands in the other road's
 * lane, where nothing following it can pass (traffic, which drives its lanes, goes through). So
 * those are laid only where these find them clear, as citygen keeps the median lamps; a deck above
 * passes over, and the same street going on round a plain bend (a junction of just the two) is no
 * other. gather(r, x, z, R) collects the segments of roads other than r that could reach within R
 * of (x, z), once for a piece's tests (this runs while the game loads, on every median).
 */
function otherStreets(net) {
  const others = [], t = [0];
  const onward = (r, j) => {
    const l = net.jRoads[j], o = l[0] === r ? l[1] : l[0], ow = net.oneway;
    // (A divided carriageway is only going on as one that carries its traffic on, the same way.)
    const arrives = k => (net.rb[k] === j) === (ow[k] > 0);
    return l.length === 2 && !ow[r] === !ow[o] && (!ow[r] || arrives(r) !== arrives(o)) ? o : r;
  };
  // How far from its centre line road o's carriageway or its traffic reaches (a narrow street's
  // lane is less than a truck's width in from its kerb).
  const reachOf = o => Math.max(net.width[o] / 2, net.width[o] / 4 + LANE_HW);
  // The median-side edge v metres along the road, on (or past an end of) its segment j, as net.innerAt has it.
  const innerOn = (j, v) => {
    const span = net.cum[j + 1] - net.cum[j], f = span > 1e-6 ? Math.min(1, Math.max(0, (v - net.cum[j]) / span)) : 0;
    return net.inner[j] + (net.inner[j + 1] - net.inner[j]) * f;
  };
  return {
    others,
    gather(r, x, z, R) {
      const a = onward(r, net.ra[r]), b = onward(r, net.rb[r]), { px, pz } = net;
      others.length = 0;
      net.grid.query(x - R, z - R, x + R, z + R, i => {
        const o = net.ptRoad[i], reach = reachOf(o) + R;
        if (o !== r && o !== a && o !== b && pointSegDist2(x, z, px[i], pz[i], px[i + 1], pz[i + 1]) < reach * reach) others.push(i);
      });
    },
    /** Is (x, z) more than `slack` metres inside one of their carriageways (where its deck, if any, is below `below`)? */
    onOther(x, z, slack, below = 2) {
      for (const i of others) {
        const o = net.ptRoad[i], ax = net.px[i], az = net.pz[i], dx = net.px[i + 1] - ax, dz = net.pz[i + 1] - az;
        const d2 = pointSegDist2(x, z, ax, az, ax + dx, az + dz, t), hw = net.width[o] / 2 - slack;
        if (hw <= 0 || d2 >= hw * hw) continue;
        if (net.raised[o] && net.deckAt(o, net.cum[i] + (net.cum[i + 1] - net.cum[i]) * t[0]) >= below) continue;
        // Its edge on this side, as net.edgeAt has it but read off this segment (this runs a
        // few hundred thousand times while the game loads): a carriageway's median side stops short.
        const side = (x - ax - dx * t[0]) * dz - (z - az - dz * t[0]) * dx >= 0 ? 1 : -1;
        const edge = (net.oneway[o] && side === -net.oneway[o] ? net.inner[i] + (net.inner[i + 1] - net.inner[i]) * t[0] : net.width[o] / 2) - slack;
        if (edge > 0 && d2 < edge * edge) return true;
      }
      return false;
    },
    /**
     * Does traffic in one of their lanes reach (x, z), LANE_HW either side of the lane's line?
     * A two-way street's lanes run either side of its centre line out to the kerb lane (lane 0);
     * a one-way carriageway's between its kerb lane and its median lane (the same one where it is
     * narrow), and the middle that lanePath keeps to, all on the driver's left. Where its median
     * closes in towards a junction those lanes drift across, and a truck's straight body, LANE_HD
     * either way along, is where its lane was at its middle: so where they are that far along too.
     */
    inLane(x, z) {
      for (const i of others) {
        const o = net.ptRoad[i], ax = net.px[i], az = net.pz[i], dx = net.px[i + 1] - ax, dz = net.pz[i + 1] - az;
        const d2 = pointSegDist2(x, z, ax, az, ax + dx, az + dz, t), reach = reachOf(o);
        if (d2 >= reach * reach) continue;
        const s = net.cum[i] + (net.cum[i + 1] - net.cum[i]) * t[0], ow = net.oneway[o], w = net.width[o];
        if (net.raised[o] && net.deckAt(o, s) >= 2) continue;
        // Left of a->b is positive.
        const d = Math.sqrt(d2) * ((x - ax - dx * t[0]) * dz - (z - az - dz * t[0]) * dx >= 0 ? 1 : -1);
        // (The lanes as net.laneOffset has them, worked out here from the median-side edge read
        // off the polyline: this runs for every metre of every median beside another road.)
        if (!ow) { if (Math.abs(d) < (net.lanes[o] > 1 ? 0.375 : 0.25) * w + LANE_HW) return true; continue; }
        // The least and greatest median-side edge over a truck's length either way: the lanes
        // move with it, along straight lines, so they are furthest out at one or the other.
        const a = net.ptStart[o], b = net.ptStart[o + 1] - 1;
        let j = i, k0 = Infinity, k1 = -Infinity;
        for (; j > a && net.cum[j] > s - LANE_HD; j--) { k0 = Math.min(k0, net.inner[j]); k1 = Math.max(k1, net.inner[j]); }
        const back = innerOn(j, s - LANE_HD);
        for (j = i + 1; j < b && net.cum[j] < s + LANE_HD; j++) { k0 = Math.min(k0, net.inner[j]); k1 = Math.max(k1, net.inner[j]); }
        const on = innerOn(j - 1, s + LANE_HD);
        k0 = Math.min(k0, back, on); k1 = Math.max(k1, back, on);
        // Kerb lane and median lane, or the one lane where it is narrow (and lanePath's middle,
        // which lies between the two), towards the driver's left: ow * d is on that side.
        const hw = w / 2;
        let lo = Infinity, hi = -Infinity;
        for (let n = 0; n < 2; n++) {
          const k = n ? k1 : k0, W = hw + k, mid = (hw - k) / 2;
          const l0 = W < 6.4 ? mid + W * 0.08 : hw - W / 4, l1 = W < 6.4 ? mid : W / 4 - k;
          lo = Math.min(lo, l0, l1); hi = Math.max(hi, l0, l1);
        }
        if (ow * d > lo - LANE_HW && ow * d < hi + LANE_HW) return true;
      }
      return false;
    },
  };
}

const RUNS = new WeakMap();

/**
 * Where the medians run, so that chunks.js draws each one exactly where colliders.js makes it
 * solid: medianRuns(net)[r] is null, or road r's runs [from, to, from, to, ...] in metres along
 * it. A median runs where chunks.js draws one, along a divided carriageway's median side (where
 * the other carriageway is alongside) or down a wide two-way road's centre line, on the ground;
 * but not where it would stand in another road's lane (see otherStreets). It is tested a metre
 * at a time, at both of its edges, worked out once and kept.
 */
export function medianRuns(net) {
  let all = RUNS.get(net);
  if (all) return all;
  all = new Array(net.count).fill(null);
  RUNS.set(net, all);
  const { others, gather, inLane } = otherStreets(net), p = {};
  for (let r = 0; r < net.count; r++) {
    const w = net.width[r], lift = net.raised[r];
    // A carriageway of a divided road has its half of the median on its right (ms: +1 left of a->b, -1 right).
    const ms = net.oneway[r] ? -net.oneway[r] : 0;
    if (net.bridge[r] || (!ms && w < 11.5)) continue;
    // Its half from its median-side edge out to the middle, or the whole median down the centre
    // line: hw either side of `edge + out`, left of the centre line.
    const hw = ms ? MEDIAN_W / 4 : 0.35, out = ms ? ms * hw : hw, s0 = net.trimStart(r), s1 = net.length[r] - net.trimEnd(r), runs = [];
    for (let i = net.ptStart[r]; i < net.ptStart[r + 1] - 1; i++) {
      const sa = Math.max(net.cum[i], s0), sb = Math.min(net.cum[i + 1], s1);
      if (sb - sa < 0.05) continue;
      const c0 = net.cum[i], k0 = net.inner[i], dk = (net.inner[i + 1] - k0) / (net.cum[i + 1] - c0); // net.innerAt, read off this segment
      const edge = u => (ms ? ms * (k0 + dk * (u - c0)) : -0.35);
      // In the pieces chunks.js draws: a flyover's 4 m at a time, as its deck leaves the ground.
      const n = lift ? Math.max(1, Math.ceil((sb - sa) / 4)) : 1;
      for (let k = 0; k < n; k++) {
        const ca = sa + ((sb - sa) * k) / n, cb = sa + ((sb - sa) * (k + 1)) / n;
        if (lift && (net.deckAt(r, ca) > 0.05 || net.deckAt(r, cb) > 0.05)) continue;
        if (ms && !(net.edgeAt(r, ca, ms) < w / 2 - 0.05 || net.edgeAt(r, cb, ms) < w / 2 - 0.05)) continue;
        // Up to 8 m at a time for one gather, a cross-section a metre or less apart.
        for (let h = 0, n8 = Math.ceil((cb - ca) / 8); h < n8; h++) {
          const s = ca + ((cb - ca) * h) / n8, e = ca + ((cb - ca) * (h + 1)) / n8, sm = (s + e) / 2, m = Math.ceil(e - s);
          net.pointAt(r, sm, p);
          const sway = Math.max(Math.abs(edge(s) - edge(sm)), Math.abs(edge(e) - edge(sm)));
          gather(r, p.x + p.dz * (edge(sm) + out), p.z - p.dx * (edge(sm) + out), (e - s) / 2 + hw + sway);
          let was = false;
          for (let j = 0; j <= m; j++) {
            const u = s + ((e - s) * j) / m, x = p.x + p.dx * (u - sm), z = p.z + p.dz * (u - sm), a = edge(u), b = a + 2 * out;
            const clear = !others.length || (!inLane(x + p.dz * a, z - p.dx * a) && !inLane(x + p.dz * b, z - p.dx * b));
            // Each stretch between two clear cross-sections is laid, on from the last where they meet.
            if (clear && was) {
              const from = s + ((e - s) * (j - 1)) / m, last = runs.length - 1;
              if (last > 0 && Math.abs(runs[last] - from) < 1e-6) runs[last] = u; else runs.push(from, u);
            }
            was = clear;
          }
        }
      }
    }
    if (runs.length) all[r] = runs;
  }
  return all;
}

/** SAT for boxes given cos/sin; normal points from B to A. */
export function obbSat(ax, az, ahw, ahd, ac, as, bx, bz, bhw, bhd, bc, bs, out) {
  const axes = [ac, -as, as, ac, bc, -bs, bs, bc];
  const tx = ax - bx, tz = az - bz;
  let best = Infinity, bnx = 0, bnz = 0;
  for (let i = 0; i < 8; i += 2) {
    const nx = axes[i], nz = axes[i + 1];
    const ra = ahw * Math.abs(ac * nx - as * nz) + ahd * Math.abs(as * nx + ac * nz);
    const rb = bhw * Math.abs(bc * nx - bs * nz) + bhd * Math.abs(bs * nx + bc * nz);
    const d = tx * nx + tz * nz;
    const o = ra + rb - Math.abs(d);
    if (o <= 0) return null;
    if (o < best) { best = o; const sg = d < 0 ? -1 : 1; bnx = nx * sg; bnz = nz * sg; }
  }
  out.nx = bnx; out.nz = bnz; out.depth = best;
  return out;
}
