import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const black = new THREE.MeshStandardMaterial({ color: '#202b2c', roughness: 0.85 });
const glass = new THREE.MeshStandardMaterial({ color: '#284c54', roughness: 0.22, metalness: 0.35 });
const chrome = new THREE.MeshStandardMaterial({ color: '#ccd6cf', roughness: 0.3, metalness: 0.65 });
const headlight = new THREE.MeshStandardMaterial({ color: '#fff0b5', emissive:'#ffe9a2', emissiveIntensity:0.65 });
const tail = new THREE.MeshStandardMaterial({color:'#b02c26',emissive:'#e33c26',emissiveIntensity:0.4});
const wheelGeometry = new THREE.CylinderGeometry(0.48,0.48,0.32,12);
wheelGeometry.rotateZ(Math.PI/2);

export function createVehicle(kind = 'hatchback', color = '#e5a546') {
  const group = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness:0.4, metalness:0.2 });
  const bins = new Map();
  function add(geo,mat,x,y,z) {
    const g=geo.clone();g.translate(x,y,z);
    if(!bins.has(mat))bins.set(mat,[]);bins.get(mat).push(g);
  }
  function box(w,h,d,x,y,z,mat=paint) { add(new THREE.BoxGeometry(w,h,d),mat,x,y,z); }
  if (kind === 'auto') {
    const yellow=new THREE.MeshStandardMaterial({color:'#f7bf44',roughness:0.55});
    box(1.85,0.68,2.9,0,0.78,0.2);
    box(1.9,0.18,2.45,0,2.32,0.25,yellow);
    box(1.85,0.8,0.13,0,1.65,1.4,black);
    box(1.5,0.7,0.08,0,1.7,-1.04,glass);
    box(1.85,0.65,0.52,0,1,-1.15,yellow);
    for(const x of [-0.85,0.85]) {
      box(0.09,1.25,0.09,x,1.7,-0.97,chrome);
      box(0.09,1.25,0.09,x,1.7,1.35,black);
      box(0.11,0.8,1.5,x,1.4,0.4,black);
      add(wheelGeometry,black,x,0.48,0.85);
      box(0.22,0.19,0.12,x*0.7,1.13,-1.43,headlight);
    }
    add(wheelGeometry,black,0,0.48,-1.2);
    box(1.3,0.18,0.7,0,1.15,0.7,black);
  } else if (kind === 'bike') {
    // A two-wheeler with a rider: the classic Nanded scooter-and-motorbike mix.
    const small=new THREE.CylinderGeometry(0.34,0.34,0.14,10);small.rotateZ(Math.PI/2);
    add(small,black,0,0.34,1.05);add(small,black,0,0.34,-1.05);
    box(0.22,0.5,2.2,0,0.7,0,paint);
    box(0.5,0.22,0.9,0,0.95,0.15,black);
    box(0.9,0.06,0.08,0,1.25,0.85,chrome);
    box(0.14,0.7,0.14,0,1.0,0.9,chrome);
    box(0.2,0.2,0.2,0,0.95,-0.7,tail);
    box(0.18,0.16,0.12,0,0.82,1.12,headlight);
    const rider=createPerson('#4c7b9a');rider.scale.setScalar(0.62);rider.position.set(0,0.65,-0.15);group.add(rider);
  } else if (kind === 'bus') {
    // An MSRTC-style city bus: a long painted body, a window band and a white stripe.
    const band=new THREE.MeshStandardMaterial({color:'#fff3d6',roughness:0.4});
    box(2.5,2.8,8.6,0,1.9,0);
    box(2.55,0.25,8.2,0,3.36,0,band);
    for(const x of [-1.26,1.26]) {
      box(0.05,0.9,7.4,x,2.25,0,glass);
      box(0.05,0.18,8.0,x,1.25,0,band);
    }
    box(2.46,0.9,0.08,0,2.3,4.3,glass);
    box(2.2,0.25,0.12,0,1.0,4.34,headlight);
    box(2.2,0.25,0.12,0,1.0,-4.34,tail);
    for(const z of [-2.9,2.6]) for(const x of [-1.22,1.22]) add(wheelGeometry,black,x,0.48,z);
  } else if (kind === 'cart') {
    box(1.6,0.2,1.2,0,0.85,0,paint);
    box(0.12,1.6,0.12,0.75,1.6,0.5,chrome);box(0.12,1.6,0.12,-0.75,1.6,0.5,chrome);
    box(1.9,0.1,1.2,0,2.42,0.3,paint);
    box(1.4,0.5,0.8,0,1.12,-0.2,black);
    for(const x of [-0.7,0.7]) add(wheelGeometry,black,x,0.38,0.2);
  } else {
    const long=kind==='sedan'?1.12:kind==='police'?1.08:1;
    box(2.25,0.64,4.4*long,0,0.9,0);
    box(2.12,0.24,4.2*long,0,1.25,0);
    box(1.9,0.85,2.16,0,1.68,0.2,glass);
    box(2.05,0.15,2.3,0,2.12,0.2);
    box(2.1,0.16,1.1,0,1.43,-1.5);
    for (const x of [-1,1]) {
      for (const z of [-0.87,1.27]) box(0.12,0.83,0.14,x,1.69,z);
      box(0.1,0.82,0.16,x,1.7,0.15);
      box(0.1,0.12,3.8,x*1.14,0.68,0,black);
      box(0.28,0.2,0.3,x*1.22,1.55,-0.62,paint);
      box(0.32,0.08,0.08,x*1.14,1.25,0.2,chrome);
      box(0.6,0.26,0.1,x*0.72,1.12,-2.23*long,headlight);
      box(0.43,0.24,0.1,x*0.78,1.1,2.22*long,tail);
      for(const z of [-1.42*long,1.42*long]) {
        add(wheelGeometry,black,x*1.11,0.5,z);
        const hub=new THREE.CylinderGeometry(0.24,0.24,0.34,8);hub.rotateZ(Math.PI/2);
        add(hub,chrome,x*1.13,0.5,z);
      }
    }
    box(1.08,0.22,0.06,0,0.95,-2.25*long,black);
    box(2.25,0.15,0.18,0,0.67,-2.25*long,chrome);
    box(2.25,0.15,0.18,0,0.67,2.25*long,chrome);
    if(kind==='police') {
      box(2.3,0.28,2.8,0,1.02,0,black);
      box(1.45,0.12,0.48,0,2.25,0,black);
      const red=new THREE.MeshStandardMaterial({color:'#ff3232',emissive:'#ff2222',emissiveIntensity:1});
      const blue=new THREE.MeshStandardMaterial({color:'#389dff',emissive:'#1674ff',emissiveIntensity:1});
      box(0.62,0.2,0.36,-0.38,2.4,0,red);
      box(0.62,0.2,0.36,0.38,2.4,0,blue);
      group.userData.lights=[red,blue];
    }
  }
  for(const [material,geos] of bins) {
    const merged=mergeGeometries(geos);geos.forEach(g=>g.dispose());
    const mesh=new THREE.Mesh(merged,material);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
  }
  return group;
}

