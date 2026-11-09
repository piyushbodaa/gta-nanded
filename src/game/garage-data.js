// Your own gaadi: what the Jugaad Garage sells, what the dealer lot asks, and the pure rules
// (tuning, armour, the save record) the garage builds on. No three.js here: tests run it bare.
import { VEHICLE_TYPES } from '../actors/vehicle-types.js';

/** What a car costs on the dealer lot, and what it is worth when sold back (40%). */
export const DEALER_PRICES = { scooter: 3000, bike: 4500, auto: 6000, hatch: 12000, tempo: 14000, tractor: 15000, sedan: 18000, suv: 28000 };

/** Cars the society lets you park: short enough for a bay, nothing sarkari. */
export const CLAIMABLE = Object.keys(VEHICLE_TYPES).filter(t => VEHICLE_TYPES[t].L <= 4.5 && t !== 'police' && t !== 'ambulance');
export const canClaim = type => CLAIMABLE.includes(type);

export const NEON = {
  saffron: { name: 'Saffron', color: 0xff8a1e },
  green: { name: 'Green', color: 0x2ee66b },
  blue: { name: 'Blue', color: 0x2f8bff },
  pink: { name: 'Pink', color: 0xff3fb4 },
  white: { name: 'White', color: 0xf4f7ff },
  purple: { name: 'Purple', color: 0x9b4dff },
};
export const NEON_IDS = Object.keys(NEON);

/** Rear sticker phrases: generic road-side wording, no brands, nothing religious. */
export const STICKERS = ['आईचा आशीर्वाद', 'HORN OK PLEASE', 'USE DIPPER AT NIGHT', 'नाद खुळा', 'एक नंबर', 'MH-26 RAJA'];

/** Pressure horns: ids match audio.js HORN_TUNES (C15). */
export const HORNS = { pom: { name: 'Pom-pom two-tone', price: 600 }, jingle: { name: 'Jingle', price: 800 }, truck: { name: 'Truck air horn', price: 900 }, tutari: { name: 'Tutari', price: 1200 } };
export const HORN_IDS = Object.keys(HORNS);

export const PAINTS = [0xd62f2f, 0xf2f2f2, 0x111111, 0x9aa3a8, 0x1f3a93, 0x2f8bff, 0x2e7d32, 0x7ed957, 0xf9a825, 0xff8a1e, 0x8e1b1b, 0x6a1b9a, 0xff3fb4, 0x00838f, 0x5d4037, 0xe8e2d0];

/** Levelled mods: level 0 is stock; `price[i]` buys level i + 1. */
export const MODS = {
  engine: { label: 'ENGINE', names: ['Tuned', 'Race map', 'Jugaad turbo'], price: [2500, 6000, 12000], accel: [1, 1.12, 1.25, 1.4], top: [1, 1.06, 1.12, 1.18] },
  brakes: { label: 'BRAKES', names: ['Sports', 'Racing'], price: [1500, 4000], brake: [1, 1.2, 1.4] },
  armour: { label: 'ARMOUR', names: ['Light', 'Heavy', 'Tank-jugaad'], price: [4000, 9000, 16000], dmg: [1, 0.75, 0.55, 0.4], mass: [1, 1.05, 1.1, 1.18] },
};
export const PRICES = { bpTyres: 5000, neon: 1500, sticker: 400, paint: 800, towFee: 100, impound: 300, wreckShare: 0.2, sellShare: 0.4 };
export const CATEGORIES = ['engine', 'brakes', 'armour', 'tyres', 'horn', 'neon', 'sticker', 'paint'];
export const MAX_CARS = 4;

export const emptyMods = () => ({ engine: 0, brakes: 0, armour: 0, bpTyres: false, horn: null, neon: null, sticker: null });

