export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));

export function blocked(x, z, radius, colliders, bounds) {
  if (x < bounds.minX + radius || x > bounds.maxX - radius || z < bounds.minZ + radius || z > bounds.maxZ - radius) return true;
  return colliders.some(b => {
    const px = clamp(x, b.x - b.w / 2, b.x + b.w / 2);
    const pz = clamp(z, b.z - b.d / 2, b.z + b.d / 2);
    return (x - px) ** 2 + (z - pz) ** 2 < radius ** 2;
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

export const MISSIONS = [
  { title: 'Your first fare', label: '01 / AUTO DIARIES', description: 'Pick up a passenger at Vazirabad. Follow the amber marker and slow down inside the ring.', reward: 450, seconds: 180,
    stops: [{x:-120,z:120,label:'Pick up at Vazirabad'}, {x:120,z:180,label:'Drop off near Hazur Sahib'}] },
  { title: 'The market run', label: '02 / SPECIAL DELIVERY', description: 'Collect a parcel from the market, then take it to the railway station before the train leaves.', reward: 650, seconds: 150,
    stops: [{x:-120,z:-50,label:'Collect the market parcel'}, {x:-180,z:-240,label:'Deliver at the railway station'}] },
  { title: 'Godavari Grand Prix', label: '03 / STREET CIRCUIT', description: 'Five checkpoints. One riverfront circuit. Pick a fast car and keep your foot down.', reward: 1200, seconds: 100, race: true,
    stops: [{x:0,z:240,label:'Riverfront start'}, {x:240,z:240,label:'East riverfront'}, {x:240,z:0,label:'East city turn'}, {x:0,z:0,label:'Shivaji Chowk'}, {x:0,z:240,label:'Finish at the riverfront'}] },
  { title: 'Lose the tail', label: '04 / THE GETAWAY', description: 'Patrols are on your trail. Keep moving for 50 seconds and stay out of their reach.', reward: 1500, seconds: 80, chase: true, survive: 50, stops: [] },
  { title: 'Across the city', label: '05 / LAST MILE', description: 'A long run across Nanded. Pick up the order, cross town, and finish by the Godavari.', reward: 900, seconds: 180,
    stops: [{x:240,z:-240,label:'Collect the north-side order'}, {x:-240,z:0,label:'Stop in the old city'}, {x:0,z:270,label:'Deliver at Godavari Ghat'}] },
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
