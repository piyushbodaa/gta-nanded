import { blocked } from './mechanics.js';

const CAMERA_RADIUS = 0.45;
const VERTICAL_PADDING = 0.3;
const MIN_HEIGHT = 1;
const SAMPLE_STEP = 0.5;
const SURFACE_GAP = 0.15;
const UNBOUNDED = { minX: -Infinity, maxX: Infinity, minZ: -Infinity, maxZ: Infinity };

/**
 * Shorten the camera boom before the first wall/roof between the actor and the
 * camera. Endpoint-only checks can put a clear camera behind an entire building.
 * Heights are measured above the ground, as in the world's collider data: h is
 * the top, and optional minY is the bottom of elevated signs or other geometry.
 *
 * Call for the desired position, and again after smoothing its position: the
 * interpolation chord can cross a wall while both orbit endpoints are clear.
 */
export function resolveCameraPosition(focus, desired, colliders = [], bounds = UNBOUNDED) {
  const origin = { x: focus.x, y: Math.max(MIN_HEIGHT, focus.y), z: focus.z };
  const target = { x: desired.x, y: Math.max(MIN_HEIGHT, desired.y), z: desired.z };
  const dx = target.x - origin.x, dy = target.y - origin.y, dz = target.z - origin.z;
  const length = Math.hypot(dx, dy, dz);
  if (length < 0.000001) return target;
  // One broad spatial query covers the entire segment, avoiding a city-wide
  // collider scan (and repeated index allocation) at each half-unit sample.
  const candidates = colliders.query?.(
    (origin.x + target.x) / 2,
    (origin.z + target.z) / 2,
    Math.hypot(dx, dz) / 2 + CAMERA_RADIUS,
  ) || colliders;
  const pointAt = t => ({ x: origin.x + dx * t, y: origin.y + dy * t, z: origin.z + dz * t });
  const obstructed = point => blocked(point.x, point.z, CAMERA_RADIUS,
    candidates.filter(box =>
      point.y >= (Number.isFinite(box.minY) ? box.minY : 0) - VERTICAL_PADDING &&
      point.y <= (Number.isFinite(box.h) ? box.h : 20) + VERTICAL_PADDING), bounds);
  // There is no valid outward ray if its origin is already inside geometry.
  // Staying at the actor is safer than jumping to the other side of the wall.
  if (obstructed(origin)) return origin;
  const samples = Math.ceil(length / SAMPLE_STEP);
  let lastClear = 0;
  for (let sample = 1; sample <= samples; sample++) {
    const t = sample / samples;
    if (!obstructed(pointAt(t))) { lastClear = t; continue; }
    let near = lastClear, far = t;
    // Refine the contact to avoid half-unit camera jumps as a wall approaches.
    for (let i = 0; i < 7; i++) {
      const middle = (near + far) / 2;
      if (obstructed(pointAt(middle))) far = middle;
      else near = middle;
    }
    return pointAt(Math.max(0, near - SURFACE_GAP / length));
  }
  return target;
}
