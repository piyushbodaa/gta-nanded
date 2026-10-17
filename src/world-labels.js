import * as THREE from 'three';

const CATEGORY_COLORS = {
  coaching: '#234c89', college: '#366455', school: '#366455', education: '#366455',
  hotel: '#69493b', restaurant: '#963f32', food: '#963f32', cafe: '#76543c',
  landmark: '#946a28', transport: '#245467', hospital: '#287b7c',
  civic: '#596575', junction: '#936534', market: '#b76036', shop: '#49695d', park: '#476b45',
  board: '#1e6b4a',
};

/** One shared atlas; signs are merged in spatial chunks for frustum culling. */
export function createCityLabels(places, group, chunkSize = 200) {
  const filler = [
    { name: 'चहा कट्टा', shortName: 'CHAI KATTA', area: 'चहा • नाश्ता', category: 'food' },
    { name: 'किराणा दुकान', shortName: 'KIRANA STORES', area: 'DAILY ESSENTIALS', category: 'shop' },
    { name: 'पुस्तके व स्टेशनरी', shortName: 'BOOKS & STATIONERY', area: 'NOTES • XEROX • PRINT', category: 'shop' },
    { name: 'मोबाइल दुरुस्ती', shortName: 'MOBILE REPAIRS', area: 'SALES & SERVICE', category: 'shop' },
    { name: 'रसवंती', shortName: 'RASVANTI', area: 'FRESH SUGARCANE JUICE', category: 'food' },
    { name: 'भोजनालय', shortName: 'BHOJANALAY', area: 'पोळी • भाजी • वरण भात', category: 'food' },
    { name: 'गॅरेज', shortName: 'MOTOR GARAGE', area: 'TYRES • SERVICE • REPAIRS', category: 'shop' },
    { name: 'बेकरी', shortName: 'BAKERY & SWEETS', area: 'FRESH EVERY DAY', category: 'food' },
    // Green PWD direction boards (indices 8+). Fictional signs pointing at
    // real parts of town; arrows are decorative, routes come from the GPS.
    { name: 'हजूर साहिब', shortName: 'HAZUR SAHIB →', area: 'जुने गाव • OLD CITY', category: 'board' },
    { name: 'रेल्वे स्थानक', shortName: 'RAILWAY STATION →', area: 'स्थानक रोड • STATION ROAD', category: 'board' },
    { name: 'विमानतळ', shortName: 'AIRPORT →', area: 'सांगवी • SANGVI', category: 'board' },
    { name: 'गोदावरी घाट', shortName: 'GODAVARI GHAT →', area: 'नदीकाठ • RIVERFRONT', category: 'board' },
    { name: 'वजिराबाद', shortName: 'VAZIRABAD →', area: 'महानगरपालिका • CIVIC CENTRE', category: 'board' },
    { name: 'सिडको', shortName: 'CIDCO →', area: 'नवीन वसाहत • NEW TOWNSHIP', category: 'board' },
    { name: 'विष्णुपुरी', shortName: 'VISHNUPURI →', area: 'विद्यापीठ • UNIVERSITY', category: 'board' },
    { name: 'देगलूर नाका', shortName: 'DEGLOOR NAKA →', area: 'देगलूर रोड • DEGLOOR ROAD', category: 'board' },
    { name: 'छत्रपती चौक', shortName: 'CHHATRAPATI CHOWK →', area: 'पूर्णा रोड • PURNA ROAD', category: 'board' },
    { name: 'श्री नगर', shortName: 'SHRI NAGAR →', area: 'तरोडा नाका रोड • TARODA NAKA ROAD', category: 'board' },
    { name: 'मोंढा', shortName: 'MONDHA MARKET →', area: 'धान्य बाजार • GRAIN MARKET', category: 'board' },
    // Coaching-lane results hoardings (after the boards): the flex banners
    // with topper photos that wallpaper Shyam Nagar every June. Fictional.
    { name: 'NEET निकाल', shortName: 'NEET RESULTS', area: 'AIR रँकर्स • अभिनंदन!', category: 'coaching' },
    { name: 'JEE निकाल', shortName: 'JEE ADVANCED', area: 'IIT सिलेक्शन • अभिनंदन!', category: 'coaching' },
    { name: 'प्रवेश सुरू', shortName: 'ADMISSIONS OPEN', area: 'NEET • JEE • CET • फाउंडेशन', category: 'coaching' },
    { name: 'बोर्ड निकाल', shortName: 'BOARD TOPPERS', area: '९०%+ गुण • अभिनंदन!', category: 'coaching' },
  ];
  const BOARD_COUNT = 11, HOARDING_START = 8 + BOARD_COUNT;
  const startingLane = { name: 'Your starting lane', shortName: 'आपली गल्ली', area: 'TARODA KHURD · NANDED', category: 'landmark' };
  const labels = [...places, ...filler, startingLane];
  const cols = 8, tileW = 512, tileH = 160, rows = Math.ceil(labels.length / cols);
  const canvas = document.createElement('canvas');
  canvas.width = cols * tileW; canvas.height = rows * tileH;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85, side: THREE.DoubleSide, emissive: '#fff2d2', emissiveIntensity: 0.14 });
  const chunks = new Map(), cameraOccluders = [];
  const indexById = new Map(places.map((p, index) => [p.id, index]));
  function fit(text, maxWidth, size) {
    ctx.font = `800 ${size}px "Noto Sans Devanagari", Arial, sans-serif`;
    while (ctx.measureText(text).width > maxWidth && size > 15) {
      size -= 1; ctx.font = `800 ${size}px "Noto Sans Devanagari", Arial, sans-serif`;
    }
  }
  function paint() {
    labels.forEach((p, index) => {
      const x = index % cols * tileW, y = Math.floor(index / cols) * tileH;
      let color = CATEGORY_COLORS[p.category] || '#496575';
      if (/\bIIB\b/i.test(p.name)) color = '#234da4';
      if (/\bRCC\b|Konale/i.test(p.name)) color = '#a02e32';
      if (/\bALLEN\b/i.test(p.name)) color = '#126839';
      ctx.fillStyle = color; ctx.fillRect(x, y, tileW, tileH);
      ctx.strokeStyle = '#ead6ad'; ctx.lineWidth = 3; ctx.strokeRect(x + 8, y + 8, tileW - 16, tileH - 16);
      ctx.fillStyle = '#fff5dd'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const title = p.id === 'zenda-chowk' ? 'झेंडा चौक' : /bhagya.*kaman/i.test(`${p.id || ''} ${p.name}`) ? 'भाग्यनगर' : p.shortName || p.name;
      fit(title, 470, 36); ctx.fillText(title, x + tileW / 2, y + 51);
      const second = p.name !== title ? p.name : (p.aliases?.find(v => /[\u0900-\u097f]/.test(v)) || p.area || 'NANDED');
      fit(second, 464, 24); ctx.fillText(second, x + tileW / 2, y + 94);
      fit((p.area || 'NANDED').toUpperCase(), 458, 17); ctx.fillStyle = '#e9d3a3'; ctx.fillText((p.area || 'NANDED').toUpperCase(), x + tileW / 2, y + 130);
    });
    texture.needsUpdate = true;
  }
  paint();
  // Canvas use alone does not trigger a webfont request. Explicitly load the
  // Devanagari face, then repaint the existing atlas rather than making textures.
  if (document.fonts?.load) document.fonts.load('800 36px "Noto Sans Devanagari"', 'नांदेड भाग्यनगर झेंडा चौक आपली गल्ली').then(() => document.fonts.ready).then(paint).catch(() => {});
  else if (document.fonts?.ready) document.fonts.ready.then(paint).catch(() => {});
  function sign(idOrIndex, x, y, z, width, height, rotation = 0) {
    const index = typeof idOrIndex === 'number' ? idOrIndex : indexById.get(idOrIndex);
    if (!Number.isInteger(index) || index < 0 || index >= labels.length ||
        ![x, y, z, width, height, rotation].every(Number.isFinite) || width <= 0 || height <= 0) return;
    // Raised signs obscure the camera but must not block traffic below them.
    cameraOccluders.push({ x, z, w: width, d: 0.12, minY: y - height / 2, h: y + height / 2, rotation });
    const key = `${Math.floor(x / chunkSize)},${Math.floor(z / chunkSize)}`;
    if (!chunks.has(key)) chunks.set(key, { positions: [], uvs: [], indices: [] });
    const b = chunks.get(key), start = b.positions.length / 3;
    const cos = Math.cos(rotation), sin = Math.sin(rotation);
    for (const [vx, vy] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) b.positions.push(x + vx * width * cos, y + vy * height, z - vx * width * sin);
    const u0 = ((index % cols) * tileW + 1) / canvas.width, u1 = u0 + (tileW - 2) / canvas.width;
    const v1 = 1 - (Math.floor(index / cols) * tileH + 1) / canvas.height, v0 = v1 - (tileH - 2) / canvas.height;
    b.uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
    b.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  return {
    sign,
    generic(index, ...args) { sign(places.length + index % filler.length, ...args); },
    board(index, ...args) { sign(places.length + 8 + index % BOARD_COUNT, ...args); },
    hoarding(index, ...args) { sign(places.length + HOARDING_START + index % (filler.length - HOARDING_START), ...args); },
    startingLane(...args) { sign(places.length + filler.length, ...args); },
    finish() {
      const meshes = [];
      for (const b of chunks.values()) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(b.positions, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(b.uvs, 2));
        geometry.setIndex(b.indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
        const mesh = new THREE.Mesh(geometry, material); mesh.name = 'City place signs'; group.add(mesh); meshes.push(mesh);
      }
      return { texture, meshes, cameraOccluders, signCount: [...chunks.values()].reduce((n, b) => n + b.positions.length / 12, 0), atlasCount: 1 };
    },
  };
}
