import * as THREE from 'three';
import './style.css';
import { createWorld } from './world.js';
import { createVehicle, createPerson } from './vehicles.js';
import { GameAudio } from './audio.js';
import { clamp, distance, wrapAngle, blocked, moveBody, driveStep, VEHICLES, MISSIONS, newMission, advanceMission, loadProgress, saveProgress } from './mechanics.js';

const $ = id => document.getElementById(id);
const show = (id, visible) => { if ($(id)) $(id).hidden = !visible; };
const text = (id, value) => { if ($(id)) $(id).textContent = value; };
const keys = new Set();
const audio = new GameAudio();
let storage;
try { storage=window.localStorage; } catch { storage={getItem:()=>null,setItem:()=>{throw Error('unavailable');}}; }
const progress=loadProgress(storage);
const game={started:false,paused:false,mapOpen:false,helpOnly:false,onFoot:false,cash:progress.cash,completed:progress.completed,mission:newMission(progress.completed),wanted:0,heat:0,trouble:0,time:0,capture:0,toastTime:0,collisionCooldown:0};
const player={x:-5,z:210,heading:0};
let renderer,scene,camera,world,car,avatar,marker,markerRing,arrow,clock,lastHUD=0;
const cars=[],police=[],pedestrians=[];
let lastNearby=null;
let introTime=0;
const tmp=new THREE.Vector3(),camTarget=new THREE.Vector3(),sunTarget=new THREE.Object3D();

function toast(message,seconds=4) {text('toast',message);show('toast',true);game.toastTime=seconds;}
function persist(){if(!saveProgress(storage,{cash:game.cash,completed:game.completed}))toast('Progress could not be saved in this browser. You can keep playing.');}
function playerPosition(){return game.onFoot?player:car;}
function addCar(kind,color,x,z,heading=0,route=null){
  const mesh=createVehicle(kind,color);scene.add(mesh);mesh.position.set(x,0.12,z);mesh.rotation.y=heading;
  const vehicle={kind,mesh,x,z,heading,speed:0,nitro:100,health:100,route,routeIndex:0,cruise:8+Math.random()*5,occupied:false};
  cars.push(vehicle);return vehicle;
}

