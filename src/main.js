import * as THREE from 'three';
import './style.css';
import './launch.css';
import './adventures.css';
import { createWorld } from './world.js';
import { NETWORK, PLACES, DISTRICTS, BOUNDS, SPAWN, PLACE_BY_ID } from './city-data.js';
import { createNavigator, pathLength, indexColliders } from './navigation.js';
import { createGuide } from './guide.js';
import { initMobileUI } from './mobile.js';
import { createIntro } from './intro.js';
import { createCameraControls, movementForCamera } from './camera-controls.js';
import { createJoystick } from './joystick.js';
import { resolveCameraPosition } from './camera-obstruction.js';
import { mapHeading, destinationBearing } from './map-direction.js';
import { LANDMARKS, loadStamps, nearestPhotoSpot, collectStamp, createAdventureMenu } from './adventures.js';
import { createVehicle, createPerson } from './vehicles.js';
import { GameAudio } from './audio.js';
import { clamp, distance, wrapAngle, blocked, moveBody, driveStep, VEHICLES, MISSIONS, newMission, advanceMission, loadProgress, saveProgress } from './mechanics.js';

const $ = id => document.getElementById(id);
const show = (id, visible) => { if ($(id)) $(id).hidden = !visible; };
const text = (id, value) => { if ($(id)) $(id).textContent = value; };
const keys = new Set();
// Fog fully hides the city at this distance, so nothing further is drawn.
const VIEW_DISTANCE = 640;
const DRIVE_CONTROLS_KEY = 'nanded-drive-controls-v1';
const audio = new GameAudio();
const intro = createIntro();
let storage;
try { storage=window.localStorage; } catch { storage={getItem:()=>null,setItem:()=>{throw Error('unavailable');}}; }
const progress=loadProgress(storage);
const game={started:false,paused:false,mapOpen:false,activityOpen:false,helpOnly:false,onFoot:true,roam:false,cash:progress.cash,completed:progress.completed,mission:newMission(0),wanted:0,heat:0,trouble:0,time:0,capture:0,toastTime:0,collisionCooldown:0,gps:null,landmarkView:null,jumpHeight:0,jumpSpeed:0,jumpHeld:false};
const stamps=loadStamps(storage);
const player={...SPAWN};
let renderer,scene,camera,cameraControls,joystick,world,car,avatar,marker,markerRing,arrow,clock,lastHUD=0,pausedFrameDrawn=false;
let driveControls='arrows';
try{if(storage.getItem(DRIVE_CONTROLS_KEY)==='joystick')driveControls='joystick';}catch{/* Storage is optional. */}
const toastQueue=[];
let guide,adventureMenu,friend,routeLine,routePoints=[],routeAge=10,routeKey='',mapCenter={...SPAWN},mapSpan=3600,lastTrafficFocus={...SPAWN},photoTimer;
const photoMarkers=[];
const navigator=createNavigator(NETWORK),visited=new Set();
try{for(const id of JSON.parse(storage.getItem('nanded-discoveries-v1')||'[]'))if(PLACE_BY_ID.has(id))visited.add(id);}catch{/* Storage is optional. */}
const cars=[],police=[],pedestrians=[];
let lastNearby=null;
let introTime=0;
const tmp=new THREE.Vector3(),camTarget=new THREE.Vector3(),sunTarget=new THREE.Object3D();

function toast(message,seconds=4) {text('toast',message);show('toast',true);game.toastTime=seconds;}
// Show after the current message instead of replacing it.
function queueToast(message,seconds=4){if(game.toastTime>0)toastQueue.push([message,seconds]);else toast(message,seconds);}
function persist(){const saved=saveProgress(storage,{cash:game.cash,completed:game.completed,stamps:[...stamps]});if(!saved)toast('Progress could not be saved in this browser. You can keep playing.');return saved;}
function playerPosition(){return game.onFoot?player:car;}
function addCar(kind,color,x,z,heading=0,route=null){
  const mesh=createVehicle(kind,color);scene.add(mesh);mesh.position.set(x,0.12,z);mesh.rotation.y=heading;
  const vehicle={kind,mesh,x,z,heading,speed:0,nitro:100,health:100,route,routeIndex:0,cruise:8+Math.random()*5,occupied:false};
  cars.push(vehicle);return vehicle;
}

