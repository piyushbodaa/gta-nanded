// The story: "Godavari Gold". A son comes home to a moneylender's debt and works his way into, and
// out of, the sand racket on the Godavari. The crimes are the kinds Nanded's police deal with
// (illegal moneylending, two-wheeler theft, matka, river sand, ganja on the Telangana road,
// protection money); every character and event is fictional, and real places appear as public
// settings only and imply no endorsement.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Steps as S } from './missions.js';
import { dist, headingTo } from '../core/math.js';
import { key, pick, drivingHelp } from '../ui/controls.js';
import { VEHICLE_TYPES } from '../actors/vehicle-types.js';

export const CHARACTERS = {
  YOU: { name: 'Sunny', color: '#ffffff' },
  PAKYA: { name: 'Pakya', color: '#7fd1ff', initial: 'P', markerColor: 0x7fd1ff },
  BABA: { name: 'Baba (phone)', color: '#e0c3fc' },
  SAVKAR: { name: 'Kaka Savkar', color: '#e6c15a' },
  BUNTY: { name: 'Bunty', color: '#9be564', initial: 'B', markerColor: 0x9be564 },
  BUNTY_PH: { name: 'Bunty (phone)', color: '#9be564' },
  ANNA: { name: 'Anna', color: '#ffb347', initial: 'A', markerColor: 0xffb347 },
  SHERA: { name: 'Shera', color: '#ff7043', initial: 'S', markerColor: 0xff7043 },
  SHERA_PH: { name: 'Shera (phone)', color: '#ff7043' },
  MAMA: { name: 'Jaggu Mama', color: '#ffd54f', initial: 'M', markerColor: 0xffd54f },
  MAMA_PH: { name: 'Jaggu Mama (phone)', color: '#ffd54f' },
  TIGER: { name: 'Tiger', color: '#ff5c5c', initial: 'T', markerColor: 0xff5c5c },
  KADAM: { name: 'Inspector Kadam', color: '#c3e88d', initial: 'K', markerColor: 0xc3e88d },
  KADAM_PH: { name: 'Inspector Kadam (phone)', color: '#c3e88d' },
  PAPPU: { name: 'Pappu', color: '#b0bec5' },
  MUNSHI: { name: 'Site munshi', color: '#b9f6ca' },
  GOON: { name: 'Goon', color: '#ff9e80' },
};

export const HOME = { x: -935.4, z: -1834.1, name: 'Zenda Chowk' };
export const HOSPITAL = { x: 76.3, z: 270, name: 'SGGS Civil Hospital' };
export const POLICE_STATION = { x: 195.9, z: 401.1, name: 'Vazirabad Police Station' };
export const GARAGE = { x: -299.8, z: -1113.2, name: "Anna's Rang Garage" };

const P = {
  station: { x: 5.3, z: 10.9 }, zenda: HOME, workshop: GARAGE, police: POLICE_STATION,
  taroda: { x: -564.7, z: -1381.4 }, // Taroda Naka
  oldMondha: { x: 544.4, z: 605.3 }, // the old city's market lanes: Kaka Savkar's office
  iib: { x: 6.7, z: -922.8 }, // coaching classes, Parnakuti
  bhagya: { x: -30, z: -983 }, // Bhagya Nagar
  phule: { x: -261.5, z: -397.1 }, // behind Phule Market: Shera's den
  namaskar: { x: 766, z: -882 }, // Namaskar Chowk, the airport bypass
  ghat: { x: -128, z: 894 }, // the sand ghat on the south bank below the Govardhan Ghat bridge
  // The main road up from the ghat, by the bridge: where Mama's tippers load and unload. The
  // ghat's own 4.8 m lanes meet everything at hairpins no truck can turn.
  ghatRoad: { x: -164, z: 972 },
  bridgeN: { x: -91, z: 722 }, // the bridge's city end, where the flying squad waits
  site: { x: -262, z: -1316 }, // a builder's site near Raj Corner
  yard: { x: -233, z: 84 }, // the impound yard behind the Central Bus Stand
  latur: { x: -248, z: 1368 }, // Latur Phata
  degloor: { x: 1038, z: 389 }, // Degloor Naka, on the road in from Telangana
  gandhiPutla: { x: 112.2, z: 417.8 }, dam: { x: -1350.3, z: 1990.4 },
  ghatBridge: { x: -88.8, z: 803.8 }, // mid-bridge on the southbound carriageway, the way the race crosses
};
/** Every place the story sends you (checked against the road network in the tests). */
export const STORY_PLACES = P;

/**
 * The story's mark on the city, made once at the start: heaps of river sand on the south bank by
 * Mama's ghat, off the road and clear of buildings. One mesh, one draw call.
 */
export function dressWorld(g) {
  const heaps = [];
  for (let k = 0; k < 60 && heaps.length < 6; k++) {
    const a = k * 2.39996, r = 10 + (k % 6) * 3.2;
    const x = P.ghat.x + Math.cos(a) * r, z = P.ghat.z + 6 + Math.abs(Math.sin(a)) * r;
    const n = g.net.nearest(x, z, 30, {}), s = 1.5 + (heaps.length % 3) * 0.45;
    if (n && Math.hypot(n.x - x, n.z - z) < g.net.width[n.road] / 2 + s * 1.7 + 1) continue; // off the road
    if (g.colliders.blocked(x, z, s * 1.7) || heaps.some(h => Math.hypot(h.x - x, h.z - z) < 6)) continue;
    const cone = new THREE.ConeGeometry(s * 1.7, s, 16, 2);
    cone.scale(1, 1, 0.75 + (heaps.length % 2) * 0.35).rotateY(a).translate(x, g.city.groundHeight(x, z) + s / 2 - 0.08, z);
    heaps.push({ x, z, geo: cone });
  }
  if (!heaps.length) return null;
  const mesh = new THREE.Mesh(mergeGeometries(heaps.map(h => h.geo)), new THREE.MeshStandardMaterial({ color: 0xc9ad7a, roughness: 1 }));
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.name = 'sand-heaps';
  g.scene.add(mesh);
  return mesh;
}

