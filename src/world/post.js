// Post-processing. The world is drawn into a high-dynamic-range buffer; this
// pass adds the air (haze that thickens with distance and melts into the sky),
// bloom around anything bright, a filmic curve and a colour grade, then puts
// the frame on screen. Without float render targets it falls back to drawing
// straight to the screen with the scene's own fog and tone mapping.
import * as THREE from 'three';
import { ATMOSPHERE_GLSL } from './sky.js';

const TRI = new THREE.BufferGeometry();
TRI.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// 13-tap downsample (Jimenez, "Next Generation Post Processing in Call of Duty").
// The first pass also keeps only what is brighter than the knee.
const DOWN = /* glsl */`
  uniform sampler2D tSrc;
  uniform vec2 uTexel;
  uniform float uPrefilter, uThreshold, uKnee;
  varying vec2 vUv;
  vec3 s(vec2 o) { return min(texture2D(tSrc, vUv + uTexel * o).rgb, vec3(64.0)); }
  void main() {
    vec3 c = s(vec2(0.0)) * 0.125;
    c += (s(vec2(-2.0, 2.0)) + s(vec2(2.0, 2.0)) + s(vec2(-2.0, -2.0)) + s(vec2(2.0, -2.0))) * 0.03125;
    c += (s(vec2(0.0, 2.0)) + s(vec2(-2.0, 0.0)) + s(vec2(2.0, 0.0)) + s(vec2(0.0, -2.0))) * 0.0625;
    c += (s(vec2(-1.0, 1.0)) + s(vec2(1.0, 1.0)) + s(vec2(-1.0, -1.0)) + s(vec2(1.0, -1.0))) * 0.125;
    if (uPrefilter > 0.5) {
      float br = max(c.r, max(c.g, c.b));
      float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
      soft = soft * soft / (4.0 * uKnee + 1e-4);
      c *= max(soft, br - uThreshold) / max(br, 1e-4);
    }
    gl_FragColor = vec4(c, 1.0);
  }`;

// 9-tap tent upsample, added onto the next mip up.
const UP = /* glsl */`
  uniform sampler2D tSrc;
  uniform vec2 uTexel;
  varying vec2 vUv;
  vec3 s(float x, float y) { return texture2D(tSrc, vUv + uTexel * vec2(x, y)).rgb; }
  void main() {
    vec3 c = s(0.0, 0.0) * 4.0;
    c += (s(-1.0, 0.0) + s(1.0, 0.0) + s(0.0, -1.0) + s(0.0, 1.0)) * 2.0;
    c += s(-1.0, -1.0) + s(1.0, -1.0) + s(-1.0, 1.0) + s(1.0, 1.0);
    gl_FragColor = vec4(c / 16.0, 1.0);
  }`;