function setup(){
  const mobileGraphics=matchMedia('(any-pointer: coarse)').matches||innerWidth<=760;
  renderer=new THREE.WebGLRenderer({canvas:$('game-canvas'),antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,mobileGraphics?1.2:1.6));renderer.setSize(innerWidth,innerHeight);
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.22;
  scene=new THREE.Scene();scene.background=new THREE.Color('#ddb8a0');scene.fog=new THREE.Fog('#ddb8a0',190,VIEW_DISTANCE);
  camera=new THREE.PerspectiveCamera(52,innerWidth/innerHeight,0.2,VIEW_DISTANCE+60);
  const hemi=new THREE.HemisphereLight('#e1f2f4','#af8060',2.7);scene.add(hemi);
  const sun=new THREE.DirectionalLight('#ffdbab',3.3);sun.position.set(-100,150,90);sun.castShadow=true;
  const shadowSize=mobileGraphics?1024:2048;sun.shadow.mapSize.set(shadowSize,shadowSize);sun.shadow.camera.left=-110;sun.shadow.camera.right=110;sun.shadow.camera.top=110;sun.shadow.camera.bottom=-110;sun.shadow.camera.near=1;sun.shadow.camera.far=420;sun.shadow.bias=-0.0005;sun.shadow.normalBias=0.04;sun.target=sunTarget;scene.add(sun,sunTarget);
  game.sun=sun;
  world=createWorld(scene,{viewDistance:VIEW_DISTANCE});
  indexColliders(world.colliders);indexColliders(world.cameraColliders);world.setFocus?.(SPAWN);
  const parkedStart=navigator.nearest({x:SPAWN.x+Math.sin(MISSIONS[0].start.heading)*12,z:SPAWN.z+Math.cos(MISSIONS[0].start.heading)*12});
  car=addCar('hatchback','#568c8a',parkedStart.x,parkedStart.z,SPAWN.heading);
  const parked=['iib-parnakuti','rcc-nanded','yeshwant-college','hazur-sahib','sggs-engineering'];
  parked.forEach((id,i)=>{const p=PLACE_BY_ID.get(id).approach;addCar(i%2?'sedan':'auto',i%2?'#eee1bd':'#196e56',p.x,p.z);});
  const palette=['#dfb94e','#568c8a','#d5d5b9','#b45e4b','#597d53','#637b97'];
  const nearPlaces=[...PLACES].sort((a,b)=>distance(a,SPAWN)-distance(b,SPAWN));
  for(let i=0;i<24;i++){
    const route=navigator.walk(nearPlaces[(i+2)%24].approach,i*773+31,28);
    if(route.length<3)continue;
    const index=route.findIndex(point=>distance(point,SPAWN)>22&&cars.every(v=>distance(v,point)>9));
    if(index<0)continue;const start=route[index],next=route[(index+1)%route.length];
    const v=addCar(i%4===0?'auto':i%3===0?'sedan':'hatchback',palette[i%palette.length],start.x,start.z,Math.atan2(-(next.x-start.x),-(next.z-start.z)),route);v.routeIndex=(index+1)%route.length;
  }
  for(let i=0;i<3;i++){
    const v=addCar('police','#eee9d7',SPAWN.x,SPAWN.z);v.mesh.visible=false;v.active=false;police.push(v);
  }
  avatar=createPerson('#e37747');scene.add(avatar);avatar.visible=false;
  friend=createPerson('#618eac');scene.add(friend);friend.visible=false;
  const photoGeometry=new THREE.TorusGeometry(2.1,.1,5,24),photoMaterial=new THREE.MeshBasicMaterial({color:'#7edac8',transparent:true,opacity:.8});
  for(const place of LANDMARKS){const mesh=new THREE.Mesh(photoGeometry,photoMaterial);mesh.rotation.x=Math.PI/2;mesh.position.set(place.approach.x,.3,place.approach.z);scene.add(mesh);photoMarkers.push({place,mesh});}
  for(let i=0;i<60;i++){
    const place=nearPlaces[i%nearPlaces.length],axis=i%2;
    const angle=place.rotation,x=place.approach.x-Math.sin(angle)*3+(i%3-1)*2,z=place.approach.z-Math.cos(angle)*3;
    if(blocked(x,z,0.6,world.colliders,world.bounds))continue;
    const mesh=createPerson(['#d8913c','#3e8f9b','#a74b5a','#e4d6ac','#586e9e'][i%5]);mesh.position.set(x,0,z);scene.add(mesh);
    pedestrians.push({mesh,x,z,axis,direction:i%2?1:-1,origin:axis?z:x});
  }
  marker=new THREE.Group();scene.add(marker);
  markerRing=new THREE.Mesh(new THREE.TorusGeometry(7.5,0.2,8,64),new THREE.MeshBasicMaterial({color:'#ffd269'}));markerRing.rotation.x=Math.PI/2;markerRing.position.y=0.24;marker.add(markerRing);
  const glow=new THREE.Mesh(new THREE.CylinderGeometry(7.5,7.5,6,48,1,true),new THREE.MeshBasicMaterial({color:'#ffc75f',transparent:true,opacity:0.12,side:THREE.DoubleSide,depthWrite:false}));glow.position.y=3;marker.add(glow);
  arrow=new THREE.Mesh(new THREE.ConeGeometry(1.3,2.4,4),new THREE.MeshBasicMaterial({color:'#ffd269'}));arrow.rotation.z=Math.PI;arrow.position.y=8;marker.add(arrow);
  routeLine=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:'#ffd269',transparent:true,opacity:0.9,depthTest:false}));routeLine.renderOrder=3;scene.add(routeLine);
  guide=createGuide({places:PLACES,onNavigate:setDestination,onTravel:travelTo,onSelect:place=>{mapCenter={...place};mapSpan=1000;drawMap($('full-map'),true);},onClose:()=>{if(game.mapOpen)toggleMap();},getVisited:()=>visited,getPosition:()=>({...playerPosition(),metersPerUnit:1/NETWORK.scale})});
  adventureMenu=createAdventureMenu({missions:MISSIONS,onMission:playActivity,onVisit:visitLandmark,onRoam:()=>{closeAdventures();setRoam(true);},onClose:closeAdventures,getStamps:()=>stamps});
  clock=new THREE.Clock();
  text('loading-status','THE CITY IS YOURS');$('start-drive').disabled=false;$('start-explore').disabled=false;
  hookUI();updateHUD();requestAnimationFrame(frame);
  console.info(`Nanded city ready: ${PLACES.length} places, ${NETWORK.edges.length} street segments.`,world.getStats?.()||'');
  // Read-only diagnostics in all builds; test controls only in local development.
  window.nandedDiagnostics=()=>({started:game.started,paused:game.paused,onFoot:game.onFoot,position:{x:playerPosition().x,z:playerPosition().z},speed:car.speed,mission:{...game.mission},cash:game.cash,wanted:game.wanted,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,carCount:cars.length,landmarks:world.landmarks.map(l=>l.name)});
}

function start(roam=false){
  if(!renderer)return;
  game.started=true;game.paused=false;game.onFoot=true;game.roam=roam;game.gps=null;game.mission=newMission(0);car.occupied=false;car.speed=0;
  player.x=SPAWN.x;player.z=SPAWN.z;player.heading=MISSIONS[0].start.heading;game.jumpHeight=game.jumpSpeed=0;game.landmarkView=null;
  avatar.position.set(player.x,.15,player.z);avatar.visible=true;show('welcome',false);show('hud',true);show('touch-controls',true);show('pause-menu',false);
  document.body.classList.add('is-playing');keys.clear();
  show('camera-reset',true);cameraControls.reset(playerPosition().heading);
  const p=playerPosition(),initial=resolveCameraPosition({x:p.x,y:1.6,z:p.z},{x:p.x+Math.sin(p.heading)*9,y:1.6+Math.tan(.44)*9,z:p.z+Math.cos(p.heading)*9},world.cameraColliders,world.bounds);
  camera.position.set(initial.x,initial.y,initial.z);
  beginMission();toast(roam?'आपली गल्ली. आपलं शहर. Walk, jump, explore — choose Activities whenever you like.':'अरे, परत आलास! Meet your friend in the amber ring. Tap Talk or press Q.',7);
  $('game-canvas').focus();
}

function beginMission(){
  game.capture=0;
  if(!game.roam&&MISSIONS[game.mission.index].chase){game.wanted=2;game.heat=45;game.trouble=game.time;spawnPolice();}
  routeAge=10;
  updateHUD();
}

