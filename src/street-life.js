import * as THREE from 'three';
import { createVehicle } from './vehicles.js';

/** Street life: roadside vendors, passing chatter, the day's light, weather and festival lanterns. */

export const VENDOR_MENU = [
  { item: 'Chai', mr: 'चहा', price: 20, line: 'गरम गरम चहा! एक नंबर.', lineEn: 'Hot chai, number one!' },
  { item: 'Vada-pav', mr: 'वडापाव', price: 25, line: 'वडापाव खाल्ला की नांदेड आठवतं!', lineEn: 'Eat vada-pav and you remember Nanded!' },
  { item: 'Pani-puri', mr: 'पाणीपुरी', price: 30, line: 'तिखट हवं का?', lineEn: 'Want it spicy?' },
  { item: 'Sugarcane juice', mr: 'उसाचा रस', price: 20, line: 'ताजा रस, बर्फ नको का?', lineEn: 'Fresh juice, no ice?' },
  { item: 'Jalebi', mr: 'जिलेबी', price: 30, line: 'गरम जिलेबी, घे की!', lineEn: 'Hot jalebi, go on, take one!' },
  { item: 'Mirchi bhajiya', mr: 'मिरची भजिये', price: 25, line: 'झणझणीत आहे, सावकाश!', lineEn: 'Proper fiery ones, careful!' },
  { item: 'Poha', mr: 'पोहे', price: 20, line: 'सकाळचा नाश्ता म्हणजे पोहे!', lineEn: 'Poha is the real breakfast!' },
  { item: 'Deccani biryani', mr: 'बिर्याणी', price: 60, line: 'दमकी बिर्याणी, मियाँ!', lineEn: 'Dum biryani, miya!' },
  { item: 'Falooda', mr: 'फालुदा', price: 40, line: 'थंडगार फालुदा, उन्हाळ्यात भारी!', lineEn: 'Ice-cold falooda, perfect in this heat!' },
  { item: 'Irani chai & Osmania biscuit', mr: 'इराणी चहा', price: 25, line: 'चाय-बिस्कुट, पुरानी आदत!', lineEn: 'Chai and biscuit, the old habit!' },
];

export const CHATTER = [
  { mr: 'काय राव, गर्दी किती!', en: 'Wow, what a crowd!' },
  { mr: 'गोदावरीकाठी संध्याकाळ मस्त असते', en: 'Evenings by the Godavari are lovely' },
  { mr: 'ए, जरा बाजूला हो रे!', en: 'Hey, move aside a bit!' },
  { mr: 'नांदेडचं पाणी लय भारी', en: 'Nanded water is the best' },
  { mr: 'चल रे, कॉलेजला उशीर होतोय', en: 'Come on, we are late for college' },
  { mr: 'अरे मियाँ, कायकू देर कर्रे?', en: 'Arre miya, why the delay?' },
  { mr: 'नको रे बाबा, आज लय ऊन हाय', en: 'No baba, it is far too sunny today' },
  { mr: 'हजूर साहिबला दर्शनाला जाऊया', en: 'Let us go for darshan at Hazur Sahib' },
  { mr: 'एसटी आली का रे देगलूरची?', en: 'Has the Degloor ST bus come?' },
  { mr: 'मोंढ्यात आज कांद्याचा भाव काय?', en: 'What is the onion rate at the Mondha today?' },
  { mr: 'कापसाला यंदा भाव बरा हाय म्हणतात', en: 'They say cotton has a good price this year' },
  { mr: 'वा रे, गोदावरीला पूर आला की बघ!', en: 'Wait till the Godavari floods!' },
];

const WEATHER = ['clear', 'haze', 'rain'];
const SKY = {
  day: { fog: '#ddb8a0', sun: 3.3, hemi: 2.7 },
  dusk: { fog: '#c98a6a', sun: 1.7, hemi: 1.8 },
  night: { fog: '#2b3150', sun: 0.4, hemi: 1.0 },
};
const pick = list => list[Math.floor(Math.random() * list.length)];

/** Local time of day from the device clock: a warm dusk and a dim, lantern-lit night. */
export function timeOfDay(date = new Date()) {
  const h = date.getHours() + date.getMinutes() / 60;
  if (h >= 19.5 || h < 5.5) return 'night';
  if ((h >= 17 && h < 19.5) || (h >= 5.5 && h < 7)) return 'dusk';
  return 'day';
}

