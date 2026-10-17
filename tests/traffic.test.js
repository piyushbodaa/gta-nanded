import test from 'node:test';
import assert from 'node:assert/strict';
import { laneOffsetPoint, gapAhead, trafficTargetSpeed } from '../src/traffic.js';

test('traffic keeps to the left of its direction of travel, as on Indian roads',()=>{
  // Heading north (towards -z): left is west (-x).
  assert.deepEqual(laneOffsetPoint({x:0,z:10},{x:0,z:0},1.5),{x:-1.5,z:0});
  // Heading east (+x): left is north (-z).
  assert.deepEqual(laneOffsetPoint({x:0,z:0},{x:10,z:0},2),{x:10,z:-2});
  // The return trip on the same street uses the other side.
  assert.deepEqual(laneOffsetPoint({x:10,z:0},{x:0,z:0},2),{x:0,z:2});
  assert.deepEqual(laneOffsetPoint({x:3,z:3},{x:3,z:3},2),{x:3,z:3},'a zero-length segment stays put');
});

test('only bodies ahead within the lane count as a queue',()=>{
  const car={x:0,z:0,heading:0}; // facing -z
  assert.equal(gapAhead(car,[{x:0,z:-12}]),12);
  assert.equal(gapAhead(car,[{x:0,z:12}]),Infinity,'behind');
  assert.equal(gapAhead(car,[{x:4,z:-10}]),Infinity,'oncoming lane');
  assert.equal(gapAhead(car,[{x:1,z:-40}]),Infinity,'beyond range');
  assert.equal(gapAhead(car,[car,{x:0.5,z:-20},{x:-1,z:-9}]),9,'nearest of several, ignoring itself');
});

test('cruise speed eases for junctions and stops behind the queue',()=>{
  assert.equal(trafficTargetSpeed(12),12);
  assert.ok(trafficTargetSpeed(12,{junctionDistance:2})<7,'slow into a junction');
  assert.equal(trafficTargetSpeed(12,{junctionDistance:30}),12);
  assert.equal(trafficTargetSpeed(12,{gap:6}),0,'stop a car length behind');
  assert.ok(trafficTargetSpeed(12,{gap:15})<12&&trafficTargetSpeed(12,{gap:15})>0,'follow at a gap');
});