const FINAL = /* glsl */`
  uniform sampler2D tColor, tDepth, tBloom, tDetail;
  uniform mat4 uProjInv, uCamWorld, uViewProj;
  uniform vec3 uCamPos;
  uniform float uBloom, uExposure, uFogDensity, uFogFalloff, uViewDist, uFogOn, uWet, uSSR;
  uniform float uSaturation, uContrast, uVignette, uGrain, uTime;
  uniform vec3 uShadowTint, uHighTint;
  uniform vec2 uResolution;
  ${ATMOSPHERE_GLSL}
  varying vec2 vUv;

  // Exponential height fog integrated along the view ray (Quilez).
  float heightFog(float camY, vec3 rd, float dist) {
    float b = uFogFalloff;
    float k = rd.y * b * dist;
    float integral = abs(k) > 1e-3 ? (1.0 - exp(-k)) / k : 1.0 - 0.5 * k;
    return 1.0 - exp(-uFogDensity * exp(-max(camY, 0.0) * b) * dist * integral);
  }

  vec3 worldAt(vec2 uv, float depth) {
    vec4 vp = uProjInv * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vp /= vp.w;
    return (uCamWorld * vec4(vp.xyz, 1.0)).xyz;
  }

  // Wet streets mirror the city: march the view ray, reflected off the ground,
  // through the depth buffer. Puddles (same pattern as the city shader) are
  // mirrors, wet asphalt a dimmer, blurrier one.
  vec3 wetReflection(vec3 col, vec3 wp, vec3 rd) {
    float ground = smoothstep(0.32, 0.22, wp.y) * step(-0.6, wp.y) * step(rd.y, -0.01);
    if (ground <= 0.0) return col;
    float macro = clamp(texture2D(tDetail, wp.xz * 0.0105).g * 0.6 + texture2D(tDetail, wp.xz * 0.047 + 0.31).g * 0.4, 0.0, 1.0);
    float puddle = smoothstep(0.5, 0.7, texture2D(tDetail, wp.xz * 0.071 + 0.57).g * 0.65 + macro * 0.35);
    float wet = min(1.0, uWet * 1.25) * mix(0.35, 1.0, puddle) * ground;
    vec3 R = normalize(vec3(rd.x, -rd.y, rd.z));
    float distCam = length(wp - uCamPos);
    float t = 0.35 + distCam * 0.01, prevT = 0.0;
    vec2 hitUV = vec2(0.0);
    float hit = 0.0;
    for (int i = 0; i < 18; i++) {
      vec3 q = wp + R * t;
      vec4 clip = uViewProj * vec4(q, 1.0);
      vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
      if (clip.w <= 0.0 || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
      float d = texture2D(tDepth, uv).x;
      if (d < 1.0) {
        float gap = length(q - uCamPos) - length(worldAt(uv, d) - uCamPos);
        if (gap > 0.02 && gap < (t - prevT) * 2.5 + 0.4) { hit = 1.0; hitUV = uv; break; }
      }
      prevT = t;
      t *= 1.32;
    }
    if (hit <= 0.0) return col;
    vec2 edge = smoothstep(0.0, 0.08, hitUV) * smoothstep(1.0, 0.92, hitUV);
    hit *= edge.x * edge.y * smoothstep(70.0, 25.0, t);
    float fres = 0.02 + 0.98 * pow(1.0 - clamp(-rd.y, 0.0, 1.0), 5.0);
    vec3 refl = texture2D(tColor, hitUV).rgb;
    // The city shader already reflects the sky here; swap that for what is really there.
    return col + (refl - atmosphere(R) * 0.6) * fres * wet * hit;
  }

  vec3 RRTAndODTFit(vec3 v) {
    vec3 a = v * (v + 0.0245786) - 0.000090537;
    vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return a / b;
  }
  vec3 aces(vec3 color) {
    const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
    const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
    color = inM * (color / 0.6);
    color = RRTAndODTFit(color);
    return clamp(outM * color, 0.0, 1.0);
  }
  float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

  void main() {
    vec3 col = texture2D(tColor, vUv).rgb;
    float depth = texture2D(tDepth, vUv).x;
    if (uFogOn > 0.5 && depth < 1.0) {
      vec3 wp = worldAt(vUv, depth);
      vec3 ray = wp - uCamPos;
      float dist = length(ray);
      vec3 rd = ray / max(dist, 1e-4);
      if (uSSR > 0.5 && uWet > 0.01) col = max(wetReflection(col, wp, rd), 0.0);
      float fog = heightFog(uCamPos.y, rd, dist);
      // Past the streamed city everything is air.
      fog = max(fog, smoothstep(uViewDist * 0.66, uViewDist * 0.97, dist));
      col = mix(col, atmosphere(rd), fog);
    }
    col += texture2D(tBloom, vUv).rgb * uBloom;
    col = aces(col * uExposure);
    // Grade: saturation, split toning (cool shadows, warm light) and contrast.
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = max(mix(vec3(l), col, uSaturation), 0.0);
    col *= mix(uShadowTint, vec3(1.0), smoothstep(0.0, 0.45, l));
    col *= mix(vec3(1.0), uHighTint, smoothstep(0.3, 1.0, l));
    vec3 p = sqrt(col);
    p = clamp((p - 0.45) * uContrast + 0.45, 0.0, 1.0);
    col = p * p;
    // Lens: darker corners and a little film grain.
    vec2 q = vUv - 0.5;
    q.x *= uResolution.x / uResolution.y;
    col *= 1.0 - uVignette * smoothstep(0.35, 1.05, length(q));
    float n = hash(vUv * uResolution + fract(uTime * 7.31) * 517.0);
    col += (n - 0.5) * uGrain * (0.5 + 0.5 * l);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
    // Dither the 8-bit output so skies and haze never band.
    gl_FragColor.rgb += (hash(gl_FragCoord.xy + 0.5) - 0.5) / 255.0;
  }`;

