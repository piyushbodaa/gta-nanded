/**
 * Rotate an upward-pointing Canvas marker to match a Three.js world heading.
 * World forward is (-sin(heading), -cos(heading)) in (x, z). The north-up map
 * projects x to screen x and z to screen y, so Canvas needs the opposite sign.
 * Use the facing heading, including while reversing, rather than travel bearing.
 */
export function mapHeading(heading) {
  return -heading;
}

/** CSS rotation for an upward arrow toward a destination, relative to the view. */
export function destinationBearing(position, target, viewHeading) {
  const dx = target.x - position.x, dz = target.z - position.z;
  if (dx === 0 && dz === 0) return 0; // No bearing at the destination itself.
  const targetHeading = Math.atan2(-dx, -dz);
  const relativeHeading = viewHeading - targetHeading;
  return Math.atan2(Math.sin(relativeHeading), Math.cos(relativeHeading));
}
