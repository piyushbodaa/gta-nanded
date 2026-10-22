// Sky dome, sun, moon, ambient light and fog through a Marathwada day:
// hazy white noon, long golden evenings, sodium-orange nights, monsoon grey.
import * as THREE from 'three';
import { clamp, smoothstep, lerp } from '../core/math.js';

const C = (r, g, b) => new THREE.Color(r, g, b);

// Image-based light: reflections of the sky at full strength, but its diffuse
// light scaled down so direct sun keeps a realistic contrast with the shade.
THREE.ShaderChunk.envmap_physical_pars_fragment = THREE.ShaderChunk.envmap_physical_pars_fragment.replace(
  'return PI * envMapColor.rgb * envMapIntensity;',
  'return PI * envMapColor.rgb * envMapIntensity * 0.42;',
);

// The colour of the air in a direction: shared by the sky dome and the haze in
// post-processing, so distant streets melt into exactly the sky behind them.
export const ATMOSPHERE_GLSL = /* glsl */`
  uniform vec3 uSunDir, uZenith, uHorizon, uSunColor;
  uniform float uNight, uGrey, uCityGlow;
  vec3 atmosphere(vec3 rd) {
    float up = clamp(rd.y, 0.0, 1.0);
    vec3 col = mix(uHorizon, uZenith, pow(up, 0.45));
    float sd = max(dot(rd, uSunDir), 0.0);
    // Dust in the air scatters sunlight forward: a wide warm glow around the sun.
    col += uSunColor * (pow(sd, 60.0) * 0.35 + pow(sd, 8.0) * 0.16 + pow(sd, 2.0) * 0.05) * (1.0 - uGrey * 0.8) * smoothstep(-0.25, 0.05, uSunDir.y);
    // Sodium glow of the city low on the night horizon.
    col += vec3(0.32, 0.17, 0.08) * uCityGlow * exp(-up * 9.0);
    return mix(col, vec3(dot(col, vec3(0.3, 0.5, 0.2))) * 0.85, uGrey * 0.6);
  }
`;
// Keyframes by sun elevation (degrees): sky zenith, horizon, sun light, ambient sky/ground, fog.
// Each key also carries the camera "look" at that hour: exposure, saturation,
// contrast, split-tone tints for shadows and light, and bloom strength.
const KEYS = [
  { el: -18, zen: C(0.015, 0.025, 0.06), hor: C(0.08, 0.07, 0.1), sun: C(0.45, 0.55, 0.9), sunI: 0.16, sky: C(0.16, 0.2, 0.34), gnd: C(0.1, 0.08, 0.07), ambI: 0.75, fog: C(0.09, 0.085, 0.11),
    exp: 1.05, sat: 0.95, con: 1.06, sh: C(0.86, 0.93, 1.12), hi: C(1.12, 0.98, 0.84), bloom: 0.16 },
  { el: -6, zen: C(0.06, 0.08, 0.2), hor: C(0.42, 0.3, 0.36), sun: C(0.6, 0.5, 0.7), sunI: 0.2, sky: C(0.28, 0.3, 0.46), gnd: C(0.2, 0.15, 0.13), ambI: 0.8, fog: C(0.36, 0.28, 0.32),
    exp: 1.05, sat: 1.05, con: 1.05, sh: C(0.9, 0.94, 1.08), hi: C(1.1, 0.97, 0.86), bloom: 0.13 },
  { el: 2, zen: C(0.2, 0.3, 0.56), hor: C(0.98, 0.6, 0.36), sun: C(1.0, 0.5, 0.24), sunI: 2.4, sky: C(0.55, 0.52, 0.62), gnd: C(0.4, 0.28, 0.2), ambI: 0.9, fog: C(0.86, 0.6, 0.45),
    exp: 0.88, sat: 1.15, con: 1.07, sh: C(0.92, 0.96, 1.06), hi: C(1.09, 0.98, 0.87), bloom: 0.1 },
  { el: 14, zen: C(0.26, 0.45, 0.78), hor: C(0.98, 0.8, 0.6), sun: C(1.0, 0.72, 0.45), sunI: 3.6, sky: C(0.62, 0.7, 0.86), gnd: C(0.52, 0.42, 0.32), ambI: 1.0, fog: C(0.9, 0.8, 0.68),
    exp: 0.78, sat: 1.14, con: 1.07, sh: C(0.94, 0.98, 1.05), hi: C(1.06, 1.0, 0.92), bloom: 0.08 },
  { el: 35, zen: C(0.24, 0.5, 0.86), hor: C(0.84, 0.86, 0.86), sun: C(1.0, 0.92, 0.8), sunI: 4.4, sky: C(0.66, 0.78, 0.95), gnd: C(0.56, 0.48, 0.38), ambI: 1.05, fog: C(0.84, 0.84, 0.82),
    exp: 0.72, sat: 1.1, con: 1.06, sh: C(0.95, 0.99, 1.04), hi: C(1.03, 1.01, 0.96), bloom: 0.06 },
  { el: 90, zen: C(0.22, 0.48, 0.88), hor: C(0.8, 0.85, 0.88), sun: C(1.0, 0.96, 0.88), sunI: 4.6, sky: C(0.66, 0.8, 0.98), gnd: C(0.56, 0.5, 0.4), ambI: 1.05, fog: C(0.82, 0.84, 0.84),
    exp: 0.72, sat: 1.1, con: 1.06, sh: C(0.95, 0.99, 1.04), hi: C(1.03, 1.01, 0.96), bloom: 0.06 },
];
// fogNear/fogFar drive the fallback linear fog; fogDensity the haze in post-processing.
const WEATHER = {
  clear: { fogNear: 0.32, fogFar: 1.0, grey: 0, clouds: 0.32, light: 1, fogDensity: 0.0013 },
  haze: { fogNear: 0.12, fogFar: 0.72, grey: 0.25, clouds: 0.15, light: 0.92, fogDensity: 0.0046 },
  rain: { fogNear: 0.05, fogFar: 0.5, grey: 0.8, clouds: 0.95, light: 0.5, fogDensity: 0.0085 },
};