function setup(){
  renderer=new THREE.WebGLRenderer({canvas:$('game-canvas'),antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.6));renderer.setSize(innerWidth,innerHeight);
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.22;
  scene=new THREE.Scene();scene.background=new THREE.Color('#ddb8a0');scene.fog=new THREE.Fog('#ddb8a0',190,640);
  camera=new THREE.PerspectiveCamera(52,innerWidth/innerHeight,0.2,1200);
  const hemi=new THREE.HemisphereLight('#e1f2f4','#af8060',2.7);scene.add(hemi);
  const sun=new THREE.DirectionalLight('#ffdbab',3.3);sun.position.set(-100,150,90);sun.castShadow=true;
  sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-110;sun.shadow.camera.right=110;sun.shadow.camera.top=110;sun.shadow.camera.bottom=-110;sun.shadow.camera.near=1;sun.shadow.camera.far=420;sun.shadow.bias=-0.0005;sun.shadow.normalBias=0.04;sun.target=sunTarget;scene.add(sun,sunTarget);
  game.sun=sun;
  world=createWorld(scene);
  car=addCar('hatchback','#ec9b3d',-5,210);car.occupied=true;
  addCar('auto','#196e56',-15,194,Math.PI);
  addCar('sedan','#f1e5cf',15,145);
  addCar('hatchback','#387d9d',-120,104);
  addCar('auto','#1d7057',104,-120,Math.PI/2);
  addCar('sedan','#9c443c',240,-104);
  const palette=['#dfb94e','#568c8a','#d5d5b9','#b45e4b','#597d53','#637b97'];
  for(let i=0;i<16;i++){
    const left=[-240,-120,0][i%3],right=left+120*(1+(i%2));
    const top=[-240,-120,0][Math.floor(i/3)%3],bottom=top+120*(1+(Math.floor(i/2)%2));
    const lane=5;
    const route=[{x:left+lane,z:top+lane},{x:right-lane,z:top+lane},{x:right-lane,z:bottom-lane},{x:left+lane,z:bottom-lane}];
    const idx=i%4,next=route[(idx+1)%4],a=route[idx];const t=(i*0.239)%0.9;
    const x=THREE.MathUtils.lerp(a.x,next.x,t),z=THREE.MathUtils.lerp(a.z,next.z,t);
    const v=addCar(i%4===0?'auto':i%3===0?'sedan':'hatchback',palette[i%palette.length],x,z,Math.atan2(-(next.x-x),-(next.z-z)),route);v.routeIndex=(idx+1)%4;
  }
  for(let i=0;i<3;i++){
    const v=addCar('police','#eee9d7',-240,180-i*20);v.mesh.visible=false;v.active=false;police.push(v);
  }
  avatar=createPerson('#e37747');scene.add(avatar);avatar.visible=false;
  for(let i=0;i<28;i++){
    const axis=i%2,road=world.roads.xs[i%5],side=i%3===0?-16:16;
    const x=axis?road+side:-270+(i*37)%540,z=axis?-270+(i*43)%540:road+side;
    if(blocked(x,z,0.6,world.colliders,world.bounds))continue;
    const mesh=createPerson(['#d8913c','#3e8f9b','#a74b5a','#e4d6ac','#586e9e'][i%5]);mesh.position.set(x,0,z);scene.add(mesh);
    pedestrians.push({mesh,x,z,axis,direction:i%2?1:-1,origin:axis?z:x});
  }
  marker=new THREE.Group();scene.add(marker);
  markerRing=new THREE.Mesh(new THREE.TorusGeometry(7.5,0.2,8,64),new THREE.MeshBasicMaterial({color:'#ffd269'}));markerRing.rotation.x=Math.PI/2;markerRing.position.y=0.24;marker.add(markerRing);
  const glow=new THREE.Mesh(new THREE.CylinderGeometry(7.5,7.5,6,48,1,true),new THREE.MeshBasicMaterial({color:'#ffc75f',transparent:true,opacity:0.12,side:THREE.DoubleSide,depthWrite:false}));glow.position.y=3;marker.add(glow);
  arrow=new THREE.Mesh(new THREE.ConeGeometry(1.3,2.4,4),new THREE.MeshBasicMaterial({color:'#ffd269'}));arrow.rotation.z=Math.PI;arrow.position.y=8;marker.add(arrow);
  clock=new THREE.Clock();
  text('loading-status','THE CITY IS YOURS');$('start-drive').disabled=false;$('start-explore').disabled=false;
  hookUI();updateHUD();requestAnimationFrame(frame);
  // Read-only diagnostics in all builds; test controls only in local development.
  window.nandedDiagnostics=()=>({started:game.started,paused:game.paused,onFoot:game.onFoot,position:{x:playerPosition().x,z:playerPosition().z},speed:car.speed,mission:{...game.mission},cash:game.cash,wanted:game.wanted,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,carCount:cars.length,landmarks:world.landmarks.map(l=>l.name)});
}

function start(onFoot=false){
  if(!renderer)return;
  game.started=true;game.paused=false;game.onFoot=onFoot;car.occupied=!onFoot;
  player.x=car.x-4;player.z=car.z;player.heading=car.heading;
  avatar.visible=onFoot;show('welcome',false);show('hud',true);show('touch-controls',true);show('pause-menu',false);
  document.body.classList.add('is-playing');keys.clear();
  const p=playerPosition();camera.position.set(p.x+14,12,p.z+20);
  beginMission();toast(onFoot?'Walk with WASD. Press E beside a vehicle to hop in.':'Welcome to Nanded. WASD to drive. Follow the amber marker.',6);
  $('game-canvas').focus();
}

function beginMission(){
  game.capture=0;
  if(MISSIONS[game.mission.index].chase){game.wanted=2;game.heat=45;game.trouble=game.time;spawnPolice();}
  updateHUD();
}

function pause(force,helpOnly=false){
  if(!game.started&&!helpOnly&&!game.paused)return;
  game.paused=force??!game.paused;game.helpOnly=helpOnly;
  show('pause-menu',game.paused);show('map-overlay',false);game.mapOpen=false;keys.clear();
  if(game.paused){text('resume',game.started?'Back to the streets':'Back');$('resume')?.focus();}
  else $('game-canvas')?.focus();
  audio.update(car.speed,!game.onFoot,game.paused);
}

function toggleMap(){
  if(!game.started)return;
  game.mapOpen=!game.mapOpen;game.paused=game.mapOpen;
  show('map-overlay',game.mapOpen);show('pause-menu',false);keys.clear();
  if(game.mapOpen){drawMap($('full-map'),true);$('map-close')?.focus();}else $('game-canvas').focus();
}