/**
 * Nanded's seasons: the monsoon from June to September brings rain most days, October to
 * February is clear and cool, and March to May is hot and hazy.
 */
export function seasonalWeather(date = new Date(), random = Math.random) {
  const month = date.getMonth(); // 0 = January
  const monsoon = month >= 5 && month <= 8;
  const summer = month >= 2 && month <= 4;
  const roll = random();
  if (monsoon) return roll < 0.6 ? 'rain' : roll < 0.85 ? 'haze' : 'clear';
  if (summer) return roll < 0.5 ? 'haze' : 'clear';
  return roll < 0.1 ? 'haze' : 'clear';
}

/** Roadside stalls at food places, set out where the pavement is clear. */
/**
 * The rhythm of a Nanded day, from the device clock: school rush, market
 * morning, quiet afternoon, bazaar evening, night. Friday is the big
 * Mondha day; Sunday the city breathes slower.
 */
export function daypart(date = new Date()) {
  const hour = date.getHours(), day = date.getDay();
  const part = hour < 5 ? 'night' : hour < 7 ? 'dawn' : hour < 10 ? 'school-rush' : hour < 13 ? 'market-morning'
    : hour < 16 ? 'afternoon' : hour < 20 ? 'bazaar-evening' : hour < 23 ? 'night-market' : 'night';
  return {
    part,
    marketDay: day === 5,
    sunday: day === 0,
    schoolTime: part === 'school-rush' || (hour >= 13 && hour < 15),
    crowd: part === 'school-rush' || part === 'bazaar-evening' ? 1.3 : part === 'night' ? 0.55 : day === 0 ? 0.8 : 1,
    horns: part === 'school-rush' ? 0.6 : part === 'night' ? 2.2 : 1,
  };
}

/** Sample a polyline path at an arc-length distance. Returns point + heading. */
export function pathSampler(points) {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
  const total = lengths.at(-1) || 0;
  return {
    total,
    at(distance) {
      if (!total || points.length < 2) return { x: points[0]?.x || 0, z: points[0]?.z || 0, heading: 0 };
      const d = Math.max(0, Math.min(distance, total));
      let i = 1;
      while (i < lengths.length - 1 && lengths[i] < d) i++;
      const seg = lengths[i] - lengths[i - 1] || 1, t = (d - lengths[i - 1]) / seg;
      const a = points[i - 1], b = points[i];
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, heading: Math.atan2(-(b.x - a.x), -(b.z - a.z)) };
    },
  };
}

/**
 * A train that actually runs: loco and five coaches along the longest mapped
 * rail line, pausing at the station, sounding its horn near the player.
 */
export function createTrain(scene, rails = [], { station = null, onHorn = () => {} } = {}) {
  const line = rails.reduce((best, r) => (r?.length > (best?.length || 0) ? r : best), null);
  const group = new THREE.Group(); group.name = 'Running train'; scene.add(group);
  if (!line || line.length < 2) return { update() {} };
  const sampler = pathSampler(line);
  const mats = {
    loco: new THREE.MeshStandardMaterial({ color: '#b23a2e', roughness: 0.5 }),
    cream: new THREE.MeshStandardMaterial({ color: '#f0e6cf', roughness: 0.6 }),
    coach: new THREE.MeshStandardMaterial({ color: '#33569c', roughness: 0.55 }),
    dark: new THREE.MeshStandardMaterial({ color: '#26303a', roughness: 0.8 }),
  };
  function carriage(material, band) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, 11), material); body.position.y = 1.9; body.castShadow = true; g.add(body);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.3, 11.1), mats.cream); roof.position.y = 3.35; g.add(roof);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.66, 0.7, 10.4), band); stripe.position.y = 2.35; g.add(stripe);
    const bogie = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 9.5), mats.dark); bogie.position.y = 0.45; g.add(bogie);
    group.add(g);
    return g;
  }
  const SPACING = 12.2, SPEED = 19;
  const makeConsist = () => [carriage(mats.loco, mats.cream), ...Array.from({ length: 5 }, () => carriage(mats.coach, mats.dark))];
  // Two consists in opposite directions, so a train passes every few minutes.
  const consists = [
    { units: makeConsist(), head: SPACING * 6, direction: 1, dwell: 0, horned: false },
    { units: makeConsist(), head: 0, direction: -1, dwell: 0, horned: false },
  ];
  const stationAt = station ? (() => {
    let best = null, bestD = Infinity;
    for (let d = 0; d <= sampler.total; d += 8) { const pt = sampler.at(d), dist = Math.hypot(pt.x - station.x, pt.z - station.z); if (dist < bestD) { bestD = dist; best = d; } }
    return bestD < 60 ? best : null;
  })() : null;
  if (consists[1]) consists[1].head = Math.max(SPACING * 6, sampler.total - SPACING * 6);
  return {
    positions() { return consists.map(c => ({ x: Math.round(c.units[0].position.x), z: Math.round(c.units[0].position.z), direction: c.direction })); },
    update(dt, player) {
      for (const train of consists) {
        if (train.dwell > 0) train.dwell -= dt;
        else {
          const before = train.head;
          train.head += train.direction * SPEED * dt;
          if (stationAt !== null && (before - stationAt) * (train.head - stationAt) <= 0 && before !== train.head) { train.head = stationAt; train.dwell = 7; }
          if (train.head >= sampler.total) { train.head = sampler.total; train.direction = -1; train.dwell = 4; }
          if (train.head <= SPACING * (train.units.length - 1)) { train.head = SPACING * (train.units.length - 1); train.direction = 1; train.dwell = 4; }
          if (train.dwell > 0) train.horned = false;
        }
        train.units.forEach((unit, i) => {
          const q = sampler.at(train.head - train.direction * i * SPACING);
          unit.position.set(q.x, 0.15, q.z);
          unit.rotation.y = train.direction > 0 ? q.heading : q.heading + Math.PI;
        });
        if (player && !train.horned && train.dwell <= 0) {
          const front = train.units[0].position;
          if (Math.hypot(front.x - player.x, front.z - player.z) < 170) { train.horned = true; onHorn(); }
        }
      }
    },
  };
}

