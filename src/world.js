import * as THREE from 'three';
import { NETWORK, PLACES, BOUNDS, SPAWN } from './city-data.js';
import { createCityLabels } from './world-labels.js';

export const WORLD = Object.freeze({ bounds: BOUNDS });
const CHUNK = 200;

/** Mapped streets and researched places, with original illustrative architecture. */
export function createWorld(scene) {
  const group = new THREE.Group(); group.name = 'Nanded mapped city'; scene.add(group);
  const colliders = [], cameraStructures = [], batches = new Map(), dummy = new THREE.Object3D();
  let seed = 48271;
  const random = () => { seed = seed * 16807 % 2147483647; return (seed - 1) / 2147483646; };
  const between = (a, b) => a + random() * (b - a);
  const choose = values => values[Math.floor(random() * values.length)];
  const palette = {
    sand: '#cbb79b', sidewalk: '#d8c7aa', asphalt: '#50585a', roadEdge: '#c5bda2',
    lane: '#ead9a4', terracotta: '#bc7155', coral: '#d28c77', cream: '#e3cfaa',
    mint: '#8aa79c', sky: '#97abb3', ochre: '#c89c4d', rose: '#bf9992',
    white: '#eee5d1', roof: '#a68d78', roofEdge: '#d2bea0', window: '#354e59',
    glass: '#7098a1', dark: '#333c3e', metal: '#64716c', gold: '#deb04b',
    trunk: '#7b6248', leaf: '#668457', leafLight: '#8ba469', grass: '#9ba478',
    blue: '#3d6598', saffron: '#e6933b', red: '#b43c39', water: '#508c8b',
    train: '#af5147', awning: '#c36647', awningWhite: '#eee0b9', track: '#59564d',
    green: '#36744c', burgundy: '#7a443e', stone: '#887d6b', blueGlass: '#416d80',
    houseBlue: '#9aaeb3', housePale: '#c5d0cc', houseYellow: '#e8ad30', gateWhite: '#e2e5dc',
  };
  // Instance colours let dozens of painted facade colours share each draw call.
  const materials = {
    solid: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.88 }),
    surface: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.92 }),
    glass: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.35, metalness: 0.18 }),
    gold: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.35, metalness: 0.5 }),
    water: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.25, metalness: 0.25 }),
  };
  const colors = Object.fromEntries(Object.entries(palette).map(([name, color]) => [name, new THREE.Color(color)]));
  const surfaces = new Set(['sand', 'sidewalk', 'asphalt', 'lane', 'roadEdge', 'grass', 'track']);
  const geometries = {
    box: new THREE.BoxGeometry(1, 1, 1), cylinder: new THREE.CylinderGeometry(1, 1, 1, 10),
    cone: new THREE.ConeGeometry(1, 1, 8), sphere: new THREE.SphereGeometry(1, 8, 6),
    dome: new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    arch: new THREE.TorusGeometry(1, 0.12, 4, 16, Math.PI),
  };
  const labels = createCityLabels(PLACES, group, CHUNK);
  function shape(geometry, material, x, y, z, sx, sy, sz, rotation = 0, tilt = 0) {
    if (![x, y, z, sx, sy, sz].every(Number.isFinite) || sx <= 0 || sy <= 0 || sz <= 0) return;
    const style = surfaces.has(material) ? 'surface' : ['glass', 'blueGlass'].includes(material) ? 'glass' : ['water', 'gold'].includes(material) ? material : 'solid';
    const key = `${Math.floor(x / CHUNK)}:${Math.floor(z / CHUNK)}:${geometry}:${style}`;
    if (!batches.has(key)) batches.set(key, { geometry, material: style, matrices: [], colors: [] });
    dummy.position.set(x, y, z); dummy.scale.set(sx, sy, sz); dummy.rotation.set(tilt, rotation, 0); dummy.updateMatrix();
    batches.get(key).matrices.push(dummy.matrix.clone()); batches.get(key).colors.push(colors[material]);
  }
  const box = (m, x, y, z, w, h, d, yaw = 0) => shape('box', m, x, y, z, w, h, d, yaw);
  const cylinder = (m, x, y, z, r, h) => shape('cylinder', m, x, y, z, r, h, r);
  function local(p, x = 0, z = 0) {
    const c = Math.cos(p.rotation || 0), s = Math.sin(p.rotation || 0);
    return { x: p.x + x * c + z * s, z: p.z - x * s + z * c };
  }
  function pbox(p, m, x, y, z, w, h, d, yaw = 0) { const q = local(p, x, z); box(m, q.x, y, q.z, w, h, d, (p.rotation || 0) + yaw); }
  function pshape(p, g, m, x, y, z, sx, sy, sz) { const q = local(p, x, z); shape(g, m, q.x, y, q.z, sx, sy, sz, p.rotation || 0); }
  function psign(p, x, y, z, width, height) { const q = local(p, x, z); labels.sign(p.id, q.x, y, q.z, width, height, p.rotation || 0); }
  function collider(p, x = 0, z = 0, w = p.w, d = p.d, h = p.h) {
    const q = local(p, x, z); colliders.push({ x: q.x, z: q.z, w, d, h, rotation: p.rotation || 0 });
  }
  function overhead(p, x, z, w, d, minY, h) {
    const q = local(p, x, z); cameraStructures.push({ x: q.x, z: q.z, w, d, minY, h, rotation: p.rotation || 0 });
  }
  function strip(m, a, b, width, y, height = 0.06, maxLength = 150) {
    const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
    if (length < 0.01) return;
    const parts = Math.max(1, Math.ceil(length / maxLength)), yaw = Math.atan2(dx, dz);
    for (let i = 0; i < parts; i++) {
      const t = (i + 0.5) / parts;
      box(m, a.x + dx * t, y, a.z + dz * t, width, height, length / parts + 0.025, yaw);
    }
  }
  function distanceSegment(x, z, a, b) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    return Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
  }

  // Spatial lookup is shared by filler placement and decoration clearance.
  const edgeGrid = new Map(), occupiedGrid = new Map(), CELL = 48;
  function cells(x0, z0, x1, z1, fn) {
    for (let ix = Math.floor(x0 / CELL); ix <= Math.floor(x1 / CELL); ix++) for (let iz = Math.floor(z0 / CELL); iz <= Math.floor(z1 / CELL); iz++) fn(`${ix}:${iz}`);
  }
  const edges = NETWORK.edges.map(e => ({ ...e, aPoint: NETWORK.nodes[e.a], bPoint: NETWORK.nodes[e.b] })).filter(e => e.aPoint && e.bPoint);
  for (const e of edges) {
    const pad = (e.width || 6) / 2 + 26;
    cells(Math.min(e.aPoint.x, e.bPoint.x) - pad, Math.min(e.aPoint.z, e.bPoint.z) - pad, Math.max(e.aPoint.x, e.bPoint.x) + pad, Math.max(e.aPoint.z, e.bPoint.z) + pad, key => {
      if (!edgeGrid.has(key)) edgeGrid.set(key, []); edgeGrid.get(key).push(e);
    });
  }
  function roadClear(x, z, radius = 1) {
    return !(edgeGrid.get(`${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`) || []).some(e => distanceSegment(x, z, e.aPoint, e.bPoint) < (e.width || 6) / 2 + radius + 0.65);
  }
  function occupy(x, z, radius, rect = null) {
    const o = { x, z, radius, rect };
    cells(x - radius - 20, z - radius - 20, x + radius + 20, z + radius + 20, key => { if (!occupiedGrid.has(key)) occupiedGrid.set(key, []); occupiedGrid.get(key).push(o); });
  }
  function lotClear(x, z, radius) { return !(occupiedGrid.get(`${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`) || []).some(o => Math.hypot(o.x - x, o.z - z) < o.radius + radius + 2); }
  function housingLotClear(p, radius) {
    const cos = Math.cos(p.rotation), sin = Math.sin(p.rotation);
    const axes = [{ x: cos, z: -sin }, { x: sin, z: cos }];
    return !(occupiedGrid.get(`${Math.floor(p.x / CELL)}:${Math.floor(p.z / CELL)}`) || []).some(o => {
      if (Math.hypot(o.x - p.x, o.z - p.z) >= o.radius + radius + 0.45) return false;
      if (!o.rect) return true;
      const oc = Math.cos(o.rect.rotation), os = Math.sin(o.rect.rotation);
      const otherAxes = [{ x: oc, z: -os }, { x: os, z: oc }];
      // Separating-axis test lets adjacent homes form close rows while retaining
      // a small gap. Researched places and approach discs remain conservative.
      return ![...axes, ...otherAxes].some(axis => {
        const projection = Math.abs((o.x - p.x) * axis.x + (o.z - p.z) * axis.z);
        const a = p.w / 2 * Math.abs(axis.x * axes[0].x + axis.z * axes[0].z) + p.d / 2 * Math.abs(axis.x * axes[1].x + axis.z * axes[1].z);
        const b = o.rect.w / 2 * Math.abs(axis.x * otherAxes[0].x + axis.z * otherAxes[0].z) + o.rect.d / 2 * Math.abs(axis.x * otherAxes[1].x + axis.z * otherAxes[1].z);
        return projection >= a + b + 0.45;
      });
    });
  }
  for (const p of PLACES) {
    occupy(p.x, p.z, Math.hypot(p.w, p.d) / 2 + 2);
    if (p.approach) occupy(p.approach.x, p.approach.z, 4.5);
  }
  const riverSegments = [];
  for (const river of NETWORK.rivers || []) {
    const points = river.points || []; const width = river.width || 34;
    for (let i = 1; i < points.length; i++) riverSegments.push({ a: points[i - 1], b: points[i], width });
  }
  const dryLand = (x, z, radius) => !riverSegments.some(r => distanceSegment(x, z, r.a, r.b) < r.width / 2 + radius + 3);

  box('sand', (BOUNDS.minX + BOUNDS.maxX) / 2, -0.45, (BOUNDS.minZ + BOUNDS.maxZ) / 2, BOUNDS.maxX - BOUNDS.minX + 600, 0.7, BOUNDS.maxZ - BOUNDS.minZ + 600);
  // River bands preserve the mapped curves. Every road deck stays above the water.
  for (const r of riverSegments) {
    strip('grass', r.a, r.b, r.width + 12, -0.04, 0.12);
    strip('sand', r.a, r.b, r.width + 5, 0.01, 0.08);
    strip('water', r.a, r.b, r.width, 0.025, 0.07);
    cylinder('water', r.a.x, 0.025, r.a.z, r.width / 2, 0.07);
  }
  const nodeWidths = new Float32Array(NETWORK.nodes.length);
  for (const e of edges) {
    const w = e.width || 6;
    strip('sidewalk', e.aPoint, e.bPoint, w + 1.5, 0.075, 0.07);
    strip('asphalt', e.aPoint, e.bPoint, w, 0.13, 0.08);
    nodeWidths[e.a] = Math.max(nodeWidths[e.a], w); nodeWidths[e.b] = Math.max(nodeWidths[e.b], w);
    if (w >= 10) {
      const dx = e.bPoint.x - e.aPoint.x, dz = e.bPoint.z - e.aPoint.z, len = Math.hypot(dx, dz);
      const yaw = Math.atan2(dx, dz);
      for (let s = 5; s < len - 4; s += 12) box('lane', e.aPoint.x + dx * s / len, 0.18, e.aPoint.z + dz * s / len, 0.17, 0.018, Math.min(4.5, len - s), yaw);
    }
  }
  NETWORK.nodes.forEach((p, i) => { if (nodeWidths[i]) cylinder('asphalt', p.x, 0.13, p.z, nodeWidths[i] / 2, 0.08); });

  // The railway follows source polylines rather than a parallel invented grid.
  for (const raw of NETWORK.rails || []) {
    const points = Array.isArray(raw) ? raw : raw.points || [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
      if (len < 0.1) continue;
      const nx = dz / len, nz = -dx / len;
      strip('stone', a, b, 3.4, 0.15, 0.1);
      for (const side of [-1, 1]) strip('metal', { x: a.x + nx * side * 0.7, z: a.z + nz * side * 0.7 }, { x: b.x + nx * side * 0.7, z: b.z + nz * side * 0.7 }, 0.09, 0.27, 0.12);
      for (let s = 2; s < len; s += 5.5) box('trunk', a.x + dx * s / len, 0.2, a.z + dz * s / len, 2.9, 0.13, 0.3, Math.atan2(dx, dz));
    }
  }

  function tree(x, z, palm = false, scale = 1) {
    const h = (palm ? 9 : 5.6) * scale;
    cylinder('trunk', x, h / 2, z, 0.3 * scale, h);
    if (palm) {
      shape('sphere', 'leaf', x, h + 0.3, z, 1.1 * scale, 1.3 * scale, 1.1 * scale);
      for (let i = 0; i < 5; i++) { const a = i * Math.PI * 0.4; shape('sphere', i % 2 ? 'leaf' : 'leafLight', x + Math.sin(a) * 1.5 * scale, h + 0.6, z + Math.cos(a) * 1.5 * scale, 0.7 * scale, 0.35 * scale, 2.8 * scale, a); }
    } else {
      shape('sphere', 'leaf', x, h, z, 3.2 * scale, 3.6 * scale, 3.2 * scale);
      shape('sphere', 'leafLight', x - scale, h + 1.7 * scale, z + 0.6 * scale, 2.4 * scale, 2.2 * scale, 2.4 * scale);
    }
  }
  function ptree(p, x, z, palm = false, scale = 1) { const q = local(p, x, z); tree(q.x, q.z, palm, scale); }
  function lamp(x, z, yaw = 0) {
    cylinder('metal', x, 4.2, z, 0.12, 8.4);
    box('metal', x + Math.sin(yaw) * 0.7, 8.3, z + Math.cos(yaw) * 0.7, 0.14, 0.14, 1.5, yaw);
    box('white', x + Math.sin(yaw) * 1.2, 8.2, z + Math.cos(yaw) * 1.2, 0.65, 0.17, 0.9, yaw);
  }
  function bench(p, x, z, width = 3.2) {
    pbox(p, 'trunk', x, 0.9, z, width, 0.2, 0.9);
    pbox(p, 'trunk', x, 1.5, z - 0.4, width, 0.8, 0.16);
    for (const side of [-1, 1]) pbox(p, 'dark', x + side * width * 0.34, 0.4, z, 0.2, 0.8, 0.7);
  }
  function windows(p, width = p.w, depth = p.d, height = p.h, color = 'window', compact = false) {
    const floors = Math.min(compact ? 3 : 5, Math.max(1, Math.floor((height - 3) / 3.3)));
    const columns = Math.max(2, Math.min(compact ? 3 : 7, Math.floor(width / 4.3)));
    for (let f = 0; f < floors; f++) {
      const y = 4.3 + f * 3.3;
      if (y + 0.8 > height) continue;
      for (let c = 0; c < columns; c++) {
        const x = ((c + 0.5) / columns - 0.5) * width * 0.9;
        pbox(p, color, x, y, depth / 2 + 0.035, width / columns * 0.48, 1.6, 0.07);
        if (!compact) pbox(p, 'cream', x, y - 0.95, depth / 2 + 0.22, width / columns * 0.56, 0.13, 0.55);
      }
      if (!compact) for (const side of [-1, 1]) for (let c = -1; c <= 1; c++) pbox(p, color, side * (width / 2 + 0.035), y, c * depth * 0.26, 0.07, 1.6, depth * 0.14);
    }
  }
  function rooftop(p, w = p.w, d = p.d, h = p.h) {
    pbox(p, 'roof', 0, h + 0.15, 0, w + 0.2, 0.3, d + 0.2);
    for (const side of [-1, 1]) {
      pbox(p, 'roofEdge', side * (w / 2 - 0.12), h + 0.5, 0, 0.25, 0.6, d);
      pbox(p, 'roofEdge', 0, h + 0.5, side * (d / 2 - 0.12), w, 0.6, 0.25);
    }
    if (w > 6 && d > 5) {
      pbox(p, 'cream', w * 0.23, h + 0.6, -d * 0.2, 2.4, 0.8, 2.4);
      pshape(p, 'cylinder', 'dark', w * 0.23, h + 1.8, -d * 0.2, 0.95, 1.8, 0.95);
      pshape(p, 'cylinder', 'dark', w * 0.23, h + 2.75, -d * 0.2, 0.86, 0.15, 0.86);
    }
  }
  function ordinary(p, opts = {}) {
    const { w, d, h } = p, color = opts.color || choose(['terracotta', 'cream', 'coral', 'mint', 'sky', 'rose', 'ochre']);
    pbox(p, color, 0, h / 2, 0, w, h, d); collider(p);
    windows(p, w, d, h, opts.glass ? 'blueGlass' : 'window', opts.filler);
    rooftop(p);
    const fz = d / 2 + 0.06;
    pbox(p, opts.glass ? 'glass' : 'dark', 0, 1.35, fz, Math.min(w * 0.6, 8), 2.7, 0.09);
    if (opts.filler) {
      for (let s = 0; s < 4; s++) pbox(p, 'metal', 0, 0.4 + s * 0.6, fz + 0.06, w * 0.72, 0.05, 0.06);
    }
    const signH = Math.max(1.6, Math.min(3, w * 0.22));
    if (opts.filler) { const q = local(p, 0, fz + 0.06); labels.generic(opts.sign || 0, q.x, 3.05, q.z, w * 0.92, Math.min(2, signH), p.rotation); }
    else psign(p, 0, Math.min(h - 0.25, 3.8), fz + 0.08, w * 0.94, signH);
    if (opts.awning) {
      const stripes = 6;
      for (let n = 0; n < stripes; n++) pbox(p, n % 2 ? 'awningWhite' : opts.awning, (n - 2.5) * w / stripes, 2.9, fz + 0.8, w / stripes, 0.14, 1.8);
    }
    if (!opts.filler && h > 8) for (const side of [-1, 1]) pbox(p, 'white', side * w * 0.38, 5.1, fz + 0.3, 1.2, 0.65, 0.6);
  }
  function coaching(p) {
    const { w, d, h } = p, iib = /\bIIB\b/i.test(p.name), allen = /\bALLEN\b/i.test(p.name), konale = /konale/i.test(p.name), rcc = /\bRCC\b/i.test(p.name);
    pbox(p, 'cream', 0, h / 2, 0, w, h, d); collider(p); rooftop(p);
    const fz = d / 2 + 0.06;
    if (iib) {
      for (let floor = 0; floor < 3; floor++) {
        const y = Math.min(h - 2.5, 4 + floor * 3.5);
        pbox(p, 'blue', 0, y, fz, w * 0.9, 2.1, 0.1);
        for (let n = -3; n <= 3; n++) pbox(p, 'white', n * w * 0.125, y, fz + 0.06, 0.16, 2.1, 0.1);
      }
      pbox(p, 'dark', 0, h - 1.1, fz + 0.1, w, 2.2, 0.15);
      psign(p, 0, h - 0.7, fz + 0.25, w * 0.94, 2.8);
    } else if (rcc) {
      for (let y = 1; y < h; y += 1.1) pbox(p, 'roofEdge', 0, y, fz, w, 0.07, 0.12);
      for (const x of [-w * 0.29, -w * 0.08]) pbox(p, 'dark', x, h * 0.56, fz + 0.06, w * 0.1, h * 0.66, 0.1);
      for (let n = 0; n < 3; n++) { pbox(p, 'white', w * 0.28, 4 + n * 3.3, fz + 0.3, w * 0.24, 2.3, 0.55); pbox(p, 'blueGlass', w * 0.28, 4 + n * 3.3, fz + 0.6, w * 0.19, 1.8, 0.06); }
      psign(p, 0, 3.2, fz + 0.7, w * 0.98, 2.2);
    } else {
      windows(p); pbox(p, allen ? 'green' : konale ? 'red' : 'blue', 0, h - 1.1, fz + 0.06, w, 2.3, 0.15);
      psign(p, 0, h - 0.9, fz + 0.2, w * 0.96, 2.6);
      if (konale) { pbox(p, 'burgundy', w * 0.29, 5, fz + 0.35, w * 0.26, 5.8, 0.65); pbox(p, 'glass', w * 0.29, 5, fz + 0.73, w * 0.22, 5.2, 0.07); }
    }
    pbox(p, 'dark', 0, 1.35, fz + 0.08, Math.min(w * 0.5, 7), 2.7, 0.15);
    pbox(p, 'white', 0, 0.15, fz - 0.1, w * 0.56, 0.3, 0.65);
    if (h > 8) pbox(p, 'white', -w * 0.37, 4.7, fz + 0.3, 1.2, 0.7, 0.6);
  }
  function campus(p) {
    const { w, d, h } = p;
    pbox(p, 'grass', 0, 0.05, 0, w, 0.1, d);
    const bd = d * 0.58, bz = -d * 0.18;
    pbox(p, 'cream', 0, h / 2, bz, w * 0.94, h, bd); collider(p, 0, bz, w * 0.94, bd, h);
    const bp = { ...p, ...local(p, 0, bz), w: w * 0.94, d: bd };
    windows(bp); rooftop(bp);
    pbox(p, 'terracotta', 0, h + 0.5, bz, w * 0.97, 0.5, bd + 0.4);
    const gw = Math.min(w * 0.72, 24), fz = d / 2 - 0.45;
    for (const side of [-1, 1]) { pbox(p, 'terracotta', side * gw / 2, 2.5, fz, 1.6, 5, 1.1); collider(p, side * gw / 2, fz, 1.6, 1.1, 5); }
    pbox(p, 'cream', 0, 4.9, fz, gw + 1.6, 1.1, 1.2);
    psign(p, 0, 4.9, fz + 0.66, gw, 1.8);
    pbox(p, 'sidewalk', 0, 0.14, d * 0.23, Math.min(5, w * 0.22), 0.15, d * 0.52);
    if (w > 24) { ptree(p, -w * 0.37, d * 0.27, true, 0.65); ptree(p, w * 0.37, d * 0.27, true, 0.65); }
  }
  function shrine(p, grand = false, temple = false) {
    const { w, d } = p, h = Math.min(p.h, grand ? 22 : 13), bw = w * 0.78, bd = d * 0.64, bz = -d * 0.1;
    pbox(p, 'white', 0, 0.18, 0, w, 0.36, d);
    pbox(p, 'white', 0, h / 2 + 0.4, bz, bw, h, bd); collider(p, 0, bz, bw, bd, h + bw * 0.35);
    pbox(p, 'gold', 0, h + 0.55, bz, bw + 0.4, 0.35, bd + 0.4);
    const radius = Math.min(bw, bd) * 0.23;
    pshape(p, 'cylinder', 'white', 0, h + 1.4, bz, radius * 0.9, 1.9, radius * 0.9);
    if (temple) {
      for (let tier = 0; tier < 4; tier++) pshape(p, 'cone', tier % 2 ? 'cream' : 'white', 0, h + 1.4 + tier * radius * 0.48, bz, radius * (1 - tier * 0.18), radius * 0.8, radius * (1 - tier * 0.18));
      pshape(p, 'cone', 'gold', 0, h + radius * 2.2, bz, 0.5, 2.5, 0.5);
    } else {
      pshape(p, 'dome', grand ? 'gold' : 'white', 0, h + 2.1, bz, radius, radius * 1.05, radius);
      pshape(p, 'cone', 'gold', 0, h + radius + 3.1, bz, 0.55, 2.3, 0.55);
    }
    for (const side of [-1, 1]) {
      pbox(p, 'white', side * bw * 0.41, h * 0.61, bz, bw * 0.12, h * 1.16, bd * 0.15);
      pshape(p, 'dome', grand ? 'gold' : 'white', side * bw * 0.41, h * 1.23, bz, radius * 0.36, radius * 0.47, radius * 0.36);
    }
    for (let n = -2; n <= 2; n++) {
      const x = n * bw * 0.17, front = bz + bd / 2 + 0.05;
      pbox(p, 'window', x, 2.6, front, bw * 0.1, 3.9, 0.09);
      pshape(p, 'dome', 'window', x, 4.55, front, bw * 0.05, 1.1, 0.08);
    }
    for (let n = 0; n < 4; n++) pbox(p, 'cream', 0, 0.08 + n * 0.13, d * 0.41 - n * 0.5, w * 0.57, 0.16 + n * 0.2, 1.1);
    psign(p, 0, 2.4, d / 2 - 0.12, Math.min(w * 0.9, 32), 2.2);
    const pole = local(p, -w * 0.43, d * 0.28);
    cylinder('gold', pole.x, 7, pole.z, 0.09, 14); pbox(p, 'saffron', -w * 0.43 + 0.9, 12.5, d * 0.28, 1.8, 1.2, 0.06);
  }
  function shrineKiosk(p, x, z, base, radius, gold = false) {
    const paint = gold ? 'gold' : 'white';
    pshape(p, 'cylinder', 'white', x, base + 0.2, z, radius * 1.2, 0.4, radius * 1.2);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) pbox(p, 'white', x + sx * radius * 0.56, base + 1.1, z + sz * radius * 0.56, 0.2, 1.8, 0.2);
    pshape(p, 'cylinder', 'white', x, base + 2.1, z, radius * 1.2, 0.3, radius * 1.2);
    pshape(p, 'dome', paint, x, base + 2.25, z, radius, radius * 1.1, radius);
    pshape(p, 'cone', 'gold', x, base + 2.7 + radius, z, 0.16, 0.9, 0.16);
  }
  function hazurSahib(p) {
    // Board architecture reference: high plinth, two storeys, gilded central
    // ribbed dome and four octagonal roof kiosks. A compact original model.
    // https://hazursahib.com/web/history
    const { w, d } = p, bw = w * 0.69, bd = d * 0.58, z = -d * 0.12, h = 8.5;
    pbox(p, 'white', 0, 0.15, 0, w, 0.3, d);
    for (let n = -3; n <= 3; n++) pbox(p, 'stone', n * w * 0.13, 0.31, d * 0.32, 0.035, 0.02, d * 0.27);
    pbox(p, 'cream', 0, 0.7, z, bw + 1.2, 1.3, bd + 1.2);
    pbox(p, 'white', 0, h / 2 + 1, z, bw, h, bd);
    collider(p, 0, z, bw + 1.2, bd + 1.2, 20.8);
    for (const y of [1.5, 5.5, h + 1.3]) pbox(p, 'cream', 0, y, z, bw + 0.4, 0.24, bd + 0.4);
    const front = z + bd / 2 + 0.05;
    for (let n = -3; n <= 3; n++) {
      const x = n * bw * 0.135;
      for (const y of [2.7, 6.9]) {
        pbox(p, 'window', x, y, front, 1.55, 2.2, 0.08);
        pshape(p, 'dome', 'window', x, y + 1.1, front, 0.775, 0.7, 0.08);
        pshape(p, 'arch', 'cream', x, y + 1.1, front + 0.04, 0.87, 0.78, 0.65);
      }
    }
    const upper = Math.min(bw, bd) * 0.47;
    pbox(p, 'white', 0, 11.1, z, upper, 3.4, upper);
    pbox(p, 'gold', 0, 12.9, z, upper + 0.7, 0.35, upper + 0.7);
    const r = upper * 0.52;
    pshape(p, 'cylinder', 'gold', 0, 13.3, z, r * 0.83, 0.65, r * 0.83);
    pshape(p, 'dome', 'gold', 0, 13.6, z, r, r * 1.1, r);
    for (let n = 0; n < 12; n++) {
      const a = n * Math.PI / 6;
      pshape(p, 'sphere', 'gold', Math.sin(a) * r * 0.71, 14.5, z + Math.cos(a) * r * 0.71, 0.14, r * 0.65, 0.14);
    }
    pshape(p, 'cylinder', 'gold', 0, 14.6 + r, z, 0.12, 2.1, 0.12);
    pshape(p, 'dome', 'gold', 0, 15.3 + r, z, 0.65, 0.25, 0.65);
    pshape(p, 'cone', 'gold', 0, 16 + r, z, 0.24, 1.3, 0.24);
    for (const x of [-1, 1]) for (const end of [-1, 1]) shrineKiosk(p, x * bw * 0.4, z + end * bd * 0.4, h + 1.4, 1.2, true);
    for (let n = -6; n <= 6; n++) pbox(p, 'white', n * bw / 13, h + 1.9, front, 0.18, 1, 0.18);
    for (const side of [-1, 1]) {
      const pole = local(p, side * w * 0.43, d * 0.2);
      cylinder('gold', pole.x, 9, pole.z, 0.1, 18);
      pbox(p, 'saffron', side * w * 0.43 + 0.8, 16.3, d * 0.2, 1.6, 1.35, 0.07);
    }
    for (let n = 0; n < 5; n++) pbox(p, 'white', 0, 0.15 + n * 0.13, front + 2.5 - n * 0.45, bw * 0.4, 0.25 + n * 0.22, 0.65);
    psign(p, -w * 0.25, 1.4, d * 0.46, w * 0.46, 1.2);
  }
  function malTekdi(p) {
    // Central dome, flanking open kiosks and an arched entrance are visible in
    // the shrine board's photograph: https://hazursahib.com/web/mal_tekdi_sahib
    const { w, d } = p, bw = w * 0.86, bd = d * 0.61, z = -d * 0.13, h = 7.3, front = z + bd / 2;
    pbox(p, 'white', 0, 0.2, 0, w, 0.4, d);
    pbox(p, 'white', 0, h / 2 + 0.5, z, bw, h, bd); collider(p, 0, z, bw, bd, h + 6);
    pbox(p, 'terracotta', 0, 4.3, front + 0.06, bw, 0.23, 0.1);
    for (const x of [-bw * 0.27, 0, bw * 0.27]) pbox(p, 'window', x, 2.5, front + 0.09, 1.8, 3.7, 0.1);
    pshape(p, 'cylinder', 'white', 0, h + 1, z, 2.7, 1.2, 2.7);
    pshape(p, 'dome', 'white', 0, h + 1.6, z, 3.3, 3.6, 3.3);
    pshape(p, 'cone', 'gold', 0, h + 5.8, z, 0.23, 1.2, 0.23);
    for (const side of [-1, 1]) shrineKiosk(p, side * bw * 0.36, front - 1.4, h + 0.7, 1.2);
    const entryZ = d * 0.37;
    for (const side of [-1, 1]) {
      pbox(p, 'white', side * 3.3, 2, entryZ, 0.55, 4, 0.6);
      collider(p, side * 3.3, entryZ, 0.55, 0.6, 5.5);
      pshape(p, 'dome', 'white', side * 3.3, 4.1, entryZ, 0.6, 0.8, 0.6);
    }
    pshape(p, 'arch', 'white', 0, 3.8, entryZ, 3.3, 3.3, 1.7);
    overhead(p, 0, entryZ, 7.4, 0.5, 3.4, 7.5);
    psign(p, 0, h + 0.55, front + 0.18, bw * 0.55, 1.7);
  }
  function kaleshwar(p) {
    // Red stepped shikhara and river-facing steps: district administration's
    // Kaleshwar photographs, not the unrelated Hottal temple in Degloor.
    const { w, d } = p, z = -d * 0.16, bw = w * 0.68, bd = d * 0.56;
    pbox(p, 'stone', 0, 0.15, 0, w, 0.3, d);
    pbox(p, 'cream', 0, 2.65, z, bw, 4.8, bd); collider(p, 0, z, bw, bd, 17);
    pbox(p, 'terracotta', 0, 5.2, z, bw + 0.4, 0.45, bd + 0.4);
    for (let tier = 0; tier < 7; tier++) {
      const size = 3.9 * (1 - tier * 0.115);
      pshape(p, 'cone', tier % 2 ? 'terracotta' : 'coral', 0, 6 + tier * 1.15, z - bd * 0.16, size, 2.4, size);
    }
    pshape(p, 'sphere', 'gold', 0, 14.1, z - bd * 0.16, 0.3, 0.4, 0.3);
    pbox(p, 'gold', 0, 15.1, z - bd * 0.16, 0.07, 1.9, 0.07);
    pbox(p, 'saffron', 0.6, 15.5, z - bd * 0.16, 1.2, 0.7, 0.04);
    for (let n = -2; n <= 2; n++) pbox(p, 'window', n * bw * 0.17, 2.2, z + bd / 2 + 0.04, bw * 0.1, 3.3, 0.1);
    for (let n = 0; n < 6; n++) pbox(p, 'stone', 0, 0.08 + n * 0.07, d * 0.45 - n * 0.37, w * 0.82, 0.16 + n * 0.12, 0.45);
    psign(p, 0, 4.5, z + bd / 2 + 0.15, bw * 0.9, 1.3);
  }
  function riverGhat(p) {
    const { w, d } = p;
    pbox(p, 'sidewalk', 0, 0.12, d * 0.23, w, 0.24, d * 0.54);
    pbox(p, 'water', 0, 0.06, -d * 0.36, w, 0.1, d * 0.28);
    for (let n = 0; n < 7; n++) {
      const z = -d * 0.19 + n * d * 0.045;
      pbox(p, n % 2 ? 'cream' : 'stone', 0, 0.08 + n * 0.045, z, w * 0.98, 0.16 + n * 0.08, d * 0.05);
    }
    for (const side of [-1, 1]) {
      const x = side * w * 0.43;
      pbox(p, 'stone', x, 1, -d * 0.1, 0.45, 2, d * 0.5);
      collider(p, x, -d * 0.1, 0.45, d * 0.5, 2);
      const q = local(p, x, d * 0.34); lamp(q.x, q.z, p.rotation);
      bench(p, side * w * 0.29, d * 0.25, Math.min(3, w * 0.19));
    }
    psign(p, -w * 0.26, 1.6, d * 0.46, w * 0.46, 1.3);
  }
  function vishnupuriDam(p) {
    const { w, d } = p, gates = 5, spacing = w * 0.88 / gates;
    pbox(p, 'water', 0, 0.1, -d * 0.12, w, 0.18, d * 0.76);
    pbox(p, 'stone', 0, 0.2, d * 0.37, w, 0.4, d * 0.25);
    for (let n = 0; n <= gates; n++) {
      const x = (n - gates / 2) * spacing;
      pbox(p, 'cream', x, 4, -d * 0.12, 0.8, 8, d * 0.28);
      collider(p, x, -d * 0.12, 0.8, d * 0.28, 8.8);
    }
    for (let n = 0; n < gates; n++) {
      const x = (n - (gates - 1) / 2) * spacing;
      pbox(p, 'blueGlass', x, 3.8, -d * 0.13, spacing - 0.8, 6.5, 0.3);
      collider(p, x, -d * 0.13, spacing - 0.8, 0.3, 7.2);
      pbox(p, 'water', x, 1.05, d * 0.02, spacing - 0.95, 1.9, 0.12);
      for (let bar = 0; bar < 4; bar++) pbox(p, 'metal', x, 1.4 + bar * 1.55, -d * 0.13 + 0.18, spacing - 0.8, 0.15, 0.16);
      pbox(p, 'metal', x, 8.55, -d * 0.12, 1.3, 0.8, 0.9);
    }
    pbox(p, 'cream', 0, 7.7, -d * 0.12, w * 0.95, 0.55, d * 0.31);
    overhead(p, 0, -d * 0.12, w * 0.95, d * 0.31, 7.4, 8.7);
    for (let n = -6; n <= 6; n++) pbox(p, 'metal', n * w * 0.072, 8.2, d * 0.04, 0.08, 0.8, 0.08);
    pbox(p, 'metal', 0, 8.6, d * 0.04, w * 0.92, 0.08, 0.08);
    psign(p, -w * 0.23, 1.6, d * 0.48, w * 0.5, 1.3);
  }
  function clockTower(p) {
    // White three-tier square shaft and gold cap from Shubham Takode's own
    // photograph: commons.wikimedia.org/wiki/File:Old_Mondha_Clock_Tower,Nanded.jpg
    const size = Math.min(p.w, p.d) * 0.34, h = 17;
    pbox(p, 'grass', 0, 0.08, 0, p.w, 0.16, p.d);
    pbox(p, 'white', 0, h / 2, 0, size, h, size); collider(p, 0, 0, size + 0.6, size + 0.6, h + 3);
    for (const y of [0.4, 5.7, 11.3, 16.8]) pbox(p, 'cream', 0, y, 0, size + 0.65, 0.35, size + 0.65);
    pshape(p, 'dome', 'gold', 0, 17.2, 0, size * 0.38, 1.7, size * 0.38);
    pshape(p, 'cone', 'gold', 0, 19.3, 0, 0.2, 1, 0.2);
    for (let side = 0; side < 4; side++) {
      const face = { ...p, rotation: p.rotation + side * Math.PI / 2 };
      pshape(face, 'sphere', 'dark', 0, 14, size / 2 + 0.06, 1.02, 1.02, 0.07);
      pshape(face, 'sphere', 'cream', 0, 14, size / 2 + 0.13, 0.87, 0.87, 0.04);
      pbox(face, 'dark', 0, 14.32, size / 2 + 0.19, 0.09, 0.65, 0.07);
      pbox(face, 'dark', 0.26, 14, size / 2 + 0.2, 0.55, 0.09, 0.07);
      pbox(face, 'window', 0, 1.8, size / 2 + 0.03, 1.5, 2.8, 0.08);
      pshape(face, 'dome', 'window', 0, 3.2, size / 2 + 0.03, 0.75, 0.9, 0.07);
      for (const y of [6.1, 11.7]) for (let n = -3; n <= 3; n++) pbox(face, 'metal', n * size * 0.14, y, size / 2 + 0.18, 0.06, 0.6, 0.06);
    }
    bench(p, -p.w * 0.32, p.d * 0.25, 2.5); bench(p, p.w * 0.32, p.d * 0.25, 2.5);
    psign(p, -p.w * 0.25, 1.5, p.d * 0.46, p.w * 0.48, 1.2);
  }
  function kaman(p) {
    const w = p.w, d = Math.min(2, p.d), h = Math.min(8, p.h);
    pbox(p, 'stone', 0, h * 0.43, 0, w * 0.18, h * 0.86, d); collider(p, 0, 0, w * 0.18, d, h);
    for (const side of [-1, 1]) { pbox(p, 'cream', side * w * 0.46, h * 0.43, 0, w * 0.075, h * 0.86, d); collider(p, side * w * 0.46, 0, w * 0.075, d, h); }
    pbox(p, 'cream', 0, h * 0.91, 0, w, h * 0.15, d + 0.2);
    pbox(p, 'terracotta', 0, h * 0.51, d / 2 + 0.05, w * 0.14, h * 0.52, 0.1);
    pshape(p, 'sphere', 'gold', 0, h * 0.54, d / 2 + 0.3, w * 0.035, h * 0.1, 0.25);
    psign(p, 0, h + 0.9, d / 2 + 0.15, w * 1.02, 2.1);
    for (const side of [-1, 1]) { const q = local(p, side * w * 0.14, d / 2); cylinder('dark', q.x, h + 0.3, q.z, 0.08, 1.4); pbox(p, 'gold', side * w * 0.14, h + 1, d / 2, 0.45, 0.55, 0.45); }
  }
  function square(p) {
    const { w, d } = p;
    pbox(p, 'sidewalk', 0, 0.1, 0, w, 0.2, d);
    if (/putla|putala|shivaji|ambedkar|sathe/i.test(p.name)) {
      pbox(p, 'stone', 0, 0.45, -d * 0.14, 2.7, 0.9, 2.7);
      pbox(p, 'dark', 0, 1.6, -d * 0.14, 1.6, 1.7, 1.6); collider(p, 0, -d * 0.14, 2.8, 2.8, 4.6);
      pshape(p, 'cylinder', 'gold', 0, 3.2, -d * 0.14, 0.44, 1.65, 0.44);
      pshape(p, 'sphere', 'gold', 0, 4.27, -d * 0.14, 0.4, 0.45, 0.4);
    }
    for (const side of [-1, 1]) pbox(p, 'metal', side * w * 0.36, 1.3, d * 0.38, 0.13, 2.6, 0.13);
    psign(p, 0, 2.5, d * 0.38 + 0.1, Math.max(6, w * 0.9), 2.1);
  }
  function fort(p) {
    const { w, d } = p, h = Math.min(10, p.h);
    pbox(p, 'grass', 0, 0.05, 0, w, 0.1, d);
    pbox(p, 'stone', 0, h / 2, -d * 0.43, w, h, d * 0.14); collider(p, 0, -d * 0.43, w, d * 0.14, h);
    for (const side of [-1, 1]) {
      pbox(p, 'stone', side * w * 0.43, h / 2, 0, w * 0.14, h, d); collider(p, side * w * 0.43, 0, w * 0.14, d, h);
      pbox(p, 'stone', side * w * 0.32, h / 2, d * 0.43, w * 0.36, h, d * 0.14); collider(p, side * w * 0.32, d * 0.43, w * 0.36, d * 0.14, h);
      for (const end of [-1, 1]) pshape(p, 'cylinder', 'stone', side * w * 0.42, h * 0.58, end * d * 0.42, Math.min(w, d) * 0.1, h * 1.16, Math.min(w, d) * 0.1);
    }
    for (let n = 0; n < 9; n++) {
      const x = (n / 8 - 0.5) * w * 0.95;
      pbox(p, 'stone', x, h + 0.45, -d * 0.43, w * 0.06, n % 3 === 0 ? 0.7 : 1.3, d * 0.16);
    }
    // An open arch preserves the entrance; staggered masonry and interrupted
    // parapets give the riverside fort a stone silhouette instead of a box.
    pshape(p, 'arch', 'stone', 0, h * 0.48, d * 0.43, w * 0.14, h * 0.42, 4);
    overhead(p, 0, d * 0.43, w * 0.32, 1, h * 0.42, h);
    for (let row = 0; row < 7; row++) {
      for (const side of [-1, 1]) {
        pbox(p, 'roof', side * w * 0.32, 0.6 + row * 1.3, d * 0.501, w * 0.35, 0.055, 0.025);
        for (let n = 0; n < 3; n++) pbox(p, 'roof', side * (w * 0.18 + n * w * 0.11 + (row % 2) * w * 0.04), 1.1 + row * 1.3, d * 0.501, 0.05, 0.9, 0.025);
      }
    }
    psign(p, -w * 0.32, 3, d * 0.51, w * 0.35, 1.3);
    ptree(p, -w * 0.22, 0, false, 0.85); ptree(p, w * 0.22, -d * 0.15, false, 0.85);
  }
  function park(p, stadium = false) {
    const { w, d } = p;
    pbox(p, 'grass', 0, 0.09, 0, w, 0.18, d);
    if (stadium) {
      pbox(p, 'terracotta', 0, 0.2, 0, w * 0.79, 0.08, d * 0.83);
      pbox(p, 'green', 0, 0.26, 0, w * 0.64, 0.08, d * 0.69);
      pbox(p, 'cream', 0, 0.32, 0, 2.2, 0.04, Math.min(15, d * 0.3));
      for (const side of [-1, 1]) {
        for (let n = 0; n < 3; n++) pbox(p, n % 2 ? 'white' : 'blue', side * (w * 0.38 + n * 1.2), 0.7 + n * 0.9, 0, 1.8, 1.1, d * 0.7);
        collider(p, side * w * 0.41, 0, Math.min(w * 0.17, 6), d * 0.72, 4);
        for (const end of [-1, 1]) { const q = local(p, side * w * 0.44, end * d * 0.4); cylinder('metal', q.x, 8, q.z, 0.15, 16); pbox(p, 'white', side * w * 0.44, 16, end * d * 0.4, 3, 1.3, 0.5); }
      }
    } else {
      pbox(p, 'sidewalk', 0, 0.21, 0, 2.5, 0.1, d * 0.95); pbox(p, 'sidewalk', 0, 0.22, 0, w * 0.95, 0.1, 2.5);
      for (const x of [-0.35, 0.35]) for (const z of [-0.3, 0.3]) ptree(p, x * w, z * d, false, 0.85);
      bench(p, -w * 0.23, 2); bench(p, w * 0.23, -2);
      pshape(p, 'cylinder', 'stone', 0, 0.5, -d * 0.24, Math.min(w, d) * 0.09, 0.6, Math.min(w, d) * 0.09);
      pshape(p, 'cylinder', 'water', 0, 0.85, -d * 0.24, Math.min(w, d) * 0.077, 0.08, Math.min(w, d) * 0.077);
    }
    psign(p, 0, 3, d / 2 - 0.1, Math.min(w * 0.94, 28), 2.4);
  }
  function station(p, bus = false) {
    const { w, d, h } = p;
    const bd = d * 0.47, bz = -d * 0.23;
    pbox(p, 'cream', 0, Math.min(h, 9) / 2, bz, w, Math.min(h, 9), bd); collider(p, 0, bz, w, bd, Math.min(h, 9));
    pbox(p, 'terracotta', 0, Math.min(h, 9) + 0.2, bz, w + 0.2, 0.5, bd + 0.2);
    for (let n = -3; n <= 3; n++) pbox(p, 'window', n * w * 0.13, 3.4, bz + bd / 2 + 0.05, w * 0.08, 5.5, 0.1);
    pbox(p, 'metal', 0, 4.5, d * 0.25, w * 0.94, 0.3, d * 0.31);
    for (let n = -3; n <= 3; n++) pbox(p, 'metal', n * w * 0.145, 2.3, d * 0.35, 0.16, 4.6, 0.16);
    psign(p, 0, 6.2, d * 0.41, w * 0.94, 2.8);
    if (bus) for (const side of [-1, 1]) {
      pbox(p, 'red', side * w * 0.24, 1.6, d * 0.12, Math.min(3, w * 0.17), 2.8, Math.min(d * 0.32, 9));
      pbox(p, 'window', side * w * 0.24, 2.5, d * 0.12 + Math.min(d * 0.16, 4.5) + 0.04, Math.min(2.6, w * 0.15), 1.1, 0.08);
      collider(p, side * w * 0.24, d * 0.12, Math.min(3, w * 0.17), Math.min(d * 0.32, 9), 3);
    }
  }
  function airport(p) {
    const { w, d } = p;
    pbox(p, 'grass', 0, 0.03, 0, w, 0.06, d);
    pbox(p, 'asphalt', 0, 0.14, -d * 0.29, w * 0.95, 0.08, d * 0.25);
    for (let n = -4; n <= 4; n++) pbox(p, 'white', n * w * 0.095, 0.2, -d * 0.29, w * 0.038, 0.02, 0.25);
    pbox(p, 'cream', 0, 3.4, d * 0.14, w * 0.62, 6.8, d * 0.25); collider(p, 0, d * 0.14, w * 0.62, d * 0.25, 7);
    pbox(p, 'glass', 0, 3.7, d * 0.265 + 0.04, w * 0.58, 4.7, 0.08);
    pbox(p, 'white', 0, 7.1, d * 0.14, w * 0.68, 0.7, d * 0.3);
    pbox(p, 'white', -w * 0.39, 5.8, d * 0.08, w * 0.1, 11.6, d * 0.12); collider(p, -w * 0.39, d * 0.08, w * 0.1, d * 0.12, 15);
    pbox(p, 'blueGlass', -w * 0.39, 12.6, d * 0.08, w * 0.15, 2.3, d * 0.17);
    psign(p, 0, 8.2, d * 0.3, w * 0.75, 3.2);
  }
  function hotel(p) {
    if (!/tulsi/i.test(p.name)) { ordinary(p, { color: 'cream', glass: true }); return; }
    const { w, d, h } = p;
    pbox(p, 'cream', 0, h / 2, 0, w, h, d); collider(p); rooftop(p);
    pbox(p, 'blueGlass', 0, h * 0.52, d / 2 + 0.05, w * 0.92, h * 0.86, 0.1);
    for (let n = 0; n < 5; n++) pbox(p, 'trunk', -w * 0.39 + n * w * 0.05, h * 0.55, d / 2 + 0.23, 0.15, h * 0.86, 0.3);
    for (let n = -4; n <= 4; n++) pbox(p, 'white', n * w * 0.1, h * 0.47, d / 2 + 0.32, 0.1, h * 0.14, 0.1);
    for (const y of [h * 0.4, h * 0.54]) pbox(p, 'white', 0, y, d / 2 + 0.32, w, 0.12, 0.1);
    pbox(p, 'trunk', 0, 3.2, d / 2 + 0.24, w, 2.2, 0.35); psign(p, 0, 3.3, d / 2 + 0.44, w * 0.94, 2.1);
  }
  function startingHome(p) {
    // Original interpretation of the supplied architectural photograph. The
    // public junction places the scene; this is not a surveyed private address.
    const { w, d } = p, h = Math.max(4.5, Math.min(5.5, p.h * 0.7));
    const bodyW = w * 0.88, bodyD = d * 0.66, bodyZ = -d * 0.17, front = bodyZ + bodyD / 2;
    pbox(p, 'sidewalk', 0, 0.1, 0, w, 0.2, d);
    pbox(p, 'houseBlue', 0, h / 2 + 0.18, bodyZ, bodyW, h, bodyD); collider(p, 0, bodyZ, bodyW, bodyD, h + 1.8);
    pbox(p, 'housePale', 0, h + 0.26, bodyZ + 0.16, w * 0.95, 0.28, bodyD + 0.62);
    pbox(p, 'houseBlue', 0, h + 0.75, front + 0.34, w * 0.95, 0.9, 0.38);
    // Raised parapet ends, yellow circular and rectangular insets, open black rails.
    pbox(p, 'housePale', -w * 0.43, h + 1.26, front + 0.34, w * 0.12, 1.5, 0.42);
    pbox(p, 'housePale', w * 0.39, h + 1.49, front + 0.34, w * 0.19, 2, 0.42);
    pshape(p, 'sphere', 'houseYellow', -w * 0.43, h + 1.55, front + 0.58, 0.32, 0.36, 0.06);
    pbox(p, 'houseYellow', w * 0.39, h + 1.63, front + 0.59, w * 0.085, 0.77, 0.06);
    for (const y of [h + 1.13, h + 1.55, h + 1.97]) pbox(p, 'dark', -w * 0.015, y, front + 0.33, w * 0.71, 0.07, 0.08);
    pbox(p, 'housePale', -w * 0.045, h + 1.55, front + 0.33, w * 0.09, 1.65, 0.4);
    for (const x of [-0.29, -0.255, -0.22, 0.08, 0.13, 0.18]) pbox(p, 'houseYellow', x * w, h + 0.73, front + 0.56, x < 0 ? 0.11 : 0.28, 0.47, 0.05);
    // Two barred windows and an inset wooden door beneath a deep flat canopy.
    for (const x of [-w * 0.26, w * 0.29]) {
      pbox(p, 'dark', x, 2.1, front + 0.045, w * 0.19, 1.6, 0.08);
      for (let bar = -3; bar <= 3; bar++) pbox(p, 'metal', x + bar * w * 0.026, 2.1, front + 0.11, 0.045, 1.6, 0.04);
      for (let bar = -2; bar <= 2; bar++) pbox(p, 'metal', x, 2.1 + bar * 0.3, front + 0.13, w * 0.19, 0.04, 0.04);
      pbox(p, 'dark', x, h - 0.63, front + 0.06, w * 0.16, 0.38, 0.08);
    }
    pbox(p, 'houseYellow', -w * 0.26, 3.08, front + 0.34, w * 0.22, 0.09, 0.65);
    pbox(p, 'dark', w * 0.045, 1.76, front + 0.06, w * 0.18, 3.1, 0.1);
    pbox(p, 'trunk', w * 0.045, 1.7, front + 0.12, w * 0.125, 2.72, 0.06);
    pbox(p, 'houseBlue', 0, h - 0.18, front + 0.52, w * 0.95, 0.4, 1.45);
    // Low boundary wall and black/white horizontal gate, wholly inside the lot.
    const fence = d * 0.45, gateX = w * 0.115, gateW = w * 0.6;
    pbox(p, 'houseBlue', -w * 0.355, 1.1, fence, w * 0.27, 2.2, 0.35); collider(p, -w * 0.355, fence, w * 0.27, 0.35, 2.2);
    pbox(p, 'housePale', w * 0.465, 1.1, fence, w * 0.07, 2.2, 0.35); collider(p, w * 0.465, fence, w * 0.07, 0.35, 2.2);
    pbox(p, 'dark', gateX, 1.04, fence, gateW, 1.98, 0.16); collider(p, gateX, fence, gateW, 0.2, 2.1);
    for (let slat = 0; slat < 10; slat++) pbox(p, 'gateWhite', gateX, 0.16 + slat * 0.2, fence + 0.12, gateW - 0.08, 0.105, 0.06);
    for (const x of [gateX - gateW / 2, gateX, gateX + gateW / 2]) pbox(p, 'gateWhite', x, 1.06, fence + 0.14, 0.09, 2.1, 0.08);
    for (const x of [-w * 0.255, -w * 0.225]) pbox(p, 'houseYellow', x, 1.1, fence + 0.2, 0.1, 2.17, 0.06);
    for (const x of [-w * 0.445, -w * 0.3]) pbox(p, 'houseYellow', x, 1.1, fence + 0.2, 0.13, 1.4, 0.06);
    for (const y of [0.4, 1.8]) pbox(p, 'houseYellow', -w * 0.372, y, fence + 0.2, w * 0.156, 0.13, 0.06);
    pshape(p, 'sphere', 'houseYellow', w * 0.465, 1.17, fence + 0.21, 0.35, 0.35, 0.055);
    // The scene labels explicitly describe the game setting, not the residence.
    const lane = local(p, 0, front + 0.64);
    labels.startingLane(lane.x, h + 2.55, lane.z, Math.min(w * 0.8, 10), 1.9, p.rotation);
    const signX = -w * 0.28;
    pbox(p, 'metal', signX, 3, fence - 0.4, 0.09, 6, 0.1);
    psign(p, signX, 5.3, fence - 0.28, Math.min(w * 0.48, 6.3), 1.8);
  }

  for (const input of PLACES) {
    const p = { ...input, w: input.w || 16, d: input.d || 12, h: input.h || 12, rotation: input.rotation || 0 };
    const name = `${p.id} ${p.name}`.toLowerCase(), category = p.category;
    if (p.id === 'zenda-chowk') startingHome(p);
    else if (p.id === 'hazur-sahib') hazurSahib(p);
    else if (p.id === 'mal-tekdi') malTekdi(p);
    else if (p.id === 'kaleshwar-temple') kaleshwar(p);
    else if (p.id === 'vishnupuri-dam') vishnupuriDam(p);
    else if (['godavari-river', 'urvashi-ghat', 'ram-ghat', 'govardhan-ghat'].includes(p.id)) riverGhat(p);
    else if (p.id === 'old-mondha-clock-tower') clockTower(p);
    else if (/bhagya.*kaman/.test(name)) kaman(p);
    else if (/nandgiri|nandagiri|nanded fort/.test(name)) fort(p);
    else if (/airport/.test(name)) airport(p);
    else if (p.id === 'sggs-stadium') park(p, true);
    else if (category === 'park') park(p);
    else if (/hazur.sahib/.test(name) && !/station|rail|yatri|niwas|blood|hospital|iti/.test(name)) shrine(p, true);
    else if (/gurudwara|gurdwara|ghat sahib|langar sahib|mal tekdi|sangat sahib|mata sahib/.test(name)) shrine(p);
    else if (/kaleshwar|temple|mandir/.test(name)) shrine(p, false, true);
    else if (/godavari.river|vishnupuri.dam|bridge|overbridge|ghat-bridge/.test(name)) square(p);
    else if (category === 'junction') square(p);
    else if (/bus stand|bus station|msrtc/.test(name)) station(p, true);
    else if (/railway station|nanded-station/.test(name)) station(p);
    else if (category === 'coaching') coaching(p);
    else if (['college', 'education', 'school'].includes(category) || /college|university|mahavidyalaya|polytechnic|vidyalaya|institute of|government iti/.test(name)) campus(p);
    else if (category === 'hotel') hotel(p);
    else if (category === 'hospital') {
      ordinary(p, { color: 'white', glass: true });
      pbox(p, 'green', -p.w * 0.33, p.h + 1.6, p.d / 2 + 0.12, 0.6, 2.4, 0.15);
      pbox(p, 'green', -p.w * 0.33, p.h + 1.6, p.d / 2 + 0.14, 2.4, 0.6, 0.15);
    } else if (['restaurant', 'food', 'cafe', 'market', 'shop'].includes(category)) ordinary(p, { color: choose(['cream', 'ochre', 'coral']), awning: choose(['awning', 'blue', 'green']) });
    else ordinary(p, { color: category === 'civic' ? 'cream' : undefined });
  }

  // Fillers are explicitly fictional street texture; every lot is clearance-tested
  // against ALL nearby mapped roads, researched place footprints and approach points.
  const placeCells = new Set();
  for (const p of PLACES) cells(p.x - 100, p.z - 100, p.x + 100, p.z + 100, key => placeCells.add(key));
  const coachingPlaces = PLACES.filter(p => p.category === 'coaching');
  const coachingCenter = coachingPlaces.length ? {
    x: coachingPlaces.reduce((n, p) => n + p.x, 0) / coachingPlaces.length,
    z: coachingPlaces.reduce((n, p) => n + p.z, 0) / coachingPlaces.length,
  } : SPAWN;
  const oldCity = PLACES.find(p => p.id === 'hazur-sahib') || SPAWN;
  const midpoint = e => ({ x: (e.aPoint.x + e.bPoint.x) / 2, z: (e.aPoint.z + e.bPoint.z) / 2 });
  const distanceTo = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const candidates = edges.filter(e => {
    if (Math.hypot(e.bPoint.x - e.aPoint.x, e.bPoint.z - e.aPoint.z) < 3) return false;
    const m = midpoint(e);
    return distanceTo(m, coachingCenter) < 1200 || distanceTo(m, oldCity) < 900 || placeCells.has(`${Math.floor(m.x / CELL)}:${Math.floor(m.z / CELL)}`);
  });
  const priorityCandidates = candidates.filter(e => distanceTo(midpoint(e), SPAWN) < 520 || distanceTo(midpoint(e), coachingCenter) < 520);
  const coreCandidates = candidates.filter(e => distanceTo(midpoint(e), coachingCenter) < 1200 || distanceTo(midpoint(e), oldCity) < 900);
  let fillerCount = 0, decorationCount = 0;
  let priorityFillers = 0, coreFillers = 0;
  for (let attempt = 0; attempt < 240000 && fillerCount < 6500; attempt++) {
    const weight = random();
    const pool = weight < (attempt < 100000 ? 0.68 : 0.35) && priorityCandidates.length ? priorityCandidates : weight < 0.9 && coreCandidates.length ? coreCandidates : candidates;
    const e = pool[Math.floor(random() * pool.length)]; if (!e) break;
    const dx = e.bPoint.x - e.aPoint.x, dz = e.bPoint.z - e.aPoint.z, len = Math.hypot(dx, dz);
    const side = random() < 0.5 ? -1 : 1, t = between(0.03, 0.97), w = between(3.2, 7.8), d = between(4, 8.8);
    const radius = Math.hypot(w, d) / 2;
    // Back rows fill the interiors of wider mapped blocks rather than leaving
    // a single ribbon of isolated shops around a bare centre.
    const backRow = random() > 0.67 ? between(7, 22) : 0;
    const offset = (e.width || 6) / 2 + radius + between(0.8, 1.8) + backRow;
    const x = e.aPoint.x + dx * t + dz / len * offset * side, z = e.aPoint.z + dz * t - dx / len * offset * side;
    if (x < BOUNDS.minX + 15 || x > BOUNDS.maxX - 15 || z < BOUNDS.minZ + 15 || z > BOUNDS.maxZ - 15 || !roadClear(x, z, radius) || !dryLand(x, z, radius)) continue;
    const p = { x, z, w, d, h: between(5, 12.5) + (random() > 0.9 ? 2 : 0), rotation: Math.atan2(-dz / len * side, dx / len * side) };
    if (!housingLotClear(p, radius)) continue;
    // Warm paved courtyards join the street-facing homes into occupied blocks.
    pbox(p, choose(['sidewalk', 'roof', 'cream']), 0, 0.11, 0, w + 0.35, 0.16, d + 0.35);
    ordinary(p, { filler: true, sign: fillerCount % 8, awning: backRow === 0 && fillerCount % 3 === 0 ? choose(['awning', 'green', 'blue']) : undefined });
    occupy(x, z, radius, { w, d, rotation: p.rotation }); fillerCount++;
    if (distanceTo(p, SPAWN) < 520 || distanceTo(p, coachingCenter) < 520) priorityFillers++;
    if (distanceTo(p, coachingCenter) < 1200 || distanceTo(p, oldCity) < 900) coreFillers++;
    if (fillerCount % 12 === 0) {
      const tx = x + dx / len * (w / 2 + 3), tz = z + dz / len * (w / 2 + 3);
      if (roadClear(tx, tz, 1) && lotClear(tx, tz, 2.4) && dryLand(tx, tz, 2)) { tree(tx, tz, fillerCount % 12 === 0, between(0.6, 0.9)); occupy(tx, tz, 2); decorationCount++; }
    }
  }
  // Lamps use a narrow collision-free verge and occur only near the populated city.
  for (let i = 0; i < candidates.length && decorationCount < 600; i += 9) {
    const e = candidates[i], dx = e.bPoint.x - e.aPoint.x, dz = e.bPoint.z - e.aPoint.z, len = Math.hypot(dx, dz);
    if (len < 7) continue;
    const offset = (e.width || 6) / 2 + 1.8, x = (e.aPoint.x + e.bPoint.x) / 2 + dz / len * offset, z = (e.aPoint.z + e.bPoint.z) / 2 - dx / len * offset;
    if (roadClear(x, z, 0.25) && lotClear(x, z, 0.3) && dryLand(x, z, 1)) { lamp(x, z, Math.atan2(-dz, dx)); decorationCount++; }
  }
  const startingPlace = PLACES.find(p => p.id === 'zenda-chowk');
  let startingLaneTrees = 0;
  if (startingPlace) {
    const localEdges = edges.filter(e => distanceTo(midpoint(e), startingPlace) < 170);
    for (let attempt = 0; attempt < 1800 && startingLaneTrees < 52 && localEdges.length; attempt++) {
      const e = localEdges[Math.floor(random() * localEdges.length)], a = e.aPoint, b = e.bPoint;
      const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz); if (len < 1) continue;
      const t = random(), side = random() < 0.5 ? -1 : 1, offset = e.width / 2 + between(4.5, 13);
      const x = a.x + dx * t + dz / len * offset * side, z = a.z + dz * t - dx / len * offset * side;
      if (!roadClear(x, z, 3) || !lotClear(x, z, 2.6) || !dryLand(x, z, 3)) continue;
      cylinder('grass', x, 0.13, z, 3, 0.15); tree(x, z, false, between(0.7, 1.15)); occupy(x, z, 2.6); startingLaneTrees++;
    }
  }

  // Small spatial batches keep the full-city dataset from defeating frustum culling.
  const chunkMeshes = [];
  let instanceCount = 0;
  for (const b of batches.values()) {
    const mesh = new THREE.InstancedMesh(geometries[b.geometry], materials[b.material], b.matrices.length);
    b.matrices.forEach((matrix, i) => { mesh.setMatrixAt(i, matrix); mesh.setColorAt(i, b.colors[i]); }); mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = b.material !== 'surface' && b.material !== 'water'; mesh.receiveShadow = true; mesh.computeBoundingBox(); mesh.computeBoundingSphere();
    mesh.name = `City ${b.material} ${b.geometry}`; group.add(mesh); chunkMeshes.push(mesh);
    instanceCount += b.matrices.length;
  }
  const labelStats = labels.finish();
  const cameraColliders = [...colliders, ...cameraStructures, ...labelStats.cameraOccluders];
  chunkMeshes.push(...labelStats.meshes);
  let lastFocus = { x: Infinity, z: Infinity }, lastCull = 0;
  function setFocus(focus) {
    if (!focus || !Number.isFinite(focus.x) || !Number.isFinite(focus.z)) return;
    const now = Date.now();
    if (Math.hypot(focus.x - lastFocus.x, focus.z - lastFocus.z) < 40 && now - lastCull < 500) return;
    lastFocus = { x: focus.x, z: focus.z }; lastCull = now;
    for (const mesh of chunkMeshes) {
      const sphere = mesh.boundingSphere || mesh.geometry.boundingSphere;
      const distance = Math.hypot(sphere.center.x - focus.x, sphere.center.z - focus.z);
      mesh.visible = distance < 850 + sphere.radius;
    }
  }
  setFocus(SPAWN);
  group.userData = { architecture: 'Illustrative original models; mapped streets and researched place names', fillerCount, priorityFillers, coreFillers, startingLaneTrees, signCount: labelStats.signCount, atlasCount: 1, batchCount: batches.size };
  return {
    group, colliders, cameraColliders, landmarks: PLACES, roads: NETWORK, bounds: BOUNDS,
    setFocus,
    getStats() { return { batches: chunkMeshes.length, visibleBatches: chunkMeshes.filter(mesh => mesh.visible).length, instances: instanceCount, fillers: fillerCount, priorityFillers, coreFillers, startingLaneTrees, placeCount: PLACES.length, signs: labelStats.signCount, atlases: 1 }; },
    animate(_dt, elapsed) { materials.water.roughness = 0.27 + Math.sin(elapsed * 0.2) * 0.035; },
  };
}
