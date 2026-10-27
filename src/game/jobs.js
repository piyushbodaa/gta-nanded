// Side activities: auto-rickshaw fares, Bhookh Express deliveries, the landmark
// passport, street races, roadside snacks and Anna's respray garage.
import { dist, rng, hash2, clamp } from '../core/math.js';
import { speedOf } from '../actors/vehicle-physics.js';
import { GARAGE } from './story.js';
import { PROP } from '../world/citygen.js';
import { key, pick } from '../ui/controls.js';

/** How to end the job you are on. */
const stopJob = g => pick(g, { keyboard: `Press ${key(g, 'job')} again to stop.`, gamepad: `Press ${key(g, 'job')} again to stop.`, touch: 'Tap <kbd class="tap">STOP JOB</kbd> to stop.' });

export const LANDMARK_IDS = ['hazur-sahib', 'nagina-ghat', 'langar-sahib', 'sangat-sahib', 'mata-sahib', 'hira-ghat', 'shikar-ghat', 'banda-ghat',
  'ram-ghat', 'govardhan-ghat', 'urvashi-ghat', 'kaleshwar-temple', 'vishnupuri-dam', 'nandgiri-fort', 'old-mondha-clock-tower', 'mal-tekdi', 'godavari-river'];
const SNACKS = [['Cutting chai', 'कटिंग चहा', 10, 15], ['Vada pav', 'वडा पाव', 15, 25], ['Poha', 'पोहे', 20, 30], ['Misal pav', 'मिसळ पाव', 40, 45], ['Sugarcane juice', 'उसाचा रस', 20, 20], ['Jalebi', 'जलेबी', 25, 30]];
const TAXI_LINES = [
  'Bhau, {dest}. Jaldi — my boss is waiting.', '{dest} chalo. And no detour, I know the roads!', 'Take me to {dest}. Meter? What meter?',
  '{dest}, please. My mother-in-law is visiting, take the long… no, short way.', 'Quickly to {dest}! Exam hai!', '{dest} jaayche aahe. Halu chalava, haan.',
];
const RACES = [
  { id: 'race-circle', name: 'Nanded Circle', start: { x: -29.7, z: -982.4 }, points: [{ x: -299.8, z: -1113.2 }, { x: -256.9, z: -485.7 }, { x: 39.7, z: 214.1 }, { x: -29.7, z: -982.4 }], reward: 1200 },
  // Starts down the forecourt road, clear of the first mission's marker at the station.
  { id: 'race-airport', name: 'Station to Airport', start: { x: 35.1, z: 10.5 }, points: [{ x: 290.5, z: -31.7 }, { x: 766.5, z: -881.9 }, { x: 1357.0, z: -1358.8 }], reward: 1400 },
];

export class Jobs {
  constructor(game) {
    this.game = game;
    this.active = null;
    this.places = game.city.places;
    this.landmarks = LANDMARK_IDS.map(id => this.places.find(p => p.id === id)).filter(Boolean);
    this.food = this.places.filter(p => ['restaurant', 'cafe'].includes(p.category));
    this.seed = 1;
    this.races = RACES;
    this._routeAt = -Infinity; // when the job's GPS line was last worked out
  }

  /** Map blips for activities that can be started right now. */
  staticBlips() {
    const g = this.game, out = [];
    if (g.save.data.garage) out.push({ x: GARAGE.x, z: GARAGE.z, kind: 'icon', label: 'R', color: '#7ee787' });
    for (const lm of this.landmarks) if (!g.save.data.stamps.includes(lm.id)) out.push({ x: lm.ax, z: lm.az, kind: 'icon', label: '◎', color: '#7edac8' });
    for (const r of this.races) out.push({ x: r.start.x, z: r.start.z, kind: 'icon', label: '⚑', color: '#ff7a59' });
    return out;
  }

  markers() {
    const g = this.game, out = [];
    if (this.active) return out;
    const pos = g.player.pos;
    for (const r of this.races) if (dist(pos.x, pos.z, r.start.x, r.start.z) < 120) out.push({ x: r.start.x, z: r.start.z, r: 3, h: 4, color: 0xff7a59 });
    if (g.save.data.garage && dist(pos.x, pos.z, GARAGE.x, GARAGE.z) < 150) out.push({ x: GARAGE.x, z: GARAGE.z, r: 3.5, h: 3.5, color: 0x7ee787 });
    for (const lm of this.landmarks) if (!g.save.data.stamps.includes(lm.id) && dist(pos.x, pos.z, lm.ax, lm.az) < 90) out.push({ x: lm.ax, z: lm.az, r: 2, h: 2.2, color: 0x7edac8 });
    return out;
  }

