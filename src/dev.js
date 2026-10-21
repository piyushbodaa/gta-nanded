// Developer harness: free-fly camera over the generated city.
import * as THREE from 'three';
import { createWorld } from './world/world.js';

const hud = document.getElementById('hud');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.3, 900);
const params = new URLSearchParams(location.search);
const start = { x: Number(params.get('x') ?? 463), z: Number(params.get('z') ?? 380) };
camera.position.set(start.x, Number(params.get('y') ?? 40), start.z + 60);
let yaw = Number(params.get('yaw') ?? 0), pitch = Number(params.get('pitch') ?? -0.35);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

const world = await createWorld(scene, renderer, { stage: (l, f) => (hud.textContent = `${l} ${(f * 100) | 0}%`), focus: start });
window.world = world; window.camera = camera; window.renderer = renderer; window.scene = scene;
if (params.get('h')) world.sky.hours = Number(params.get('h'));
if (params.get('w')) world.sky.setWeather(params.get('w'));
const keys = new Set();
addEventListener('keydown', e => keys.add(e.code));
addEventListener('keyup', e => keys.delete(e.code));
let drag = null;
addEventListener('pointerdown', e => (drag = { x: e.clientX, y: e.clientY }));
addEventListener('pointerup', () => (drag = null));
addEventListener('pointermove', e => { if (!drag) return; yaw -= (e.clientX - drag.x) * 0.004; pitch = Math.max(-1.5, Math.min(1.5, pitch - (e.clientY - drag.y) * 0.004)); drag = { x: e.clientX, y: e.clientY }; });
const clock = new THREE.Clock();
let frames = 0, acc = 0, fps = 0, shadowAt = new THREE.Vector3(1e9, 0, 0);
window.dev = { setView(x, y, z, yw, p) { camera.position.set(x, y, z); yaw = yw; pitch = p; } };
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.1);
  frames++; acc += dt; if (acc > 1) { fps = frames / acc; frames = 0; acc = 0; }
  const speed = keys.has('ShiftLeft') ? 120 : 30;
  const f = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  const r = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  if (keys.has('KeyW')) camera.position.addScaledVector(f, speed * dt);
  if (keys.has('KeyS')) camera.position.addScaledVector(f, -speed * dt);
  if (keys.has('KeyD')) camera.position.addScaledVector(r, speed * dt);
  if (keys.has('KeyA')) camera.position.addScaledVector(r, -speed * dt);
  if (keys.has('KeyE')) camera.position.y += speed * dt;
  if (keys.has('KeyQ')) camera.position.y -= speed * dt;
  if (keys.has('KeyT')) world.sky.hours = (world.sky.hours + dt * 2) % 24;
  camera.lookAt(camera.position.clone().add(f));
  world.chunks.update(camera.position.x, camera.position.z, 6);
  world.sky.update(dt, { x: camera.position.x, z: camera.position.z });
  world.sky.placeDome(camera);
  world.rivers.update(dt);
  world.cityUniforms.uNight.value = world.sky.night;
  world.chunks.setNight(world.sky.night);
  if (shadowAt.distanceTo(camera.position) > 8) { renderer.shadowMap.needsUpdate = true; shadowAt.copy(camera.position); }
  renderer.render(scene, camera);
  const info = renderer.info.render;
  hud.textContent = `fps ${fps.toFixed(0)}  calls ${info.calls}  tris ${(info.triangles / 1000).toFixed(0)}k  chunks ${world.chunks.chunks.size}  built ${world.chunks.stats.built} avg ${(world.chunks.stats.ms / Math.max(1, world.chunks.stats.built)).toFixed(1)}ms\n` +
    `pos ${camera.position.x.toFixed(0)},${camera.position.y.toFixed(0)},${camera.position.z.toFixed(0)}  time ${world.sky.clockText()}  gen ${world.city.genTime.toFixed(0)}ms lots ${world.city.lots.count}`;
}
frame();
