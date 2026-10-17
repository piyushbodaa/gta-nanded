import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Shared materials/geometries: the city spawns dozens of vehicles and people,
// and building fresh geometry for every one of them was pure startup waste.
const black = new THREE.MeshStandardMaterial({ color: '#202b2c', roughness: 0.85 });
const glass = new THREE.MeshStandardMaterial({ color: '#284c54', roughness: 0.22, metalness: 0.35 });
const chrome = new THREE.MeshStandardMaterial({ color: '#ccd6cf', roughness: 0.3, metalness: 0.65 });
const headlight = new THREE.MeshStandardMaterial({ color: '#fff0b5', emissive:'#ffe9a2', emissiveIntensity:0.65 });
const tail = new THREE.MeshStandardMaterial({color:'#b02c26',emissive:'#e33c26',emissiveIntensity:0.4});
const autoYellow = new THREE.MeshStandardMaterial({ color: '#f7bf44', roughness: 0.55 });
const creamBand = new THREE.MeshStandardMaterial({ color: '#fff3d6', roughness: 0.4 });
const policeRed = new THREE.MeshStandardMaterial({ color:'#ff3232', emissive:'#ff2222', emissiveIntensity:1 });
const policeBlue = new THREE.MeshStandardMaterial({ color:'#389dff', emissive:'#1674ff', emissiveIntensity:1 });
const wheelGeometry = new THREE.CylinderGeometry(0.48,0.48,0.32,12);
wheelGeometry.rotateZ(Math.PI/2);
const hubGeometry = new THREE.CylinderGeometry(0.24,0.24,0.34,8);
hubGeometry.rotateZ(Math.PI/2);
const smallWheelGeometry = new THREE.CylinderGeometry(0.34,0.34,0.14,10);
smallWheelGeometry.rotateZ(Math.PI/2);
const bigWheelGeometry = new THREE.CylinderGeometry(0.62,0.62,0.3,12);
bigWheelGeometry.rotateZ(Math.PI/2);

// One paint material per colour, reused by every vehicle that asks for it.
const paintCache = new Map();
function paintFor(color) {
  if (!paintCache.has(color)) paintCache.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.2 }));
  return paintCache.get(color);
}

// MH-26 is the Nanded RTO code: every local plate starts with it. One small
// canvas texture, shared by all vehicles (plain white where canvas is absent).
let plateMaterial = null;
function getPlateMaterial() {
  if (plateMaterial) return plateMaterial;
  if (typeof document === 'undefined' || !document.createElement) {
    plateMaterial = new THREE.MeshStandardMaterial({ color: '#f4f4ee', roughness: 0.5 });
    return plateMaterial;
  }
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f7f7f2'; ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#28418c'; ctx.fillRect(0, 0, 34, 64);
  ctx.fillStyle = '#ffffff'; ctx.font = '700 20px Arial'; ctx.textAlign = 'center';
  ctx.fillText('IND', 17, 40);
  ctx.fillStyle = '#181c1e'; ctx.font = '800 40px Arial';
  ctx.fillText('MH 26', 145, 45);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  plateMaterial = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.5 });
  return plateMaterial;
}

const ROLE_MATERIALS = { black, glass, chrome, headlight, tail, yellow: autoYellow, band: creamBand, red: policeRed, blue: policeBlue };
const templateCache = new Map();