function openAdventures(view='activities'){
  if(!game.started||intro.active)return;
  if(game.mapOpen)toggleMap();show('pause-menu',false);game.activityOpen=true;game.paused=true;keys.clear();cameraControls.cancel();joystick.reset();adventureMenu.open(view);
}
function closeAdventures(){
  if(!game.activityOpen)return;
  adventureMenu.close();game.activityOpen=false;game.paused=false;keys.clear();$('game-canvas').focus();
}
function placePlayer(position,onFoot=true){
  const heading=position.heading??SPAWN.heading;
  game.onFoot=onFoot;game.landmarkView=null;game.jumpHeight=game.jumpSpeed=0;game.jumpHeld=false;game.capture=0;game.wanted=0;game.heat=0;
  police.forEach(p=>{p.active=false;p.mesh.visible=false;});
  player.x=position.x;player.z=position.z;player.heading=heading;
  if(!onFoot){car.x=position.x;car.z=position.z;car.heading=heading;car.route=null;}
  car.speed=0;car.occupied=!onFoot;car.health=100;car.nitro=100;
  clearArrival(position,onFoot?null:car);
  avatar.visible=onFoot;avatar.position.set(player.x,.15,player.z);
  cameraControls.reset(heading);const dist=onFoot?9:19;
  const initial=resolveCameraPosition({x:position.x,y:1.6,z:position.z},{x:position.x+Math.sin(heading)*dist,y:1.6+Math.tan(.44)*dist,z:position.z+Math.cos(heading)*dist},world.cameraColliders,world.bounds);
  camera.position.set(initial.x,initial.y,initial.z);
  // A driving start keeps moving traffic off its run-up; on foot, cars only need to clear the kerb.
  world.setFocus?.(position);refreshTraffic(position,true,onFoot?22:60);routeAge=10;
}
function clearArrival(position,exclude=null){
  const paths=[...navigator.walk(position,17,24),...navigator.walk(position,18,24)];
  for(const vehicle of cars){
    if(vehicle===exclude||police.includes(vehicle)||distance(vehicle,position)>8)continue;
    const spot=paths.find(p=>distance(p,position)>16&&distance(p,position)<160&&!blocked(p.x,p.z,VEHICLES[vehicle.kind].radius,world.colliders,world.bounds)&&cars.every(other=>other===vehicle||distance(other,p)>6));
    if(spot){vehicle.x=spot.x;vehicle.z=spot.z;vehicle.speed=0;vehicle.route=null;vehicle.mesh.position.set(spot.x,.12,spot.z);}
  }
}
function playActivity(index){
  closeAdventures();game.mission=newMission(index);game.roam=false;game.gps=null;
  const def=MISSIONS[index];placePlayer(def.start,def.startMode!=='vehicle');beginMission();refreshRoute(2);updateHUD();
  toast(`${def.title} · ${def.stops[0]?.label||'Keep moving. Lose the patrol.'}`,6);
}
function visitLandmark(place){
  closeAdventures();setRoam(true);placePlayer({...place.approach,heading:Math.atan2(-(place.x-place.approach.x),-(place.z-place.approach.z))},true);game.landmarkView=place;
  game.gps=place;refreshRoute(2);discoverPlaces();updateHUD();toast(`${place.shortName} · Look around, then tap Photo or press Q for your passport.`,6);
}
function missionActionTarget(){
  if(game.roam||game.mission.status!=='active')return null;
  const target=MISSIONS[game.mission.index].stops[game.mission.stage];
  return target?.action&&distance(playerPosition(),target)<=(target.radius||13)?target:null;
}
function currentPhotoSpot(){
  if(!game.onFoot)return null;
  const objective=!game.roam?MISSIONS[game.mission.index].stops[game.mission.stage]:null;
  const preferred=LANDMARKS.find(p=>p.id===(objective?.action==='photo'?objective.placeId:game.gps?.id));
  return preferred&&distance(player,preferred.approach)<=24?preferred:nearestPhotoSpot(player,true);
}
function takeAction(){
  if(!game.started||game.paused||intro.active)return;
  const target=missionActionTarget(),photoSpot=currentPhotoSpot();
  if(!game.onFoot){toast('Step out of your vehicle first.');return;}
  // One press can earn a stamp and advance the activity: show each message in turn.
  const messages=[];
  if(photoSpot&&(!target||target.action==='photo')){
    const reward=collectStamp(stamps,photoSpot.id);
    if(reward){game.cash+=reward;messages.push(persist()?[`नांदेडची आठवण! ${photoSpot.shortName} · +₹${reward} · ${stamps.size}/${LANDMARKS.length} stamps`,5]:['Photo collected for this session. Browser storage is unavailable.',4]);audio.success();}
    else if(!target)messages.push([`${photoSpot.shortName} is already in your passport.`,3]);
  }else if(!target)messages.push(['Find a mint photo ring at a landmark, or follow your activity marker.',4]);
  if(target){
    const result=advanceMission(game.mission,player,0,false,0,target.action);
    if(result){if(target.dialogue)messages.push([target.dialogue,6]);messages.push(handleMissionResult(result,false));}
  }
  messages.forEach(([message,seconds],i)=>i?queueToast(message,seconds):toast(message,seconds));
  if(photoSpot&&(!target||target.action==='photo'))showPhoto(photoSpot.shortName);
  else if(target?.action==='photo')showPhoto(target.placeId?PLACE_BY_ID.get(target.placeId)?.shortName:'Zenda Chowk');
  updateHUD();
}
function showPhoto(title){
  renderer.render(scene,camera);
  try{$('photo-preview').src=renderer.domElement.toDataURL('image/jpeg',.75);}catch{/* A stamp still works if capture is unavailable. */}
  text('photo-title',title||'Nanded memory');show('photo-memory',true);clearTimeout(photoTimer);photoTimer=setTimeout(()=>show('photo-memory',false),3000);
}

function pause(force,helpOnly=false){
  if(game.activityOpen){closeAdventures();return;}
  if(!game.started&&!helpOnly&&!game.paused)return;
  game.paused=force??!game.paused;game.helpOnly=helpOnly;
  show('pause-menu',game.paused);guide.close();game.mapOpen=false;keys.clear();
  cameraControls?.cancel();joystick?.reset();
  if(game.paused){text('resume',game.started?'Back to the streets':'Back');$('resume')?.focus();}
  else $('game-canvas')?.focus();
  audio.update(car.speed,game.started&&!game.onFoot,game.paused);
}

function toggleMap(){
  if(!game.started)return;
  if(game.activityOpen)closeAdventures();
  game.mapOpen=!game.mapOpen;game.paused=game.mapOpen;
  show('map-overlay',game.mapOpen);show('pause-menu',false);keys.clear();
  cameraControls?.cancel();joystick?.reset();
  if(game.mapOpen){mapCenter={...playerPosition()};mapSpan=3000;guide.open();drawMap($('full-map'),true);}else{guide.close();$('game-canvas').focus();}
}

function recover(message='Back on the road. Your ride is repaired.'){
  const spot=navigator.nearest(playerPosition())||SPAWN;
  car.x=spot.x;car.z=spot.z;car.heading=SPAWN.heading;car.speed=0;car.health=100;car.nitro=100;
  if(game.onFoot){player.x=spot.x;player.z=spot.z;}
  cameraControls?.reset(playerPosition().heading);
  game.jumpHeight=game.jumpSpeed=0;
  game.wanted=0;game.heat=0;game.capture=0;
  police.forEach(p=>{p.active=false;p.mesh.visible=false;});
  toast(message);audio.tone(260,0.3);
}

function setRoam(value){
  game.roam=value;game.gps=null;routeAge=10;
  if(value){game.wanted=0;game.heat=0;police.forEach(p=>{p.active=false;p.mesh.visible=false;});}
  else beginMission();
  updateHUD();
}

function setDestination(place){
  setRoam(true);game.gps=place;routeAge=10;
  refreshRoute(2);
  if(game.mapOpen)toggleMap();
  toast(`Route set: ${place.shortName}. Follow the blue line.`,4);updateHUD();
}

function travelTo(place){
  setRoam(true);
  const p=place.approach;
  if(game.mapOpen)toggleMap();
  placePlayer({...p,heading:Math.atan2(-(place.x-p.x),-(place.z-p.z))},game.onFoot);if(game.onFoot&&place.category==='landmark')game.landmarkView=place;refreshRoute(2);
  discoverPlaces();toast(`${place.shortName} · ${place.area}`,5);updateHUD();
}

function destination(){
  if(game.gps)return game.gps.approach;
  return !game.roam&&game.mission.status==='active'?MISSIONS[game.mission.index].stops[game.mission.stage]:null;
}

function discoverPlaces(){
  const p=playerPosition();let changed=false;
  for(const place of PLACES){
    if(visited.has(place.id)||distance(p,place.approach)>18)continue;
    visited.add(place.id);changed=true;
    if(game.gps?.id===place.id)toast(`Arrived at ${place.shortName}. Take a look around.`,5);
    else if(game.roam)toast(`Discovered ${place.shortName} · ${visited.size}/${PLACES.length}`,3);
  }
  if(changed){try{storage.setItem('nanded-discoveries-v1',JSON.stringify([...visited]));}catch{/* Visiting remains available without storage. */}}
}

