import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Sky } from '../src/world/sky.js';
import { Post } from '../src/world/post.js';

// Just enough of a WebGL renderer for Post to size, check and swap its targets, and a record of
// every target (with its depth texture) that Post makes until it is disposed.
function rig(complete = () => true) {
  const size = { w: 1280, h: 720 };
  const gl = { FRAMEBUFFER: 0x8d40, FRAMEBUFFER_COMPLETE: 0x8cd5, checkFramebufferStatus: () => (complete() ? 0x8cd5 : 0) };
  let bound = null;
  const renderer = {
    extensions: { has: name => name === 'EXT_color_buffer_float' },
    getDrawingBufferSize: v => v.set(size.w, size.h),
    getContext: () => gl, getRenderTarget: () => bound, setRenderTarget: t => { bound = t; },
  };
  const sky = new Sky(new THREE.Scene(), null);
  const post = new Post(renderer, sky);
  const live = new Set();
  const track = o => { if (!o || o.__seen) return; o.__seen = true; live.add(o); o.addEventListener('dispose', () => live.delete(o)); };
  const ensure = () => { post._ensure(); track(post.rt); track(post.rt?.depthTexture); post.mips.forEach(track); };
  return { post, sky, size, live, ensure };
}

test('the HDR target and bloom chain are replaced, not leaked, on every resize and quality change', () => {
  const { post, size, live, ensure } = rig();
  post.configure({ msaa: true, bloom: true });
  ensure();
  const perSet = 2 + post.levels; // target, its depth texture, the bloom mips
  assert.equal(live.size, perSet);
  // Window resizes and the quality governor's resolution and MSAA steps, back and forth.
  for (const [w, h, msaa] of [[1600, 900, true], [960, 540, false], [1281, 721, true], [640, 360, false], [1280, 720, true], [1280, 720, false]]) {
    post.configure({ msaa, bloom: true });
    size.w = w; size.h = h;
    ensure();
    assert.equal(live.size, perSet, `${w}x${h}: ${live.size} targets alive, expected ${perSet}`);
    assert.deepEqual([post.rt.width, post.rt.height, post.rt.samples], [w, h, msaa ? 4 : 0]);
    assert.equal(post.mips.length, post.levels);
    let mw = w, mh = h;
    for (const m of post.mips) { mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1); assert.deepEqual([m.width, m.height], [mw, mh]); }
  }
});

test('a GPU that refuses multisampled targets gets FXAA instead, and is not asked again on every resize', () => {
  let asked = 0;
  // Only multisampled targets are refused.
  const { post, size, ensure } = rig(() => { asked++; return !post.rt.samples; });
  post.configure({ msaa: true, bloom: true });
  assert.equal(post.final.uniforms.uAA.value, 0, 'MSAA asked for: no FXAA yet');
  ensure();
  assert.deepEqual([post.format, post.msaa], ['r11g11b10', 0]);
  assert.equal(post.final.uniforms.uAA.value, 1, 'edges are smoothed without MSAA');
  for (const [w, h] of [[1600, 900], [960, 540], [1280, 720]]) {
    post.configure({ msaa: true, bloom: true });
    size.w = w; size.h = h;
    asked = 0;
    ensure();
    assert.equal(post.rt.samples, 0);
    assert.equal(asked, 2, `${w}x${h}: only the plain target and the bloom chain are checked`);
    assert.equal(post.final.uniforms.uAA.value, 1);
  }
});

test('targets the GPU refuses are disposed before the next option, and the last resort draws directly', () => {
  let refusals = 3; // R11G11B10 with and without MSAA, then half floats with MSAA
  const a = rig(() => refusals-- <= 0);
  a.post.configure({ msaa: true, bloom: true });
  a.ensure();
  assert.deepEqual([a.post.format, a.post.msaa, a.post.enabled], ['half', 0, true]);
  assert.equal(a.live.size, 2 + a.post.levels, 'only the accepted set is alive');
  const b = rig(() => false);
  b.post.configure({ msaa: true, bloom: true });
  b.ensure();
  assert.equal(b.post.enabled, false);
  assert.equal(b.live.size, 0, 'nothing is left allocated');
  assert.ok(b.sky.scene.fog, 'scene fog takes over from the post haze');
});
