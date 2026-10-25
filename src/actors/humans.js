// Every person in the city is drawn by instanced meshes on one procedural skeleton: a detailed
// body for the people near the camera (one for men, one for women, so neither carries the
// other's clothes), the simple one for everyone else. Three draw calls for all pedestrians,
// drivers, riders, police and the player, whatever their number.
// The processor poses the bones; the graphics chip bends the body to them.
import * as THREE from 'three';
import { rng, clamp } from '../core/math.js';
import { radialTexture } from '../world/citymat.js';
import { sendFirst } from '../core/buffers.js';
import { animate, C, BODY } from './anim.js';
import { BONES, SLOTS, SHOW, FIXED, JOINTS, REGION, HAIRLINE, BEARDLINE, farGeometry, nearGeometry } from './people-models.js';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// Flags that show a part as they are (hair, beards and turbans are worked out in _pose).
const EXTRAS = ['cap', 'skirt', 'kurta', 'pack', 'collar', 'short', 'belt', 'chappal', 'shoes', 'gajra', 'bindi', 'stubble', 'pheta', 'pcap', 'dupatta', 'topi', 'dastar'];

// ------------------------------------------------------------------ outfits
const SKIN = [0x8d5524, 0xa0672c, 0xb5753d, 0xc68642, 0x7a4a24, 0xc98e5a, 0x9b6a40];
const HAIR = [0x16110d, 0x1f1712, 0x2b2118, 0x16110d, 0x777777];
const SHIRTS = [0xf2f2f2, 0x6f9fd8, 0xd9534f, 0x5cb85c, 0xf0ad4e, 0x8e6bbf, 0x2c3e50, 0xe8d8b0, 0x1abc9c, 0xc0392b, 0x34495e, 0xd5d8dc];
const PANTS = [0x2c3e50, 0x1b2631, 0x5d4e37, 0x7f8c8d, 0x34495e, 0x212f3d, 0x1f3a5f];
const SARIS = [0xc0392b, 0xe67e22, 0x8e44ad, 0x16a085, 0xd35400, 0xe84393, 0xf1c40f, 0x2980b9, 0x27ae60, 0xb03a2e];
const TURBANS = [0x1f3a93, 0xff8c1a, 0xf2f2f2, 0x111111, 0x7d1d3f, 0x2e86c1, 0xf1c40f];
// Second colours for checks, stripes, prints and borders; zari gold for a sari's border.
const TRIMS = [0xf4f1ea, 0x1f3a5f, 0x8e1b1b, 0x2c3e50, 0x111111, 0x5d4e37, 0x2e86c1, 0xc0392b];
const ZARI = 0xd4a537;
const luma = c => (((c >> 16) & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + (c & 255) * 0.11) / 255;
/** A colour from `list` that stands out against `c`. */
const contrast = (r, list, c) => { for (let k = 0; k < 6; k++) { const t = r.pick(list); if (Math.abs(luma(t) - luma(c)) > 0.28) return t; } return luma(c) > 0.5 ? 0x1f3a5f : 0xf4f1ea; };
// The style code's bits (read by the detailed body's shader): fabric 0-2 (plain, checks,
// stripes, print), large 3, neckline 4-5 (closed, open collar, blouse, kurta slit), a breast
// pocket 6, a pocket each side 7.
const FABRIC = { plain: 0, checks: 1, stripes: 2, print: 3 }, NECK = { closed: 0, collar: 1, blouse: 2, kurta: 3 };

/**
 * Outfit by kind: 'man', 'woman', 'sikh', 'student', 'elder', 'farmer', 'police', 'goon', 'player', 'friend'.
 */
export function makeOutfit(kind, seed) {
  const r = rng(seed);
  const o = {
    skin: r.pick(SKIN), hair: r.pick(HAIR), shirt: r.pick(SHIRTS), pants: r.pick(PANTS), shoes: r.pick([0x2b1d14, 0x3b2a1e, 0x111111, 0x6b4a2b]),
    extra: 0, cap: 0xf2f2f2, flags: new Set(), scale: r.range(0.88, 0.98), kind, brow: 0x1a120c,
  };
  o.sleeve = o.shirt; o.legs = o.pants;
  // A Marathwada moustache is the rule, not the exception.
  if ((kind === 'man' || kind === 'elder' || kind === 'farmer' || kind === 'police' || kind === 'goon') && r.chance(0.6)) o.flags.add('moustache');
  switch (kind) {
    case 'woman':
      o.flags.add('skirt'); o.flags.add(r.chance(0.6) ? 'bun' : 'long'); o.extra = r.pick(SARIS); o.shirt = r.chance(0.6) ? o.extra : r.pick(SARIS); o.sleeve = o.shirt;
      o.pants = o.extra; o.legs = o.skin; o.scale *= 0.94; o.hair = 0x16110d;
      if (r.chance(0.35)) { o.flags.delete('skirt'); o.flags.add('kurta'); o.pants = r.pick([0xf2f2f2, 0x2c3e50, o.extra]); o.legs = o.pants; }
      break;
    case 'sikh':
      o.flags.add('turban'); o.flags.add('beard'); o.extra = r.pick(TURBANS); o.hair = 0x16110d;
      if (r.chance(0.6)) { o.flags.add('kurta'); o.shirt = r.pick([0xf2f2f2, 0xe8d8b0, 0x2c3e50, 0x7fb3d5]); o.sleeve = o.shirt; o.pants = 0xf2f2f2; o.legs = o.pants; }
      break;
    case 'student':
      o.flags.add('pack'); o.extra = r.pick([0x1f3a93, 0x111111, 0xc0392b, 0x16a085, 0x7d3c98]); o.pants = r.pick([0x1f3a5f, 0x2c3e50, 0x7f8c8d]); o.legs = o.pants;
      if (r.chance(0.45)) { o.flags.add('kurta'); o.flags.add('bun'); o.shirt = r.pick(SARIS); o.sleeve = o.shirt; o.pants = r.pick([0xf2f2f2, 0x2c3e50]); o.legs = o.pants; o.scale *= 0.95; }
      break;
    case 'elder':
      o.flags.add('kurta'); o.flags.add('cap'); o.shirt = 0xf4f1e8; o.sleeve = o.shirt; o.pants = 0xf4f1e8; o.legs = o.pants; o.hair = 0x9a9a9a; o.cap = 0xfafafa;
      break;
    case 'farmer':
      o.flags.add('turban'); o.extra = r.pick([0xf4f1e8, 0xff8c1a, 0xe74c3c]); o.shirt = r.pick([0xf4f1e8, 0xe8d8b0]); o.sleeve = o.shirt; o.pants = 0xf4f1e8; o.legs = o.skin;
      break;
    case 'police':
      o.shirt = 0xb39b6b; o.sleeve = o.shirt; o.pants = 0xa48d5f; o.legs = o.pants; o.flags.add('cap'); o.cap = 0x1f2a44; o.shoes = 0x111111;
      break;
    case 'goon':
      o.shirt = r.pick([0x111111, 0xffffff, 0x8e1b1b]); o.sleeve = o.shirt; o.pants = r.pick([0x111111, 0x1b2631]); o.legs = o.pants;
      break;
    case 'player':
      o.skin = 0xa0672c; o.hair = 0x16110d; o.shirt = 0xe8652e; o.sleeve = 0xe8652e; o.pants = 0x1f3a5f; o.legs = o.pants; o.shoes = 0xf2f2f2; o.scale = 0.96;
      o.flags.delete('moustache'); o.flags.add('stubble');
      break;
    default:
      if (r.chance(0.25)) { o.flags.add('kurta'); o.pants = r.pick([0xf2f2f2, o.pants]); o.legs = o.pants; }
      if (r.chance(0.12)) { o.flags.add('cap'); o.cap = 0xfafafa; }
  }
  if (o.sleeve === o.shirt && r.chance(0.35) && kind !== 'police' && kind !== 'elder') o.sleeve = o.skin; // short sleeves
  closeUp(o, kind, seed);
  return o;
}

/**
 * What only shows up close: build, fabric, collars, belts, footwear, a bindi, jasmine in the hair.
 * From its own random stream, so everyone keeps the colours they had.
 */
function closeUp(o, kind, seed) {
  const r = rng((seed ^ 0x9e3779b9) >>> 0), f = o.flags;
  const kurta = f.has('kurta'), sari = f.has('skirt'), female = kind === 'woman' || (kind === 'student' && kurta);
  o.female = female ? 1 : 0;
  if (kind === 'student' && o.hair === 0x777777) o.hair = 0x2b2118; // too young to be grey
  o.heavy = kind === 'player' ? 0.1 : r.chance(kind === 'elder' || kind === 'goon' ? 0.4 : 0.26) ? r.range(0.35, 1) : r.range(0, 0.25);
  o.tuck = 0;
  o.trim = contrast(r, TRIMS, o.shirt);
  let fabric = FABRIC.plain, neck = NECK.closed, pockets = 0;
  if (o.sleeve === o.skin) f.add('short');
  if (f.has('turban')) f.add(kind === 'sikh' ? 'dastar' : 'pheta');
  if (f.has('cap')) f.add(kind === 'police' ? 'pcap' : 'topi');
  if (sari) {
    neck = NECK.blouse;
    o.trim = r.chance(0.5) ? ZARI : contrast(r, SARIS, o.extra);
    if (r.chance(0.85)) f.add('bindi');
  } else if (kurta) {
    neck = NECK.kurta;
    fabric = r.pick(female ? [FABRIC.print, FABRIC.print, FABRIC.plain, FABRIC.stripes] : [FABRIC.plain, FABRIC.plain, FABRIC.plain, FABRIC.print, FABRIC.stripes]);
    o.trim = female ? contrast(r, SARIS, o.shirt) : contrast(r, TRIMS, o.shirt);
    if (female && r.chance(kind === 'woman' ? 0.75 : 0.6)) f.add('dupatta');
    if (female && r.chance(kind === 'woman' ? 0.8 : 0.35)) f.add('bindi');
  } else if (kind === 'police') {
    neck = NECK.collar; pockets = 192; o.tuck = 1; f.add('collar'); f.add('belt');
  } else if (kind === 'student' && r.chance(0.45)) {
    fabric = r.pick([FABRIC.plain, FABRIC.stripes]); // a T-shirt
  } else {
    neck = NECK.collar; f.add('collar');
    fabric = kind === 'player' ? FABRIC.plain : r.pick([FABRIC.plain, FABRIC.plain, FABRIC.plain, FABRIC.checks, FABRIC.checks, FABRIC.stripes, FABRIC.stripes, FABRIC.print]);
    if (r.chance(0.6)) pockets = 64;
    if (kind !== 'player' && kind !== 'farmer' && r.chance(kind === 'goon' ? 0.2 : 0.3)) { o.tuck = 1; f.add('belt'); }
  }
  if (f.has('bun') && r.chance(kind === 'woman' ? 0.45 : 0.2)) f.add('gajra');
  if (!female && !f.has('beard') && kind !== 'elder' && r.chance(kind === 'goon' ? 0.6 : 0.3)) f.add('stubble');
  const shoes = kind === 'police' || kind === 'player' || (kind === 'student' && r.chance(0.8)) || (kind === 'goon' && r.chance(0.5)) ||
    ((kind === 'man' || kind === 'friend' || kind === 'sikh') && r.chance(0.4));
  f.add(shoes && !(kind === 'woman') ? 'shoes' : 'chappal');
  o.code = fabric | (r.chance(0.5) ? 8 : 0) | (neck << 4) | pockets;
}

// ------------------------------------------------------------------ renderer
/** A shadow box nothing falls inside: for a shadow map that doesn't refresh with moving actors. */
export const NO_SHADOW_BOX = { half: -Infinity, cx: 0, cz: 0, xx: 1, xz: 0, yx: 0, yy: 1, yz: 0 };

/**
 * Whether something at (x, y, z), give or take `margin` metres, falls inside the sun's shadow
 * map (Sky.shadowBox: its centre and the sun camera's axes). With no box, everything does.
 */
export function inShadowBox(b, x, y, z, margin) {
  if (!b) return true;
  const rx = x - b.cx, rz = z - b.cz, lim = b.half + margin;
  return Math.abs(rx * b.xx + rz * b.xz) <= lim && Math.abs(rx * b.yx + y * b.yy + rz * b.yz) <= lim;
}
const _m = new THREE.Matrix4(), _e = new THREE.Euler();
const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);

