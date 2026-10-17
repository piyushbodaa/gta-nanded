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

// Speeds read as metres per second (the HUD shows km/h = units/s × 3.6), tuned for
// grounded city driving: a hatchback tops out near 100 km/h, an auto-rickshaw near 53.
export const VEHICLES = {
  hatchback: { name: 'Deccan Sprint', maxSpeed: 30, acceleration: 6.8, brake: 10, reverse: 7, wheelbase: 2.5, steerLock: 0.6, radius: 1.5 },
  auto: { name: 'Nanded Auto', maxSpeed: 16, acceleration: 3.9, brake: 7, reverse: 4, wheelbase: 1.9, steerLock: 0.7, radius: 1.15 },
  sedan: { name: 'Ambassador Classic', maxSpeed: 26, acceleration: 5, brake: 8.5, reverse: 6, wheelbase: 2.8, steerLock: 0.55, radius: 1.6 },
  police: { name: 'Patrol SUV', maxSpeed: 31, acceleration: 6.5, brake: 10, reverse: 7, wheelbase: 2.8, steerLock: 0.55, radius: 1.6 },
  bike: { name: 'Nanded Bike', maxSpeed: 24, acceleration: 7.6, brake: 12, reverse: 3, wheelbase: 1.3, steerLock: 0.9, radius: 0.8 },
  bus: { name: 'MSRTC Lal Pari · एसटी', maxSpeed: 19, acceleration: 3, brake: 6, reverse: 4, wheelbase: 4.6, steerLock: 0.4, radius: 1.9 },
  truck: { name: 'Deccan Highway Truck', maxSpeed: 21, acceleration: 2.8, brake: 6.5, reverse: 4, wheelbase: 5.2, steerLock: 0.38, radius: 2.1 },
  tractor: { name: 'Farm Tractor', maxSpeed: 11, acceleration: 2.6, brake: 7, reverse: 3.5, wheelbase: 3.4, steerLock: 0.5, radius: 1.9 },
  tempo: { name: 'Mondha Goods Tempo', maxSpeed: 15, acceleration: 3.2, brake: 7, reverse: 4, wheelbase: 2.2, steerLock: 0.65, radius: 1.4 },
};
// Sideways tyre grip (units/s²): no car can turn harder than this at speed.
const GRIP = 9;

/**
 * One physics step for the player's car. Input: up/down/left/right/brake/boost flags
 * (keyboard, arrow pad), optional analog throttle/steer in -1..1 (wheel, joystick,
 * pedals; throttle < 0 drives in reverse) and footBrake (brake pedal). Holding "down"
 * brakes to a stop, then reverses. car.steer keeps the eased steering angle and
 * car.fuel (0-100) runs the engine: an empty tank coasts but still steers and brakes.
 */
