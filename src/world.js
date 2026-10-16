import * as THREE from 'three';

export const WORLD = Object.freeze({
  roadXs: [-240, -120, 0, 120, 240],
  roadZs: [-240, -120, 0, 120, 240],
  roadWidth: 22,
  bounds: { minX: -325, maxX: 325, minZ: -325, maxZ: 290 },
});

/** A fictional, compressed interpretation of Nanded, built entirely in the browser. */
export function createWorld(scene) {
  const group = new THREE.Group();
  group.name = 'Nanded';
  scene.add(group);
  const colliders = [];
  const landmarks = [
    { name: 'Hazur Sahib', x: 120, z: 180, type: 'landmark' },
    { name: 'Godavari Ghat', x: 0, z: 270, type: 'river' },
    { name: 'Nanded Railway Station', x: -180, z: -240, type: 'station' },
    { name: 'Vazirabad Market', x: -120, z: -50, type: 'market' },
    { name: 'Shivaji Chowk', x: 0, z: 0, type: 'square' },
    { name: 'University Road', x: -120, z: 180, type: 'university' },
    { name: 'Guru Gobind Singh Stadium', x: 120, z: -180, type: 'stadium' },
  ];

  const materials = {};
  const palette = {
    sand: '#cbb79b', sidewalk: '#d2c5af', asphalt: '#4b5559', roadEdge: '#cec9b0',
    lane: '#edcf83', terracotta: '#cc8562', coral: '#d8907f', cream: '#e4d0a4',
    mint: '#8fada0', sky: '#97aeb7', ochre: '#d0a34e', rose: '#c8a19c',
    white: '#f0e6cc', roof: '#b8a28a', roofEdge: '#d6c3a3', window: '#354d58',
    glass: '#88a5a8', dark: '#354147', metal: '#65716d', gold: '#e1b54c',
    trunk: '#857051', leaf: '#688b5c', leafLight: '#88a568', grass: '#9ba477',
    blue: '#567d93', saffron: '#e79b48', red: '#bd5f4c', water: '#559599',
    train: '#b75043', awning: '#cb694c', awningWhite: '#eee2bd', track: '#58564c',
  };
  for (const [name, color] of Object.entries(palette)) {
    materials[name] = new THREE.MeshStandardMaterial({ color, roughness: name === 'gold' ? 0.35 : 0.88, metalness: name === 'gold' ? 0.5 : 0 });
  }
  materials.water.roughness = 0.27;
  materials.water.metalness = 0.28;
  const geometries = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cylinder: new THREE.CylinderGeometry(1, 1, 1, 10),
    cone: new THREE.ConeGeometry(1, 1, 10),
    sphere: new THREE.SphereGeometry(1, 8, 6),
    dome: new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
  };
  const batches = new Map();
  const dummy = new THREE.Object3D();
  let seed = 48271;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const between = (a, b) => a + random() * (b - a);
  const choose = a => a[Math.floor(random() * a.length)];
  function shape(geometry, material, x, y, z, sx, sy, sz, rotation = 0, tilt = 0) {
    const key = `${geometry}:${material}`;
    if (!batches.has(key)) batches.set(key, { geometry, material, matrices: [] });
    dummy.position.set(x, y, z);
    dummy.scale.set(sx, sy, sz);
    dummy.rotation.set(tilt, rotation, 0);
    dummy.updateMatrix();
    batches.get(key).matrices.push(dummy.matrix.clone());
  }
  const box = (mat, x, y, z, w, h, d, rot = 0) => shape('box', mat, x, y, z, w, h, d, rot);
  const cylinder = (mat, x, y, z, r, h) => shape('cylinder', mat, x, y, z, r, h, r);
  const collider = (x, z, w, d, h = 25) => colliders.push({ x, z, w, d, h });

  // Signage shares one texture atlas and one mesh, even across different streets.
  const signLabels = [
    ['नांदेड', 'NANDED · CITY OF RIVERS', '#354e5b'],
    ['चहा कट्टा', 'CHAI • SNACKS • GOOD COMPANY', '#a74e39'],
    ['गोदावरी जनरल स्टोअर्स', 'GODAVARI GENERAL STORES', '#446e64'],
    ['महाराष्ट्र भोजनालय', 'MAHARASHTRA BHOJANALAY', '#b66e33'],
    ['वजीराबाद बाजार', 'VAZIRABAD MARKET', '#b85742'],
    ['हजूर साहिब', 'TAKHT SACHKHAND SRI HAZUR SAHIB', '#9e7833'],
    ['नांदेड रेल्वे स्थानक', 'HAZUR SAHIB NANDED STATION', '#244f63'],
    ['गोदावरी घाट', 'GODAVARI RIVERFRONT', '#437f81'],
    ['दख्खन मोटर्स', 'DECCAN MOTORS • SERVICE', '#4b6578'],
    ['सह्याद्री पुस्तकालय', 'SAHYADRI BOOKS & STATIONERY', '#7c5a5a'],
    ['स्वामी रामानंद तीर्थ', 'UNIVERSITY ROAD · NANDED', '#52695e'],
    ['गुरु गोबिंदसिंघ स्टेडियम', 'GURU GOBIND SINGH STADIUM', '#427d6b'],
    ['छत्रपती शिवाजी चौक', 'CHHATRAPATI SHIVAJI CHOWK', '#ab7236'],
    ['श्री गणेश स्वीट्स', 'FRESH JALEBI • PEDHA • LASSI', '#b96c3f'],
    ['दख्खन कॅफे', 'DECCAN CAFE · EST. 1986', '#496f68'],
    ['नांदेड सायकल हाऊस', 'NANDED CYCLE HOUSE', '#4d667e'],
  ];
  const atlas = document.createElement('canvas');
  atlas.width = 2048; atlas.height = 1024;
  const ctx = atlas.getContext('2d');
  signLabels.forEach(([title, subtitle, color], i) => {
    const x = (i % 4) * 512, y = Math.floor(i / 4) * 256;
    ctx.fillStyle = color; ctx.fillRect(x, y, 512, 256);
    ctx.strokeStyle = '#efd6a5'; ctx.lineWidth = 5; ctx.strokeRect(x + 12, y + 12, 488, 232);
    ctx.fillStyle = '#fff0cc'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 43px "Noto Sans Devanagari", sans-serif';
    ctx.fillText(title, x + 256, y + 98, 464);
    ctx.font = 'bold 20px sans-serif'; ctx.fillText(subtitle, x + 256, y + 170, 464);
    ctx.fillRect(x + 218, y + 210, 76, 3);
  });
  const signTexture = new THREE.CanvasTexture(atlas);
  signTexture.colorSpace = THREE.SRGBColorSpace;
  signTexture.anisotropy = 4;
  const signPositions = [], signUVs = [], signIndices = [];
  function sign(index, x, y, z, width = 20, height = 5, rotation = 0) {
    const cosine = Math.cos(rotation), sine = Math.sin(rotation);
    const start = signPositions.length / 3;
    for (const [vx, vy] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
      signPositions.push(x + vx * width * cosine, y + vy * height, z - vx * width * sine);
    }
    const u0 = (index % 4) / 4, u1 = u0 + 0.25;
    const v1 = 1 - Math.floor(index / 4) / 4, v0 = v1 - 0.25;
    signUVs.push(u0, v0, u1, v0, u1, v1, u0, v1);
    signIndices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }

  // Warm, compact street grid. Curbs and zebra crossings help the streets read at speed.
  box('sand', 0, -0.5, -15, 720, 1, 650);
  for (const x of WORLD.roadXs) box('asphalt', x, 0.015, -20, 22, 0.08, 640);
  for (const z of WORLD.roadZs) box('asphalt', 0, 0.025, z, 680, 0.08, 22);
  for (const x of WORLD.roadXs) {
    for (let z = -325; z < 290; z += 10) {
      if (WORLD.roadZs.some(road => Math.abs(z - road) < 15)) continue;
      box('lane', x, 0.08, z, 0.3, 0.025, 4.5);
      box('roadEdge', x - 10.1, 0.08, z, 0.18, 0.025, 10);
      box('roadEdge', x + 10.1, 0.08, z, 0.18, 0.025, 10);
    }
  }
  for (const z of WORLD.roadZs) {
    for (let x = -325; x < 325; x += 10) {
      if (WORLD.roadXs.some(road => Math.abs(x - road) < 15)) continue;
      box('lane', x, 0.08, z, 4.5, 0.025, 0.3);
      box('roadEdge', x, 0.08, z - 10.1, 10, 0.025, 0.18);
      box('roadEdge', x, 0.08, z + 10.1, 10, 0.025, 0.18);
    }
  }
  for (const x of WORLD.roadXs) for (const z of WORLD.roadZs) {
    for (let stripe = -7.5; stripe <= 7.5; stripe += 3) {
      box('white', x + stripe, 0.09, z - 14, 1.5, 0.025, 3.8);
      box('white', x + stripe, 0.09, z + 14, 1.5, 0.025, 3.8);
      box('white', x - 14, 0.09, z + stripe, 3.8, 0.025, 1.5);
      box('white', x + 14, 0.09, z + stripe, 3.8, 0.025, 1.5);
    }
  }

  function tree(x, z, palm = false) {
    if (palm) {
      cylinder('trunk', x, 5.6, z, 0.48, 11);
      shape('sphere', 'leaf', x, 11.3, z, 1.65, 1.4, 1.65);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        shape('sphere', i % 2 ? 'leaf' : 'leafLight', x + Math.sin(a) * 2.9, 11.5, z + Math.cos(a) * 2.9, 1.2, 0.5, 4.2, a, 0.22);
      }
    } else {
      const h = between(6.5, 9);
      cylinder('trunk', x, h / 2, z, 0.55, h);
      shape('sphere', 'leaf', x, h + 1, z, 4.4, 4.8, 4.4);
      shape('sphere', 'leafLight', x - 1.4, h + 3, z + 0.7, 3.2, 3, 3.2);
    }
  }
  function lamp(x, z, rot = 0) {
    cylinder('metal', x, 5.3, z, 0.16, 10.6);
    box('metal', x + Math.cos(rot), 10.6, z + Math.sin(rot), 2.1, 0.18, 0.18, -rot);
    box('white', x + Math.cos(rot) * 1.8, 10.45, z + Math.sin(rot) * 1.8, 1.3, 0.18, 0.65, -rot);
    cylinder('dark', x, 0.5, z, 0.38, 1);
  }
  function bench(x, z, rotation = 0) {
    box('trunk', x, 1.15, z, 4.3, 0.25, 1.3, rotation);
    const dx = Math.sin(rotation) * 0.56, dz = Math.cos(rotation) * 0.56;
    box('trunk', x + dx, 1.9, z + dz, 4.3, 1.1, 0.2, rotation);
    for (const side of [-1, 1]) box('dark', x + Math.cos(rotation) * side * 1.5, 0.6, z - Math.sin(rotation) * side * 1.5, 0.25, 1, 1, rotation);
  }
  function building(x, z, w, d, h, color, signIndex) {
    const base = 0.35;
    box(color, x, h / 2 + base, z, w, h, d);
    collider(x, z, w + 0.5, d + 0.5, h + 3);
    box('roof', x, h + base + 0.2, z, w + 0.6, 0.5, d + 0.6);
    for (const side of [-1, 1]) {
      box('roofEdge', x + side * (w / 2 - 0.25), h + 0.95, z, 0.5, 1.2, d);
      box('roofEdge', x, h + 0.95, z + side * (d / 2 - 0.25), w, 1.2, 0.5);
    }
    const floors = Math.max(1, Math.floor((h - 5) / 5));
    for (let floor = 0; floor < floors; floor++) {
      const y = 5.5 + floor * 5;
      for (let col = -1; col <= 1; col++) {
        for (const side of [-1, 1]) {
          box('window', x + col * w * 0.27, y, z + side * (d / 2 + 0.035), w * 0.14, 2.4, 0.12);
          box('white', x + col * w * 0.27, y - 1.35, z + side * (d / 2 + 0.3), w * 0.17, 0.23, 0.7);
          box('window', x + side * (w / 2 + 0.035), y, z + col * d * 0.27, 0.12, 2.4, d * 0.14);
        }
      }
      if (floor % 2 === 1) {
        box('cream', x, y - 1.55, z + d / 2 + 0.9, w * 0.67, 0.35, 2.3);
        box('metal', x, y - 0.6, z + d / 2 + 1.95, w * 0.67, 0.13, 0.13);
        for (let r = -2; r <= 2; r++) box('metal', x + r * w * 0.14, y - 1, z + d / 2 + 1.95, 0.13, 1.15, 0.13);
      }
    }
    // Shop fronts sit below the residences.
    for (const side of [-1, 1]) {
      for (const col of [-1, 1]) {
        box('dark', x + col * w * 0.25, 2, z + side * (d / 2 + 0.06), w * 0.32, 3.6, 0.15);
        for (let slat = 0; slat < 4; slat++) box('metal', x + col * w * 0.25, 0.9 + slat * 0.75, z + side * (d / 2 + 0.15), w * 0.31, 0.07, 0.05);
      }
    }
    if (signIndex !== undefined) {
      sign(signIndex, x, 4.1, z + d / 2 + 0.2, w * 0.9, 2.7);
      box(choose(['awning', 'blue', 'mint']), x, 3.2, z + d / 2 + 1.45, w + 0.5, 0.24, 3);
    }
    // Rooftop utility silhouettes make a distinctly Indian skyline.
    const tx = x + w * 0.24, tz = z - d * 0.22;
    box('cream', tx, h + 1.2, tz, 5.1, 1.4, 5.1);
    cylinder('dark', tx, h + 3, tz, 1.9, 2.8);
    cylinder('dark', tx, h + 4.5, tz, 1.7, 0.25);
    if (random() > 0.45) {
      box('white', x - w * 0.25, h + 1.8, z + d * 0.15, 5, 3, 4);
      box('blue', x - w * 0.25, h + 3.5, z + d * 0.15, 6, 0.2, 4.8);
    }
    if (random() > 0.6) {
      cylinder('metal', x + w * 0.2, h + 5, z + d * 0.2, 0.075, 9);
      box('metal', x + w * 0.2, h + 8, z + d * 0.2, 3.5, 0.08, 0.08);
      box('metal', x + w * 0.2, h + 7.2, z + d * 0.2, 2.5, 0.08, 0.08);
    }
  }

  const intervalsX = [[-329, -252], [-228, -132], [-108, -12], [12, 108], [132, 228], [252, 329]];
  const intervalsZ = [[-329, -252], [-228, -132], [-108, -12], [12, 108], [132, 228], [252, 289]];
  const specialLots = new Set(['4,4', '1,0', '1,2', '1,4', '4,1']);
  const buildingColors = ['terracotta', 'coral', 'cream', 'mint', 'sky', 'ochre', 'rose', 'white'];
  for (let ix = 0; ix < intervalsX.length; ix++) for (let iz = 0; iz < intervalsZ.length; iz++) {
    const [x0, x1] = intervalsX[ix], [z0, z1] = intervalsZ[iz];
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    box('sidewalk', mx, 0.08, mz, x1 - x0, 0.16, z1 - z0);
    if (specialLots.has(`${ix},${iz}`)) continue;
    const rows = iz === 5 ? 1 : 2;
    for (let row = 0; row < rows; row++) for (let col = 0; col < 2; col++) {
      const cellW = (x1 - x0) / 2, cellD = (z1 - z0) / rows;
      const x = x0 + cellW * (col + 0.5), z = z0 + cellD * (row + 0.5);
      const w = cellW - between(8, 13), d = cellD - between(9, 15);
      const height = iz === 5 ? between(10, 16) : between(13, 34) + (random() > 0.91 ? 17 : 0);
      building(x, z, w, d, height, choose(buildingColors), random() > 0.62 ? choose([1, 2, 3, 8, 9, 13, 14, 15]) : undefined);
    }
    if (iz < 5) tree(mx, mz, random() > 0.65);
  }

  // Hazur Sahib: a peaceful white-and-gold landmark precinct.
  box('white', 180, 0.35, 180, 89, 0.7, 89);
  box('cream', 180, 0.75, 180, 77, 0.8, 72);
  box('white', 180, 9, 185, 59, 17, 48); collider(180, 185, 60, 49);
  box('white', 180, 22, 188, 39, 10, 32);
  box('gold', 180, 27.4, 188, 42, 0.65, 35);
  cylinder('white', 180, 29, 188, 11.5, 4);
  shape('dome', 'gold', 180, 31, 188, 13, 12.5, 13);
  cylinder('gold', 180, 44.5, 188, 1, 4);
  shape('cone', 'gold', 180, 48, 188, 1.6, 5, 1.6);
  for (const dx of [-25, 25]) for (const dz of [-19, 19]) {
    box('white', 180 + dx, 13, 185 + dz, 7, 25, 7);
    cylinder('white', 180 + dx, 27, 185 + dz, 3.1, 4);
    shape('dome', 'gold', 180 + dx, 29, 185 + dz, 4.1, 4.7, 4.1);
    shape('cone', 'gold', 180 + dx, 35.1, 185 + dz, 0.65, 3, 0.65);
  }
  for (let n = -3; n <= 3; n++) {
    box('window', 180 + n * 7, 7, 160.95, 3.8, 8, 0.12);
    shape('dome', 'window', 180 + n * 7, 11, 160.9, 1.9, 2.1, 0.12);
    box('gold', 180 + n * 7, 13.8, 160.7, 4.2, 0.3, 0.3);
  }
  for (let step = 0; step < 4; step++) box('white', 180, 0.25 + step * 0.3, 153 + step, 32 - step * 1.2, 0.5, 3);
  sign(5, 180, 4, 143.5, 47, 4.5);
  for (const x of [140, 220]) { tree(x, 145, true); tree(x, 217, true); }
  cylinder('gold', 142, 17, 167, 0.16, 34);
  box('saffron', 144.6, 31, 167, 5, 2.7, 0.09);
  bench(151, 141); bench(208, 141);

  // Railway station and a parked Deccan passenger train beyond its platform.
  box('cream', -180, 7.3, -279, 79, 14, 29); collider(-180, -279, 80, 30);
  box('terracotta', -180, 14.8, -279, 85, 1.2, 34);
  box('white', -180, 14, -279, 18, 12, 32);
  box('terracotta', -180, 20.1, -279, 20, 1.1, 35);
  sign(6, -180, 11.6, -264.25, 64, 5.5);
  for (let n = -4; n <= 4; n++) box('window', -180 + n * 8, 4.4, -264.2, 4.8, 7.8, 0.15);
  box('roof', -180, 0.7, -307, 95, 1, 20);
  for (const z of [-311, -319]) {
    for (const side of [-1, 1]) box('metal', -180, 0.6, z + side * 1.35, 106, 0.22, 0.22);
    for (let x = -230; x < -125; x += 3) box('trunk', x, 0.35, z, 0.7, 0.2, 4.8);
  }
  for (let carriage = 0; carriage < 4; carriage++) {
    const x = -215 + carriage * 24;
    box('train', x, 3.9, -318, 22.6, 5.6, 5.8);
    box('cream', x, 5.3, -318, 22.6, 1.7, 5.9);
    box('roof', x, 6.9, -318, 23, 0.7, 6.1);
    for (let win = -3; win <= 3; win++) box('window', x + win * 2.8, 5.5, -314.99, 1.9, 1.4, 0.1);
  }
  tree(-223, -257); tree(-137, -257);
  bench(-201, -257); bench(-163, -257);

  // Vazirabad: lower shop houses surrounding colorful open-air market lanes.
  building(-205, -65, 30, 68, 20, 'ochre', 4);
  building(-155, -91, 31, 21, 17, 'rose', 3);
  building(-155, -26, 31, 19, 15, 'mint', 13);
  sign(4, -133.7, 7, -58, 34, 5, Math.PI / 2);
  for (let i = 0; i < 5; i++) {
    const x = i % 2 ? -151 : -176, z = -82 + i * 12;
    box('trunk', x, 1.3, z, 8, 2.4, 5);
    collider(x, z, 8, 5);
    for (const side of [-1, 1]) cylinder('metal', x + side * 3.8, 2.7, z, 0.09, 5.4);
    for (let stripe = -2; stripe <= 2; stripe++) box(stripe % 2 ? 'awningWhite' : (i % 2 ? 'awning' : 'mint'), x + stripe * 1.7, 5.4, z, 1.7, 0.22, 7);
    for (let p = 0; p < 8; p++) shape('sphere', p % 2 ? 'saffron' : 'leafLight', x - 2.8 + (p % 4) * 1.8, 2.75, z - 0.9 + Math.floor(p / 4) * 1.7, 0.55, 0.55, 0.55);
  }

  // University garden and a sports ground create useful breaks in the skyline.
  box('grass', -180, 0.3, 180, 88, 0.2, 89);
  box('cream', -180, 10, 197, 72, 19, 30); collider(-180, 197, 73, 31);
  box('terracotta', -180, 20, 197, 76, 1.3, 34);
  box('white', -180, 13, 179.5, 18, 23, 6);
  for (let i = -4; i <= 4; i++) for (const y of [7, 14]) box('window', -180 + i * 7.3, y, 181.8, 4, 3.6, 0.12);
  sign(10, -180, 23, 176, 43, 4.6);
  box('sidewalk', -180, 0.5, 153, 12, 0.2, 39);
  for (const x of [-216, -199, -160, -143]) { tree(x, 143, true); bench(x, 159); }
  box('grass', 180, 0.3, -180, 89, 0.3, 89);
  box('terracotta', 180, 0.5, -180, 75, 0.2, 75);
  box('grass', 180, 0.65, -180, 63, 0.1, 62);
  box('cream', 180, 0.74, -180, 3, 0.1, 16);
  for (const x of [143, 217]) {
    for (let tier = 0; tier < 4; tier++) box(tier % 2 ? 'white' : 'blue', x + (x < 180 ? -tier : tier), 1 + tier * 1.4, -180, 2.2, 1.4, 70);
    collider(x, -180, 8, 70);
  }
  for (const x of [139, 221]) for (const z of [-221, -139]) {
    cylinder('metal', x, 12.5, z, 0.25, 25);
    box('white', x, 25, z, 6, 2.5, 0.8);
  }
  sign(11, 180, 5, -135, 49, 4.5);

  // A painted chowk leaves the central crossroads completely drivable.
  cylinder('terracotta', 0, 0.085, 0, 8.2, 0.035);
  cylinder('ochre', 0, 0.11, 0, 6.8, 0.025);
  cylinder('asphalt', 0, 0.135, 0, 5.7, 0.02);
  sign(12, 23, 6.2, 14, 22, 3.6);

  // Riverfront promenade and broad stepped ghats facing the Godavari.
  box('sidewalk', 0, 0.3, 295, 680, 0.6, 11);
  for (let i = 0; i < 7; i++) box(i % 2 ? 'sand' : 'cream', 0, 0.15 - i * 0.28, 301 + i * 2.2, 680, 0.45, 2.25);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(1600, 300, 1, 1), materials.water);
  water.rotation.x = -Math.PI / 2; water.position.set(0, -1.9, 455); water.receiveShadow = true; group.add(water);
  box('grass', 0, -0.25, 610, 1600, 3, 24);
  const rippleGroup = new THREE.Group(); group.add(rippleGroup);
  const ripples = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#c0d1b9', transparent: true, opacity: 0.25, depthWrite: false }), 80);
  for (let i = 0; i < 80; i++) {
    dummy.position.set(between(-580, 580), -1.86, between(320, 540));
    dummy.rotation.set(-Math.PI / 2, 0, 0); dummy.scale.set(between(3, 17), 0.13, 1); dummy.updateMatrix();
    ripples.setMatrixAt(i, dummy.matrix);
  }
  rippleGroup.add(ripples);
  sign(7, 27, 5, 291, 24, 4.5);
  for (let x = -310; x < 325; x += 32) {
    tree(x, 292, true);
    bench(x + 10, 292, Math.PI);
    lamp(x + 17, 291, -Math.PI / 2);
  }
  // Distant bridge and tree line are scenery, beyond the playable promenade.
  box('roof', -300, 5, 454, 17, 3, 292);
  for (let z = 330; z <= 580; z += 36) box('cream', -300, -0.5, z, 7, 10, 7);
  for (let z = 320; z < 595; z += 12) {
    box('white', -309, 7.2, z, 0.4, 2, 0.4);
    box('white', -291, 7.2, z, 0.4, 2, 0.4);
  }
  box('white', -309, 8, 454, 0.4, 0.4, 292); box('white', -291, 8, 454, 0.4, 0.4, 292);
  for (let x = -650; x < 650; x += 22) tree(x, 613 + between(-4, 6));

  // Utility poles, overhead cables, planted corners, and street furniture.
  const wirePositions = [];
  for (const x of WORLD.roadXs) {
    for (let z = -300; z <= 255; z += 60) {
      const px = x + 12.4;
      if (WORLD.roadZs.some(road => Math.abs(z - road) < 18)) continue;
      lamp(x - 12.7, z, 0);
      cylinder('trunk', px, 7.7, z, 0.19, 15.4);
      box('metal', px, 14.6, z, 3, 0.18, 0.18);
      if (z + 60 < 290) for (const offset of [-0.8, 0.8]) {
        for (let part = 0; part < 8; part++) {
          const t0 = part / 8, t1 = (part + 1) / 8;
          wirePositions.push(px + offset, 14.6 - Math.sin(t0 * Math.PI) * 1.3, z + t0 * 60, px + offset, 14.6 - Math.sin(t1 * Math.PI) * 1.3, z + t1 * 60);
        }
      }
    }
  }
  for (const x of WORLD.roadXs) for (const z of WORLD.roadZs) {
    if ((x === 120 && z === 120) || (x === -120 && z === 120)) continue;
    tree(x - 17, z - 18, random() > 0.7);
    box('blue', x + 15, 0.8, z - 18, 1, 1.5, 1);
  }
  const wireGeometry = new THREE.BufferGeometry();
  wireGeometry.setAttribute('position', new THREE.Float32BufferAttribute(wirePositions, 3));
  group.add(new THREE.LineSegments(wireGeometry, new THREE.LineBasicMaterial({ color: '#403e39', transparent: true, opacity: 0.6 })));

  // Material/primitive batching keeps the detailed city to a modest number of draw calls.
  for (const { geometry, material, matrices } of batches.values()) {
    const mesh = new THREE.InstancedMesh(geometries[geometry], materials[material], matrices.length);
    matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = !['sand', 'sidewalk', 'asphalt', 'lane', 'roadEdge', 'grass', 'water'].includes(material);
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  const signGeometry = new THREE.BufferGeometry();
  signGeometry.setAttribute('position', new THREE.Float32BufferAttribute(signPositions, 3));
  signGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(signUVs, 2));
  signGeometry.setIndex(signIndices); signGeometry.computeVertexNormals();
  const signs = new THREE.Mesh(signGeometry, new THREE.MeshStandardMaterial({ map: signTexture, roughness: 0.9, side: THREE.DoubleSide, emissive: '#fff0cf', emissiveIntensity: 0.08 }));
  group.add(signs);

  return {
    group, colliders, landmarks,
    roads: { xs: [...WORLD.roadXs], zs: [...WORLD.roadZs], width: WORLD.roadWidth },
    bounds: { ...WORLD.bounds },
    animate(_dt, elapsed) { rippleGroup.position.x = Math.sin(elapsed * 0.16) * 1.8; },
  };
}
