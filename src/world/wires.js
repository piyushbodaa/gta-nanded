// Hardware lines are one solid pixel at any distance. Give the utility cables
// a width in metres and integrate their coverage across each scene pixel.
import * as THREE from 'three';
import { setBounds } from './geo.js';

export function wireGeometry(segments) {
  const count = segments.length / 6;
  const positions = new Float32Array(count * 12), tangents = new Float32Array(count * 12);
  const sides = new Int8Array(count * 4);
  const indices = [];
  for (let i = 0; i < count; i++) {
    const a = i * 6, vertex = i * 4;
    for (let corner = 0; corner < 4; corner++) {
      const end = corner < 2 ? a : a + 3, out = (vertex + corner) * 3;
      sides[vertex + corner] = corner % 2 ? 1 : -1;
      for (let axis = 0; axis < 3; axis++) {
        positions[out + axis] = segments[end + axis];
        tangents[out + axis] = segments[a + 3 + axis] - segments[a + axis];
      }
    }
    indices.push(vertex, vertex + 1, vertex + 2, vertex + 2, vertex + 1, vertex + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('alongWire', new THREE.BufferAttribute(tangents, 3));
  geometry.setAttribute('wireSide', new THREE.BufferAttribute(sides, 1));
  geometry.setIndex(indices);
  setBounds(geometry, positions);
  return geometry;
}

export function wireMaterial() {
  const material = new THREE.ShaderMaterial({
    uniforms: { heightPx: { value: 720 }, colour: { value: new THREE.Color(0x282a2b) }, ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog) },
    fog: true, transparent: true, side: THREE.DoubleSide, forceSinglePass: true, depthWrite: false,
    vertexShader: /* glsl */`
      attribute vec3 alongWire;
      attribute float wireSide;
      uniform float heightPx;
      varying vec2 coverage;
      #include <fog_pars_vertex>
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vec3 dir = mat3(modelViewMatrix) * alongWire;
        vec2 screenDir = dir.xy * -mvPosition.z + mvPosition.xy * dir.z;
        vec2 across = vec2(-screenDir.y, screenDir.x) / max(0.0001, length(screenDir));
        float pixel = 2.0 * max(0.1, -mvPosition.z) / (heightPx * projectionMatrix[1][1]);
        float radius = 0.014 / pixel;
        coverage = vec2(wireSide * (radius + 0.65), radius);
        mvPosition.xy += across * coverage.x * pixel;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 colour;
      varying vec2 coverage;
      #include <fog_pars_fragment>
      void main() {
        float offset = coverage.x, radius = coverage.y;
        float weight = clamp(min(offset + 0.5, radius) - max(offset - 0.5, -radius), 0.0, 1.0);
        gl_FragColor = vec4(colour, weight * 0.9);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const viewport = new THREE.Vector4();
  material.onBeforeRender = renderer => {
    material.uniforms.heightPx.value = renderer.getCurrentViewport(viewport).w;
  };
  return material;
}