function recover(message='Back on the road. Your ride is repaired.'){
  car.x=-5;car.z=210;car.heading=0;car.speed=0;car.health=100;car.nitro=100;
  if(game.onFoot){player.x=-9;player.z=210;}
  game.wanted=0;game.heat=0;game.capture=0;
  police.forEach(p=>{p.active=false;p.mesh.visible=false;});
  toast(message);audio.tone(260,0.3);
}

function interact(){
  if(!game.started||game.paused)return;
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
    const nearest=cars.filter(v=>v.mesh.visible&&!police.includes(v)&&distance(v,player)<8).sort((a,b)=>distance(a,player)-distance(b,player))[0];
    if(!nearest){toast('Move closer to a parked car or an auto-rickshaw.');return;}
    if(nearest.route){addHeat(30);toast('Vehicle taken. The patrol has been alerted.');}
    else toast(`${VEHICLES[nearest.kind].name}. Let’s go.`);
    car=nearest;car.route=null;car.occupied=true;car.speed=0;game.onFoot=false;avatar.visible=false;
  }
  updateHUD();
}

function hookUI(){
  $('start-drive').addEventListener('click',()=>start(false));$('start-explore').addEventListener('click',()=>start(true));
  $('resume')?.addEventListener('click',()=>pause(false));
  $('help-toggle')?.addEventListener('click',()=>pause(!game.paused,true));
  $('restart')?.addEventListener('click',()=>{game.mission=newMission(game.mission.index);recover();pause(false);if(!game.started)start();else beginMission();});
  $('mission-next')?.addEventListener('click',()=>{const retry=game.mission.status==='failed';game.mission=newMission(retry?game.mission.index:game.completed);beginMission();toast(retry?'Job restarted. You’ve got this.':'New job. Follow the amber marker.');});
  $('reset-save')?.addEventListener('click',()=>{game.cash=0;game.completed=0;game.mission=newMission(0);persist();recover('Fresh start. Welcome back to Nanded.');pause(false);if(!game.started)start();});
  $('sound-toggle')?.addEventListener('click',async()=>{try{const enabled=await audio.toggle();text('sound-label',enabled?'Sound on':'Sound off');$('sound-toggle').setAttribute('aria-pressed',String(enabled));}catch{toast('Audio is unavailable in this browser.');}});
  $('fullscreen-toggle')?.addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{toast('Fullscreen is unavailable in this browser.');}});
  $('map-close')?.addEventListener('click',toggleMap);$('touch-map')?.addEventListener('click',toggleMap);$('touch-interact')?.addEventListener('click',interact);
  $('minimap')?.addEventListener('click',toggleMap);$('minimap')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();toggleMap();}});
  window.addEventListener('keydown',e=>{
    if(e.target instanceof HTMLButtonElement&&['Space','Enter'].includes(e.code))return;
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','Tab'].includes(e.code)&&game.started&&e.code!=='Tab')e.preventDefault();
    if(e.repeat){keys.add(e.code);return;}
    if(e.code==='Escape'){if(game.mapOpen)toggleMap();else pause();}
    if(e.code==='KeyM')toggleMap();
    if(e.code==='KeyE')interact();
    if(game.started&&!game.paused){
      if(e.code==='KeyH')audio.horn();
      if(e.code==='KeyR'){game.cash=Math.max(0,game.cash-100);persist();recover('Ride recovered. Repair cost: up to ₹100.');if(MISSIONS[game.mission.index].chase&&game.mission.status==='active')game.mission.status='failed';}
      if(e.code==='KeyN'&&game.mission.status!=='active')$('mission-next').click();
    }
    keys.add(e.code);
  });
  window.addEventListener('keyup',e=>keys.delete(e.code));
  window.addEventListener('blur',()=>{keys.clear();if(game.started&&!game.paused)pause(true);});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&game.started&&!game.paused)pause(true);});
  const controls={up:'KeyW',down:'KeyS',left:'KeyA',right:'KeyD',boost:'ShiftLeft',brake:'Space'};
  document.querySelectorAll('[data-control]').forEach(button=>{
    const key=controls[button.dataset.control];
    button.addEventListener('pointerdown',e=>{e.preventDefault();button.setPointerCapture(e.pointerId);keys.add(key);});
    ['pointerup','pointercancel','lostpointercapture'].forEach(type=>button.addEventListener(type,()=>keys.delete(key)));
  });
  window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);if(game.mapOpen)drawMap($('full-map'),true);});
  $('game-canvas').addEventListener('webglcontextlost',e=>{e.preventDefault();pause(true);show('fatal-error',true);text('fatal-error-message','The graphics connection was interrupted. Reload this page to return to Nanded.');});
}