export function driveStep(car, input, dt) {
  const specs = VEHICLES[car.kind], speed = car.speed, fuel = car.fuel ?? 100;
  const gas = Number.isFinite(input.throttle) ? clamp(input.throttle, -1, 1) : (input.up ? 1 : 0) - (input.down ? 1 : 0);
  const boosting = Boolean(input.boost) && gas > 0 && car.nitro > 1 && speed > 8 && fuel > 0;
  const top = specs.maxSpeed * (boosting ? 1.35 : 1);
  let force = 0, braking = 0;
  if (gas > 0) {
    if (speed < -0.3) braking = specs.brake * gas;
    // Power fades toward the speed this much pedal or stick can hold.
    else if (fuel > 0 && speed < top * gas) force = specs.acceleration * (boosting ? 1.7 : 1) * gas * (1 - (Math.max(speed, 0) / (top * gas)) ** 2);
  } else if (gas < 0) {
    if (speed > 0.3) braking = specs.brake * -gas;
    else if (fuel > 0) force = -specs.acceleration * 0.7 * -gas * Math.max(0, 1 - (Math.max(-speed, 0) / (specs.reverse * -gas)) ** 2);
  }
  if (input.footBrake) braking = Math.max(braking, specs.brake);
  if (input.brake) braking = Math.max(braking, specs.brake * 0.6);
  let next = speed + force * dt;
  // Brakes, rolling resistance and air drag slow the car without pushing it backwards.
  const slow = (braking + 0.3 + 0.0011 * next * next) * dt;
  next = Math.abs(next) <= slow ? 0 : next - Math.sign(next) * slow;
  if (next > top) next = Math.max(top, next - 6 * dt);
  next = Math.max(next, -specs.reverse);
  if (!gas && Math.abs(next) < 0.15) next = 0;
  car.speed = next;
  // Keys ease toward full lock and recentre faster; a touch wheel or stick is already smooth.
  const wanted = Number.isFinite(input.steer) ? clamp(input.steer, -1, 1) : (input.left ? 1 : 0) - (input.right ? 1 : 0);
  let steer = car.steer ?? 0;
  if (Number.isFinite(input.steer)) steer = wanted;
  else { const rate = !wanted || (steer && Math.sign(wanted) !== Math.sign(steer)) ? 6 : 3.2; steer += clamp(wanted - steer, -rate * dt, rate * dt); }
  car.steer = steer;
  // Bicycle model: tight lock when parking, gentler at speed, never beyond the tyres' grip.
  // The handbrake swings the tail out for a sharper turn.
  const angle = steer * specs.steerLock / (1 + Math.abs(next) / 22);
  const grip = GRIP * (input.brake ? 1.6 : 1), limit = grip / Math.max(Math.abs(next), 1);
  car.heading += clamp(next * Math.tan(angle) / specs.wheelbase * (input.brake ? 1.5 : 1), -limit, limit) * dt;
  car.fuel = clamp(fuel - (0.02 + (force ? 0.13 * Math.abs(gas) : 0) + (boosting ? 0.15 : 0)) * dt, 0, 100);
  car.nitro = clamp(car.nitro + (boosting ? -25 : 9) * dt, 0, 100);
  return { dx: -Math.sin(car.heading) * next * dt, dz: -Math.cos(car.heading) * next * dt, boosting };
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
// The airport run starts on the mapped street outside Hazur Sahib Nanded
// station, facing the road vertex the Hingoli Gate route follows first.
const stationRoad={x:33.81,z:9.78},stationApproach=PLACE_BY_ID.get('nanded-station')?.approach||stationRoad;
const airportStart={...stationApproach,heading:Math.atan2(-(stationRoad.x-stationApproach.x),-(stationRoad.z-stationApproach.z))};
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
    description:'Five checkpoints, one lap. Take the wheel through Bhagya Nagar, Workshop, ITI and Shivaji Putla, then race back to the finish.',reward:1200,seconds:300,race:true,start:{...circuitStart},startMode:'vehicle',
    stops:[raceStop('bhagya-nagar-kaman'),raceStop('workshop-corner'),raceStop('iti-corner'),raceStop('shivaji-putla'),raceStop('bhagya-nagar-kaman','Finish at Bhagya Nagar Kaman')] },
  { id:'tiffin-run',kind:'social',title:'डबा पोहोचवा',label:'10 / TIFFIN RUN',shortDescription:'Deliver a tiffin to Madhur Bhoj, then to People’s College.',
    description:'“अरे, डबा विसरलास!” Walk to Madhur Bhoj and hand over the tiffin, then carry the next order to People’s College. Quick and local, no timer.',reward:400,seconds:null,
    stops:[talk('madhur-bhoj','Deliver the tiffin outside Madhur Bhoj','डबा आणलास? बरं झालं! Now take the next one to People’s College.'),talk('peoples-college','Deliver the second tiffin at People’s College','धन्यवाद, भावा! Chai is on me.')] },
  { id:'ghat-errand',kind:'photo',title:'घाटावरची फेरी',label:'11 / GHAT ERRAND',shortDescription:'Photograph Ram Ghat and Govardhan Ghat on foot.',
    description:'“गोदावरीचा घाट बघितल्याशिवाय नांदेड पूर्ण नाही!” Visit two riverfront ghats on foot and take a photo at each. No timer, just the river.',reward:700,seconds:null,
    stops:[photo('ram-ghat','Photograph Ram Ghat'),photo('govardhan-ghat','Photograph Govardhan Ghat')] },
  { id:'lose-the-tail',kind:'chase',title:'Lose the tail',label:'09 / THE GETAWAY',shortDescription:'A fictional arcade pursuit through the Nanded streets.',
    description:'Take the wheel, make your own route and stay ahead of the fictional patrol for 50 seconds. The city is your escape route.',reward:1500,seconds:80,chase:true,survive:50,start:{...SPAWN},startMode:'vehicle',stops:[] },
  { id:'darshan-yatra',kind:'photo',title:'दर्शन यात्रा',label:'12 / HAZUR SAHIB YATRA',shortDescription:'A Gurudwara photo yatra along the Godavari: Hazur Sahib to Sangat Sahib.',
    description:'“वाहेगुरू जी का खालसा!” Walk the old-city riverfront like a yatri: photograph Takht Sri Hazur Sahib, then Nagina Ghat, Langar Sahib and Sangat Sahib. No timer — the Godavari sets the pace.',reward:1100,seconds:null,
    stops:[photo('hazur-sahib','Photograph Takht Sri Hazur Sahib'),photo('nagina-ghat','Photograph Gurudwara Nagina Ghat'),photo('langar-sahib','Photograph Gurudwara Langar Sahib'),photo('sangat-sahib','Photograph Gurudwara Sangat Sahib')] },
  { id:'old-city-bazaar',kind:'social',title:'जुन्या गावची फेरी',label:'13 / OLD CITY BAZAAR',shortDescription:'Sarafa lanes, the Old Mondha clock tower and hot jalebi to finish.',
    description:'Old Nanded in one stroll: meet your friend in the Sarafa Bazar lanes, photograph the Old Mondha Clock Tower, then finish with sweets at Prasad Sweet House.',reward:650,seconds:null,
    stops:[talk('sarafa-bazar','Meet in the Sarafa Bazar lanes','सराफ्यातली गर्दी बघ! Now go frame the Old Mondha Clock Tower.'),photo('old-mondha-clock-tower','Photograph the Old Mondha Clock Tower'),talk('prasad-sweet-house','Finish with sweets at Prasad Sweet House','गरम जिलेबी तयार आहे! Old city done right.')] },
  { id:'airport-run',kind:'race',title:'Station ते Airport',label:'14 / AIRPORT RUN',shortDescription:'Race from Hazur Sahib Nanded station past Hingoli Gate to the airport.',
    description:'The classic cross-city dash: station forecourt, Hingoli Gate, Namaskar Chowk, then Shri Guru Gobind Singh Ji Airport. Four minutes on the clock — keep it clean.',reward:1400,seconds:240,race:true,start:{...airportStart},startMode:'vehicle',
    stops:[raceStop('hingoli-gate','Through Hingoli Gate'),raceStop('namaskar-chowk','Past Namaskar Chowk'),raceStop('nanded-airport','Finish at Shri Guru Gobind Singh Ji Airport')] },
  // --- Chapter two: one full day in the city, admission to aarti. ---
  { id:'admission-day',kind:'social',title:'प्रवेशाचा दिवस',label:'15 / ADMISSION DAY',shortDescription:'College admission morning: Yeshwant, People\'s College, then chai to celebrate.',
    description:'First day of the rest of your life. Collect the admission form at Yeshwant Mahavidyalaya, photograph People\'s College for the family group, then celebrate with chai at Frespresso.',reward:800,seconds:null,
    stops:[talk('yeshwant-college','Collect the form at Yeshwant Mahavidyalaya','फॉर्म मिळाला! आता People\'s College चा एक फोटो काढूया.'),photo('peoples-college','Photograph People\'s College'),talk('frespresso','Celebrate with chai at Frespresso','प्रवेश पक्का! Admission confirmed — chai on you!')] },
  { id:'mondha-auction',kind:'delivery',title:'मोंढ्याचा लिलाव',label:'16 / MONDHA AUCTION',shortDescription:'Drive the produce run from Old Mondha to the New Mondha yard before the rates change.',
    description:'Auction morning moves fast. Load up at Sarafa in the old city, drive the yard run to New Mondha while the rates hold, then seal the deal over sweets at Prasad.',reward:950,seconds:300,
    stops:[stop('sarafa-bazar','Load up in the Sarafa lanes',{mode:'vehicle'}),stop('brilliant-commerce','Reach the New Mondha yard',{mode:'vehicle'}),talk('prasad-sweet-house','Seal it with sweets at Prasad','सौदा पक्का! आजचा भाव आपलाच.')] },
  { id:'gurpurab-evening',kind:'photo',title:'गुरपुरबची संध्याकाळ',label:'17 / GURPURAB EVENING',shortDescription:'Photograph Hazur Sahib at its glowing best, do seva at the Langar, end at Nagina Ghat.',
    description:'The Takht glows gold as the light falls. Photograph Sachkhand, help for a moment at Langar Sahib, and finish on the Nagina Ghat steps above the Godavari.',reward:1200,seconds:null,
    stops:[photo('hazur-sahib','Photograph Takht Sri Hazur Sahib'),talk('langar-sahib','Do a little seva at Langar Sahib','सेवा परमो धर्म:. Thank you for your hands today.'),photo('nagina-ghat','End the evening at Nagina Ghat')] },
].map(def=>{
  const first=def.stops[0],place=first&&PLACE_BY_ID.get(first.placeId);
  return {startMode:'foot',...def,start:def.start||{x:first.x,z:first.z,heading:place?.rotation||0}};
});

