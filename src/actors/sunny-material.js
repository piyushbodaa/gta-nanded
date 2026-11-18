// The player's albedo is sampled in the bind pose, so it follows the existing animation and
// lighting. The crowd shader also supplies a complete outfit while either image is loading.
import * as THREE from 'three';
import { JOINTS, REGION } from './people-models.js';

export function sunnyTextures() {
  const uniforms = {};
  const loader = new THREE.TextureLoader();
  for (const [name, path] of [['Head', '/media/sunny-head.webp'], ['Clothes', '/media/sunny-clothes.webp']]) {
    const ready = { value: false };
    const texture = loader.load(path, () => { ready.value = true; });
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    uniforms['sunny' + name] = { value: texture };
    uniforms['sunny' + name + 'Ready'] = ready;
  }
  return uniforms;
}

export const SUNNY_PAINT = /* glsl */`
uniform sampler2D sunnyHead;
uniform sampler2D sunnyClothes;
uniform bool sunnyHeadReady;
uniform bool sunnyClothesReady;

// The top row holds the frontal and rear portraits. The profile below them supplies the
// temples, jaw and ears where either other projection would stretch to a line.
vec3 sunnyScalp(vec3 q) {
  vec2 front = vec2(0.506 + 4.72 * q.x, 0.54 + 4.59 * (q.y - 0.19));
  vec2 back = vec2(0.50 - 4.05 * q.x, 0.47 + 4.0 * (q.y - 0.19));
  // Around the crown both cameras would see an edge; lay the crown out across its depth.
  float crown = smoothstep(0.262, 0.31, q.y);
  front.y = mix(front.y, 0.88 + q.z * 1.05, crown);
  back.y = mix(back.y, 0.86 - q.z * 1.05, crown);
  vec2 profile = vec2(0.61 - 4.65 * q.z, 0.54 + 4.59 * (q.y - 0.19));
  profile.y = mix(profile.y, 0.91 - abs(q.x), crown);
  vec3 f = texture2D(sunnyHead, 0.5 * (vec2(0, 1) + clamp(front, 0.005, 0.995))).rgb;
  vec3 b = texture2D(sunnyHead, 0.5 * (vec2(1, 1) + clamp(back, 0.005, 0.995))).rgb;
  vec3 s = texture2D(sunnyHead, 0.5 * clamp(profile, vec2(0.16, 0.005), vec2(0.84, 0.995))).rgb;
  float angle = atan(abs(q.x), q.z - 0.004);
  return mix(mix(f, s, smoothstep(0.52, 0.98, angle)), b, smoothstep(1.98, 2.65, angle));
}

// The final quarter of the atlas holds skin and two views of the trainers.
vec3 sunnyDetail(vec2 uv, vec2 tile) {
  return texture2D(sunnyHead, vec2(0.5, 0.0) + 0.25 * (tile + clamp(uv, 0.006, 0.994))).rgb;
}

// Front and back panels meet at side seams. Pad each tile slightly for the mip filter.
vec3 sunnyPanel(vec2 uv, vec2 tile) {
  return texture2D(sunnyClothes, 0.5 * (tile + clamp(uv, 0.006, 0.994))).rgb;
}
vec3 sunnyPaint(vec3 base) {
  int r = vCrowdRegion;
  vec3 p = vCrowdP;
  if (sunnyHeadReady && (r == ${REGION.face} || r == ${REGION.hair})) {
    return sunnyScalp(p - CROWD_HEAD) * vCrowdAO;
  }
  if (sunnyHeadReady && r == ${REGION.plain} && vCrowdIsSkin > 0.5) {
    bool neck = p.y > CROWD_HEAD.y - 0.08;
    float x = neck ? p.x : abs(p.x) - 0.235;
    float around = atan(x, p.z) / 6.28319;
    vec2 skinUV = vec2(0.5 + 0.80 * around, neck ? 0.18 + 3.2 * (p.y - 0.52) : (p.y + 0.13) / 0.52);
    vec3 skin = sunnyDetail(skinUV, vec2(neck ? 1.0 : 0.0, 1.0));
    return mix(base, skin, neck ? 0.38 : 0.55) * vCrowdAO;
  }
  if (sunnyHeadReady && r == ${REGION.shoe}) {
    float y = p.y - ${JOINTS.footL[1].toFixed(3)}, x = abs(p.x) - ${JOINTS.footL[0].toFixed(3)};
    float along = clamp((p.z + 0.077) / 0.256, 0.015, 0.985);
    vec3 side = sunnyDetail(vec2(1.0 - along, 0.22 + (y + 0.057) * (3.9 - along)), vec2(0, 0));
    vec3 top = sunnyDetail(vec2(0.50 + 3.0 * x, 0.10 + 0.85 * along), vec2(1, 0));
    float instep = (1.0 - smoothstep(0.027, 0.049, abs(x))) * smoothstep(-0.033, -0.009, y);
    return mix(side, top, instep) * vCrowdAO;
  }
  if (sunnyClothesReady && r == ${REGION.shirt}) {
    float sleeve = vCrowdUV.x;
    // Across the curved chest, the button placket stays on the centre line.
    float a = atan(p.x, abs(p.z) * 1.65 + 0.001);
    vec2 uv = vec2(0.5 + a / 3.14159, (p.y + 0.057) / 0.68);
    bool back = p.z < 0.0;
    vec3 cloth = sunnyPanel(uv, vec2(back ? 1.0 : 0.0, 1.0));
    // Cut the sleeves from the outer back panel, clear of the pockets and placket.
    if (sleeve > 0.0 && abs(p.x) > 0.12) {
      vec2 arm = vec2(0.23 + 0.18 * sin(atan(abs(p.x) - 0.234, p.z)), 0.18 + (p.y - 0.30) * 1.54);
      vec3 cuff = sunnyPanel(arm, vec2(1.0, 1.0));
      float hem = 1.0 - smoothstep(0.0, 0.005, abs(p.y - 0.332 - 0.16 * (abs(p.x) - 0.235)));
      cloth = mix(cloth, cuff * (1.0 - 0.27 * hem), smoothstep(0.15, 0.90, sleeve));
    }
    if (p.z > 0.012 && abs(p.x) < 0.06) {
      vec3 throat = sunnyHeadReady ? mix(vCrowdSkin, sunnyDetail(vec2(0.5 + 1.5 * p.x, 0.18 + 3.2 * (p.y - 0.52)), vec2(1, 1)), 0.38) : vCrowdSkin;
      cloth = mix(cloth, throat, smoothstep(-0.002, 0.002, p.y - 0.558 - 1.75 * abs(p.x)));
    }
    return cloth * vCrowdAO;
  }
  if (sunnyClothesReady && r == ${REGION.collar}) {
    return sunnyPanel(vec2(0.24 + 0.55 * vCrowdUV.x, 0.32 + 0.08 * vCrowdUV.y), vec2(1, 1)) * vCrowdAO;
  }
  if (sunnyClothesReady && r == ${REGION.pants}) {
    float a = atan(abs(p.x) - 0.095, abs(p.z) + 0.015);
    vec2 uv = vec2(0.5 + a / 3.14159, (p.y + 0.90) / 0.97);
    vec3 front = sunnyPanel(uv, vec2(0, 0));
    // A pocket runs from the hip down to the seat, with plain denim below.
    uv.y = p.y > -0.17 ? 0.53 + (p.y + 0.17) * 1.94 : 0.53 + (p.y + 0.17) * 0.70;
    vec3 back = sunnyPanel(uv, vec2(1, 0));
    return mix(back, front, smoothstep(-0.016, 0.016, p.z)) * vCrowdAO;
  }
  return crowdPaint(base);
}
`;