/**
 * Spawn a vehicle at the kerb near a point, facing along the street. With `toward`, a place the
 * player will drive it to, the kerb facing the way the route there leaves.
 */
function kerbSpawn(c, name, type, at, opts = {}) {
  const x = at.x + (opts.dx || 0), z = at.z + (opts.dz || 0), half = VEHICLE_TYPES[type].L / 2;
  let side = opts.side ?? 1, first = c.roadPoint(x, z, side);
  // Never nosed into a dead end: a tipper can't turn in a 4.8 m lane, and a hunter or a getaway
  // would only wedge at its end. Nor, given where it goes, facing away from the way out: a truck
  // can't turn round in a lane either. The other kerb, facing out.
  const facesOut = p => (opts.toward ? leavesAhead(c.g.net, p, opts.toward) : !deadAhead(c.g.net, p));
  if (!facesOut(first)) {
    const out = c.roadPoint(x, z, -side);
    if (facesOut(out)) { first = out; side = -side; }
  }
  // Something already on that spot (a scene vehicle, traffic, the player): a car length further
  // along the kerb, then back, rather than on top of it.
  let rp = first;
  for (let k = 1; kerbTaken(c.g, rp, half); k++) {
    if (k > 6) { rp = first; break; } // nowhere free close by: where the script says
    const along = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (half * 2 + 1.5);
    rp = c.roadPoint(x + Math.sin(first.heading) * along, z + Math.cos(first.heading) * along, side);
  }
  return c.spawnVehicle(name, type, rp.x, rp.z, rp.heading, opts);
}
/** Does the street a kerb spot faces down end in a dead end (through any plain bends) before a junction? */
function deadAhead(net, { road, dir }) {
  if (road == null) return false;
  let r = road, j = dir > 0 ? net.rb[road] : net.ra[road];
  for (let k = 0; k < 8; k++) {
    const roads = net.jRoads[j];
    if (roads.length !== 2) return roads.length === 1;
    r = roads[0] === r ? roads[1] : roads[0];
    j = net.otherEnd(r, j);
  }
  return false;
}
/** Does the route from a kerb spot to `to` set off the way the spot faces (judged 8 m along it)? */
function leavesAhead(net, at, to) {
  const r = net.route(at.x, at.z, to.x, to.z), p = r?.points;
  if (!p || p.length < 4) return true;
  let k = 2;
  while (k < p.length - 2 && dist(p[k], p[k + 1], p[0], p[1]) < 8) k += 2;
  return Math.sin(at.heading) * (p[k] - p[0]) + Math.cos(at.heading) * (p[k + 1] - p[1]) > 0;
}
function kerbTaken(g, at, half) {
  const P = g.player;
  if (!P.vehicle && dist(P.x, P.z, at.x, at.z) < half + 1) return true;
  return g.vehicles.list.some(v => dist(v.x, v.z, at.x, at.z) < v.hd + half + 0.5);
}
function nearPed(c, name, kind, at, dx, dz, opts = {}) { return c.spawnPed(name, kind, at.x + dx, at.z + dz, opts); }
/**
 * Stand a story actor somewhere else in the scene, on their feet and facing (fx, fz), whatever
 * a scare left them doing. Only while the player is far away: they don't walk there, they're there.
 */
function standAt(c, name, x, z, fx, fz) {
  const p = c.ent[name];
  if (!p?.h) return;
  const h = p.h;
  h.x = x; h.z = z; h.yaw = Math.atan2(fx - x, fz - z);
  h.pose = 'idle'; h.speed = 0; h.roll = h.pitch = 0;
  p.state = 'scripted'; p.t = 999; p.role = null; p.homeX = p.homeZ = undefined; p.vx = p.vz = 0;
}
/** Dress someone for their part: colours and build, plus flags to add or drop (never their shoes). */
function dress(outfit, { add = [], drop = [], ...rest }) {
  Object.assign(outfit, rest);
  for (const f of add) outfit.flags.add(f);
  for (const f of drop) outfit.flags.delete(f);
  return outfit;
}
const LOOK = {
  pakya: { shirt: 0x3f88c5, sleeve: 0x3f88c5, pants: 0x2b2b2b, legs: 0x2b2b2b },
  savkar: { shirt: 0xf4f1e8, sleeve: 0xf4f1e8, pants: 0xf4f1e8, legs: 0xf4f1e8, heavy: 0.8, add: ['kurta', 'moustache'], drop: ['stubble', 'collar', 'belt'], code: 3 << 4 },
  bunty: { shirt: 0x1f6f5c, sleeve: 0x1f6f5c, trim: 0xf4f1ea, code: 3 | (1 << 4), add: ['stubble'] },
  shera: { shirt: 0x151515, sleeve: 0x151515, pants: 0x1b2631, legs: 0x1b2631, add: ['stubble'], heavy: 0.3 },
  mama: { shirt: 0xf7f7f2, sleeve: 0xf7f7f2, pants: 0xf7f7f2, legs: 0xf7f7f2, heavy: 1, add: ['kurta', 'moustache'], drop: ['stubble', 'collar', 'belt'], code: 3 << 4 },
  tiger: { shirt: 0x8e1b1b, sleeve: 0x8e1b1b, pants: 0x111111, legs: 0x111111, add: ['stubble'] },
};
/**
 * Mama's ghat on the south bank: a tractor and a tipper waiting for the night's boats, down the
 * stub lane by the bridge railing, clear of the lane in from the main road.
 */
