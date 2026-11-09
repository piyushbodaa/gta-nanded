// Weapons: pure data, no three.js and no DOM, so the logic, the wheel, the HUD and the tests
// all read the same table. Real-world firearms with stats of our own; the shared calibres
// are what make picking up ammo matter (a box of 7.62 feeds both the AKM and the Kar98k).

/** Ammo types: id -> label shown in the HUD and pickups. */
export const AMMO = {
  '9mm': { name: '9mm', max: 300 },
  '45acp': { name: '.45 ACP', max: 250 },
  '556': { name: '5.56mm', max: 300 },
  '762': { name: '7.62mm', max: 300 },
  '12g': { name: '12 Gauge', max: 80 },
  '300mag': { name: '.300 Magnum', max: 40 },
  frag: { name: 'Frag grenade', max: 8 },
};

/** Wheel slots, clockwise from the top. Each slot holds one class of weapon; a slot with
 * more than one owned weapon cycles between them. */
export const SLOTS = [
  { id: 'melee', name: 'Melee' },
  { id: 'pistol', name: 'Pistol' },
  { id: 'smg', name: 'SMG' },
  { id: 'rifle', name: 'Assault rifle' },
  { id: 'shotgun', name: 'Shotgun' },
  { id: 'sniper', name: 'Sniper' },
  { id: 'throw', name: 'Throwable' },
];

/**
 * id -> weapon. Fields:
 *  name, short (≤6 chars for small buttons), slot (SLOTS id), hold ('none'|'melee'|'pistol'|'rifle'|'throw': the pose),
 *  ammo (AMMO id or null), mag (rounds per magazine; throwables use the ammo count directly),
 *  rpm (rounds a minute), auto (hold to keep firing), bolt (bolt action: a pause between shots),
 *  damage (per bullet / pellet at the muzzle, against 100 health), pellets, range (m; damage falls to 55% at range),
 *  spreadHip / spreadAim (radians of cone, half-angle), recoil (radians the view kicks up per shot),
 *  reload (s), scope (zoom factor when aiming, 0 = shoulder aim only), sound (audio sfx name),
 *  vehicle (multiplier on damage dealt to vehicles), start (ammo that comes with a found weapon).
 */
export const WEAPONS = {
  fist: { name: 'Fists', short: 'FIST', slot: 'melee', hold: 'none', ammo: null, mag: 0, rpm: 160, damage: 0, range: 1.5, sound: 'punch' },
  pan: { name: 'Frying Pan', short: 'PAN', slot: 'melee', hold: 'melee', ammo: null, mag: 0, rpm: 110, damage: 80, range: 1.9, sound: 'pan', vehicle: 0.2 },

  p92: { name: 'P92', short: 'P92', slot: 'pistol', hold: 'pistol', ammo: '9mm', mag: 15, rpm: 420, auto: false, damage: 30, range: 60,
    spreadHip: 0.03, spreadAim: 0.008, recoil: 0.018, reload: 1.7, scope: 0, sound: 'pistol', vehicle: 1, start: 30 },

  uzi: { name: 'Micro UZI', short: 'UZI', slot: 'smg', hold: 'pistol', ammo: '9mm', mag: 25, rpm: 720, auto: true, damage: 21, range: 45,
    spreadHip: 0.055, spreadAim: 0.03, recoil: 0.012, reload: 2.0, scope: 0, sound: 'smg', vehicle: 0.8, start: 50 },
  ump45: { name: 'UMP45', short: 'UMP', slot: 'smg', hold: 'rifle', ammo: '45acp', mag: 25, rpm: 620, auto: true, damage: 33, range: 70,
    spreadHip: 0.045, spreadAim: 0.016, recoil: 0.014, reload: 2.4, scope: 0, sound: 'smg', vehicle: 1, start: 50 },

  akm: { name: 'AKM', short: 'AKM', slot: 'rifle', hold: 'rifle', ammo: '762', mag: 30, rpm: 600, auto: true, damage: 47, range: 150,
    spreadHip: 0.05, spreadAim: 0.014, recoil: 0.03, reload: 2.6, scope: 0, sound: 'rifle', vehicle: 1.3, start: 60 },
  m416: { name: 'M416', short: 'M416', slot: 'rifle', hold: 'rifle', ammo: '556', mag: 30, rpm: 690, auto: true, damage: 41, range: 160,
    spreadHip: 0.042, spreadAim: 0.01, recoil: 0.02, reload: 2.3, scope: 0, sound: 'rifle', vehicle: 1.2, start: 60 },

  s12k: { name: 'S12K', short: 'S12K', slot: 'shotgun', hold: 'rifle', ammo: '12g', mag: 5, rpm: 240, auto: false, damage: 22, pellets: 8, range: 32,
    spreadHip: 0.11, spreadAim: 0.08, recoil: 0.06, reload: 3.0, scope: 0, sound: 'shotgun', vehicle: 1, start: 15 },

  kar98k: { name: 'Kar98k', short: 'KAR98', slot: 'sniper', hold: 'rifle', ammo: '762', mag: 5, rpm: 48, auto: false, bolt: true, damage: 85, range: 400,
    spreadHip: 0.07, spreadAim: 0, recoil: 0.07, reload: 3.6, scope: 4, sound: 'sniper', vehicle: 2, start: 15 },
  awm: { name: 'AWM', short: 'AWM', slot: 'sniper', hold: 'rifle', ammo: '300mag', mag: 5, rpm: 40, auto: false, bolt: true, damage: 120, range: 520,
    spreadHip: 0.08, spreadAim: 0, recoil: 0.09, reload: 4.0, scope: 8, sound: 'sniper', vehicle: 3, start: 10 },

  grenade: { name: 'Frag Grenade', short: 'FRAG', slot: 'throw', hold: 'throw', ammo: 'frag', mag: 0, rpm: 50, damage: 150, range: 25,
    fuse: 3.5, blast: 7, sound: 'throw', start: 2 },
};

