// The Godavari and its tributaries: strips that follow the mapped river lines,
// shaded with moving ripples, sky reflection and sun glints.
import * as THREE from 'three';

export const WATER_Y = -2.7;

export function createRivers(scene, city, sky) {
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 1, 1) },
      uSky: { value: new THREE.Color(0.6, 0.7, 0.85) },
      uDeep: { value: new THREE.Color(0.07, 0.17, 0.16) },
      uShallow: { value: new THREE.Color(0.24, 0.3, 0.22) },
      uNight: { value: 0 },
      uRain: { value: 0 },
    },
  ]);
  const material = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    side: THREE.DoubleSide, // a strip folded at a sharp bend still covers the water there
    vertexShader: /* glsl */`
      #include <fog_pars_vertex>
      varying vec3 vWorld;
      varying float vEdge;
      attribute float edge;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vEdge = edge;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <fog_pars_fragment>
      uniform float uTime, uNight, uRain;
      uniform vec3 uSunDir, uSunColor, uSky, uDeep, uShallow;
      varying vec3 vWorld;
      varying float vEdge;
      float h21(vec2 p) { p = fract(p * vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x * p.y); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
      }
      float waves(vec2 p) {
        return noise(p * 0.18 + vec2(uTime * 0.05, uTime * 0.02)) * 0.6 + noise(p * 0.55 - vec2(uTime * 0.09, -uTime * 0.04)) * 0.3 + noise(p * 1.7 + uTime * 0.2) * 0.1;
      }
      void main() {
        vec2 p = vWorld.xz;
        float e = 0.35;
        float hC = waves(p), hX = waves(p + vec2(e, 0.0)), hZ = waves(p + vec2(0.0, e));
        vec3 n = normalize(vec3((hC - hX) * (2.2 + uRain * 3.0), 1.0, (hC - hZ) * (2.2 + uRain * 3.0)));
        vec3 view = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(n, view), 0.0), 3.0);
        vec3 body = mix(uShallow, uDeep, smoothstep(0.0, 0.6, vEdge));
        vec3 col = mix(body, uSky * 0.85, 0.06 + fres * 0.42);
        vec3 h = normalize(uSunDir + view);
        float spec = pow(max(dot(n, h), 0.0), 220.0) * step(0.0, uSunDir.y);
        col += uSunColor * spec * 2.5;
        // Foam where the water laps the bank.
        col = mix(col, vec3(0.75, 0.72, 0.62), smoothstep(0.08, 0.0, vEdge) * 0.45 * (0.6 + 0.4 * sin(uTime * 1.3 + p.x * 0.3)));
        col *= mix(1.0, 0.35, uNight);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });

  const meshes = [], rd = {};
  for (const river of city.rivers) {
    const pts = river.p;
    const n = pts.length / 2;
    if (n < 2) continue;
    const hw = river.w / 2 + 5;
    // Centre line + two edges, so the shader knows how far from the bank it is.
    const pos = [], edge = [], idx = [];
    for (let i = 0; i < n; i++) {
      const x = pts[i * 2], z = pts[i * 2 + 1];
      const px = pts[Math.max(0, i - 1) * 2], pz = pts[Math.max(0, i - 1) * 2 + 1];
      const nx2 = pts[Math.min(n - 1, i + 1) * 2], nz2 = pts[Math.min(n - 1, i + 1) * 2 + 1];
      let dx = nx2 - px, dz = nz2 - pz;
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const ox = dz, oz = -dx;
      // At a bend the outside edge is mitred, so the strip keeps its full width round it. (The
      // inside of a sharp bend on short reaches folds over itself, so the material is two-sided.)
      const ix = x - px, iz = z - pz, il = Math.hypot(ix, iz), jx = nx2 - x, jz = nz2 - z, jl = Math.hypot(jx, jz);
      const cosA = Math.min(il ? (ix * dx + iz * dz) / il : 1, jl ? (jx * dx + jz * dz) / jl : 1);
      const miter = 1 / Math.max(cosA, 0.5);
      const inX = (jl ? jx / jl : 0) - (il ? ix / il : 0), inZ = (jl ? jz / jl : 0) - (il ? iz / il : 0); // toward the inside
      const outer = ox * inX + oz * inZ < 0 ? 1 : -1;
      for (const k of [-1, -0.5, 0, 0.5, 1]) {
        const o = hw * k * (k * outer > 0 ? miter : 1), vx = x + ox * o, vz = z + oz * o;
        pos.push(vx, WATER_Y, vz);
        // How far into the water the vertex really is (0 at the bank, 1 mid-river), not where
        // it sits across the strip: where a fold puts an edge vertex midstream, no foam follows it.
        edge.push(THREE.MathUtils.clamp(1 - (city.riverDistance(vx, vz, rd).d + river.w / 2) / hw, 0, 1));
      }
    }
    for (let i = 0; i < n - 1; i++) {
      for (let k = 0; k < 4; k++) {
        const a = i * 5 + k, b = a + 1, c = a + 5, d = a + 6;
        // Up-facing winding.
        idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('edge', new THREE.Float32BufferAttribute(edge, 1));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = false;
    mesh.name = `river-${river.name}`;
    scene.add(mesh);
    meshes.push(mesh);
  }
  return {
    meshes,
    material,
    update(dt) {
      uniforms.uTime.value += dt;
      uniforms.uSunDir.value.copy(sky.sunDir);
      uniforms.uSunColor.value.copy(sky.sun.color).multiplyScalar(Math.min(1, sky.sun.intensity / 3));
      uniforms.uSky.value.copy(sky.uniforms.uHorizon.value).lerp(sky.uniforms.uZenith.value, 0.4);
      uniforms.uNight.value = sky.night;
      uniforms.uRain.value = sky.w.grey;
    },
  };
}
