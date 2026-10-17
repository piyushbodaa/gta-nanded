import * as THREE from 'three';
import { NETWORK, PLACES, BOUNDS, SPAWN, BUILDINGS } from './city-data.js';
import { createCityLabels } from './world-labels.js';

export const WORLD = Object.freeze({ bounds: BOUNDS });
// 260-unit chunks: fewer, fuller instanced batches. Draw calls, not vertex
// count, were the bottleneck — this draws ~40% fewer batches than 200 did.
const CHUNK = 260;

/** Mapped streets and researched places, with original illustrative architecture. */
export function createWorld(scene, { viewDistance: viewDistanceOption = 850 } = {}) {
  let viewDistance = viewDistanceOption;
  const group = new THREE.Group(); group.name = 'Nanded mapped city'; scene.add(group);
  const colliders = [], cameraStructures = [], batches = new Map(), dummy = new THREE.Object3D();
  let bridgeEdges = 0, farmPlots = 0, ridgeCount = 0;
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
    // Deccan additions: regur black cotton soil, standing crops, basalt, tin
    // and Mangalore-tile roofs, mosque green, gulmohar flame, dry winter grass.
    blackSoil: '#4a3a2e', cropGreen: '#7d9b4e', cropGold: '#c2a24a', cropCotton: '#8a9a5b',
    basalt: '#6e6258', tinRoof: '#8fa3a8', tileRoof: '#a85f42', mosqueGreen: '#3e7d5e',
    gulmohar: '#c65a35', dryGrass: '#b3a06b',
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
  const surfaces = new Set(['sand', 'sidewalk', 'asphalt', 'lane', 'roadEdge', 'grass', 'track', 'blackSoil', 'cropGreen', 'cropGold', 'cropCotton', 'dryGrass']);
  const geometries = {
    box: new THREE.BoxGeometry(1, 1, 1), cylinder: new THREE.CylinderGeometry(1, 1, 1, 8),
    cone: new THREE.ConeGeometry(1, 1, 8), sphere: new THREE.SphereGeometry(1, 8, 6),
    dome: new THREE.SphereGeometry(1, 12, 7, 0, Math.PI * 2, 0, Math.PI / 2),
    arch: new THREE.TorusGeometry(1, 0.12, 4, 16, Math.PI),
    // Road junction patches only ever show their top: 10 triangles instead of a 40-triangle cylinder.
    disc: new THREE.CircleGeometry(1, 10).rotateX(-Math.PI / 2),
  };
  const labels = createCityLabels(PLACES, group, CHUNK);
  function shape(geometry, material, x, y, z, sx, sy, sz, rotation = 0, tilt = 0) {
    if (![x, y, z, sx, sy, sz].every(Number.isFinite) || sx <= 0 || sy <= 0 || sz <= 0) return;
    const style = surfaces.has(material) ? 'surface' : ['glass', 'blueGlass'].includes(material) ? 'glass' : ['water', 'gold'].includes(material) ? material : 'solid';
    const key = `${Math.floor(x / CHUNK)}:${Math.floor(z / CHUNK)}:${geometry}:${style}`;
    if (!batches.has(key)) batches.set(key, { geometry, material: style, matrices: [], colors: [] });
    dummy.position.set(x, y, z); dummy.scale.set(sx, sy, sz); dummy.rotation.set(tilt, rotation, 0); dummy.updateMatrix();
    // Flat element arrays instead of 200k Matrix4 objects the GC must trace.
    batches.get(key).matrices.push(dummy.matrix.elements.slice()); batches.get(key).colors.push(colors[material]);
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
  NETWORK.nodes.forEach((p, i) => { if (nodeWidths[i]) shape('disc', 'asphalt', p.x, 0.17, p.z, nodeWidths[i] / 2, 1, nodeWidths[i] / 2); });

  // Bridges: any mapped road segment that actually crosses the Godavari or
  // the Asna gets a stone deck edge, railings and piers, so river crossings
  // read as bridges instead of tarmac floating on the water. Visual only —
  // the drivable road underneath is unchanged and gains no new colliders.
  // River segments are bucketed first, so this is not a 26k × 240 scan.
  const riverGrid = new Map(), RCELL = 96;
  for (const r of riverSegments) {
    const pad = r.width / 2 + 10;
    for (let ix = Math.floor((Math.min(r.a.x, r.b.x) - pad) / RCELL); ix <= Math.floor((Math.max(r.a.x, r.b.x) + pad) / RCELL); ix++)
      for (let iz = Math.floor((Math.min(r.a.z, r.b.z) - pad) / RCELL); iz <= Math.floor((Math.max(r.a.z, r.b.z) + pad) / RCELL); iz++) {
        const key = `${ix}:${iz}`; if (!riverGrid.has(key)) riverGrid.set(key, []); riverGrid.get(key).push(r);
      }
  }
  for (const e of edges) {
    const a = e.aPoint, b = e.bPoint, w = e.width || 6;
    const near = riverGrid.get(`${Math.floor((a.x + b.x) / 2 / RCELL)}:${Math.floor((a.z + b.z) / 2 / RCELL)}`) || [];
    const overRiver = near.some(r => [0.2, 0.5, 0.8].some(t =>
      distanceSegment(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, r.a, r.b) < r.width / 2));
    if (!overRiver) continue;
    bridgeEdges++;
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
    const nx = dz / len, nz = -dx / len, yaw = Math.atan2(dx, dz);
    strip('stone', a, b, w + 2.2, 0.16, 0.22);
    for (const side of [-1, 1]) {
      const off = side * (w / 2 + 0.9);
      strip('cream', { x: a.x + nx * off, z: a.z + nz * off }, { x: b.x + nx * off, z: b.z + nz * off }, 0.22, 1.05, 0.18);
      strip('cream', { x: a.x + nx * off, z: a.z + nz * off }, { x: b.x + nx * off, z: b.z + nz * off }, 0.3, 0.55, 0.5);
    }
    for (let s = 4; s < len - 2; s += 9) {
      const x = a.x + dx * s / len, z = a.z + dz * s / len;
      for (const side of [-1, 1]) box('stone', x + nx * side * (w / 2 + 0.9), 0.75, z + nz * side * (w / 2 + 0.9), 0.28, 1.1, 0.28, yaw);
    }
    if (len > 14) for (const t of [0.3, 0.55, 0.8]) cylinder('basalt', a.x + dx * t, 0.1, a.z + dz * t, Math.min(1.6, w * 0.16), 1.1);
  }

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

  // Deccan trees, not generic park trees: shady neem by default, flat-topped
  // babool on dry outskirts, flame gulmohar along avenues, broad banyans at
  // chowks, and palms kept rare (they belong to campuses, not Marathwada lanes).
  function tree(x, z, palm = false, scale = 1, kind = palm ? 'palm' : 'neem') {
    if (kind === 'palm') {
      const h = 9 * scale;
      cylinder('trunk', x, h / 2, z, 0.3 * scale, h);
      shape('sphere', 'leaf', x, h + 0.3, z, 1.1 * scale, 1.3 * scale, 1.1 * scale);
      for (let i = 0; i < 5; i++) { const a = i * Math.PI * 0.4; shape('sphere', i % 2 ? 'leaf' : 'leafLight', x + Math.sin(a) * 1.5 * scale, h + 0.6, z + Math.cos(a) * 1.5 * scale, 0.7 * scale, 0.35 * scale, 2.8 * scale, a); }
    } else if (kind === 'babool') {
      const h = 4.4 * scale;
      cylinder('trunk', x, h / 2, z, 0.26 * scale, h);
      shape('sphere', 'leaf', x, h + 0.5 * scale, z, 4.4 * scale, 0.9 * scale, 4.4 * scale);
      shape('sphere', 'leafLight', x + scale, h + 0.9 * scale, z - 0.5 * scale, 3 * scale, 0.6 * scale, 3 * scale);
    } else if (kind === 'gulmohar') {
      const h = 5.2 * scale;
      cylinder('trunk', x, h / 2, z, 0.32 * scale, h);
      shape('sphere', 'leaf', x, h + 0.4 * scale, z, 4 * scale, 1.6 * scale, 4 * scale);
      shape('sphere', 'gulmohar', x - 0.8 * scale, h + 1.2 * scale, z + 0.4 * scale, 3.2 * scale, 1.1 * scale, 3.2 * scale);
      shape('sphere', 'gulmohar', x + 1.2 * scale, h + 0.9 * scale, z - scale, 2.2 * scale, 0.8 * scale, 2.2 * scale);
    } else if (kind === 'banyan') {
      const h = 6 * scale;
      cylinder('trunk', x, h / 2, z, 0.85 * scale, h);
      shape('sphere', 'leaf', x, h + 1.2 * scale, z, 5.6 * scale, 3 * scale, 5.6 * scale);
      shape('sphere', 'leafLight', x - 1.6 * scale, h + 2.4 * scale, z + scale, 3.6 * scale, 2 * scale, 3.6 * scale);
      for (const [rx, rz] of [[-3.4, 1.2], [3, -1.8], [1.4, 3.2]]) cylinder('trunk', x + rx * scale, h * 0.42, z + rz * scale, 0.13 * scale, h * 0.85);
    } else {
      const h = 5.6 * scale;
      cylinder('trunk', x, h / 2, z, 0.3 * scale, h);
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
  function rooftop(p, w = p.w, d = p.d, h = p.h, roofMat = 'roof') {
    pbox(p, roofMat, 0, h + 0.15, 0, w + 0.2, 0.3, d + 0.2);
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
    rooftop(p, w, d, h, opts.roofMat);
    // Rooftop clutter you see from any Nanded terrace: a dish, a solar
    // heater panel, and once in a while a small saffron flag.
    if (opts.filler && w > 4.5) {
      if (random() < 0.3) pshape(p, 'sphere', 'gateWhite', -w * 0.3, h + 0.75, d * 0.25, 0.55, 0.28, 0.55);
      if (random() < 0.18) pbox(p, 'blueGlass', w * 0.18, h + 0.55, -d * 0.28, 1.7, 0.12, 1.1);
      if (random() < 0.06) { const q = local(p, w * 0.38, d * 0.38); cylinder('trunk', q.x, h + 1.6, q.z, 0.045, 3); pbox(p, 'saffron', w * 0.38 + 0.45, h + 2.7, d * 0.38, 0.9, 0.55, 0.04); }
    }
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
      // Every brand gets its own frontage colours, as on the real lanes:
      // ALLEN green, Aakash blue, PW navy, Chate maroon, Shaheen green…
      const brandBand = { 'aakash-nanded': 'blue', 'pw-nanded': 'dark', 'shaheen-academy': 'green', 'great-achievers': 'saffron', 'brilliant-commerce': 'blue' }[p.id]
        || (/chate/i.test(p.name) ? 'burgundy' : allen ? 'green' : konale ? 'red' : 'blue');
      windows(p); pbox(p, brandBand, 0, h - 1.1, fz + 0.06, w, 2.3, 0.15);
      if (p.id === 'pw-nanded') pbox(p, 'saffron', 0, h - 2.35, fz + 0.08, w, 0.28, 0.12);
      if (p.id === 'aakash-nanded') for (let floor = 0; floor < 2; floor++) pbox(p, 'blueGlass', 0, 4.4 + floor * 3.4, fz + 0.04, w * 0.84, 1.7, 0.08);
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
    // The Sachkhand complex around the Takht: a white boundary wall with
    // domed bastions, the Darshani Deori entrance gate, a Langar hall on
    // one side and sarai rooms on the other, all in white marble tones.
    for (const side of [-1, 1]) {
      pbox(p, 'white', side * w * 0.485, 1.5, 0, 0.5, 3, d * 0.94); collider(p, side * w * 0.485, 0, 0.5, d * 0.94, 3);
      for (const end of [-1, 1]) shrineKiosk(p, side * w * 0.485, end * d * 0.46, 2.6, 0.85);
      pbox(p, 'white', side * (w * 0.25 + 1.9), 1.5, d * 0.47, w * 0.5 - 3.4, 3, 0.5); collider(p, side * (w * 0.25 + 1.9), d * 0.47, w * 0.5 - 3.4, 0.5, 3);
      pbox(p, 'white', side * (w * 0.25 + 1.9), 1.5, -d * 0.47, w * 0.5 - 3.4, 3, 0.5); collider(p, side * (w * 0.25 + 1.9), -d * 0.47, w * 0.5 - 3.4, 0.5, 3);
    }
    for (const side of [-1, 1]) {
      pbox(p, 'white', side * 3.4, 2.6, d * 0.47, 1.1, 5.2, 1.1); collider(p, side * 3.4, d * 0.47, 1.1, 1.1, 7);
      shrineKiosk(p, side * 3.4, d * 0.47, 5, 0.9, true);
    }
    pbox(p, 'white', 0, 5.4, d * 0.47, 7.9, 0.5, 1.2);
    pshape(p, 'arch', 'gold', 0, 4.4, d * 0.47, 3.1, 2.6, 1.4);
    overhead(p, 0, d * 0.47, 7.9, 1.2, 4.2, 7.5);
    // Langar hall (long arched block) and sarai rooms flanking the court.
    pbox(p, 'white', -w * 0.38, 2.6, d * 0.18, w * 0.16, 5.2, d * 0.4); collider(p, -w * 0.38, d * 0.18, w * 0.16, d * 0.4, 5.2);
    for (let n = -2; n <= 2; n++) pbox(p, 'window', -w * 0.38 + w * 0.085, 2.4, d * 0.18 + n * d * 0.075, 0.08, 2.6, d * 0.05);
    pbox(p, 'gold', -w * 0.38, 5.35, d * 0.18, w * 0.18, 0.3, d * 0.42);
    pbox(p, 'cream', w * 0.38, 3.4, d * 0.16, w * 0.16, 6.8, d * 0.44); collider(p, w * 0.38, d * 0.16, w * 0.16, d * 0.44, 6.8);
    for (let floor = 0; floor < 2; floor++) for (let n = -2; n <= 2; n++) pbox(p, 'window', w * 0.38 - w * 0.085, 2 + floor * 2.8, d * 0.16 + n * d * 0.08, 0.08, 1.5, d * 0.05);
    psign(p, -w * 0.25, 1.4, d * 0.46, w * 0.46, 1.2);
  }
  function malTekdi(p) {
    // Central dome, flanking open kiosks and an arched entrance are visible in
    // the shrine board's photograph: https://hazursahib.com/web/mal_tekdi_sahib
    const { w, d } = p, bw = w * 0.86, bd = d * 0.61, z = -d * 0.13, h = 7.3, front = z + bd / 2;
    // It is a tekdi — a hill. Stepped basalt terraces lift the shrine off the plain.
    pshape(p, 'cylinder', 'basalt', 0, 0.35, z, Math.min(w, d) * 0.62, 0.7, Math.min(w, d) * 0.62);
    pshape(p, 'cylinder', 'dryGrass', 0, 0.75, z, Math.min(w, d) * 0.5, 0.5, Math.min(w, d) * 0.5);
    for (const [bx, bz, bs] of [[-0.42, 0.3, 1.6], [0.44, 0.18, 2.1], [0.3, -0.42, 1.3], [-0.35, -0.38, 1.1]])
      pshape(p, 'sphere', 'basalt', bx * w, 0.4, bz * d, bs, bs * 0.55, bs);
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
  // A mohalla masjid: white prayer hall, green dome and a pair of minarets.
  // Nanded's old city and Degloor Naka side are full of them; the skyline
  // was missing half its silhouettes without minarets. Fictional filler.
  function mosque(p) {
    const { w, d } = p, h = Math.max(5.5, Math.min(8, p.h)), bw = w * 0.8, bd = d * 0.66, bz = -d * 0.08;
    pbox(p, 'sidewalk', 0, 0.1, 0, w, 0.2, d);
    pbox(p, 'white', 0, h / 2, bz, bw, h, bd); collider(p, 0, bz, bw, bd, h + 4);
    pbox(p, 'mosqueGreen', 0, h + 0.2, bz, bw + 0.35, 0.4, bd + 0.35);
    const front = bz + bd / 2 + 0.05;
    for (let n = -2; n <= 2; n++) {
      pbox(p, 'window', n * bw * 0.18, 2.5, front, bw * 0.1, 3.4, 0.09);
      pshape(p, 'dome', 'window', n * bw * 0.18, 4.2, front, bw * 0.05, 0.9, 0.08);
    }
    const r = Math.min(bw, bd) * 0.24;
    pshape(p, 'cylinder', 'white', 0, h + 0.9, bz, r * 0.85, 1.1, r * 0.85);
    pshape(p, 'dome', 'mosqueGreen', 0, h + 1.4, bz, r, r * 1.15, r);
    pshape(p, 'cone', 'gold', 0, h + 1.9 + r, bz, 0.16, 1.1, 0.16);
    for (const side of [-1, 1]) {
      const mx = side * (w / 2 - 0.7), mz = d * 0.3, mh = h + 6.5;
      pshape(p, 'cylinder', 'white', mx, mh / 2, mz, 0.5, mh, 0.5);
      pshape(p, 'cylinder', 'mosqueGreen', mx, mh * 0.72, mz, 0.78, 0.3, 0.78);
      pshape(p, 'dome', 'mosqueGreen', mx, mh + 0.1, mz, 0.62, 0.85, 0.62);
      pshape(p, 'cone', 'gold', mx, mh + 1.15, mz, 0.12, 0.8, 0.12);
      collider(p, mx, mz, 1.1, 1.1, mh);
    }
  }
  // A named river bridge as an actual bridge: deck, railings, piers, lamps.
  // Visual only, like the square it replaces — the road across stays open.
  function bridgePlace(p) {
    const { w, d } = p;
    pbox(p, 'water', 0, 0.05, -d * 0.08, w, 0.09, d * 0.7);
    pbox(p, 'asphalt', 0, 0.32, 0, w, 0.28, Math.min(d * 0.42, 11));
    pbox(p, 'stone', 0, 0.14, 0, w, 0.2, Math.min(d * 0.42, 11) + 1.4);
    for (const side of [-1, 1]) {
      const rz = side * (Math.min(d * 0.42, 11) / 2 + 0.5);
      pbox(p, 'cream', 0, 1.15, rz, w, 0.16, 0.22);
      pbox(p, 'cream', 0, 0.55, rz, w, 0.45, 0.3);
      for (let n = -4; n <= 4; n++) pbox(p, 'stone', n * w * 0.11, 0.8, rz, 0.26, 1, 0.26);
      const q = local(p, side * w * 0.3, rz); lamp(q.x, q.z, p.rotation);
    }
    for (const x of [-w * 0.28, 0, w * 0.28]) pshape(p, 'cylinder', 'basalt', x, 0.1, 0, 1.3, 1.2, 1.3);
    for (let n = 0; n < 6; n++) pbox(p, 'lane', (n - 2.5) * w * 0.15, 0.48, 0, w * 0.07, 0.02, 0.2);
    psign(p, -w * 0.24, 1.7, d * 0.46, w * 0.48, 1.3);
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
    // An original illustrative home. The public junction places the scene;
    // it is not a surveyed private address.
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

  // --- Detailed named places -------------------------------------------------
  // Bespoke models for the landmarks people navigate by. Footprints stay the
  // researched ones; the detail is illustrative, from public references.
  let detailShops = 0;
  function miniBus(p, x, z, yaw = 0, color = 'red') {
    const q = { ...p, ...local(p, x, z), rotation: (p.rotation || 0) + yaw };
    pbox(q, color, 0, 1.55, 0, 2.3, 2.5, 8.2);
    pbox(q, 'awningWhite', 0, 2.9, 0, 2.36, 0.22, 7.9);
    pbox(q, 'window', 0, 2.05, 4.12, 2.1, 0.85, 0.08);
    for (const side of [-1, 1]) pbox(q, 'window', side * 1.16, 2.05, 0, 0.06, 0.8, 7);
    for (const wx of [-1, 1]) for (const wz of [-2.7, 2.5]) pshape(q, 'sphere', 'dark', wx * 1.1, 0.45, wz, 0.16, 0.45, 0.45);
    collider(q, 0, 0, 2.4, 8.3, 3);
  }
  function miniAuto(p, x, z, yaw = 0) {
    const q = { ...p, ...local(p, x, z), rotation: (p.rotation || 0) + yaw };
    pbox(q, 'dark', 0, 0.75, 0.15, 1.7, 0.65, 2.6);
    pbox(q, 'houseYellow', 0, 1, -1.05, 1.7, 0.6, 0.5);
    pbox(q, 'houseYellow', 0, 2.05, 0.2, 1.75, 0.16, 2.2);
    collider(q, 0, 0, 1.8, 2.8, 2.2);
  }
  function miniTempo(p, x, z, yaw = 0) {
    const spot = local(p, x, z);
    if (!roadClear(spot.x, spot.z, 2) || (p.approach && Math.hypot(spot.x - p.approach.x, spot.z - p.approach.z) < 8)) return;
    const q = { ...p, ...spot, rotation: (p.rotation || 0) + yaw };
    pbox(q, 'dark', 0, 0.85, -1.5, 1.8, 0.75, 1.1);
    pbox(q, 'houseYellow', 0, 2.05, -1.5, 1.85, 0.16, 1.15);
    pbox(q, 'ochre', 0, 1.5, 0.7, 2, 1.6, 3.2);
    pbox(q, 'cream', 0, 2.1, 0.7, 1.7, 0.55, 2.7);
    collider(q, 0, 0, 2.1, 5.4, 2.6); occupy(spot.x, spot.z, 3);
  }
  function directionBoardAt(p, boardIdx, lx, lz) {
    const board = local(p, lx, lz);
    if (!roadClear(board.x, board.z, 0.4)) return;
    for (const side of [-1, 1]) { const post = local(p, lx + side * 2.6, lz); cylinder('metal', post.x, 1.9, post.z, 0.09, 3.8); }
    labels.board(boardIdx, board.x, 3.6, board.z, 7.2, 2.1, p.rotation || 0);
    const back = local(p, lx, lz - 0.18);
    labels.board(boardIdx, back.x, 3.6, back.z, 7.2, 2.1, (p.rotation || 0) + Math.PI);
  }
  // A row of small shops with signs and awnings along the front of an anchor
  // place — the commercial grain of Mondha, Bhagyanagar and the coaching lanes.
  function shopRow(anchor, count = 5, signBase = 0) {
    let placed = 0;
    // Shops continue the anchor's own frontage to both sides, the way a
    // real commercial stretch grows — not across the road from it.
    for (let n = 0; n < count * 4 && placed < count; n++) {
      const side = n % 2 ? 1 : -1, slot = Math.floor(n / 2);
      const lx = side * ((anchor.w || 10) / 2 + 4.5 + slot * 5.4) + between(-0.6, 0.6), lz = between(-1, Math.max(0, (anchor.d || 10) / 2 - 1.5));
      const q = local(anchor, lx, lz), w = between(3.6, 5.6), d = between(3.6, 5), h = between(4.2, 6.8), radius = Math.hypot(w, d) / 2;
      if (q.x < BOUNDS.minX + 12 || q.x > BOUNDS.maxX - 12 || q.z < BOUNDS.minZ + 12 || q.z > BOUNDS.maxZ - 12) continue;
      if (anchor.approach && Math.hypot(q.x - anchor.approach.x, q.z - anchor.approach.z) < 9.5) continue;
      if (!roadClear(q.x, q.z, radius) || !dryLand(q.x, q.z, radius) || !lotClear(q.x, q.z, radius)) continue;
      const shop = { x: q.x, z: q.z, w, d, h, rotation: anchor.rotation || 0 };
      pbox(shop, choose(['cream', 'coral', 'ochre', 'mint', 'sky', 'terracotta']), 0, h / 2, 0, w, h, d);
      collider(shop);
      pbox(shop, 'roof', 0, h + 0.12, 0, w + 0.25, 0.24, d + 0.25);
      pbox(shop, 'dark', 0, 1.25, d / 2 + 0.05, w * 0.66, 2.5, 0.09);
      for (let s = 0; s < 4; s++) pbox(shop, s % 2 ? 'awningWhite' : choose(['awning', 'green', 'blue']), (s - 1.5) * w / 4, 2.75, d / 2 + 0.75, w / 4, 0.12, 1.6);
      const signPos = local(shop, 0, d / 2 + 0.1);
      labels.generic((signBase + placed) % 8, signPos.x, 3.4, signPos.z, w * 0.94, 1.1, shop.rotation);
      occupy(q.x, q.z, radius, { w, d, rotation: shop.rotation });
      placed++; detailShops++;
    }
    return placed;
  }
  // Market stalls with produce piles and grain sacks, Mondha-style.
  function marketStalls(anchor, count = 8) {
    let placed = 0;
    for (let n = 0; n < count * 3 && placed < count; n++) {
      // Forecourt rows in front, plus a back row: whichever ground is
      // actually clear of the road becomes the market yard.
      const group = Math.floor(n / 8) % 4;
      const lx = group < 2 ? -15 + (n % 8) * 3.8 + between(-0.5, 0.5) : (group === 2 ? -1 : 1) * ((anchor.w || 12) / 2 + 3.2);
      const lz = (group === 0 ? (anchor.d || 10) / 2 + 3.5 : group === 1 ? (anchor.d || 10) / 2 + 7 : -((anchor.d || 10) / 2) + (n % 8) * 2.6) + between(-0.6, 0.6);
      const q = local(anchor, lx, lz);
      if (anchor.approach && Math.hypot(q.x - anchor.approach.x, q.z - anchor.approach.z) < 8.5) continue;
      if (!roadClear(q.x, q.z, 0.9) || !dryLand(q.x, q.z, 2) || !lotClear(q.x, q.z, 1.3)) continue;
      const stall = { x: q.x, z: q.z, w: 3, d: 2.2, h: 2.4, rotation: (anchor.rotation || 0) + Math.PI };
      pbox(stall, 'trunk', 0, 0.85, 0, 2.9, 0.18, 1.9);
      for (const sx of [-1.3, 1.3]) pbox(stall, 'dark', sx, 1.2, 0.8, 0.09, 2.4, 0.09);
      pbox(stall, choose(['awning', 'saffron', 'green', 'blue']), 0, 2.45, 0.25, 3.3, 0.1, 2.5);
      for (let pile = -1; pile <= 1; pile++) pshape(stall, 'sphere', choose(['rose', 'leaf', 'ochre', 'cropGold']), pile * 0.85, 1.15, 0.1, 0.42, 0.3, 0.42);
      pshape(stall, 'cylinder', 'cream', -1.1, 0.5, -0.9, 0.42, 1, 0.42);
      pshape(stall, 'cylinder', 'awningWhite', -0.35, 0.5, -0.95, 0.42, 1, 0.42);
      collider(stall, 0, 0, 3, 2.2, 2.4);
      occupy(q.x, q.z, 1.9);
      placed++; detailShops++;
    }
    return placed;
  }
  // Hazur Sahib Nanded (NED): 4 platforms, SCR zone. Terminal, shelters, a
  // foot overbridge and a waiting train, compressed into the researched lot.
  function railwayStation(p) {
    const { w, d } = p, h = 8, front = d / 2;
    pbox(p, 'sidewalk', 0, 0.08, front - 1.2, w, 0.16, 2.6);
    // Terminal building along the front, with a central porch and clock.
    pbox(p, 'cream', 0, h / 2, front - 3.4, w, h, 3.6); collider(p, 0, front - 3.4, w, 3.6, h + 2);
    pbox(p, 'terracotta', 0, h + 0.25, front - 3.4, w + 0.3, 0.5, 4);
    pbox(p, 'cream', 0, h + 1.5, front - 3.4, 4.5, 2.4, 3);
    pshape(p, 'sphere', 'white', 0, h + 1.6, front - 1.82, 0.85, 0.85, 0.08);
    pbox(p, 'dark', 0, h + 1.85, front - 1.76, 0.08, 0.55, 0.06);
    pbox(p, 'dark', 0.22, h + 1.6, front - 1.75, 0.45, 0.08, 0.06);
    for (let n = -4; n <= 4; n++) if (n) pbox(p, 'window', n * w * 0.105, 3.6, front - 1.56, w * 0.07, 4.6, 0.09);
    for (const sx of [-2.6, 2.6]) pbox(p, 'stone', sx, 2.1, front - 1.2, 0.35, 4.2, 0.35);
    pbox(p, 'metal', 0, 4.35, front - 1, 7, 0.18, 1.6);
    psign(p, 0, 6.4, front - 1.5, w * 0.92, 2.4);
    // Platform with a long shelter behind the building.
    pbox(p, 'stone', 0, 0.5, -0.5, w, 0.85, 3.2); collider(p, 0, -0.5, w, 3.2, 1);
    pbox(p, 'lane', 0, 0.95, -1.9, w, 0.04, 0.35);
    for (let n = -3; n <= 3; n++) pbox(p, 'metal', n * w * 0.14, 2.6, 0.2, 0.14, 3.4, 0.14);
    pbox(p, 'tinRoof', 0, 4.4, -0.5, w * 0.94, 0.16, 3.6);
    bench(p, -w * 0.28, 0.4, 2.6); bench(p, w * 0.24, 0.4, 2.6);
    // The waiting train: a red-cream loco and blue ICF coaches.
    const trainZ = -d / 2 + 1.7;
    pbox(p, 'track', 0, 0.12, trainZ, w, 0.14, 3);
    for (const side of [-0.7, 0.7]) pbox(p, 'metal', 0, 0.24, trainZ + side, w, 0.09, 0.09);
    pbox(p, 'red', -w * 0.38, 1.7, trainZ, 4.6, 2.9, 2.5);
    pbox(p, 'awningWhite', -w * 0.38, 2.5, trainZ, 4.6, 0.5, 2.54);
    pbox(p, 'window', -w * 0.38 - 2.32, 2.1, trainZ, 0.08, 0.9, 2);
    collider(p, -w * 0.38, trainZ, 4.6, 2.5, 3.2);
    for (let coach = 0; coach < 3; coach++) {
      const cx = -w * 0.38 + 5.4 + coach * 5.6;
      if (cx > w / 2 - 2) break;
      pbox(p, 'blue', cx, 1.65, trainZ, 5.2, 2.7, 2.5);
      pbox(p, 'awningWhite', cx, 3.05, trainZ, 5.2, 0.2, 2.54);
      pbox(p, 'blueGlass', cx, 2.2, trainZ + 1.27, 4.8, 0.75, 0.06);
      collider(p, cx, trainZ, 5.2, 2.5, 3.2);
    }
    // Foot overbridge across the platform and tracks.
    for (const sx of [-0.5, 0.5]) pbox(p, 'metal', w * 0.3 + sx, 2.6, -0.6, 0.2, 5.2, 0.2);
    pbox(p, 'metal', w * 0.3, 5.1, -1.4, 1.6, 0.25, d * 0.62);
    overhead(p, w * 0.3, -1.4, 1.6, d * 0.62, 4.9, 5.4);
    for (const side of [-1, 1]) { const q = local(p, side * w * 0.36, front - 0.8); lamp(q.x, q.z, p.rotation); }
  }
  // MSRTC Central Bus Stand: terminal, canopy and Lal Pari bays.
  function busStand(p) {
    const { w, d } = p, h = 7.5, front = d / 2;
    pbox(p, 'cream', 0, h / 2, -d * 0.26, w, h, d * 0.44); collider(p, 0, -d * 0.26, w, d * 0.44, h + 1);
    pbox(p, 'red', 0, h + 0.2, -d * 0.26, w + 0.3, 0.45, d * 0.48);
    for (let n = -4; n <= 4; n++) pbox(p, 'window', n * w * 0.105, 4.6, -d * 0.26 + d * 0.225, w * 0.07, 2.2, 0.09);
    pbox(p, 'metal', 0, 4.6, d * 0.16, w * 0.96, 0.24, d * 0.34);
    for (let n = -3; n <= 3; n++) pbox(p, 'metal', n * w * 0.145, 2.3, d * 0.3, 0.15, 4.6, 0.15);
    psign(p, 0, 5.9, d * 0.34, w * 0.94, 2.4);
    bench(p, -w * 0.3, d * 0.12, 2.8); bench(p, 0, d * 0.12, 2.8); bench(p, w * 0.3, d * 0.12, 2.8);
    // Two ST buses waiting in the bays in front of the canopy.
    miniBus(p, -w * 0.27, front - 1.4, Math.PI / 2);
    miniBus(p, w * 0.27, front - 1.4, Math.PI / 2);
    const q = local(p, -w * 0.42, front - 1); lamp(q.x, q.z, p.rotation);
  }

  // Shri Guru Gobind Singh Stadium: four stepped stands, a pavilion, sight
  // screen, scoreboard, floodlights — and the complex's swimming pool.
  function stadium(p) {
    const { w, d } = p;
    pbox(p, 'grass', 0, 0.09, 0, w, 0.18, d);
    pbox(p, 'terracotta', 0, 0.2, 0, w * 0.8, 0.08, d * 0.84);
    pbox(p, 'green', 0, 0.26, 0, w * 0.66, 0.08, d * 0.72);
    pbox(p, 'cream', 0, 0.32, 0, 2.2, 0.04, Math.min(15, d * 0.3));
    for (const side of [-1, 1]) {
      for (let n = 0; n < 3; n++) pbox(p, n % 2 ? 'white' : 'blue', side * (w * 0.4 + n * 1.15), 0.7 + n * 0.95, 0, 1.7, 1.15, d * 0.74);
      collider(p, side * w * 0.43, 0, Math.min(w * 0.16, 6), d * 0.76, 4.2);
      for (let n = 0; n < 3; n++) pbox(p, n % 2 ? 'blue' : 'white', 0, 0.7 + n * 0.95, side * (d * 0.42 + n * 1.05), w * 0.58, 1.15, 1.6);
    }
    // Pavilion with a roof on the west stand, sight screen opposite.
    pbox(p, 'cream', -w * 0.43, 4.6, 0, 3.4, 3.4, d * 0.3); collider(p, -w * 0.43, 0, 3.4, d * 0.3, 7);
    pbox(p, 'terracotta', -w * 0.43, 6.5, 0, 4, 0.35, d * 0.34);
    pbox(p, 'blueGlass', -w * 0.43 + 1.72, 4.8, 0, 0.08, 1.6, d * 0.26);
    pbox(p, 'white', w * 0.36, 2.2, -d * 0.3, 0.3, 4.4, 5);
    // Scoreboard and four floodlight pylons.
    for (const sx of [-1, 1]) pbox(p, 'metal', sx * 1.4 - w * 0.2, 2.5, -d * 0.44, 0.18, 5, 0.18);
    pbox(p, 'dark', -w * 0.2, 5.6, -d * 0.44, 4.6, 2.2, 0.3);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const q = local(p, sx * w * 0.46, sz * d * 0.44);
      cylinder('metal', q.x, 8.5, q.z, 0.16, 17);
      pbox(p, 'white', sx * w * 0.46, 17, sz * d * 0.44, 3.2, 1.4, 0.5);
    }
    // The stadium-complex swimming pool in the south-east corner.
    const px = w * 0.26, pz = d * 0.26;
    pbox(p, 'sidewalk', px, 0.16, pz, 10.5, 0.2, 6.5);
    pbox(p, 'blueGlass', px, 0.3, pz, 9.5, 0.14, 5.2);
    for (let lane = -2; lane <= 2; lane++) pbox(p, 'white', px, 0.38, pz + lane * 1.05, 9.1, 0.03, 0.14);
    pbox(p, 'white', px - 4.2, 1.1, pz, 1.2, 1.9, 2.2);
    pbox(p, 'white', px - 3.4, 2.1, pz, 2.4, 0.14, 0.7);
    pbox(p, 'cream', px + 3.4, 1.5, pz - 3, 4, 3, 1.5); collider(p, px + 3.4, pz - 3, 4, 1.5, 3);
    // Entrance gates and ticket windows on the outside of the front stand.
    pbox(p, 'dark', 0, 1.5, d * 0.42 + 3, 5.5, 3, 0.3);
    pbox(p, 'terracotta', 0, 3.3, d * 0.42 + 3.2, 7, 0.3, 0.9);
    for (let n = -2; n <= 2; n++) if (n) pbox(p, 'window', n * 3.4, 1.5, d * 0.42 + 2.95, 1.1, 1.1, 0.12);
    for (const side of [-1, 1]) { const post = local(p, side * 5.5, d / 2 + 1.2); cylinder('metal', post.x, 2.4, post.z, 0.1, 4.8); }
    psign(p, 0, 4.6, d / 2 + 1.2, Math.min(w * 0.7, 26), 2.2);
  }
  // Bharat E-Square sits on the 3rd floor of Meera Mall, Canal Road: a mall
  // block with a multiplex band and film-poster panels on top.
  function eSquare(p) {
    const { w, d, h } = p, fz = d / 2 + 0.06;
    pbox(p, 'cream', 0, h * 0.32, 0, w, h * 0.64, d); collider(p, 0, 0, w, d, h + 1);
    pbox(p, 'blueGlass', 0, h * 0.3, fz, w * 0.92, h * 0.44, 0.1);
    for (let n = -3; n <= 3; n++) pbox(p, 'metal', n * w * 0.14, h * 0.3, fz + 0.06, 0.12, h * 0.44, 0.08);
    pbox(p, 'dark', 0, h * 0.72, 0, w, h * 0.2, d);
    pbox(p, 'red', 0, h * 0.85, fz, w, 0.5, 0.12);
    for (let n = -2; n <= 2; n++) pbox(p, choose(['saffron', 'sky', 'rose', 'ochre', 'mint']), n * w * 0.19, h * 0.72, fz + 0.05, w * 0.14, h * 0.15, 0.07);
    pbox(p, 'dark', 0, h + 0.15, 0, w + 0.2, 0.3, d + 0.2);
    pbox(p, 'metal', 0, 3.1, fz + 0.9, w * 0.5, 0.16, 1.9);
    pbox(p, 'glass', 0, 1.4, fz + 0.05, w * 0.42, 2.8, 0.1);
    psign(p, 0, h * 0.97, fz + 0.15, w * 0.96, 2.2);
  }
  // Oxford The Global School, Puyni (CBSE, est. 1994): U-shaped academic
  // blocks around an assembly court, a playground and yellow school buses.
  function oxfordSchool(p) {
    const { w, d } = p, h = Math.min(p.h, 10);
    pbox(p, 'grass', 0, 0.06, 0, w, 0.12, d);
    pbox(p, 'sidewalk', 0, 0.14, d * 0.08, w * 0.5, 0.1, d * 0.4);
    const block = (x, z, bw, bd) => {
      pbox(p, 'cream', x, h / 2, z, bw, h, bd); collider(p, x, z, bw, bd, h);
      pbox(p, 'blue', x, h + 0.2, z, bw + 0.3, 0.4, bd + 0.3);
      const bp = { ...p, ...local(p, x, z), w: bw, d: bd, h };
      windows(bp, bw, bd, h, 'window', true);
    };
    block(0, -d * 0.3, w * 0.92, d * 0.3);
    block(-w * 0.38, d * 0.02, w * 0.2, d * 0.5);
    block(w * 0.38, d * 0.02, w * 0.2, d * 0.5);
    // Flag pole with the tricolour over the assembly court.
    const flag = local(p, 0, d * 0.12);
    cylinder('metal', flag.x, 4.5, flag.z, 0.07, 9);
    pbox(p, 'saffron', 0.75, 8.55, d * 0.12, 1.5, 0.34, 0.05);
    pbox(p, 'white', 0.75, 8.2, d * 0.12, 1.5, 0.34, 0.05);
    pbox(p, 'green', 0.75, 7.85, d * 0.12, 1.5, 0.34, 0.05);
    // Playground strip and two yellow school buses at the gate.
    pbox(p, 'sand', -w * 0.18, 0.16, d * 0.38, w * 0.34, 0.08, d * 0.18);
    pbox(p, 'white', -w * 0.18, 0.2, d * 0.38, w * 0.3, 0.03, 0.3);
    miniBus(p, w * 0.3, d * 0.42, Math.PI / 2, 'houseYellow');
    for (const side of [-1, 1]) { pbox(p, 'blue', side * 2.6, 2, d / 2 - 0.5, 0.7, 4, 0.7); collider(p, side * 2.6, d / 2 - 0.5, 0.7, 0.7, 4); }
    pbox(p, 'blue', 0, 4.05, d / 2 - 0.5, 6, 0.35, 0.75);
    overhead(p, 0, d / 2 - 0.5, 6, 0.75, 3.85, 4.3);
    psign(p, 0, 4.05, d / 2 - 0.05, 5.8, 0.95);
  }
  // Yeshwant Mahavidyalaya, VIP Road: a formal main block with a columned
  // porch, flanking wings and a tree-lined front court.
  function yeshwant(p) {
    const { w, d } = p, h = Math.min(p.h, 12), bz = -d * 0.2;
    pbox(p, 'grass', 0, 0.06, 0, w, 0.12, d);
    pbox(p, 'cream', 0, h / 2, bz, w * 0.7, h, d * 0.42); collider(p, 0, bz, w * 0.7, d * 0.42, h + 2);
    for (const side of [-1, 1]) { pbox(p, 'cream', side * w * 0.43, h * 0.36, bz, w * 0.22, h * 0.72, d * 0.42); collider(p, side * w * 0.43, bz, w * 0.22, d * 0.42, h); }
    const bp = { ...p, ...local(p, 0, bz), w: w * 0.7, d: d * 0.42, h };
    windows(bp, w * 0.7, d * 0.42, h, 'window', false);
    pbox(p, 'terracotta', 0, h + 0.3, bz, w * 0.74, 0.5, d * 0.46);
    pbox(p, 'stone', 0, h + 1.1, bz + d * 0.21, w * 0.3, 1.1, 0.3);
    const porchZ = bz + d * 0.21 + 1.4;
    for (let n = -2; n <= 2; n++) { const q = local(p, n * 1.7, porchZ); cylinder('white', q.x, 2.2, q.z, 0.17, 4.4); }
    pbox(p, 'stone', 0, 4.6, porchZ - 0.6, w * 0.42, 0.35, 2.6);
    overhead(p, 0, porchZ - 0.6, w * 0.42, 2.6, 4.4, 4.9);
    pbox(p, 'sidewalk', 0, 0.14, d * 0.24, 3.6, 0.12, d * 0.44);
    ptree(p, -w * 0.34, d * 0.3, false, 0.8); ptree(p, w * 0.34, d * 0.3, false, 0.8);
    const gw = Math.min(w * 0.66, 20), fz = d / 2 - 0.5;
    for (const side of [-1, 1]) { pbox(p, 'stone', side * gw / 2, 2.4, fz, 1.3, 4.8, 1); collider(p, side * gw / 2, fz, 1.3, 1, 4.8); }
    pbox(p, 'cream', 0, 4.7, fz, gw + 1.3, 1, 1.1);
    psign(p, 0, 4.7, fz + 0.6, gw * 0.92, 0.95);
  }
  // Chowks with a lived-in corner: an island, an auto stand or garage sheds.
  function junctionScene(p, variant) {
    square(p);
    const { w, d } = p;
    pshape(p, 'cylinder', 'stone', 0, 0.22, 0, 3.1, 0.3, 3.1);
    pshape(p, 'cylinder', 'grass', 0, 0.4, 0, 2.5, 0.18, 2.5);
    const treeSpot = local(p, -w * 0.42, -d * 0.4);
    if (roadClear(treeSpot.x, treeSpot.z, 3)) { tree(treeSpot.x, treeSpot.z, false, 0.95, 'banyan'); occupy(treeSpot.x, treeSpot.z, 3); }
    if (variant === 'raj') {
      // The auto stand waits off the carriageway, clear of the approach.
      for (const [ax, az, yaw] of [[-11, 4.5, 0.4], [-8.5, 6.5, 0.25], [-13.5, 6, 0.55]]) {
        const spot = local(p, ax, az);
        if (roadClear(spot.x, spot.z, 1.7) && (!p.approach || Math.hypot(spot.x - p.approach.x, spot.z - p.approach.z) > 8.5)) miniAuto(p, ax, az, yaw);
      }
      shopRow(p, 5, 1);
    } else if (variant === 'workshop') {
      for (const gx of [-8, -3]) {
        const shed = { ...p, ...local(p, gx, 8), w: 4.6, d: 4, h: 3.6 };
        if (!roadClear(shed.x, shed.z, 3.4)) continue;
        pbox(shed, 'stone', 0, 1.8, -1.6, 4.6, 3.6, 0.8);
        pbox(shed, 'tinRoof', 0, 3.8, 0, 5.2, 0.14, 4.6);
        for (const sx of [-2, 2]) pbox(shed, 'dark', sx, 1.8, 1.8, 0.16, 3.6, 0.16);
        collider(shed, 0, -1.6, 4.6, 0.8, 3.6); occupy(shed.x, shed.z, 3.4);
      }
      for (let pile = 0; pile < 3; pile++) for (let tyre = 0; tyre <= pile; tyre++) {
        const t = local(p, 6.5 + pile * 1.1, 7.5);
        shape('cylinder', 'dark', t.x, 0.35 + tyre * 0.62, t.z, 0.42, 0.55, 0.42);
      }
      shopRow(p, 4, 6);
    }
  }

  for (const input of PLACES) {
    const p = { ...input, w: input.w || 16, d: input.d || 12, h: input.h || 12, rotation: input.rotation || 0 };
    const name = `${p.id} ${p.name}`.toLowerCase(), category = p.category;
    if (p.id === 'zenda-chowk') startingHome(p);
    else if (p.id === 'nanded-station') railwayStation(p);
    else if (p.id === 'nanded-bus-stand') busStand(p);
    else if (p.id === 'bharat-multiplex') eSquare(p);
    else if (p.id === 'oxford-global-school') oxfordSchool(p);
    else if (p.id === 'yeshwant-college') yeshwant(p);
    else if (p.id === 'raj-corner') junctionScene(p, 'raj');
    else if (p.id === 'workshop-corner') junctionScene(p, 'workshop');
    else if (p.id === 'hazur-sahib') hazurSahib(p);
    else if (p.id === 'mal-tekdi') malTekdi(p);
    else if (p.id === 'kaleshwar-temple') kaleshwar(p);
    else if (p.id === 'vishnupuri-dam') vishnupuriDam(p);
    else if (['godavari-river', 'urvashi-ghat', 'ram-ghat', 'govardhan-ghat'].includes(p.id)) riverGhat(p);
    else if (p.id === 'old-mondha-clock-tower') clockTower(p);
    else if (/bhagya.*kaman/.test(name)) kaman(p);
    else if (/nandgiri|nandagiri|nanded fort/.test(name)) fort(p);
    else if (/airport/.test(name)) airport(p);
    else if (p.id === 'sggs-stadium') stadium(p);
    else if (category === 'park') park(p);
    else if (/hazur.sahib/.test(name) && !/station|rail|yatri|niwas|blood|hospital|iti/.test(name)) shrine(p, true);
    else if (/gurudwara|gurdwara|ghat sahib|langar sahib|mal tekdi|sangat sahib|mata sahib/.test(name)) shrine(p);
    else if (/kaleshwar|temple|mandir/.test(name)) shrine(p, false, true);
    else if (/-bridge\b| bridge\b|overbridge/.test(name)) bridgePlace(p); // not Cambridge Vidyalaya
    else if (/godavari.river|vishnupuri.dam|overbridge|ghat-bridge/.test(name)) square(p);
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

    // Neighbourhood detail clusters around the places people actually
    // navigate by. Fictional shops and stalls, clearance-tested like fillers.
    if (category === 'coaching') {
      // A results hoarding on twin posts beside every institute.
      const spot = local(p, p.w / 2 + 3.4, p.d / 2 + 1.5);
      if (roadClear(spot.x, spot.z, 0.4)) {
        for (const side of [-1, 1]) { const post = local(p, p.w / 2 + 3.4 + side * 2.2, p.d / 2 + 1.5); cylinder('metal', post.x, 2.2, post.z, 0.09, 4.4); }
        const hash = [...p.id].reduce((n, c) => n + c.charCodeAt(0), 0);
        labels.hoarding(hash, spot.x, 4.1, spot.z, 6, 1.9, p.rotation);
        const back = local(p, p.w / 2 + 3.4, p.d / 2 + 1.32);
        labels.hoarding(hash, back.x, 4.1, back.z, 6, 1.9, p.rotation + Math.PI);
      }
    }
    // Shyam Nagar–Rajendra Nagar coaching row: book stalls, chai, xerox.
    if (['iib-parnakuti', 'allen-nanded', 'konale-neet', 'great-achievers', 'rcc-nanded'].includes(p.id)) shopRow(p, 4, 2);
    // Bhagyanagar: the Kaman crossing shops and cafe frontage.
    if (['aakash-nanded', 'frespresso', 'bhagya-nagar-kaman'].includes(p.id)) shopRow(p, 5, 4);
    // Anand Nagar: PW, the cafes and the student food lane.
    if (['pw-nanded', 'amrut-cafe', 'cafe-food-court'].includes(p.id)) shopRow(p, 5, 0);
    // Mondha, old and new: grain-market stalls, sacks and produce piles.
    if (p.id === 'sarafa-bazar') { marketStalls(p, 12); shopRow(p, 4, 3); directionBoardAt(p, 10, 8, 9); miniTempo(p, -13, 8, 0.3); }
    if (p.id === 'old-mondha-clock-tower') marketStalls(p, 7);
    if (p.id === 'prasad-sweet-house') marketStalls(p, 5);
    if (p.id === 'brilliant-commerce') { marketStalls(p, 9); shopRow(p, 4, 5); miniTempo(p, 12, 7, -0.4); }
    // Chhatrapati Chowk (Purna Road) is the researched address anchor of the
    // Chate branch above Parivar Super Market: give the crossing its board,
    // an island and its corner shops.
    if (p.id === 'chate-purna-road') {
      const island = { ...p, x: p.approach?.x ?? p.x, z: p.approach?.z ?? p.z };
      pshape(island, 'cylinder', 'stone', 0, 0.2, -6, 2.8, 0.28, 2.8);
      directionBoardAt(p, 8, 8.5, 9.5);
      shopRow(p, 6, 7);
    }
    // Shri Nagar is the next named stretch after Workshop Corner on the
    // Taroda Naka road (transport-study sequence): board it there.
    if (p.id === 'workshop-corner') directionBoardAt(p, 9, -8.5, 9.5);
    if (p.id === 'taroda-naka') shopRow(p, 4, 2);
    // Station Road and Vazirabad commercial edges.
    if (['nanded-station', 'nanded-bus-stand', 'shivaji-putla'].includes(p.id)) shopRow(p, 4, 1);
    // The other great commercial stretches: Vazirabad's civic row, VIP Road
    // at Baba Nagar, Mahatma Phule Chowk, Hingoli Gate and Degloor Naka.
    if (p.id === 'municipal-corporation') shopRow(p, 6, 2);
    if (p.id === 'yeshwant-college') shopRow(p, 5, 3);
    if (p.id === 'mahatma-phule-chowk') { shopRow(p, 6, 0); marketStalls(p, 6); }
    if (['hingoli-gate', 'degloor-naka', 'collector-office'].includes(p.id)) shopRow(p, 4, 5);
  }

  // Every real OSM-mapped building in the bounds (scripts/build-buildings.py).
  // Footprints, orientations and tagged heights are mapped data; colours and
  // untagged heights are per-type illustrations. A footprint only earns a
  // collider when the whole box is clear of roads and place approaches, so
  // simplified geometry can never block a street or a researched doorway.
  const OSM_COLORS = [
    ['cream', 'terracotta', 'coral', 'mint', 'sky', 'rose', 'ochre', 'white'],
    ['cream', 'white', 'ochre', 'sky'],
    ['sky', 'cream', 'white', 'mint'],
    ['metal', 'sky', 'stone'],
    ['cream', 'white'],
    ['white', 'cream'],
    ['tinRoof', 'stone', 'metal'],
    ['cream', 'terracotta', 'coral', 'mint', 'sky', 'rose', 'ochre'],
  ];
  const OSM_ROOFS = ['roof', 'tileRoof', 'tinRoof', 'roof'];
  const approaches = PLACES.map(place => place.approach).filter(Boolean);
  let osmBuildings = 0, osmColliders = 0;
  for (const [bx, bz, bw, bd, bh, brot, btype] of BUILDINGS) {
    const radius = Math.hypot(bw, bd) / 2;
    if (bx < BOUNDS.minX + 8 || bx > BOUNDS.maxX - 8 || bz < BOUNDS.minZ + 8 || bz > BOUNDS.maxZ - 8) continue;
    if (!dryLand(bx, bz, radius * 0.55)) continue;
    if (!roadClear(bx, bz, -0.5)) continue; // centre sits on a carriageway: mapping offset, skip it
    if (!lotClear(bx, bz, radius * 0.5)) continue; // a researched place or detail already stands here
    const p = { x: bx, z: bz, w: bw, d: bd, h: bh, rotation: brot };
    const paletteForType = OSM_COLORS[btype] || OSM_COLORS[7];
    pbox(p, choose(paletteForType), 0, bh / 2, 0, bw, bh, bd);
    pbox(p, btype === 3 || btype === 6 ? 'tinRoof' : choose(OSM_ROOFS), 0, bh + 0.12, 0, bw + 0.22, 0.24, bd + 0.22);
    // A facade, not just a box: window bands per floor, a parapet lip, and
    // the rooftop furniture of every Indian terrace — tank and stair cabin.
    const floors = Math.max(1, Math.min(5, Math.round(bh / 3.1)));
    if (bw >= 3.4 && bh >= 4) {
      for (let floor = 1; floor <= floors; floor++)
        pbox(p, btype === 2 && floor === 1 ? 'blueGlass' : 'window', 0, Math.min(bh - 0.8, floor * 3.0 - 0.4), bd / 2 + 0.04, bw * 0.7, 1.15, 0.07);
      if (bd >= 5) pbox(p, 'window', bw / 2 + 0.04, bh * 0.55, 0, 0.07, Math.min(2, bh * 0.3), bd * 0.6);
    }
    if (bw >= 4 && bd >= 4) {
      pbox(p, 'roofEdge', 0, bh + 0.42, bd / 2 - 0.06, bw + 0.24, 0.36, 0.12);
      if (btype <= 1 && random() < 0.5) pshape(p, 'cylinder', 'dark', -bw * 0.3, bh + 0.85, -bd * 0.26, 0.55, 1.1, 0.55);
      if (btype <= 2 && random() < 0.35) pbox(p, choose(paletteForType), bw * 0.24, bh + 0.85, -bd * 0.2, 1.7, 1.4, 1.7);
      if (btype >= 2 && bh >= 6 && random() < 0.5) pbox(p, 'gateWhite', -bw * 0.34, bh * 0.62, bd / 2 + 0.3, 1, 0.62, 0.55);
    }
    if (btype === 1 && bw >= 6) for (let floor = 1; floor <= Math.min(floors, 3); floor++)
      pbox(p, 'cream', 0, floor * 3.0 - 1.15, bd / 2 + 0.42, bw * 0.62, 0.14, 0.85);
    if (btype === 2 && bw >= 4.5 && bh < 9) {
      pbox(p, choose(['red', 'blue', 'green', 'saffron']), 0, 3.15, bd / 2 + 0.06, bw * 0.92, 0.75, 0.1);
      for (let sIdx = 0; sIdx < 4; sIdx++) pbox(p, sIdx % 2 ? 'awningWhite' : 'awning', (sIdx - 1.5) * bw / 4.2, 2.68, bd / 2 + 0.62, bw / 4.2, 0.1, 1.25);
    }
    if (bw >= 2.4 && bd >= 2) pbox(p, 'dark', 0, Math.min(1.25, bh / 2), bd / 2 + 0.04, Math.min(1.6, bw * 0.3), Math.min(2.5, bh * 0.85), 0.08);
    if (btype === 5 && bh >= 5) pshape(p, 'dome', 'white', 0, bh + 0.25, 0, Math.min(bw, bd) * 0.24, Math.min(bw, bd) * 0.26, Math.min(bw, bd) * 0.24);
    // Full circumscribed radius: a rotated box corner reaches this far, so
    // anything less can still clip a carriageway (verified against roads).
    const safeCollider = roadClear(bx, bz, radius) && approaches.every(a => Math.hypot(a.x - bx, a.z - bz) > radius + 4.4);
    if (safeCollider) { collider(p); osmColliders++; }
    occupy(bx, bz, radius, { w: bw, d: bd, rotation: brot });
    osmBuildings++;
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
  for (let attempt = 0; attempt < 260000 && fillerCount < 7000; attempt++) {
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
    // Zones give each part of town its own grain: basalt-and-tile old city
    // around Hazur Sahib, brighter commercial frontage by the coaching
    // lanes, and the odd lane-corner mandir or mohalla masjid anywhere.
    const distOld = distanceTo(p, oldCity), distCoach = distanceTo(p, coachingCenter), roll = random();
    if (roll < 0.012 && w > 5) shrine(p, false, true);
    else if (roll < 0.022 && distOld < 1100 && w > 5.5) mosque(p);
    else if (distOld < 650) ordinary(p, { filler: true, sign: fillerCount % 8, color: choose(['stone', 'cream', 'terracotta', 'white', 'basalt']), roofMat: choose(['tileRoof', 'tinRoof', 'roof']), awning: backRow === 0 && fillerCount % 3 === 0 ? choose(['awning', 'green', 'blue']) : undefined });
    else if (distCoach < 550) ordinary(p, { filler: true, sign: fillerCount % 8, color: choose(['cream', 'sky', 'mint', 'ochre', 'coral']), glass: random() < 0.18, awning: backRow === 0 && fillerCount % 2 === 0 ? choose(['awning', 'green', 'blue']) : undefined });
    else ordinary(p, { filler: true, sign: fillerCount % 8, roofMat: random() < 0.22 ? choose(['tinRoof', 'tileRoof']) : undefined, awning: backRow === 0 && fillerCount % 3 === 0 ? choose(['awning', 'green', 'blue']) : undefined });
    occupy(x, z, radius, { w, d, rotation: p.rotation }); fillerCount++;
    if (distanceTo(p, SPAWN) < 520 || distanceTo(p, coachingCenter) < 520) priorityFillers++;
    if (distanceTo(p, coachingCenter) < 1200 || distanceTo(p, oldCity) < 900) coreFillers++;
    if (fillerCount % 12 === 0) {
      const tx = x + dx / len * (w / 2 + 3), tz = z + dz / len * (w / 2 + 3);
      if (roadClear(tx, tz, 1) && lotClear(tx, tz, 2.4) && dryLand(tx, tz, 2)) {
        const outskirts = distanceTo({ x: tx, z: tz }, coachingCenter) > 1100 && distanceTo({ x: tx, z: tz }, oldCity) > 1000;
        const kind = fillerCount % 48 === 0 ? 'banyan' : fillerCount % 8 === 0 ? 'gulmohar' : outskirts && fillerCount % 3 === 0 ? 'babool' : 'neem';
        tree(tx, tz, false, between(0.6, 0.95), kind); occupy(tx, tz, 2); decorationCount++;
      }
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

  // Zebra crossings at the named chowks and speed breakers outside schools
  // and colleges — the two road markings every Nanded driver knows by feel.
  // Painted flat on the road surface; they add no colliders.
  let boardIndex = 0;
  for (const place of PLACES) {
    if (!place.approach) continue;
    const p = { x: place.approach.x, z: place.approach.z, rotation: place.rotation || 0 };
    if (place.category === 'junction') {
      for (let n = -2; n <= 2; n++) pbox(p, 'white', n * 1.5, 0.185, 0, 0.85, 0.02, 4.6);
      // A green direction board on twin posts at the corner of each chowk.
      const board = local(p, 6.5, 5);
      if (roadClear(board.x, board.z, 0.4)) {
        for (const side of [-1, 1]) { const post = local(p, 6.5 + side * 2.6, 5); cylinder('metal', post.x, 1.9, post.z, 0.09, 3.8); }
        // Two faces back to back, so the board reads correctly from both approaches.
        const index = boardIndex++;
        labels.board(index, board.x, 3.6, board.z, 7.2, 2.1, p.rotation);
        const back = local(p, 6.5, 4.82);
        labels.board(index, back.x, 3.6, back.z, 7.2, 2.1, p.rotation + Math.PI);
      }
    }
    if (['school', 'college', 'coaching'].includes(place.category)) {
      pbox(p, 'dark', 0, 0.21, 5.5, 6.4, 0.09, 0.95);
      for (let n = -2; n <= 2; n++) pbox(p, 'lane', n * 1.25, 0.26, 5.5, 0.55, 0.02, 0.9);
    }
  }

  // MSEB poles with sagging spans along the busier streets, and the odd
  // transformer box. Poles are instanced city geometry; wires are one
  // LineSegments draw for the whole city.
  const wirePoints = [];
  for (let i = 0; i < candidates.length; i += 13) {
    const e = candidates[i], dx = e.bPoint.x - e.aPoint.x, dz = e.bPoint.z - e.aPoint.z, len = Math.hypot(dx, dz);
    if (len < 26) continue;
    const off = (e.width || 6) / 2 + 2.1, poles = [];
    for (const t of [0.25, 0.75]) {
      const x = e.aPoint.x + dx * t - dz / len * off, z = e.aPoint.z + dz * t + dx / len * off;
      if (!roadClear(x, z, 0.3) || !dryLand(x, z, 1)) { poles.length = 0; break; }
      poles.push({ x, z });
    }
    if (poles.length < 2) continue;
    for (const pole of poles) {
      cylinder('stone', pole.x, 4.5, pole.z, 0.14, 9);
      box('stone', pole.x, 8.7, pole.z, 1.7, 0.12, 0.12, Math.atan2(dx, dz));
    }
    if (random() < 0.12) box('green', poles[0].x, 5.6, poles[0].z, 0.85, 1.05, 0.6, Math.atan2(dx, dz));
    const sag = 0.9;
    for (const sideOff of [-0.7, 0.7]) {
      const nx = Math.cos(Math.atan2(dx, dz)) * sideOff, nz = -Math.sin(Math.atan2(dx, dz)) * sideOff;
      const mx = (poles[0].x + poles[1].x) / 2 + nx, mz = (poles[0].z + poles[1].z) / 2 + nz;
      wirePoints.push(poles[0].x + nx, 8.7, poles[0].z + nz, mx, 8.7 - sag, mz, mx, 8.7 - sag, mz, poles[1].x + nx, 8.7, poles[1].z + nz);
    }
  }
  if (wirePoints.length) {
    const wireGeometry = new THREE.BufferGeometry();
    wireGeometry.setAttribute('position', new THREE.Float32BufferAttribute(wirePoints, 3));
    const wires = new THREE.LineSegments(wireGeometry, new THREE.LineBasicMaterial({ color: '#2c3133', transparent: true, opacity: 0.5 }));
    wires.name = 'Overhead wires'; wires.frustumCulled = false; group.add(wires);
  }

  // Rows of parked two-wheelers outside coaching classes and colleges.
  for (const place of PLACES.filter(p => ['coaching', 'college', 'school', 'market', 'shop', 'restaurant', 'hotel'].includes(p.category)).slice(0, 34)) {
    if (!place.approach) continue;
    const base = { x: place.approach.x, z: place.approach.z, rotation: place.rotation || 0 };
    for (let n = 0; n < 6; n++) {
      const q = local(base, -7.5 + n * 1.6, 6.5);
      if (!roadClear(q.x, q.z, 0.7) || !dryLand(q.x, q.z, 1)) continue;
      const bike = { ...base, x: q.x, z: q.z };
      pshape(bike, 'sphere', 'dark', 0, 0.34, -0.85, 0.12, 0.34, 0.34);
      pshape(bike, 'sphere', 'dark', 0, 0.34, 0.85, 0.12, 0.34, 0.34);
      pbox(bike, choose(['red', 'blue', 'dark', 'metal']), 0, 0.72, 0, 0.26, 0.42, 1.9);
    }
  }

  // Farmland takes over where the plotted layouts end: regur black-soil
  // fallows, green tur and soybean, golden jowar, cotton rows — with a
  // babool and a tin-roofed hut on some plots. Surface paint only.
  const farmEdges = edges.filter(e => {
    const m = midpoint(e);
    return distanceTo(m, coachingCenter) > 1250 && distanceTo(m, oldCity) > 1050 && Math.hypot(e.bPoint.x - e.aPoint.x, e.bPoint.z - e.aPoint.z) > 12;
  });
  for (let attempt = 0; attempt < 5200 && farmPlots < 260 && farmEdges.length; attempt++) {
    const e = farmEdges[Math.floor(random() * farmEdges.length)];
    const dx = e.bPoint.x - e.aPoint.x, dz = e.bPoint.z - e.aPoint.z, len = Math.hypot(dx, dz);
    const side = random() < 0.5 ? -1 : 1, w = between(30, 68), d = between(24, 48), radius = Math.hypot(w, d) / 2;
    const t = between(0.1, 0.9), offset = (e.width || 6) / 2 + radius + between(3, 14);
    const x = e.aPoint.x + dx * t + dz / len * offset * side, z = e.aPoint.z + dz * t - dx / len * offset * side;
    if (x < BOUNDS.minX + 40 || x > BOUNDS.maxX - 40 || z < BOUNDS.minZ + 40 || z > BOUNDS.maxZ - 40) continue;
    if (!roadClear(x, z, radius) || !dryLand(x, z, radius) || !lotClear(x, z, radius)) continue;
    const p = { x, z, w, d, h: 3, rotation: Math.atan2(dx, dz) + (random() < 0.5 ? 0 : Math.PI / 2) };
    const crop = choose(['blackSoil', 'cropGreen', 'cropGold', 'cropCotton', 'dryGrass', 'cropGreen']);
    pbox(p, crop, 0, 0.05, 0, w, 0.14, d);
    if (crop !== 'blackSoil') for (let row = -2; row <= 2; row++) pbox(p, row % 2 ? 'blackSoil' : 'cropCotton', row * w * 0.17, 0.11, 0, w * 0.045, 0.06, d * 0.96);
    else for (let row = -2; row <= 2; row++) pbox(p, 'sand', row * w * 0.17, 0.1, 0, w * 0.03, 0.05, d * 0.96);
    if (random() < 0.4) { const q = local(p, w * 0.36, d * 0.36); tree(q.x, q.z, false, between(0.8, 1.2), 'babool'); }
    if (random() < 0.16) {
      pbox(p, 'cream', -w * 0.34, 1.4, -d * 0.34, 4.2, 2.8, 3.4);
      pbox(p, 'tinRoof', -w * 0.34, 3, -d * 0.34, 4.7, 0.18, 3.9);
    }
    occupy(x, z, radius); farmPlots++;
  }

  // Low basalt tekdi ridges on the dry outskirts, so the plateau edge is
  // not an endless flat sand sheet.
  for (let attempt = 0; attempt < 2400 && ridgeCount < 26 && farmEdges.length; attempt++) {
    const e = farmEdges[Math.floor(random() * farmEdges.length)];
    const dx = e.bPoint.x - e.aPoint.x, dz = e.bPoint.z - e.aPoint.z, len = Math.hypot(dx, dz);
    const side = random() < 0.5 ? -1 : 1, w = between(55, 130), h = between(7, 16), radius = w * 0.62;
    const offset = (e.width || 6) / 2 + radius + between(25, 80);
    const x = (e.aPoint.x + e.bPoint.x) / 2 + dz / len * offset * side, z = (e.aPoint.z + e.bPoint.z) / 2 - dx / len * offset * side;
    if (x < BOUNDS.minX + 60 || x > BOUNDS.maxX - 60 || z < BOUNDS.minZ + 60 || z > BOUNDS.maxZ - 60) continue;
    if (!roadClear(x, z, radius) || !dryLand(x, z, radius) || !lotClear(x, z, radius)) continue;
    shape('sphere', 'basalt', x, h * 0.12, z, w, h, w * between(0.5, 0.75), between(0, Math.PI));
    shape('sphere', 'dryGrass', x + between(-8, 8), h * 0.35, z + between(-6, 6), w * 0.55, h * 0.5, w * 0.34, between(0, Math.PI));
    occupy(x, z, radius); ridgeCount++;
  }

  // Small spatial batches keep the full-city dataset from defeating frustum culling.
  const chunkMeshes = [];
  let instanceCount = 0;
  const scratchMatrix = new THREE.Matrix4();
  for (const b of batches.values()) {
    const mesh = new THREE.InstancedMesh(geometries[b.geometry], materials[b.material], b.matrices.length);
    b.matrices.forEach((elements, i) => { mesh.setMatrixAt(i, scratchMatrix.fromArray(elements)); mesh.setColorAt(i, b.colors[i]); }); mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = b.material !== 'surface' && b.material !== 'water'; mesh.receiveShadow = true; mesh.computeBoundingBox(); mesh.computeBoundingSphere();
    mesh.name = `City ${b.material} ${b.geometry}`; group.add(mesh); chunkMeshes.push(mesh);
    instanceCount += b.matrices.length;
  }
  const labelStats = labels.finish();
  const cameraColliders = [...colliders, ...cameraStructures, ...labelStats.cameraOccluders];
  chunkMeshes.push(...labelStats.meshes);
  // The city never moves: compose its matrices once, then stop the renderer's
  // per-frame scene walk at this group instead of visiting thousands of meshes.
  group.updateMatrixWorld(true);
  group.traverse(object => { object.matrixAutoUpdate = false; });
  group.updateMatrixWorld = () => {};
  let lastFocus = { x: Infinity, z: Infinity }, lastCull = 0;
  function setFocus(focus) {
    if (!focus || !Number.isFinite(focus.x) || !Number.isFinite(focus.z)) return;
    const now = Date.now();
    if (Math.hypot(focus.x - lastFocus.x, focus.z - lastFocus.z) < 40 && now - lastCull < 500) return;
    lastFocus = { x: focus.x, z: focus.z }; lastCull = now;
    for (const mesh of chunkMeshes) {
      const sphere = mesh.boundingSphere || mesh.geometry.boundingSphere;
      const distance = Math.hypot(sphere.center.x - focus.x, sphere.center.z - focus.z);
      mesh.visible = distance < viewDistance + sphere.radius;
    }
  }
  setFocus(SPAWN);

  // The Godavari, alive: foam flecks drifting downstream and three country
  // boats working the main channel. Added to the scene (not the frozen city
  // group) so they can actually move.
  const riverPath = (NETWORK.rivers?.[0]?.points || []).map(p => ({ x: p.x, z: p.z }));
  const riverLengths = [0];
  for (let i = 1; i < riverPath.length; i++) riverLengths.push(riverLengths[i - 1] + Math.hypot(riverPath[i].x - riverPath[i - 1].x, riverPath[i].z - riverPath[i - 1].z));
  const riverTotal = riverLengths.at(-1) || 0;
  function riverAt(distance) {
    if (!riverTotal) return { x: 0, z: 0, heading: 0 };
    const d = ((distance % riverTotal) + riverTotal) % riverTotal;
    let i = 1;
    while (i < riverLengths.length - 1 && riverLengths[i] < d) i++;
    const seg = riverLengths[i] - riverLengths[i - 1] || 1, t = (d - riverLengths[i - 1]) / seg;
    const a = riverPath[i - 1], b = riverPath[i];
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, heading: Math.atan2(-(b.x - a.x), -(b.z - a.z)) };
  }
  const boats = [];
  if (riverTotal > 200) {
    const hullMat = new THREE.MeshStandardMaterial({ color: '#7a4a2e', roughness: 0.8 });
    const canopyMat = new THREE.MeshStandardMaterial({ color: '#e8b23e', roughness: 0.9 });
    for (let b = 0; b < 3; b++) {
      const boat = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.7, 6.4), hullMat); hull.position.y = 0.32; boat.add(hull);
      const prow = new THREE.Mesh(new THREE.ConeGeometry(0.85, 1.6, 4), hullMat); prow.rotation.x = Math.PI / 2; prow.rotation.y = Math.PI / 4; prow.position.set(0, 0.4, -3.9); boat.add(prow);
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 2.6), canopyMat); canopy.position.y = 1.65; boat.add(canopy);
      for (const px of [-0.65, 0.65]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.1, 0.09), hullMat); post.position.set(px, 1.1, 0.6); boat.add(post); }
      scene.add(boat);
      boats.push({ mesh: boat, offset: riverTotal * (0.22 + b * 0.19), speed: 2.1 + b * 0.5, lane: (b - 1) * 13 });
    }
  }
  const FOAM = 90, foamPositions = new Float32Array(FOAM * 3), foamS = new Float32Array(FOAM), foamLane = new Float32Array(FOAM);
  for (let i = 0; i < FOAM; i++) { foamS[i] = riverTotal * (i / FOAM); foamLane[i] = (i % 7 - 3) * 7; }
  const foamGeometry = new THREE.BufferGeometry();
  foamGeometry.setAttribute('position', new THREE.BufferAttribute(foamPositions, 3));
  const foam = new THREE.Points(foamGeometry, new THREE.PointsMaterial({ color: '#eef4ec', size: 0.85, transparent: true, opacity: 0.5, depthWrite: false }));
  foam.frustumCulled = false; foam.visible = riverTotal > 200; scene.add(foam);

  group.userData = { architecture: 'Illustrative original models; mapped streets and researched place names', fillerCount, priorityFillers, coreFillers, startingLaneTrees, bridgeEdges, farmPlots, ridgeCount, signCount: labelStats.signCount, atlasCount: 1, batchCount: batches.size };
  return {
    group, colliders, cameraColliders, landmarks: PLACES, roads: NETWORK, bounds: BOUNDS,
    setFocus,
    // Adaptive quality shrinks the cull radius with the fog; forcing the
    // next setFocus to re-cull keeps the two in step immediately.
    setViewDistance(distance) {
      if (!Number.isFinite(distance) || distance <= 0) return;
      viewDistance = distance; lastFocus = { x: Infinity, z: Infinity }; lastCull = 0;
    },
    getStats() { return { batches: chunkMeshes.length, visibleBatches: chunkMeshes.filter(mesh => mesh.visible).length, instances: instanceCount, fillers: fillerCount, priorityFillers, coreFillers, startingLaneTrees, bridgeEdges, farmPlots, ridges: ridgeCount, detailShops, osmBuildings, osmColliders, placeCount: PLACES.length, signs: labelStats.signCount, atlases: 1 }; },
    animate(dt, elapsed) {
      materials.water.roughness = 0.27 + Math.sin(elapsed * 0.2) * 0.035;
      if (!riverTotal) return;
      const step = Math.min(dt || 0, 0.1);
      for (const boat of boats) {
        boat.offset += boat.speed * step;
        const p = riverAt(boat.offset);
        boat.mesh.position.set(p.x + Math.cos(p.heading) * boat.lane, 0.12 + Math.sin(elapsed * 1.4 + boat.offset * 0.05) * 0.05, p.z - Math.sin(p.heading) * boat.lane);
        boat.mesh.rotation.y = p.heading;
        boat.mesh.rotation.z = Math.sin(elapsed * 1.1 + boat.offset) * 0.02;
      }
      for (let i = 0; i < FOAM; i++) {
        foamS[i] += step * 5.5;
        if (foamS[i] > riverTotal) foamS[i] -= riverTotal;
        const p = riverAt(foamS[i]);
        foamPositions[i * 3] = p.x + Math.cos(p.heading) * foamLane[i];
        foamPositions[i * 3 + 1] = 0.22;
        foamPositions[i * 3 + 2] = p.z - Math.sin(p.heading) * foamLane[i];
      }
      foamGeometry.attributes.position.needsUpdate = true;
    },
  };
}
