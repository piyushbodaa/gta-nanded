import test from 'node:test';
import assert from 'node:assert/strict';
import { turnWheel, settleWheel } from '../src/steering-wheel.js';

const close=(a,b,message)=>assert.ok(Math.abs(a-b)<1e-9,`${message}: ${a} != ${b}`);

test('turning the wheel follows the thumb around its centre, including across the ±180° seam',()=>{
  close(turnWheel(0,0,0.5),0.5,'clockwise');
  close(turnWheel(0.5,1,0.2),-0.3,'back past centre');
  close(turnWheel(0,Math.PI-0.1,-Math.PI+0.1),0.2,'a small move across the seam is small');
});

test('the wheel stops at full lock and springs back to centre when released',()=>{
  close(turnWheel(2.5,0,1),2.6,'clamped at full lock');
  close(turnWheel(-2.5,0,-1),-2.6,'both ways');
  let rotation=2.6;for(let i=0;i<60;i++)rotation=settleWheel(rotation,1/60);
  assert.ok(Math.abs(rotation)<0.01,'recentred within a second');
  assert.equal(settleWheel(0.001,0.016),0,'snaps to exact centre');
  close(settleWheel(1,NaN),1,'a bad frame time does not move it');
});
