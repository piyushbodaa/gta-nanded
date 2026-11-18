// Procedural texture atlas: every facade, shopfront, road and roof in the city
// is painted here on canvases at load time, so the game ships no texture files.
//
// Each tile is drawn three times through a small "painter": once in colour,
// once as a paint mask (white where the wall takes the building's paint), and
// once as an emissive map (where light shows through at night). The colour and
// mask are combined into one RGBA array texture (mask in alpha, a layer per
// tile) so the browser never premultiplies the colours away.
import { rng } from '../core/math.js';

export const TILE_PX = 256;
export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 10;
export const PAVER_REPEAT_M = 2.4;
// Facade rows hold 8 variants of one "bay x floor" (3.2 m x 3.2 m).
export const ROW = { RES: 0, BALCONY: 1, OLD: 2, MODERN: 3, SHOP: 4, GROUND: 5, BLANK: 6, SURF: 7, SURF2: 8, SPECIAL: 9 };
// Single tiles: [col, row].
export const TILE = {
  ROOF: [0, 7], ASPHALT: [1, 7], DRAIN: [2, 7], ASPHALT_MAIN: [3, 7], CONCRETE_ROAD: [4, 7], PAVERS: [5, 7], KERB: [6, 7], DIRT: [7, 7],
  TIN: [0, 8], ZEBRA: [1, 8], FIELD: [2, 8], GRASS: [3, 8], COMPOUND: [4, 8], AD_CEMENT: [5, 8], AD_RADIO: [6, 8], BRICK: [7, 8],
  HOARD_A: [0, 9], HOARD_B: [1, 9], HOARD_C: [2, 9], HOARD_D: [3, 9], STATION_BOARD: [4, 9], MARBLE: [5, 9], GOLD: [6, 9], STONE: [7, 9],
};

const FONT_LATIN = '"Barlow Condensed", "Arial Narrow", sans-serif';
const FONT_DEVA = '"Noto Sans Devanagari", "Kohinoor Devanagari", "Mangal", sans-serif';
const FONT_MIX = '"Barlow Condensed", "Noto Sans Devanagari", "Arial Narrow", sans-serif';

/** Wait for the sign fonts so canvas text never falls back to empty boxes. */
export async function loadAtlasFonts() {
  if (!document.fonts?.load) return;
  const want = [
    ['800 40px "Barlow Condensed"', 'NANDED'],
    ['700 40px "Noto Sans Devanagari"', 'नांदेड किराणा'],
    ['400 40px "Anton"', 'GTA'],
  ];
  await Promise.race([
    Promise.all(want.map(([f, t]) => document.fonts.load(f, t).catch(() => null))),
    new Promise(r => setTimeout(r, 2500)),
  ]);
}

// ------------------------------------------------------------------ noise
/** Periodic value noise on a cells x cells lattice; (u, v) in [0, 1) wraps seamlessly. */
function periodicNoise(cells, seed) {
  const r = rng(seed);
  const lat = new Float32Array(cells * cells);
  for (let i = 0; i < lat.length; i++) lat[i] = r();
  return (u, v) => {
    const fx = u * cells, fy = v * cells;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    let tx = fx - ix, ty = fy - iy;
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    const x0 = ((ix % cells) + cells) % cells, y0 = ((iy % cells) + cells) % cells;
    const x1 = (x0 + 1) % cells, y1 = (y0 + 1) % cells;
    const a = lat[y0 * cells + x0], b = lat[y0 * cells + x1], c = lat[y1 * cells + x0], d = lat[y1 * cells + x1];
    const top = a + (b - a) * tx, bot = c + (d - c) * tx;
    return top + (bot - top) * ty;
  };
}

/** Sum of periodic noises: octaves = [[cells, weight], ...]; returns 0..1. */
function fbm(seed, octaves) {
  const fns = octaves.map(([c, w], i) => [periodicNoise(c, seed + i * 101), w]);
  const total = octaves.reduce((t, [, w]) => t + w, 0);
  return (u, v) => { let n = 0; for (const [f, w] of fns) n += f(u, v) * w; return n / total; };
}