function inputState(){return {up:keys.has('KeyW')||keys.has('ArrowUp'),down:keys.has('KeyS')||keys.has('ArrowDown'),left:keys.has('KeyA')||keys.has('ArrowLeft'),right:keys.has('KeyD')||keys.has('ArrowRight'),brake:keys.has('Space'),boost:keys.has('ShiftLeft')||keys.has('ShiftRight')};}

function addHeat(amount){game.heat=clamp(game.heat+amount,0,90);game.wanted=Math.min(3,Math.ceil(game.heat/30));game.trouble=game.time;spawnPolice();}

function spawnPolice(){
  police.forEach((p,i)=>{
    if(i>=game.wanted||p.active)return;
    const pos=playerPosition();const x=world.roads.xs.reduce((a,b)=>Math.abs(b-pos.x)<Math.abs(a-pos.x)?b:a);
    p.x=x-5;p.z=clamp(pos.z+70+i*28,-290,275);p.active=true;p.mesh.visible=true;p.health=100;p.path=[];p.repath=0;p.speed=0;
  });
}

function roadPath(from,to){
  const xs=world.roads.xs,zs=world.roads.zs;
  const near=(arr,n)=>arr.reduce((a,b)=>Math.abs(b-n)<Math.abs(a-n)?b:a);
  const sx=near(xs,from.x),sz=near(zs,from.z),tx=near(xs,to.x),tz=near(zs,to.z);
  const fromVertical=Math.abs(from.x-sx)<Math.abs(from.z-sz);
  const toVertical=Math.abs(to.x-tx)<Math.abs(to.z-tz);
  const start=fromVertical?{x:sx-4,z:from.z}:{x:from.x,z:sz+4};
  const end=toVertical?{x:tx-4,z:to.z}:{x:to.x,z:tz+4};
  const route=[start];
  if(fromVertical&&toVertical){if(sx!==tx){route.push({x:sx-4,z:tz+4},{x:tx-4,z:tz+4});}}
  else if(!fromVertical&&!toVertical){if(sz!==tz){route.push({x:tx-4,z:sz+4},{x:tx-4,z:tz+4});}}
  else if(fromVertical)route.push({x:sx-4,z:tz+4});
  else route.push({x:tx-4,z:sz+4});
  route.push(end);return route.filter((p,i)=>i===0||distance(p,route[i-1])>2);
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
    if(hit){p.repath=0;p.speed*=0.6;}
    const lights=p.mesh.userData.lights;if(lights)lights.forEach((light,i)=>light.emissiveIntensity=Math.sin(game.time*12+i*Math.PI)>0?3:0.1);
  }
}

function updatePlayer(dt){
  const input=inputState();
  if(game.onFoot){
    const x=(input.right?1:0)-(input.left?1:0),z=(input.down?1:0)-(input.up?1:0),len=Math.hypot(x,z);
    if(len){
      // Walking uses screen-independent world directions, matching the north-up map.
      const speed=input.boost?9:5;player.heading=Math.atan2(-x,-z);
      moveBody(player,x/len*speed*dt,z/len*speed*dt,0.6,world.colliders,world.bounds);
    }
    avatar.position.set(player.x,0.15,player.z);avatar.rotation.y=player.heading;
    avatar.userData.limbs.forEach((limb,i)=>limb.rotation.x=len?Math.sin(game.time*12+i*Math.PI)*0.45:0);
    lastNearby=cars.filter(v=>v.mesh.visible&&!police.includes(v)&&distance(v,player)<8).sort((a,b)=>distance(a,player)-distance(b,player))[0];
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
    if(game.time-game.trouble>15&&nearest>42&&!(def.chase&&game.mission.status==='active')){
      game.heat=Math.max(0,game.heat-dt*2.8);game.wanted=Math.ceil(game.heat/30);
      if(!game.wanted)toast('The heat is off. You lost the patrol.');
    }
  }
  const result=advanceMission(game.mission,pos,game.onFoot?0:car.speed,!game.onFoot,dt);
  if(result==='complete'){
    game.cash+=def.reward;game.completed++;persist();audio.success();
    if(def.chase){game.wanted=0;game.heat=0;}
    toast(`Job complete. +₹${def.reward.toLocaleString('en-IN')} · Press N for the next job.`,7);
  }else if(result==='checkpoint'){audio.tone(660,0.2);toast(def.stops[game.mission.stage].label,3);}
  else if(result==='failed'){toast('Time’s up. Retry the job when you’re ready.',6);audio.tone(150,0.4);}
  const target=game.mission.status==='active'?def.stops[game.mission.stage]:null;
  marker.visible=Boolean(target);
  if(target){marker.position.set(target.x,0,target.z);arrow.position.y=9+Math.sin(game.time*3)*0.8;arrow.rotation.y=game.time;markerRing.scale.setScalar(1+Math.sin(game.time*2)*0.025);}
}

