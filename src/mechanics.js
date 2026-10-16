import { PLACE_BY_ID } from './city-data.js';

export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));

export function blocked(x, z, radius, colliders, bounds) {
  if (x < bounds.minX + radius || x > bounds.maxX - radius || z < bounds.minZ + radius || z > bounds.maxZ - radius) return true;
  return (colliders.query?.(x,z,radius) || colliders).some(b => {
    const cos=Math.cos(b.rotation||0),sin=Math.sin(b.rotation||0);
    const lx=cos*(x-b.x)-sin*(z-b.z),lz=sin*(x-b.x)+cos*(z-b.z);
    const px = clamp(lx, -b.w / 2, b.w / 2);
    const pz = clamp(lz, -b.d / 2, b.d / 2);
    return (lx - px) ** 2 + (lz - pz) ** 2 < radius ** 2;
  });
}

// Substeps prevent tunnelling through buildings at high speed or low frame rates.
export function moveBody(body, dx, dz, radius, colliders, bounds) {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / Math.max(radius * 0.6, 0.3)));
  let hit = false;
  for (let i = 0; i < steps; i++) {
    if (!blocked(body.x + dx / steps, body.z, radius, colliders, bounds)) body.x += dx / steps;
    else hit = true;
    if (!blocked(body.x, body.z + dz / steps, radius, colliders, bounds)) body.z += dz / steps;
    else hit = true;
  }
  return hit;
}

export const VEHICLES = {
  hatchback: { name: 'Deccan Sprint', maxSpeed: 38, acceleration: 17, handling: 1.95, radius: 1.5 },
  auto: { name: 'Nanded Auto', maxSpeed: 24, acceleration: 12, handling: 2.5, radius: 1.15 },
  sedan: { name: 'Ambassador Classic', maxSpeed: 32, acceleration: 13, handling: 1.7, radius: 1.6 },
  police: { name: 'Patrol SUV', maxSpeed: 35, acceleration: 16, handling: 1.8, radius: 1.6 },
};

export function driveStep(car, input, dt) {
  const specs = VEHICLES[car.kind];
  const boosting = input.boost && input.up && car.nitro > 1 && car.speed > 8;
  const limit = specs.maxSpeed * (boosting ? 1.5 : 1);
  const gas = (input.up ? 1 : 0) - (input.down ? 1 : 0);
  if (gas) car.speed += gas * specs.acceleration * dt * (gas * car.speed < 0 ? 2.8 : boosting ? 1.8 : 1);
  else car.speed *= Math.exp(-0.55 * dt);
  if (input.brake) car.speed *= Math.exp(-3.8 * dt);
  car.speed = clamp(car.speed, -specs.maxSpeed * 0.36, limit);
  if (!gas && Math.abs(car.speed) < 0.12) car.speed = 0;
  const steer = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  car.heading += steer * specs.handling * Math.min(Math.abs(car.speed) / 9, 1) * Math.sign(car.speed) * dt * (input.brake ? 1.7 : 1);
  car.nitro = clamp(car.nitro + (boosting ? -25 : 9) * dt, 0, 100);
  return { dx: -Math.sin(car.heading) * car.speed * dt, dz: -Math.cos(car.heading) * car.speed * dt, boosting };
}

function stop(id,label){const place=PLACE_BY_ID.get(id);if(!place)throw Error(`Unknown mission place: ${id}`);return {...place.approach,label:label||place.shortName,placeId:id};}