export function createPerson(color='#e88a4e') {
  const group=new THREE.Group();
  const shirt=new THREE.MeshStandardMaterial({color});
  const skin=new THREE.MeshStandardMaterial({color:'#995c3c',roughness:1});
  const pants=new THREE.MeshStandardMaterial({color:'#263c4a'});
  const torso=new THREE.Mesh(new THREE.BoxGeometry(0.65,0.75,0.38),shirt);torso.position.y=1.15;group.add(torso);
  const head=new THREE.Mesh(new THREE.BoxGeometry(0.38,0.42,0.38),skin);head.position.y=1.75;group.add(head);
  const hair=new THREE.Mesh(new THREE.BoxGeometry(0.4,0.14,0.4),black);hair.position.y=1.97;group.add(hair);
  const limbs=[];
  for(const x of [-0.2,0.2]) {
    const leg=new THREE.Mesh(new THREE.BoxGeometry(0.23,0.74,0.25),pants);leg.position.set(x,0.4,0);group.add(leg);limbs.push(leg);
    const arm=new THREE.Mesh(new THREE.BoxGeometry(0.18,0.7,0.23),shirt);arm.position.set(x*2.2,1.14,0);group.add(arm);limbs.push(arm);
  }
  group.traverse(o=>{if(o.isMesh)o.castShadow=true;});group.userData.limbs=limbs;return group;
}

/** A cow or a street dog, built from boxes with four legs so pedestrian animation works on it. */
export function createAnimal(kind='cow') {
  const group=new THREE.Group();
  const cow=kind==='cow';
  const coat=new THREE.MeshStandardMaterial({color:cow?'#e9e1cf':'#b7875a',roughness:1});
  const patch=new THREE.MeshStandardMaterial({color:cow?'#6b4a33':'#8a6038',roughness:1});
  const s=cow?1:0.5;
  const body=new THREE.Mesh(new THREE.BoxGeometry(1.1*s*1.6,0.7*s*1.6,0.6*s*1.6),coat);
  body.position.set(0,0.95*s*1.6,0);group.add(body);
  if(cow){const spot=new THREE.Mesh(new THREE.BoxGeometry(0.5,0.42,0.62),patch);spot.position.set(0.2,1.05,0);group.add(spot);}
  const head=new THREE.Mesh(new THREE.BoxGeometry(0.42*s*1.6,0.4*s*1.6,0.38*s*1.6),coat);
  head.position.set(0,1.32*s*1.6,0.75*s*1.6);group.add(head);
  const limbs=[];
  for(const x of [-0.3,0.3]) for(const z of [-0.25,0.25]) {
    const leg=new THREE.Mesh(new THREE.BoxGeometry(0.14*s*1.6,0.55*s*1.6,0.14*s*1.6),patch);
    leg.position.set(x*s*1.6,0.28*s*1.6,z*s*1.6);group.add(leg);limbs.push(leg);
  }
  if(!cow){const tail=new THREE.Mesh(new THREE.BoxGeometry(0.08,0.08,0.4),patch);tail.position.set(0,0.9,-0.6);group.add(tail);}
  group.traverse(o=>{if(o.isMesh)o.castShadow=true;});group.userData.limbs=limbs;
  return group;
}
