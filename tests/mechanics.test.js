import test from 'node:test';
import assert from 'node:assert/strict';
import { moveBody, driveStep, MISSIONS, newMission, advanceMission, loadProgress, saveProgress } from '../src/mechanics.js';

const bounds={minX:-100,maxX:100,minZ:-100,maxZ:100};
test('fast vehicles cannot tunnel through a thin wall',()=>{
  const p={x:-30,z:0};const hit=moveBody(p,80,0,1.5,[{x:0,z:0,w:1,d:50}],bounds);
  assert.equal(hit,true);assert.ok(p.x< -1.9);assert.equal(p.z,0);
});
test('collisions slide alongside walls and respect world boundaries',()=>{
  const p={x:-3,z:0};moveBody(p,10,20,1,[{x:0,z:0,w:2,d:90}],bounds);
  assert.ok(p.x<=-2);assert.ok(p.z>=19);
  moveBody(p,-1000,0,1,[],bounds);assert.ok(p.x>=-99);
});
test('accelerate, steer, brake, reverse and exhaust finite boost',()=>{
  const c={kind:'hatchback',speed:0,heading:0,nitro:100};
  for(let i=0;i<300;i++)driveStep(c,{up:true,boost:true},1/60);
  assert.ok(c.speed>30);assert.ok(c.nitro>=0&&c.nitro<10);
  const angle=c.heading;driveStep(c,{left:true},0.1);assert.ok(c.heading>angle);
  for(let i=0;i<120;i++)driveStep(c,{brake:true},1/60);assert.ok(c.speed<1);
  for(let i=0;i<120;i++)driveStep(c,{down:true},1/60);assert.ok(c.speed<0);
});
test('Zenda homecoming starts with a deliberate conversation on foot',()=>{
  const m=newMission(0),def=MISSIONS[0];
  assert.equal(def.startMode,'foot');assert.equal(def.stops[0].action,'interact');
  assert.equal(advanceMission(m,def.stops[0],0,false,1),null);
  assert.equal(advanceMission(m,def.stops[0],0,true,0,'interact'),null);
  assert.equal(advanceMission(m,{x:0,z:0},0,false,0,'interact'),null);
  assert.equal(advanceMission(m,def.stops[0],0,false,0,'photo'),null);
  assert.equal(advanceMission(m,def.stops[0],0,false,0,'interact'),'checkpoint');
  assert.equal(m.stage,1);
  assert.equal(advanceMission(m,def.stops[1],0,true,1),null);
  assert.equal(advanceMission(m,def.stops[1],0,false,0.4),'checkpoint');
  assert.equal(advanceMission(m,def.stops[2],0,false,10),null);
  assert.equal(advanceMission(m,def.stops[2],0,false,0,'photo'),'complete');
  assert.equal(m.status,'complete');
  assert.equal(advanceMission(m,def.stops[2],0,false,0,'photo'),null);
});

test('photo objectives require an explicit photo while on foot at the current landmark',()=>{
  const index=MISSIONS.findIndex(def=>def.id==='hazur-postcards'),m=newMission(index),def=MISSIONS[index];
  assert.equal(advanceMission(m,def.stops[1],0,false,0,'photo'),null,'later landmark cannot skip the current one');
  assert.equal(advanceMission(m,def.stops[0],0,true,0,'photo'),null,'stay in a vehicle does not count');
  assert.equal(advanceMission(m,def.stops[0],0,false,0,'interact'),null,'talk is not a photograph');
  assert.equal(advanceMission(m,def.stops[0],0,false,30),null,'waiting does not take a photo');
  assert.equal(advanceMission(m,def.stops[0],0,false,0,'photo'),'checkpoint');
  assert.equal(advanceMission(m,def.stops[0],0,false,0,'photo'),null,'repeated press cannot complete the next landmark');
  assert.equal(advanceMission(m,def.stops[1],0,false,0,'photo'),'complete');
});