// Bones are 3x4 affine matrices, row-major, as the crowd texture stores them:
// [r00 r01 r02 tx | r10 r11 r12 ty | r20 r21 r22 tz].
const _root = new Float32Array(12), _l = new Float32Array(12);
/** A rotation from Euler angles in three.js's YXZ order (yaw, then pitch, then roll). */
function rotYXZ(m, x, y, z) {
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  const ce = c * e, cf = c * f, de = d * e, df = d * f;
  m[0] = ce + df * b; m[1] = de * b - cf; m[2] = a * d;
  m[4] = a * f; m[5] = a * e; m[6] = -b;
  m[8] = cf * b - de; m[9] = df + ce * b; m[10] = a * c;
  return m;
}
/** A rotation from Euler angles in XZY order (limbs: a twist about the limb, then abduction, then flexion). */
function rotXZY(m, x, y, z) {
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  const ac = a * c, ad = a * d, bc = b * c, bd = b * d;
  m[0] = c * e; m[1] = -f; m[2] = d * e;
  m[4] = ac * f + bd; m[5] = a * e; m[6] = ad * f - bc;
  m[8] = bc * f - ad; m[9] = b * e; m[10] = bd * f + ac;
  return m;
}
/** A hinge (knee, elbow, ankle). */
function rotX(m, x) {
  const c = Math.cos(x), s = Math.sin(x);
  m[0] = 1; m[1] = 0; m[2] = 0; m[4] = 0; m[5] = c; m[6] = -s; m[8] = 0; m[9] = s; m[10] = c;
  return m;
}
/** d at o = the parent bone (p at po) carrying rotation l at (x, y, z) in its frame. */
function bone(d, o, p, po, l, x, y, z) {
  const a0 = p[po], a1 = p[po + 1], a2 = p[po + 2], a3 = p[po + 3], a4 = p[po + 4], a5 = p[po + 5];
  const a6 = p[po + 6], a7 = p[po + 7], a8 = p[po + 8], a9 = p[po + 9], a10 = p[po + 10], a11 = p[po + 11];
  const b0 = l[0], b1 = l[1], b2 = l[2], b4 = l[4], b5 = l[5], b6 = l[6], b8 = l[8], b9 = l[9], b10 = l[10];
  d[o] = a0 * b0 + a1 * b4 + a2 * b8; d[o + 1] = a0 * b1 + a1 * b5 + a2 * b9; d[o + 2] = a0 * b2 + a1 * b6 + a2 * b10; d[o + 3] = a0 * x + a1 * y + a2 * z + a3;
  d[o + 4] = a4 * b0 + a5 * b4 + a6 * b8; d[o + 5] = a4 * b1 + a5 * b5 + a6 * b9; d[o + 6] = a4 * b2 + a5 * b6 + a6 * b10; d[o + 7] = a4 * x + a5 * y + a6 * z + a7;
  d[o + 8] = a8 * b0 + a9 * b4 + a10 * b8; d[o + 9] = a8 * b1 + a9 * b5 + a10 * b9; d[o + 10] = a8 * b2 + a9 * b6 + a10 * b10; d[o + 11] = a8 * x + a9 * y + a10 * z + a11;
}

