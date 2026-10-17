import * as THREE from 'three';
import { createVehicle } from './vehicles.js';

/** Street life: roadside vendors, passing chatter, the day's light, weather and festival lanterns. */

export const VENDOR_MENU = [
  { item: 'Chai', mr: 'चहा', price: 20, line: 'गरम गरम चहा! एक नंबर.', lineEn: 'Hot chai, number one!' },
  { item: 'Vada-pav', mr: 'वडापाव', price: 25, line: 'वडापाव खाल्ला की नांदेड आठवतं!', lineEn: 'Eat vada-pav and you remember Nanded!' },
  { item: 'Pani-puri', mr: 'पाणीपुरी', price: 30, line: 'तिखट हवं का?', lineEn: 'Want it spicy?' },
  { item: 'Sugarcane juice', mr: 'उसाचा रस', price: 20, line: 'ताजा रस, बर्फ नको का?', lineEn: 'Fresh juice, no ice?' },
  { item: 'Jalebi', mr: 'जिलेबी', price: 30, line: 'गरम जिलेबी, घे की!', lineEn: 'Hot jalebi, go on, take one!' },
];

export const CHATTER = [
  { mr: 'काय राव, गर्दी किती!', en: 'Wow, what a crowd!' },
  { mr: 'गोदावरीकाठी संध्याकाळ मस्त असते', en: 'Evenings by the Godavari are lovely' },
  { mr: 'ए, जरा बाजूला हो रे!', en: 'Hey, move aside a bit!' },
  { mr: 'नांदेडचं पाणी लय भारी', en: 'Nanded water is the best' },
  { mr: 'चल रे, कॉलेजला उशीर होतोय', en: 'Come on, we are late for college' },
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

/** Roadside stalls at food places, set out where the pavement is clear. */
export function createVendors(scene, places, isBlocked) {
  const vendors = [];
  places.slice(0, 8).forEach((place, i) => {
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

/**
 * Atmosphere, weather and ambient timers. `callbacks` receives onChatter(line), onHorn(), onBell();
 * the caller decides when a toast or a sound is appropriate.
 */
export function createStreetLife(scene, { sun, hemi, lanternSpots = [], callbacks = {} }) {
  let weather = 'clear';
  let chatterIn = 8, hornIn = 20, bellIn = 6;
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

  function applyWeather(dt) {
    const phase = timeOfDay();
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
    cycleWeather() { weather = WEATHER[(WEATHER.indexOf(weather) + 1) % WEATHER.length]; return weather; },
    setWeather(next) { if (WEATHER.includes(next)) weather = next; },
    update(dt, { position, onFoot, speed, nearShrine, busy }) {
      applyWeather(dt);
      updateRain(dt, position);
      chatterIn -= dt;
      if (chatterIn <= 0) { chatterIn = 9 + Math.random() * 6; if (onFoot && !busy) callbacks.onChatter?.(pick(CHATTER)); }
      hornIn -= dt;
      if (hornIn <= 0) { hornIn = 18 + Math.random() * 25; if (!onFoot && Math.abs(speed) > 4) callbacks.onHorn?.(); }
      bellIn -= dt;
      if (!nearShrine) bellIn = Math.max(bellIn, 4);
      else if (bellIn <= 0) { bellIn = 14 + Math.random() * 6; callbacks.onBell?.(); }
    },
  };
}