function ghatScene(c, { tipper = true } = {}) {
  kerbSpawn(c, 'ghatTractor', 'tractor', P.ghat, { dx: 1, dz: -13, color: 0x2e7d32 });
  if (tipper) kerbSpawn(c, 'ghatTipper', 'truck', P.ghat, { dx: 10, color: 0xb8932a });
}
/** The impound yard behind the bus stand: what the squads have seized lately. */
function yardScene(c) {
  kerbSpawn(c, 'yardTractor', 'tractor', P.yard, { dx: -9, color: 0x1565c0 });
  kerbSpawn(c, 'yardBike', 'bike', P.yard, { dx: 15, color: 0x6d4c41 });
  kerbSpawn(c, 'yardAuto', 'auto', P.yard, { dx: 20, color: 0x1d1d1d });
}
/** Put a character's look on a vehicle's driver. */
function driverAs(v, look) { if (v?.driver) dress(v.driver.outfit, look); return v; }

/** Checkpoints every ~step metres along a road route through the given points. */
function routeCheckpoints(g, pts, step = 300) {
  const out = [];
  for (let k = 0; k < pts.length - 1; k++) {
    const r = g.net.route(pts[k].x, pts[k].z, pts[k + 1].x, pts[k + 1].z);
    if (!r) { out.push(pts[k + 1]); continue; }
    let acc = 0;
    const p = r.points;
    for (let i = 2; i < p.length; i += 2) {
      acc += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
      if (acc >= step) { out.push({ x: p[i], z: p[i + 1] }); acc = 0; }
    }
    const last = out[out.length - 1];
    if (!last || dist(last.x, last.z, pts[k + 1].x, pts[k + 1].z) > 60) out.push(pts[k + 1]);
    else out[out.length - 1] = pts[k + 1];
  }
  return out;
}
const punch = g => pick(g, { keyboard: 'click or <kbd>J</kbd>', gamepad: key(g, 'attack'), touch: key(g, 'attack') });