  /** What Q / the action button does right now (shown as a prompt). */
  contextAction() {
    const g = this.game, P = g.player;
    if (P.state === 'foot') {
      const stall = this._nearStall();
      if (stall !== null) { const s = this._snackFor(stall); return { label: `Buy ${s[0]} · ₹${s[2]}`, run: () => this._buy(s) }; }
      const lm = this._nearLandmark();
      if (lm) return { label: g.save.data.stamps.includes(lm.id) ? `Photo of ${lm.shortName}` : `Photograph ${lm.shortName} · passport stamp`, run: () => this.photo(lm) };
    } else if (P.state === 'driving' && !g.missions.active) {
      const v = P.vehicle;
      if (this.active) return { key: 'N', label: `Stop ${this.active.label}` };
      const race = this._raceAt(v);
      if (race) return { key: 'N', label: `Start race: ${race.name} · ₹${race.reward}` };
      if (v.type === 'auto') return { key: 'N', label: 'Start rickshaw fares' };
      if (v.type === 'scooter' || v.type === 'bike') return { key: 'N', label: 'Start Bhookh Express deliveries' };
    }
    return null;
  }

  update(dt) {
    const g = this.game, P = g.player;
    if (g.input.pressed('job') && P.state === 'driving' && !g.missions.active) {
      const race = this._raceAt(P.vehicle);
      if (this.active) this.stop();
      else if (race) this._startRace(race);
      else if (P.vehicle.type === 'auto') this._startTaxi();
      else if (P.vehicle.type === 'scooter' || P.vehicle.type === 'bike') this._startDelivery();
    }
    // Respray.
    if (g.save.data.garage && P.vehicle && g.police.level > 0 && dist(P.vehicle.x, P.vehicle.z, GARAGE.x, GARAGE.z) < 6 && speedOf(P.vehicle) < 6) this._respray();
    if (!this.active) return;
    const a = this.active;
    if (a.kind === 'race') return this._race(dt);
    if (!P.vehicle || P.vehicle !== a.vehicle) { this.stop(); return; }
    a.t += dt;
    if (a.kind === 'taxi') this._taxi(dt);
    else this._delivery(dt);
    g.missions.active || this._markersAndRoute(a.target);
  }

  stop(silent = false) {
    const g = this.game, a = this.active;
    if (!a) return;
    if (a.passenger) { g.vehicles.list.includes(a.vehicle) && a.vehicle.passengers.splice(a.vehicle.passengers.indexOf(a.passenger), 1); g.humans.remove(a.passenger); }
    if (a.hail) g.peds.remove(a.hail);
    // Rivals become ordinary abandoned cars, towed once you're far away (unless you took one).
    for (const v of a.rivals || []) { v.keep = false; v.raceDriver = null; if (v.role === 'rival') { v.role = 'abandoned'; g.controls.delete(v); } }
    g.hud.blipList = [];
    this.active = null;
    g.hud.objective(''); g.hud.setTimer(null); g.hud.route = null;
    g.effects.markers.set([]);
    if (!silent) g.hud.help(`${a.label} ended. Earned <b>₹${a.earned || 0}</b>.`, 4);
  }

  _markersAndRoute(t) {
    const g = this.game;
    if (!t) { g.effects.markers.set([]); g.hud.blipList = []; return; }
    g.effects.markers.set([{ x: t.x, z: t.z, r: t.r ?? 3, h: 4, color: t.color ?? 0x7edac8 }]);
    // The GPS line every 1.2 s of game time, whatever the frame rate.
    if (g.time - this._routeAt >= 1.2) {
      this._routeAt = g.time;
      const pos = g.player.pos;
      g.hud.route = g.net.route(pos.x, pos.z, t.x, t.z);
      if (g.hud.route) g.hud.route.color = '#7edac8';
    }
    g.hud.blipList = [{ x: t.x, z: t.z, color: '#7edac8' }];
  }