/** Merged geometry per vehicle kind and material role, built once. */
function vehicleTemplate(kind) {
  if (templateCache.has(kind)) return templateCache.get(kind);
  const bins = new Map();
  function add(geo, role, x, y, z) {
    const g = geo.clone(); g.translate(x, y, z);
    if (!bins.has(role)) bins.set(role, []);
    bins.get(role).push(g);
  }
  function box(w, h, d, x, y, z, role = 'paint') { add(new THREE.BoxGeometry(w, h, d), role, x, y, z); }
  function plates(w, frontZ, backZ, y = 0.72) {
    box(Math.min(w, 1.05), 0.26, 0.05, 0, y, frontZ, 'plate');
    box(Math.min(w, 1.05), 0.26, 0.05, 0, y, backZ, 'plate');
  }
  if (kind === 'auto') {
    // Maharashtra autos are black with a yellow front cowl and band, never green.
    box(1.85,0.68,2.9,0,0.78,0.2,'black');
    box(1.9,0.18,2.45,0,2.32,0.25,'yellow');
    box(1.85,0.8,0.13,0,1.65,1.4,'black');
    box(1.5,0.7,0.08,0,1.7,-1.04,'glass');
    box(1.85,0.65,0.52,0,1,-1.15,'yellow');
    box(1.88,0.16,2.2,0,1.18,0.25,'yellow');
    for(const x of [-0.85,0.85]) {
      box(0.09,1.25,0.09,x,1.7,-0.97,'chrome');
      box(0.09,1.25,0.09,x,1.7,1.35,'black');
      box(0.11,0.8,1.5,x,1.4,0.4,'black');
      add(wheelGeometry,'black',x,0.48,0.85);
      box(0.22,0.19,0.12,x*0.7,1.13,-1.43,'headlight');
    }
    add(wheelGeometry,'black',0,0.48,-1.2);
    box(1.3,0.18,0.7,0,1.15,0.7,'black');
    plates(1.2,-1.47,1.68,0.62);
  } else if (kind === 'tempo') {
    // The boxy goods three-wheeler that ferries crates around Mondha market.
    box(1.8,0.7,1.1,0,0.85,-1.35,'black');
    box(1.5,0.65,0.08,0,1.65,-1.42,'glass');
    box(1.85,0.16,1.15,0,2.05,-1.3,'yellow');
    box(2,1.55,2.5,0,1.55,0.55,'paint');
    box(2.04,0.18,2.55,0,2.4,0.55,'black');
    for(const z of [-0.45,0.55,1.55]) box(2.06,0.1,0.1,0,1.5,z,'black');
    for(const x of [-0.85,0.85]) {
      add(wheelGeometry,'black',x,0.48,1.15);
      box(0.22,0.19,0.12,x*0.7,1.05,-1.92,'headlight');
    }
    add(wheelGeometry,'black',0,0.48,-1.75);
    plates(1.2,-1.95,1.83,0.62);
  } else if (kind === 'bike') {
    // A two-wheeler; the rider is added per vehicle so colours can vary.
    add(smallWheelGeometry,'black',0,0.34,1.05);add(smallWheelGeometry,'black',0,0.34,-1.05);
    box(0.22,0.5,2.2,0,0.7,0);
    box(0.5,0.22,0.9,0,0.95,0.15,'black');
    box(0.9,0.06,0.08,0,1.25,0.85,'chrome');
    box(0.14,0.7,0.14,0,1.0,0.9,'chrome');
    box(0.2,0.2,0.2,0,0.95,-0.7,'tail');
    box(0.18,0.16,0.12,0,0.82,1.12,'headlight');
  } else if (kind === 'bus') {
    // MSRTC "Lal Pari" (एसटी): red body, cream window band, grey skirt, route board.
    box(2.5,2.8,8.6,0,1.9,0);
    box(2.56,0.5,8.65,0,0.62,0,'black');
    box(2.55,0.25,8.2,0,3.36,0,'band');
    for(const x of [-1.26,1.26]) {
      box(0.05,0.9,7.4,x,2.25,0,'glass');
      box(0.05,0.18,8.0,x,1.25,0,'band');
    }
    box(2.46,0.9,0.08,0,2.3,4.3,'glass');
    box(1.5,0.42,0.1,0,2.95,4.32,'band');
    box(2.2,0.25,0.12,0,1.0,4.34,'headlight');
    box(2.2,0.25,0.12,0,1.0,-4.34,'tail');
    for(const z of [-2.9,2.6]) for(const x of [-1.22,1.22]) add(wheelGeometry,'black',x,0.48,z);
    plates(1.3,4.36,-4.36,0.62);
  } else if (kind === 'truck') {
    // A Deccan highway truck: tall painted cargo box, striped skirt, big wheels.
    box(2.3,1.7,1.7,0,1.45,-3.1,'paint');
    box(2.2,0.8,0.1,0,1.9,-3.96,'glass');
    box(2.34,0.3,1.74,0,2.42,-3.1,'band');
    box(2.5,2.6,5.6,0,2.15,0.4,'paint');
    box(2.54,0.5,5.64,0,1.05,0.4,'band');
    box(2.54,0.22,5.64,0,3.5,0.4,'black');
    for(const x of [-1.26,1.26]) box(0.06,1.1,5.2,x,2.5,0.4,'band');
    box(2.4,0.5,0.1,0,1.15,3.24,'band'); // the classic HORN OK PLEASE board rides here
    box(2.2,0.25,0.12,0,0.95,-3.98,'headlight');
    box(2.2,0.25,0.12,0,0.95,3.26,'tail');
    for(const z of [-3.1,1.5,2.7]) for(const x of [-1.18,1.18]) add(bigWheelGeometry,'black',x,0.62,z);
    plates(1.3,-4.0,3.28,0.7);
  } else if (kind === 'tractor') {
    // Farm tractor with a loaded trailer, straight off the cotton plots.
    box(0.95,0.75,1.9,0,1.05,-0.6,'paint');
    box(1.3,0.18,1.3,0,2.35,0.55,'black');
    for(const x of [-0.55,0.55]) box(0.09,1.1,0.09,x,1.8,0.55,'black');
    box(0.7,0.5,0.6,0,1.35,0.5,'black');
    for(const x of [-0.72,0.72]) { add(bigWheelGeometry,'black',x,0.62,0.75); add(smallWheelGeometry,'black',x*0.8,0.34,-1.35); }
    box(0.14,0.14,1.1,0,0.7,1.65,'black');
    box(1.9,0.95,2.6,0,1.25,3.2,'band');
    box(1.7,0.5,2.3,0,1.95,3.2,'paint');
    for(const x of [-0.9,0.9]) add(wheelGeometry,'black',x,0.48,3.6);
    plates(0.9,-1.58,4.53,0.75);
  } else if (kind === 'cart') {
    box(1.6,0.2,1.2,0,0.85,0);
    box(0.12,1.6,0.12,0.75,1.6,0.5,'chrome');box(0.12,1.6,0.12,-0.75,1.6,0.5,'chrome');
    box(1.9,0.1,1.2,0,2.42,0.3);
    box(1.4,0.5,0.8,0,1.12,-0.2,'black');
    for(const x of [-0.7,0.7]) add(wheelGeometry,'black',x,0.38,0.2);
  } else {
    const long=kind==='sedan'?1.12:kind==='police'?1.08:1;
    box(2.25,0.64,4.4*long,0,0.9,0);
    box(2.12,0.24,4.2*long,0,1.25,0);
    box(1.9,0.85,2.16,0,1.68,0.2,'glass');
    box(2.05,0.15,2.3,0,2.12,0.2);
    box(2.1,0.16,1.1,0,1.43,-1.5);
    for (const x of [-1,1]) {
      for (const z of [-0.87,1.27]) box(0.12,0.83,0.14,x,1.69,z);
      box(0.1,0.82,0.16,x,1.7,0.15);
      box(0.1,0.12,3.8,x*1.14,0.68,0,'black');
      box(0.28,0.2,0.3,x*1.22,1.55,-0.62);
      box(0.32,0.08,0.08,x*1.14,1.25,0.2,'chrome');
      box(0.6,0.26,0.1,x*0.72,1.12,-2.23*long,'headlight');
      box(0.43,0.24,0.1,x*0.78,1.1,2.22*long,'tail');
      for(const z of [-1.42*long,1.42*long]) {
        add(wheelGeometry,'black',x*1.11,0.5,z);
        add(hubGeometry,'chrome',x*1.13,0.5,z);
      }
    }
    box(1.08,0.22,0.06,0,0.95,-2.25*long,'black');
    box(2.25,0.15,0.18,0,0.67,-2.25*long,'chrome');
    box(2.25,0.15,0.18,0,0.67,2.25*long,'chrome');
    plates(1.05,-2.36*long,2.36*long,0.85);
    if(kind==='police') {
      box(2.3,0.28,2.8,0,1.02,0,'black');
      box(1.45,0.12,0.48,0,2.25,0,'black');
      box(0.62,0.2,0.36,-0.38,2.4,0,'red');
      box(0.62,0.2,0.36,0.38,2.4,0,'blue');
    }
  }
  const template = new Map();
  for(const [role,geos] of bins) {
    template.set(role, mergeGeometries(geos));
    geos.forEach(g=>g.dispose());
  }
  templateCache.set(kind, template);
  return template;
}

