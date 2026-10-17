import { PLACE_BY_ID, SPAWN } from './city-data.js';

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

// Optional analog input.throttle and input.steer (-1..1, a touch joystick) override the arrow keys.
export function driveStep(car, input, dt) {
  const specs = VEHICLES[car.kind];
  const boosting = input.boost && input.up && car.nitro > 1 && car.speed > 8;
  const limit = specs.maxSpeed * (boosting ? 1.5 : 1);
  const gas = Number.isFinite(input.throttle) ? clamp(input.throttle, -1, 1) : (input.up ? 1 : 0) - (input.down ? 1 : 0);
  // A partly pushed stick cruises at that share of top speed instead of flooring it.
  const cruising = gas > 0 && gas < 1 && car.speed > limit * gas;
  if (gas && !cruising) car.speed += gas * specs.acceleration * dt * (gas * car.speed < 0 ? 2.8 : boosting ? 1.8 : 1);
  else car.speed *= Math.exp(-0.55 * dt);
  if (input.brake) car.speed *= Math.exp(-3.8 * dt);
  car.speed = clamp(car.speed, -specs.maxSpeed * 0.36, limit);
  if (!gas && Math.abs(car.speed) < 0.12) car.speed = 0;
  const steer = Number.isFinite(input.steer) ? clamp(input.steer, -1, 1) : (input.left ? 1 : 0) - (input.right ? 1 : 0);
  car.heading += steer * specs.handling * Math.min(Math.abs(car.speed) / 9, 1) * Math.sign(car.speed) * dt * (input.brake ? 1.7 : 1);
  car.nitro = clamp(car.nitro + (boosting ? -25 : 9) * dt, 0, 100);
  return { dx: -Math.sin(car.heading) * car.speed * dt, dz: -Math.cos(car.heading) * car.speed * dt, boosting };
}

function stop(id,label,options={}){
  const place=PLACE_BY_ID.get(id);if(!place)throw Error(`Unknown mission place: ${id}`);
  return {...place.approach,label:label||place.shortName,placeId:id,mode:'foot',radius:10,...options};
}
// Nearby checkpoints follow existing OSM road vertices around the public spawn.
// They are fictional activity points in the lane, not additional named places.
const zendaCorner={x:-930.4,z:-1856.33},zendaPhoto={x:-945.75,z:-1859.47};
const zendaStart={...SPAWN,heading:Math.atan2(-(zendaCorner.x-SPAWN.x),-(zendaCorner.z-SPAWN.z))};
function lane(point,label,options={}){return {...point,placeId:'zenda-chowk',label,mode:'foot',radius:4,...options};}
// The circuit grid is an OSM road vertex 34 units behind the Kaman start line, facing it,
// so the first checkpoint is driven through rather than spawned on beside the arch.
const circuitGrid={x:-35.59,z:-1015.89},kamanLine=PLACE_BY_ID.get('bhagya-nagar-kaman')?.approach||circuitGrid;
const circuitStart={...circuitGrid,heading:Math.atan2(-(kamanLine.x-circuitGrid.x),-(kamanLine.z-circuitGrid.z))};
const photo=(id,label)=>stop(id,label,{action:'photo'});
const talk=(id,label,dialogue)=>stop(id,label,{action:'interact',dialogue});
const raceStop=(id,label)=>stop(id,label,{mode:'vehicle',radius:15});