  // ---------------------------------------------------------------- rickshaw fares
  _startTaxi() {
    const g = this.game;
    this.active = { kind: 'taxi', label: 'Rickshaw fares', vehicle: g.player.vehicle, t: 0, earned: 0, chain: 0 };
    g.hud.help(`<b>Rickshaw fares</b>: pick up the person waving, then drive them to their stop. Quick, clean rides pay tips. ${stopJob(g)}`, 7);
    this._nextFare();
  }
  _nextFare() {
    const g = this.game, a = this.active, pos = g.player.pos;
    const r = rng(hash2(this.seed++, 31));
    // Until someone is found (it can take another try next frame): no fare, nothing to pay out.
    a.stage = 'search'; a.target = null;
    // A passenger waiting at a kerb 60-260 m away.
    for (let k = 0; k < 20; k++) {
      const ang = r() * 6.28, d = r.range(60, 260);
      const n = g.net.nearest(pos.x + Math.cos(ang) * d, pos.z + Math.sin(ang) * d, 40, {}, r => !g.net.raised[r]);
      if (!n || g.net.bridge[n.road]) continue;
      const off = (g.net.width[n.road] / 2 + 0.6) * (g.net.kerbSide(n.road) || 1);
      const x = n.x + n.dz * off, z = n.z - n.dx * off;
      if (g.colliders.blocked(x, z, 0.3)) continue;
      const h = g.humans.add(g.peds.outfitFor(x, z, r), x, z);
      const p = g.peds._make(h, x, z, null);
      p.state = 'hail'; p.keep = true;
      a.hail = p; a.stage = 'pickup';
      a.target = { x: n.x, z: n.z, r: 4, color: 0x7edac8 };
      g.hud.objective('Pick up the <b>passenger</b> waving at the roadside.');
      return;
    }
  }
  _taxi(dt) {
    const g = this.game, a = this.active, v = a.vehicle;
    if (a.stage === 'pickup') {
      const p = a.hail;
      if (!p) return this._nextFare();
      if (dist(v.x, v.z, p.h.x, p.h.z) < 7 && speedOf(v) < 2) {
        // Climb in and name a real place.
        const outfit = p.h.outfit;
        g.peds.remove(p); a.hail = null;
        a.passenger = g.vehicles.addPassenger(v, outfit);
        const r = rng(hash2(this.seed++, 77));
        const candidates = this.places.filter(pl => { const d = dist(pl.ax, pl.az, v.x, v.z); return d > 250 && d < 1300 && pl.category !== 'landmark' || (pl.category === 'landmark' && d > 250 && d < 1300); });
        const dest = r.pick(candidates.length ? candidates : this.places);
        a.dest = dest; a.stage = 'ride';
        const route = g.net.route(v.x, v.z, dest.ax, dest.az);
        a.routeLen = route ? route.length : dist(v.x, v.z, dest.ax, dest.az) * 1.3;
        a.limit = 18 + a.routeLen / 9;
        a.left = a.limit; a.hits = 0; a.startHealth = v.health;
        a.target = { x: dest.ax, z: dest.az, r: 5, color: 0x7edac8 };
        const line = r.pick(TAXI_LINES).replace('{dest}', `<b>${dest.shortName}</b>`);
        g.hud.subtitle('Passenger', line, 5, '#7edac8');
        g.hud.objective(`Drive to <b>${dest.shortName}</b> · ${dest.area}`);
      }
      return;
    }
    if (a.stage !== 'ride') return this._nextFare();
    a.left -= dt;
    g.hud.setTimer(Math.max(0, a.left), 'TIP');
    const t = a.target;
    if (dist(v.x, v.z, t.x, t.z) < 7 && speedOf(v) < 2.5) {
      const base = Math.round(25 + a.routeLen * 0.09);
      const damage = Math.max(0, a.startHealth - v.health);
      const tip = a.left > 0 ? Math.round(base * 0.5 * (a.left / a.limit) + a.chain * 10) : 0;
      const fare = Math.max(10, base + tip - Math.round(damage * 0.05));
      a.earned += fare; a.chain++;
      g.addCash(fare);
      g.save.stat('fares');
      g.hud.toast(`Fare <b>₹${fare}</b>${tip ? ` · tip ₹${tip}` : ''} · streak ${a.chain}`);
      g.hud.setTimer(null);
      if (a.passenger) { v.passengers.splice(v.passengers.indexOf(a.passenger), 1); const h = a.passenger; a.passenger = null; const p = g.peds._make(h, h.x, h.z, null); h.pose = 'walk'; p.state = 'walk'; }
      this._nextFare();
    }
  }

