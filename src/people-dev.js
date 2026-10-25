// Developer harness: a line-up of people in daylight, for looking at bodies, faces and clothes
// close up without loading the city. window.show({...}) poses and frames them (see below).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Humans, makeOutfit } from './actors/humans.js';

const hud = document.getElementById('hud');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fb4c8);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.45;
scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x6b5a48, 0.9));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
sun.position.set(4, 7, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 0.5, far: 30 });
sun.shadow.bias = -0.0004;
scene.add(sun, sun.target);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x77736d, roughness: 0.95 }));
ground.receiveShadow = true;
scene.add(ground);
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 200);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

const humans = new Humans(scene, 64);
humans.blobsOn = false;
let people = [];

/**
 * Pose and frame a line-up. kinds: outfit kinds (or [kind, seed]); pose: 'idle', 'walk', 'run',
 * 'sit'; view: 'front', 'side', 'back', 'three' (three-quarter); focus: index of the person to
 * frame alone ('face' frames their head); lod: 'near' or 'far'; spacing in metres; t: seconds
 * into the pose.
 */
function show({ kinds = ['man', 'woman', 'sikh', 'student', 'elder', 'farmer', 'police', 'goon', 'player'], seed = 3, pose = 'idle', view = 'front', focus = -1, face = false, lod = 'near', spacing = 0.85, t = 1.6, yaw = 0, up = 0 } = {}) {
  for (const h of people) humans.remove(h);
  people = kinds.map((k, i) => {
    const [kind, s] = Array.isArray(k) ? k : [k, seed + i * 17];
    const h = humans.add(makeOutfit(kind, s), (i - (kinds.length - 1) / 2) * spacing, 0);
    h.yaw = yaw;
    return h;
  });
  humans.nearRadius = lod === 'near' ? 999 : 0; humans.nearMax = 64;
  const speed = pose === 'walk' ? 1.35 : pose === 'run' ? 4.2 : 0, dt = 1 / 60;
  for (let k = 0; k < Math.round(t / dt); k++) {
    for (const h of people) {
      h.pose = pose === 'sit' ? 'sit' : speed > 3 ? 'run' : speed > 0 ? 'walk' : 'idle';
      h.speed = speed;
      h.z += Math.cos(h.yaw) * speed * dt; h.x += Math.sin(h.yaw) * speed * dt;
      if (pose === 'sit') { h.seatY = 0.5; h.vType = 'car'; h.vDriver = false; }
    }
    humans.update(dt, camera.position, null);
  }
  // Frame them.
  const sel = focus >= 0 ? [people[focus]] : people;
  const cx = sel.reduce((a, h) => a + h.x, 0) / sel.length, cz = sel.reduce((a, h) => a + h.z, 0) / sel.length;
  const width = focus >= 0 ? 0.8 : Math.max(1, (sel.length - 1) * spacing + 0.8);
  const a = { front: 0, side: Math.PI / 2, back: Math.PI, three: 0.6 }[view] ?? view;
  const lookY = face ? 1.55 : 0.9, dist = face ? 0.75 : Math.max(width, 2.2) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect) * 1.15 + 0.6;
  camera.position.set(cx + Math.sin(a) * dist, lookY + (face ? 0.02 : 0.25) + up, cz + Math.cos(a) * dist);
  camera.lookAt(cx, lookY, cz);
  sun.target.position.set(cx, 0, cz); sun.position.set(cx + 4, 7, cz + 5);
  renderer.render(scene, camera);
  const near = humans.nNear, far = humans.n - humans.nNear;
  hud.textContent = `${pose} ${view} near ${near} far ${far}  tris ${renderer.info.render.triangles}`;
  return { near, far };
}
window.show = show; window.humans = humans; window.renderer = renderer; window.camera = camera; window.scene = scene;
const params = new URLSearchParams(location.search);
show(params.has('o') ? JSON.parse(params.get('o')) : {});
window.ready = true;
