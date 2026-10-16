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
test('delivery requires a vehicle, slowing down, and both stops',()=>{
  const m=newMission(0),def=MISSIONS[0];
  advanceMission(m,def.stops[0],0,false,1);assert.equal(m.stage,0);
  advanceMission(m,def.stops[0],30,true,1);assert.equal(m.stage,0);
  assert.equal(advanceMission(m,def.stops[0],0,true,0.5),'checkpoint');
  assert.equal(advanceMission(m,def.stops[1],0,true,0.5),'complete');assert.equal(m.status,'complete');
  assert.equal(advanceMission(m,def.stops[1],0,true,0.5),null);
});
test('race requires all ordered checkpoints and permits full speed',()=>{
  const m=newMission(2);for(const [i,p] of MISSIONS[2].stops.entries())assert.equal(advanceMission(m,p,38,true,0.05),i===4?'complete':'checkpoint');
});
test('mission expiry cannot be awarded and chase completes after survival time',()=>{
  const m=newMission(1);assert.equal(advanceMission(m,MISSIONS[1].stops[0],0,true,151),'failed');
  const chase=newMission(3);assert.equal(advanceMission(chase,{x:0,z:0},30,true,49),null);assert.equal(advanceMission(chase,{x:0,z:0},30,true,1),'complete');
});
test('all five jobs replay after a full circuit',()=>assert.equal(newMission(5).index,0));
test('saved progress survives reload; corrupted or unavailable storage is safe',()=>{
  let value;const storage={getItem:()=>value,setItem:(k,v)=>value=v};
  assert.equal(saveProgress(storage,{cash:450,completed:1}),true);assert.deepEqual(loadProgress(storage),{cash:450,completed:1});
  value='broken';assert.deepEqual(loadProgress(storage),{cash:0,completed:0});
  value=JSON.stringify({cash:-100,completed:'oops'});assert.deepEqual(loadProgress(storage),{cash:0,completed:0});
  assert.equal(saveProgress({setItem(){throw Error();}},{}),false);
});