  // ---------------------------------------------------------------- deliveries
  _startDelivery() {
    const g = this.game;
    this.active = { kind: 'delivery', label: 'Bhookh Express', vehicle: g.player.vehicle, t: 0, earned: 0, chain: 0 };
    g.hud.help(`<b>Bhookh Express</b>: collect the order from the restaurant and deliver it hot. ${stopJob(g)}`, 7);
    this._nextOrder();
  }
  _nextOrder() {
    const g = this.game, a = this.active, pos = g.player.pos;
    const r = rng(hash2(this.seed++, 13));
    const near = this.food.filter(p => dist(p.ax, p.az, pos.x, pos.z) < 900);
    const shop = r.pick(near.length ? near : this.food);
    a.shop = shop; a.stage = 'collect';
    a.target = { x: shop.ax, z: shop.az, r: 4, color: 0xffb347 };
    g.hud.objective(`Collect the order from <b>${shop.shortName}</b>.`);
  }
  _delivery(dt) {
    const g = this.game, a = this.active, v = a.vehicle;
    const t = a.target;
    if (a.stage === 'collect') {
      if (dist(v.x, v.z, t.x, t.z) < 6 && speedOf(v) < 2.5) {
        const r = rng(hash2(this.seed++, 5));
        // Deliver to a house: a random kerb point 200-700 m away.
        for (let k = 0; k < 30; k++) {
          const ang = r() * 6.28, d = r.range(200, 700);
          const n = g.net.nearest(v.x + Math.cos(ang) * d, v.z + Math.sin(ang) * d, 40, {}, r => !g.net.raised[r]);
          if (!n || g.net.type[n.road] < 4) continue;
          a.stage = 'deliver';
          const district = g.city.district(n.x, n.z).name;
          a.target = { x: n.x, z: n.z, r: 4, color: 0xffb347 };
          const route = g.net.route(v.x, v.z, n.x, n.z);
          a.limit = 20 + (route ? route.length : d * 1.3) / 10;
          a.left = a.limit; a.dist = route ? route.length : d;
          g.hud.objective(`Deliver the order to a house in <b>${district}</b>. Keep it hot!`);
          return;
        }
      }
      return;
    }
    a.left -= dt;
    g.hud.setTimer(Math.max(0, a.left), 'HOT');
    if (dist(v.x, v.z, t.x, t.z) < 6 && speedOf(v) < 2.5) {
      const pay = Math.round(30 + a.dist * 0.07 + (a.left > 0 ? 25 + a.chain * 8 : 0));
      a.earned += pay; a.chain++;
      g.addCash(pay); g.save.stat('deliveries');
      g.hud.toast(`Delivered · <b>₹${pay}</b>${a.left > 0 ? ' · still hot!' : ' · cold, no tip'}`);
      g.hud.setTimer(null);
      this._nextOrder();
    }
  }

  // ---------------------------------------------------------------- races
  _raceAt(v) {
    if (!v || this.active) return null;
    return this.races.find(r => dist(v.x, v.z, r.start.x, r.start.z) < 5) || null;
  }
  _startRace(def) {
    const g = this.game, v = g.player.vehicle;
    const rivals = [];
    const types = ['hatch', 'bike', 'sedan'];
    for (let i = 0; i < 3; i++) {
      const n = g.net.nearest(def.start.x + (i + 1) * 7 * Math.sin(v.heading + 2.4), def.start.z + (i + 1) * 7 * Math.cos(v.heading + 2.4), 30, {}, r => !g.net.raised[r]);
      if (!n) continue;
      const rv = g.vehicles.spawn(types[i], n.x, n.z, v.heading, { role: 'rival' });
      rv.kinematic = false; rv.keep = true;
      const pts = [];
      let from = { x: rv.x, z: rv.z };
      for (const p of def.points) { const r = g.net.route(from.x, from.z, p.x, p.z); if (r) pts.push(...r.points); from = p; }
      rv.raceDriver = new (g.DynamicDriver)(g, rv, { aggression: 0.7, maxSpeed: rv.spec.top * 0.9 });
      rv.raceDriver.setPath(pts); rv.raceIdx = 0;
      rivals.push(rv);
    }
    this.active = { kind: 'race', label: def.name, def, rivals, idx: 0, t: -3, vehicle: v, earned: 0 };
    g.hud.big(def.name.toUpperCase(), 'STREET RACE', 'title', 2.5);
    g.hud.help('Reach every checkpoint first. Rivals play dirty.', 5);
  }
  _race(dt) {
    const g = this.game, a = this.active, P = g.player;
    a.t += dt;
    const pts = a.def.points;
    if (a.t < 0) { g.hud.objective(`Get ready… <b>${Math.ceil(-a.t)}</b>`); for (const r of a.rivals) g.controls.set(r, { throttle: 0, brake: 1, steer: 0 }); return; }
    if (!P.vehicle) { this.stop(); return; }
    const p = pts[a.idx];
    let ahead = 0;
    const pos = P.vehicle;
    for (const r of a.rivals) {
      if (r.wrecked || r === P.vehicle) continue; // a rival you jacked is yours to drive
      const rp = pts[Math.min(r.raceIdx, pts.length - 1)];
      if (dist(r.x, r.z, rp.x, rp.z) < 15) r.raceIdx++;
      if (r.raceIdx >= pts.length) { g.hud.big('RACE LOST', `A rival won the ${a.def.name}`, 'failed', 4); this.stop(true); return; }
      const mine = a.idx * 1e5 - dist(pos.x, pos.z, p.x, p.z), theirs = r.raceIdx * 1e5 - dist(r.x, r.z, rp.x, rp.z);
      if (theirs > mine) ahead++;
      r.raceDriver.maxSpeed = r.spec.top * 0.9 * clamp(1 + (mine - theirs) / 900, 0.82, 1.15);
      g.controls.set(r, r.raceDriver.control(dt));
    }
    g.hud.objective(`${a.def.name}: position <b>${ahead + 1}/${a.rivals.length + 1}</b> · checkpoint ${a.idx + 1}/${pts.length}`);
    g.hud.setTimer(a.t, 'TIME');
    a.target = { x: p.x, z: p.z, r: 6, color: a.idx === pts.length - 1 ? 0xff5252 : 0xffc83d };
    this._markersAndRoute(a.target);
    if (dist(pos.x, pos.z, p.x, p.z) < 9) {
      a.idx++; g.audio?.sfx('checkpoint');
      if (a.idx >= pts.length) {
        const best = g.save.data.records[a.def.id];
        const time = Math.round(a.t * 10) / 10;
        if (!best || time < best) g.save.data.records[a.def.id] = time;
        g.addCash(a.def.reward);
        g.hud.big('RACE WON', `₹${a.def.reward} · ${time.toFixed(1)}s${!best || time < best ? ' · NEW RECORD' : ''}`, 'passed', 5);
        g.audio?.sfx('passed');
        a.earned = a.def.reward;
        this.stop(true);
      }
    }
  }

