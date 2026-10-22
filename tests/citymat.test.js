import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Geo } from '../src/world/geo.js';
import { createCityMaterials } from '../src/world/citymat.js';

// Just enough canvas for the light-pool texture, so the city materials can be made outside a browser.
globalThis.document ??= { createElement: () => ({ getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }) }) };

test('the city receives sun shadows: its shader never normalizes the missing vertex normal', () => {
  // City meshes carry no normal attribute (flat shading derives one per pixel)...
  assert.equal(new Geo(4).build().getAttribute('normal'), undefined);
  // ...so three's shadow lookup, which normalizes the vertex normal, must be given a real one.
  const tex = new THREE.Texture();
  const { city, signs } = createCityMaterials({ map: tex, emissive: tex, detail: tex, signMap: tex, signEmissive: tex });
  for (const m of [city, signs]) {
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    m.onBeforeCompile(shader);
    assert.ok(!shader.vertexShader.includes('#include <beginnormal_vertex>'), 'the zero normal is replaced');
    assert.ok(shader.vertexShader.includes('vec3 objectNormal = vec3(0.0, 1.0, 0.0);'));
    assert.ok(shader.vertexShader.includes('#include <shadowmap_vertex>'), 'the shadow lookup itself stays');
    assert.ok(shader.fragmentShader.includes('#include <shadowmap_pars_fragment>'), 'and so does the shadow test');
  }
});