export const STORY = [
  {
    id: 'c1', giver: 'PAKYA', title: 'कर्ज', subtitle: 'THE DEBT', reward: 500,
    start: P.station,
    steps: g => [
      S.call(c => {
        kerbSpawn(c, 'auto', 'auto', P.station, { dx: 6, label: "Pakya's auto", color: 0x1d1d1d });
        const a = c.ent.auto;
        nearPed(c, 'pakya', 'man', { x: a.x, z: a.z }, -Math.cos(a.heading) * 1.6, Math.sin(a.heading) * 1.6, { heading: a.heading + Math.PI / 2 });
        dress(c.ent.pakya.h.outfit, LOOK.pakya);
        c.ent.pakya.blip = '#7fd1ff';
        const me = c.g.player;
        me.heading = headingTo(me.x, me.z, a.x, a.z); me.human.yaw = me.heading;
        c.ent.pakya.h.yaw = headingTo(c.ent.pakya.h.x, c.ent.pakya.h.z, me.x, me.z);
      }),
      S.say([
        ['PAKYA', 'Sunny bhau! The Pune-wala is back!'],
        ['YOU', 'The company shut down, Pakya. No job, no salary. Just this bag and a bus ticket.'],
        ['PAKYA', "Then you haven't heard. Your Baba took two lakh from Kaka Savkar for the soybean. Ten rupees on every hundred — every month."],
        ['PAKYA', "The rains failed. Savkar says it's six lakh now. Last week his boys took the tractor. And the land papers."],
        ['YOU', 'Six lakh?! Take me to this Savkar. Now.'],
      ], {
        block: true,
        // A crane shot: high over the station forecourt, settling behind Sunny.
        shot: c => {
          const me = c.g.player, a = c.ent.auto;
          const mx = (me.x + a.x) / 2, mz = (me.z + a.z) / 2;
          const away = Math.atan2(me.x - 5, me.z + 4);
          const dx = Math.sin(away), dz = Math.cos(away);
          return {
            from: new THREE.Vector3(mx + dx * 34 - dz * 12, 19, mz + dz * 34 + dx * 12),
            to: new THREE.Vector3(mx + dx * 9 - dz * 3, 3.2, mz + dz * 9 + dx * 3),
            look: new THREE.Vector3(mx - dx * 4, 2.2, mz - dz * 4),
            duration: 13,
          };
        },
      }),
      S.enter('auto', `Get in Pakya's <b>auto</b>. <i>(${key(g, 'enter')})</i>`),
      S.call(c => {
        const p = c.ent.pakya;
        if (p) { const outfit = p.h.outfit; c.g.peds.remove(p); delete c.ent.pakya; c.g.vehicles.addPassenger(c.ent.auto, outfit); }
        c.g.hud.help(`${drivingHelp(c.g)} Follow the yellow route on the radar.`, 9);
      }),
      S.goTo(P.oldMondha, "Drive to <b>Kaka Savkar's office</b> in the Old Mondha lanes.", {
        vehicle: 'auto', radius: 8,
        chatter: [
          [0.85, [['PAKYA', 'Savkar lends to half the district. Farmers, students, auto-wale. Nobody ever finishes paying.']]],
          [0.6, [['PAKYA', 'No licence, no receipts. A diary, a stamp paper, and boys with sticks.']]],
          [0.35, [['PAKYA', "Careful, bhau. People say Savkar's money isn't his. Somebody bigger stands behind him."]]],
        ],
      }),
      S.call(c => {
        const at = c.roadPoint(P.oldMondha.x + 10, P.oldMondha.z, 1);
        for (let i = 0; i < 3; i++) nearPed(c, `g${i}`, 'goon', at, Math.cos(i * 2.1) * 2.6, Math.sin(i * 2.1) * 2.6, {});
        nearPed(c, 'savkar', 'man', at, 6, 4, {});
        dress(c.ent.savkar.h.outfit, LOOK.savkar);
        kerbSpawn(c, 'savkarSuv', 'suv', P.oldMondha, { dx: 22, label: "Savkar's SUV", color: 0xf2f2f2 });
      }),
      S.say([['GOON', 'Office is closed, hero. Come back with money.'], ['YOU', "I've come for my father's papers."], ['SAVKAR', "Patil's boy, from Pune. Show him how Nanded does business."]]),
      S.fight(['g0', 'g1', 'g2'], `Fight off <b>Savkar's men</b>. <i>(${punch(g)} to punch)</i>`),
      S.say([
        ['SAVKAR', 'Strong boy. Good. Strong boys can earn.'],
        ['SAVKAR', "Six lakh by Diwali, Patil, or the land is mine. And the interest starts tomorrow."],
        ['PAKYA', "Bhau, let's go — before his friends in khaki turn up."],
      ]),
      S.goTo(P.zenda, 'Drive home to <b>Zenda Chowk</b>.', { vehicle: 'auto', radius: 7 }),
      S.say([
        ['BABA', "Sunny? You went to Savkar? Beta, don't fight them. Next they'll burn the crop."],
        ['YOU', "Then I'll find six lakh, Baba. Somehow."],
        ['PAKYA', 'Bhau… there is a man at Taroda Naka. Bunty. He pays cash for certain jobs. No questions.'],
      ]),
    ],
    onPass: g => g.hud.help(`New contacts are marked on your radar and map (${key(g, 'map')}) with their initials. Walk into a marker to start.`, 9),
  },
  {
    id: 'c2', giver: 'BUNTY', title: 'चोरीच्या गाड्या', subtitle: 'HOT WHEELS', reward: 1200, requires: ['c1'],
    start: P.taroda,
    steps: g => [
      S.say([
        ['BUNTY', "Pakya's friend? Good. I take orders for bikes. Today's order: two Tejas 125s."],
        ['BUNTY', 'Coaching students park outside the classes at Parnakuti all day. Half of them never lock the handle.'],
        ['BUNTY', 'Take them to Anna at Workshop Corner. He changes the plates, I sell them in the villages.'],
        ['YOU', "Students' bikes…"],
        ['BUNTY', "Their fathers will buy new ones. Yours can't buy back his land."],
      ], { block: true }),
      S.goTo(P.iib, 'Go to the coaching classes at <b>Parnakuti</b>.', { radius: 14, stop: false }),
      S.call(c => kerbSpawn(c, 'bike1', 'bike', P.iib, { dx: 6, label: 'black Tejas', color: 0x151515 })),
      S.enter('bike1', 'Steal the <b>black Tejas</b>.'),
      S.call(c => { c.g.police.setLevel(1); c.g.hud.big('WANTED', 'A student saw you take it', 'wanted', 2.5); }),
      S.goTo(P.workshop, "Ride it to <b>Anna's garage</b> at Workshop Corner.", { vehicle: 'bike1', radius: 7 }),
      S.leave('Get off the bike.'),
      S.say([
        ['ANNA', "Another one of Bunty's \"orders\"… Sunny? You?"],
        ['YOU', "Baba's land, Anna."],
        ['ANNA', 'Hm. Leave it with me. And listen: police on your tail, drive straight into my garage. New colour, new plates, no questions.'],
      ]),
      S.call(c => {
        c.g.save.set('garage', true); c.g.save.flush();
        c.g.police.clear();
        // Anna keeps the bike, even if you hopped back on while he talked.
        if (c.g.player.vehicle === c.ent.bike1) c.g.player.leaveVehicle(true);
        c.g.vehicles.remove(c.ent.bike1); delete c.ent.bike1;
      }),
      S.goTo(P.bhagya, 'One more: Bunty says another stands outside a class in <b>Bhagya Nagar</b>.', { radius: 14, stop: false }),
      S.call(c => kerbSpawn(c, 'bike2', 'bike', P.bhagya, { dx: 5, label: 'Tejas', color: 0x1e3a8a })),
      S.enter('bike2', 'Steal the second <b>Tejas</b>.'),
      S.escape(2, "A constable saw you! Lose the police — or ride into <b>Anna's garage</b> for a respray."),
      S.goTo(P.workshop, "Deliver it to <b>Anna's garage</b>.", { vehicle: 'bike2', radius: 7 }),
      S.say([['BUNTY_PH', 'Two bikes. Forty thousand, minus my cut. Pakya was right about you.'], ['BUNTY_PH', 'Shera wants to meet you. Behind Phule Market. He runs the numbers in this town.']]),
    ],
    onPass: g => g.hud.help("Anna's <b>Rang Garage</b> is open: drive in while wanted to lose the police for ₹250 (it also repairs your ride).", 9),
  },
  {
    id: 'c3', giver: 'SHERA', title: 'मटका', subtitle: 'THE NUMBERS GAME', reward: 1800, requires: ['c2'],
    start: P.phule,
    steps: g => [
      S.call(c => {
        const at = c.roadPoint(P.phule.x, P.phule.z, 1);
        nearPed(c, 'shera', 'goon', at, 2, 2, {});
        dress(c.ent.shera.h.outfit, LOOK.shera);
        for (let i = 0; i < 2; i++) nearPed(c, `g${i}`, 'goon', at, -2 - i * 1.5, 3, {});
        kerbSpawn(c, 'car', 'hatch', P.phule, { dx: -6, label: "Shera's car", color: 0x8e1b1b });
        // The runners' bikes outside the den.
        kerbSpawn(c, 'runner1', 'bike', P.phule, { dx: 4, color: 0x151515 }); kerbSpawn(c, 'runner2', 'scooter', P.phule, { dx: 7, color: 0x1e88e5 });
      }),
      S.say([
        ['SHERA', "So you're Bunty's new boy. I'm Shera. I run the numbers — open, close, jodi. Every paan shop from here to Vazirabad takes my slips."],
        ['SHERA', "Today my collector Pappu ran off with the day's takings. Red scooty, heading for the airport road."],
        ['SHERA', "Take my car. Bring back the bag. Pappu, I don't care about."],
      ], { block: true }),
      S.call(c => driverAs(kerbSpawn(c, 'pappu', 'scooter', P.phule, { dx: 90, label: 'Pappu', color: 0xd32f2f, driver: true }), { shirt: 0xf0ad4e, sleeve: 0xf0ad4e })),
      S.enter('car', "Get in <b>Shera's car</b>."),
      S.chase('pappu', P.namaskar, 'Catch <b>Pappu</b> — ram his scooty till he gives up.', { driverAs: 'pappuMan', rams: 3 }),
      S.fight(['pappuMan'], 'Get the bag off <b>Pappu</b>.', { pappuMan: 1 }),
      S.say([['PAPPU', 'Okay, okay! Take it! Shera pays us peanuts, bhau!'], ['YOU', 'Then complain to Shera.']]),
      S.goTo(P.phule, 'Take the bag back to <b>Shera</b> behind Phule Market.', { radius: 8 }),
      S.say([
        ['SHERA', 'All of it. Good.'],
        ['SHERA', "Bad news: somebody called the police Khabar line about my den. Kadam's raid team is on its way."],
        ['SHERA', "Get the cash box to Anna's before they seal the lane. Go!"],
      ]),
      S.call(c => kerbSpawn(c, 'cash', 'hatch', P.phule, { dx: 8, label: 'cash car', color: 0x4a4a4a })),
      S.enter('cash', 'Get in the <b>cash car</b>.'),
      S.call(c => c.g.police.setLevel(2)),
      S.goTo(P.workshop, "Get the cash to <b>Anna's garage</b> before the raid team catches up.", { vehicle: 'cash', radius: 7, timer: 150, timerFail: "Kadam's team caught up with the cash." }),
      S.say([['SHERA_PH', "The den was empty when Kadam walked in. He bought a paan and left. You've got a future, Patil."], ['SHERA_PH', 'Mama wants to see you. The sand ghat below the Govardhan bridge, on the south bank.']]),
    ],
  },
  {
    id: 'c4', giver: 'MAMA', title: 'पिवळं सोनं', subtitle: 'YELLOW GOLD', reward: 2500, requires: ['c3'],
    start: P.ghat,
    steps: g => [
      S.call(c => {
        const at = c.roadPoint(P.ghat.x, P.ghat.z, 1);
        nearPed(c, 'mama', 'man', at, 2.5, 2, {});
        dress(c.ent.mama.h.outfit, LOOK.mama);
        ghatScene(c, { tipper: false });
        // Loaded and waiting up on the main road, facing the bridge.
        kerbSpawn(c, 'tipper', 'truck', P.ghatRoad, { side: -1, label: 'sand tipper', color: 0xc9a227 });
      }),
      S.say([
        ['MAMA', 'So this is the boy who kept Shera\'s cash out of Kadam\'s hands. Sit, sit.'],
        ['MAMA', "You know what Nanded is built on, Patil? Not cement. Sand. The Godavari's yellow gold."],
        ['MAMA', 'The government auctions a few ghats a year. My boats work every night. A tipper of river sand is fifty thousand in the city.'],
        ['MAMA', "The tipper up on the road goes to a builder's site near Raj Corner. The revenue flying squad watches the bridges. Don't let them see you."],
      ], { block: true }),
      S.enter('tipper', 'Get in the <b>sand tipper</b> up on the main road.'),
      S.goTo(P.bridgeN, 'Cross the <b>Govardhan bridge</b> into the city.', { vehicle: 'tipper', radius: 16, stop: false }),
      S.call(c => { c.g.police.setLevel(1); c.g.hud.big('FLYING SQUAD', 'They saw the tipper', 'wanted', 2.5); }),
      S.escape(1, "Lose the flying squad — or get to <b>Anna's garage</b>."),
      S.goTo(P.site, "Deliver the sand to the <b>builder's site</b> near Raj Corner.", { vehicle: 'tipper', radius: 10, maxDamage: 0.55, damageFail: 'The tipper is wrecked and the sand is all over the road.' }),
      S.say([['MUNSHI', "Mama's sand? Tip it at the back. Here — cash for Mama."], ['MAMA_PH', 'Good boy. Twenty-five hundred for you. There is more where the river comes from.']]),
    ],
  },
  {
    id: 'c5', giver: 'MAMA', title: 'जप्ती', subtitle: 'SEIZED', reward: 3000, requires: ['c4'],
    start: { x: P.ghat.x + 3, z: P.ghat.z + 3 },
    steps: g => [
      S.call(c => {
        const at = c.roadPoint(P.ghat.x, P.ghat.z, 1);
        nearPed(c, 'mama', 'man', at, 2.5, 2, {}); dress(c.ent.mama.h.outfit, LOOK.mama);
        nearPed(c, 'shera', 'goon', at, -2, 2.5, {}); dress(c.ent.shera.h.outfit, LOOK.shera);
        ghatScene(c);
      }),
      S.say([
        ['MAMA', "Last night the tehsildar's squad seized one of my tippers at Latur Phata. It is standing in the impound yard behind the bus stand."],
        ['MAMA', 'Tomorrow they auction it. Today it comes home. Nobody gets hurt — you just drive it out.'],
        ['SHERA', 'The watchman naps after his chai. Mostly.'],
      ], { block: true }),
      S.goTo(P.yard, 'Go to the <b>impound yard</b> behind the Central Bus Stand.', { radius: 16, stop: false }),
      // Facing the way out of the yard's lane, toward the main road home, not up to its bend.
      S.call(c => { kerbSpawn(c, 'seized', 'truck', P.yard, { dx: 6, label: "Mama's tipper", color: 0xc9a227, toward: P.ghatRoad }); yardScene(c); }),
      S.enter('seized', "Take back <b>Mama's tipper</b>."),
      // Mama and Shera go up to the main road to see it home, where you park it (on the kerb
      // you pull in at off the bridge), not down the ghat lanes out of sight. You're across town.
      S.call(c => {
        const at = c.roadPoint(P.ghatRoad.x, P.ghatRoad.z, 1);
        // On the footpath behind that kerb: to the left of the way the traffic there faces.
        const ox = Math.cos(at.heading), oz = -Math.sin(at.heading), fx = Math.sin(at.heading), fz = Math.cos(at.heading);
        standAt(c, 'mama', at.x + ox * 2.4 + fx * 1.5, at.z + oz * 2.4 + fz * 1.5, at.x, at.z);
        standAt(c, 'shera', at.x + ox * 2.4 - fx * 1.5, at.z + oz * 2.4 - fz * 1.5, at.x, at.z);
      }),
      S.call(c => { c.g.police.setLevel(2); c.g.hud.big('WANTED', 'The watchman blew his whistle', 'wanted', 2.5); }),
      S.escape(2, "Lose the police — <b>Anna's garage</b> resprays anything, even a tipper."),
      S.goTo(P.ghatRoad, "Bring the tipper home: park it on the main road above <b>Mama's ghat</b>.", { vehicle: 'seized', radius: 12, maxDamage: 0.6, damageFail: 'The tipper is too smashed to work.' }),
      S.say([
        ['MAMA', 'Ha! Let them auction the air.'],
        ['SHERA', 'Mama, Kadam will know it was us.'],
        ['MAMA', 'Kadam knows everything. Knowing is free. Proving costs money.'],
      ]),
    ],
  },
  {
    id: 'c6', giver: 'TIGER', title: 'नदीकाठची शर्यत', subtitle: 'RIVER RIGHTS', reward: 3500, requires: ['c5'],
    start: P.gandhiPutla,
    steps: g => {
      const cps = routeCheckpoints(g, [P.gandhiPutla, P.ghatBridge, P.dam], 320);
      return [
        S.call(c => {
          kerbSpawn(c, 'racer', 'hatch', P.gandhiPutla, { dx: 4, label: 'your car', color: 0xd62f2f });
          const t = driverAs(kerbSpawn(c, 'tiger', 'suv', P.gandhiPutla, { dx: 12, label: 'Tiger', color: 0x111111, driver: true }), LOOK.tiger);
          const r = kerbSpawn(c, 'rival', 'bike', P.gandhiPutla, { dx: 18, label: "Tiger's boy", driver: true });
          t.blip = '#ff5c5c'; r.blip = '#ff9e80';
        }),
        S.say([
          ['TIGER', "So you're Mama's new boy. I'm Tiger. Upstream, every boat is mine."],
          ['TIGER', 'From here, over the Govardhan bridge, to Vishnupuri Dam. Win, and Mama keeps the river this season. Lose, and it is mine.'],
          ['MAMA_PH', 'Win this, Patil, and you get a share of every boat.'],
          ['YOU', 'Try to keep up, Tiger.'],
        ], { block: true }),
        S.enter('racer', 'Get in <b>your car</b>.'),
        S.wait(1),
        S.race(cps, ['tiger', 'rival'], 'Win the race to <b>Vishnupuri Dam</b>.'),
        S.say([['TIGER', 'This river has a long memory, Patil.']]),
      ];
    },
  },
  {
    id: 'c7', giver: 'MAMA', title: 'कांदा एक्सप्रेस', subtitle: 'ONION EXPRESS', reward: 0, passText: 'माल पोलिसांकडे · THE LOAD IS WITH THE POLICE', requires: ['c6'],
    start: { x: P.ghat.x - 3, z: P.ghat.z + 3 },
    steps: g => [
      S.call(c => {
        const at = c.roadPoint(P.ghat.x, P.ghat.z, 1);
        nearPed(c, 'mama', 'man', at, 2.5, 2, {}); dress(c.ent.mama.h.outfit, LOOK.mama);
        ghatScene(c);
      }),
      S.say([
        ['MAMA', 'A tempo of onions is coming in from the Telangana side, through Degloor Naka. Under the onions… don\'t ask.'],
        ['YOU', "Sand I can live with, Mama. What's under the onions?"],
        ['MAMA', 'Ganja. Two hundred kilos, Odisha to Mumbai, and Nanded is on the way. Take it to my godown at Taroda Naka and half your father\'s debt is gone tonight.'],
      ], { block: true }),
      S.goTo(P.degloor, 'Go to <b>Degloor Naka</b>.', { radius: 14, stop: false }),
      S.call(c => kerbSpawn(c, 'onions', 'tempo', P.degloor, { dx: 6, label: 'onion tempo', color: 0x7b5e3b })),
      S.enter('onions', 'Get in the <b>onion tempo</b>.'),
      S.call(c => {
        // Coming in behind you on the Telangana road (the way the tempo came), on the carriageway
        // you are about to take: not in the back lane behind the shops, where he could only rock.
        driverAs(kerbSpawn(c, 'tigerCar', 'suv', P.degloor, { dx: 62, dz: 45, label: "Tiger's SUV", color: 0x111111, driver: true }), LOOK.tiger);
      }),
      S.hunters(['tigerCar']),
      S.chat([['TIGER', "Mama's onions? Let's see how they bounce!"]]),
      S.goTo(P.oldMondha, 'Head west for Taroda Naka, through the <b>old city</b>.', { vehicle: 'onions', radius: 40, stop: false, maxDamage: 0.75, damageFail: 'The tempo is wrecked and the load is all over the road.' }),
      S.say([
        ['KADAM_PH', 'Sunny Patil. Inspector Kadam. I know whose tempo you are driving, and what is under the onions.'],
        ['KADAM_PH', 'Two hundred kilos is an NDPS case: ten years for the driver. Bring it to Vazirabad Police Station and walk away, and I forget your face.'],
        ['YOU', "…Baba didn't raise a ganja runner."],
      ]),
      S.goTo(P.police, 'Drive the tempo to <b>Vazirabad Police Station</b>.', { vehicle: 'onions', radius: 9, maxDamage: 0.75, damageFail: 'The tempo is wrecked and the load is all over the road.' }),
      S.leave('Get out and leave the tempo with the police.'),
      S.call(c => {
        const t = c.ent.tigerCar;
        if (t) { t.hunt = null; t.blip = null; c.g.controls.delete(t); }
        c.g.police.clear();
        nearPed(c, 'kadam', 'police', c.g.player.pos, 3, 2, {});
      }),
      S.say([
        ['KADAM', 'Two hundred kilos. Good choice, Patil. Mama will not think so.'],
        ['YOU', 'Mama will think Tiger tipped you off.'],
        ['KADAM', 'Then let him think it. Keep your phone on.'],
      ]),
    ],
  },
  {
    id: 'c8', giver: 'ANNA', title: 'हफ्ता', subtitle: 'PROTECTION MONEY', reward: 2500, requires: ['c7'],
    start: { x: P.workshop.x + 4, z: P.workshop.z + 4 },
    steps: g => [
      S.call(c => kerbSpawn(c, 'annaCar', 'hatch', P.workshop, { dx: 6, label: "Anna's car", color: 0xb71c1c })),
      S.say([
        ['ANNA', "Sunny, Shera's boys came this morning. \"Hafta\": five thousand a week, or the garage burns. Mama's orders, they said."],
        ['ANNA', 'Half the shops in the Old Mondha lanes already pay. Today they are collecting there.'],
        ['YOU', 'Not any more.'],
        ['ANNA', 'Then take my car. And bring it back with all four wheels.'],
      ], { block: true }),
      S.enter('annaCar', "Take <b>Anna's car</b>."),
      S.goTo(P.oldMondha, 'Drive to the <b>Old Mondha</b> lanes.', { vehicle: 'annaCar', radius: 14, stop: false }),
      S.call(c => {
        const at = c.roadPoint(P.oldMondha.x - 8, P.oldMondha.z, 1);
        for (let i = 0; i < 3; i++) nearPed(c, `g${i}`, 'goon', at, Math.cos(i * 2.1) * 2.5, Math.sin(i * 2.1) * 2.5, {});
        nearPed(c, 'shera', 'goon', at, 5, 3, {}); dress(c.ent.shera.h.outfit, LOOK.shera);
      }),
      S.say([['SHERA', 'Look who it is. Mama\'s golden boy. Come to pay your hafta, Patil?'], ['YOU', 'Came to collect, Shera.']]),
      S.fight(['g0', 'g1', 'g2'], "Beat <b>Shera's boys</b>."),
      S.call(c => {
        const s = c.ent.shera;
        if (s) { c.g.peds.remove(s); delete c.ent.shera; }
        // He sprints to his bike up the lane and is already moving off.
        driverAs(kerbSpawn(c, 'sheraBike', 'bike', P.oldMondha, { dx: 30, label: 'Shera', color: 0x151515, driver: true }), LOOK.shera);
      }),
      S.say([['SHERA', 'Mama will skin you alive, Patil!']]),
      S.enter('annaCar', "Shera is getting away! Back in <b>Anna's car</b>."),
      S.chase('sheraBike', P.latur, 'Run <b>Shera</b> down.', { driverAs: 'sheraMan', rams: 3 }),
      S.fight(['sheraMan'], 'Make <b>Shera</b> talk.', { sheraMan: 3 }),
      S.say([
        ['SHERA', 'Okay! Okay! Mama thinks Tiger tipped off the police about the ganja.'],
        ['SHERA', "And Savkar? Savkar is nothing. Every loan in his diary is Mama's sand money."],
        ['YOU', 'Mama and Savkar. One snake, two heads.'],
        ['SHERA', "The ledger is in Savkar's safe. Mama's name on every page. Now let me go!"],
      ]),
    ],
  },
  {
    id: 'c9', giver: 'PAKYA', title: 'तिजोरी', subtitle: 'THE LEDGER', reward: 3000, requires: ['c8'],
    start: { x: P.zenda.x + 6, z: P.zenda.z - 6 }, // a few steps from where Continue puts you, not under you
    steps: g => [
      S.call(c => {
        kerbSpawn(c, 'auto', 'auto', P.zenda, { dx: 6, label: "Pakya's auto", color: 0x1d1d1d });
        nearPed(c, 'pakya', 'man', c.g.player.pos, 2, 1.5, {}); dress(c.ent.pakya.h.outfit, LOOK.pakya);
      }),
      S.say([
        ['PAKYA', "It's Diwali, bhau. Savkar's boys are full of sweets and liquor, and the old city is full of crackers. Nobody will hear a thing."],
        ['PAKYA', 'The ledger is in his safe. Forty families\' debts, Mama\'s name on every page. And your Baba\'s land papers.'],
        ['PAKYA', 'You drive, I keep watch. You go in the back. Then we vanish.'],
      ], { block: true }),
      S.enter('auto', "Get in <b>Pakya's auto</b>."),
      S.call(c => {
        const p = c.ent.pakya;
        if (p) { const outfit = p.h.outfit; c.g.peds.remove(p); delete c.ent.pakya; c.g.vehicles.addPassenger(c.ent.auto, outfit); }
      }),
      S.goTo(P.oldMondha, "Drive to <b>Savkar's office</b>.", { vehicle: 'auto', radius: 9 }),
      S.leave('Leave the auto with Pakya and go in on foot.'),
      S.call(c => {
        const at = c.roadPoint(P.oldMondha.x + 14, P.oldMondha.z + 6, -1);
        c.vars.door = { x: at.x, z: at.z };
        for (let i = 0; i < 2; i++) nearPed(c, `guard${i}`, 'goon', at, 1.5 + i * 2, 1.5, {});
      }),
      S.goTo(c => c.vars.door, "Sneak to <b>Savkar's back door</b>.", { radius: 3, onFoot: true }),
      S.fight(['guard0', 'guard1'], 'Deal with the <b>guards</b>.'),
      S.say([['YOU', "The safe… stamp papers, the diary — the ledger. And Baba's 7/12 papers!"], ['PAKYA', 'Bhau! Savkar called his people! Run!']]),
      S.call(c => {
        c.g.police.setLevel(1);
        kerbSpawn(c, 'savkarCar', 'sedan', P.oldMondha, { dx: 50, label: "Savkar's men", color: 0xeeeeee, driver: true });
      }),
      S.hunters(['savkarCar']),
      S.enter('auto', "Back to <b>Pakya's auto</b>!"),
      S.escape(1, "Lose the police and Savkar's men."),
      S.goTo(P.workshop, "Lie low at <b>Anna's garage</b>.", { vehicle: 'auto', radius: 8 }),
      S.call(c => { const v = c.ent.savkarCar; if (v) { v.hunt = null; v.blip = null; c.g.controls.delete(v); } }),
      S.say([['KADAM_PH', "Patil. I hear Savkar's office had visitors. If you found something with Mama's name in it, bring it to Vazirabad Police Station."], ['KADAM_PH', 'Until then, stay alive.']]),
    ],
  },
  {
    id: 'c10', giver: 'KADAM', title: 'गोदावरी', subtitle: 'GODAVARI', reward: 10000, requires: ['c9'],
    start: { x: P.police.x + 3, z: P.police.z + 3 },
    steps: g => [
      S.call(c => { nearPed(c, 'kadam', 'police', c.g.player.pos, 2, 2, {}); }),
      S.say([
        ['KADAM', "So this is Savkar's famous ledger. His loans… and Mama's sand money in every column."],
        ['KADAM', 'With this, the seized tipper and a tempo of "onions", I can finally—'],
        ['MAMA_PH', 'Patil. Your auto-wala friend is with me at the ghat. Bring what you took. Alone. And hurry.'],
        ['KADAM', "Go. Take my car. I'll follow with the station — quietly."],
      ], { block: true }),
      S.call(c => kerbSpawn(c, 'car', 'sedan', P.police, { dx: 6, label: "Kadam's car", color: 0x2a2f36 })),
      S.enter('car', "Take <b>Kadam's car</b>."),
      S.goTo(P.ghat, 'Get to the <b>sand ghat</b> below the Govardhan bridge.', { radius: 16, stop: false, timer: 200, timerFail: "Mama didn't wait." }),
      S.call(c => {
        const at = c.roadPoint(P.ghat.x, P.ghat.z, 1);
        nearPed(c, 'mama', 'man', at, 7, 2, {}); dress(c.ent.mama.h.outfit, LOOK.mama); // by Pakya, out in the open
        nearPed(c, 'pakya', 'man', at, 8, 4, {}); dress(c.ent.pakya.h.outfit, LOOK.pakya);
        for (let i = 0; i < 4; i++) nearPed(c, `g${i}`, 'goon', at, 2 + Math.cos(i * 1.6) * 3, 3 + Math.sin(i * 1.6) * 3, {});
        ghatScene(c);
      }),
      S.say([
        ['MAMA', 'You know what this river does to people who cross me, Patil? It keeps them.'],
        ['YOU', 'It keeps a lot of things, Mama. Tonight it gives some back.'],
        ['PAKYA', 'Bhau! Hit them!'],
      ]),
      S.fight(['g0', 'g1', 'g2', 'g3'], "Take down <b>Mama's men</b>."),
      S.call(c => {
        const m = c.ent.mama;
        if (m) { c.g.peds.remove(m); delete c.ent.mama; }
        // His SUV waits up the bank, clear of the fight, its engine running.
        driverAs(kerbSpawn(c, 'mamaCar', 'suv', P.ghat, { dx: -30, label: 'Mama', color: 0xf7f7f7, driver: true }), LOOK.mama);
      }),
      S.say([['MAMA', 'Useless! All of you!']]),
      S.enter('car', "Mama is running! Back in <b>Kadam's car</b>."),
      S.chase('mamaCar', P.dam, 'Run <b>Mama</b> off the road.', { driverAs: 'mamaMan', rams: 4 }),
      S.fight(['mamaMan'], 'Finish it.', { mamaMan: 3 }),
      // Kadam arrives with the whole station. A new name: the Kadam left at the station is still
      // the mission's, and goes when it ends.
      S.call(c => { c.g.police.clear(); nearPed(c, 'kadam2', 'police', c.g.player.pos, 3, 3, {}); }),
      S.say([
        ['KADAM', "That's enough, Patil!"],
        ['KADAM', "Jaggu Mama: illegal mining, a stolen seized tipper, two hundred kilos of ganja, and forty families' debts in one ledger. You're coming with me."],
        ['MAMA', 'Do you know who I am, Kadam?'],
        ['KADAM', "Yes. That's why I brought the whole station. Savkar's office is being sealed as we speak."],
        ['KADAM', "Patil — your father's land papers stay with your father."],
        ['YOU', 'And me, saheb?'],
        ['KADAM', 'You stole bikes, ran sand and smashed up half the old city. …I will think about it. Go home.'],
      ], { block: true }),
    ],
    onPass: g => setTimeout(() => g.hud.big('THE END', 'Free roam: the city is yours', 'title', 6), 5200),
  },
];