/** A new spec for this car: the type's numbers scaled by its mods. VEHICLE_TYPES is never changed. */
export function tunedSpec(base, mods = {}) {
  const e = clampInt(mods.engine, 0, 3), b = clampInt(mods.brakes, 0, 2), a = clampInt(mods.armour, 0, 3);
  return { ...base, accel: base.accel * MODS.engine.accel[e], top: base.top * MODS.engine.top[e], brake: base.brake * MODS.brakes.brake[b], mass: base.mass * MODS.armour.mass[a] };
}
export const damageK = (mods = {}) => MODS.armour.dmg[clampInt(mods?.armour, 0, 3)];

/** What the car is worth to the dealer: its price plus what was spent on it. */
export const valueOf = rec => (DEALER_PRICES[rec.type] || 5000) + (rec.spent || 0);

function clampInt(v, lo, hi) { v = Math.round(Number(v) || 0); return v < lo ? lo : v > hi ? hi : v; }

/** Clean a fleet out of a save: unknown types and junk dropped, levels clamped, ids unique, at most 4. */
export function sanitizeFleet(raw) {
  const out = { cars: [], next: 1 };
  if (!raw || !Array.isArray(raw.cars)) return out;
  const ids = new Set(), bays = new Set();
  let next = Math.max(1, clampInt(raw.next, 1, 1e6));
  for (const c of raw.cars) {
    if (out.cars.length >= MAX_CARS) break;
    if (!c || typeof c !== 'object' || !canClaim(c.type)) continue;
    let id = clampInt(c.id, 0, 1e6);
    if (!id || ids.has(id)) id = next;
    ids.add(id); next = Math.max(next, id + 1);
    const m = c.mods || {};
    let bay = clampInt(c.bay, 0, MAX_CARS - 1);
    if (bays.has(bay)) bay = [0, 1, 2, 3].find(b => !bays.has(b));
    bays.add(bay);
    out.cars.push({
      id, type: c.type, bay,
      color: Number.isFinite(c.color) ? c.color : VEHICLE_TYPES[c.type].colors[0],
      health: Math.min(1000, Math.max(300, Number(c.health) || 1000)),
      flat: clampInt(c.flat, 0, 255), locked: Boolean(c.locked), spent: clampInt(c.spent, 0, 1e7),
      mods: {
        engine: clampInt(m.engine, 0, 3), brakes: clampInt(m.brakes, 0, 2), armour: clampInt(m.armour, 0, 3), bpTyres: Boolean(m.bpTyres),
        horn: HORN_IDS.includes(m.horn) ? m.horn : null, neon: NEON_IDS.includes(m.neon) ? m.neon : null,
        sticker: Number.isInteger(m.sticker) && m.sticker >= 0 && m.sticker < STICKERS.length ? m.sticker : null,
      },
    });
  }
  out.next = next;
  return out;
}

/**
 * Parking bays near `at`: off the road, clear of buildings, apart from each other and from the
 * places in `avoid` ({x, z, r}). Deterministic (a golden-angle spiral, like story.dressWorld).
 * Each bay faces the nearest road, so the car pulls straight out.
 */
export function findBays(net, colliders, at, n = MAX_CARS, avoid = [], minR = 6) {
  const bays = [], tmp = {};
  for (let k = 0; k < 400 && bays.length < n; k++) {
    const a = k * 2.39996, r = minR + (k % 12) * 1.6 + Math.floor(k / 60) * 4;
    const x = at.x + Math.cos(a) * r, z = at.z + Math.sin(a) * r;
    const near = net.nearest(x, z, 40, tmp);
    if (!near) continue;
    const off = Math.hypot(near.x - x, near.z - z), half = (net.width?.[near.road] ?? 8) / 2;
    if (off < half + 2.6 || off > half + 9) continue; // beside the road, not on it, not far behind it
    if (net.onRoad?.(x, z, 2.4)) continue;
    if (colliders?.blocked?.(x, z, 2.5)) continue;
    if (bays.some(b => Math.hypot(b.x - x, b.z - z) < 4.2)) continue;
    if (avoid.some(p => Math.hypot(p.x - x, p.z - z) < (p.r ?? 10))) continue;
    bays.push({ x, z, heading: Math.atan2(near.x - x, near.z - z), i: bays.length });
  }
  return bays;
}