function refreshRoute(dt){
  routeAge+=dt;const target=destination(),key=target?`${target.x},${target.z}`:'';
  if(routeAge<1.5&&key===routeKey)return;
  routeAge=0;routeKey=key;routePoints=target?navigator.route(playerPosition(),target):[];
  routeLine.geometry.dispose();routeLine.geometry=new THREE.BufferGeometry().setFromPoints(routePoints.map(p=>new THREE.Vector3(p.x,0.3,p.z)));
  routeLine.material.color.set(game.gps?'#7edac8':'#ffd269');routeLine.visible=Boolean(target);
}

function refreshTraffic(p,force=false,clearance=22){
  if(!force&&distance(p,lastTrafficFocus)<300)return;
  lastTrafficFocus={x:p.x,z:p.z};const nearby=navigator.nearbyEdges(p,240);if(!nearby.length)return;
  cars.filter(v=>v.route&&v!==car&&!police.includes(v)).forEach((v,i)=>{
    if(!force&&distance(v,p)<450)return;
    // Try other nearby streets rather than leaving this car wherever it was, which may be the arrival point.
    for(let k=0;k<nearby.length;k+=7){
      const edge=NETWORK.edges[nearby[(i*37+k)%nearby.length]],a=NETWORK.nodes[edge.a],b=NETWORK.nodes[edge.b];
      const pos={x:(a.x+b.x)/2,z:(a.z+b.z)/2};if(distance(pos,p)<clearance)continue;
      const route=navigator.walk(pos,i*733+17,24);if(route.length<3)continue;
      v.x=pos.x;v.z=pos.z;v.route=route;v.routeIndex=1;v.speed=0;return;
    }
  });
}

function nearestVehicle(){
  let nearest=null,best=8;
  for(const v of cars){if(!v.mesh.visible||police.includes(v))continue;const d=distance(v,player);if(d<best){nearest=v;best=d;}}
  return nearest;
}

function interact(){
  if(!game.started||game.paused)return;
  game.landmarkView=null;
  if(!game.onFoot){
    if(Math.abs(car.speed)>6){toast('Slow down before stepping out.');return;}
    let spot=null;
    for(const offset of [Math.PI/2,-Math.PI/2,Math.PI,0]){
      const x=car.x+Math.sin(car.heading+offset)*3.5,z=car.z+Math.cos(car.heading+offset)*3.5;
      if(!blocked(x,z,0.6,world.colliders,world.bounds)){spot={x,z};break;}
    }
    if(!spot){toast('Find a little more space to step out.');return;}
    player.x=spot.x;player.z=spot.z;player.heading=car.heading;car.speed=0;car.occupied=false;car.route=null;game.onFoot=true;avatar.visible=true;toast('On foot. E to enter a nearby vehicle.');
  }else{
    const nearest=nearestVehicle();
    if(!nearest){toast('Move closer to a parked car or an auto-rickshaw.');return;}
    if(nearest.route){addHeat(30);toast('Vehicle taken. The patrol has been alerted.');}
    else toast(`${VEHICLES[nearest.kind].name}. Let’s go.`);
    car=nearest;car.route=null;car.occupied=true;car.speed=0;game.onFoot=false;avatar.visible=false;
  }
  updateHUD();
}

function hookUI(){
  cameraControls=createCameraControls($('game-canvas'),{canInteract:()=>game.started&&!intro.active&&!game.paused&&!game.mapOpen});
  joystick=createJoystick($('touch-joystick'),$('touch-joystick-knob'),{canInteract:()=>game.started&&!intro.active&&!game.paused&&!game.onFoot});
  $('touch-drive-mode')?.addEventListener('click',()=>{
    driveControls=driveControls==='joystick'?'arrows':'joystick';joystick.reset();keys.clear();
    try{storage.setItem(DRIVE_CONTROLS_KEY,driveControls);}catch{/* The choice still applies for this visit. */}
    toast(driveControls==='joystick'?'Joystick steering: push up to drive, sideways to steer.':'Arrow steering is back.',3);updateHUD();
  });
  initMobileUI({onLayout:()=>{
    camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);
    pausedFrameDrawn=false;
    if(game.mapOpen)drawMap($('full-map'),true);
  }});
  $('start-drive').addEventListener('click',()=>intro.play(()=>start(false),{mode:'foot'}));
  $('start-explore').addEventListener('click',()=>intro.play(()=>start(true),{mode:'foot'}));
  $('start-guide')?.addEventListener('click',()=>intro.play(()=>{start(true);toggleMap();},{mode:'guide'}));
  $('roam-toggle')?.addEventListener('click',()=>openAdventures());
  $('passport-open')?.addEventListener('click',()=>openAdventures('landmarks'));
  $('world-action')?.addEventListener('click',()=>{takeAction();$('game-canvas').focus();});
  $('gps-clear')?.addEventListener('click',()=>{game.gps=null;routeAge=10;updateHUD();});
  $('resume')?.addEventListener('click',()=>pause(false));
  $('help-toggle')?.addEventListener('click',()=>pause(!game.paused,true));
  $('restart')?.addEventListener('click',()=>{pause(false);if(!game.started)intro.play(()=>start(false),{mode:'foot'});else playActivity(game.mission.index);});
  $('mission-next')?.addEventListener('click',()=>game.mission.status==='failed'&&!game.roam?playActivity(game.mission.index):openAdventures());
  $('reset-save')?.addEventListener('click',()=>{game.cash=0;game.completed=0;game.mission=newMission(0);visited.clear();stamps.clear();try{storage.setItem('nanded-discoveries-v1','[]');}catch{}persist();pause(false);if(!game.started)intro.play(()=>start(false),{mode:'foot'});else playActivity(0);});
  $('sound-toggle')?.addEventListener('click',async()=>{try{const enabled=await audio.toggle();text('sound-label',enabled?'Sound on':'Sound off');$('sound-toggle').setAttribute('aria-pressed',String(enabled));}catch{toast('Audio is unavailable in this browser.');}});
  $('fullscreen-toggle')?.addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{toast('Fullscreen is unavailable in this browser.');}});
  $('touch-map')?.addEventListener('click',toggleMap);$('touch-interact')?.addEventListener('click',interact);
  $('camera-reset')?.addEventListener('click',()=>{if(game.started&&!game.paused&&!intro.active){game.landmarkView=null;cameraControls.reset(playerPosition().heading);$('game-canvas').focus();}});
  $('map-zoom-in')?.addEventListener('click',()=>{mapSpan=Math.max(300,mapSpan/1.7);drawMap($('full-map'),true);});
  $('map-zoom-out')?.addEventListener('click',()=>{mapSpan=Math.min(11000,mapSpan*1.7);drawMap($('full-map'),true);});
  $('map-overview')?.addEventListener('click',()=>{mapCenter={x:(BOUNDS.minX+BOUNDS.maxX)/2,z:(BOUNDS.minZ+BOUNDS.maxZ)/2};mapSpan=Math.max(BOUNDS.maxX-BOUNDS.minX,BOUNDS.maxZ-BOUNDS.minZ)+100;drawMap($('full-map'),true);});
  $('full-map')?.addEventListener('click',e=>{const rect=e.currentTarget.getBoundingClientRect(),p={x:mapCenter.x+((e.clientX-rect.left)/rect.width-.5)*mapSpan,z:mapCenter.z+((e.clientY-rect.top)/rect.height-.5)*mapSpan};const near=[...PLACES].sort((a,b)=>distance(a,p)-distance(b,p))[0];if(distance(near,p)<mapSpan*.035)guide.select?.(near.id);});
  $('minimap')?.addEventListener('click',toggleMap);$('minimap')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();toggleMap();}});
  window.addEventListener('keydown',e=>{
    if(intro.active)return;
    if(game.activityOpen)return;
    if(e.target instanceof HTMLInputElement||e.target instanceof HTMLSelectElement||e.target instanceof HTMLTextAreaElement){if(e.code==='Escape'&&game.mapOpen)toggleMap();return;}
    if(e.target instanceof HTMLButtonElement&&['Space','Enter'].includes(e.code))return;
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)&&game.started&&!game.paused)e.preventDefault();
    if(e.repeat){keys.add(e.code);return;}
    if(e.code==='Escape'){if(game.mapOpen)toggleMap();else pause();}
    if(e.code==='KeyM')toggleMap();
    if(e.code==='KeyE')interact();
    if(game.started&&!game.paused){
      if(e.code==='Space'&&game.onFoot&&game.jumpHeight<=0){game.jumpSpeed=7.3;game.jumpHeld=true;}
      if(e.code==='KeyB'){openAdventures();return;}
      if(e.code==='KeyQ')takeAction();
      if(e.code==='KeyC'){game.landmarkView=null;cameraControls.reset(playerPosition().heading);}
      if(e.code==='KeyH')audio.horn();
      if(e.code==='KeyR'){game.cash=Math.max(0,game.cash-100);persist();recover('Ride recovered. Repair cost: up to ₹100.');if(MISSIONS[game.mission.index].chase&&game.mission.status==='active')game.mission.status='failed';}
      if(e.code==='KeyN'&&(game.roam||game.mission.status!=='active'))$('mission-next').click();
    }
    keys.add(e.code);
  });
  window.addEventListener('keyup',e=>keys.delete(e.code));
  // A mouse or touch click leaves focus on the button, where Space would click it again
  // instead of jumping or braking. Keyboard activation (detail 0) keeps its focus.
  document.addEventListener('click',e=>{if(e.detail&&game.started&&!game.paused&&!intro.active&&e.target.closest?.('button'))$('game-canvas').focus({preventScroll:true});});
  window.addEventListener('blur',()=>{keys.clear();if(game.started&&!game.paused)pause(true);});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&game.started&&!game.paused)pause(true);});
  const controls={up:'KeyW',down:'KeyS',left:'KeyA',right:'KeyD',boost:'ShiftLeft',brake:'Space'};
  document.querySelectorAll('[data-control]').forEach(button=>{
    const key=controls[button.dataset.control];
    button.addEventListener('pointerdown',e=>{e.preventDefault();button.setPointerCapture(e.pointerId);keys.add(key);if(key==='Space'&&game.onFoot&&game.jumpHeight<=0&&!game.paused){game.jumpSpeed=7.3;game.jumpHeld=true;}});
    ['pointerup','pointercancel','lostpointercapture'].forEach(type=>button.addEventListener(type,()=>keys.delete(key)));
  });
  $('game-canvas').addEventListener('webglcontextlost',e=>{e.preventDefault();pause(true);show('fatal-error',true);text('fatal-error-message','The graphics connection was interrupted. Reload this page to return to Nanded.');});
}

