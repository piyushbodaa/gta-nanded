import test from 'node:test';
import assert from 'node:assert/strict';
import { NETWORK, PLACES, SPAWN, BOUNDS } from '../src/city-data.js';
import { createNavigator, pathLength, projectToSegment, indexColliders } from '../src/navigation.js';
import { blocked, moveBody, MISSIONS, newMission, advanceMission } from '../src/mechanics.js';

const nav=createNavigator(NETWORK);
const colliders=indexColliders(PLACES.map(p=>({...p})));

test('all places have unique identities, provenance, honest precision and finite geometry',()=>{
  assert.equal(PLACES.length,129);assert.equal(new Set(PLACES.map(p=>p.id)).size,PLACES.length);
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

test('route arrivals are driveable and all local jobs can complete in order',()=>{
  for(const [index,def] of MISSIONS.entries()){
    const mission=newMission(index);
    if(def.chase){assert.equal(advanceMission(mission,SPAWN,20,true,def.survive),'complete');continue;}
    for(const [i,stop] of def.stops.entries()){
      assert.equal(blocked(stop.x,stop.z,1.6,colliders,BOUNDS),false,stop.placeId);
      assert.equal(advanceMission(mission,stop,def.race?38:0,true,0.5),i===def.stops.length-1?'complete':'checkpoint');
    }
    assert.equal(mission.status,'complete',def.title);
  }
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
