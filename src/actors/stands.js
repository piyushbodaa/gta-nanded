// Vehicles waiting where they wait in Nanded: Lal Pari buses at the bus stand's bays,
// autos at the station forecourt, taxis at the airport. Each stand fills when you come
// near and empties when you leave; whatever you drive off with is yours.
import { busBays, placeRot } from '../world/landmarks.js';

const NEAR = 230, FAR = 320;

export class Stands {
  constructor(game) {
    this.game = game;
    this.stands = [];
    const P = id => game.city.places.find(p => p.id === id);
    const bus = P('nanded-bus-stand');
    if (bus) this.stands.push({ place: bus, spots: busBays(bus).slice(0, 7).map(b => ({ type: 'bus', lx: b.lx, lz: b.lz, dx: b.dx, dz: b.dz, driver: false })) });
    const st = P('nanded-station');
    if (st?.station) {
      // A queue of autos along the forecourt, either side of the entrance, drivers waiting for a fare.
      const spots = [];
      for (const lx of [-25, -20.5, -16, 16, 20.5, 25]) spots.push({ type: 'auto', lx, lz: -13.3, dx: -1, dz: 0, driver: true });
      this.stands.push({ place: st, spots });
    }
    // A car and a scooter at the pumps of every petrol pump.
    for (const pump of game.city.pumps || []) {
      const at = { x: pump.x, z: pump.z, rot: pump.rot + Math.PI, d: 0 };
      this.stands.push({ place: at, spots: [
        { type: pump.look === 1 ? 'hatch' : 'sedan', lx: -3.6 * pump.k - 1.6, lz: -1.5, dx: 0, dz: 1, driver: true },
        { type: 'scooter', lx: 3.6 * pump.k + 1.1, lz: -1.2, dx: 0, dz: -1, driver: true },
      ] });
    }
    const air = P('nanded-airport');
    if (air) this.stands.push({ place: air, spots: [-9, -4.5, 4.5].map(lx => ({ type: lx < 0 ? 'sedan' : 'hatch', lx, lz: -air.d / 2 - 7, dx: 1, dz: 0, driver: true })) });
  }

  update() {
    const g = this.game, pos = g.player.pos;
    for (const s of this.stands) {
      const d = Math.hypot(s.place.x - pos.x, s.place.z - pos.z);
      if (!s.vehicles && d < NEAR) this._fill(s);
      else if (s.vehicles && d > FAR) this._empty(s);
    }
  }

  _fill(s) {
    const g = this.game, p = s.place, rot = placeRot(p), c = Math.cos(rot), sn = Math.sin(rot);
    const X = (lx, lz) => p.x + lx * c + lz * sn, Z = (lx, lz) => p.z - lx * sn + lz * c;
    s.vehicles = [];
    for (const spot of s.spots) {
      const x = X(spot.lx, spot.lz), z = Z(spot.lx, spot.lz);
      // Local direction to world heading.
      const wx = spot.dx * c + spot.dz * sn, wz = -spot.dx * sn + spot.dz * c;
      if (g.vehicles.list.some(o => Math.hypot(o.x - x, o.z - z) < 3)) continue;
      const v = g.vehicles.spawn(spot.type, x, z, Math.atan2(wx, wz), { role: 'parked', driver: spot.driver, seed: Math.round(x * 31 + z * 17) });
      s.vehicles.push(v);
    }
  }

  _empty(s) {
    const g = this.game;
    // Anything the player took (or wrecked, or pushed into traffic) is no longer ours to tidy.
    for (const v of s.vehicles) if (v.role === 'parked' && g.vehicles.list.includes(v)) g.vehicles.remove(v);
    s.vehicles = null;
  }
}