export function createVehicle(kind = 'hatchback', color = '#e5a546') {
  const group = new THREE.Group();
  const paint = paintFor(color);
  for(const [role, geometry] of vehicleTemplate(kind)) {
    const material = role === 'paint' ? paint : role === 'plate' ? getPlateMaterial() : ROLE_MATERIALS[role] || paint;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
  }
  if (kind === 'bike') {
    const rider = createPerson('#4c7b9a', 'helmet');
    rider.scale.setScalar(0.62); rider.position.set(0,0.65,-0.15); group.add(rider);
  }
  if (kind === 'police') group.userData.lights = [policeRed, policeBlue];
  return group;
}

// --- People of Nanded -------------------------------------------------------
// Shared unit geometries (scaled per mesh) and a material cache by colour,
// so 70 pedestrians cost a handful of GPU programs instead of hundreds.
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const personMaterials = new Map();
function cloth(color) {
  if (!personMaterials.has(color)) personMaterials.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.95 }));
  return personMaterials.get(color);
}
const skinTones = ['#8a5433', '#995c3c', '#a96b44', '#7c4a2c'].map(cloth);
function part(group, material, w, h, d, x, y, z, rz = 0) {
  const mesh = new THREE.Mesh(unitBox, material);
  mesh.scale.set(w, h, d); mesh.position.set(x, y, z); mesh.rotation.z = rz;
  mesh.castShadow = true; group.add(mesh); return mesh;
}