// Each person's row in the crowd's data texture: three texels (a 3x4 matrix) per bone, four of
// colours, each carrying the person's mask in its last channel, then one of build and style:
// how heavy, flags (female 1, tucked in 2, the style code from 4) and the second colour.
const BLOCK = BONES.length * 3 + 5;
const COLOURS = BONES.length * 3, STYLE = COLOURS + 4;
const B = Object.fromEntries(BONES.map((k, i) => [k, i]));
const linear = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const vec3 = hex => `vec3(${[16, 8, 0].map(s => linear(((hex >> s) & 255) / 255).toFixed(4)).join(', ')})`;
const v3 = a => `vec3(${a.map(n => n.toFixed(4)).join(', ')})`;

// The simple body's shader: pose each vertex by its bone, colour it from its slot, and fold away
// the parts a person doesn't have (their triangles collapse to a point and never draw).
const CROWD_PARS = /* glsl */`
uniform highp sampler2D crowdData;
uniform int crowdBase;
attribute vec4 crowdPart;
varying vec3 vCrowdColor;
varying float vCrowdRough;
`;
const CROWD_FETCH = /* glsl */`
ivec2 crowdAt = ivec2(0, gl_InstanceID + crowdBase);
int crowdBone = int(crowdPart.x) * 3, crowdSlot = int(crowdPart.y), crowdShow = int(crowdPart.z);
vec4 crowdR0 = texelFetch(crowdData, crowdAt + ivec2(crowdBone, 0), 0);
vec4 crowdR1 = texelFetch(crowdData, crowdAt + ivec2(crowdBone + 1, 0), 0);
vec4 crowdR2 = texelFetch(crowdData, crowdAt + ivec2(crowdBone + 2, 0), 0);
vec4 crowdC = texelFetch(crowdData, crowdAt + ivec2(${COLOURS} + crowdSlot / 3, 0), 0);
float crowdOn = crowdShow == 0 || (int(crowdC.w) & crowdShow) != 0 ? 1.0 : 0.0;
`;
const CROWD_POSITION = /* glsl */`
transformed = crowdOn * vec3(dot(crowdR0, vec4(transformed, 1.0)), dot(crowdR1, vec4(transformed, 1.0)), dot(crowdR2, vec4(transformed, 1.0)));
`;
const CROWD_NORMAL = /* glsl */`
objectNormal = vec3(dot(crowdR0.xyz, objectNormal), dot(crowdR1.xyz, objectNormal), dot(crowdR2.xyz, objectNormal));
float crowdHex = floor((crowdSlot % 3 == 0 ? crowdC.x : crowdSlot % 3 == 1 ? crowdC.y : crowdC.z) + 0.5);
vec3 crowdRgb = vec3(floor(crowdHex / 65536.0), mod(floor(crowdHex / 256.0), 256.0), mod(crowdHex, 256.0)) / 255.0;
vCrowdColor = mix(crowdRgb * 0.0773993808, pow(crowdRgb * 0.9478672986 + 0.0521327014, vec3(2.4)), step(0.04045, crowdRgb));
vCrowdRough = crowdPart.w;
`;