/** Order of weapons inside the wheel and for next/previous cycling. */
export const ORDER = ['fist', 'pan', 'p92', 'uzi', 'ump45', 'akm', 'm416', 's12k', 'kar98k', 'awm', 'grenade'];

/** What a found crate can hold, by rarity (weights). The AWM only ever comes from an air drop. */
export const LOOT_TABLE = [
  { id: 'p92', w: 20 }, { id: 'uzi', w: 12 }, { id: 'ump45', w: 11 }, { id: 'akm', w: 11 }, { id: 'm416', w: 10 },
  { id: 's12k', w: 9 }, { id: 'kar98k', w: 6 }, { id: 'pan', w: 6 }, { id: 'grenade', w: 8 },
  { ammo: '9mm', n: 45, w: 10 }, { ammo: '762', n: 40, w: 8 }, { ammo: '556', n: 40, w: 8 }, { ammo: '45acp', n: 40, w: 6 }, { ammo: '12g', n: 12, w: 5 },
];
export const AIRDROP_TABLE = [{ id: 'awm', w: 5 }, { id: 'm416', w: 3 }, { id: 'akm', w: 2 }];

/** Health: ordinary people 100, police 130, story bosses get their hits from the mission. Headshots multiply. */
export const HEADSHOT = 2.3;
export const PED_HEALTH = 100;
export const COP_HEALTH = 130;

/** Places of worship where guns stay holstered (place ids from world.json, radius in m). */
export const NO_FIRE = {
  'hazur-sahib': 120, 'nagina-ghat': 60, 'langar-sahib': 60, 'sangat-sahib': 60, 'mata-sahib': 60, 'hira-ghat': 60,
  'shikar-ghat': 60, 'banda-ghat': 60, 'mal-tekdi': 70, 'kaleshwar-temple': 60, 'ram-ghat': 40, 'govardhan-ghat': 40, 'urvashi-ghat': 40,
};

/** Seconds between shots. */
export const interval = w => 60 / w.rpm;
/** Damage at distance d: full to a third of the range, falling to 55% at the range. */
export const falloff = (w, d) => w.damage * (d <= w.range / 3 ? 1 : Math.max(0.55, 1 - 0.45 * (d - w.range / 3) / (w.range * 2 / 3)));