function inputState(){
  const input={up:keys.has('KeyW')||keys.has('ArrowUp'),down:keys.has('KeyS')||keys.has('ArrowDown'),left:keys.has('KeyA')||keys.has('ArrowLeft'),right:keys.has('KeyD')||keys.has('ArrowRight'),brake:keys.has('Space'),boost:keys.has('ShiftLeft')||keys.has('ShiftRight')};
  if(!game.onFoot&&driveControls==='joystick'&&joystick?.active){
    // Analog values drive the car; the flags keep boost, body roll and hints in step.
    input.throttle=joystick.y;input.steer=-joystick.x;
    input.up||=joystick.y>0.25;input.down||=joystick.y<-0.25;input.left||=joystick.x<-0.25;input.right||=joystick.x>0.25;
  }
  return input;
}

function addHeat(amount){game.heat=clamp(game.heat+amount,0,90);game.wanted=Math.min(3,Math.ceil(game.heat/30));game.trouble=game.time;spawnPolice();}

function spawnPolice(){
  police.forEach((p,i)=>{
    if(i>=game.wanted||p.active)return;
    const pos=playerPosition(),near=navigator.nearest({x:pos.x+55+i*30,z:pos.z+80+i*22});
    p.x=near.x;p.z=near.z;p.active=true;p.mesh.visible=true;p.health=100;p.path=[];p.repath=0;p.speed=0;
  });
}

function roadPath(from,to){
  return navigator.route(from,to);
}

function updateTraffic(dt){
  const pos=playerPosition();
  for(const v of cars){
    if(v===car&&!game.onFoot)continue;
    if(!v.route||police.includes(v))continue;
    let target=v.route[v.routeIndex];
    if(distance(v,target)<2){v.routeIndex=(v.routeIndex+1)%v.route.length;target=v.route[v.routeIndex];}
    const d=distance(v,target),desired=Math.atan2(-(target.x-v.x),-(target.z-v.z));
    v.heading+=wrapAngle(desired-v.heading)*Math.min(dt*6,1);
    const close=distance(v,pos);const slow=game.onFoot&&close<10?0:close<7?0.2:1;
    v.speed=THREE.MathUtils.lerp(v.speed,v.cruise*slow,dt*3);
    const step=Math.min(v.speed*dt,d);v.x+=(target.x-v.x)/Math.max(d,0.1)*step;v.z+=(target.z-v.z)/Math.max(d,0.1)*step;
  }
  for(const p of police){
    if(!p.active)continue;
    if(!game.wanted){p.active=false;p.mesh.visible=false;continue;}
    p.repath-=dt;
    if(p.repath<=0){p.path=roadPath(p,pos);p.repath=2;}
    while(p.path.length>1&&distance(p,p.path[0])<5)p.path.shift();
    const target=distance(p,pos)<24?pos:p.path[0]||pos;
    const d=distance(p,target),heading=Math.atan2(-(target.x-p.x),-(target.z-p.z));
    p.heading+=wrapAngle(heading-p.heading)*Math.min(dt*4,1);
    p.speed=THREE.MathUtils.lerp(p.speed,Math.min(30+game.wanted*2,d*1.5),dt*2);
    const hit=moveBody(p,-Math.sin(p.heading)*p.speed*dt,-Math.cos(p.heading)*p.speed*dt,1.5,world.colliders,world.bounds);
    // Grinding a wall replans soon, but not with a city-wide search on every frame.
    if(hit){p.repath=Math.min(p.repath,0.5);p.speed*=0.6;}
    const lights=p.mesh.userData.lights;if(lights)lights.forEach((light,i)=>light.emissiveIntensity=Math.sin(game.time*12+i*Math.PI)>0?3:0.1);
  }
}

