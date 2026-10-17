import test from 'node:test';
import assert from 'node:assert/strict';
import { createVehicle, createPerson, createAnimal } from '../src/vehicles.js';
import { VEHICLES } from '../src/mechanics.js';

const KINDS = ['hatchback', 'sedan', 'police', 'auto', 'bike', 'bus', 'truck', 'tractor', 'tempo', 'cart'];
function meshes(group) { const found = []; group.traverse(o => { if (o.isMesh) found.push(o); }); return found; }

test('every drivable kind has a model and driving specs, so traffic can never spawn an undefined vehicle', () => {
  for (const kind of KINDS) {
    const vehicle = createVehicle(kind, '#a03c2e');
    assert.ok(meshes(vehicle).length >= 3, kind);
    if (kind !== 'cart') assert.ok(VEHICLES[kind], `${kind} needs mechanics specs`);
    for (const mesh of meshes(vehicle)) assert.ok(mesh.geometry.attributes.position.count > 0, kind);
  }
  assert.ok(createVehicle('police').userData.lights?.length === 2, 'patrol lights stay flashable');
});

test('vehicle geometry is built once per kind and shared between instances', () => {
  const a = createVehicle('truck', '#123456'), b = createVehicle('truck', '#654321');
  assert.equal(meshes(a)[0].geometry, meshes(b)[0].geometry, 'same kind reuses merged geometry');
  assert.notEqual(meshes(a)[0], meshes(b)[0], 'meshes themselves stay independent');
  const hatch = createVehicle('hatchback'), sedan = createVehicle('sedan');
  assert.notEqual(meshes(hatch)[0].geometry, meshes(sedan)[0].geometry, 'different body lengths are different templates');
});

test('people and animals keep the four-limb contract the walk animation drives', () => {
  for (const style of ['plain', 'dastar', 'topi', 'pheta', 'namaz', 'hijab', 'helmet', 'sari', 'student']) {
    const person = createPerson('#e88a4e', style, 2);
    assert.equal(person.userData.limbs.length, 4, style);
    assert.ok(meshes(person).length >= 7, style);
  }
  for (const kind of ['cow', 'buffalo', 'dog']) assert.equal(createAnimal(kind).userData.limbs.length, 4, kind);
  const a = createPerson('#e88a4e'), b = createPerson('#e88a4e');
  assert.equal(meshes(a)[0].geometry, meshes(b)[0].geometry, 'people share unit geometry');
  assert.equal(meshes(a)[0].material, meshes(b)[0].material, 'same shirt colour shares a material');
});