export function createVendors(scene, places, isBlocked) {
  const vendors = [];
  places.slice(0, 16).forEach((place, i) => {
    const offsets = [[3, 1], [-3, 1], [3, -1], [-3, -1]];
    for (const [dx, dz] of offsets) {
      const x = place.approach.x + dx, z = place.approach.z + dz;
      if (isBlocked(x, z)) continue;
      const mesh = createVehicle('cart', ['#d9573b', '#2f8f7a', '#e0a526'][i % 3]);
      mesh.position.set(x, 0, z);scene.add(mesh);
      const menu = VENDOR_MENU[i % VENDOR_MENU.length];
      vendors.push({ x, z, mesh, ...menu, name: place.shortName });
      break;
    }
  });
  return vendors;
}

/** One signal cycle: green, amber, red — 14 s around, offset per approach. */
export function signalState(elapsed, offset = 0) {
  const t = ((elapsed + offset) % 14 + 14) % 14;
  return t < 6 ? 'green' : t < 7.5 ? 'amber' : 'red';
}

/**
 * Traffic signals at the big chowks. Two heads per junction run opposite
 * phases; every bulb in the city is one instanced draw, recoloured only
 * when a phase actually flips. Traffic already eases into junctions, so
 * the lights agree with how the cars behave.
 */
export function createTrafficSignals(scene, spots = []) {
  const group = new THREE.Group(); group.name = 'Traffic signals'; scene.add(group);
  const dummy = new THREE.Object3D();
  const poleMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.11, 4.6, 6), new THREE.MeshStandardMaterial({ color: '#3a4143', roughness: 0.7 }), Math.max(1, spots.length * 2));
  const headMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 1.05, 0.3), new THREE.MeshStandardMaterial({ color: '#22282a', roughness: 0.8 }), Math.max(1, spots.length * 2));
  const bulbMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff' }), Math.max(1, spots.length * 6));
  const heads = [];
  spots.forEach((spot, i) => {
    for (const side of [-1, 1]) {
      const rot = spot.rotation || 0;
      const lx = side * 6.2, lz = side * 6.2;
      const x = spot.x + lx * Math.cos(rot) + lz * Math.sin(rot);
      const z = spot.z - lx * Math.sin(rot) + lz * Math.cos(rot);
      const index = heads.length;
      dummy.rotation.set(0, rot, 0);
      dummy.position.set(x, 2.3, z); dummy.updateMatrix(); poleMesh.setMatrixAt(index, dummy.matrix);
      dummy.position.set(x, 4.9, z); dummy.updateMatrix(); headMesh.setMatrixAt(index, dummy.matrix);
      ['red', 'amber', 'green'].forEach((lamp, row) => {
        const bx = x + Math.sin(rot) * 0.17, bz = z + Math.cos(rot) * 0.17;
        dummy.position.set(bx, 5.22 - row * 0.32, bz); dummy.updateMatrix();
        bulbMesh.setMatrixAt(index * 3 + row, dummy.matrix);
      });
      heads.push({ offset: side < 0 ? 0 : 7, phase: null });
    }
  });
  for (const mesh of [poleMesh, headMesh, bulbMesh]) {
    mesh.count = mesh === bulbMesh ? heads.length * 3 : heads.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  const lit = { red: new THREE.Color('#ff3b2e'), amber: new THREE.Color('#ffb02e'), green: new THREE.Color('#2eff7a') };
  const dark = { red: new THREE.Color('#4a2320'), amber: new THREE.Color('#4a3a20'), green: new THREE.Color('#20402c') };
  const lamps = ['red', 'amber', 'green'];
  return {
    update(elapsed) {
      let changed = false;
      heads.forEach((head, index) => {
        const state = signalState(elapsed, head.offset);
        if (state === head.phase) return;
        head.phase = state; changed = true;
        lamps.forEach((lamp, row) => bulbMesh.setColorAt(index * 3 + row, lamp === state ? lit[lamp] : dark[lamp]));
      });
      if (changed && bulbMesh.instanceColor) bulbMesh.instanceColor.needsUpdate = true;
    },
  };
}