/** Progress through a checkpoint race: later checkpoint wins, then nearer to it. */
export function raceProgress(stage, distanceToNext) { return stage * 100000 - Math.max(0, distanceToNext || 0); }

/** 1-based race position of the player among rivals, by checkpoint progress. */
export function racePosition(playerStage, playerDistance, rivals = []) {
  const mine = raceProgress(playerStage, playerDistance);
  return 1 + rivals.filter(rival => raceProgress(rival.stage, rival.distance) > mine).length;
}

/** Gentle rubber-banding: rivals hurry when behind, ease off when ahead. */
export function rubberBand(playerStage, playerDistance, rivalStage, rivalDistance) {
  const gap = raceProgress(playerStage, playerDistance) - raceProgress(rivalStage, rivalDistance);
  return Math.max(0.86, Math.min(1.16, 1 + gap / 1400));
}

export function newMission(index = 0) {
  return { index: ((index % MISSIONS.length) + MISSIONS.length) % MISSIONS.length, stage: 0, elapsed: 0, dwell: 0, status: 'active', crashes: 0 };
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

const RECORDS_KEY = 'nanded-activity-records-v1';
const TIMED_MISSION_IDS = new Set(MISSIONS.filter(mission => Number.isFinite(mission.seconds)).map(mission => mission.id));

export function loadRecords(storage) {
  try {
    const data = JSON.parse(storage.getItem(RECORDS_KEY));
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    return Object.fromEntries(Object.entries(data).filter(([id, seconds]) =>
      TIMED_MISSION_IDS.has(id) && Number.isFinite(seconds) && seconds > 0 && seconds <= 86400
    ));
  } catch { return {}; }
}

export function saveRecords(storage, records) {
  try { storage.setItem(RECORDS_KEY, JSON.stringify(records)); return true; } catch { return false; }
}
