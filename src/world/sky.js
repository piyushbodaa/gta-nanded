// Sky dome, sun, moon, ambient light and fog through a Marathwada day:
// hazy white noon, long golden evenings, sodium-orange nights, monsoon grey.
import * as THREE from 'three';
import { clamp, smoothstep, lerp } from '../core/math.js';

const C = (r, g, b) => new THREE.Color(r, g, b);
// Keyframes by sun elevation (degrees): sky zenith, horizon, sun light, ambient sky/ground, fog.
const KEYS = [
  { el: -18, zen: C(0.02, 0.03, 0.07), hor: C(0.09, 0.08, 0.12), sun: C(0.45, 0.55, 0.9), sunI: 0.28, sky: C(0.16, 0.2, 0.34), gnd: C(0.1, 0.08, 0.07), ambI: 0.75, fog: C(0.09, 0.085, 0.11) },
  { el: -6, zen: C(0.06, 0.08, 0.2), hor: C(0.42, 0.3, 0.36), sun: C(0.6, 0.5, 0.7), sunI: 0.2, sky: C(0.28, 0.3, 0.46), gnd: C(0.2, 0.15, 0.13), ambI: 0.8, fog: C(0.36, 0.28, 0.32) },
  { el: 2, zen: C(0.2, 0.3, 0.56), hor: C(0.98, 0.6, 0.36), sun: C(1.0, 0.5, 0.24), sunI: 1.6, sky: C(0.55, 0.52, 0.62), gnd: C(0.4, 0.28, 0.2), ambI: 0.9, fog: C(0.86, 0.6, 0.45) },
  { el: 14, zen: C(0.26, 0.45, 0.78), hor: C(0.98, 0.8, 0.6), sun: C(1.0, 0.72, 0.45), sunI: 2.5, sky: C(0.62, 0.7, 0.86), gnd: C(0.52, 0.42, 0.32), ambI: 1.0, fog: C(0.9, 0.8, 0.68) },
  { el: 35, zen: C(0.24, 0.5, 0.86), hor: C(0.84, 0.86, 0.86), sun: C(1.0, 0.92, 0.8), sunI: 3.0, sky: C(0.66, 0.78, 0.95), gnd: C(0.56, 0.48, 0.38), ambI: 1.05, fog: C(0.84, 0.84, 0.82) },
  { el: 90, zen: C(0.22, 0.48, 0.88), hor: C(0.8, 0.85, 0.88), sun: C(1.0, 0.96, 0.88), sunI: 3.1, sky: C(0.66, 0.8, 0.98), gnd: C(0.56, 0.5, 0.4), ambI: 1.05, fog: C(0.82, 0.84, 0.84) },
];
const WEATHER = {
  clear: { fogNear: 0.32, fogFar: 1.0, grey: 0, clouds: 0.32, light: 1 },
  haze: { fogNear: 0.12, fogFar: 0.72, grey: 0.25, clouds: 0.15, light: 0.92 },
  rain: { fogNear: 0.05, fogFar: 0.5, grey: 0.8, clouds: 0.95, light: 0.5 },
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

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -95; sc.right = 95; sc.top = 95; sc.bottom = -95; sc.near = 1; sc.far = 400;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.0;
    this.sun.target = new THREE.Object3D();
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x886644, 1);
    scene.add(this.hemi);
    scene.fog = new THREE.Fog(0xcccccc, 150, 600);

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
    };
    const geo = new THREE.SphereGeometry(1, 32, 16);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uSunDir, uZenith, uHorizon, uSunColor;
        uniform float uNight, uTime, uCloud, uGrey, uCityGlow;
        varying vec3 vDir;
        float h21(vec2 p) { p = fract(p * vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x * p.y); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
        }
        float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
        void main() {
          vec3 d = normalize(vDir);
          float up = clamp(d.y, 0.0, 1.0);
          vec3 col = mix(uHorizon, uZenith, pow(up, 0.45));
          // Below the horizon: a soft continuation so the fog line never shows a seam.
          if (d.y < 0.0) col = mix(uHorizon, uHorizon * 0.7, clamp(-d.y * 4.0, 0.0, 1.0));
          // Sodium glow of the city low on the night horizon.
          col += vec3(0.32, 0.17, 0.08) * uCityGlow * exp(-up * 9.0);
          float sd = max(dot(d, uSunDir), 0.0);
          float disk = smoothstep(0.9993, 0.9997, sd);
          col += uSunColor * (pow(sd, 900.0) * 1.5 + pow(sd, 60.0) * 0.35 + pow(sd, 8.0) * 0.12) * (1.0 - uGrey * 0.8);
          col += uSunColor * disk * 6.0 * (1.0 - uGrey);
          // Moon opposite the sun.
          float md = max(dot(d, -uSunDir), 0.0);
          col += vec3(0.85, 0.9, 1.0) * smoothstep(0.99955, 0.9998, md) * uNight * 1.4;
          col += vec3(0.4, 0.5, 0.7) * pow(md, 40.0) * 0.12 * uNight;
          // Stars.
          if (uNight > 0.01 && d.y > 0.02) {
            vec2 sp = d.xz / (d.y + 0.3) * 160.0;
            float s = h21(floor(sp));
            float star = step(0.9965, s) * smoothstep(0.5, 0.0, length(fract(sp) - 0.5));
            col += vec3(star) * uNight * (0.6 + 0.4 * sin(uTime * 3.0 + s * 50.0)) * (1.0 - uGrey);
          }
          // Clouds on a plane above the city.
          if (d.y > 0.0) {
            vec2 cp = d.xz / (d.y + 0.12) * 1.6 + vec2(uTime * 0.012, uTime * 0.004);
            float n = fbm(cp);
            float cover = smoothstep(1.0 - uCloud, 1.05 - uCloud * 0.5, n);
            vec3 cloudCol = mix(vec3(1.0), uSunColor, 0.35) * mix(1.0, 0.55, uGrey);
            cloudCol = mix(cloudCol, vec3(0.13, 0.13, 0.18), uNight * 0.9);
            col = mix(col, cloudCol * (0.75 + 0.35 * up), cover * smoothstep(0.0, 0.12, d.y) * 0.9);
          }
          col = mix(col, vec3(dot(col, vec3(0.3, 0.5, 0.2))) * 0.85, uGrey * 0.6);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.dome = new THREE.Mesh(geo, mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    scene.add(this.dome);
    this._k = { zen: new THREE.Color(), hor: new THREE.Color(), sun: new THREE.Color(), sky: new THREE.Color(), gnd: new THREE.Color(), fog: new THREE.Color() };
    this.update(0, new THREE.Vector3());
  }

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
    for (const key of ['fogNear', 'fogFar', 'grey', 'clouds', 'light']) this.w[key] = lerp(this.w[key], tw[key], dt ? k : 1);

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
    this.night = smoothstep(4, -7, elDeg);
    // Weather greys everything toward overcast.
    const grey = this.w.grey;
    const overcast = new THREE.Color(0.55, 0.58, 0.62).multiplyScalar(1 - this.night * 0.85);
    K.hor.lerp(overcast, grey * 0.8); K.zen.lerp(overcast.clone().multiplyScalar(0.8), grey * 0.8); K.fog.lerp(overcast, grey * 0.85);

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
    this.hemi.intensity = ambI * (1 + grey * 0.25);
    this.scene.fog.color.copy(K.fog);
    const vd = this.viewDistance;
    this.scene.fog.near = vd * this.w.fogNear;
    this.scene.fog.far = vd * this.w.fogFar;

    if (focus) {
      // Shadow frustum follows the focus on a coarse grid so static shadows don't swim.
      const snap = 4;
      const fx = Math.round(focus.x / snap) * snap, fz = Math.round(focus.z / snap) * snap;
      this.sun.position.set(fx + lightDir.x * 200, lightDir.y * 200, fz + lightDir.z * 200);
      this.sun.target.position.set(fx, 0, fz);
      this.sun.target.updateMatrixWorld();
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
