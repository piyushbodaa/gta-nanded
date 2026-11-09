// Side jobs (s1-s6): three new fictional contacts with small, satirical troubles, each built on the
// TAIL / ESCORT / DEFEND steps in side-steps.js. Every character and event is fictional; the real
// Nanded places appear as public settings only (junctions, civic buildings, a generic roadside
// handcart) and imply no endorsement. No scene is at a place of worship.
// Side ids go into save.data.story like the c-ids, so done() and requires work unchanged.
import { Steps as S } from './missions.js';
import { CHARACTERS } from './story.js';
import { installSideSteps } from './side-steps.js';
import { headingTo } from '../core/math.js';

installSideSteps(S);

export const SIDE_CHARACTERS = {
  DHONDU: { name: 'Dhondu Jadhav', color: '#b39ddb', initial: 'D', markerColor: 0xb39ddb },
  DHONDU_PH: { name: 'Dhondu (phone)', color: '#b39ddb' },
  RANI: { name: 'Rani Tai', color: '#f48fb1', initial: 'R', markerColor: 0xf48fb1 },
  RANI_PH: { name: 'Rani Tai (phone)', color: '#f48fb1' },
  GOPAL: { name: 'Gopal Kaka', color: '#80cbc4', initial: 'G', markerColor: 0x80cbc4 },
  GOPAL_PH: { name: 'Gopal Kaka (phone)', color: '#80cbc4' },
  DHANNA: { name: 'Dhanna', color: '#ff8a65' },
  DHANNA_PH: { name: 'Dhanna (phone)', color: '#ff8a65' },
  SONU: { name: 'Sonu', color: '#fff59d' },
  MUNIM: { name: 'The munim', color: '#bcaaa4' },
};
// The contacts' names and radar initials. Also belong in story.js CHARACTERS (see the REQUEST);
// until then they are added here, never overwriting one already there.
for (const [k, v] of Object.entries(SIDE_CHARACTERS)) CHARACTERS[k] ??= v;

/** Every place a side job uses (snapped to roads; checked in tests/side.test.js). */
export const SIDE_PLACES = {
  dhondu: { x: 304, z: -35 }, // under the Hingoli Gate overbridge: Jadhav Detective Agency & Xerox
  shyamNagar: { x: -50, z: -806 }, // the coaching lanes, Shyam Nagar
  kusum: { x: -117, z: -556 }, // Kusum Auditorium
  rani: { x: 516, z: -122 }, // Annabhau Sathe Chowk: the papad co-op
  shivaji: { x: 50, z: 208 }, // Shivaji Putla
  busStand: { x: -186, z: 38 }, // Central Bus Stand parcel office
  tapri: { x: -257, z: -486 }, // ITI Corner: Gopal Kaka's chai handcart
  bhagya: { x: -30, z: -982 }, // Bhagya Nagar Kaman
  namaskar: { x: 766, z: -882 }, // Namaskar Chowk: a godown off the airport bypass
  collector: { x: 131, z: 436 }, // District Collector Office
};
const P = SIDE_PLACES;

/** "New side job" help line, shown when a pass opens one (missions.pass, see the REQUEST). */
export const sideUnlockText = def => `New side job: <b>${CHARACTERS[def.giver]?.name || def.giver}</b> (${CHARACTERS[def.giver]?.initial || '!'}) has work for you. Look for the letter on the map.`;

/** A weapon reward on pass: given, and the inventory saved before the pass flushes the save. */
function grant(id, ammo) {
  return g => {
    if (!g.weapons?.give) return;
    g.weapons.give(id, ammo);
    if (g.weapons.toSave) g.save?.set?.('inventory', g.weapons.toSave());
  };
}