/**
 * A pedestrian. `style` picks the headwear/dress you actually see on Nanded
 * streets: Sikh dastar (Hazur Sahib crowds), white Gandhi topi and saffron
 * pheta (Marathwada farmers), namaz topi (old city), sari, hijab, a student's
 * backpack (coaching lanes), or a rider's helmet.
 */
export function createPerson(color = '#e88a4e', style = 'plain', tone = 0) {
  const group = new THREE.Group();
  const shirt = cloth(color), skin = skinTones[Math.abs(tone) % skinTones.length], pants = cloth('#263c4a');
  part(group, shirt, 0.65, 0.75, 0.38, 0, 1.15, 0);
  part(group, skin, 0.38, 0.42, 0.38, 0, 1.75, 0);
  if (style === 'dastar') {
    part(group, cloth('#e07b24'), 0.46, 0.3, 0.46, 0, 1.98, 0);
    part(group, cloth('#e07b24'), 0.2, 0.14, 0.2, 0, 2.16, 0);
    part(group, cloth('#2a2320'), 0.3, 0.2, 0.1, 0, 1.56, -0.17); // beard
  } else if (style === 'topi') {
    part(group, cloth('#f2eee2'), 0.4, 0.16, 0.4, 0, 1.99, 0);
  } else if (style === 'pheta') {
    part(group, cloth('#e6933b'), 0.48, 0.2, 0.48, 0, 1.99, 0);
    part(group, cloth('#e6933b'), 0.14, 0.3, 0.14, 0.24, 2.02, 0);
  } else if (style === 'namaz') {
    part(group, cloth('#f5f2e8'), 0.36, 0.11, 0.36, 0, 1.99, 0);
    part(group, cloth('#2a2320'), 0.28, 0.16, 0.09, 0, 1.58, -0.17);
  } else if (style === 'hijab') {
    part(group, cloth('#33302e'), 0.5, 0.62, 0.5, 0, 1.78, 0.03);
  } else if (style === 'helmet') {
    part(group, cloth('#c23b2e'), 0.46, 0.3, 0.46, 0, 1.92, 0);
  } else {
    part(group, black, 0.4, 0.14, 0.4, 0, 1.97, 0);
  }
  if (style === 'sari') {
    part(group, shirt, 0.72, 0.85, 0.46, 0, 0.55, 0);            // draped skirt
    part(group, cloth('#e8c558'), 0.5, 0.12, 0.42, 0, 1.32, 0, 0.5); // border sash
  }
  if (style === 'student') part(group, cloth('#35455e'), 0.44, 0.55, 0.2, 0, 1.2, 0.3);
  const limbs = [];
  for(const x of [-0.2,0.2]) {
    limbs.push(part(group, style === 'sari' ? shirt : pants, 0.23, 0.74, 0.25, x, 0.4, 0));
    limbs.push(part(group, shirt, 0.18, 0.7, 0.23, x*2.2, 1.14, 0));
  }
  group.userData.limbs = limbs;
  return group;
}

/** A cow, buffalo or street dog, with four legs so pedestrian animation works on it. */
export function createAnimal(kind = 'cow') {
  const group = new THREE.Group();
  const cow = kind === 'cow', buffalo = kind === 'buffalo';
  const coat = cloth(cow ? '#e9e1cf' : buffalo ? '#4c4640' : '#b7875a');
  const patch = cloth(cow ? '#6b4a33' : buffalo ? '#37322e' : '#8a6038');
  const s = cow || buffalo ? 1 : 0.5;
  part(group, coat, 1.1*s*1.6, 0.7*s*1.6, 0.6*s*1.6, 0, 0.95*s*1.6, 0);
  if (cow) part(group, patch, 0.5, 0.42, 0.62, 0.2, 1.05, 0);
  if (cow || buffalo) part(group, coat, 0.5, 0.35, 0.45, -0.15, 1.62, 0.35); // shoulder hump
  part(group, coat, 0.42*s*1.6, 0.4*s*1.6, 0.38*s*1.6, 0, 1.32*s*1.6, 0.75*s*1.6);
  if (cow || buffalo) for(const x of [-0.42,0.42]) part(group, patch, 0.34, 0.09, 0.12, x, 2.2, 1.1, x > 0 ? -0.5 : 0.5); // horns
  const limbs = [];
  for(const x of [-0.3,0.3]) for(const z of [-0.25,0.25])
    limbs.push(part(group, patch, 0.14*s*1.6, 0.55*s*1.6, 0.14*s*1.6, x*s*1.6, 0.28*s*1.6, z*s*1.6));
  if (!cow && !buffalo) part(group, patch, 0.08, 0.08, 0.4, 0, 0.9, -0.6);
  group.userData.limbs = limbs;
  return group;
}