test('an action at the advertised radius is accepted while one beyond it is rejected',()=>{
  const m=newMission(0),stop=MISSIONS[0].stops[0];
  assert.equal(advanceMission(m,{x:stop.x+stop.radius+0.01,z:stop.z},0,false,0,'interact'),null);
  assert.equal(advanceMission(m,{x:stop.x+stop.radius,z:stop.z},0,false,0,'interact'),'checkpoint');
});

test('untimed exploration remains active after a long break and accepts an action without a frame tick',()=>{
  const m=newMission(0),stop=MISSIONS[0].stops[0];
  assert.equal(MISSIONS[0].seconds,null);
  assert.equal(advanceMission(m,stop,0,false,36000),null);
  assert.equal(m.status,'active');assert.equal(m.elapsed,36000);
  assert.equal(advanceMission(m,stop,0,false,0,'interact'),'checkpoint');
  advanceMission(m,{x:0,z:0},0,false,-100);
  advanceMission(m,{x:0,z:0},0,false,NaN);
  assert.equal(m.elapsed,36000,'invalid time cannot rewind or corrupt progress');
});

test('arrival dwell resets after leaving the checkpoint',()=>{
  const m=newMission(0),def=MISSIONS[0];
  advanceMission(m,def.stops[0],0,false,0,'interact');
  assert.equal(advanceMission(m,def.stops[1],0,false,0.25),null);
  assert.equal(advanceMission(m,{x:0,z:0},0,false,0.1),null);
  assert.equal(advanceMission(m,def.stops[1],0,false,0.25),null);
  assert.equal(m.stage,1);
  assert.equal(advanceMission(m,def.stops[1],0,false,0.15),'checkpoint');
});

test('race requires all ordered checkpoints and permits full speed',()=>{
  const index=MISSIONS.findIndex(def=>def.race),m=newMission(index),def=MISSIONS[index];
  assert.equal(advanceMission(m,def.stops[1],38,true,0.05),null);
  assert.equal(advanceMission(m,def.stops[0],0,false,0.05),null);
  for(const [i,p] of def.stops.entries())assert.equal(advanceMission(m,p,38,true,0.05),i===def.stops.length-1?'complete':'checkpoint');
});

test('foot sprint requires all rings on foot and fails when its timer expires',()=>{
  const index=MISSIONS.findIndex(def=>def.sprint),m=newMission(index),def=MISSIONS[index];
  assert.equal(advanceMission(m,def.stops[0],15,true,0.1),null);
  for(const [i,p] of def.stops.entries())assert.equal(advanceMission(m,p,9,false,0.05),i===def.stops.length-1?'complete':'checkpoint');
  const expired=newMission(index);
  assert.equal(advanceMission(expired,def.stops[0],0,false,def.seconds+0.01),'failed');
  assert.equal(advanceMission(expired,def.stops[0],0,false,0),null);
});

test('chase completes once after survival time and a failed chase cannot award completion',()=>{
  const index=MISSIONS.findIndex(def=>def.chase),def=MISSIONS[index],chase=newMission(index);
  assert.equal(advanceMission(chase,{x:0,z:0},30,true,def.survive-1),null);
  assert.equal(advanceMission(chase,{x:0,z:0},30,true,1),'complete');
  assert.equal(advanceMission(chase,{x:0,z:0},30,true,1),null);
  const expired=newMission(index);
  assert.equal(advanceMission(expired,{x:0,z:0},30,true,def.seconds+1),'failed');
  assert.equal(advanceMission(expired,{x:0,z:0},30,true,1),null);
});
test('all adventures replay after a full circuit',()=>assert.equal(newMission(MISSIONS.length).index,0));
test('saved progress survives reload; corrupted or unavailable storage is safe',()=>{
  let value;const storage={getItem:()=>value,setItem:(k,v)=>value=v};
  assert.equal(saveProgress(storage,{cash:450,completed:1}),true);assert.deepEqual(loadProgress(storage),{cash:450,completed:1});
  value='broken';assert.deepEqual(loadProgress(storage),{cash:0,completed:0});
  value=JSON.stringify({cash:-100,completed:'oops'});assert.deepEqual(loadProgress(storage),{cash:0,completed:0});
  assert.equal(saveProgress({setItem(){throw Error();}},{}),false);
});
