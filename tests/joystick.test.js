import test from 'node:test';
import assert from 'node:assert/strict';
import { joystickAxes } from '../src/joystick.js';

const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`);

test('a resting thumb inside the dead zone gives no input',()=>{
  assert.deepEqual(joystickAxes(0,0,60),{x:0,y:0});
  assert.deepEqual(joystickAxes(5,-4,60),{x:0,y:0});
  assert.deepEqual(joystickAxes(10,10,0),{x:0,y:0},'a collapsed pad must not divide by zero');
});

test('screen up drives forward and right steers right, saturating just inside the rim',()=>{
  const up=joystickAxes(0,-60,60);close(up.x,0,'up x');close(up.y,1,'up y');
  const right=joystickAxes(51,0,60);close(right.x,1,'right reaches full lock at 85%');close(right.y,0,'right y');
  const beyond=joystickAxes(0,300,60);close(beyond.y,-1,'dragging past the rim stays at full reverse');
});

test('partial pushes scale smoothly and diagonals keep their direction',()=>{
  const half=joystickAxes(0,-0.485*60,60);close(half.y,0.5,'midway between dead zone and saturation');
  const diagonal=joystickAxes(40,-40,60);close(diagonal.x,diagonal.y,'up-right pushes forward and right equally');
  assert.ok(Math.hypot(diagonal.x,diagonal.y)<=1+1e-9);
});