function updatePlayer(dt){
  const input=inputState();
  if(game.onFoot){
    if(input.brake&&!game.jumpHeld&&game.jumpHeight<=0)game.jumpSpeed=7.3;
    game.jumpHeld=input.brake;
    if(game.jumpHeight>0||game.jumpSpeed>0){game.jumpSpeed-=18*dt;game.jumpHeight=Math.max(0,game.jumpHeight+game.jumpSpeed*dt);if(!game.jumpHeight)game.jumpSpeed=0;}
    const x=(input.right?1:0)-(input.left?1:0),z=(input.down?1:0)-(input.up?1:0),len=Math.hypot(x,z);
    if(len){
      game.landmarkView=null;
      // Forward follows the view after looking around, without turning the view with the avatar.
      const direction=movementForCamera(x,-z,cameraControls.heading),speed=input.boost?9:5;
      player.heading=Math.atan2(-direction.x,-direction.z);
      moveBody(player,direction.x*speed*dt,direction.z*speed*dt,0.6,world.colliders,world.bounds);
    }
    avatar.position.set(player.x,0.15+game.jumpHeight,player.z);avatar.rotation.y=player.heading;
    avatar.userData.limbs.forEach((limb,i)=>limb.rotation.x=len?Math.sin(game.time*12+i*Math.PI)*0.45:0);
    lastNearby=nearestVehicle();
  }else{
    const beforeSpeed=car.speed,move=driveStep(car,input,dt);
    const collision=moveBody(car,move.dx,move.dz,VEHICLES[car.kind].radius,world.colliders,world.bounds);
    if(collision){car.speed*=-0.22;if(Math.abs(beforeSpeed)>7&&game.collisionCooldown<=0){car.health-=Math.abs(beforeSpeed)*0.48;game.collisionCooldown=0.8;audio.tone(90,0.15,'sawtooth');}}
    for(const v of cars){
      if(v===car||!v.mesh.visible)continue;
      if(distance(v,car)<VEHICLES[car.kind].radius+VEHICLES[v.kind].radius&&Math.abs(car.speed)>3&&game.collisionCooldown<=0){
        car.health-=Math.abs(car.speed)*0.6;car.speed*=-0.32;game.collisionCooldown=1.1;
        addHeat(police.includes(v)?22:12);audio.tone(75,0.17,'sawtooth');toast('Watch the traffic. Patrol attention is rising.',2.5);
      }
    }
    if(car.health<=0){game.cash=Math.max(0,game.cash-150);persist();game.mission.status='failed';recover('Ride wrecked. Repaired at the garage. Retry your job.');}
    car.mesh.rotation.z=THREE.MathUtils.lerp(car.mesh.rotation.z,((input.left?1:0)-(input.right?1:0))*Math.min(Math.abs(car.speed)/500,0.07),dt*5);
  }
  for(const v of cars){v.mesh.position.set(v.x,0.12,v.z);v.mesh.rotation.y=v.heading;}
}

function updatePedestrians(dt){
  const pos=playerPosition();
  for(const p of pedestrians){
    const delta=p.direction*dt*1.1;
    let dx=p.axis?0:delta,dz=p.axis?delta:0;
    if(distance(p,pos)<7&&!game.onFoot){dx+=(p.x-pos.x)*dt;dz+=(p.z-pos.z)*dt;}
    if(moveBody(p,dx,dz,0.5,world.colliders,world.bounds)||Math.abs((p.axis?p.z:p.x)-p.origin)>35)p.direction*=-1;
    p.mesh.position.set(p.x,0.1,p.z);p.mesh.rotation.y=p.axis?(p.direction>0?Math.PI:0):(p.direction>0?-Math.PI/2:Math.PI/2);
    p.mesh.userData.limbs.forEach((limb,i)=>limb.rotation.x=Math.sin(game.time*6+i*Math.PI)*0.25);
  }
}

function updateMission(dt){
  const def=MISSIONS[game.mission.index],pos=playerPosition();
  if(game.wanted){
    const nearest=Math.min(...police.filter(p=>p.active).map(p=>distance(p,pos)));
    if(nearest<7&&(game.onFoot||Math.abs(car.speed)<5))game.capture+=dt;else game.capture=Math.max(0,game.capture-dt*2);
    if(game.capture>3){game.cash=Math.max(0,game.cash-200);persist();game.mission.status='failed';recover('Busted. ₹200 fine. Back at the garage.');return;}
    if(game.time-game.trouble>15&&nearest>42&&!(!game.roam&&def.chase&&game.mission.status==='active')){
      game.heat=Math.max(0,game.heat-dt*2.8);game.wanted=Math.ceil(game.heat/30);
      if(!game.wanted)toast('The heat is off. You lost the patrol.');
    }
  }
  const result=game.roam?null:advanceMission(game.mission,pos,game.onFoot?0:car.speed,!game.onFoot,dt);
  handleMissionResult(result);
  const target=destination();
  marker.visible=Boolean(target)&&(!game.gps||distance(pos,target)>8);
  if(target){arrow.visible=distance(pos,target)>10;arrow.scale.setScalar(game.onFoot ? .6 : 1);marker.position.set(target.x,0,target.z);arrow.position.y=6+Math.sin(game.time*3)*0.8;arrow.rotation.y=game.time;markerRing.scale.setScalar((game.onFoot ? .45 : 1)*(1+Math.sin(game.time*2)*0.025));markerRing.material.color.set(game.gps?'#7edac8':'#ffd269');arrow.material.color.copy(markerRing.material.color);}
  const friendStop=MISSIONS[0].stops[0];friend.visible=!game.roam&&game.mission.index===0&&game.mission.stage===0&&game.mission.status==='active';
  const friendHeading=MISSIONS[0].start.heading;
  friend.position.set(friendStop.x-Math.sin(friendHeading)*2+Math.cos(friendHeading)*.9,0.15,friendStop.z-Math.cos(friendHeading)*2-Math.sin(friendHeading)*.9);friend.rotation.y=Math.atan2(-(pos.x-friend.position.x),-(pos.z-friend.position.z));
  for(const {place,mesh} of photoMarkers){mesh.visible=distance(pos,place.approach)<130&&!stamps.has(place.id);mesh.scale.setScalar(1+Math.sin(game.time*2)*.06);}
}

function handleMissionResult(result,announce=true){
  if(!result)return null;
  const def=MISSIONS[game.mission.index];let message=null;
  if(result==='complete'){
    game.cash+=def.reward;game.completed++;persist();audio.success();
    if(def.chase){game.wanted=0;game.heat=0;}
    message=[`झकास! ${def.title} complete · +₹${def.reward.toLocaleString('en-IN')} · Choose your next adventure in Activities.`,7];
  }else if(result==='checkpoint'){audio.tone(660,0.2);message=[def.stops[game.mission.stage].label,3];}
  else if(result==='failed'){message=['Time’s up. Retry the challenge when you’re ready.',6];audio.tone(150,0.4);}
  if(announce&&message)toast(...message);
  routeAge=10;refreshRoute(2);updateHUD();
  return message;
}

