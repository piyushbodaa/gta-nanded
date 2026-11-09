// Where play begins, for the start itself and for the menu that gets it ready ahead of time.
import { HOME } from './story.js';

/** The station forecourt, Hazur Sahib Nanded, where a new story opens. */
const STATION = { key: 'station', x: 5.3 - 4, z: 10.9 + 2, heading: Math.PI * 0.75 };

/**
 * Where play begins in `mode` ('new' | 'continue' | 'free' | 'resume'): a new story on the
 * station forecourt; anything else at home, Zenda Chowk, on the kerb of the nearest road,
 * facing along it. Returns a fresh `{ key, x, z, heading }`.
 */
export function startSpot(net, mode) {
  if (mode === 'new') return { ...STATION };
  const n = net?.nearest?.(HOME.x, HOME.z, 30, {});
  return { key: 'home', x: HOME.x + (n ? n.dz * 4 : 0), z: HOME.z - (n ? n.dx * 4 : 0), heading: n ? Math.atan2(n.dx, n.dz) : 0 };
}