export class Sky {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.hours = 17.2; // a game begins in the golden hour
    this.timeScale = 1 / 60; // one real second = one game minute
    this.frozen = false;
    this.weather = 'clear';
    this.w = { ...WEATHER.clear };
    this.viewDistance = 600;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.night = 0;
    this.wet = 0; // streets soak in a few seconds of rain and take a minute to dry
    this.hemiDay = 0.12;
    this.hemiNight = 0.32;
    this.envIntensity = 1;

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -95; sc.right = 95; sc.top = 95; sc.bottom = -95; sc.near = 1; sc.far = 400;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.0;
    this.sun.target = new THREE.Object3D();
    scene.add(this.sun, this.sun.target);
    // The shadow map's footprint as the sun sees it (see inShadowBox); everything casts until placed.
    this.shadowBox = { half: Infinity, cx: 0, cz: 0, xx: 1, xz: 0, yx: 0, yy: 1, yz: 0 };
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x886644, 1);
    scene.add(this.hemi);
    // Linear fog is only used when post-processing is unavailable (see useSceneFog).
    this.fog = new THREE.Fog(0xcccccc, 150, 600);
    scene.fog = this.fog;
    this.look = { exposure: 1, saturation: 1.1, contrast: 1.06, shadowTint: new THREE.Color(1, 1, 1), highTint: new THREE.Color(1, 1, 1), bloom: 0.08, fogDensity: 0.0013 };

    this.uniforms = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color() },
      uNight: { value: 0 },
      uTime: { value: 0 },
      uCloud: { value: 0.3 },
      uGrey: { value: 0 },
      uCityGlow: { value: 0 },
      uSunDisk: { value: 1 },
    };
    const geo = new THREE.SphereGeometry(1, 32, 16);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      // Drawn after the city with the depth test on, so only open sky is shaded.
      depthTest: true,
      fog: false,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */`
        uniform float uTime, uCloud, uSunDisk;
        ${ATMOSPHERE_GLSL}
        varying vec3 vDir;
        float h21(vec2 p) { p = fract(p * vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x * p.y); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
        }
        float fbm(vec2 p) {
          float v = 0.0, a = 0.5;
          for (int i = 0; i < 4; i++) { v += a * noise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p; a *= 0.5; }
          return v;
        }
        float fbm2(vec2 p) { return noise(p) * 0.65 + noise(mat2(1.6, 1.2, -1.2, 1.6) * p) * 0.35; }
        void main() {
          vec3 d = normalize(vDir);
          float up = clamp(d.y, 0.0, 1.0);
          vec3 col = atmosphere(d);
          // Below the horizon: a soft continuation so the haze line never shows a seam.
          if (d.y < 0.0) col *= mix(1.0, 0.7, clamp(-d.y * 4.0, 0.0, 1.0));
          float sd = max(dot(d, uSunDir), 0.0);
          float disk = smoothstep(0.9993, 0.9997, sd);
          col += uSunColor * (pow(sd, 900.0) * 1.5 + disk * 22.0 * (1.0 - uGrey)) * (1.0 - uGrey * 0.8) * uSunDisk;
          // Moon opposite the sun.
          float md = max(dot(d, -uSunDir), 0.0);
          col += vec3(0.85, 0.9, 1.0) * smoothstep(0.99955, 0.9998, md) * uNight * 2.5;
          col += vec3(0.4, 0.5, 0.7) * pow(md, 40.0) * 0.12 * uNight;
          // Stars.
          if (uNight > 0.01 && d.y > 0.02) {
            vec2 sp = d.xz / (d.y + 0.3) * 160.0;
            float s = h21(floor(sp));
            float star = step(0.9965, s) * smoothstep(0.5, 0.0, length(fract(sp) - 0.5));
            col += vec3(star) * uNight * (0.6 + 0.4 * sin(uTime * 3.0 + s * 50.0)) * (1.0 - uGrey) * 1.5;
          }
          // Cumulus on a plane above the city, lit from the sun's side, darker underneath.
          if (d.y > 0.0) {
            vec2 cp = d.xz / (d.y + 0.1) * 1.25 + vec2(uTime * 0.01, uTime * 0.0035);
            vec2 warp = vec2(fbm2(cp * 0.7 + 3.1), fbm2(cp * 0.7 - 1.7));
            float n = fbm(cp + warp * 0.6);
            float cover = smoothstep(1.0 - uCloud, 1.0 - uCloud * 0.45 + 0.08, n);
            float toward = fbm(cp + warp * 0.6 + uSunDir.xz * 0.18);
            float lit = clamp(0.62 + (n - toward) * 3.2, 0.25, 1.15);
            vec3 base = mix(uHorizon, uZenith, 0.35) * 0.82;
            vec3 cloudCol = mix(base, vec3(1.0) * mix(vec3(1.0), uSunColor, 0.45) * 1.25, lit) * mix(1.0, 0.6, uGrey);
            cloudCol += uSunColor * pow(sd, 6.0) * 0.6 * (1.0 - cover) * (1.0 - uGrey);
            cloudCol = mix(cloudCol, vec3(0.12, 0.12, 0.17) + vec3(0.32, 0.17, 0.08) * uCityGlow * 0.4, uNight * 0.9);
            float a = cover * smoothstep(0.0, 0.14, d.y) * 0.92;
            col = mix(col, cloudCol, a);
          }
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.dome = new THREE.Mesh(geo, mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = 1000;
    scene.add(this.dome);
    this._k = { zen: new THREE.Color(), hor: new THREE.Color(), sun: new THREE.Color(), sky: new THREE.Color(), gnd: new THREE.Color(), fog: new THREE.Color() };
    this._initEnv(geo, mat);
    this.update(0, new THREE.Vector3());
  }

  /**
   * Image-based light: the sky (without the sun disk, which the sun light already
   * covers) over a sunlit dusty ground, captured into a small cube map. Every
   * standard material takes its ambient light and reflections from it.
   */
  _initEnv(geo, domeMat) {
    const envScene = new THREE.Scene();
    const mat = domeMat.clone();
    mat.uniforms = { ...this.uniforms, uSunDisk: { value: 0 } };
    mat.depthTest = false;
    const dome = new THREE.Mesh(geo, mat);
    dome.scale.setScalar(50); dome.renderOrder = -10; dome.frustumCulled = false;
    this.groundColor = new THREE.Color();
    const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: this.groundColor, depthTest: false, depthWrite: false, fog: false }));
    ground.position.y = -6; ground.frustumCulled = false;
    envScene.add(dome, ground);
    const rt = new THREE.WebGLCubeRenderTarget(64, { type: THREE.HalfFloatType, generateMipmaps: false });
    this.env = { scene: envScene, rt, camera: new THREE.CubeCamera(0.5, 200, rt), ground, t: Infinity };
    this.scene.environment = rt.texture;
  }

  /** Re-capture the sky light every couple of seconds (it changes slowly), or at once after a jump. */
  _updateEnv(dt) {
    const e = this.env;
    e.t += dt;
    const jump = Math.abs(this.hours - (e.hours ?? -99)) > 0.2 || e.weather !== this.weather;
    if (e.t < 1.5 && !jump) return;
    e.t = 0; e.hours = this.hours; e.weather = this.weather;
    e.ground.material.color.copy(this.groundColor);
    e.camera.update(this.renderer, e.scene);
    e.rt.texture.needsPMREMUpdate = true;
  }

  /** Post-processing draws the haze itself; the scene's linear fog is the fallback. */
  useSceneFog(on) { this.scene.fog = on ? this.fog : null; }

  setWeather(name) {
    this.weather = name;
    this.targetW = WEATHER[name] || WEATHER.clear;
  }
  cycleWeather() {
    const order = ['clear', 'haze', 'rain'];
    this.setWeather(order[(order.indexOf(this.weather) + 1) % order.length]);
    return this.weather;
  }
  setViewDistance(d) { this.viewDistance = d; }

  get elevationDeg() { return Math.asin(clamp(this.sunDir.y, -1, 1)) * 180 / Math.PI; }

  update(dt, focus) {
    if (!this.frozen) {
      // Nights pass twice as fast: the city is at its best in daylight and dusk.
      const nightish = this.hours < 5.5 || this.hours > 20;
      this.hours = (this.hours + dt * this.timeScale * (nightish ? 2 : 1)) % 24;
    }
    // Ease weather.
    const tw = this.targetW || WEATHER[this.weather];
    const k = 1 - Math.exp(-dt * 0.5);
    for (const key of ['fogNear', 'fogFar', 'grey', 'clouds', 'light', 'fogDensity']) this.w[key] = lerp(this.w[key], tw[key], dt ? k : 1);
    const wetTarget = this.weather === 'rain' ? 1 : 0;
    this.wet = dt ? clamp(this.wet + (wetTarget > this.wet ? dt / 6 : -dt / 70), 0, 1) : wetTarget;

    // Sun path: rises east (+x), sets west (-x), arcs a little south (+z).
    const theta = ((this.hours - 6) / 12) * Math.PI;
    const el = Math.sin(theta) * 1.18;
    this.sunDir.set(Math.cos(theta), Math.sin(theta) * 0.92, 0.38).normalize();
    if (el < 0) this.sunDir.y = Math.sin(theta) * 0.92;
    this.sunDir.normalize();
    const elDeg = Math.asin(this.sunDir.y) * 180 / Math.PI;
    // Interpolate keyframes.
    let a = KEYS[0], b = KEYS[KEYS.length - 1];
    for (let i = 0; i < KEYS.length - 1; i++) if (elDeg >= KEYS[i].el && elDeg <= KEYS[i + 1].el) { a = KEYS[i]; b = KEYS[i + 1]; break; }
    if (elDeg < KEYS[0].el) b = a;
    const t = a === b ? 0 : (elDeg - a.el) / (b.el - a.el);
    const K = this._k;
    K.zen.copy(a.zen).lerp(b.zen, t); K.hor.copy(a.hor).lerp(b.hor, t); K.sun.copy(a.sun).lerp(b.sun, t);
    K.sky.copy(a.sky).lerp(b.sky, t); K.gnd.copy(a.gnd).lerp(b.gnd, t); K.fog.copy(a.fog).lerp(b.fog, t);
    const sunI = lerp(a.sunI, b.sunI, t), ambI = lerp(a.ambI, b.ambI, t);
    const L = this.look;
    L.exposure = lerp(a.exp, b.exp, t); L.saturation = lerp(a.sat, b.sat, t); L.contrast = lerp(a.con, b.con, t);
    L.bloom = lerp(a.bloom, b.bloom, t);
    L.shadowTint.copy(a.sh).lerp(b.sh, t); L.highTint.copy(a.hi).lerp(b.hi, t);
    this.night = smoothstep(4, -7, elDeg);
    // Weather greys everything toward overcast.
    const grey = this.w.grey;
    const overcast = new THREE.Color(0.55, 0.58, 0.62).multiplyScalar(1 - this.night * 0.85);
    K.hor.lerp(overcast, grey * 0.8); K.zen.lerp(overcast.clone().multiplyScalar(0.8), grey * 0.8); K.fog.lerp(overcast, grey * 0.85);
    // Overcast flattens the picture: less colour, less contrast, cooler light.
    L.saturation *= 1 - grey * 0.22; L.contrast = lerp(L.contrast, 0.99, grey);
    L.shadowTint.lerp(this._cool || (this._cool = new THREE.Color(0.95, 0.98, 1.04)), grey);
    L.highTint.lerp(this._neutral || (this._neutral = new THREE.Color(0.98, 1.0, 1.02)), grey);
    L.fogDensity = this.w.fogDensity;

    const u = this.uniforms;
    u.uSunDir.value.copy(this.sunDir.y > -0.05 ? this.sunDir : this.sunDir);
    u.uZenith.value.copy(K.zen); u.uHorizon.value.copy(K.hor); u.uSunColor.value.copy(K.sun);
    u.uNight.value = this.night; u.uTime.value += dt; u.uCloud.value = this.w.clouds; u.uGrey.value = grey;
    u.uCityGlow.value = this.night;

    // The light comes from the sun by day and the moon by night.
    const lightDir = this.sunDir.y > -0.02 ? this.sunDir : this._moon || (this._moon = new THREE.Vector3());
    if (this.sunDir.y <= -0.02) this._moon.copy(this.sunDir).negate().setY(Math.abs(this.sunDir.y) + 0.35).normalize();
    this.sun.color.copy(K.sun);
    this.sun.intensity = sunI * this.w.light;
    this.hemi.color.copy(K.sky);
    this.hemi.groundColor.copy(K.gnd);
    // Daylight ambient comes from the sky cube map; the hemisphere fills in moonlight.
    this.hemi.intensity = ambI * lerp(this.hemiDay, this.hemiNight, this.night) * (1 + grey * 0.25);
    const sunUp = Math.max(this.sunDir.y, 0);
    this.groundColor.copy(K.gnd).multiplyScalar((sunI * this.w.light * sunUp * 0.11 + 0.05 + ambI * 0.04) * (1 - this.night * 0.85));
    this.scene.environmentIntensity = this.envIntensity;
    if (this.renderer && this.env) this._updateEnv(dt || 0);
    this.fog.color.copy(K.fog);
    const vd = this.viewDistance;
    this.fog.near = vd * this.w.fogNear;
    this.fog.far = vd * this.w.fogFar;

    if (focus) {
      // Shadow frustum follows the focus on a coarse grid so static shadows don't swim.
      const snap = 4;
      const fx = Math.round(focus.x / snap) * snap, fz = Math.round(focus.z / snap) * snap;
      this.sun.position.set(fx + lightDir.x * 200, lightDir.y * 200, fz + lightDir.z * 200);
      this.sun.target.position.set(fx, 0, fz);
      this.sun.target.updateMatrixWorld();
      // The sun camera's right and up axes, so actors outside its view can skip the shadow pass.
      const b = this.shadowBox, L = Math.hypot(lightDir.x, lightDir.z) || 1e-6;
      b.half = this.sun.shadow.camera.right; b.cx = fx; b.cz = fz;
      b.xx = lightDir.z / L; b.xz = -lightDir.x / L;
      b.yx = -lightDir.y * lightDir.x / L; b.yy = L; b.yz = -lightDir.y * lightDir.z / L;
      this.dome.position.copy(focus.camera || focus);
    }
  }

  placeDome(camera) {
    this.dome.position.copy(camera.position);
    this.dome.scale.setScalar(camera.far * 0.95);
  }

  clockText() {
    const h = Math.floor(this.hours), m = Math.floor((this.hours - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