  // ---------------------------------------------------------------- snacks, photos, respray
  _nearStall() {
    const g = this.game, P = g.player, props = g.city.props, R = 3.2;
    // Props are filed under their own chunk: look in every chunk the reach overlaps (usually one).
    for (let cx = Math.floor((P.x - R) / 192); cx <= Math.floor((P.x + R) / 192); cx++) {
      for (let cz = Math.floor((P.z - R) / 192); cz <= Math.floor((P.z + R) / 192); cz++) {
        const c = g.city.chunk(cx, cz);
        if (!c) continue;
        for (const i of c.props) {
          const k = props.kind[i];
          if ((k === PROP.STALL || k === PROP.CART) && dist(props.x[i], props.z[i], P.x, P.z) < R) return i;
        }
      }
    }
    return null;
  }
  _snackFor(i) { return SNACKS[i % SNACKS.length]; }
  _buy(s) {
    const g = this.game;
    if (g.save.cash < s[2]) { g.hud.help(`Not enough cash for ${s[0]}.`, 3); return; }
    g.addCash(-s[2]);
    g.player.heal(s[3]);
    g.energy = 30;
    g.hud.toast(`${s[1]} · ${s[0]} · +${s[3]} health`);
    g.audio?.sfx('buy');
  }
  _nearLandmark() {
    const P = this.game.player;
    for (const lm of this.landmarks) if (dist(lm.ax, lm.az, P.x, P.z) < 26) return lm;
    return null;
  }
  photo(lm) {
    const g = this.game;
    g.takePhoto?.(lm ? lm.shortName : g.city.district(g.player.x, g.player.z).name);
    if (!lm) return;
    if (!g.save.data.stamps.includes(lm.id)) {
      g.save.data.stamps.push(lm.id);
      g.addCash(150);
      g.hud.big('PASSPORT STAMP', `${lm.shortName} · ${g.save.data.stamps.length}/${this.landmarks.length} · ₹150`, 'passed', 3.5);
      g.save.flush();
    }
  }
  _respray() {
    const g = this.game, v = g.player.vehicle;
    if (this._sprayT && g.time - this._sprayT < 5) return;
    this._sprayT = g.time;
    const cost = 250;
    if (g.save.cash < cost) { g.hud.help("Anna: 'No money, no paint, bhau.' (₹250)", 3); return; }
    if (g.police.seen) { g.hud.help("Anna: 'Not with the police watching! Lose them first.'", 3); return; }
    g.addCash(-cost);
    const r = rng(hash2(v.id, Math.floor(g.time)));
    v.color = r.pick(v.spec.colors.concat([0x2e7d32, 0x6a1b9a, 0xf9a825, 0x00838f]));
    v.health = 1000; v.onFire = 0;
    g.police.clear();
    g.hud.big('NEW COLOUR, NEW LIFE', `Anna's Rang Garage · −₹${cost}`, 'passed', 3);
    g.audio?.sfx('spray');
  }
}