export const MISSIONS = [
  { title:'Before the next batch',label:'01 / COACHING BELT',description:'Pick up your friend outside RCC, then head to IIB Parnakuti. Slow down in each amber ring.',reward:450,seconds:180,
    stops:[stop('rcc-nanded','Meet outside RCC'),stop('iib-parnakuti','Drop off at IIB Parnakuti')] },
  { title:'The station parcel',label:'02 / AUTO DIARIES',description:'A parcel from Sarafa has to reach the railway station. Find your way through the old city.',reward:650,seconds:150,
    stops:[stop('sarafa-bazar','Collect at Sarafa Bazar'),stop('nanded-station','Deliver at Hazur Sahib Nanded station')] },
  { title:'Nanded circle',label:'03 / STREET CIRCUIT',description:'Bhagya Nagar, Workshop, ITI and Shivaji Putla. Five familiar checkpoints; keep an eye on the traffic.',reward:1200,seconds:220,race:true,
    stops:[stop('bhagya-nagar-kaman'),stop('workshop-corner'),stop('iti-corner'),stop('shivaji-putla'),stop('bhagya-nagar-kaman','Finish at Bhagya Nagar Kaman')] },
  { title:'Lose the tail',label:'04 / THE GETAWAY',description:'A fictional arcade chase. Keep moving for 50 seconds and stay out of the patrol’s reach.',reward:1500,seconds:80,chase:true,survive:50,stops:[] },
  { title:'Vishnupuri express',label:'05 / CAMPUS CONNECTION',description:'Meet at Yeshwant, collect a friend near SGGS, and finish at SRTM University. It is a proper cross-city run.',reward:1400,seconds:360,
    stops:[stop('yeshwant-college'),stop('sggs-engineering'),stop('srtm-university')] },
  { title:'The evening food plan',label:'06 / FRIENDS & FOOD',description:'Meet your friends near Madhur Bhoj, Amrut Cafe and Frespresso. The next stop is always somebody’s idea.',reward:850,seconds:240,
    stops:[stop('madhur-bhoj'),stop('amrut-cafe'),stop('frespresso')] },
  { title:'Welcome to Nanded',label:'07 / STATION PICKUP',description:'Welcome a visitor at the station, drive to Hazur Sahib, and finish near Nagina Ghat.',reward:900,seconds:240,
    stops:[stop('nanded-station'),stop('hazur-sahib'),stop('nagina-ghat')] },
  { title:'Along the Godavari',label:'08 / RIVERSIDE JOURNEY',description:'Take the eastern road to Hira Ghat, Mata Sahib and Shikar Ghat. Use the city guide to explore more after the job.',reward:1800,seconds:480,
    stops:[stop('hira-ghat'),stop('mata-sahib'),stop('shikar-ghat')] },
  { title:'Airport auto',label:'09 / ARRIVALS',description:'A visitor is waiting near the airport approach. Take them to Grand Tulsi in the coaching district.',reward:800,seconds:240,
    stops:[stop('nanded-airport'),stop('tulsi-comfort')] },
  { title:'After the show',label:'10 / SOUTH OF THE RIVER',description:'Meet outside the Treasure Bazaar cinema complex, then drive to Aakruti in Kautha.',reward:950,seconds:240,
    stops:[stop('pvr-treasure'),stop('aakruti-hotel')] },
  { title:'Something sweet',label:'11 / MONDHA TO VAZIRABAD',description:'Pick up your friends near Prasad Sweet House and Khandelwal Sweets, then meet by the bus stand.',reward:750,seconds:240,
    stops:[stop('prasad-sweet-house'),stop('khandelwal-sweets'),stop('nanded-bus-stand')] },
  { title:'College reunion',label:'12 / OLD FRIENDS',description:'MGM, Science College and ITM. Three campuses, one reunion, and a lot of familiar roads.',reward:1100,seconds:300,
    stops:[stop('mgm-engineering'),stop('nes-science-college'),stop('itm-nanded')] },
];

export function newMission(index = 0) {
  return { index: ((index % MISSIONS.length) + MISSIONS.length) % MISSIONS.length, stage: 0, elapsed: 0, dwell: 0, status: 'active' };
}

export function advanceMission(mission, position, speed, inVehicle, dt) {
  if (mission.status !== 'active') return null;
  const def = MISSIONS[mission.index];
  mission.elapsed += dt;
  if (mission.elapsed > def.seconds) { mission.status = 'failed'; return 'failed'; }
  if (def.chase) {
    if (mission.elapsed >= def.survive) { mission.status = 'complete'; return 'complete'; }
    return null;
  }
  const stop = def.stops[mission.stage];
  if (inVehicle && distance(position, stop) < (def.race ? 15 : 13) && (def.race || Math.abs(speed) < 10)) {
    mission.dwell += dt;
    if (mission.dwell >= (def.race ? 0 : 0.4)) {
      mission.stage++;
      mission.dwell = 0;
      if (mission.stage >= def.stops.length) { mission.status = 'complete'; return 'complete'; }
      return 'checkpoint';
    }
  } else mission.dwell = 0;
  return null;
}

export function loadProgress(storage) {
  try {
    const data = JSON.parse(storage.getItem('nanded-stories-v1'));
    if (!data || typeof data !== 'object') return {cash:0, completed:0};
    return {
      cash: Number.isFinite(data.cash) ? clamp(Math.floor(data.cash), 0, 99999999) : 0,
      completed: Number.isFinite(data.completed) ? clamp(Math.floor(data.completed), 0, 100000) : 0,
    };
  } catch { return {cash:0, completed:0}; }
}

export function saveProgress(storage, progress) {
  try { storage.setItem('nanded-stories-v1', JSON.stringify(progress)); return true; } catch { return false; }
}