function updateCamera(dt){
  const p=playerPosition();
  const view=cameraControls.update(dt,{heading:p.heading,speed:game.onFoot?0:car.speed,onFoot:game.onFoot}),heading=view.heading;
  if(view.dragging)game.landmarkView=null;
  const landmark=game.landmarkView;
  const dist=landmark?Math.max(20,Math.min(42,landmark.h*1.3)):game.onFoot?9:19+Math.min(Math.abs(car.speed)*0.12,5);
  tmp.set(p.x+Math.sin(heading)*dist,1.6+Math.tan(view.pitch)*dist,p.z+Math.cos(heading)*dist);
  // Shorten the view before a wall or roof, including obstacles between the actor and camera.
  const focus={x:p.x,y:1.6,z:p.z},clear=resolveCameraPosition(focus,tmp,world.cameraColliders,world.bounds);
  tmp.set(clear.x,clear.y,clear.z);
  camera.position.lerp(tmp,1-Math.exp(-dt*(view.dragging?12:4.5)));
  const safe=resolveCameraPosition(focus,camera.position,world.cameraColliders,world.bounds);
  camera.position.set(safe.x,safe.y,safe.z);
  const lookAhead=game.onFoot?1.5:5;
  if(landmark)camTarget.set(landmark.x,Math.min(landmark.h*.55,12),landmark.z);
  else camTarget.set(p.x-Math.sin(heading)*lookAhead,1.6,p.z-Math.cos(heading)*lookAhead);
  camera.lookAt(camTarget);
  if(game.gps)$('gps-bearing').style.transform=`rotate(${destinationBearing(p,game.gps.approach,heading)}rad)`;
  const fov=52+(!game.onFoot&&inputState().boost&&car.speed>25?6:0);camera.fov=THREE.MathUtils.lerp(camera.fov,fov,dt*3);camera.updateProjectionMatrix();
  game.sun.position.set(p.x-100,150,p.z+90);sunTarget.position.set(p.x,0,p.z);sunTarget.updateMatrixWorld();
}

function district(p){
  return DISTRICTS.reduce((nearest,d)=>distance(d,p)<distance(nearest,p)?d:nearest,DISTRICTS[0]).name.toUpperCase();
}

function updateHUD(){
  const p=playerPosition(),m=game.mission,def=MISSIONS[m.index],target=def.stops[m.stage];
  text('district',district(p));text('cash',`₹${game.cash.toLocaleString('en-IN')}`);
  text('wanted','★'.repeat(game.wanted)+'☆'.repeat(3-game.wanted));$('wanted')?.setAttribute('aria-label',`Wanted level ${game.wanted} of 3`);
  text('speed',game.onFoot?'—':String(Math.round(Math.abs(car.speed)*3.6)).padStart(2,'0'));
  text('vehicle-name',game.onFoot?'ON FOOT':VEHICLES[car.kind].name.toUpperCase());
  if($('health-fill'))$('health-fill').style.width=`${clamp(car.health,0,100)}%`;
  if($('nitro-fill'))$('nitro-fill').style.width=`${car.nitro}%`;
  text('mission-label',m.status==='complete'?'ACTIVITY COMPLETE':m.status==='failed'?'TRY AGAIN':def.label);
  text('mission-title',def.title);
  text('mission-description',m.status==='complete'?`झकास! ₹${def.reward.toLocaleString('en-IN')} earned. Your progress is saved.`:m.status==='failed'?'Take another run, or choose a different adventure.':def.description);
  text('mission-progress',m.status==='active'?(def.chase?`Stay ahead · ${Math.max(0,Math.ceil(def.survive-m.elapsed))}s`:target?.label||''):m.status==='complete'?'READY FOR ANOTHER?':'READY WHEN YOU ARE');
  text('mission-distance',m.status==='active'&&target?`${Math.round(distance(p,target))} m`:'');
  // A getaway is won by surviving; its longer hard limit is never the clock to beat.
  const limit=def.chase?def.survive:def.seconds,remaining=Math.max(0,Math.ceil((limit||0)-m.elapsed));text('mission-time',m.status==='active'?(limit?`${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}`:'NO TIMER'):'');
  show('mission-next',m.status!=='active');text('mission-next',m.status==='failed'?'Retry challenge ↗':'Choose next adventure ↗');
  if(game.roam){
    text('mission-label','YOUR CITY / FREE ROAM');text('mission-title',game.landmarkView?.shortName||'Find your Nanded');text('mission-description',game.landmarkView?'Find a view you like and take a photo for your landmark passport. Walk or drag the view to explore on foot.':'Walk, sprint, jump or borrow a ride. Find mint photo rings at landmarks, or choose a challenge in Activities.');text('mission-progress',`${visited.size} of ${PLACES.length} places discovered`);text('mission-distance','');text('mission-time','');show('mission-next',true);text('mission-next','Choose an adventure ↗');
  }else if(target&&m.status==='active')text('mission-distance',`${Math.round((pathLength(routePoints)||distance(p,target))/NETWORK.scale)} m route`);
  text('roam-toggle','Activities');
  document.body.classList.toggle('on-foot',game.onFoot);document.body.classList.toggle('drive-joystick',driveControls==='joystick');
  $('touch-drive-mode')?.setAttribute('aria-pressed',String(driveControls==='joystick'));
  text('touch-jump',game.onFoot?'JUMP':'BRAKE');$('touch-jump')?.setAttribute('aria-label',game.onFoot?'Jump':'Handbrake');text('touch-sprint',game.onFoot?'RUN':'BOOST');
  text('passport-summary',`${stamps.size}/${LANDMARKS.length} landmark stamps`);
  text('objective-short',game.roam?(game.landmarkView?`Photo spot · ${stamps.has(game.landmarkView.id)?'Stamp collected':'₹150 for a new stamp'}`:'Your city. Your pace.'):m.status==='complete'?'Chapter complete. Choose your next adventure.':m.status==='failed'?'Try again in Activities.':target?.label||'Stay ahead of the patrol');
  const actionTarget=missionActionTarget(),photoSpot=currentPhotoSpot();
  show('world-action',game.onFoot&&Boolean(actionTarget||photoSpot));text('world-action-label',actionTarget?.action==='interact'?'Talk':photoSpot&&stamps.has(photoSpot.id)?'Photo again':'Take photo');
  show('gps-panel',Boolean(game.gps)&&distance(p,game.gps.approach)>24);text('gps-title',game.gps?.shortName||'');text('gps-distance',game.gps?`${Math.round((pathLength(routePoints)||distance(p,game.gps.approach))/NETWORK.scale)} m route`:'');
  text('discovered-count',`${visited.size}/${PLACES.length} discovered`);
  const nearest=game.gps&&distance(game.gps.approach,p)<24?game.gps:PLACES.reduce((a,b)=>distance(a.approach,p)<distance(b.approach,p)?a:b,PLACES[0]);
  text('nearby-place',distance(nearest.approach,p)<100?`NEAR ${nearest.shortName.toUpperCase()}`:'M · FIND A PLACE IN NANDED');
  const nearTarget=!game.roam&&target&&distance(p,target)<18&&m.status==='active'&&!def.race;
  const hint=game.capture>0?'PATROL NEARBY · KEEP MOVING':game.onFoot?(actionTarget?`Q · ${actionTarget.action==='interact'?'Talk to your friend':'Take the photo'}`:photoSpot?'Q · Take a landmark photo':lastNearby?`E · Take ${VEHICLES[lastNearby.kind].name}`:'WASD · Walk   SHIFT · Run   SPACE · Jump'):nearTarget?(target?.mode==='foot'?'E · STEP OUT TO EXPLORE':'SLOW DOWN INSIDE THE AMBER RING'):'E · Step out   H · Horn   R · Recover';
  text('interaction',hint);text('map-label',district(p));drawMap($('minimap'),false);
}