/** A vehicle at the kerb near a point, facing along the street. */
function kerb(c, name, type, at, opts = {}) {
  const rp = c.roadPoint(at.x + (opts.dx || 0), at.z + (opts.dz || 0), opts.side ?? 1);
  return c.spawnVehicle(name, type, rp.x, rp.z, rp.heading, opts);
}
/** A contact on the footpath by their spot, facing the player. */
function contact(c, name, at, look, blip) {
  const rp = c.roadPoint(at.x, at.z, 1), off = 2.2;
  const p = c.spawnPed(name, 'man', rp.x + Math.cos(rp.heading) * off, rp.z - Math.sin(rp.heading) * off, {});
  if (look) Object.assign(p.h.outfit, look);
  if (blip) p.blip = blip;
  const me = c.g.player;
  if (p.h && me) p.h.yaw = headingTo(p.h.x, p.h.z, me.x ?? me.pos.x, me.z ?? me.pos.z);
  return p;
}
/** Something for the player to ride, if they came on foot. */
function ride(c, at, type = 'bike') { if (!c.g.player.vehicle) kerb(c, 'ride', type, at, { dx: -10, label: 'the bike', color: 0x8e1b1b }); }

const LOOK = {
  dhondu: { shirt: 0x6d5f4b, sleeve: 0x6d5f4b, pants: 0x3e3a33, legs: 0x3e3a33 },
  rani: { shirt: 0xd81b60, sleeve: 0xd81b60, pants: 0xd81b60, legs: 0xd81b60 },
  gopal: { shirt: 0xf4f1e8, sleeve: 0xf4f1e8, pants: 0x8d6e63, legs: 0x8d6e63 },
  dhanna: { shirt: 0xffffff, sleeve: 0xffffff, pants: 0xffffff, legs: 0xffffff, heavy: 0.9 },
};
const checkpoint = (label, opts) => (S.checkpoint ? [S.checkpoint(label, opts)] : []);