// ------------------------------------------------------------------ painter
// kind: 'wall' paints (tinted) wall; 'stain' darkens wall but stays paintable;
// 'detail' is unpainted; 'glass' is unpainted and glows at night; 'light' always glows.
function painter(ctx, mode) {
  const fillFor = (color, kind) => {
    if (mode === 'color') return color;
    if (mode === 'mask') return kind === 'wall' || kind === 'stain' ? '#fff' : '#000';
    // emissive
    if (kind === 'glass') return '#ffd58a';
    if (kind === 'interior') return '#685b46';
    if (kind === 'light') return color;
    if (kind === 'glow') return color;
    return '#000';
  };
  const skip = kind => (mode === 'mask' && kind === 'stain') || (mode === 'emissive' && kind === 'stain');
  return {
    mode, ctx,
    rect(x, y, w, h, color, kind = 'detail') {
      if (skip(kind)) return;
      ctx.fillStyle = fillFor(color, kind);
      ctx.fillRect(x, y, w, h);
    },
    poly(points, color, kind = 'detail') {
      if (skip(kind)) return;
      ctx.fillStyle = fillFor(color, kind);
      ctx.beginPath();
      points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fill();
    },
    circle(x, y, r, color, kind = 'detail') {
      if (skip(kind)) return;
      ctx.fillStyle = fillFor(color, kind);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    },
    arch(x, y, w, h, color, kind = 'detail') {
      // A rectangle with a semicircular top: (x, y) is the top-left of the bounding box.
      if (skip(kind)) return;
      ctx.fillStyle = fillFor(color, kind);
      const r = w / 2;
      ctx.beginPath();
      ctx.moveTo(x, y + h); ctx.lineTo(x, y + r); ctx.arc(x + r, y + r, r, Math.PI, 0); ctx.lineTo(x + w, y + h);
      ctx.closePath(); ctx.fill();
    },
    line(x0, y0, x1, y1, color, width, kind = 'detail') {
      if (skip(kind)) return;
      ctx.strokeStyle = fillFor(color, kind);
      ctx.lineWidth = width;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    },
    text(str, x, y, size, color, { font = FONT_MIX, weight = 800, align = 'center', kind = 'detail', maxWidth } = {}) {
      if (skip(kind)) return;
      ctx.fillStyle = fillFor(color, kind);
      ctx.font = `${weight} ${size}px ${font}`;
      ctx.textAlign = align;
      ctx.textBaseline = 'middle';
      ctx.fillText(str, x, y, maxWidth);
    },
    grad(x, y, w, h, stops, kind = 'detail', vertical = true) {
      if (skip(kind)) return;
      if (mode !== 'color') { ctx.fillStyle = fillFor(stops[0][1], kind); ctx.fillRect(x, y, w, h); return; }
      const g = vertical ? ctx.createLinearGradient(0, y, 0, y + h) : ctx.createLinearGradient(x, 0, x + w, 0);
      for (const [t, c] of stops) g.addColorStop(t, c);
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
    },
    /** Speckle noise in the given colour; used for plaster grain and asphalt aggregate. */
    speckle(x, y, w, h, count, colors, size, kind, seed) {
      if (skip(kind)) return;
      if (mode !== 'color') return;
      const r = rng(seed);
      for (let i = 0; i < count; i++) {
        ctx.fillStyle = colors[Math.floor(r() * colors.length)];
        const s = size * (0.5 + r());
        ctx.fillRect(x + r() * w, y + r() * h, s, s);
      }
    },
    /** Rain streaks running down from a ledge: the signature of every monsoon city. */
    streaks(x, y, w, h, seed, strength = 0.18) {
      if (mode !== 'color') return;
      const r = rng(seed);
      for (let i = 0; i < w / 5; i++) {
        const sx = x + r() * w, len = h * (0.3 + r() * 0.7), sw = 2 + r() * 7;
        const g = ctx.createLinearGradient(0, y, 0, y + len);
        g.addColorStop(0, `rgba(40,36,30,${strength * (0.5 + r())})`);
        g.addColorStop(1, 'rgba(40,36,30,0)');
        ctx.fillStyle = g;
        ctx.fillRect(sx, y, sw, len);
      }
    },
    /**
     * Per-pixel pass over a region of the colour canvas: fn(u, v, rgb) edits the
     * 0..255 rgb array in place, with (u, v) in [0, 1) across the region.
     */
    pixels(x, y, w, h, fn) {
      if (mode !== 'color') return;
      const m = ctx.getTransform();
      const px = Math.round(m.e + x * m.a), py = Math.round(m.f + y * m.d);
      const pw = Math.max(1, Math.round(w * m.a)), ph = Math.max(1, Math.round(h * m.d));
      const img = ctx.getImageData(px, py, pw, ph);
      const d = img.data, c = [0, 0, 0];
      for (let j = 0; j < ph; j++) {
        for (let i = 0; i < pw; i++) {
          const k = (j * pw + i) * 4;
          c[0] = d[k]; c[1] = d[k + 1]; c[2] = d[k + 2];
          fn(i / pw, j / ph, c);
          d[k] = c[0]; d[k + 1] = c[1]; d[k + 2] = c[2];
        }
      }
      ctx.putImageData(img, px, py);
    },
    /** Thin jagged cracks, drawn again a tile apart so they wrap with the tile (across too, with wrapX). */
    cracks(n, seed, alpha = 0.35, wrap = true, wrapX = false) {
      if (mode !== 'color') return;
      const r = rng(seed);
      ctx.strokeStyle = `rgba(20,18,16,${alpha})`;
      ctx.lineWidth = 1.1;
      for (let k = 0; k < n; k++) {
        const pts = [[r() * T, r() * T]];
        let a = r() * Math.PI * 2;
        for (let i = 0; i < 9; i++) { a += (r() - 0.5) * 1.2; const [px, py] = pts[pts.length - 1]; pts.push([px + Math.cos(a) * 9, py + Math.sin(a) * 9]); }
        for (const oy of wrap ? [-T, 0, T] : [0]) for (const ox of wrapX ? [-T, 0, T] : [0]) {
          ctx.beginPath();
          pts.forEach(([px, py], i) => (i ? ctx.lineTo(px + ox, py + oy) : ctx.moveTo(px + ox, py + oy)));
          ctx.stroke();
        }
      }
    },
    blotch(x, y, w, h, seed, alpha = 0.08, color = '40,34,28') {
      if (mode !== 'color') return;
      const r = rng(seed);
      for (let i = 0; i < 6; i++) {
        const cx = x + r() * w, cy = y + r() * h, rad = 10 + r() * 40;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        g.addColorStop(0, `rgba(${color},${alpha * (0.5 + r())})`);
        g.addColorStop(1, `rgba(${color},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
      }
    },
  };
}

// ------------------------------------------------------------------ facade parts
const T = TILE_PX;
const FRAMES = ['#2f5d8a', '#3d7a4a', '#ececec', '#6a4a33', '#2b2b2b', '#8a2f2f', '#1f6e78'];

function wallBase(g, seed, aged = 1) {
  g.rect(0, 0, T, T, '#ebe7df', 'wall');
  g.speckle(0, 0, T, T, 900, ['rgba(0,0,0,0.05)', 'rgba(255,255,255,0.08)', 'rgba(60,50,40,0.06)'], 2, 'stain', seed);
  g.blotch(0, 0, T, T, seed + 1, 0.07 * aged);
  // Floor slab band at the bottom of each storey.
  g.rect(0, T - 10, T, 10, '#d6d1c6', 'wall');
  g.rect(0, T - 11, T, 2, 'rgba(0,0,0,0.15)', 'stain');
}

function grill(g, x, y, w, h, color = '#1e1e1e', step = 13) {
  for (let gx = x + step / 2; gx < x + w; gx += step) g.rect(gx - 1.5, y, 3, h, color);
  g.rect(x, y + h * 0.5 - 1.5, w, 3, color);
}

function window1(g, seed, { frame = FRAMES[0], curtain = null, grillOn = true, shutters = null, w = 108, h = 108, sill = 70, centerX = T / 2 } = {}) {
  const x = centerX - w / 2, y = T - sill - h;
  // Chajja: the concrete sunshade over every Indian window, and its shadow.
  g.rect(x - 18, y - 22, w + 36, 11, '#dcd6ca', 'wall');
  g.rect(x - 18, y - 11, w + 36, 4, 'rgba(0,0,0,0.25)', 'stain');
  g.streaks(x - 14, y - 11, w + 28, 40, seed, 0.12);
  // Sill and streaks below it.
  g.rect(x - 6, y + h, w + 12, 7, '#d7d1c4', 'wall');
  g.streaks(x - 4, y + h + 7, w + 8, sill - 10, seed + 3, 0.16);
  if (shutters) {
    g.rect(x - 4, y - 4, w + 8, h + 8, frame);
    for (let i = 0; i < 2; i++) {
      const sx = x + i * (w / 2);
      g.rect(sx + 3, y + 2, w / 2 - 6, h - 4, shutters);
      for (let ly = y + 10; ly < y + h - 6; ly += 9) g.rect(sx + 7, ly, w / 2 - 14, 3, 'rgba(0,0,0,0.25)');
    }
    return;
  }
  g.rect(x - 5, y - 5, w + 10, h + 10, frame);
  g.grad(x, y, w, h, [[0, '#56707c'], [0.55, '#2f3f48'], [1, '#26323a']], 'glass');
  if (g.mode === 'color') { g.rect(x + 8, y + 6, w * 0.3, h * 0.55, 'rgba(255,255,255,0.10)', 'glass'); }
  if (curtain) {
    g.rect(x + 2, y + 2, w * 0.42, h - 4, curtain, 'glass');
    g.rect(x + w * 0.62, y + 2, w * 0.36, h - 4, curtain, 'glass');
    for (let cx = x + 6; cx < x + w * 0.42; cx += 8) g.rect(cx, y + 2, 2, h - 4, 'rgba(0,0,0,0.12)');
  }
  g.rect(x + w / 2 - 3, y, 6, h, frame); // mullion
  if (grillOn) grill(g, x, y, w, h);
}

function acUnit(g, x, y) {
  g.rect(x + 3, y + 4, 62, 43, 'rgba(37,34,28,0.30)', 'stain');
  g.grad(x, y, 62, 43, [[0, '#d3d2c5'], [0.6, '#bcbdb2'], [1, '#9d9f98']]);
  g.rect(x + 2, y + 2, 58, 1.3, '#e7e5d8');
  const cx = x + 22, cy = y + 21;
  g.circle(cx, cy, 16, '#979990'); g.circle(cx, cy, 14, '#4c514c');
  for (let i = -2; i <= 2; i++) {
    const d = i * 5, half = Math.sqrt(14 * 14 - d * d);
    g.line(cx + d, cy - half, cx + d, cy + half, '#858a7f', 1.3);
    g.line(cx - half, cy + d, cx + half, cy + d, '#8b8d84', 1.1);
  }
  g.circle(cx, cy, 3.2, '#9da096');
  for (let i = 0; i < 6; i++) g.rect(x + 44, y + 12 + i * 3.4, 12, 1.2, '#84877e');
  g.rect(x + 44, y + 6, 8, 2.5, '#777c89');
  for (const px of [x + 6, x + 49]) g.rect(px, y + 42, 5, 4, '#55594e');
}

function clothes(g, x, y, w, seed) {
  const r = rng(seed);
  const sag = t => y + 4 * t + 24 * t * (1 - t);
  for (let i = 0; i < 4; i++) g.line(x + w * i / 4, sag(i / 4), x + w * (i + 1) / 4, sag((i + 1) / 4), '#57564b', 1.5);
  const colors = ['#a14d46', '#588294', '#d0a553', '#84627f', '#639882', '#b67253', '#d7d6c9'];
  for (let cx = x + 6; cx < x + w - 25;) {
    const cw = 14 + r() * 10, ch = 28 + r() * 22, top = sag((cx - x + cw / 2) / w);
    const col = colors[Math.floor(r() * colors.length)], shirt = r() < 0.42;
    const outline = shirt
      ? [[0.26, 0], [0.4, 0.04], [0.61, 0.04], [0.74, 0], [1.14, 0.16], [0.96, 0.39], [0.8, 0.3], [0.84, 1], [0.17, 0.97], [0.19, 0.29], [0.02, 0.39], [-0.13, 0.19]]
      : [[0.06, 0], [0.95, 0.02], [1.03, 0.97], [0.73, 1], [0.45, 0.97], [0.04, 0.99]];
    g.poly(outline.map(([u, v]) => [cx + u * cw, top + v * ch]), col);
    g.poly([[cx + cw * 0.28, top + 1], [cx + cw * 0.42, top + ch * 0.96], [cx + cw * 0.26, top + ch * 0.94]], 'rgba(42,33,37,0.22)');
    g.line(cx + cw * 0.74, top + 2, cx + cw * 0.65, top + ch * 0.89, 'rgba(243,224,195,0.23)', 1.4);
    if (!shirt) g.line(cx + 2, top + ch - 5, cx + cw, top + ch - 4, 'rgba(246,224,179,0.48)', 2);
    for (const pin of [0.27, 0.74]) g.rect(cx + cw * pin, top - 2.5, 1.7, 5, '#97826a');
    cx += cw + 4 + r() * 6;
  }
}

function pots(g, x, y, w, seed) {
  const r = rng(seed);
  for (let px = x + 8; px < x + w - 10; px += 22) {
    const cx = px + 8;
    for (let i = 0; i < 7; i++) {
      const dx = (r() - 0.5) * 26, dy = 5 + r() * 16;
      g.poly([[cx, y + 1], [cx + dx * 0.45 - 2.6, y - dy * 0.6], [cx + dx, y - dy], [cx + dx * 0.6 + 2.6, y - dy * 0.45]], i % 3 ? '#4a693e' : '#778451');
    }
    if (r() < 0.4) g.circle(px + 5, y - 13, 2, '#be6570');
    g.poly([[px, y], [px + 16, y], [px + 13, y + 16], [px + 3, y + 16]], '#9c6349');
    g.rect(px - 1, y, 18, 3, '#b07759');
  }
}

function pipe(g, x, seed) {
  g.rect(x, 0, 12, T, '#7d8585');
  g.rect(x + 2, 0, 3, T, 'rgba(255,255,255,0.2)');
  for (let y = 30; y < T; y += 80) g.rect(x - 3, y, 18, 6, '#5c6464');
  g.streaks(x - 10, 40, 34, T - 40, seed, 0.25);
}

// ------------------------------------------------------------------ rows
function paintRes(g, v, seed) {
  wallBase(g, seed);
  switch (v) {
    case 0: window1(g, seed, { frame: FRAMES[0] }); break;
    case 1: window1(g, seed, { frame: FRAMES[2], curtain: '#d9739b' }); break;
    case 2: window1(g, seed, { frame: FRAMES[1] }); acUnit(g, 160, 196); break;
    case 3: {
      // Bathroom ventilator plus a plumbing stack.
      g.rect(150, 70, 52, 34, FRAMES[2]); g.rect(155, 75, 42, 24, '#3c4a52', 'glass');
      for (let i = 0; i < 4; i++) g.rect(155, 77 + i * 6, 42, 2, '#999');
      pipe(g, 60, seed);
      break;
    }
    case 4: window1(g, seed, { frame: FRAMES[6] }); clothes(g, 60, 80, 136, seed + 5); break;
    case 5: window1(g, seed, { frame: FRAMES[3], curtain: '#e0b84f' }); pots(g, 70, 178, 120, seed + 7); break;
    case 6: window1(g, seed, { frame: '#5a3e2b', shutters: '#3e6e55' }); break;
    default: pipe(g, 110, seed); g.blotch(0, 120, T, 130, seed + 9, 0.12); break;
  }
}

function paintBalcony(g, v, seed) {
  wallBase(g, seed);
  const r = rng(seed);
  // Door and window behind a railing; the slab edge is drawn as a band.
  const doorX = v % 2 ? 40 : 136;
  g.rect(doorX - 4, 46, 84, 200, '#e1dbd0', 'wall');
  g.rect(doorX, 50, 76, 196, ['#6b4a33', '#3b5f7d', '#ececec', '#7a3b3b'][v % 4]);
  g.grad(doorX + 8, 58, 60, 90, [[0, '#5a727e'], [1, '#2c3a42']], 'glass');
  g.rect(doorX + 36, 58, 4, 90, '#ddd');
  const wx = v % 2 ? 150 : 22;
  g.rect(wx, 70, 84, 84, FRAMES[(v + 2) % FRAMES.length]);
  g.grad(wx + 5, 75, 74, 74, [[0, '#5d7783'], [1, '#2c3a42']], 'glass');
  if (v % 3 === 0) g.rect(wx + 5, 75, 30, 74, '#c46c8f', 'glass');
  // Balcony slab & railing.
  g.rect(0, 160, T, 12, '#d8d2c6', 'wall');
  g.rect(0, 172, T, 4, 'rgba(0,0,0,0.3)', 'stain');
  const railColor = ['#222', '#e8e8e8', '#2d5d8a', '#7d2f2f'][v % 4];
  if (v >= 4) {
    // Concrete balustrade.
    g.rect(0, 176, T, 70, '#e5dfd4', 'wall');
    for (let x = 12; x < T; x += 28) g.rect(x, 186, 14, 50, 'rgba(0,0,0,0.18)', 'stain');
  } else {
    g.rect(0, 176, T, 6, railColor);
    g.rect(0, 238, T, 6, railColor);
    for (let x = 6; x < T; x += 14) g.rect(x, 182, 4, 56, railColor);
    if (v === 1) for (let x = 20; x < T; x += 56) { g.circle(x + 14, 210, 14, 'rgba(0,0,0,0)'); g.line(x, 182, x + 28, 238, railColor, 3); g.line(x + 28, 182, x, 238, railColor, 3); }
  }
  if (v === 2 || v === 6) clothes(g, 10, 150, 236, seed + 11);
  if (v === 3 || v === 7) pots(g, 20, 158, 200, seed + 13);
  if (r() < 0.4) acUnit(g, v % 2 ? 190 : 4, 110);
}

function paintOld(g, v, seed) {
  // Lime-wash over stone. Fallen plaster is not painted here, where it would repeat in every bay:
  // the city shader breaks it out along each whole wall (citymat.js).
  wallBase(g, seed, 2.2);
  g.streaks(0, 0, T, T, seed + 2, 0.12);
  const wood = ['#5b3a24', '#3f5e4b', '#3f5d7a', '#6e2e2e'][v % 4];
  if (v < 4) {
    // Arched window with wooden shutters and a carved frame.
    g.arch(70, 52, 116, 140, '#e7dfcf', 'wall');
    g.arch(80, 62, 96, 124, wood);
    g.arch(88, 70, 80, 110, '#2f3a3d', 'glass');
    if (v % 2) {
      g.rect(88, 110, 38, 70, wood); g.rect(130, 110, 38, 70, wood);
      for (let y = 118; y < 176; y += 10) { g.rect(92, y, 30, 3, 'rgba(0,0,0,0.3)'); g.rect(134, y, 30, 3, 'rgba(0,0,0,0.3)'); }
    } else grill(g, 88, 110, 80, 70, '#222', 16);
    g.rect(64, 186, 128, 10, '#d9cfbd', 'wall');
  } else if (v < 6) {
    // Jharokha: a projecting wooden balcony window.
    g.rect(52, 70, 152, 120, wood);
    g.rect(60, 78, 136, 80, '#2f3a3d', 'glass');
    for (let x = 64; x < 196; x += 17) g.rect(x, 78, 4, 80, wood);
    g.rect(46, 158, 164, 14, wood);
    for (let x = 56; x < 204; x += 24) g.poly([[x, 172], [x + 14, 172], [x + 7, 196]], wood);
    g.poly([[46, 70], [210, 70], [190, 50], [66, 50]], '#6b4a32');
  } else {
    // Small square windows and niches with an iron lamp hook.
    for (const x of [44, 156]) { g.rect(x, 90, 56, 64, wood); g.rect(x + 6, 96, 44, 52, '#2c3638', 'glass'); grill(g, x + 6, 96, 44, 52, '#222', 11); }
    g.arch(114, 120, 28, 40, '#c9bfae', 'wall');
    if (v === 7) g.circle(128, 146, 5, '#ffcf7a', 'light');
  }
}

function paintModern(g, v, seed) {
  wallBase(g, seed, 0.6);
  const glassTint = ['#4f7f8f', '#3f6f86', '#5b8a7d', '#466272'][v % 4];
  if (v < 5) {
    // Ribbon window with aluminium frame and spandrel panel.
    g.rect(8, 40, 240, 150, '#c9ced1');
    g.grad(14, 46, 228, 138, [[0, glassTint], [0.5, '#2b3f48'], [1, '#22343c']], 'glass');
    if (g.mode === 'color') g.poly([[30, 46], [90, 46], [40, 184], [14, 184]], 'rgba(255,255,255,0.12)', 'glass');
    for (let x = 14 + 57; x < 240; x += 57) g.rect(x, 46, 4, 138, '#c9ced1');
    g.rect(0, 196, T, 50, ['#2a5d8f', '#b23b3b', '#e0e0e0', '#3d3d3d', '#1f7a6d'][v], v === 2 ? 'wall' : 'detail');
    if (v === 1) g.text('CLASSES', 128, 221, 34, '#fff', { font: FONT_LATIN });
    if (v === 3) g.text('NEET • JEE', 128, 221, 30, '#ffd23f', { font: FONT_LATIN });
  } else if (v === 5) {
    window1(g, seed, { frame: '#9aa4a8', w: 150, h: 112 });
    g.rect(40, 200, 176, 34, '#ffffff'); g.rect(40, 200, 176, 34, 'rgba(0,0,0,0)');
    g.text('Dr. Kulkarni Clinic', 128, 217, 22, '#b3261e', { font: FONT_LATIN });
  } else if (v === 6) {
    window1(g, seed, { frame: '#9aa4a8', w: 150, h: 112 });
    g.rect(30, 200, 196, 34, '#1d3b6e');
    g.text('ॲड. देशपांडे • ADVOCATE', 128, 217, 20, '#fff', { font: FONT_MIX, weight: 700 });
  } else {
    // ACP cladding panels.
    for (let y = 8; y < 240; y += 60) for (let x = 4; x < 250; x += 84) g.rect(x, y, 80, 56, ['#8c939a', '#9aa1a8', '#80868d'][(x + y) % 3]);
    g.rect(60, 70, 136, 80, '#26343c', 'glass');
  }
}

const SHOP_GOODS = ['#e74c3c', '#f39c12', '#f1c40f', '#27ae60', '#2980b9', '#8e44ad', '#ecf0f1', '#d35400', '#16a085', '#c0392b'];
function paintShop(g, v, seed) {
  wallBase(g, seed, 0.8);
  const r = rng(seed);
  const top = 46, bottom = T - 8;
  // Rolled-up shutter box.
  g.rect(4, top - 6, T - 8, 18, '#8d9392');
  for (let y = top - 4; y < top + 12; y += 4) g.rect(4, y, T - 8, 1.5, '#6c7271');
  const iy = top + 12, ih = bottom - iy;
  if (v === 7) {
    // Galvanised shutter, with a faded hand-painted request to keep the entrance clear.
    g.grad(6, iy, T - 12, ih, [[0, '#656e6e'], [0.42, '#a2a7a0'], [1, '#787c74']], 'detail', false);
    for (let y = iy; y < bottom; y += 7) {
      g.rect(6, y, T - 12, 2, 'rgba(34,39,38,0.4)');
      g.rect(6, y + 2, T - 12, 1.5, 'rgba(237,228,209,0.35)');
    }
    g.text('गेटसमोर वाहन लावू नये', 128, iy + ih / 2, 19, '#763d31', { font: FONT_DEVA, weight: 700, maxWidth: 204 });
    g.rect(94, bottom - 15, 68, 4, '#42463f');
    g.rect(124, bottom - 18, 8, 11, '#b39562');
    g.streaks(6, iy, T - 12, ih, seed, 0.12);
    return;
  }
  // The back of the shop sits in the shade. Keep the tube and the glass
  // display highlights small enough to read at pavement height.
  const back = ['#a7987b', '#8d9a98', '#b1bcab', '#aa9686', '#979184', '#ad9581', '#ac9e8a'][v];
  g.grad(6, iy, T - 12, ih, [[0, '#696157'], [0.24, back], [0.8, back], [1, '#696359']], 'interior');
  g.rect(64, iy + 9, 126, 5, '#514f44');
  g.rect(68, iy + 10, 118, 2, '#f8efd4', 'light');
  const shelf = (x, y, w) => {
    g.rect(x, y, w, 7, '#514536');
    g.rect(x, y, w, 2, '#afa18a');
    g.grad(x, y + 7, w, 6, [[0, 'rgba(30,27,23,.35)'], [1, 'rgba(30,27,23,0)']], 'stain');
  };
  const goods = ['#9c4f3a', '#b98541', '#9f994f', '#597962', '#51717c', '#826f73', '#c5b697'];
  if (v === 0 || v === 2) {
    // Packs are stocked in runs of the same product, with gaps between runs.
    for (const y of [iy + 58, iy + 94, iy + 128]) {
      g.rect(20, y - 26, 210, 27, '#5c594a');
      for (let x = 23; x < 220;) {
        const w = 6 + r() * 5, h = 12 + r() * 12, count = 2 + Math.floor(r() * 4);
        const col = goods[Math.floor(r() * goods.length)];
        for (let n = 0; n < count && x + w < 230; n++, x += w + 1) {
          g.rect(x, y - h, w, h, v === 2 ? '#c0bda9' : col);
          g.rect(x, y - h + 2, w - 1, 2, v === 2 ? col : '#c3bba5');
          g.rect(x + 1, y - h * 0.55, w - 2, 3, v === 2 ? col : '#d0c5a4');
          g.rect(x + w - 2, y - h, 2, h, 'rgba(47,40,32,.22)', 'stain');
        }
        x += 2 + r() * 6;
      }
      shelf(17, y, 218);
    }
    for (const x of [15, 126, 233]) g.rect(x, iy + 27, 2, 113, '#676359');
  }
  if (v === 0) {
    // Open jute grain sacks rolled down around mounds of rice and pulses.
    const grain = ['#c4ab69', '#986f41', '#cbbda0', '#af7950'];
    for (let k = 0; k < 4; k++) {
      const x = 19 + k * 52, y = bottom - 32 + (k % 2) * 3;
      g.poly([[x + 3,y], [x + 8,y - 6], [x + 21,y - 9], [x + 37,y - 6], [x + 41,y], [x + 38,y + 3], [x + 6,y + 3]], grain[k]);
      g.poly([[x + 3,y], [x + 15,y + 2], [x + 32,y + 1], [x + 42,y - 1], [x + 43,y + 9], [x + 40,bottom - 4], [x + 6,bottom - 4], [x + 1,y + 9]], '#aa9470');
      g.line(x + 4,y + 2,x + 40,y + 2,'#d5c3a4',3);
      g.line(x + 32,y + 8,x + 35,bottom - 6,'#817052',2);
      for (let n=0;n<16;n++) g.rect(x + 9 + r()*24, y - 2 - r()*3, 1.1, 0.7, '#e0c997');
    }
    for (const x of [18, 33]) for (let k = 0; k < 5; k++) {
      const y = iy + 17 + k * 12;
      g.poly([[x,y], [x + 10,y], [x + 11,y + 9], [x + 8,y + 11], [x - 1,y + 10]], goods[k]);
      g.rect(x + 1, y + 1, 8, 1.2, '#ccbe9c');
      g.rect(x + 2, y + 5, 5, 2, '#e0cb99');
    }
  } else if (v === 1) {
    // Lit display niches and boxed handsets behind a glass sales counter.
    for (let i = 0; i < 3; i++) {
      const x = 21 + i * 71;
      g.rect(x, iy + 27, 65, 67, '#4f5b59');
      g.grad(x + 3, iy + 30, 59, 61, [[0,'#a0aaa0'],[1,'#778782']]);
      for (const y of [iy + 54, iy + 83]) {
        for (let j=0;j<4;j++) {
          const px = x + 8 + j * 13;
          g.rect(px,y - 17,9,17,'#454b49');
          g.rect(px + 1,y - 15,7,12,j%2 ? '#708886' : '#a79b87');
        }
        shelf(x + 4, y, 56);
      }
    }
    g.rect(16, bottom - 65, 224, 58, '#536862');
    g.grad(20, bottom - 61, 216, 46, [[0, '#82938b'], [1, '#52635c']]);
    for (let x = 25; x < 223; x += 24) g.rect(x, bottom - 28 - (x%3)*2, 18, 9, '#a6a392');
    for (const x of [17, 89, 164, 238]) g.rect(x, bottom - 63, 2, 54, '#b6b3a2');
    shelf(15, bottom - 66, 226);
  } else if (v === 2) {
    g.rect(196, iy + 8, 25, 19, '#426d56');
    g.rect(206, iy + 10, 5, 14, '#d2d5ba'); g.rect(201, iy + 15, 15, 5, '#d2d5ba');
    g.rect(18, bottom - 43, 218, 39, '#8a9987');
    g.rect(15, bottom - 47, 225, 5, '#d1c5a9');
    for (const x of [84,165]) g.rect(x, bottom - 41, 2, 35, '#6a796c');
  } else if (v === 3) {
    const dyes = ['#97504b', '#36676b', '#8b6378', '#4e6179', '#b17a48', '#76815f', '#c5ab84'];
    g.line(11, iy + 22, T - 11, iy + 22, '#726959', 3);
    for (let sx = 18; sx < T - 20; sx += 21) {
      const y = iy + 22 + r() * 4, hem = bottom - 32 - r() * 12;
      g.poly([[sx, y], [sx + 16, y + 1], [sx + 18, hem - 1], [sx + 9, hem + 2], [sx - 1, hem]], dyes[Math.floor(r() * dyes.length)]);
      g.grad(sx, y + 2, 17, hem - y - 4, [[0, 'rgba(33,22,26,.38)'], [.36, 'rgba(255,235,196,.2)'], [.66,'rgba(33,22,26,.2)'], [1, 'rgba(33,22,26,.36)']], 'stain', false);
      g.line(sx, hem - 5, sx + 17, hem - 4, '#b7a07b', 2);
      g.line(sx + 1, hem - 9, sx + 16, hem - 8, '#927d64', 1);
    }
    shelf(15, bottom - 26, 225);
  } else if (v === 4) {
    // Workshop pegboard, open bins and galvanised pipe stock.
    g.rect(23, iy + 25, 119, 91, '#786950');
    for (let x=26;x<139;x+=7) for(let y=iy+28;y<iy+113;y+=7) g.rect(x,y,1.6,1.6,'#4a4437');
    for (let k=0;k<9;k++) {
      const x=32 + k%5*23, y=iy+37+Math.floor(k/5)*39;
      g.line(x,y,x-2,y+19,'#b1aaa0',3);
      g.line(x-2,y+13,x-3,y+23,k%2?'#654d3d':'#55574b',4);
      g.line(x-3,y-2,x+3,y+2,'#bdb7ab',4);
    }
    for (let k=0;k<10;k++){
      const x=165+k*6, y=iy+35+r()*26;
      g.line(x+8,y,x,bottom-7,k%2?'#9f9c8a':'#777c76',4);
      g.line(x+8,y,x,bottom-7,'#c6bfa8',1);
    }
    shelf(16,bottom-77,135);
    for(let k=0;k<3;k++){
      const x=23+k*40;
      g.poly([[x,bottom-49],[x+34,bottom-49],[x+30,bottom-8],[x+4,bottom-8]],['#627572','#8e8060','#687d82'][k]);
      g.rect(x-1,bottom-50,36,4,'#a29c85');
    }
  } else if (v === 5) {
    // Bakery shelves, rounded loaves and a steel-framed mithai display case.
    const upper = iy + 59, lower = iy + 104;
    for (let k = 0; k < 7; k++) {
      const x = 21 + k * 30, h = 12 + r() * 5;
      g.poly([[x, upper], [x + 1, upper - h + 4], [x + 5, upper - h], [x + 19, upper - h - 1],
        [x + 25, upper - h + 4], [x + 26, upper]], k % 3 ? '#c49460' : '#ba9a72');
      for (let j = 0; j < 3; j++) g.line(x + 7 + j * 5, upper - h + 2, x + 4 + j * 5, upper - h + 6, '#e4cba1', 1.5);
    }
    shelf(17, upper, 220);
    for (let k = 0; k < 4; k++) {
      const x = 22 + k * 54, h = k % 2 ? 11 : 16;
      g.rect(x, lower - 2, 43, 2, '#c0ad91');
      g.rect(x + 3, lower - 2 - h, 37, h, k % 2 ? '#906748' : '#c6a788');
      g.rect(x + 3, lower - 3 - h, 37, 3, k % 2 ? '#dfc3a8' : '#dbc9a9');
      g.rect(x + 3, lower - 7, 37, 2, '#9c7761');
      for (let j = 0; j < 4; j++) g.circle(x + 8 + j * 8, lower - 5 - h, 2.1, j % 2 ? '#a8634e' : '#e0c7a0');
    }
    shelf(17, lower, 220);
    g.grad(14,bottom-67,228,63,[[0,'#747f76'],[0.5,'#4c544f'],[1,'#6e6150']]);
    for (let n=0;n<8;n++) {
      const x=20+(n%4)*54, y=bottom-54+Math.floor(n/4)*24;
      g.rect(x,y,49,18,'#a09c8e'); g.rect(x+2,y+1,45,13,'#675d4e');
      const tones=['#b9834e','#c69859','#bbad8b','#936c45'];
      for(let j=0;j<12;j++) g.circle(x+5+(j%6)*7,y+4+Math.floor(j/6)*7,3+r(),tones[n%4]);
      g.line(x,y+17,x+48,y+17,'#d4c7b0',1.3);
    }
    for (const x of [14,126,241]) g.rect(x,bottom-68,2.5,65,'#d0c8b6');
    g.rect(13,bottom-69,231,3,'#c3c3b0');
    g.line(28,bottom-32,84,bottom-62,'rgba(225,232,218,.23)',2,'stain');
    g.line(152,bottom-35,193,bottom-57,'rgba(225,232,218,.18)',2,'stain');
  } else {
    g.rect(18, iy + 23, 85, 58, '#4a3f33'); g.rect(21,iy+26,79,52,'#414a40');
    g.text('चहा ₹10', 60, iy + 42, 14, '#d3c7aa', { font: FONT_DEVA, weight: 700 });
    g.text('वडापाव ₹15', 60, iy + 61, 12, '#d3c7aa', { font: FONT_DEVA, weight: 700 });
    for(let k=0;k<4;k++) {
      const x=138+k*22;
      g.rect(x,iy+46,16,23,['#9b866d','#9a7657'][k%2]); g.rect(x-1,iy+43,18,4,'#c0b39d'); g.rect(x+2,iy+54,12,7,'#c5b79a');
    }
    shelf(131,iy+69,101);
    g.rect(19,bottom-57,215,51,'#736754'); shelf(15,bottom-63,222);
    g.circle(155,bottom-75,13,'#93988b'); g.rect(147,bottom-90,17,5,'#b6b4a2');
    g.line(164,bottom-78,176,bottom-83,'#aab0a0',4);
    for(let k=0;k<5;k++) g.poly([[185+k*8,bottom-73],[191+k*8,bottom-73],[190+k*8,bottom-64],[186+k*8,bottom-64]],'#babba5');
  }
  // The jambs, threshold and shutter recess give even an open shop a clear depth.
  g.grad(6, iy, T - 12, ih, [[0, 'rgba(31,30,26,0.52)'], [0.12, 'rgba(31,30,26,0.25)'], [0.36, 'rgba(31,30,26,0.02)'], [1, 'rgba(31,30,26,0.08)']], 'stain');
  g.grad(6, iy, T - 12, ih, [[0, 'rgba(26,22,19,0.55)'], [0.16, 'rgba(26,22,19,0.04)'], [0.84, 'rgba(26,22,19,0.04)'], [1, 'rgba(26,22,19,0.55)']], 'stain', false);
  for (const x of [6, T - 13]) {
    g.rect(x, iy, 7, ih, '#645e53');
    g.rect(x + 1, iy, 2, ih, '#9c9485');
  }
  g.rect(7, bottom - 5, T - 14, 5, '#776d5d');
  g.rect(7, bottom - 5, T - 14, 1.5, '#b9ad98');
}

function paintGround(g, v, seed) {
  wallBase(g, seed, 1.4);
  const r = rng(seed);
  switch (v) {
    case 0: {
      // Front door behind a steel safety door; nameplate and a light.
      g.rect(80, 40, 96, 208, '#e1dbd0', 'wall');
      g.rect(88, 50, 80, 198, '#6b4226');
      for (let y = 62; y < 236; y += 46) g.rect(96, y, 64, 36, '#5a361f');
      grill(g, 88, 50, 80, 198, '#3a3a3a', 12);
      g.rect(184, 110, 40, 16, '#f5f5f5'); g.text('पाटील', 204, 118, 12, '#222', { font: FONT_DEVA, weight: 700 });
      g.circle(128, 34, 7, '#fff4c4', 'light');
      g.rect(70, 240, 116, 8, '#bfb6a6');
      window1(g, seed + 3, { frame: FRAMES[2], w: 40, h: 60, sill: 90, centerX: 38 });
      break;
    }
    case 1: {
      // Painted MS gate in the compound wall.
      const c = ['#2d5d8a', '#7d2f2f', '#2f6b3a', '#333'][Math.floor(r() * 4)];
      g.rect(20, 70, 216, 178, c);
      for (let x = 30; x < 230; x += 12) g.rect(x, 80, 4, 160, 'rgba(0,0,0,0.35)');
      g.rect(20, 70, 216, 10, '#c9a227');
      g.rect(124, 70, 8, 178, '#1a1a1a');
      break;
    }
    case 2: {
      g.rect(10, 40, 236, 208, '#858b8a');
      for (let y = 44; y < 248; y += 8) g.rect(10, y, 236, 2, '#6c7271');
      g.text('NO PARKING', 128, 140, 34, '#c0392b', { font: FONT_LATIN });
      g.streaks(10, 40, 236, 200, seed, 0.1);
      break;
    }
    case 3: window1(g, seed, { frame: FRAMES[r() * 4 | 0], sill: 96, curtain: r() < 0.5 ? '#7fb3d5' : null }); break;
    case 4: {
      g.rect(10, 40, 236, 120, '#8a908f');
      for (let y = 44; y < 160; y += 8) g.rect(10, y, 236, 2, '#6e7473');
      g.rect(10, 160, 236, 88, '#2e2a25', 'glass');
      g.rect(30, 190, 60, 58, '#a0522d'); g.rect(150, 200, 80, 48, '#556b2f');
      break;
    }
    case 5: {
      g.rect(14, 60, 228, 150, '#f7e8b0', 'detail');
      g.text('गोदावरी', 128, 105, 46, '#b03a2e', { font: FONT_DEVA, weight: 800 });
      g.text('सिमेंट', 128, 160, 44, '#1f4e79', { font: FONT_DEVA, weight: 800 });
      g.streaks(14, 60, 228, 150, seed, 0.12);
      break;
    }
    case 6: {
      // Layers of posters pasted over each other.
      for (let i = 0; i < 9; i++) {
        const px = r() * 190, py = 40 + r() * 150;
        g.rect(px, py, 50 + r() * 20, 64, SHOP_GOODS[Math.floor(r() * SHOP_GOODS.length)]);
        g.rect(px + 6, py + 8, 40, 6, 'rgba(255,255,255,0.8)'); g.rect(px + 6, py + 20, 30, 4, 'rgba(0,0,0,0.5)');
      }
      break;
    }
    default: {
      // Tiled wall with a tap and a little lamp niche.
      for (let y = 140; y < 248; y += 18) for (let x = 0; x < T; x += 18) g.rect(x + 1, y + 1, 16, 16, (x + y) % 36 ? '#dfe7e8' : '#cfdbdc');
      g.rect(100, 160, 8, 30, '#9aa'); g.rect(92, 158, 24, 8, '#9aa');
      g.arch(170, 60, 40, 56, '#c9bfae', 'wall'); g.circle(190, 100, 6, '#ffb347', 'light');
    }
  }
}

function paintBlank(g, v, seed) {
  // Side and party walls: no windows, just weather, pipes and painted ads.
  wallBase(g, seed, 1.6);
  g.streaks(0, 0, T, T, seed + 1, 0.08);
  if (v === 1) pipe(g, 200, seed);
  if (v === 2) { g.rect(20, 60, 216, 120, '#f2f2f2'); g.text('RADIO', 128, 92, 40, '#c0392b', { font: FONT_LATIN }); g.text('GODAVARI 92.7', 128, 140, 34, '#1f4e79', { font: FONT_LATIN }); }
  if (v === 3) { g.rect(16, 50, 224, 140, '#1f6e43'); g.text('भाऊ टाइल्स', 128, 100, 38, '#ffe082', { font: FONT_DEVA, weight: 800 }); g.text('& SANITARY', 128, 150, 30, '#fff', { font: FONT_LATIN }); }
  if (v === 4) { for (let i = 0; i < 3; i++) g.rect(30 + i * 70, 200, 40, 40, 'rgba(0,0,0,0.12)', 'stain'); }
  if (v === 5) { g.rect(0, 0, T, T, '#a8573d'); for (let y = 0; y < T; y += 16) { g.rect(0, y, T, 2, '#d8c8b8'); for (let x = (y / 16) % 2 ? 0 : 16; x < T; x += 32) g.rect(x, y, 2, 16, '#d8c8b8'); } }
  if (v === 6) { g.text('श्री', 128, 128, 90, '#e67e22', { font: FONT_DEVA, weight: 800 }); }
  if (v === 7) { g.rect(0, 180, T, 76, '#c9a227', 'wall'); }
}

const ROAD_BASE = '#6c6f70'; // one weathered grey for every road; tune here only
function asphalt(g, seed, base = ROAD_BASE) {
  g.rect(0, 0, T, T, base);
  // Laid in world space on both axes (citymat mode 3), so every noise here is periodic both
  // ways; lanes, wheel tracks and markings are drawn per road by the shader, not baked in.
  const stain = fbm(seed, [[2, 0.45], [4, 0.35], [8, 0.2]]);
  const chips = periodicNoise(128, seed + 5), fine = periodicNoise(64, seed + 7);
  const r = rng(seed + 9);
  g.pixels(0, 0, T, T, (u, v, c) => {
    const k = 0.93 + (stain(u, v) - 0.5) * 0.12 + (chips(u, v) - 0.5) * 0.16 + (fine(u, v) - 0.5) * 0.08 + (r() - 0.5) * 0.12;
    c[0] *= k; c[1] *= k; c[2] *= k;
  });
  // Aggregate: pale quartz and dark basalt chips a pixel or two across (1.5-3 cm at 4 m a repeat).
  g.speckle(0, 0, T, T, 2600, ['rgba(198,194,184,0.34)', 'rgba(150,146,138,0.3)', 'rgba(26,26,28,0.34)'], 1.0, 'detail', seed);
  g.cracks(2, seed + 2, 0.22, true, true);
}

/** Painted road marking with the paint worn through in patches. */
function marking(g, x, y, w, h, seed, color = '#e4dfcf') {
  g.rect(x, y, w, h, color);
  const wear = fbm(seed, [[8, 0.6], [24, 0.4]]);
  const r = rng(seed + 1);
  g.pixels(x, y, w, h, (u, v, c) => {
    const k = wear(u * w / T, v * h / T + y / T);
    if (k + (r() - 0.5) * 0.25 < 0.42) { c[0] = c[0] * 0.45 + 30; c[1] = c[1] * 0.45 + 30; c[2] = c[2] * 0.45 + 30; }
    else { const d = 0.88 + r() * 0.12; c[0] *= d; c[1] *= d; c[2] *= d; }
  });
}

// A 2.4 m repeat, with 300 × 150 mm chamfered blocks laid in a running bond.
// Both tiles share the bed exactly, including the bricks that straddle its ends.
function footpath(g, drain) {
  g.rect(0, 0, T, T, '#80796d');
  if (g.mode !== 'color') return;
  const r = rng(8671);
  const concrete = ['#aca69a', '#b8b1a4', '#afa89a', '#b4ac9e', '#a49f96'];
  const red = ['#a67965', '#a1735f', '#aa7d68', '#99705f', '#a77b68'];
  for (let row = 0; row < 16; row++) {
    const y = row * 16, palette = row === 2 || row === 14 ? red : concrete;
    for (let col = 0; col < 8; col++) {
      const x = col * 32 + (row % 2) * 16, face = palette[Math.floor(r() * palette.length)];
      for (const left of x > T - 32 ? [x, x - T] : [x]) {
        g.rect(left + 0.8, y + 0.8, 30.4, 14.4, face);
        g.line(left + 1.6, y + 1.6, left + 30, y + 1.6, 'rgba(242,230,203,0.35)', 1.1);
        g.line(left + 2, y + 14.2, left + 30.4, y + 14.2, 'rgba(63,54,44,0.27)', 1.1);
      }
    }
  }
  g.speckle(0, 0, T, T, 3500, ['rgba(46,40,37,0.17)', 'rgba(246,235,209,0.23)'], 1.4, 'detail', 73);
  if (drain) {
    // Cast-iron storm inlet on the kerb side, flush with a rectangular concrete collar.
    const x = 87, y = 199;
    g.rect(x - 3, y - 3, 81, 49, '#8b8376');
    g.rect(x, y, 75, 43, '#6c655a');
    g.rect(x + 2, y + 2, 71, 39, '#403e38');
    g.rect(x + 5, y + 5, 65, 33, '#242722');
    for (let i = 0; i < 9; i++) {
      const left = x + 7 + i * 7;
      g.rect(left, y + 5, 3.8, 33, '#5c5c50');
      g.rect(left, y + 5, 1.1, 33, '#868374');
    }
    g.rect(x + 4, y + 20, 67, 3, '#4c4d43');
  }
}

function paintSurface(g, c, row, seed) {
  if (row === ROW.SURF) {
    switch (c) {
      case 0: { // roof slab: weathered concrete with tar-sealed joints
        g.rect(0, 0, T, T, '#b4afa6');
        const n = fbm(seed, [[4, 0.5], [8, 0.3], [24, 0.2]]);
        const r = rng(seed);
        g.pixels(0, 0, T, T, (u, v, c) => { const k = 0.8 + n(u, v) * 0.34 + (r() - 0.5) * 0.08; c[0] *= k; c[1] *= k; c[2] *= k * 0.98; });
        g.blotch(0, 0, T, T, seed, 0.2, '50,48,40');
        g.line(0, 128, T, 132, 'rgba(30,26,20,0.3)', 2);
        g.line(128, 0, 126, T, 'rgba(30,26,20,0.25)', 2);
        g.cracks(2, seed + 4, 0.25);
        break;
      }
      case 1: asphalt(g, seed); break;
      case 2: footpath(g, true); break;
      case 3: asphalt(g, seed, '#585b5c'); marking(g, 10, 0, 7, T, seed + 12); marking(g, 239, 0, 7, T, seed + 13); marking(g, 124, 0, 8, 150, seed + 14); break;
      case 4: { // CC road: cement concrete slabs with sawn joints and tyre grime
        g.rect(0, 0, T, T, '#a8a69e');
        const n = fbm(seed, [[4, 0.5], [8, 0.3], [16, 0.2]]);
        const r = rng(seed);
        g.pixels(0, 0, T, T, (u, v, c) => { const k = 0.84 + n(u, v) * 0.28 + (r() - 0.5) * 0.09; c[0] *= k; c[1] *= k; c[2] *= k; });
        g.speckle(0, 0, T, T, 500, ['rgba(80,78,72,0.3)', 'rgba(230,228,220,0.25)'], 1.2, 'detail', seed);
        g.rect(0, 0, T, 3, '#6f6e67'); g.rect(127, 0, 2, T, '#7f7e77');
        g.rect(40, 0, 40, T, 'rgba(20,18,14,0.1)'); g.rect(176, 0, 40, T, 'rgba(20,18,14,0.1)');
        g.cracks(2, seed + 3, 0.3);
        break;
      }
      case 5: footpath(g, false); break;
      case 6: // Worn safety paint over precast concrete, in 0.6 m sections.
        for (let x = 0; x < T; x += 64) {
          g.rect(x, 0, 64, T, x % 128 ? '#d6b350' : '#3d3e39');
          g.rect(x, 0, 2, T, '#736e60');
        }
        g.speckle(0, 0, T, T, 1250, ['rgba(173,163,139,0.55)', 'rgba(72,64,52,0.21)'], 2, 'detail', seed);
        g.grad(0, 0, T, T, [[0, 'rgba(85,72,53,0)'], [0.7, 'rgba(85,72,53,0.04)'], [1, 'rgba(85,72,53,0.33)']], 'stain');
        break;
      default: { // dusty ground (paintable so each zone tints it)
        g.rect(0, 0, T, T, '#d6cfc2', 'wall');
        const n = fbm(seed, [[3, 0.35], [6, 0.3], [12, 0.2], [32, 0.15]]);
        const r = rng(seed);
        g.pixels(0, 0, T, T, (u, v, c) => {
          const k = 0.78 + n(u, v) * 0.42 + (r() - 0.5) * 0.12;
          c[0] *= k; c[1] *= k * 0.99; c[2] *= k * 0.97;
        });
        // Pebbles, clods and dry footprints.
        g.speckle(0, 0, T, T, 900, ['rgba(80,68,52,0.3)', 'rgba(255,250,238,0.28)', 'rgba(50,42,34,0.25)'], 1.6, 'stain', seed);
        g.cracks(4, seed + 6, 0.16);
      }
    }
  } else if (row === ROW.SURF2) {
    switch (c) {
      case 0: // corrugated tin
        g.rect(0, 0, T, T, '#c4c8c8', 'wall');
        for (let x = 0; x < T; x += 16) { g.rect(x, 0, 8, T, 'rgba(255,255,255,0.18)', 'stain'); g.rect(x + 8, 0, 3, T, 'rgba(0,0,0,0.18)', 'stain'); }
        g.blotch(0, 0, T, T, seed, 0.25, '120,60,30');
        break;
      case 1: asphalt(g, seed); for (let x = 12; x < T; x += 48) marking(g, x, 0, 26, T, seed + x, '#ecebe4'); break;
      case 2: // crop rows
        g.rect(0, 0, T, T, '#5a4636');
        for (let x = 4; x < T; x += 22) { g.rect(x, 0, 12, T, '#cfd8b8', 'wall'); g.speckle(x, 0, 12, T, 80, ['rgba(0,0,0,0.2)'], 3, 'stain', seed + x); }
        break;
      case 3: g.rect(0, 0, T, T, '#d6d8c0', 'wall'); g.speckle(0, 0, T, T, 2400, ['rgba(0,0,0,0.12)', 'rgba(255,255,255,0.12)'], 3, 'stain', seed); break;
      case 4: wallBase(g, seed, 1.5); g.rect(0, 0, T, 22, '#dcd6ca', 'wall'); g.rect(0, 22, T, 4, 'rgba(0,0,0,0.2)', 'stain'); g.streaks(0, 26, T, 120, seed, 0.15); break;
      case 5: wallBase(g, seed); g.rect(8, 40, 240, 170, '#fff6d6'); g.text('गोदावरी सिमेंट', 128, 100, 34, '#b03a2e', { font: FONT_DEVA, weight: 800 }); g.text('मजबूत घर, मजबूत नांदेड', 128, 160, 20, '#1f4e79', { font: FONT_DEVA, weight: 700 }); break;
      case 6: wallBase(g, seed); g.rect(8, 40, 240, 170, '#18334d'); g.text('RADIO GODAVARI', 128, 100, 34, '#ffcf3f', { font: FONT_LATIN }); g.text('92.7 FM • नांदेडचा आवाज', 128, 160, 22, '#fff', { font: FONT_MIX, weight: 700 }); break;
      default: // exposed brick
        g.rect(0, 0, T, T, '#c8c2b8');
        for (let y = 0; y < T; y += 16) for (let x = (y / 16) % 2 ? -18 : 0; x < T; x += 36) g.rect(x + 1, y + 1, 34, 14, ['#a9553c', '#b5603f', '#9c4d36'][((x + y) / 4) % 3 | 0]);
    }
  } else {
    switch (c) {
      case 0: hoarding(g, 'coaching'); break;
      case 1: hoarding(g, 'birthday'); break;
      case 2: hoarding(g, 'radio'); break;
      case 3: hoarding(g, 'civic'); break;
      case 4: // Railway station name board: yellow with black lettering.
        g.rect(0, 0, T, T, '#1a1a1a');
        g.rect(6, 6, T - 12, T - 12, '#f6d32d');
        g.text('हजूर साहिब नांदेड', 128, 70, 34, '#111', { font: FONT_DEVA, weight: 800 });
        g.text('HAZUR SAHIB NANDED', 128, 140, 30, '#111', { font: FONT_LATIN });
        g.text('NED', 128, 200, 34, '#111', { font: FONT_LATIN });
        break;
      case 5: // white marble
        g.rect(0, 0, T, T, '#f4f1ea');
        for (let i = 0; i < 14; i++) { const y = (i * 37) % T; g.line(0, y, T, y + ((i * 53) % 60) - 30, 'rgba(150,140,130,0.25)', 1.5); }
        for (let y = 0; y < T; y += 64) g.rect(0, y, T, 2, 'rgba(0,0,0,0.08)');
        break;
      case 6: // gold leaf
        g.grad(0, 0, T, T, [[0, '#f9d976'], [0.5, '#e2a93b'], [1, '#c98a1f']], 'detail');
        for (let y = 0; y < T; y += 32) g.rect(0, y, T, 2, 'rgba(120,70,0,0.3)');
        break;
      default: // basalt blocks
        g.rect(0, 0, T, T, '#5c5650');
        for (let y = 0; y < T; y += 42) for (let x = (y / 42) % 2 ? -30 : 0; x < T; x += 60) { g.rect(x + 2, y + 2, 56, 38, ['#6a635b', '#615a53', '#736b62'][((x + y) / 6) % 3 | 0]); }
        g.blotch(0, 0, T, T, seed, 0.2, '30,40,20');
    }
  }
}

function hoarding(g, kind) {
  // Two-thirds hoarding art over a steel frame backing.
  g.rect(0, 0, T, T, '#3b3f42');
  if (kind === 'coaching') {
    g.grad(4, 4, T - 8, T - 8, [[0, '#0d47a1'], [1, '#1976d2']]);
    g.text('NEET 2026', 128, 40, 40, '#ffeb3b', { font: FONT_LATIN });
    for (let i = 0; i < 4; i++) { const x = 30 + i * 66; g.circle(x, 112, 24, '#ffe0c2'); g.rect(x - 22, 136, 44, 40, ['#e53935', '#43a047', '#fb8c00', '#8e24aa'][i]); g.text(`AIR ${[47, 112, 305, 690][i]}`, x, 192, 18, '#fff', { font: FONT_LATIN }); }
    g.text('VISION CLASSES • NANDED', 128, 228, 22, '#fff', { font: FONT_LATIN });
  } else if (kind === 'birthday') {
    g.grad(4, 4, T - 8, T - 8, [[0, '#ff8f00'], [1, '#d84315']]);
    g.text('वाढदिवसाच्या', 128, 36, 26, '#fff', { font: FONT_DEVA, weight: 800 });
    g.text('हार्दिक शुभेच्छा!', 128, 70, 26, '#fff59d', { font: FONT_DEVA, weight: 800 });
    g.circle(128, 140, 46, '#ffe0c2'); g.rect(98, 96, 60, 18, '#222'); g.rect(104, 130, 48, 8, '#222');
    g.rect(80, 180, 96, 40, '#fafafa');
    g.text('SHERA BHAU', 128, 236, 26, '#fff', { font: FONT_LATIN });
  } else if (kind === 'radio') {
    g.grad(4, 4, T - 8, T - 8, [[0, '#18334d'], [1, '#0b1a28']]);
    g.text('RADIO', 128, 70, 56, '#ffcf3f', { font: FONT_LATIN });
    g.text('GODAVARI', 128, 130, 50, '#ffffff', { font: FONT_LATIN });
    g.text('92.7 FM', 128, 196, 40, '#4fc3f7', { font: FONT_LATIN });
  } else {
    g.grad(4, 4, T - 8, T - 8, [[0, '#2e7d32'], [1, '#1b5e20']]);
    g.text('स्वच्छ नांदेड', 128, 70, 40, '#fff', { font: FONT_DEVA, weight: 800 });
    g.text('सुंदर नांदेड', 128, 130, 40, '#c5e1a5', { font: FONT_DEVA, weight: 800 });
    g.text('नांदेड वाघाळा शहर महानगरपालिका', 128, 200, 15, '#fff', { font: FONT_DEVA, weight: 700 });
  }
}

function paintTile(g, col, row) {
  const seed = row * 97 + col * 13 + 5;
  g.ctx.save();
  g.ctx.translate(col * T, row * T);
  g.ctx.beginPath(); g.ctx.rect(0, 0, T, T); g.ctx.clip();
  switch (row) {
    case ROW.RES: paintRes(g, col, seed); break;
    case ROW.BALCONY: paintBalcony(g, col, seed); break;
    case ROW.OLD: paintOld(g, col, seed); break;
    case ROW.MODERN: paintModern(g, col, seed); break;
    case ROW.SHOP: paintShop(g, col, seed); break;
    case ROW.GROUND: paintGround(g, col, seed); break;
    case ROW.BLANK: paintBlank(g, col, seed); break;
    default: paintSurface(g, col, row, seed);
  }
  g.ctx.restore();
}

/**
 * Copy each tile of the painted atlas into a layer of its own (layer = row * ATLAS_COLS + col),
 * with the paint mask in alpha. read(canvas, x, y, w, h) returns that block's RGBA bytes.
 * A tile alone in its layer wraps round within itself and has mipmaps of its own, so a
 * repeating road or wall never takes in the tiles painted beside it.
 */
export function packLayers(read, t) {
  const size = t * t * 4, out = new Uint8Array(ATLAS_COLS * ATLAS_ROWS * size);
  for (let row = 0; row < ATLAS_ROWS; row++) {
    for (let col = 0; col < ATLAS_COLS; col++) {
      const o = (row * ATLAS_COLS + col) * size;
      out.set(read('color', col * t, row * t, t, t), o);
      const m = read('mask', col * t, row * t, t, t);
      for (let i = 3; i < size; i += 4) out[o + i] = m[i - 3];
    }
  }
  return out;
}

/**
 * Paint the colour+mask atlas (RGBA bytes, a layer per tile) and the emissive atlas (canvas).
 * scale < 1 paints a smaller atlas (phones keep ~5 MB of texture instead of ~21).
 */
export function paintAtlas(scale = 1) {
  const W = ATLAS_COLS * T * scale, H = ATLAS_ROWS * T * scale;
  const make = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const color = make(W, H), mask = make(W, H), emissive = make(W / 2, H / 2);
  const cc = color.getContext('2d', { willReadFrequently: true });
  const mc = mask.getContext('2d', { willReadFrequently: true });
  const ec = emissive.getContext('2d');
  mc.fillStyle = '#000'; mc.fillRect(0, 0, W, H);
  ec.fillStyle = '#000'; ec.fillRect(0, 0, W / 2, H / 2);
  cc.scale(scale, scale); mc.scale(scale, scale);
  ec.scale(0.5 * scale, 0.5 * scale);
  const gc = painter(cc, 'color'), gm = painter(mc, 'mask'), ge = painter(ec, 'emissive');
  for (let row = 0; row < ATLAS_ROWS; row++) {
    for (let col = 0; col < ATLAS_COLS; col++) {
      paintTile(gc, col, row);
      paintTile(gm, col, row);
      paintTile(ge, col, row);
    }
  }
  // Read back a tile at a time: no whole-atlas copies of the colour and the mask.
  const t = T * scale;
  const data = packLayers((which, x, y, w, h) => (which === 'mask' ? mc : cc).getImageData(x, y, w, h).data, t);
  return { data, tile: t, layers: ATLAS_COLS * ATLAS_ROWS, emissive };
}

/**
 * Detail texture, tiled in world space over the city at close range so the
 * atlas repeats disappear: R = asphalt grain, G = soil clumps, B = plaster.
 * All three channels average 0.5.
 */
export function paintDetail(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const r = rng(4242);
  const chips = periodicNoise(64, 11), clumps = fbm(21, [[8, 0.45], [16, 0.35], [48, 0.2]]), plaster = fbm(31, [[6, 0.4], [16, 0.35], [40, 0.25]]);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i / size, v = j / size, k = (j * size + i) * 4;
      const grain = 0.5 + (chips(u, v) - 0.5) * 0.7 + (r() - 0.5) * 0.45;
      const soil = 0.5 + (clumps(u, v) - 0.5) * 1.3 + (r() - 0.5) * 0.25;
      const wall = 0.5 + (plaster(u, v) - 0.5) * 0.9 + (r() - 0.5) * 0.12;
      img.data[k] = Math.max(0, Math.min(255, grain * 255));
      img.data[k + 1] = Math.max(0, Math.min(255, soil * 255));
      img.data[k + 2] = Math.max(0, Math.min(255, wall * 255));
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// ------------------------------------------------------------------ signboards
export const SIGN_W = 512, SIGN_H = 64, SIGN_COLS = 4, SIGN_ROWS = 40;
const SIGN_STYLES = [
  ['#c62828', '#ffeb3b'], ['#ffeb3b', '#b71c1c'], ['#1565c0', '#ffffff'], ['#ffffff', '#c62828'],
  ['#2e7d32', '#ffffff'], ['#111111', '#ffd54f'], ['#ef6c00', '#111111'], ['#ffffff', '#1a237e'],
  ['#6a1b9a', '#fff59d'], ['#00838f', '#ffffff'],
];
const LANDMARK_SIGNS = {
  'nanded-station': ['हजूर साहिब नांदेड', 'HAZUR SAHIB NANDED', 1],
  'nanded-bus-stand': ['नांदेड मध्यवर्ती बसस्थानक', 'NANDED CENTRAL BUS STAND', 0],
  'nanded-airport': ['श्री गुरु गोबिंद सिंह जी विमानतळ', 'SHRI GURU GOBIND SINGH JI AIRPORT, NANDED', 7],
};
// Marathi name, English name and stock tile in ROW.SHOP.
export const SHOP_SIGNS = [
  ['श्री गणेश किराणा', 'SHREE GANESH KIRANA', 0], ['साई मेडिकल', 'SAI MEDICAL & GENERAL', 2], ['बालाजी मोबाईल्स', 'BALAJI MOBILES', 1],
  ['जय मल्हार हार्डवेअर', 'JAI MALHAR HARDWARE', 4], ['हॉटेल जय भवानी', 'HOTEL JAI BHAVANI', 6], ['पाटील टी हाऊस', 'PATIL TEA HOUSE', 6],
  ['ओम साई क्लॉथ सेंटर', 'OM SAI CLOTH CENTRE', 3], ['माऊली स्वीट्स', 'MAULI SWEETS', 5], ['सुरेश हेअर सलून', 'SURESH HAIR SALOON', 1],
  ['राज फोटो स्टुडिओ', 'RAJ PHOTO STUDIO', 1], ['गोदावरी इलेक्ट्रिकल्स', 'GODAVARI ELECTRICALS', 4], ['शिवनेरी झेरॉक्स', 'SHIVNERI XEROX & ONLINE', 1],
  ['साई श्रद्धा भोजनालय', 'SAI SHRADDHA BHOJNALAYA', 6], ['दत्त पान सेंटर', 'DATTA PAN CENTRE', 0], ['नांदेड सायकल मार्ट', 'NANDED CYCLE MART', 4],
  ['अंबिका ज्वेलर्स', 'AMBIKA JEWELLERS', 1], ['वैभव टेलर्स', 'VAIBHAV TAILORS', 3], ['तुळजा भवानी ट्रॅव्हल्स', 'TULJA BHAVANI TRAVELS', 1],
  ['शुभम ऑटो पार्ट्स', 'SHUBHAM AUTO PARTS', 4], ['लक्ष्मी बांगड्या', 'LAXMI BANGLES', 3], ['श्री राम मेडिकोज', 'SHRI RAM MEDICOS', 2],
  ['हजूर साहिब ढाबा', 'HAZUR SAHIB DHABA', 6], ['खालसा मोटर गॅरेज', 'KHALSA MOTOR GARAGE', 4], ['गुरु कृपा स्वीट्स', 'GURU KRIPA SWEETS', 5],
  ['न्यू इंडिया मोबाईल रिपेअरिंग', 'NEW INDIA MOBILE REPAIRING', 1], ['आई तुळजा स्टील सेंटर', 'AAI TULJA STEEL CENTRE', 4], ['समर्थ बुक डेपो', 'SAMARTH BOOK DEPOT', 0],
  ['व्हिजन क्लासेस', 'VISION CLASSES • NEET / JEE', 1], ['स्वामी समर्थ पिठाची गिरणी', 'SWAMI SAMARTH FLOUR MILL', 0], ['रॉयल बेकरी', 'ROYAL BAKERY & CAKE SHOP', 5],
  ['अण्णा रंग गॅरेज', "ANNA'S RANG GARAGE", 4], ['एमएच २६ कार वॉश', 'MH-26 CAR WASH', 4],
];

/** Signboards for shops (first 32 slots) and every researched place with a frontage. */
export function paintSigns(places, scale = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = SIGN_W * SIGN_COLS * scale; canvas.height = SIGN_H * SIGN_ROWS * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  const emis = document.createElement('canvas');
  emis.width = canvas.width / 2; emis.height = canvas.height / 2;
  const ec = emis.getContext('2d');
  ec.scale(0.5 * scale, 0.5 * scale);
  const slots = new Map();
  let slot = 0;
  const draw = (mr, en, styleIndex) => {
    const col = slot % SIGN_COLS, row = Math.floor(slot / SIGN_COLS);
    const x = col * SIGN_W, y = row * SIGN_H;
    const [bg, fg] = SIGN_STYLES[styleIndex % SIGN_STYLES.length];
    for (const [c, lit] of [[ctx, false], [ec, true]]) {
      c.fillStyle = lit ? shade(bg, 0.55) : bg; c.fillRect(x, y, SIGN_W, SIGN_H);
      c.fillStyle = lit ? fg : shade(bg, 0.75); c.fillRect(x, y + SIGN_H - 5, SIGN_W, 5); c.fillRect(x, y, SIGN_W, 3);
      c.fillStyle = fg; c.textBaseline = 'middle'; c.textAlign = 'center';
      if (mr) {
        c.font = `800 26px ${FONT_DEVA}`; c.fillText(mr, x + SIGN_W / 2, y + 21, SIGN_W - 24);
        c.font = `800 20px ${FONT_LATIN}`; c.fillText(en, x + SIGN_W / 2, y + 48, SIGN_W - 24);
      } else {
        c.font = `800 34px ${FONT_LATIN}`; c.fillText(en, x + SIGN_W / 2, y + SIGN_H / 2 + 1, SIGN_W - 24);
      }
    }
    return slot++;
  };
  SHOP_SIGNS.forEach(([mr, en], i) => draw(mr, en, i));
  const signCats = new Set(['coaching', 'college', 'school', 'hospital', 'hotel', 'restaurant', 'cafe', 'cinema', 'shopping', 'civic']);
  places.forEach((p, i) => {
    if (!signCats.has(p.category) || slot >= SIGN_COLS * SIGN_ROWS) return;
    const style = { coaching: 2, college: 7, school: 4, hospital: 3, hotel: 5, restaurant: 0, cafe: 8, cinema: 5, shopping: 6, civic: 7 }[p.category];
    const en = p.shortName.length > 34 ? p.shortName.slice(0, 33) + '…' : p.shortName;
    slots.set(p.id, draw(null, en.toUpperCase(), style + (i % 2)));
  });
  // Each petrol pump livery's price board.
  [['पेट्रोल पंप', 'PETROL ₹106.31 · DIESEL ₹92.84', 6], ['पेट्रोल पंप', 'PETROL ₹106.31 · DIESEL ₹92.84', 4], ['पेट्रोल पंप', 'PETROL ₹106.31 · DIESEL ₹92.84', 0]]
    .forEach(([mr, en, style], look) => { if (slot < SIGN_COLS * SIGN_ROWS) slots.set(`pump-${look}`, draw(mr, en, style)); });
  // The station, the bus stand and the airport carry their names in Marathi and English.
  for (const [id, [mr, en, style]] of Object.entries(LANDMARK_SIGNS)) {
    if (places.some(p => p.id === id) && slot < SIGN_COLS * SIGN_ROWS) slots.set(id, draw(mr, en, style));
  }
  return { canvas, emissive: emis, slots };
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
  return `rgb(${r},${g},${b})`;
}