function updateCamera(dt){
  const p=playerPosition();
  const heading=game.onFoot?0:car.heading;
  const dist=game.onFoot?15:19+Math.min(Math.abs(car.speed)*0.12,5);
  tmp.set(p.x+Math.sin(heading)*dist,game.onFoot?13:10.5,p.z+Math.cos(heading)*dist);
  // Lift the camera above nearby buildings instead of clipping through them.
  for(const b of world.colliders)if(Math.abs(tmp.x-b.x)<b.w/2+1&&Math.abs(tmp.z-b.z)<b.d/2+1)tmp.y=Math.max(tmp.y,(b.h||20)+5);
  camera.position.lerp(tmp,1-Math.exp(-dt*4.5));
  camTarget.set(p.x-Math.sin(heading)*5,1.6,p.z-Math.cos(heading)*5);camera.lookAt(camTarget);
  const fov=52+(!game.onFoot&&inputState().boost&&car.speed>25?6:0);camera.fov=THREE.MathUtils.lerp(camera.fov,fov,dt*3);camera.updateProjectionMatrix();
  game.sun.position.set(p.x-100,150,p.z+90);sunTarget.position.set(p.x,0,p.z);sunTarget.updateMatrixWorld();
}

function district(p){
  if(p.z>220)return 'GODAVARI RIVERFRONT';
  if(p.x>100&&p.z>110)return 'HAZUR SAHIB PRECINCT';
  if(p.z< -195)return 'RAILWAY QUARTER';
  if(p.x< -55)return 'VAZIRABAD';
  if(p.x>150)return 'EAST NANDED';
  return 'SHIVAJI CHOWK';
}

function updateHUD(){
  const p=playerPosition(),m=game.mission,def=MISSIONS[m.index],target=def.stops[m.stage];
  text('district',district(p));text('cash',`₹${game.cash.toLocaleString('en-IN')}`);
  text('wanted','★'.repeat(game.wanted)+'☆'.repeat(3-game.wanted));$('wanted')?.setAttribute('aria-label',`Wanted level ${game.wanted} of 3`);
  text('speed',game.onFoot?'—':String(Math.round(Math.abs(car.speed)*3.6)).padStart(2,'0'));
  text('vehicle-name',game.onFoot?'ON FOOT':VEHICLES[car.kind].name.toUpperCase());
  if($('health-fill'))$('health-fill').style.width=`${clamp(car.health,0,100)}%`;
  if($('nitro-fill'))$('nitro-fill').style.width=`${car.nitro}%`;
  text('mission-label',m.status==='complete'?'JOB COMPLETE':m.status==='failed'?'TRY AGAIN':def.label);
  text('mission-title',def.title);
  text('mission-description',m.status==='complete'?`Nice driving. ₹${def.reward.toLocaleString('en-IN')} earned. Your progress is saved.`:m.status==='failed'?'Every great driver has a bad day. Take another run.':def.description);
  text('mission-progress',m.status==='active'?(def.chase?`Stay ahead · ${Math.max(0,Math.ceil(def.survive-m.elapsed))}s`:target?.label||''):m.status==='complete'?'READY FOR ANOTHER?':'YOUR RIDE IS READY');
  text('mission-distance',m.status==='active'&&target?`${Math.round(distance(p,target))} m`:'');
  const remaining=Math.max(0,Math.ceil(def.seconds-m.elapsed));text('mission-time',m.status==='active'?`${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}`:'');
  show('mission-next',m.status!=='active');text('mission-next',m.status==='failed'?'Retry job ↗':'Next job ↗');
  const nearTarget=target&&distance(p,target)<18&&m.status==='active'&&!def.race;
  const hint=game.capture>0?'PATROL NEARBY · KEEP MOVING':game.onFoot?(lastNearby?`E · Drive ${VEHICLES[lastNearby.kind].name}`:'WASD · Walk   SHIFT · Run'):nearTarget?'SLOW DOWN INSIDE THE AMBER RING':'E · Step out   H · Horn   R · Recover';
  text('interaction',hint);text('map-label',district(p));drawMap($('minimap'),false);
}

