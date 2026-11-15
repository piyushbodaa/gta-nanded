// The kit play starts with: every gun, loaded, and a car of your own at the kerb beside you.
// No three.js or DOM here, so the node tests can run it on a fake game.
import { VEHICLE_TYPES } from '../actors/vehicle-types.js';
import { dist } from '../core/math.js';

export const STARTER_CAR = 'suv'; // claimable at Society Parking, so it can become one of yours
export const STARTER_COLOR = 0xc62828;
// Metres along the player's facing to look for a kerb: behind first, since c1's auto parks ahead at the station.
const ALONG = [-9, 9, -15, 15, -22, 22, 0];
const NEAR = 30; // further than this from the player is not "beside" them

/** Every weapon, every magazine full, every calibre (frags and .300 Magnum too) to what can be carried. */
export function giveStartKit(weapons) { weapons?.giveAll?.(); }

/** A kerb spot near (x, z) for a `type`, clear of walls, other vehicles and the player: { x, z, heading } or null. */
export function starterSpot(g, x, z, heading = 0, type = STARTER_CAR) {
  const net = g.net, { L, W } = VEHICLE_TYPES[type], half = L / 2;
  // A ground-level street or lane, not a flyover deck or a bridge.
  const ok = r => !net.raised?.[r] && !net.bridge?.[r];
  for (const along of ALONG) {
    const n = net.nearest(x + Math.sin(heading) * along, z + Math.cos(heading) * along, NEAR, {}, ok);
    if (!n) continue;
    // Out of the junction mouths, where turning traffic would hit it (Parked keeps out too): slid along the street clear of them.
    const r = n.road, w = net.width[r], s0 = net.trimStart(r) + 4, s1 = net.length[r] - net.trimEnd(r) - 4;
    if (s0 > s1) continue; // a stub that is all junction
    if (n.s < s0 || n.s > s1) net.pointAt(r, Math.min(Math.max(n.s, s0), s1), n);
    // The kerb people use (never a divided road's median), facing the way traffic goes on that side:
    // 1.2 m in on a street, tucked against the edge of a 4.8 m lane the way the locals park.
    const side = net.kerbSide?.(r) || 1, off = w >= 6 ? w / 2 - 1.2 : w / 2 - W / 2 - 0.15, flow = net.oneway?.[r] || side;
    const cx = n.x + n.dz * off * side, cz = n.z - n.dx * off * side;
    const d = dist(cx, cz, x, z);
    if (d < half + 1.5 || d > NEAR) continue;
    // Clear of walls nose, middle and tail.
    const ex = n.dx * (half - 0.9), ez = n.dz * (half - 0.9), wall = (px, pz) => g.colliders?.blocked?.(px, pz, 0.9);
    if (wall(cx, cz) || wall(cx + ex, cz + ez) || wall(cx - ex, cz - ez)) continue;
    if (g.vehicles.list.some(v => !v.removed && dist(v.x, v.z, cx, cz) < (v.hd ?? 2.5) + half + 0.5)) continue;
    return { x: cx, z: cz, heading: Math.atan2(n.dx, n.dz) + (flow > 0 ? 0 : Math.PI) };
  }
  return null;
}

/** Park the starter car beside the player (not when they already sit in one). `keep`: never despawned or towed. */
export function spawnStarterCar(g, type = STARTER_CAR) {
  const P = g.player;
  if (!P || P.vehicle || !g.vehicles?.spawn || !g.net) return null;
  const at = starterSpot(g, P.x, P.z, P.heading ?? 0, type);
  if (!at) return null;
  const v = g.vehicles.spawn(type, at.x, at.z, at.heading, { role: 'parked', driver: false, color: STARTER_COLOR });
  v.kinematic = true; v.keep = true; v.starter = true;
  g.starterCar = v;
  return v;
}

/** The radar blip for the starter car while the player isn't in it (and it isn't wrecked, gone, or garaged). */
export function starterBlip(g, b) {
  const v = g.starterCar;
  if (!v || v.removed || v.wrecked || v.owned || v === g.player?.vehicle) return null;
  b.x = v.x; b.z = v.z;
  return b;
}