/**
 * Atmosphere, weather and ambient timers. `callbacks` receives onChatter(line), onHorn(), onBell();
 * the caller decides when a toast or a sound is appropriate.
 */
export const PHASES = ['day', 'dusk', 'night'];

export function createStreetLife(scene, { sun, hemi, lanternSpots = [], callbacks = {}, startWeather = 'clear' }) {
  let weather = startWeather;
  // The sky follows the device clock until the player overrides it (L key),
  // so a night-time player is not stuck in the dark forever.
  let phaseOverride = null;
  let chatterIn = 8, hornIn = 20, bellIn = 6, hornScale = 1;
  const fogTarget = new THREE.Color(), lerpFog = new THREE.Color();

  // Festival lanterns: warm bulbs strung at the ghats and temples, lit at dusk and night.
  const lanterns = new THREE.Group();
  const bulb = new THREE.MeshBasicMaterial({ color: '#ffc35a' });
  for (const spot of lanternSpots) {
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * Math.PI * 2;
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), bulb);
      orb.position.set(spot.x + Math.cos(a) * 3.2, 3.6 + (i % 2) * 0.6, spot.z + Math.sin(a) * 3.2);
      lanterns.add(orb);
    }
  }
  scene.add(lanterns);
  // Aarti diyas: little flames floating at the waterline near the shrine
  // approaches, lit with the lanterns at dusk. Deterministic scatter.
  const diyas = new THREE.Group(); diyas.name = 'Aarti diyas';
  {
    const diyaGeo = new THREE.SphereGeometry(0.16, 6, 5);
    const diyaMat = new THREE.MeshBasicMaterial({ color: '#ffb347' });
    lanternSpots.forEach((spot, si) => {
      for (let k = 0; k < 5; k++) {
        const angle = ((si * 37 + k * 71) % 360) * Math.PI / 180, radius = 5 + ((si * 13 + k * 29) % 6);
        const flame = new THREE.Mesh(diyaGeo, diyaMat);
        flame.position.set(spot.x + Math.sin(angle) * radius, 0.3, spot.z + Math.cos(angle) * radius);
        flame.scale.y = 1.5;
        diyas.add(flame);
      }
    });
  }
  scene.add(diyas);

  // Rain: short streaks that follow the player and fall continuously.
  const COUNT = 500, HEIGHT = 26;
  const rainPositions = new Float32Array(COUNT * 6), rainY = new Float32Array(COUNT), rainSpeed = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    rainY[i] = Math.random() * HEIGHT; rainSpeed[i] = 22 + Math.random() * 8;
    rainPositions[i * 6] = (Math.random() - 0.5) * 80; rainPositions[i * 6 + 2] = (Math.random() - 0.5) * 80;
    rainPositions[i * 6 + 3] = rainPositions[i * 6]; rainPositions[i * 6 + 5] = rainPositions[i * 6 + 2];
  }
  const rainGeometry = new THREE.BufferGeometry();
  rainGeometry.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
  const rain = new THREE.LineSegments(rainGeometry, new THREE.LineBasicMaterial({ color: '#bcd3dc', transparent: true, opacity: 0.45 }));
  rain.frustumCulled = false;rain.visible = false;scene.add(rain);

  // Summer dust: fine Deccan dust drifting through the hazy afternoons.
  const DUST = 220;
  const dustPositions = new Float32Array(DUST * 3), dustSeed = new Float32Array(DUST);
  for (let i = 0; i < DUST; i++) {
    dustPositions[i * 3] = (Math.random() - 0.5) * 90;
    dustPositions[i * 3 + 1] = 0.4 + Math.random() * 5;
    dustPositions[i * 3 + 2] = (Math.random() - 0.5) * 90;
    dustSeed[i] = 0.6 + Math.random() * 1.4;
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: '#d8c49a', size: 0.32, transparent: true, opacity: 0.35, sizeAttenuation: true, depthWrite: false }));
  dust.frustumCulled = false; dust.visible = false; scene.add(dust);

  function updateDust(dt, center) {
    dust.visible = weather === 'haze';
    if (!dust.visible) return;
    dust.position.set(center.x, 0, center.z);
    for (let i = 0; i < DUST; i++) {
      dustPositions[i * 3] += dt * 2.2 * dustSeed[i];
      dustPositions[i * 3 + 2] += dt * 0.7 * dustSeed[i];
      if (dustPositions[i * 3] > 45) dustPositions[i * 3] -= 90;
      if (dustPositions[i * 3 + 2] > 45) dustPositions[i * 3 + 2] -= 90;
    }
    dustGeometry.attributes.position.needsUpdate = true;
  }

  function applyWeather(dt) {
    const phase = phaseOverride || timeOfDay();
    const base = SKY[phase];
    fogTarget.set(base.fog);
    if (weather === 'rain') fogTarget.lerp(lerpFog.set('#7d8b95'), 0.7);
    if (weather === 'haze') fogTarget.lerp(lerpFog.set('#e9d6bd'), 0.45);
    const k = Math.min(1, dt * 1.5);
    scene.fog.color.lerp(fogTarget, k);
    scene.background.copy(scene.fog.color);
    const dimming = weather === 'rain' ? 0.45 : weather === 'haze' ? 0.85 : 1;
    sun.intensity = THREE.MathUtils.lerp(sun.intensity, base.sun * dimming, k);
    hemi.intensity = THREE.MathUtils.lerp(hemi.intensity, base.hemi * (weather === 'rain' ? 0.85 : 1), k);
    lanterns.visible = phase !== 'day';
    diyas.visible = phase !== 'day';
  }

  function updateRain(dt, center) {
    rain.visible = weather === 'rain';
    if (!rain.visible) return;
    rain.position.set(center.x, 0, center.z);
    for (let i = 0; i < COUNT; i++) {
      rainY[i] -= rainSpeed[i] * dt;
      if (rainY[i] < 0) rainY[i] += HEIGHT;
      rainPositions[i * 6 + 1] = rainY[i] + 1.1;
      rainPositions[i * 6 + 4] = rainY[i];
    }
    rainGeometry.attributes.position.needsUpdate = true;
  }

  return {
    get weather() { return weather; },
    get phase() { return phaseOverride || timeOfDay(); },
    cycleWeather() { weather = WEATHER[(WEATHER.indexOf(weather) + 1) % WEATHER.length]; return weather; },
    setRhythm(rhythm) { hornScale = rhythm?.horns || 1; },
    setWeather(next) { if (WEATHER.includes(next)) weather = next; },
    cyclePhase() {
      const current = phaseOverride || timeOfDay();
      phaseOverride = PHASES[(PHASES.indexOf(current) + 1) % PHASES.length];
      return phaseOverride;
    },
    setPhase(next) { phaseOverride = PHASES.includes(next) ? next : null; },
    update(dt, { position, onFoot, speed, nearShrine, busy }) {
      applyWeather(dt);
      updateRain(dt, position);
      updateDust(dt, position);
      chatterIn -= dt;
      if (chatterIn <= 0) { chatterIn = 9 + Math.random() * 6; if (onFoot && !busy) callbacks.onChatter?.(pick(CHATTER)); }
      hornIn -= dt;
      if (hornIn <= 0) { hornIn = (18 + Math.random() * 25) * hornScale; if (!onFoot && Math.abs(speed) > 4) callbacks.onHorn?.(); }
      bellIn -= dt;
      if (!nearShrine) bellIn = Math.max(bellIn, 4);
      else if (bellIn <= 0) { bellIn = 14 + Math.random() * 6; callbacks.onBell?.(); }
    },
  };
}
