/** Arcade traffic that keeps left, as on Indian roads, and queues instead of driving through cars. */

/** The route point `to`, shifted `offset` to the left of travel from `from` (north-up, +x east, +z south). */
export function laneOffsetPoint(from, to, offset) {
  const dx = to.x - from.x, dz = to.z - from.z, length = Math.hypot(dx, dz);
  if (!length) return { x: to.x, z: to.z };
  return { x: to.x + dz / length * offset, z: to.z - dx / length * offset };
}

/** Distance to the nearest body ahead of this car within its lane, or Infinity. */
export function gapAhead(car, others, range = 32, laneHalfWidth = 2.2) {
  const fx = -Math.sin(car.heading), fz = -Math.cos(car.heading);
  let gap = Infinity;
  for (const other of others) {
    if (other === car) continue;
    const rx = other.x - car.x, rz = other.z - car.z, ahead = rx * fx + rz * fz;
    if (ahead <= 0 || ahead >= range || ahead >= gap) continue;
    if (Math.abs(rx * fz - rz * fx) < laneHalfWidth) gap = ahead;
  }
  return gap;
}

/** The speed a traffic car aims for: its cruise, eased into junctions and held behind the queue ahead. */
export function trafficTargetSpeed(cruise, { gap = Infinity, junctionDistance = Infinity } = {}) {
  let target = cruise;
  if (junctionDistance < 16) target = Math.min(target, cruise * (0.45 + 0.55 * junctionDistance / 16));
  if (gap < Infinity) target = Math.min(target, Math.max(0, (gap - 7) * 0.9));
  return target;
}