// The detailed body's shader. Each vertex blends between two bones and mixes in the person's
// build; the fragment paints faces, fabric, necklines, borders and soles from where it lies on
// the body in the bind pose.
const NEAR_PARS = /* glsl */`
uniform highp sampler2D crowdData;
uniform int crowdBase;
uniform vec3 crowdJ[${BONES.length}];
attribute vec4 crowdPart;
attribute vec4 crowdSkin;
attribute vec3 crowdMF;
attribute vec3 crowdMH;
attribute vec3 crowdMT;
vec3 crowdRgb(float hex) {
  hex = floor(hex + 0.5);
  vec3 c = vec3(floor(hex / 65536.0), mod(floor(hex / 256.0), 256.0), mod(hex, 256.0)) / 255.0;
  return mix(c * 0.0773993808, pow(c * 0.9478672986 + 0.0521327014, vec3(2.4)), step(0.04045, c));
}
`;
const NEAR_VARYINGS = /* glsl */`
varying vec3 vCrowdColor;
varying float vCrowdRough;
varying vec3 vCrowdP;
varying vec2 vCrowdUV;
varying float vCrowdAO;
flat varying int vCrowdRegion;
flat varying int vCrowdMask;
flat varying int vCrowdCode;
flat varying float vCrowdFemale;
flat varying vec3 vCrowdHair;
flat varying vec3 vCrowdTrim;
flat varying vec3 vCrowdSkin;
`;
const NEAR_FETCH = /* glsl */`
ivec2 crowdAt = ivec2(0, gl_InstanceID + crowdBase);
int crowdB1 = int(crowdPart.x), crowdB2 = int(crowdSkin.x), crowdShow = int(crowdPart.z);
float crowdW = crowdSkin.y;
vec4 crowdA0 = texelFetch(crowdData, crowdAt + ivec2(crowdB1 * 3, 0), 0);
vec4 crowdA1 = texelFetch(crowdData, crowdAt + ivec2(crowdB1 * 3 + 1, 0), 0);
vec4 crowdA2 = texelFetch(crowdData, crowdAt + ivec2(crowdB1 * 3 + 2, 0), 0);
vec4 crowdE0 = crowdA0, crowdE1 = crowdA1, crowdE2 = crowdA2;
if (crowdW > 0.0) {
  crowdE0 = texelFetch(crowdData, crowdAt + ivec2(crowdB2 * 3, 0), 0);
  crowdE1 = texelFetch(crowdData, crowdAt + ivec2(crowdB2 * 3 + 1, 0), 0);
  crowdE2 = texelFetch(crowdData, crowdAt + ivec2(crowdB2 * 3 + 2, 0), 0);
}
vec4 crowdC0 = texelFetch(crowdData, crowdAt + ivec2(${COLOURS}, 0), 0);
vec4 crowdS = texelFetch(crowdData, crowdAt + ivec2(${STYLE}, 0), 0);
int crowdMaskI = int(crowdC0.w);
float crowdOn = crowdShow == 0 || (crowdMaskI & crowdShow) != 0 ? 1.0 : 0.0;
int crowdFlags = int(crowdS.y + 0.5);
float crowdFemale = float(crowdFlags & 1);
vec3 crowdP1 = position + crowdFemale * crowdMF + crowdS.x * crowdMH + float((crowdFlags >> 1) & 1) * crowdMT;
vec3 crowdP2 = crowdP1 + crowdJ[crowdB1] - crowdJ[crowdB2];
`;
const NEAR_POSITION = /* glsl */`
transformed = crowdOn * ((1.0 - crowdW) * vec3(dot(crowdA0, vec4(crowdP1, 1.0)), dot(crowdA1, vec4(crowdP1, 1.0)), dot(crowdA2, vec4(crowdP1, 1.0)))
  + crowdW * vec3(dot(crowdE0, vec4(crowdP2, 1.0)), dot(crowdE1, vec4(crowdP2, 1.0)), dot(crowdE2, vec4(crowdP2, 1.0))));
`;
const NEAR_NORMAL = /* glsl */`
objectNormal = (1.0 - crowdW) * vec3(dot(crowdA0.xyz, objectNormal), dot(crowdA1.xyz, objectNormal), dot(crowdA2.xyz, objectNormal))
  + crowdW * vec3(dot(crowdE0.xyz, objectNormal), dot(crowdE1.xyz, objectNormal), dot(crowdE2.xyz, objectNormal));
int crowdSlot = int(crowdPart.y);
vec4 crowdCs = crowdC0; // skin, brow and hair are in the texel already read
if (crowdSlot >= 3) crowdCs = texelFetch(crowdData, crowdAt + ivec2(${COLOURS} + min(crowdSlot, 11) / 3, 0), 0);
float crowdHex = crowdSlot % 3 == 0 ? crowdCs.x : crowdSlot % 3 == 1 ? crowdCs.y : crowdCs.z;
vCrowdColor = crowdSlot < 12 ? crowdRgb(crowdHex) : crowdSlot == 12 ? ${vec3(FIXED.sole)} : crowdSlot == 13 ? ${vec3(FIXED.visor)} : crowdSlot == 14 ? ${vec3(FIXED.gold)} : ${vec3(FIXED.flower)};
vCrowdRough = crowdPart.w;
vCrowdSkin = crowdRgb(crowdC0.x); vCrowdHair = crowdRgb(crowdC0.z); vCrowdTrim = crowdRgb(crowdS.z);
vCrowdMask = crowdMaskI; vCrowdCode = crowdFlags >> 2; vCrowdFemale = crowdFemale;
vCrowdRegion = int(crowdSkin.z + 0.5); vCrowdAO = crowdSkin.w;
vCrowdP = position + crowdJ[crowdB1]; vCrowdUV = crowdUV;
`;
const J = JOINTS, R = REGION;
/** A GLSL function of the keyframed curve people-models.js grows hair along (see along()). */
const curve = (name, keys) => `float ${name}(float a) {\n  float y = ${keys[0][1].toFixed(3)};\n` +
  keys.slice(0, -1).map((k, i) => `  y = mix(y, ${keys[i + 1][1].toFixed(3)}, smoothstep(${k[0].toFixed(3)}, ${keys[i + 1][0].toFixed(3)}, a));`).join('\n') + '\n  return y;\n}\n';