function drawMap(canvas,full){
  if(!canvas||!world)return;const ctx=canvas.getContext('2d');if(!ctx)return;
  const w=canvas.width,h=canvas.height,pos=playerPosition();
  const scale=full?w/740:w/245,center=full?{x:0,z:30}:pos;
  const map=p=>({x:w/2+(p.x-center.x)*scale,y:h/2+(p.z-center.z)*scale});
  ctx.clearRect(0,0,w,h);ctx.fillStyle='#172b2b';ctx.fillRect(0,0,w,h);
  const rect=(x,z,bw,bd,color)=>{const p=map({x:x-bw/2,z:z-bd/2});ctx.fillStyle=color;ctx.fillRect(p.x,p.y,bw*scale,bd*scale);};
  rect(0,360,740,120,'#315c60');
  world.colliders.forEach(b=>rect(b.x,b.z,b.w,b.d,'#2c4140'));
  for(const x of world.roads.xs)rect(x,0,world.roads.width,650,'#63716a');
  for(const z of world.roads.zs)rect(0,z,650,world.roads.width,'#63716a');
  const def=MISSIONS[game.mission.index],target=game.mission.status==='active'?def.stops[game.mission.stage]:null;
  if(target){
    const route=[pos,...roadPath(pos,target),target];ctx.beginPath();route.forEach((p,i)=>{const q=map(p);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);});ctx.strokeStyle='#edbb60';ctx.lineWidth=full?3:2;ctx.setLineDash([5,4]);ctx.stroke();ctx.setLineDash([]);
    const t=map(target);ctx.fillStyle='#ffd477';ctx.beginPath();ctx.arc(t.x,t.y,full?8:5,0,Math.PI*2);ctx.fill();
    if(!full&&(t.x<8||t.x>w-8||t.y<8||t.y>h-8)){ctx.beginPath();ctx.arc(clamp(t.x,8,w-8),clamp(t.y,8,h-8),4,0,Math.PI*2);ctx.fill();}
  }
  if(full){
    ctx.font='600 12px system-ui';ctx.textAlign='center';
    for(const l of world.landmarks){const q=map(l);ctx.fillStyle='#d3ddd2';ctx.beginPath();ctx.arc(q.x,q.y,3,0,Math.PI*2);ctx.fill();ctx.fillText(l.name,q.x,q.y-10);}
    ctx.fillStyle='#8fbcbe';ctx.font='italic 15px Georgia';const river=map({x:60,z:350});ctx.fillText('G O D A V A R I',river.x,river.y);
  }
  for(const v of cars){if(!v.mesh.visible||v===car)continue;const p=map(v);ctx.fillStyle=police.includes(v)?'#ef7369':'#b7c4ac';ctx.fillRect(p.x-1.5,p.y-1.5,3,3);}
  const point=map(pos);ctx.save();ctx.translate(point.x,point.y);ctx.rotate(game.onFoot?player.heading:car.heading);ctx.fillStyle='#fff5da';ctx.strokeStyle='#122b2d';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,-9);ctx.lineTo(6,6);ctx.lineTo(0,3);ctx.lineTo(-6,6);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
}

function frame(){
  requestAnimationFrame(frame);const dt=Math.min(clock.getDelta(),0.05);introTime+=dt;
  if(!game.started){
    const orbit=introTime*0.025;camera.position.set(175+Math.sin(orbit)*45,155,310+Math.cos(orbit)*25);camera.lookAt(10,0,50);
    updateTraffic(dt);for(const v of cars){v.mesh.position.set(v.x,0.12,v.z);v.mesh.rotation.y=v.heading;}
  }else if(!game.paused){
    game.time+=dt;game.collisionCooldown=Math.max(0,game.collisionCooldown-dt);
    updateTraffic(dt);updatePlayer(dt);updatePedestrians(dt);updateMission(dt);updateCamera(dt);
    if(game.toastTime>0){game.toastTime-=dt;if(game.toastTime<=0)show('toast',false);}
    lastHUD+=dt;if(lastHUD>0.1){updateHUD();lastHUD=0;}
  }
  world.animate?.(dt,introTime);audio.update(car.speed,game.started&&!game.onFoot,game.paused);
  renderer.render(scene,camera);
}

try{setup();}catch(error){
  console.error('Nanded could not start:',error);
  text('loading-status','GRAPHICS UNAVAILABLE');show('fatal-error',true);
  text('fatal-error-message','The city could not load. Use a current browser with hardware acceleration enabled, then reload the page.');
}
