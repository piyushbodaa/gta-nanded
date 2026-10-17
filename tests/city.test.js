import test from 'node:test';
import assert from 'node:assert/strict';
import { NETWORK, PLACES, SPAWN, BOUNDS } from '../src/city-data.js';
import { createNavigator, pathLength, projectToSegment, indexColliders } from '../src/navigation.js';
import { blocked, moveBody, MISSIONS, newMission, advanceMission } from '../src/mechanics.js';

const nav=createNavigator(NETWORK);
const colliders=indexColliders(PLACES.map(p=>({...p})));

test('all places have unique identities, provenance, honest precision and finite geometry',()=>{
  assert.equal(PLACES.length,133);assert.equal(new Set(PLACES.map(p=>p.id)).size,PLACES.length);
  for(const p of PLACES){
    assert.ok(p.name&&p.area&&p.address&&p.sourceUrl.startsWith('https://'),p.id);
    assert.ok(['mapped','area'].includes(p.locationPrecision),p.id);
    for(const key of ['lat','lon','x','z','w','d','h','rotation'])assert.ok(Number.isFinite(p[key]),`${p.id}:${key}`);
    assert.ok(p.w>0&&p.d>0&&p.h>0,p.id);
    assert.equal(blocked(p.approach.x,p.approach.z,2,colliders,BOUNDS),false,p.id);
  }
});

test('new games start on the road at the public Zenda Chowk pin in Taroda Khurd',()=>{
  const zenda=PLACES.find(p=>p.id==='zenda-chowk');
  assert.equal(SPAWN.placeId,zenda.id);
  assert.equal(SPAWN.area,'Taroda Khurd');
  assert.equal(zenda.lat,19.1930005);assert.equal(zenda.lon,77.291982);
  assert.ok(Math.hypot(SPAWN.x-zenda.geoX,SPAWN.z-zenda.geoZ)/NETWORK.scale<30);
  assert.ok(nav.nearest(SPAWN).distance<0.1);
  assert.equal(blocked(SPAWN.x,SPAWN.z,1.7,colliders,BOUNDS),false);
});

test('every researched place has a connected street route from the starting point',()=>{
  for(const p of PLACES){
    const route=nav.route(SPAWN,p.approach);
    assert.ok(route.length>=2,`${p.id} has no route`);
    assert.ok(Math.hypot(route.at(-1).x-p.approach.x,route.at(-1).z-p.approach.z)<0.1,p.id);
    // Every interior hop must be an actual OSM edge, including bends/junctions.
    for(let i=2;i<route.length-1;i++){
      const a=route[i-1],b=route[i];
      if(a.node!==undefined&&b.node!==undefined)assert.ok(nav.adj[a.node].some(e=>e.to===b.node),`${p.id}: invented road hop`);
    }
    assert.ok(Number.isFinite(pathLength(route)),p.id);
  }
});

test('all adventure starts and checkpoints are clear and complete using their required modes/actions',()=>{
  assert.equal(new Set(MISSIONS.map(def=>def.id)).size,MISSIONS.length);
  for(const [index,def] of MISSIONS.entries()){
    assert.ok(def.id&&def.kind&&def.shortDescription,def.title);
    assert.ok(['foot','vehicle'].includes(def.startMode),def.id);
    assert.ok(Number.isFinite(def.start.x)&&Number.isFinite(def.start.z)&&Number.isFinite(def.start.heading),def.id);
    assert.equal(blocked(def.start.x,def.start.z,1.6,colliders,BOUNDS),false,`${def.id}: start`);
    const mission=newMission(index);
    if(def.chase){assert.equal(advanceMission(mission,SPAWN,20,true,def.survive),'complete');continue;}
    for(const [i,stop] of def.stops.entries()){
      assert.equal(blocked(stop.x,stop.z,1.6,colliders,BOUNDS),false,stop.placeId);
      assert.equal(advanceMission(mission,stop,def.race?38:0,stop.mode==='vehicle',0.5,stop.action),i===def.stops.length-1?'complete':'checkpoint');
    }
    assert.equal(mission.status,'complete',def.title);
  }
});

test('the street circuit starts on the road behind its first checkpoint, facing a clear run to it',()=>{
  const index=MISSIONS.findIndex(def=>def.race),def=MISSIONS[index],first=def.stops[0],start=def.start;
  assert.ok(nav.nearest(start).distance<0.05,'grid must be on a mapped street');
  const gap=Math.hypot(first.x-start.x,first.z-start.z);
  assert.ok(gap>first.radius+5&&gap<60,`start line ${gap} units ahead`);
  const forward={x:-Math.sin(start.heading),z:-Math.cos(start.heading)};
  assert.ok((forward.x*(first.x-start.x)+forward.z*(first.z-start.z))/gap>0.98,'car faces the first checkpoint');
  for(let t=0;t<=1;t+=0.02)assert.equal(blocked(start.x+(first.x-start.x)*t,start.z+(first.z-start.z)*t,1.7,colliders,BOUNDS),false,`run-up blocked at ${t}`);
  assert.equal(advanceMission(newMission(index),start,0,true,0.05),null,'checkpoint 1 must not complete at the grid');
});

test('the first on-foot adventure stays in the Zenda lane and uses connected mapped streets',()=>{
  const first=MISSIONS[0];
  assert.equal(first.id,'zenda-homecoming');assert.equal(first.startMode,'foot');assert.equal(first.seconds,null);
  let previous=SPAWN,totalLength=0;
  for(const stop of first.stops){
    assert.equal(stop.mode,'foot');assert.equal(stop.placeId,'zenda-chowk');
    assert.ok(Math.hypot(stop.x-SPAWN.x,stop.z-SPAWN.z)<30,'first minute must not become a city commute');
    assert.ok(nav.nearest(stop).distance<0.02,'lane checkpoint must be on a mapped street');
    totalLength+=pathLength(nav.route(previous,stop));previous=stop;
  }
  assert.ok(totalLength<45,`${totalLength} world units of walking`);
});

test('rotated building collision and spatial index agree with full geometry',()=>{
  const bounds={minX:-100,maxX:100,minZ:-100,maxZ:100};
  const boxes=[{x:0,z:0,w:4,d:20,rotation:Math.PI/4}];
  const indexed=indexColliders([...boxes],10);
  for(let x=-20;x<20;x+=1.3)for(let z=-20;z<20;z+=1.3)assert.equal(blocked(x,z,1.5,boxes,bounds),blocked(x,z,1.5,indexed,bounds));
  const p={x:-20,z:0};assert.equal(moveBody(p,40,0,1.5,indexed,bounds),true);assert.ok(p.x<0);
});

test('projection and same-edge routing do not detour via distant intersections',()=>{
  assert.deepEqual(projectToSegment({x:5,z:4},{x:0,z:0},{x:10,z:0}),{x:5,z:0,t:.5,distance:4});
  const small=createNavigator({nodes:[{x:0,z:0},{x:100,z:0},{x:100,z:100}],edges:[{a:0,b:1,width:10},{a:1,b:2,width:10}]});
  assert.equal(pathLength(small.route({x:30,z:2},{x:45,z:3})),15);
  assert.equal(pathLength(small.route({x:30,z:2},{x:101,z:20})),90);
});
