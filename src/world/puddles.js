// Surface slope from raindrop impacts, in world metres. Both the sky reflection
// in the material and the reflected street in the post pass use the same normal.
export const PUDDLE_GLSL = /* glsl */`
  float dropHash(vec2 p) {
    vec3 p3 = fract(p.xyx * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  vec2 puddleSlope(vec2 world, float time, float strength, float distanceToEye) {
    if (strength < 0.01 || distanceToEye > 24.0) return vec2(0.0);
    vec2 tile = world * 1.24;
    vec2 cell = floor(tile);
    float seed = dropHash(cell);
    float life = time * mix(0.71, 1.24, seed) + seed * 8.0;
    float age = fract(life);
    vec2 event = cell + floor(life) * vec2(17.7, 31.9);
    vec2 where = 0.27 + 0.46 * vec2(dropHash(event), dropHash(event + 7.3));
    vec2 delta = fract(tile) - where;
    float radius = length(delta);
    float band = (radius - age * 0.39) * 49.0;
    float wave = sin(band) * exp(-abs(band) * 0.75);
    float fade = smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(0.28, 0.67, age));
    return delta / max(radius, 0.001) * wave * fade * strength
         * (1.0 - smoothstep(8.0, 24.0, distanceToEye)) * 0.21;
  }`;