const NEAR_PAINT = /* glsl */`
const vec3 CROWD_HEAD = ${v3(J.head)};
const vec3 CROWD_GOLD = ${vec3(FIXED.gold)};
${curve('crowdHairline', HAIRLINE)}${curve('crowdBeardline', BEARDLINE)}
// 1 inside |d| < w, softened over a pixel.
float crowdIn(float d, float w) { float f = fwidth(d) * 0.75 + 1e-6; return 1.0 - smoothstep(w - f, w + f, d); }
float crowdDisc(vec2 p, float r) { return crowdIn(length(p), r); }
// The same, softened over a given width (a pixel measured before branching).
float crowdInA(float d, float w, float aa) { return 1.0 - smoothstep(w - aa, w + aa, d); }
float crowdDiscA(vec2 p, float r, float aa) { return crowdInA(length(p), r, aa); }
// A disc in a repeating cell, softened by the cell coordinate's own footprint (aa).
float crowdDot(vec2 g, float r, float aa) { return 1.0 - smoothstep(r - aa, r + aa, length(g)); }
// Checks, stripes or a print in the second colour, wrapped round a body part with its axis at x = cx.
vec3 crowdFabric(vec3 base, vec3 P, float cx, float round) {
  int pat = vCrowdCode & 7;
  if (pat == 0) return base;
  float s = (vCrowdCode & 8) != 0 ? 0.034 : 0.022;
  vec2 f = vec2(atan(P.x - cx, P.z) * round, P.y) / s, w = fwidth(f);
  float aa = max(w.x, w.y), blur = smoothstep(0.3, 0.75, aa), m, avg;
  if (pat == 1) {
    float bx = crowdIn(abs(fract(f.x) - 0.5), 0.16), by = crowdIn(abs(fract(f.y) - 0.5), 0.16);
    m = 0.55 * max(bx, by) + 0.45 * bx * by; avg = 0.35;
  } else if (pat == 2) {
    m = crowdIn(abs(fract(f.x * 1.6) - 0.5), 0.12); avg = 0.24;
  } else {
    vec2 g = fract(f * 1.3 + vec2(0.5 * floor(f.y * 1.3), 0.0)) - 0.5;
    m = crowdDot(g, 0.16, aa * 1.3); avg = 0.08;
  }
  return mix(base, vCrowdTrim, mix(m, avg, blur) * 0.85);
}
vec3 crowdFace(vec3 col, vec3 q) {
  // A pixel's size here, measured before any branching (derivatives need every pixel of a quad).
  float px = (fwidth(q.x) + fwidth(q.y)) * 0.5 + 1e-5, ax = abs(q.x);
  vec2 l = vec2(q.x / 0.0205, (q.y - 0.1272) / 0.0068);
  float lip = 1.0 - smoothstep(1.0 - px / 0.0068, 1.0 + px / 0.0068, length(l));
  // Where hair grows (as the height on the head's unit sphere, by the angle round it): the
  // hairline, under a turban too, and a beard or stubble.
  float yn = (q.y - 0.175) / 0.118, a = abs(atan(q.x / 0.091, (q.z - 0.004) / 0.103)), fy = px / 0.118 * 1.2;
  if ((vCrowdMask & ${SHOW.hair | SHOW.turban}) != 0) col = mix(col, vCrowdHair * 0.92, smoothstep(-fy, fy, yn - crowdHairline(a) + 0.015));
  float beard = crowdBeardline(a) + 0.035 - yn;
  if ((vCrowdMask & ${SHOW.beard}) != 0) col = mix(col, vCrowdHair, smoothstep(-fy, fy, beard) * (1.0 - lip));
  else if ((vCrowdMask & ${SHOW.stubble}) != 0) col *= 1.0 - 0.24 * smoothstep(-0.02, 0.09, beard) * (1.0 - lip);
  // The rest lies in a small box on the face.
  if (q.z < 0.035 || ax > 0.064 || q.y < 0.115 || q.y > 0.236) return col;
  // Lips and the line between them, nostrils.
  col = mix(col, col * vec3(0.8, 0.57, 0.55), lip);
  col = mix(col, col * 0.35, crowdInA(abs(q.y - 0.1279 + 0.0016 * l.x * l.x), 0.0007, px) * (1.0 - smoothstep(0.85, 1.0, abs(l.x))));
  col *= 1.0 - 0.5 * crowdDiscA(vec2(ax - 0.0085, q.y - 0.1462), 0.0032, px);
  // Eyes: almond whites, a dark iris and pupil, the upper lid's line.
  vec2 e = vec2(ax - 0.034, q.y - 0.1905);
  e.y -= e.x * 0.12;
  vec2 es = e / vec2(0.0125, 0.0061);
  float eye = crowdDiscA(es, 1.0, px / 0.0061);
  col = mix(col, vec3(0.66, 0.61, 0.54), eye);
  vec2 ir = vec2(ax - 0.0334, q.y - 0.1902);
  col = mix(col, vec3(0.045, 0.02, 0.01), crowdDiscA(ir, 0.0057, px) * eye);
  col = mix(col, vec3(0.006), crowdDiscA(ir, 0.0024, px) * eye);
  col = mix(col, vec3(0.012, 0.008, 0.006), crowdInA(abs(length(es) - 1.0), 0.17, px / 0.0061) * step(-0.3, es.y) * 0.9);
  // Brows, arched and thinning outward.
  float bx = (ax - 0.0365) / 0.0235, by = q.y - 0.2125 - 0.0042 * (1.0 - bx * bx);
  float brow = crowdInA(abs(by), 0.0041 * (1.0 - 0.5 * smoothstep(-0.2, 1.0, bx)), px) * (1.0 - smoothstep(0.85, 1.05, abs(bx)));
  col = mix(col, vCrowdHair, brow * 0.95);
  if ((vCrowdMask & ${SHOW.bindi}) != 0) col = mix(col, vec3(0.48, 0.004, 0.015), crowdDiscA(vec2(q.x, q.y - 0.2275), 0.0042, px));
  return col;
}
vec3 crowdHair(vec3 col, vec3 q) {
  float sx = q.x * 700.0 + q.z * 260.0, st = fwidth(sx), px = fwidth(q.x) + fwidth(q.z) + 1e-5;
  col *= 1.0 - 0.12 * (0.5 + 0.5 * sin(sx)) * (1.0 - smoothstep(0.5, 2.0, st));
  // A side parting for men, down the middle for women, from the forehead back to the crown.
  float part = vCrowdFemale > 0.5 ? q.x : q.x - 0.032;
  float along = step(0.25, q.y) * smoothstep(0.08, 0.06, q.z) * smoothstep(-0.05, -0.02, q.z);
  return mix(col, vCrowdSkin * 0.7, 0.8 * crowdInA(abs(part), 0.0009, px) * along);
}
vec3 crowdShirt(vec3 col, vec3 P) {
  col = crowdFabric(col, P, 0.0, 0.16);
  float px = fwidth(P.x) + fwidth(P.y) + 1e-5, front = smoothstep(0.0, 0.03, P.z);
  int neck = (vCrowdCode >> 4) & 3;
  if (neck == 1) {
    // An open collar: a V of skin at the throat; the placket, buttons and pockets of a shirt.
    if (P.y > 0.53) col = mix(col, vCrowdSkin, smoothstep(-px, px, P.y - 0.556 - abs(P.x) * 1.6) * front);
    if ((vCrowdMask & ${SHOW.collar}) != 0 && P.z > 0.0) {
      if (abs(P.x) < 0.016 && P.y < 0.556) {
        col *= 1.0 - 0.08 * crowdInA(abs(P.x), 0.011, px);
        float by = mod(P.y - 0.52 + 0.0425, 0.085) - 0.0425;
        col = mix(col, vec3(0.8, 0.78, 0.72), crowdDiscA(vec2(P.x, by), 0.0042, px) * front * step(P.y, 0.53) * step(-0.02, P.y));
      }
      float qx = (vCrowdCode & 128) != 0 ? abs(P.x) : P.x;
      if ((vCrowdCode & 192) != 0 && abs(qx - 0.075) < 0.037 && abs(P.y - 0.415) < 0.045) {
        float d = max(abs(qx - 0.075) - 0.033, abs(P.y - 0.415) - 0.04);
        col *= 1.0 - 0.2 * crowdInA(abs(d), 0.0012, px) * front - 0.12 * crowdInA(abs(P.y - 0.452), 0.003, px) * step(abs(qx - 0.075), 0.033) * front;
      }
    }
  } else if (neck == 2) {
    // A blouse: a scoop neck, and the midriff bare above the sari.
    float scoop = P.z > 0.0 ? P.y - 0.53 - (P.x / 0.09) * (P.x / 0.09) * 0.07 : P.y - 0.585;
    col = mix(col, vCrowdSkin, max(smoothstep(-px, px, scoop), crowdInA(abs(P.y - 0.125), 0.062, px)));
  } else if (neck == 3 && P.y > 0.48 && P.z > 0.0) {
    // A kurta: a slit at the throat edged in the second colour.
    float slit = crowdInA(abs(P.x), 0.008, px) * step(0.505, P.y) * front;
    float edge = crowdInA(abs(abs(P.x) - 0.0125), 0.0035, px) * step(0.49, P.y) * front;
    col = mix(mix(col, vCrowdTrim, edge * 0.9), vCrowdSkin, slit);
  }
  return col;
}
vec3 crowdPaint(vec3 col) {
  vec3 P = vCrowdP;
  int r = vCrowdRegion;
  if (r == ${R.face}) col = crowdFace(col, P - CROWD_HEAD);
  else if (r == ${R.hair}) col = crowdHair(col, P - CROWD_HEAD);
  else if (r == ${R.shirt}) col = crowdShirt(col, P);
  else if (r == ${R.sleeveL} || r == ${R.sleeveR} || r == ${R.shortL} || r == ${R.shortR}) {
    float cx = (r == ${R.sleeveL} || r == ${R.shortL}) ? ${J.upperArmL[0].toFixed(4)} : ${J.upperArmR[0].toFixed(4)};
    bool shortSleeve = r == ${R.shortL} || r == ${R.shortR};
    if (shortSleeve || (vCrowdMask & ${SHOW.short}) == 0) col = crowdFabric(col, P, cx, 0.055);
    if (shortSleeve) col *= 1.0 - 0.14 * crowdIn(abs(P.y - ${(J.upperArmL[1] - 0.12).toFixed(4)}), 0.004);
  } else if (r == ${R.sari}) {
    // A border at the hem in the second colour (often zari), and small butis over the rest.
    float h = P.y - ${(0.045 - 0.86).toFixed(4)};
    float border = crowdIn(abs(h - 0.04), 0.032) + 0.8 * crowdIn(abs(h - 0.088), 0.0045);
    vec2 f = vec2(atan(P.x, P.z) * 0.2, P.y) / 0.075;
    float aa = max(fwidth(f.x), fwidth(f.y));
    float buti = crowdDot(fract(f + vec2(0.5 * floor(f.y), 0.0)) - 0.5, 0.1, aa) * step(0.13, h) * (1.0 - smoothstep(0.3, 0.7, aa));
    col = mix(col, vCrowdTrim, clamp(border + 0.85 * buti, 0.0, 1.0));
  } else if (r == ${R.pallu}) {
    vec2 uv = vCrowdUV;
    float border = 1.0 - crowdIn(abs(uv.y - 0.5), 0.37);
    float fringe = smoothstep(0.93, 0.94, uv.x) * (0.55 + 0.45 * step(0.5, fract(uv.x * 160.0)));
    vec2 f = vec2(uv.x * 22.0, uv.y * 3.2);
    float aa = max(fwidth(f.x), fwidth(f.y));
    float buti = crowdDot(fract(f + vec2(0.5 * floor(f.y), 0.0)) - 0.5, 0.12, aa) * (1.0 - border) * (1.0 - smoothstep(0.3, 0.7, aa));
    col = mix(col, vCrowdTrim, clamp(border + fringe + 0.85 * buti, 0.0, 1.0));
  } else if (r == ${R.kurta}) {
    col = crowdFabric(col, P, 0.0, 0.2);
    col = mix(col, vCrowdTrim, crowdIn(abs(P.y + 0.404), 0.011) * 0.9);
  } else if (r == ${R.dupatta}) {
    col = mix(col, col * 0.62, 1.0 - crowdIn(abs(vCrowdUV.y - 0.5), 0.4));
  } else if (r == ${R.shoe}) {
    float y = P.y - ${J.footL[1].toFixed(4)}, fw = fwidth(y);
    col = mix(col, ${vec3(FIXED.sole)}, 1.0 - smoothstep(-0.047 - fw, -0.047 + fw, y));
    col *= 1.0 - 0.15 * crowdIn(abs(y + 0.043), 0.0012);
  } else if (r == ${R.belt}) {
    float front = step(0.0, P.z);
    col = mix(col, CROWD_GOLD * 0.9, crowdIn(abs(P.x), 0.016) * front);
    col *= 1.0 - 0.5 * crowdIn(abs(P.x), 0.009) * crowdIn(abs(P.y - 0.0535), 0.008) * front;
  } else if (r == ${R.pcap}) {
    vec3 q = P - CROWD_HEAD;
    col *= 1.0 - 0.35 * crowdIn(abs(q.y - 0.243), 0.008);
    col = mix(col, CROWD_GOLD, crowdDisc(vec2(q.x, q.y - 0.266), 0.011) * step(0.05, q.z));
  } else if (r == ${R.turban}) {
    // Layered folds.
    vec3 q = P - CROWD_HEAD;
    float k = (q.y + abs(q.x) * 0.45 - q.z * 0.12) / 0.017;
    col *= 1.0 - 0.13 * smoothstep(0.75, 0.95, fract(k)) * (1.0 - smoothstep(0.4, 1.0, fwidth(k)));
  }
  return col * vCrowdAO;
}
`;