function drawMap(canvas,full){
  if(!canvas||!world)return;const ctx=canvas.getContext('2d');if(!ctx)return;
  const w=canvas.width,h=canvas.height,pos=playerPosition(),span=full?mapSpan:280;
  const scale=w/span,center=full?mapCenter:pos;
  const map=p=>({x:w/2+(p.x-center.x)*scale,y:h/2+(p.z-center.z)*scale});
  const visible=p=>Math.abs(p.x-center.x)<span*.6&&Math.abs(p.z-center.z)<span*.6;
  ctx.fillStyle='#172b2b';ctx.fillRect(0,0,w,h);ctx.lineCap='round';ctx.lineJoin='round';
  function line(points,color,width){ctx.beginPath();points.forEach((p,i)=>{const q=map(p);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);});ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
  for(const river of NETWORK.rivers)line(river.points,'#315f65',Math.max(2,river.width*scale));
  const edgeIds=full?NETWORK.edges.map((_,i)=>i):navigator.nearbyEdges(pos,200);
  // One stroke per colour and width: stroking 26k streets one by one stalls the full map.
  const strokes=new Map();
  for(const i of edgeIds){const edge=NETWORK.edges[i],a=NETWORK.nodes[edge.a],b=NETWORK.nodes[edge.b];
    if(full&&edge.type==='residential'&&span>5000)continue;
    if(!visible(a)&&!visible(b))continue;
    const color=edge.type==='residential'?'#354d49':'#65786b',width=Math.max(full?.65:1,edge.width*scale),key=`${color}|${width}`;
    if(!strokes.has(key))strokes.set(key,{color,width,segments:[]});strokes.get(key).segments.push(a,b);
  }
  // Residential lanes first, so main roads stay on top.
  for(const {color,width,segments} of [...strokes.values()].sort((a,b)=>(b.color==='#354d49')-(a.color==='#354d49'))){
    ctx.beginPath();
    for(let i=0;i<segments.length;i+=2){const p=map(segments[i]),q=map(segments[i+1]);ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);}
    ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();
  }
  ctx.setLineDash([3,4]);for(const rail of NETWORK.rails)line(rail,'#8b9390',full?1:2);ctx.setLineDash([]);
  const target=destination();
  if(target){
    line([pos,...routePoints],game.gps?'#7edac8':'#edbb60',full?3:2);
    const t=map(target);ctx.fillStyle=game.gps?'#7edac8':'#ffd477';ctx.beginPath();ctx.arc(clamp(t.x,6,w-6),clamp(t.y,6,h-6),full?7:5,0,Math.PI*2);ctx.fill();
  }
  const colors={coaching:'#f8bf68',college:'#9fb9ec',school:'#9fb9ec',landmark:'#ecd8a0',hotel:'#e3a7bc',restaurant:'#f59875',cafe:'#f59875',hospital:'#df8b8b',transport:'#94c8c9',shopping:'#d5acda',cinema:'#d5acda',junction:'#b2c8b4',park:'#90be8f'};
  const occupied=[];
  for(const place of PLACES){
    if(!visible(place))continue;
    const q=map(place),selected=full&&guide?.selectedId===place.id;
    ctx.fillStyle=colors[place.category]||'#b2c8b4';ctx.beginPath();ctx.arc(q.x,q.y,selected?8:full?3.5:2,0,Math.PI*2);ctx.fill();
    if(selected){ctx.strokeStyle='#fff7df';ctx.lineWidth=2;ctx.stroke();}
    if(full&&(span<2200||selected)){
      ctx.font=selected?'bold 13px system-ui':'11px system-ui';ctx.textAlign='left';
      const label=place.shortName,width=ctx.measureText(label).width,rect={x:q.x+8,y:q.y-14,w:width+8,h:17};
      if(selected||!occupied.some(r=>rect.x<r.x+r.w&&rect.x+rect.w>r.x&&rect.y<r.y+r.h&&rect.y+rect.h>r.y)){
        ctx.fillStyle='#172b2be8';ctx.fillRect(rect.x-3,rect.y-1,rect.w,rect.h);ctx.fillStyle=selected?'#fff2cb':'#dbe4d9';ctx.fillText(label,rect.x,rect.y+12);occupied.push(rect);
      }
    }
  }
  if(full){ctx.font='bold 11px system-ui';ctx.textAlign='center';ctx.fillStyle='#b8c9b6';
    for(const d of DISTRICTS){if(!visible(d)||span<1800)continue;const p=map(d);const rect={x:p.x-50,y:p.y,w:100,h:15};if(occupied.some(r=>rect.x<r.x+r.w&&rect.x+rect.w>r.x&&rect.y<r.y+r.h&&rect.y+rect.h>r.y))continue;ctx.fillText(d.name.toUpperCase(),p.x,p.y);occupied.push(rect);}
    ctx.textAlign='left';ctx.font='bold 13px system-ui';ctx.fillStyle='#dbe4d9';ctx.fillText('N ↑',18,27);
    const metres=Math.round(span/NETWORK.scale/5/100)*100;ctx.font='11px system-ui';ctx.fillText(`${metres>=1000?(metres/1000).toFixed(1)+' km':metres+' m'} approx.`,18,h-18);ctx.fillRect(18,h-12,w/5,2);
  }else for(const v of cars){if(!v.mesh.visible||v===car||!visible(v))continue;const p=map(v);ctx.fillStyle=police.includes(v)?'#ef7369':'#b7c4ac';ctx.fillRect(p.x-1,p.y-1,2,2);}
  const point=map(pos);ctx.save();ctx.translate(point.x,point.y);ctx.rotate(mapHeading(game.onFoot?player.heading:car.heading));ctx.fillStyle='#fff5da';ctx.strokeStyle='#122b2d';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,-9);ctx.lineTo(6,6);ctx.lineTo(0,3);ctx.lineTo(-6,6);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
}

function frame(){
  // A 0.1 s cap keeps play at real speed down to 10 fps; movement substeps prevent tunnelling.
  requestAnimationFrame(frame);const dt=Math.min(clock.getDelta(),0.1);introTime+=dt;
  // The full-screen artwork/film needs no background WebGL work or game timers.
  if(!game.started||intro.active)return;
  if(!game.paused){
    game.time+=dt;game.collisionCooldown=Math.max(0,game.collisionCooldown-dt);
    updateTraffic(dt);updatePlayer(dt);updatePedestrians(dt);updateMission(dt);updateCamera(dt);refreshRoute(dt);world.setFocus?.(playerPosition());refreshTraffic(playerPosition());
    if(game.toastTime>0){game.toastTime-=dt;if(game.toastTime<=0){const next=toastQueue.shift();if(next)toast(...next);else show('toast',false);}}
    lastHUD+=dt;if(lastHUD>0.2){discoverPlaces();updateHUD();lastHUD=0;}
  }
  audio.update(car.speed,game.started&&!game.onFoot,game.paused);
  // Menus and the map cover a frozen city: draw it once, then again only after a resize.
  if(game.paused&&pausedFrameDrawn)return;
  pausedFrameDrawn=game.paused;
  world.animate?.(dt,introTime);renderer.render(scene,camera);
}

try{setup();}catch(error){
  console.error('Nanded could not start:',error);
  text('loading-status','GRAPHICS UNAVAILABLE');show('fatal-error',true);
  text('fatal-error-message','The city could not load. Use a current browser with hardware acceleration enabled, then reload the page.');
}
