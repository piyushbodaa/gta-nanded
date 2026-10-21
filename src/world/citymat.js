// The one material the whole city is drawn with. A chunk of streets, walls,
// roofs, ground and props is a single mesh; per-vertex attributes pick which
// atlas tile (and how) each face samples, so a chunk costs one draw call.
//
// Vertex attributes:
//   position  Float32x3
//   uv        Float32x2  tile-space coordinates (1 unit = one tile repeat)
//   tint      Uint8x4    paint colour (rgb) and a per-building seed (a)
//   tile      Uint8x4    [atlas col, atlas row, variant count, mode]
// Modes: 0 vertex colour only · 1 repeating facade, random variant per cell ·
//        2 single tile clamped · 3 road (clamped across, repeating along) ·
//        4 tile projected in world space (ground, junction pads)
import * as THREE from 'three';
import { ATLAS_COLS, ATLAS_ROWS, TILE_PX, SIGN_COLS, SIGN_ROWS } from './atlas.js';

export const cityUniforms = {
  uNight: { value: 0 }, // 0 day .. 1 night: drives window and shop lighting
  uTime: { value: 0 },
  uWet: { value: 0 }, // monsoon: darker, glossier streets
};

export function createAtlasTextures(atlas, signs, renderer) {
  const map = new THREE.DataTexture(atlas.data, atlas.width, atlas.height, THREE.RGBAFormat);
  map.colorSpace = THREE.SRGBColorSpace;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  map.flipY = false;
  map.needsUpdate = true;
  const emissive = new THREE.CanvasTexture(atlas.emissive);
  emissive.colorSpace = THREE.SRGBColorSpace;
  emissive.flipY = false;
  const signMap = new THREE.CanvasTexture(signs.canvas);
  signMap.colorSpace = THREE.SRGBColorSpace;
  signMap.flipY = false;
  signMap.anisotropy = map.anisotropy;
  const signEmissive = new THREE.CanvasTexture(signs.emissive);
  signEmissive.colorSpace = THREE.SRGBColorSpace;
  signEmissive.flipY = false;
  return { map, emissive, signMap, signEmissive };
}

const common = /* glsl */`
  varying vec2 vTUv;
  varying vec4 vTint;
  varying vec4 vTile;
  varying vec3 vCityWorld;
`;

function patch(material, { map, emissive, cols, rows, pad, signs = false }) {
  material.onBeforeCompile = shader => {
    shader.uniforms.cityAtlas = { value: map };
    shader.uniforms.cityEmissive = { value: emissive };
    shader.uniforms.uNight = cityUniforms.uNight;
    shader.uniforms.uWet = cityUniforms.uWet;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 tint;
        attribute vec4 tile;
        ${common}`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        vTUv = uv; vTint = tint; vTile = tile;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vCityWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D cityAtlas;
        uniform sampler2D cityEmissive;
        uniform float uNight;
        uniform float uWet;
        ${common}
        float cityHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }`)
      .replace('#include <map_fragment>', `
        vec3 cityGlow = vec3(0.0);
        {
          float mode = floor(vTile.w + 0.5);
          vec3 paint = vTint.rgb;
          if (mode < 0.5) {
            diffuseColor.rgb *= paint;
            // Props: light ambient occlusion near the ground.
            diffuseColor.rgb *= mix(0.72, 1.0, smoothstep(0.0, 1.2, vCityWorld.y));
          } else {
            vec2 origin = vTile.xy;
            vec2 coord = vTUv;
            vec2 f;
            float litChance = 0.0;
            if (mode < 1.5) {
              vec2 cell = floor(coord);
              float variants = max(vTile.z, 1.0);
              float pick = cityHash(cell * 1.37 + vTint.a * 91.7);
              origin.x += floor(pick * variants);
              f = fract(coord);
              float litHash = cityHash(cell * 2.71 + vTint.a * 17.3 + 3.1);
              litChance = step(litHash, 0.46);
              if (vTile.y > 3.5 && vTile.y < 4.5) litChance = 1.0; // shops stay lit after dark
            } else if (mode < 2.5) {
              f = clamp(coord, 0.0, 1.0);
              litChance = 1.0;
            } else if (mode < 3.5) {
              f = vec2(clamp(coord.x, 0.0, 1.0), fract(coord.y));
            } else {
              coord = vCityWorld.xz / 6.4;
              f = fract(coord);
            }
            const vec2 pad = vec2(${pad.toFixed(5)});
            vec2 g2 = f * (1.0 - 2.0 * pad) + pad;
            vec2 auv = vec2((origin.x + g2.x) / ${cols.toFixed(1)}, (origin.y + 1.0 - g2.y) / ${rows.toFixed(1)});
            vec2 gscale = vec2(1.0 / ${cols.toFixed(1)}, 1.0 / ${rows.toFixed(1)}) * (1.0 - 2.0 * pad.x);
            vec2 gx = dFdx(coord) * gscale, gy = dFdy(coord) * gscale;
            vec4 tex = textureGrad(cityAtlas, auv, gx, gy);
            vec3 painted = mix(tex.rgb, tex.rgb * paint * 1.12, tex.a);
            ${signs ? 'painted = tex.rgb;' : ''}
            diffuseColor.rgb *= painted;
            if (mode < 1.5) diffuseColor.rgb *= mix(0.58, 1.0, smoothstep(0.0, 2.6, vCityWorld.y));
            if (mode > 2.5 && uWet > 0.0) diffuseColor.rgb *= 1.0 - 0.35 * uWet;
            if (uNight > 0.01 && litChance > 0.0) {
              vec3 e = textureGrad(cityEmissive, auv, gx, gy).rgb;
              float hue = cityHash(floor(coord) * 5.13 + vTint.a * 7.0);
              vec3 lamp = mix(vec3(1.0, 0.72, 0.38), vec3(0.82, 0.93, 1.0), step(0.62, hue));
              ${signs ? 'lamp = vec3(1.0);' : ''}
              cityGlow = e * lamp * litChance * uNight * ${signs ? '1.15' : '1.05'};
            }
          }
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += cityGlow;`);
  };
  material.customProgramCacheKey = () => (signs ? 'city-signs-v1' : 'city-v1');
  return material;
}

export function createCityMaterials(tex) {
  const city = patch(new THREE.MeshLambertMaterial({ flatShading: true }), {
    map: tex.map, emissive: tex.emissive, cols: ATLAS_COLS, rows: ATLAS_ROWS, pad: 3 / TILE_PX,
  });
  const signs = patch(new THREE.MeshLambertMaterial({ flatShading: true }), {
    map: tex.signMap, emissive: tex.signEmissive, cols: SIGN_COLS, rows: SIGN_ROWS, pad: 0.004, signs: true,
  });
  // Night: pools of sodium light on the road under every street lamp.
  const glowTex = radialTexture();
  const pools = new THREE.MeshBasicMaterial({
    map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    color: new THREE.Color(1, 0.72, 0.4), opacity: 0, fog: true,
  });
  pools.polygonOffset = true; pools.polygonOffsetFactor = -2; pools.polygonOffsetUnits = -4;
  const wires = new THREE.LineBasicMaterial({ color: 0x1d1f20, transparent: true, opacity: 0.75, fog: true });
  return { city, signs, pools, wires, glowTex };
}

export function radialTexture(size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