export class Humans {
  constructor(scene, capacity = 200) {
    this.capacity = capacity;
    this.list = [];
    // Everyone is in a float texture, a row per person: the processor writes the bones and the
    // graphics chip reads them; only the rows in use are sent (see _send). The people near the
    // camera have the first rows and the detailed body; the rest the simple one.
    this.data = new Float32Array(BLOCK * capacity * 4);
    this.tex = new THREE.DataTexture(this.data, BLOCK, capacity, THREE.RGBAFormat, THREE.FloatType);
    this.tex.minFilter = this.tex.magFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    this.tex.needsUpdate = true;
    const crowdData = { value: this.tex }, joints = { value: BONES.map(k => new THREE.Vector3(...JOINTS[k])) };
    // In row order: detailed men, detailed women, everyone else.
    const near = nearGeometry(), far = farGeometry();
    this.meshes = [
      this._mesh('human-crowd-near', near.geometry, near.men, crowdData, joints),
      this._mesh('human-crowd-near-women', near.geometry, near.women, crowdData, joints),
      this._mesh('human-crowd', far, far.index, crowdData, null),
    ];
    this.far = this.meshes[2];
    scene.add(...this.meshes);
    this.n = 0; this.nNear = 0;
    // How close people are drawn in detail, and how many at most (set by the quality tier).
    this.nearRadius = 24; this.nearMax = 16;
    this._vis = []; this._d2 = new Float64Array(capacity); this._start = new Int32Array(6); this._count = new Int32Array(6);
    // A soft patch of shade under everyone on their feet, for settings whose shadow map doesn't
    // follow moving people (without it they float). One draw call for the whole crowd.
    const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.blobs = new THREE.InstancedMesh(plane, new THREE.MeshBasicMaterial({ map: radialTexture(64), color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }), capacity);
    this.blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.blobs.count = 0; this.blobs.frustumCulled = false; this.blobs.renderOrder = 1;
    this.blobs.material.polygonOffset = true; this.blobs.material.polygonOffsetFactor = -1; this.blobs.material.polygonOffsetUnits = -2;
    this.blobs.name = 'human-shade';
    scene.add(this.blobs);
    this.blobsOn = true;
    this.drawDistance = 140;
  }