const pass = (fragmentShader, uniforms, extra = {}) => new THREE.ShaderMaterial({
  vertexShader: VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false, toneMapped: false, ...extra,
});

export class Post {
  constructor(renderer, sky) {
    this.renderer = renderer;
    this.sky = sky;
    const ext = renderer.extensions;
    // R11G11B10 halves the bandwidth of RGBA16F; both keep values above 1.
    this.format = ext.has('EXT_color_buffer_float') ? 'r11g11b10' : ext.has('EXT_color_buffer_half_float') ? 'half' : null;
    this.supported = Boolean(this.format);
    this.enabled = this.supported;
    this.msaa = 4;
    this.bloomOn = true;
    this.ssrOn = true;
    this.levels = 6;
    this.size = new THREE.Vector2();
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(TRI);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.black.needsUpdate = true;
    this.down = pass(DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uPrefilter: { value: 0 }, uThreshold: { value: 1.1 }, uKnee: { value: 0.6 } });
    this.up = pass(UP, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } }, { blending: THREE.AdditiveBlending, transparent: true });
    const su = sky.uniforms;
    this.final = pass(FINAL, {
      tColor: { value: null }, tDepth: { value: null }, tBloom: { value: this.black }, tDetail: { value: this.black },
      uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uViewProj: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
      uWet: { value: 0 }, uSSR: { value: 1 },
      uBloom: { value: 0.08 }, uExposure: { value: 1 }, uFogDensity: { value: 0.0013 }, uFogFalloff: { value: 0.012 }, uViewDist: { value: 540 }, uFogOn: { value: 1 },
      uSaturation: { value: 1.1 }, uContrast: { value: 1.06 }, uVignette: { value: 0.28 }, uGrain: { value: 0.012 }, uTime: { value: 0 },
      uShadowTint: { value: new THREE.Color(1, 1, 1) }, uHighTint: { value: new THREE.Color(1, 1, 1) }, uResolution: { value: new THREE.Vector2(1, 1) },
      uSunDir: su.uSunDir, uZenith: su.uZenith, uHorizon: su.uHorizon, uSunColor: su.uSunColor, uNight: su.uNight, uGrey: su.uGrey, uCityGlow: su.uCityGlow,
    });
    this.rt = null;
    this.mips = [];
  }

  /** Tier settings: { msaa, bloom, reflections }. */
  configure({ msaa, bloom, reflections = bloom }) {
    const samples = msaa ? 4 : 0;
    if (samples !== this.msaa) { this.msaa = samples; this._dispose(); }
    this.bloomOn = Boolean(bloom);
    this.ssrOn = Boolean(reflections);
  }

  /** The city's detail texture: wet reflections follow the same puddles. */
  setDetail(texture) { this.final.uniforms.tDetail.value = texture; }

  _dispose() {
    this.rt?.depthTexture?.dispose();
    this.rt?.dispose();
    this.rt = null;
    for (const m of this.mips) m.dispose();
    this.mips = [];
  }

  _targetOptions() {
    return this.format === 'r11g11b10'
      ? { format: THREE.RGBFormat, type: THREE.UnsignedInt101111Type }
      : { format: THREE.RGBAFormat, type: THREE.HalfFloatType };
  }

  /**
   * The HDR target and bloom chain at the drawing-buffer size. Each is checked with the GPU:
   * if a driver refuses the format or its multisampling, fall back to the same without MSAA,
   * then half floats, and finally to drawing straight to the screen, rather than showing black.
   */
  _ensure() {
    const r = this.renderer;
    r.getDrawingBufferSize(this.size);
    const w = Math.max(1, this.size.x), h = Math.max(1, this.size.y);
    if (this.rt && this.rt.width === w && this.rt.height === h) return;
    // EXT_color_buffer_float (behind R11G11B10) also makes half floats renderable.
    const formats = this.format === 'r11g11b10' ? ['r11g11b10', 'half'] : [this.format];
    const msaa = this.msaa;
    for (const format of formats) {
      for (const samples of msaa ? [msaa, 0] : [0]) {
        this.format = format; this.msaa = samples;
        this._create(w, h);
        if (this._complete()) return;
        this._dispose();
      }
    }
    console.warn('GTA Nanded: the GPU cannot render to an HDR target; drawing without post-processing.');
    this.enabled = this.supported = false;
    this.sky.useSceneFog(true);
  }

  _create(w, h) {
    const opts = this._targetOptions();
    this.rt = new THREE.WebGLRenderTarget(w, h, {
      ...opts, samples: this.msaa, depthBuffer: true, stencilBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
    });
    this.rt.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    let mw = w, mh = h;
    for (let i = 0; i < this.levels; i++) {
      mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1);
      this.mips.push(new THREE.WebGLRenderTarget(mw, mh, { ...opts, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false }));
    }
    this.final.uniforms.uResolution.value.set(w, h);
  }

  /** Whether the GPU can draw into the HDR target (multisampled if asked) and the bloom chain. */
  _complete() {
    const r = this.renderer, gl = r.getContext(), prev = r.getRenderTarget();
    let ok = true;
    for (const t of [this.rt, this.mips[0]]) {
      if (!t) continue;
      r.setRenderTarget(t);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { ok = false; break; }
    }
    r.setRenderTarget(prev);
    return ok;
  }

  _blit(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  _bloom(src) {
    const d = this.down.uniforms, u = this.up.uniforms;
    let input = src;
    for (let i = 0; i < this.mips.length; i++) {
      d.tSrc.value = input;
      d.uTexel.value.set(1 / input.image.width, 1 / input.image.height);
      d.uPrefilter.value = i === 0 ? 1 : 0;
      this._blit(this.down, this.mips[i]);
      input = this.mips[i].texture;
    }
    for (let i = this.mips.length - 1; i > 0; i--) {
      u.tSrc.value = this.mips[i].texture;
      u.uTexel.value.set(1 / this.mips[i].width, 1 / this.mips[i].height);
      this._blit(this.up, this.mips[i - 1]);
    }
    return this.mips[0].texture;
  }

  render(scene, camera, dt = 0) {
    const r = this.renderer;
    if (this.enabled) this._ensure();
    if (!this.enabled) { r.setRenderTarget(null); r.render(scene, camera); return; }
    r.setRenderTarget(this.rt);
    r.render(scene, camera);
    const autoClear = r.autoClear;
    r.autoClear = false;
    const look = this.sky.look;
    const bloom = this.bloomOn && look.bloom > 0 ? this._bloom(this.rt.texture) : null;
    const u = this.final.uniforms;
    u.tColor.value = this.rt.texture;
    u.tDepth.value = this.rt.depthTexture;
    u.tBloom.value = bloom || this.black;
    u.uBloom.value = bloom ? look.bloom : 0;
    u.uProjInv.value.copy(camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(camera.matrixWorld);
    u.uViewProj.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    u.uWet.value = this.sky.wet;
    u.uSSR.value = this.ssrOn ? 1 : 0;
    u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
    u.uFogDensity.value = look.fogDensity;
    u.uViewDist.value = this.sky.viewDistance;
    u.uExposure.value = look.exposure;
    u.uSaturation.value = look.saturation;
    u.uContrast.value = look.contrast;
    u.uShadowTint.value.copy(look.shadowTint);
    u.uHighTint.value.copy(look.highTint);
    u.uTime.value += dt;
    this._blit(this.final, null);
    r.autoClear = autoClear;
  }
}
