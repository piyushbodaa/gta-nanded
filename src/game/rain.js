// A single instanced draw. Drops wrap at the far edges of a volume around the
// camera, but fall in world space, so orbiting or driving through them has parallax.
import * as THREE from 'three';
import { rng } from '../core/math.js';

const DROPS = 3200;

export function createRain() {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0,
  ], 3));
  geometry.setIndex([0, 1, 2, 2, 1, 3]);
  const seed = new Float32Array(DROPS * 4), random = rng(0x4e414e44);
  for (let i = 0; i < seed.length; i++) seed[i] = random();
  geometry.setAttribute('drop', new THREE.InstancedBufferAttribute(seed, 4));
  geometry.instanceCount = DROPS;

  const material = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, strength: { value: 0 }, night: { value: 0 }, heightPx: { value: 720 } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
    vertexShader: /* glsl */`
      attribute vec4 drop;
      uniform float time, strength, heightPx;
      varying vec2 stroke;
      varying float alpha;
      void main() {
        vec3 span = vec3(50.0, 28.0, 50.0);
        vec3 fall = vec3(1.9, -mix(12.0, 19.0, drop.w), 0.7);
        vec3 offset = mod(drop.xyz * span + time * fall - cameraPosition + span * 0.5, span) - span * 0.5;
        vec3 eye = (viewMatrix * vec4(cameraPosition + offset, 1.0)).xyz;
        vec3 trail = mat3(viewMatrix) * fall * mix(0.009, 0.018, drop.w);
        vec2 projected = trail.xy * max(0.1, -eye.z) + eye.xy * trail.z;
        vec2 across = vec2(-projected.y, projected.x) / max(length(projected), 0.0001);
        float pixel = 2.0 * max(0.1, -eye.z) / (heightPx * projectionMatrix[1][1]);
        eye += position.y * trail;
        eye.xy += across * position.x * max(0.007, pixel * 0.67);
        stroke = position.xy;
        float edge = max(max(abs(offset.x) / 25.0, abs(offset.z) / 25.0), abs(offset.y) / 14.0);
        alpha = strength * (1.0 - smoothstep(0.77, 1.0, edge))
              * smoothstep(0.5, 1.8, -eye.z) * mix(0.28, 0.54, drop.w);
        gl_Position = projectionMatrix * vec4(eye, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float night;
      varying vec2 stroke;
      varying float alpha;
      void main() {
        float coverage = (1.0 - stroke.x * stroke.x) * (1.0 - abs(stroke.y));
        gl_FragColor = vec4(mix(vec3(0.66, 0.77, 0.83), vec3(0.24, 0.29, 0.34), night), alpha * coverage);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = 6;
  return mesh;
}

export function updateRain(mesh, dt, strength, night, heightPx, low) {
  mesh.visible = strength > 0.005;
  if (!mesh.visible) return;
  const u = mesh.material.uniforms;
  u.time.value += dt;
  u.strength.value = strength;
  u.night.value = night;
  u.heightPx.value = heightPx;
  mesh.geometry.instanceCount = low ? 1600 : DROPS;
}
