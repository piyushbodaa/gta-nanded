import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Geo } from '../src/world/geo.js';
import { createCityMaterials } from '../src/world/citymat.js';
import { packLayers, ATLAS_COLS, ATLAS_ROWS } from '../src/world/atlas.js';

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

test('each atlas tile is a layer of its own, with its paint mask in alpha', () => {
  // A painted atlas whose colour pixels say where they are, and whose mask says which tile.
  const t = 4, W = ATLAS_COLS * t;
  const read = (which, x0, y0, w, h) => {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = (y * w + x) * 4, X = x0 + x, Y = y0 + y;
        if (which === 'color') { out[k] = X; out[k + 1] = Y; out[k + 2] = 7; out[k + 3] = 255; } else out[k] = Math.floor(Y / t) * ATLAS_COLS + Math.floor(X / t);
      }
    }
    return out;
  };
  const layers = packLayers(read, t);
  assert.equal(layers.length, W * ATLAS_ROWS * t * 4);
  for (let row = 0; row < ATLAS_ROWS; row++) {
    for (let col = 0; col < ATLAS_COLS; col++) {
      const layer = row * ATLAS_COLS + col; // as the shader picks it: origin.y * cols + origin.x
      for (const [x, y] of [[0, 0], [t - 1, 0], [1, t - 1]]) {
        const k = ((layer * t + y) * t + x) * 4;
        assert.deepEqual([...layers.subarray(k, k + 4)], [col * t + x, row * t + y, 7, layer], `tile ${col},${row} pixel ${x},${y}`);
      }
    }
  }
});

test('the city shader takes no derivative inside a per-pixel branch', () => {
  // GLSL leaves derivatives undefined where neighbouring pixels take different sides of a branch:
  // fallen plaster and the rooms behind the glass branch on what the atlas paints at each pixel.
  const tex = new THREE.Texture();
  const { city, signs } = createCityMaterials({ map: tex, emissive: tex, detail: tex, signMap: tex, signEmissive: tex });
  const block = (src, head) => {
    const at = src.indexOf(head);
    assert.ok(at >= 0, `the shader has ${head}`);
    let depth = 0, i = src.indexOf('{', at);
    for (const start = i; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) return src.slice(start, i); }
    return '';
  };
  for (const [m, heads] of [[city, ['if (wear > 0.05 && tex.a > 0.5)', 'if (roomGlass > 0.01)']], [signs, ['if (roomGlass > 0.01)']]]) {
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    m.onBeforeCompile(shader);
    for (const head of heads) {
      const body = block(shader.fragmentShader, head).replace(/\/\/.*$/gm, ''); // code, not comments
      for (const op of ['dFdx', 'dFdy', 'fwidth', 'texture2D(', 'texture(']) assert.ok(!body.includes(op), `${op} inside ${head}`);
    }
  }
});
