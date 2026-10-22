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
// The material is physically based: each mode sets its own roughness (glass in
// the facades, wet asphalt in the monsoon), and a cheap ambient occlusion
// darkens the sky light near the ground, where walls and streets meet.
import * as THREE from 'three';
import { ATLAS_COLS, ATLAS_ROWS, TILE_PX, SIGN_COLS, SIGN_ROWS } from './atlas.js';

export const cityUniforms = {
  uNight: { value: 0 }, // 0 day .. 1 night: drives window and shop lighting
  uTime: { value: 0 },
  uWet: { value: 0 }, // monsoon: darker, glossier streets
};

export function createAtlasTextures(atlas, signs, renderer, detailCanvas) {
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
  const detail = new THREE.CanvasTexture(detailCanvas);
  detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
  detail.anisotropy = map.anisotropy;
  return { map, emissive, signMap, signEmissive, detail };
}

const common = /* glsl */`
  varying vec2 vTUv;
  varying vec4 vTint;
  varying vec4 vTile;
  varying vec3 vCityWorld;
`;

function patch(material, { map, emissive, detail, cols, rows, pad, signs = false }) {
  material.onBeforeCompile = shader => {
    shader.uniforms.cityAtlas = { value: map };
    shader.uniforms.cityEmissive = { value: emissive };
    shader.uniforms.cityDetail = { value: detail };
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
        uniform sampler2D cityDetail;
        uniform float uNight;
        uniform float uWet;
        ${common}
        float cityHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        vec3 cityOctDecode(vec2 e) {
          vec3 n = vec3(e.x, 1.0 - abs(e.x) - abs(e.y), e.y);
          if (n.y < 0.0) n.xz = (1.0 - abs(n.zx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.z >= 0.0 ? 1.0 : -1.0);
          return normalize(n);
        }`)
      .replace('#include <map_fragment>', `
        vec3 cityGlow = vec3(0.0), roomLight = vec3(0.0);
        float cityRough = 0.85, cityMetal = 0.0, cityAO = 1.0, citySmooth = 0.0, roomGlass = 0.0;
        {
          float mode = floor(vTile.w + 0.5);
          vec3 paint = vTint.rgb;
          // Large, soft variation in grime and sun-bleaching hides the repeats.
          float macro = clamp(texture2D(cityDetail, vCityWorld.xz * 0.0105).g * 0.6 + texture2D(cityDetail, vCityWorld.xz * 0.047 + 0.31).g * 0.4, 0.0, 1.0);
          float puddle = 0.0;
          if (uWet > 0.0) puddle = smoothstep(0.5, 0.7, texture2D(cityDetail, vCityWorld.xz * 0.071 + 0.57).g * 0.65 + macro * 0.35);
          if (mode < 0.5) {
            diffuseColor.rgb *= paint;
            // Props: soft occlusion near the ground.
            cityAO = mix(0.6, 1.0, smoothstep(0.0, 1.2, vCityWorld.y));
            cityRough = 0.8;
            // Gilded metal (domes, finials) and true normals on lathed shapes.
            if (vTile.x > 0.5) { cityMetal = 1.0; cityRough = 0.24; }
            citySmooth = step(0.5, vTile.y);
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
            vec3 e = vec3(0.0);
            if (mode < 2.5) e = textureGrad(cityEmissive, auv, gx, gy).rgb;
            if (mode < 1.5) {
              // Walls: each building has its own age, from fresh paint to decades of monsoons.
              float age = fract(vTint.a * 7.31 + 0.17);
              float wallDetail = texture2D(cityDetail, vTUv * 1.3).b;
              // Sun-bleached paint.
              float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum) * 1.06, age * 0.28 * tex.a);
              // Rain run-off below every ledge, darker on older buildings.
              float streak = texture2D(cityDetail, vec2(vTUv.x * 2.7, vCityWorld.y * 0.07 + vTint.a)).g;
              diffuseColor.rgb *= 1.0 - max(streak - 0.45, 0.0) * 0.5 * age * tex.a;
              // Damp, splashed band at the foot of the wall.
              float dampTop = mix(0.35, 1.15, age) + (wallDetail - 0.5) * 0.35;
              float damp = 1.0 - smoothstep(dampTop - 0.12, dampTop + 0.08, vCityWorld.y);
              diffuseColor.rgb *= mix(vec3(1.0), vec3(0.7, 0.68, 0.6), damp * 0.85);
              diffuseColor.rgb *= 0.9 + macro * 0.18;
              diffuseColor.rgb *= 0.86 + 0.28 * wallDetail;
              cityAO = mix(0.5, 1.0, smoothstep(0.0, 3.2, vCityWorld.y));
              // Window glass (not the open fronts of shops) is smooth and reflects the sky.
              float glass = (vTile.y > 3.5 && vTile.y < 4.5) ? 0.0 : smoothstep(0.12, 0.45, e.g);
              cityRough = mix(0.9, 0.08, glass);
              // Behind dark glass there is a room: walk the view ray into a box the size
              // of the bay and storey and shade whichever wall, floor or ceiling it meets.
              roomGlass = glass * (1.0 - smoothstep(0.1, 0.22, dot(tex.rgb, vec3(0.3, 0.59, 0.11))));
              if (roomGlass > 0.01) {
                vec3 wn = normalize(cross(dFdx(vCityWorld), dFdy(vCityWorld)));
                vec3 wt = vec3(wn.z, 0.0, -wn.x);
                vec3 vd = normalize(vCityWorld - cameraPosition);
                vec3 rd = vec3(dot(vd, wt), vd.y, dot(vd, wn));
                rd.z = min(rd.z, -0.05);
                vec2 cellR = floor(coord);
                float roomSeed = cityHash(cellR * 3.17 + vTint.a * 53.1);
                const float depth = 0.85;
                vec2 tw = (step(0.0, rd.xy) - f) / max(abs(rd.xy), vec2(1e-4)) * sign(rd.xy + 1e-6);
                float tb = depth / -rd.z;
                float t = min(min(tw.x, tw.y), tb);
                vec3 hit = vec3(f, 0.0) + rd * t;
                vec3 paintR = mix(vec3(0.62, 0.72, 0.62), vec3(0.78, 0.66, 0.68), fract(roomSeed * 3.7));
                paintR = mix(paintR, vec3(0.72, 0.76, 0.86), step(0.66, fract(roomSeed * 7.1)));
                vec3 roomCol;
                if (t == tb) {
                  roomCol = paintR;
                  // A door or a steel almirah against the back wall.
                  vec2 q = hit.xy;
                  float furn = step(abs(q.x - (0.25 + 0.5 * fract(roomSeed * 5.3))), 0.11) * step(q.y, 0.62);
                  roomCol = mix(roomCol, mix(vec3(0.32, 0.22, 0.15), vec3(0.55, 0.56, 0.58), step(0.5, fract(roomSeed * 9.1))), furn);
                } else if (t == tw.y) roomCol = rd.y < 0.0 ? vec3(0.42, 0.36, 0.3) : vec3(0.85, 0.84, 0.8);
                else roomCol = paintR * 0.8;
                float deep = clamp(-hit.z / depth, 0.0, 1.0);
                vec3 dayRoom = roomCol * mix(0.09, 0.035, deep);
                float hue = cityHash(cellR * 5.13 + vTint.a * 7.0);
                vec3 bulb = mix(vec3(1.0, 0.74, 0.42), vec3(0.85, 0.94, 1.0), step(0.62, hue));
                float tube = rd.y > 0.0 && t == tw.y ? smoothstep(0.12, 0.0, abs(hit.z + depth * 0.75)) * 2.5 : 0.0;
                vec3 nightRoom = litChance > 0.0 ? roomCol * bulb * (1.1 - deep * 0.45) + bulb * tube : roomCol * 0.012;
                roomLight = mix(dayRoom, nightRoom, uNight);
              }
              diffuseColor.rgb = mix(diffuseColor.rgb * (1.0 - glass * 0.35), vec3(0.012), roomGlass);
            } else if (mode < 2.5) {
              cityRough = ${signs ? '0.5' : '0.6'};
            } else if (mode < 3.5) {
              // Roads: dust blown in along both edges, darker tyre-polished lanes.
              float edge = min(f.x, 1.0 - f.x);
              float dust = (1.0 - smoothstep(0.02, 0.2, edge)) * (0.55 + 0.45 * macro);
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.6, 0.54, 0.45) * (0.85 + macro * 0.3), dust * 0.6);
              diffuseColor.rgb *= 0.86 + macro * 0.22;
              diffuseColor.rgb *= 0.74 + 0.52 * texture2D(cityDetail, vCityWorld.xz * 0.55).r;
              cityRough = 0.9;
            } else {
              vec4 det = texture2D(cityDetail, vCityWorld.xz * 0.23);
              diffuseColor.rgb *= 0.84 + macro * 0.3;
              diffuseColor.rgb *= 0.7 + 0.6 * mix(det.g, texture2D(cityDetail, vCityWorld.xz * 0.61).r, 0.35);
              cityRough = 0.96;
            }
            // Monsoon: everything darkens; flat ground turns glossy with standing water.
            if (uWet > 0.0) {
              if (mode > 2.5) {
                bool asphalt = mode < 3.5 || (abs(vTile.x - 1.0) < 0.5 && abs(vTile.y - 7.0) < 0.5);
                float wet = min(1.0, uWet * 1.25) * (0.7 + 0.3 * puddle);
                diffuseColor.rgb *= 1.0 - (asphalt ? 0.55 : 0.4) * wet;
                cityRough = mix(cityRough, asphalt ? mix(0.18, 0.02, puddle) : mix(0.45, 0.08, puddle), wet);
              } else {
                diffuseColor.rgb *= 1.0 - 0.18 * uWet;
                cityRough = mix(cityRough, 0.5, uWet * 0.5);
              }
            }
            if (uNight > 0.01 && litChance > 0.0) {
              float hue = cityHash(floor(coord) * 5.13 + vTint.a * 7.0);
              vec3 lamp = mix(vec3(1.0, 0.72, 0.38), vec3(0.82, 0.93, 1.0), step(0.62, hue));
              ${signs ? 'lamp = vec3(1.0);' : ''}
              cityGlow = e * lamp * litChance * uNight * ${signs ? '1.9' : '1.8'};
            }
            // Rooms seen through the glass replace the flat glow there.
            cityGlow = mix(cityGlow, roomLight * 1.6, roomGlass);
          }
        }`)
      // Sky reflections only where the surface is smooth enough to show them.
      .replace('#include <lights_fragment_maps>', THREE.ShaderChunk.lights_fragment_maps.replace(
        'radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );',
        'radiance += cityRough < 0.7 ? getIBLRadiance( geometryViewDir, geometryNormal, material.roughness ) : iblIrradiance * RECIPROCAL_PI;'))
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (citySmooth > 0.5) normal = normalize((viewMatrix * vec4(cityOctDecode(vTUv), 0.0)).xyz);`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = cityRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = cityMetal;')
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= cityAO;
        reflectedLight.indirectSpecular *= cityAO * cityAO;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += cityGlow;`);
  };
  material.customProgramCacheKey = () => (signs ? 'city-signs-v4' : 'city-v4');
  return material;
}

export function createCityMaterials(tex) {
  const city = patch(new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.85, metalness: 0 }), {
    map: tex.map, emissive: tex.emissive, detail: tex.detail, cols: ATLAS_COLS, rows: ATLAS_ROWS, pad: 3 / TILE_PX,
  });
  const signs = patch(new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.5, metalness: 0 }), {
    map: tex.signMap, emissive: tex.signEmissive, detail: tex.detail, cols: SIGN_COLS, rows: SIGN_ROWS, pad: 0.004, signs: true,
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