export const SIDE = [
  {
    id: 's1', side: true, giver: 'DHONDU', requires: ['c1'], title: 'पाठलाग', subtitle: 'THE SHADOW', reward: 1200,
    start: { x: P.dhondu.x, z: P.dhondu.z },
    steps: () => [
      S.call(c => {
        contact(c, 'dhondu', P.dhondu, LOOK.dhondu, SIDE_CHARACTERS.DHONDU.color);
        kerb(c, 'sonu', 'scooter', P.dhondu, { dx: 26, driver: true, label: "Sonu's scooty", color: 0xfff176 });
        ride(c, P.dhondu);
      }),
      S.say([
        ['DHONDU', 'Jadhav Detective Agency and Xerox. Detective work upstairs, photocopies two rupees.'],
        ['DHONDU', 'A client thinks his son-in-law Sonu is skipping his MPSC classes. That yellow scooty is Sonu.'],
        ['DHONDU', 'Follow him. Not too close: he has watched every CID episode twice.'],
        ['YOU', 'And you?'],
        ['DHONDU', 'Someone has to mind the Xerox machine.'],
      ], { block: true }),
      S.tail('sonu', [
        { x: P.shyamNagar.x, z: P.shyamNagar.z, wait: 7, lines: [['SONU', 'One sweet paan, no tobacco. I need my voice today.']] },
        { x: P.kusum.x, z: P.kusum.z },
      ], 'Follow <b>Sonu</b>. Keep your distance.'),
      S.say([
        ['SONU', 'Five, six, seven, eight! Lavani-fusion round two, from the top!'],
        ['DHONDU_PH', 'A dance contest? I will tell the client he is "studying cultural affairs". That is in the syllabus.'],
      ]),
    ],
  },
  {
    id: 's2', side: true, giver: 'RANI', requires: ['c2'], title: 'पापड एक्सप्रेस', subtitle: 'PAPAD EXPRESS', reward: 1500,
    weapon: { id: 'pan', ammo: 1 }, onPass: grant('pan', 1),
    start: { x: P.rani.x, z: P.rani.z },
    steps: () => [
      S.call(c => {
        contact(c, 'rani', P.rani, LOOK.rani, SIDE_CHARACTERS.RANI.color);
        kerb(c, 'tempo', 'tempo', P.rani, { dx: 14, driver: true, label: 'papad tempo', color: 0xf8bbd0, props: { vitalMsg: 'The papad tempo was wrecked. Two hundred kilos of papad, crushed.' } });
        ride(c, P.rani);
      }),
      S.say([
        ['RANI', 'Two hundred kilos of papad for the bus stand parcel office. Pune is waiting.'],
        ['RANI', "Dhanna's boys have been ramming our tempo. He wants us to buy his cheaper papad. Cheaper because it is cardboard."],
        ['YOU', 'I will ride along.'],
      ], { block: true }),
      S.escort('tempo', [P.shivaji, P.busStand], 'Escort the <b>papad tempo</b> to the bus stand.', {
        meterLabel: 'TEMPO',
        ambush: [
          { at: 0.25, bikes: 2, from: 'behind', lines: [['RANI_PH', "Bikes behind you! Dhanna's boys!"]] },
          { at: 0.6, bikes: 2, from: 'ahead', lines: [['RANI_PH', 'More of them ahead. Do not let them touch my papad.']] },
        ],
      }),
      S.say([
        ['RANI', 'Every packet whole. Take this, it was my mother-in-law\'s. It has settled more arguments than the panchayat.'],
      ]),
    ],
  },
  {
    id: 's3', side: true, giver: 'GOPAL', requires: ['c3'], title: 'कटिंग चहा', subtitle: 'CUTTING CHAI', reward: 1800,
    weapon: { id: 'uzi', ammo: 75 }, onPass: grant('uzi', 75),
    start: { x: P.tapri.x + 4, z: P.tapri.z + 4 },
    steps: () => [
      S.call(c => { contact(c, 'gopal', P.tapri, LOOK.gopal, SIDE_CHARACTERS.GOPAL.color); }),
      S.say([
        ['GOPAL', 'One cutting? Sit, sit. Forty years at ITI Corner, and now Dhanna wants five hundred a week. Hafta.'],
        ['GOPAL', 'For five hundred I could buy milk for a month. His boys are coming at four.'],
        ['YOU', 'Let them come.'],
      ], { block: true }),
      S.defend(P.tapri, "Protect <b>Gopal Kaka</b>'s tapri.", {
        stallFail: "Dhanna's boys smashed the tapri.",
        waves: [
          { n: 3, lines: [['GOPAL', 'There they are. Same faces as last week, worse moustaches.']] },
          { n: 4, lines: [['GOPAL', 'More! Mind the kettle!']] },
          { n: 4, lines: [['GOPAL', 'Last lot, I think. They ran out of cousins.']] },
        ],
      }),
      S.say([
        ['GOPAL', 'Chai on the house, for life. And this: a customer left it in a bag in 2019. He never came back for his change either.'],
      ]),
    ],
  },
  {
    id: 's4', side: true, giver: 'DHONDU', requires: ['s1', 'c4'], title: 'दुहेरी खेळ', subtitle: 'DOUBLE GAME', reward: 2500,
    weapon: { id: 'kar98k', ammo: 20 }, onPass: grant('kar98k', 20),
    start: { x: P.bhagya.x + 5, z: P.bhagya.z + 5 },
    steps: () => [
      S.call(c => {
        contact(c, 'dhondu', P.bhagya, LOOK.dhondu, SIDE_CHARACTERS.DHONDU.color);
        const rp = c.roadPoint(P.bhagya.x - 28, P.bhagya.z, 1), off = 2.4;
        c.spawnPed('munim', 'man', rp.x + Math.cos(rp.heading) * off, rp.z - Math.sin(rp.heading) * off, { heading: rp.heading });
      }),
      S.say([
        ['DHONDU', 'New client: Dhanna himself. He thinks his munim is cooking the books. So do I. That is him, with the ledger.'],
        ['DHONDU', 'Walk behind him. Look at your phone like everyone else. Nobody sees a man looking at his phone.'],
      ], { block: true }),
      S.tail('munim', [{ x: P.shyamNagar.x, z: P.shyamNagar.z }], 'Follow the <b>munim</b> on foot.', { onFoot: true, near: 7, far: 55, farFor: 8 }),
      ...checkpoint('the coaching lanes', { at: P.shyamNagar }),
      S.call(c => {
        const p = c.ent.munim;
        if (p) { c.g.peds.remove?.(p); delete c.ent.munim; }
        kerb(c, 'auto', 'auto', P.shyamNagar, { dx: 6, driver: true, label: "the munim's auto", color: 0x1d1d1d });
        ride(c, P.shyamNagar);
      }),
      S.chat([['DHONDU_PH', 'He took an auto. Do not lose it, I have already printed the invoice.']]),
      S.tail('auto', [{ x: P.namaskar.x, z: P.namaskar.z }], 'Follow the <b>auto</b>.'),
      S.say([
        ['MUNIM', 'Two ledgers. One for Dhanna, one for me. And one for the income tax people. Three ledgers.'],
        ['DHONDU_PH', 'Three! I will charge Dhanna for all three. Here, take my old camera rifle. A telephoto lens was over budget.'],
      ]),
    ],
  },
  {
    id: 's5', side: true, giver: 'RANI', requires: ['s2', 'c6'], title: 'निवडणूक', subtitle: 'ELECTION SEASON', reward: 3000,
    weapon: { id: 'm416', ammo: 90 }, onPass: grant('m416', 90), policeLock: true,
    onStart: c => { c.g.police && (c.g.police.lock = true); },
    start: { x: P.rani.x + 7, z: P.rani.z - 7 },
    steps: () => [
      S.call(c => {
        contact(c, 'rani', P.rani, LOOK.rani, SIDE_CHARACTERS.RANI.color);
        kerb(c, 'jeep', 'suv', P.rani, { dx: 16, driver: true, label: "Rani Tai's jeep", color: 0xffffff, props: { vitalMsg: "Rani Tai's jeep was wrecked. No nomination this year." } });
        ride(c, P.rani);
      }),
      S.say([
        ['RANI', 'I am standing for ward corporator. Symbol: pressure cooker. It whistles when it is ready, like me.'],
        ['RANI', 'Nominations close at three. Dhanna is standing too, and he does not like competition.'],
        ['YOU', 'Get in the jeep. I am right behind you.'],
      ], { block: true }),
      S.call(c => c.timer(240, 'NOMINATION', 'The nomination window closed.')),
      S.escort('jeep', [P.shivaji, P.collector], "Get <b>Rani Tai</b> to the Collector Office.", {
        speed: 0.55, meterLabel: 'JEEP',
        ambush: [
          { at: 0.15, bikes: 2, from: 'behind', lines: [['RANI_PH', 'Bikes! Already! Not even a manifesto yet!']] },
          { at: 0.45, bikes: 3, gunner: 'p92', from: 'ahead', lines: [['RANI_PH', 'They have guns! This is not a debate!']] },
          { at: 0.75, bikes: 1, type: 'suv', from: 'behind', lines: [['DHANNA_PH', 'Withdraw, Tai. Cooker symbols explode.']] },
        ],
      }),
      S.call(c => c.stopTimer()),
      S.say([
        ['RANI', 'Filed, with four minutes to spare. The clerk said I was the first candidate to arrive with bullet holes.'],
      ]),
    ],
  },
  {
    id: 's6', side: true, giver: 'GOPAL', requires: ['s3', 's4', 's5'], title: 'शेवटचा कप', subtitle: 'LAST CUP', reward: 4000,
    weapon: { id: 'akm', ammo: 120 }, onPass: grant('akm', 120), policeLock: true,
    onStart: c => { c.g.police && (c.g.police.lock = true); },
    start: { x: P.tapri.x - 4, z: P.tapri.z + 4 },
    steps: () => [
      S.call(c => { contact(c, 'gopal', P.tapri, LOOK.gopal, SIDE_CHARACTERS.GOPAL.color); }),
      S.say([
        ['GOPAL', 'Dhanna lost the election, the papad war and his munim. Now he says he is coming himself.'],
        ['GOPAL', 'Stay for one more cup?'],
      ], { block: true }),
      S.defend(P.tapri, "Hold <b>Gopal Kaka</b>'s tapri against Dhanna.", {
        stallFail: "Dhanna's boys smashed the tapri.",
        waves: [
          { n: 3, lines: [['DHANNA_PH', 'Gopal! Last chance. Five hundred, or no more chai.']] },
          { n: 3, armed: 'p92', lines: [['GOPAL', 'Guns? For a tea stall? Behind the cart, quick!']] },
          { n: 2, armed: 'uzi', boss: { name: 'dhanna', hits: 4, look: LOOK.dhanna }, lines: [['DHANNA', 'Fine. I will collect it myself.']] },
        ],
      }),
      S.say([
        ['KADAM_PH', 'I hear Dhanna is in the hospital, and his boys are in my lock-up. I heard nothing else. Stay out of trouble.'],
        ['GOPAL', 'Last cup, son. For you, it is always the first.'],
      ]),
    ],
  },
];