  /** One of the two crowd meshes: its material, shadow material, and the run of rows it draws. */
  _mesh(name, body, index, crowdData, joints) {
    const detailed = !!joints, base = { value: 0 };
    const uniforms = sh => { sh.uniforms.crowdData = crowdData; sh.uniforms.crowdBase = base; if (detailed) sh.uniforms.crowdJ = joints; };
    const mat = new THREE.MeshStandardMaterial({ metalness: 0 });
    mat.onBeforeCompile = sh => {
      uniforms(sh);
      if (detailed) {
        sh.vertexShader = NEAR_PARS + 'attribute vec2 crowdUV;\n' + NEAR_VARYINGS + sh.vertexShader
          .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + NEAR_FETCH + NEAR_NORMAL)
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + NEAR_POSITION);
        sh.fragmentShader = NEAR_VARYINGS + NEAR_PAINT + sh.fragmentShader
          .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= crowdPaint(vCrowdColor);')
          .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vCrowdRough;');
      } else {
        sh.vertexShader = CROWD_PARS + sh.vertexShader
          .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + CROWD_FETCH + CROWD_NORMAL)
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + CROWD_POSITION);
        sh.fragmentShader = 'varying vec3 vCrowdColor;\nvarying float vCrowdRough;\n' + sh.fragmentShader
          .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vCrowdColor;')
          .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vCrowdRough;');
      }
    };
    // The two detailed meshes differ only in their triangles: one program serves both.
    mat.customProgramCacheKey = () => (detailed ? 'crowd-near' : 'crowd');
    // The sun's shadow map draws the same poses.
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depth.onBeforeCompile = sh => {
      uniforms(sh);
      sh.vertexShader = detailed
        ? NEAR_PARS + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + NEAR_FETCH + NEAR_POSITION)
        : CROWD_PARS + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + CROWD_FETCH + CROWD_POSITION);
    };
    depth.customProgramCacheKey = () => (detailed ? 'crowd-near-depth' : 'crowd-depth');
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(index);
    for (const k in body.attributes) geo.setAttribute(k, body.attributes[k]);
    geo.instanceCount = 0;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.customDepthMaterial = depth;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.name = name;
    // Rows from `base`: `count` in view, of which the first `shadow` are inside the sun's shadow
    // map (the shadow pass draws only those). Whichever pass comes first sends this frame's rows.
    mesh.rows = { base, count: 0, shadow: 0 };
    mesh.onBeforeShadow = r => { this._send(r); geo.instanceCount = mesh.rows.shadow; };
    mesh.onAfterShadow = () => { geo.instanceCount = mesh.rows.count; };
    mesh.onBeforeRender = r => this._send(r);
    return mesh;
  }

  add(outfit, x = 0, z = 0) {
    const h = {
      outfit, x, y: 0, z, yaw: 0, pose: 'idle', speed: 0, t: 0,
      pitch: 0, roll: 0, visible: true, punch: 0, lookYaw: 0, seatY: 0, armsUp: 0, air: false, vy: 0, guard: 0, near: false,
    };
    this.list.push(h);
    return h;
  }
  remove(h) { const i = this.list.indexOf(h); if (i >= 0) this.list.splice(i, 1); }

  /** Move everyone in view on (anim.js) and write their bones and colours. */
  update(dt, cam, shadowBox) {
    const maxD2 = this.drawDistance * this.drawDistance, blobD2 = 60 * 60, vis = this._vis, D = this._d2;
    // Who is in view, and who is close enough for the detailed body: inside its radius (a little
    // further for those already detailed, so nobody flickers between the two at the edge), the
    // nearest first if there are more than it allows.
    vis.length = 0;
    let near = 0;
    for (const h of this.list) {
      if (!h.visible) { h.near = false; continue; }
      const dx = h.x - cam.x, dz = h.z - cam.z, d2 = dx * dx + dz * dz;
      if (d2 > maxD2 || vis.length >= this.capacity) { h.near = false; continue; }
      const r = this.nearRadius + (h.near ? 2.5 : 0);
      h._d2 = d2; h.near = d2 < r * r; h._shadow = inShadowBox(shadowBox, h.x, h.y, h.z, 2.5);
      if (h.near) D[near++] = d2;
      vis.push(h);
    }
    if (near > this.nearMax) {
      const cut = D.subarray(0, near).sort()[this.nearMax - 1];
      near = 0;
      for (const h of vis) if (h.near && (h.near = h._d2 <= cut && near < this.nearMax)) near++;
    }
    // Rows: detailed men, detailed women, then everyone else; in each, those inside the shadow map first.
    const start = this._start, counts = this._count, bucket = h => (h.near ? (h.outfit.female ? 2 : 0) : 4) + (h._shadow ? 0 : 1);
    counts.fill(0);
    for (const h of vis) counts[bucket(h)]++;
    start[0] = 0;
    for (let k = 1; k < 6; k++) start[k] = start[k - 1] + counts[k - 1];
    let blobs = 0;
    for (const h of vis) {
      const d2 = h._d2;
      this._at = start[bucket(h)]++ * BLOCK * 4;
      // Close up the whole body moves; a street away hands stay off handlebars; far off only the body shows.
      animate(h, dt, d2 > 3600 ? 2 : d2 > 900 ? 1 : 0);
      this._pose(h, d2 > 3600);
      // Seated riders and drivers are covered by their vehicle's shade.
      if (this.blobsOn && d2 < blobD2 && h.pose !== 'sit' && h.pose !== 'ride') {
        const lying = h.pose === 'lie', s = h.outfit.scale || 1, A = h.anim, mid = A.out[C.RZ] * 0.5 * s;
        _e.set(0, h.yaw, 0); _q.setFromEuler(_e);
        // Under the body, which lies off its feet's spot; above the road surface (6-7 cm).
        _v.set(h.x + A.root.x + Math.sin(h.yaw) * mid, h.y + A.root.y + 0.09, h.z + A.root.z + Math.cos(h.yaw) * mid);
        _s.set((lying ? 1.1 : 1.35) * s, 1, (lying ? 2.3 : 1.35) * s);
        this.blobs.setMatrixAt(blobs++, _m.compose(_v, _q, _s));
        _s.set(1, 1, 1);
      }
    }
    this.n = vis.length; this.nNear = counts[0] + counts[1] + counts[2] + counts[3];
    for (let g = 0, base = 0; g < 3; g++) { this._rows(this.meshes[g], base, counts[g * 2] + counts[g * 2 + 1], counts[g * 2]); base += counts[g * 2] + counts[g * 2 + 1]; }
    this.dirty = this.n > 0;
    this.blobs.count = blobs;
    this.blobs.visible = blobs > 0;
    sendFirst(this.blobs.instanceMatrix, blobs);
  }
  _rows(mesh, base, count, shadow) {
    mesh.rows.base.value = base; mesh.rows.count = count; mesh.rows.shadow = shadow;
    mesh.geometry.instanceCount = count;
    mesh.visible = count > 0;
  }

  /**
   * Send the rows in use to the graphics chip, once a frame. three.js would send the whole
   * texture, or ask the GPU for its unpack state before each partial upload (a stall in Chrome),
   * so after three.js has made the texture this writes the rows itself, in one call.
   */
  _send(renderer) {
    if (!this.dirty) return;
    this.dirty = false;
    const t = renderer.properties.get(this.tex).__webglTexture;
    if (!t) { this.tex.needsUpdate = true; return; } // first frame: three.js uploads it all
    const gl = renderer.getContext();
    renderer.state.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0); gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BLOCK, this.n, gl.RGBA, gl.FLOAT, this.data, 0);
  }

  _pose(h, far) {
    const o = h.outfit, f = o.flags, sc = o.scale;
    // Colours, which of the optional parts this person shows, and their build and style.
    const d = this.data, at = this._at + COLOURS * 4;
    let mask = f.has('turban') ? SHOW.turban : SHOW.hair | (f.has('bun') ? SHOW.bun : 0) | (f.has('long') ? SHOW.long : 0);
    if (f.has('beard')) mask |= SHOW.beard; else if (f.has('moustache')) mask |= SHOW.moustache;
    for (const k of EXTRAS) if (f.has(k)) mask |= SHOW[k];
    if (!far) mask |= SHOW.limbs; // limbs are a few pixels at range: skip them
    for (let k = 0; k < 4; k++) {
      d[at + k * 4] = o[SLOTS[k * 3]] ?? 0; d[at + k * 4 + 1] = o[SLOTS[k * 3 + 1]] ?? 0; d[at + k * 4 + 2] = o[SLOTS[k * 3 + 2]] ?? 0;
      d[at + k * 4 + 3] = mask;
    }
    d[at + 16] = o.heavy ?? 0; d[at + 17] = (o.female ? 1 : 0) + (o.tuck ? 2 : 0) + 4 * (o.code ?? 0); d[at + 18] = o.trim ?? 0;
    // The bones, from this frame's pose (anim.js).
    const A = h.anim, P = A.out, R = A.root, row = this._at;
    // Root: on the ground at the person's spot, turned to their heading, the whole body
    // pitched and rolled about the pelvis (falls, and a two-wheeler's lean).
    const yaw = h.yaw + R.yaw, cy = Math.cos(yaw), sy = Math.sin(yaw), m = rotYXZ(_root, P[C.BP], yaw, (h.roll || 0) + P[C.BR]);
    m[0] *= sc; m[1] *= sc; m[2] *= sc; m[4] *= sc; m[5] *= sc; m[6] *= sc; m[8] *= sc; m[9] *= sc; m[10] *= sc;
    m[3] = h.x + R.x + (P[C.RX] * cy + P[C.RZ] * sy) * sc;
    m[7] = h.y + R.y + P[C.PY] * sc;
    m[11] = h.z + R.z + (P[C.RZ] * cy - P[C.RX] * sy) * sc;
    // Pelvis, torso, head.
    bone(d, row + B.hips * 12, m, 0, rotYXZ(_l, P[C.PP], P[C.PW], P[C.PR]), P[C.PX], 0, P[C.PZ]);
    bone(d, row + B.torso * 12, d, row + B.hips * 12, rotYXZ(_l, P[C.TP], P[C.TW], P[C.TR]), 0, BODY.torsoY, 0);
    bone(d, row + B.head * 12, d, row + B.torso * 12, rotYXZ(_l, P[C.HP], P[C.HW], P[C.HR]), 0, BODY.neck, 0);
    // A sari or kurta follows the thighs: out over them when sitting, gathering shorter as it goes.
    const fold = Math.max(0, (P[C.HF] + P[C.HF + 1]) * 0.42), gather = 1 - 0.42 * smooth(0.3, 1.25, fold);
    rotX(_l, -fold); _l[1] *= gather; _l[5] *= gather; _l[9] *= gather;
    bone(d, row + B.skirt * 12, d, row + B.hips * 12, _l, 0, 0, 0);
    if (far) return;
    // Arms: the shoulder comes forward with a reach, and up with an arm raised overhead.
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? 1 : -1, ua = s === 0 ? B.upperArmL : B.upperArmR, sf = P[C.SF + s];
      bone(d, row + ua * 12, d, row + B.torso * 12, rotXZY(_l, -sf, -side * P[C.ST + s], side * P[C.SA + s]),
        side * BODY.shoulderX, BODY.shoulderY + 0.03 * smooth(1.6, 2.8, sf), 0.035 * clamp(sf / 1.6, -0.4, 1));
      bone(d, row + (ua + 1) * 12, d, row + ua * 12, rotX(_l, -P[C.EL + s]), 0, -BODY.upperArm, 0);
    }
    // Legs: thigh, shin, foot.
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? 1 : -1, th = s === 0 ? B.thighL : B.thighR;
      bone(d, row + th * 12, d, row + B.hips * 12, rotXZY(_l, -P[C.HF + s], -side * P[C.HT + s], side * P[C.HA + s]), side * BODY.hipX, BODY.hipY, 0);
      bone(d, row + (th + 1) * 12, d, row + th * 12, rotX(_l, P[C.KN + s]), 0, -BODY.thigh, 0);
      bone(d, row + (th + 2) * 12, d, row + (th + 1) * 12, rotX(_l, P[C.AN + s]), 0, -BODY.shin, 0);
    }
  }
}