export const MISSIONS = [
  { id:'zenda-homecoming',kind:'explore',title:'आपली गल्ली, आपला खेळ',label:'01 / ZENDA HOMECOMING',shortDescription:'Meet a friend, explore your lane and take your first photo.',
    description:'“अरे, परत आलास!” Start on foot at Zenda Chowk. Talk to your friend, walk around the corner, then take a photo of your Taroda lane. No rush.',reward:300,seconds:null,start:{...zendaStart},startMode:'foot',
    stops:[stop('zenda-chowk','Talk to your friend at Zenda Chowk',{action:'interact',radius:6,dialogue:'अरे, परत आलास! चल, आपली गल्ली फिरूया. Walk to the amber corner, then take a photo of our lane.'}),lane(zendaCorner,'Walk to the corner of your lane'),lane(zendaPhoto,'Take your first Zenda Chowk photo',{action:'photo',radius:6})] },
  { id:'taroda-sprint',kind:'sprint',title:'गल्लीचा चॅम्पियन',label:'02 / TARODA FOOT SPRINT',shortDescription:'Sprint through five nearby checkpoints on foot.',
    description:'“बघू, कोण आधी पोहोचतं!” Run through the amber rings and finish back at Zenda Chowk. Use Sprint for a burst of speed; this one is all on foot.',reward:650,seconds:35,sprint:true,start:{...zendaStart},startMode:'foot',
    stops:[lane(zendaCorner,'Sprint to the first corner'),lane({x:-958.09,z:-1856.01},'Follow the lane left'),lane({x:-965.9,z:-1825.05},'Round the next bend'),lane({x:-961.64,z:-1841.9},'Turn back through the lane'),lane(SPAWN,'Finish at Zenda Chowk')] },
  { id:'hazur-postcards',kind:'photo',title:'Hazur postcards',label:'03 / OLD CITY PHOTO WALK',shortDescription:'Photograph Hazur Sahib and the Nagina Ghat riverfront.',
    description:'Capture two familiar Nanded views from the public streets: Hazur Sahib and Nagina Ghat. Step out of your ride and press Photo at each marker.',reward:800,seconds:null,
    stops:[photo('hazur-sahib','Photograph Hazur Sahib from the public approach'),photo('nagina-ghat','Photograph the Nagina Ghat riverfront')] },
  { id:'godavari-frames',kind:'photo',title:'Godavari frames',label:'04 / RIVER & FORT',shortDescription:'Find the river view and the Nandgiri fort approach.',
    description:'“गोदावरीकाठी आपलं नांदेड!” Make two postcards: the view by Navghat Bridge and the Nandgiri Fort approach. Explore at your own pace; take each photo on foot.',reward:900,seconds:null,
    stops:[photo('navghat-bridge','Photograph the Godavari at Navghat Bridge'),photo('nandgiri-fort','Photograph the Nandgiri Fort approach')] },
  { id:'college-katta',kind:'social',title:'Back to the katta',label:'05 / COLLEGE MEMORIES',shortDescription:'Meet outside People’s College and photograph Science College.',
    description:'“आज पुन्हा कॉलेजच्या कट्ट्यावर!” Catch up at People’s College, then walk over for a Science College photo. A short stroll with no timer.',reward:500,seconds:null,
    stops:[talk('peoples-college','Meet outside People’s College','काय रे, किती दिवसांनी! Walk over to Science College and take a reunion photo.'),photo('nes-science-college','Take a Science College reunion photo')] },
  { id:'coaching-break',kind:'social',title:'Batch संपली, चहा झाला?',label:'06 / COACHING BREAK',shortDescription:'Catch up outside RCC, then find your friend by Frespresso.',
    description:'“आधी चहा, मग पुढचं बघू!” The batch is over. Talk outside RCC, then walk to Frespresso for the next bit of local gossip.',reward:500,seconds:null,
    stops:[talk('rcc-nanded','Talk outside RCC','आजची बॅच संपली! Meet us outside Frespresso; the next plan starts there.'),talk('frespresso','Catch up outside Frespresso','पेपर नंतर बघू, आधी मित्र! Good to see the gang again. Your next adventure is up to you.')] },
  { id:'visava-evening',kind:'explore',title:'Garden, मग जेवण',label:'07 / VISAVA EVENING',shortDescription:'Take a garden photo and meet outside Madhur Bhoj.',
    description:'One easy evening plan: photograph Visava Garden, then walk over to Madhur Bhoj. Look around, take your time and enjoy your city.',reward:550,seconds:null,
    stops:[photo('visava-garden','Photograph Visava Garden'),talk('madhur-bhoj','Meet outside Madhur Bhoj','भूक लागली ना? The garden photo is done. Time to catch up outside Madhur Bhoj.')] },
  { id:'nanded-street-circuit',kind:'race',title:'Nanded circle',label:'08 / STREET CIRCUIT',shortDescription:'Race through Bhagya Nagar, Workshop, ITI and Shivaji Putla.',
    description:'Five checkpoints, one lap. Take the wheel through Bhagya Nagar, Workshop, ITI and Shivaji Putla, then race back to the finish.',reward:1200,seconds:220,race:true,start:{...circuitStart},startMode:'vehicle',
    stops:[raceStop('bhagya-nagar-kaman'),raceStop('workshop-corner'),raceStop('iti-corner'),raceStop('shivaji-putla'),raceStop('bhagya-nagar-kaman','Finish at Bhagya Nagar Kaman')] },
  { id:'lose-the-tail',kind:'chase',title:'Lose the tail',label:'09 / THE GETAWAY',shortDescription:'A fictional arcade pursuit through the Nanded streets.',
    description:'Take the wheel, make your own route and stay ahead of the fictional patrol for 50 seconds. The city is your escape route.',reward:1500,seconds:80,chase:true,survive:50,start:{...SPAWN},startMode:'vehicle',stops:[] },
].map(def=>{
  const first=def.stops[0],place=first&&PLACE_BY_ID.get(first.placeId);
  return {startMode:'foot',...def,start:def.start||{x:first.x,z:first.z,heading:place?.rotation||0}};
});

export function newMission(index = 0) {
  return { index: ((index % MISSIONS.length) + MISSIONS.length) % MISSIONS.length, stage: 0, elapsed: 0, dwell: 0, status: 'active' };
}

export function advanceMission(mission, position, speed, inVehicle, dt, action = null) {
  if (mission.status !== 'active') return null;
  const def = MISSIONS[mission.index];
  const elapsed = Number.isFinite(dt) ? Math.max(0, dt) : 0;
  mission.elapsed += elapsed;
  if (Number.isFinite(def.seconds) && mission.elapsed > def.seconds) { mission.status = 'failed'; return 'failed'; }
  if (def.chase) {
    if (mission.elapsed >= def.survive) { mission.status = 'complete'; return 'complete'; }
    return null;
  }
  const stop = def.stops[mission.stage];
  if (!stop) return null;
  const correctMode=stop.mode==='any'||(stop.mode==='foot'?!inVehicle:inVehicle);
  const atStop=correctMode&&distance(position,stop)<=(stop.radius??(def.race?15:13))&&(!inVehicle||def.race||Math.abs(speed)<10);
  if (atStop) {
    // An explicit photo/talk press is an event, not a held input: it can complete
    // at dt=0 and never auto-completes from merely standing in the marker.
    if (stop.action && action!==stop.action) { mission.dwell=0; return null; }
    mission.dwell += elapsed;
    if (stop.action || mission.dwell >= (def.race||def.sprint ? 0 : 0.4)) {
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
