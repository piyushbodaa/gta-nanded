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
// Facade rows hold 8 variants of one "bay x floor" (3.2 m x 3.2 m).
export const ROW = { RES: 0, BALCONY: 1, OLD: 2, MODERN: 3, SHOP: 4, GROUND: 5, BLANK: 6, SURF: 7, SURF2: 8, SPECIAL: 9 };
// Single tiles: [col, row].
export const TILE = {
  ROOF: [0, 7], ASPHALT: [1, 7], ASPHALT_DASH: [2, 7], ASPHALT_MAIN: [3, 7], CONCRETE_ROAD: [4, 7], PAVERS: [5, 7], KERB: [6, 7], DIRT: [7, 7],
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
    /** Thin jagged cracks, drawn twice a tile apart so they wrap with the tile. */
    cracks(n, seed, alpha = 0.35, wrap = true) {
      if (mode !== 'color') return;
      const r = rng(seed);
      ctx.strokeStyle = `rgba(20,18,16,${alpha})`;
      ctx.lineWidth = 1.1;
      for (let k = 0; k < n; k++) {
        const pts = [[r() * T, r() * T]];
        let a = r() * Math.PI * 2;
        for (let i = 0; i < 9; i++) { a += (r() - 0.5) * 1.2; const [px, py] = pts[pts.length - 1]; pts.push([px + Math.cos(a) * 9, py + Math.sin(a) * 9]); }
        for (const oy of wrap ? [-T, 0, T] : [0]) {
          ctx.beginPath();
          pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py + oy) : ctx.moveTo(px, py + oy)));
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

function window1(g, seed, { frame = FRAMES[0], curtain = null, grillOn = true, shutters = null, w = 108, h = 108, sill = 70 } = {}) {
  const x = (T - w) / 2, y = T - sill - h;
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
  g.rect(x, y, 62, 44, '#e9e9e4'); g.rect(x, y + 40, 62, 4, '#b9b9b2');
  g.circle(x + 22, y + 21, 15, '#9a9c98'); g.circle(x + 22, y + 21, 12, '#555');
  for (let i = 0; i < 4; i++) g.line(x + 22, y + 21, x + 22 + Math.cos(i * 1.57) * 11, y + 21 + Math.sin(i * 1.57) * 11, '#aaa', 3);
  g.rect(x + 44, y + 8, 12, 26, '#c9c9c3');
}

function clothes(g, x, y, w, seed) {
  const r = rng(seed);
  g.line(x, y, x + w, y + 4, '#333', 2);
  const cols = ['#c0392b', '#2e86c1', '#f1c40f', '#8e44ad', '#16a085', '#e67e22', '#ecf0f1', '#d35400'];
  for (let cx = x + 6; cx < x + w - 14; cx += 16 + r() * 10) {
    const cw = 12 + r() * 14, ch = 22 + r() * 30;
    g.rect(cx, y + 2, cw, ch, cols[Math.floor(r() * cols.length)]);
  }
}

function pots(g, x, y, w, seed) {
  const r = rng(seed);
  for (let px = x + 8; px < x + w - 10; px += 22) {
    g.poly([[px, y], [px + 16, y], [px + 13, y + 16], [px + 3, y + 16]], '#b5562f');
    g.circle(px + 8, y - 6, 10 + r() * 4, r() < 0.5 ? '#3f7f3a' : '#5b9a45');
    if (r() < 0.4) g.circle(px + 4, y - 10, 3, '#e8415a');
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
    // Closed shutter with the shop's phone number painted on.
    g.rect(6, iy, T - 12, ih, '#8a908f');
    for (let y = iy; y < bottom; y += 7) g.rect(6, y, T - 12, 2, '#6e7473');
    g.text('मो. 98XXX', 128, iy + ih / 2, 30, '#c0392b', { font: FONT_MIX, weight: 800 });
    g.streaks(6, iy, T - 12, ih, seed, 0.12);
    return;
  }
  // Interior: back wall lit by a tube light.
  const back = ['#efe6c9', '#cfe3f1', '#e9f5ee', '#f3e3e8', '#ddd5c6', '#f6efe0', '#e8dcc6'][v];
  g.rect(6, iy, T - 12, ih, back, 'glass');
  g.rect(40, iy + 6, 176, 5, '#ffffff', 'light');
  // Shelves and goods.
  if (v === 0 || v === 2 || v === 4) {
    for (let sy = iy + 24; sy < bottom - 60; sy += 34) {
      g.rect(10, sy + 26, T - 20, 4, '#7a5a3c');
      for (let sx = 12; sx < T - 20; sx += 9 + r() * 6) g.rect(sx, sy + 6 + r() * 6, 7, 20, v === 2 ? (r() < 0.5 ? '#ffffff' : '#7fb3d5') : SHOP_GOODS[Math.floor(r() * SHOP_GOODS.length)]);
    }
  }
  if (v === 0) {
    // Kirana: grain sacks out front, chips strips hanging.
    for (let sx = 14; sx < 240; sx += 46) { g.poly([[sx, bottom], [sx + 40, bottom], [sx + 36, bottom - 44], [sx + 4, bottom - 44]], '#e7d7b0'); g.rect(sx + 6, bottom - 50, 28, 8, ['#c9a227', '#8b5a2b', '#e8e0d0', '#d35400'][Math.floor(r() * 4)]); }
    for (let sx = 20; sx < 236; sx += 30) for (let k = 0; k < 4; k++) g.rect(sx, iy + 14 + k * 14, 18, 12, SHOP_GOODS[(k + sx) % SHOP_GOODS.length]);
  } else if (v === 1) {
    // Mobile shop: blue glow, posters and a glass counter.
    g.rect(6, iy, T - 12, ih, '#cfe8ff', 'glass');
    for (let px = 20; px < 230; px += 54) { g.rect(px, iy + 20, 40, 64, '#1b4f8a'); g.rect(px + 6, iy + 26, 28, 46, '#5dade2', 'glass'); }
    g.rect(10, bottom - 70, T - 20, 62, '#9ec9e8', 'glass'); g.rect(10, bottom - 70, T - 20, 5, '#d0d0d0');
  } else if (v === 2) {
    g.rect(100, iy + 2, 56, 20, '#1e8449'); g.rect(122, iy + 4, 12, 16, '#fff', 'light'); g.rect(118, iy + 8, 20, 8, '#fff', 'light');
    g.rect(10, bottom - 56, T - 20, 48, '#f4f6f6'); g.rect(10, bottom - 56, T - 20, 4, '#1e8449');
  } else if (v === 3) {
    // Cloth centre: saris hanging in rows.
    for (let sx = 12; sx < T - 20; sx += 15) g.poly([[sx, iy + 18], [sx + 13, iy + 18], [sx + 15, bottom - 30], [sx - 2, bottom - 30]], SHOP_GOODS[Math.floor(r() * SHOP_GOODS.length)]);
    g.rect(6, bottom - 30, T - 12, 22, '#7a5a3c');
  } else if (v === 4) {
    // Hardware: pipes and buckets out front.
    for (let px = 14; px < 120; px += 8) g.rect(px, bottom - 120, 5, 112, r() < 0.5 ? '#9aa0a0' : '#e0e0e0');
    for (let bx = 136; bx < 236; bx += 34) { g.poly([[bx, bottom], [bx + 28, bottom], [bx + 32, bottom - 34], [bx - 4, bottom - 34]], SHOP_GOODS[Math.floor(r() * SHOP_GOODS.length)]); }
  } else if (v === 5) {
    // Sweets: steel trays of jalebi and laddoo behind a glass counter.
    g.rect(10, bottom - 90, T - 20, 82, '#d8eef2', 'glass');
    for (let tx = 18; tx < 236; tx += 44) for (let ty = 0; ty < 2; ty++) {
      g.rect(tx, bottom - 80 + ty * 38, 38, 26, '#b9bfc2');
      const c = ['#f39c12', '#f7dc6f', '#e67e22', '#f5f5dc', '#d35400'][(tx / 44 + ty) % 5 | 0];
      for (let k = 0; k < 8; k++) g.circle(tx + 6 + (k % 4) * 9, bottom - 74 + ty * 38 + Math.floor(k / 4) * 10, 4.5, c);
    }
  } else {
    // Tea stall: steel kettle, glasses, a bench and a menu board.
    g.rect(14, iy + 14, 90, 70, '#22313a'); g.text('चहा ₹10', 59, iy + 34, 22, '#f9e79f', { font: FONT_DEVA, weight: 700 });
    g.text('वडापाव ₹15', 59, iy + 62, 18, '#fff', { font: FONT_DEVA, weight: 700 });
    g.rect(120, bottom - 70, 120, 8, '#7a5a3c'); g.circle(160, bottom - 84, 16, '#c0c4c6'); g.rect(176, bottom - 92, 14, 6, '#c0c4c6');
    for (let k = 0; k < 6; k++) g.rect(196 + (k % 3) * 12, bottom - 86 - Math.floor(k / 3) * 14, 8, 12, 'rgba(230,240,240,0.9)');
    g.rect(20, bottom - 32, 90, 8, '#6d4c33'); g.rect(26, bottom - 24, 6, 16, '#6d4c33'); g.rect(98, bottom - 24, 6, 16, '#6d4c33');
  }
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
      window1(g, seed + 3, { frame: FRAMES[2], w: 40, h: 60, sill: 90 });
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

function asphalt(g, seed, base = '#5c5f60') {
  g.rect(0, 0, T, T, base);
  // Sun-faded binder: broad stains plus a fine grain, periodic along the road.
  const stain = fbm(seed, [[3, 0.5], [6, 0.3], [12, 0.2]]);
  const chips = periodicNoise(96, seed + 5);
  const r = rng(seed + 9);
  g.pixels(0, 0, T, T, (u, v, c) => {
    const k = 0.86 + stain(u, v) * 0.26 + (chips(u, v) - 0.5) * 0.14 + (r() - 0.5) * 0.1;
    c[0] *= k; c[1] *= k; c[2] *= k;
  });
  // Pale stone chips where the binder has worn off.
  g.speckle(0, 0, T, T, 700, ['rgba(170,166,156,0.28)', 'rgba(25,25,25,0.25)', 'rgba(140,136,128,0.3)'], 1.1, 'detail', seed);
  // Tyre-polished wheel tracks and oil dripped down the middle of each lane.
  if (g.mode === 'color') {
    g.rect(34, 0, 46, T, 'rgba(0,0,0,0.08)'); g.rect(176, 0, 46, T, 'rgba(0,0,0,0.08)');
    g.rect(98, 0, 18, T, 'rgba(10,8,6,0.07)'); g.rect(140, 0, 18, T, 'rgba(10,8,6,0.07)');
  }
  g.cracks(3, seed + 2, 0.32);
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
      case 2: asphalt(g, seed); marking(g, 124, 0, 8, 128, seed + 11); break;
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
      case 5: // interlocking pavers
        g.rect(0, 0, T, T, '#9c9a94');
        for (let y = 0; y < T; y += 32) for (let x = (y / 32) % 2 ? -16 : 0; x < T; x += 32) g.rect(x + 1.5, y + 1.5, 29, 29, ((x + y) / 32) % 3 === 0 ? '#a65d4a' : '#b3b0a8');
        g.blotch(0, 0, T, T, seed, 0.18, '60,50,40');
        break;
      case 6: // black-and-yellow kerb stones
        for (let x = 0; x < T; x += 64) { g.rect(x, 0, 32, T, '#1d1d1d'); g.rect(x + 32, 0, 32, T, '#f2c230'); }
        g.blotch(0, 0, T, T, seed, 0.2, '60,50,40');
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
export const SHOP_SIGNS = [
  ['श्री गणेश किराणा', 'SHREE GANESH KIRANA'], ['साई मेडिकल', 'SAI MEDICAL & GENERAL'], ['बालाजी मोबाईल्स', 'BALAJI MOBILES'],
  ['जय मल्हार हार्डवेअर', 'JAI MALHAR HARDWARE'], ['हॉटेल जय भवानी', 'HOTEL JAI BHAVANI'], ['पाटील टी हाऊस', 'PATIL TEA HOUSE'],
  ['ओम साई क्लॉथ सेंटर', 'OM SAI CLOTH CENTRE'], ['माऊली स्वीट्स', 'MAULI SWEETS'], ['सुरेश हेअर सलून', 'SURESH HAIR SALOON'],
  ['राज फोटो स्टुडिओ', 'RAJ PHOTO STUDIO'], ['गोदावरी इलेक्ट्रिकल्स', 'GODAVARI ELECTRICALS'], ['शिवनेरी झेरॉक्स', 'SHIVNERI XEROX & ONLINE'],
  ['साई श्रद्धा भोजनालय', 'SAI SHRADDHA BHOJNALAYA'], ['दत्त पान सेंटर', 'DATTA PAN CENTRE'], ['नांदेड सायकल मार्ट', 'NANDED CYCLE MART'],
  ['अंबिका ज्वेलर्स', 'AMBIKA JEWELLERS'], ['वैभव टेलर्स', 'VAIBHAV TAILORS'], ['तुळजा भवानी ट्रॅव्हल्स', 'TULJA BHAVANI TRAVELS'],
  ['शुभम ऑटो पार्ट्स', 'SHUBHAM AUTO PARTS'], ['लक्ष्मी बांगड्या', 'LAXMI BANGLES'], ['श्री राम मेडिकोज', 'SHRI RAM MEDICOS'],
  ['हजूर साहिब ढाबा', 'HAZUR SAHIB DHABA'], ['खालसा मोटर गॅरेज', 'KHALSA MOTOR GARAGE'], ['गुरु कृपा स्वीट्स', 'GURU KRIPA SWEETS'],
  ['न्यू इंडिया मोबाईल रिपेअरिंग', 'NEW INDIA MOBILE REPAIRING'], ['आई तुळजा स्टील सेंटर', 'AAI TULJA STEEL CENTRE'], ['समर्थ बुक डेपो', 'SAMARTH BOOK DEPOT'],
  ['व्हिजन क्लासेस', 'VISION CLASSES • NEET / JEE'], ['स्वामी समर्थ पिठाची गिरणी', 'SWAMI SAMARTH FLOUR MILL'], ['रॉयल बेकरी', 'ROYAL BAKERY & CAKE SHOP'],
  ['अण्णा रंग गॅरेज', "ANNA'S RANG GARAGE"], ['एमएच २६ कार वॉश', 'MH-26 CAR WASH'],
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
