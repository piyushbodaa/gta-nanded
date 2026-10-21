// Radar (rotates with the camera) and the full city map with waypoints.
import { clamp } from '../core/math.js';

const ROAD_STYLE = [
  ['#e8e2cf', 1.9], ['#e0d9c4', 1.7], ['#d6cfba', 1.55], ['#c9c2ad', 1.35], ['#a9a392', 1.0], ['#8f8a7c', 0.85],
];

export class Minimap {
  constructor(game, canvas) {
    this.game = game;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.range = 170; // metres from the centre to the edge
    this.dpr = 1;
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
  }

  draw(blips, route) {
    const g = this.game, ctx = this.ctx, net = g.net;
    const W = this.canvas.width, H = this.canvas.height;
    if (!W) return;
    const pos = g.player.pos;
    const speed = g.player.vehicle ? Math.hypot(g.player.vehicle.vx, g.player.vehicle.vz) : 0;
    const range = this.range * (1 + clamp(speed / 30, 0, 1) * 0.6);
    const scale = (W / 2) / range;
    const rot = g.camera.facing - Math.PI; // the camera's facing points up
    ctx.save();
    ctx.fillStyle = '#3b4a3c';
    ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H * 0.62);
    ctx.rotate(rot);
    ctx.scale(scale, scale);
    ctx.translate(-pos.x, -pos.z);
    // Rivers.
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const river of g.city.rivers) {
      const p = river.p;
      ctx.beginPath();
      for (let i = 0; i < p.length; i += 2) i ? ctx.lineTo(p[i], p[i + 1]) : ctx.moveTo(p[i], p[i + 1]);
      ctx.strokeStyle = '#4f8aa3'; ctx.lineWidth = river.w; ctx.stroke();
    }
    // Roads near the player, batched by class.
    const R = range * 1.6;
    const batches = ROAD_STYLE.map(() => []);
    net.segmentsIn(pos.x - R, pos.z - R, pos.x + R, pos.z + R, (i, road) => batches[net.type[road]].push(i));
    for (let t = ROAD_STYLE.length - 1; t >= 0; t--) {
      const list = batches[t];
      if (!list.length) continue;
      ctx.beginPath();
      for (const i of list) { ctx.moveTo(net.px[i], net.pz[i]); ctx.lineTo(net.px[i + 1], net.pz[i + 1]); }
      ctx.strokeStyle = ROAD_STYLE[t][0];
      ctx.lineWidth = Math.max(net.width[net.ptRoad[list[0]]] * 0.9, ROAD_STYLE[t][1] / scale * 1.4);
      ctx.stroke();
    }
    // GPS route.
    if (route && route.points.length >= 4) {
      ctx.beginPath();
      const p = route.points;
      for (let i = 0; i < p.length; i += 2) i ? ctx.lineTo(p[i], p[i + 1]) : ctx.moveTo(p[i], p[i + 1]);
      ctx.strokeStyle = route.color || '#f4c430'; ctx.lineWidth = 4.2 / scale * this.dpr; ctx.stroke();
    }
    // Police search area.
    const pol = g.police;
    if (pol && pol.level > 0 && !pol.seen) {
      ctx.beginPath(); ctx.arc(pol.lastSeen.x, pol.lastSeen.z, pol.searchRadius, 0, Math.PI * 2);
      const ph = Math.floor(g.time * 3) % 2;
      ctx.fillStyle = ph ? 'rgba(220,40,40,0.18)' : 'rgba(40,80,230,0.18)'; ctx.fill();
    }
    ctx.restore();
    // Blips (drawn upright, clamped to the edge).
    const cx = W / 2, cy = H * 0.62;
    const c = Math.cos(rot), s = Math.sin(rot);
    for (const b of blips) {
      const dx = (b.x - pos.x) * scale, dz = (b.z - pos.z) * scale;
      let x = dx * c - dz * s, y = dx * s + dz * c;
      const edge = b.clamp !== false;
      const maxX = W / 2 - 10 * this.dpr, maxYU = cy - 10 * this.dpr, maxYD = H - cy - 10 * this.dpr;
      let out = false;
      if (Math.abs(x) > maxX || y < -maxYU || y > maxYD) {
        if (!edge) continue;
        const k = Math.min(maxX / Math.abs(x || 1e-6), y < 0 ? maxYU / -y : maxYD / Math.max(y, 1e-6));
        x *= k; y *= k; out = true;
      }
      drawBlip(ctx, cx + x, cy + y, b, this.dpr * (out ? 0.85 : 1), g.time);
    }
    // Player arrow, pointing along the subject's heading relative to the map.
    const heading = g.player.vehicle ? g.player.vehicle.heading : g.player.heading;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-(heading - g.camera.facing));
    ctx.scale(this.dpr, this.dpr);
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6.5, 7); ctx.lineTo(0, 3.5); ctx.lineTo(-6.5, 7); ctx.closePath();
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#1b1b1b'; ctx.lineWidth = 1.6; ctx.fill(); ctx.stroke();
    ctx.restore();
    // North marker on the rim.
    const nx = s, ny = -c; // world north (-z) in screen space
    const nr = Math.min(W / 2, H * 0.6) - 9 * this.dpr;
    ctx.fillStyle = '#ffffff'; ctx.font = `700 ${11 * this.dpr}px "Barlow Condensed", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', cx + nx * nr * 0.95, clamp(cy + ny * nr * 0.95, 8 * this.dpr, H - 8 * this.dpr));
  }
}

export function drawBlip(ctx, x, y, b, k, time = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  const col = b.color || '#f4c430';
  if (b.kind === 'police') {
    ctx.fillStyle = Math.floor(time * 6) % 2 ? '#e53935' : '#1e5bd8';
    ctx.beginPath(); ctx.arc(0, 0, 4.5, 0, Math.PI * 2); ctx.fill();
  } else if (b.kind === 'dot') {
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, 0, b.size || 3, 0, Math.PI * 2); ctx.fill();
  } else if (b.kind === 'icon') {
    ctx.fillStyle = '#111d'; ctx.beginPath(); ctx.arc(0, 0, 8.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.fillStyle = col; ctx.font = '700 10px "Barlow Condensed", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(b.label || '?', 0, 0.5);
  } else {
    // Objective marker: a bright disc with a dark ring.
    ctx.fillStyle = col; ctx.strokeStyle = '#111'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

/** Full-screen city map: pre-rendered streets, pan/zoom, and click to set a waypoint. */
export class CityMap {
  constructor(game, canvas) {
    this.game = game;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    const b = game.city.bounds;
    this.bounds = b;
    this.center = { x: 0, z: 0 };
    this.zoom = 0.35; // px per metre
    this._prerender();
    this._bind();
  }

  _prerender() {
    const g = this.game, b = this.bounds, net = g.net;
    const k = 0.32; // px per metre in the cache
    const w = Math.ceil((b.maxX - b.minX) * k), h = Math.ceil((b.maxZ - b.minZ) * k);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#2e3a30'; ctx.fillRect(0, 0, w, h);
    ctx.scale(k, k); ctx.translate(-b.minX, -b.minZ);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // Built-up areas tinted by density.
    const city = g.city;
    for (let x = b.minX; x < b.maxX; x += 40) for (let z = b.minZ; z < b.maxZ; z += 40) {
      const d = city.densityAt(x + 20, z + 20);
      if (d < 0.12) continue;
      ctx.fillStyle = `rgba(214,196,160,${clamp(d * 0.32, 0, 0.32)})`;
      ctx.fillRect(x, z, 40, 40);
    }
    for (const river of city.rivers) {
      const p = river.p; ctx.beginPath();
      for (let i = 0; i < p.length; i += 2) i ? ctx.lineTo(p[i], p[i + 1]) : ctx.moveTo(p[i], p[i + 1]);
      ctx.strokeStyle = '#4f8aa3'; ctx.lineWidth = river.w; ctx.stroke();
    }
    ctx.setLineDash([10, 8]);
    for (const p of city.rails) { ctx.beginPath(); for (let i = 0; i < p.length; i += 2) i ? ctx.lineTo(p[i], p[i + 1]) : ctx.moveTo(p[i], p[i + 1]); ctx.strokeStyle = '#7d7466'; ctx.lineWidth = 3; ctx.stroke(); }
    ctx.setLineDash([]);
    for (let t = ROAD_STYLE.length - 1; t >= 0; t--) {
      ctx.beginPath();
      for (let r = 0; r < net.count; r++) {
        if (net.type[r] !== t) continue;
        const a = net.ptStart[r], e = net.ptStart[r + 1];
        ctx.moveTo(net.px[a], net.pz[a]);
        for (let i = a + 1; i < e; i++) ctx.lineTo(net.px[i], net.pz[i]);
      }
      ctx.strokeStyle = ROAD_STYLE[t][0];
      ctx.lineWidth = t <= 1 ? 9 : t <= 3 ? 6.5 : 4;
      ctx.stroke();
    }
    this.cache = c; this.cacheK = k;
  }

  _bind() {
    const c = this.canvas;
    let drag = null, moved = 0;
    c.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; moved = 0; c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      moved += Math.abs(dx) + Math.abs(dy);
      this.center.x -= dx / this.zoom; this.center.z -= dy / this.zoom;
      drag = { x: e.clientX, y: e.clientY };
      this.draw();
    });
    c.addEventListener('pointerup', e => {
      if (drag && moved < 6) {
        const r = c.getBoundingClientRect();
        const wx = this.center.x + (e.clientX - r.left - r.width / 2) / this.zoom;
        const wz = this.center.z + (e.clientY - r.top - r.height / 2) / this.zoom;
        this.onPick?.(wx, wz);
      }
      drag = null;
    });
    c.addEventListener('wheel', e => { e.preventDefault(); this.zoomBy(e.deltaY < 0 ? 1.25 : 0.8); }, { passive: false });
  }

  zoomBy(f) { this.zoom = clamp(this.zoom * f, 0.06, 2.5); this.draw(); }
  focus(x, z, zoom) { this.center.x = x; this.center.z = z; if (zoom) this.zoom = zoom; this.draw(); }

  draw(blips = this.blips || [], route = this.route) {
    this.blips = blips; this.route = route;
    const c = this.canvas, ctx = this.ctx;
    const r = c.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (c.width !== Math.round(r.width * dpr)) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
    const W = c.width, H = c.height, z = this.zoom * dpr;
    ctx.fillStyle = '#26302a'; ctx.fillRect(0, 0, W, H);
    const b = this.bounds, k = this.cacheK;
    const sx = W / 2 + (b.minX - this.center.x) * z, sy = H / 2 + (b.minZ - this.center.z) * z;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.cache, sx, sy, this.cache.width / k * z, this.cache.height / k * z);
    const toS = (x, zz) => [W / 2 + (x - this.center.x) * z, H / 2 + (zz - this.center.z) * z];
    if (route && route.points.length >= 4) {
      ctx.beginPath();
      for (let i = 0; i < route.points.length; i += 2) { const [x, y] = toS(route.points[i], route.points[i + 1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.strokeStyle = route.color || '#f4c430'; ctx.lineWidth = 3 * dpr; ctx.stroke();
    }
    // Place names at closer zoom.
    const g = this.game;
    if (this.zoom > 0.5) {
      ctx.font = `600 ${11 * dpr}px "Barlow Condensed", sans-serif`; ctx.fillStyle = '#e9e3cf'; ctx.textAlign = 'left';
      for (const p of g.city.places) {
        const [x, y] = toS(p.x, p.z);
        if (x < 0 || y < 0 || x > W || y > H) continue;
        ctx.fillStyle = '#e9e3cf99'; ctx.beginPath(); ctx.arc(x, y, 2.5 * dpr, 0, 7); ctx.fill();
        ctx.fillStyle = '#e9e3cf'; ctx.fillText(p.shortName, x + 5 * dpr, y + 3 * dpr);
      }
    } else {
      ctx.font = `700 ${12 * dpr}px "Barlow Condensed", sans-serif`; ctx.fillStyle = '#efe7cf'; ctx.textAlign = 'center';
      for (const d of g.city.districts) { const [x, y] = toS(d.x, d.z); if (x > 0 && y > 0 && x < W && y < H) ctx.fillText(d.name.toUpperCase(), x, y); }
    }
    for (const bl of blips) { const [x, y] = toS(bl.x, bl.z); drawBlip(ctx, x, y, bl, dpr * 1.2, g.time); }
    const pos = g.player.pos;
    const [px, py] = toS(pos.x, pos.z);
    const heading = g.player.vehicle ? g.player.vehicle.heading : g.player.heading;
    ctx.save(); ctx.translate(px, py); ctx.rotate(Math.PI - heading); ctx.scale(dpr * 1.3, dpr * 1.3);
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6.5, 7); ctx.lineTo(0, 3.5); ctx.lineTo(-6.5, 7); ctx.closePath();
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.6; ctx.fill(); ctx.stroke(); ctx.restore();
  }
}
