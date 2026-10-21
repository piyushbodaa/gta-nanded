// The story: "Ghar Wapasi". All characters and events are fictional; real
// places appear as public settings only and imply no endorsement.
import * as THREE from 'three';
import { Steps as S } from './missions.js';
import { dist, headingTo } from '../core/math.js';

export const CHARACTERS = {
  YOU: { name: 'Sunny', color: '#ffffff' },
  PAKYA: { name: 'Pakya', color: '#7fd1ff', initial: 'P', markerColor: 0x7fd1ff },
  ANNA: { name: 'Anna', color: '#ffb347', initial: 'A', markerColor: 0xffb347 },
  PRIYA: { name: 'Priya', color: '#ff8fb1', initial: 'Pr', markerColor: 0xff8fb1 },
  VICKY: { name: 'Vicky Deshmukh', color: '#ff5c5c', initial: 'V', markerColor: 0xff5c5c },
  KADAM: { name: 'Inspector Kadam', color: '#c3e88d', initial: 'K' },
  AAI: { name: 'Aai (phone)', color: '#e0c3fc' },
  PAAJI: { name: 'Gurpreet Paaji', color: '#ffd27a', initial: 'G', markerColor: 0xffd27a },
  GOON: { name: 'Goon', color: '#ff9e80' },
  PAANWALA: { name: 'Paan-wala', color: '#b9f6ca' },
};

export const HOME = { x: -935.4, z: -1834.1, name: 'Zenda Chowk' };
export const HOSPITAL = { x: 76.3, z: 270, name: 'SGGS Civil Hospital' };
export const POLICE_STATION = { x: 195.9, z: 401.1, name: 'Vazirabad Police Station' };
export const GARAGE = { x: -299.8, z: -1113.2, name: "Anna's Rang Garage" };

const P = {
  station: { x: 5.3, z: 10.9 }, zenda: { x: -935.4, z: -1834.1 }, workshop: GARAGE, tarodaNaka: { x: -564.7, z: -1381.4 },
  sarafa: { x: 544.4, z: 605.3 }, hingoliGate: { x: 290.5, z: -31.7 }, phule: { x: -261.5, z: -397.1 }, visava: { x: -257.4, z: -491.6 },
  iib: { x: 6.7, z: -922.8 }, tajPatil: { x: -287.9, z: -508.7 }, gandhiPutla: { x: 112.2, z: 417.8 }, ghatBridge: { x: -96.4, z: 804.4 },
  dam: { x: -1350.3, z: 1990.4 }, newMondha: { x: 354.1, z: -141.3 }, langar: { x: 264.5, z: 668.1 }, hazur: { x: 450.8, z: 462.2 }, fort: { x: 811.5, z: 1014.9 },
};

/** Spawn a vehicle at the kerb near a point, facing along the street. */
function kerbSpawn(c, name, type, at, opts = {}) {
  const rp = c.roadPoint(at.x + (opts.dx || 0), at.z + (opts.dz || 0), opts.side ?? 1);
  return c.spawnVehicle(name, type, rp.x, rp.z, rp.heading, opts);
}
function nearPed(c, name, kind, at, dx, dz, opts = {}) { return c.spawnPed(name, kind, at.x + dx, at.z + dz, opts); }

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

export const STORY = [
  {
    id: 'm1', giver: 'PAKYA', title: 'घरवापसी', subtitle: 'WELCOME HOME', reward: 500,
    start: P.station,
    steps: g => [
      S.call(c => {
        kerbSpawn(c, 'auto', 'auto', P.station, { dx: 6, label: "Pakya's auto", color: 0x1d1d1d });
        const a = c.ent.auto;
        nearPed(c, 'pakya', 'man', { x: a.x, z: a.z }, -Math.cos(a.heading) * 1.6, Math.sin(a.heading) * 1.6, { outfit: { shirt: 0x3f88c5, sleeve: 0x3f88c5, pants: 0x2b2b2b }, heading: a.heading + Math.PI / 2 });
        c.ent.pakya.blip = '#7fd1ff';
        // Sunny turns toward the auto; Pakya turns to greet him.
        const me = c.g.player;
        me.heading = headingTo(me.x, me.z, a.x, a.z); me.human.yaw = me.heading;
        c.ent.pakya.h.yaw = headingTo(c.ent.pakya.h.x, c.ent.pakya.h.z, me.x, me.z);
      }),
      S.say([
        ['PAKYA', 'Sunny Bhau! The Pune-wala hero is back in Nanded!'],
        ['YOU', 'Pakya! You still drive this kachra rickshaw?'],
        ['PAKYA', 'Kachra? This is a Mercedes, bhau. A black-yellow Mercedes.'],
        ['PAKYA', 'My back is finished from passengers. You drive — home to Zenda Chowk. Aai is waiting with poha.'],
      ], {
        block: true,
        // A crane shot: high over the station forecourt, settling behind Sunny.
        shot: c => {
          const me = c.g.player, a = c.ent.auto;
          const mx = (me.x + a.x) / 2, mz = (me.z + a.z) / 2;
          const away = Math.atan2(me.x - 5, me.z + 4); // from the station toward the forecourt
          const dx = Math.sin(away), dz = Math.cos(away);
          return {
            from: new THREE.Vector3(mx + dx * 34 - dz * 12, 19, mz + dz * 34 + dx * 12),
            to: new THREE.Vector3(mx + dx * 9 - dz * 3, 3.2, mz + dz * 9 + dx * 3),
            look: new THREE.Vector3(mx - dx * 4, 2.2, mz - dz * 4),
            duration: 11,
          };
        },
      }),
      S.enter('auto', "Get in Pakya's <b>auto</b>. <i>(F)</i>"),
      S.call(c => {
        const p = c.ent.pakya;
        if (p) { c.g.peds.remove(p); delete c.ent.pakya; }
        c.g.vehicles.addPassenger(c.ent.auto, Object.assign(c.g.peds.randomOutfit(), { shirt: 0x3f88c5, sleeve: 0x3f88c5, pants: 0x2b2b2b, kind: 'man', flags: new Set() }));
        c.g.hud.help('Hold <kbd>W</kbd> to drive, <kbd>A</kbd>/<kbd>D</kbd> to steer, <kbd>S</kbd> to brake and reverse, <kbd>Space</kbd> for the handbrake. Follow the yellow route on the radar.', 9);
      }),
      S.goTo(P.zenda, 'Drive Pakya to <b>Zenda Chowk</b>, Taroda Khurd.', {
        vehicle: 'auto', radius: 7,
        chatter: [
          [0.93, [['PAKYA', 'Hazur Sahib is behind us. On Gurpurab the whole old city glows gold.']]],
          [0.7, [['PAKYA', 'Keep left, bhau! This is Nanded, not Pune. Here the horn is the indicator.']]],
          [0.55, [['PAKYA', 'This side is the coaching zone. Half of Maharashtra comes here for NEET and JEE.'], ['YOU', 'And the other half?'], ['PAKYA', 'Sells them vada-pav.']]],
          [0.3, [['PAKYA', 'Workshop Corner. Anna was asking about you. He has "work".'], ['YOU', 'Anna always has "work".']]],
          [0.08, [['PAKYA', 'Zenda Chowk! Your galli, bhau. Nothing changes here.']]],
        ],
      }),
      S.say([
        ['AAI', 'Sunny! Are you coming or should I give your poha to the dog?'],
        ['YOU', "Coming, Aai! Two minutes!"],
        ['PAKYA', 'Go, go. And bhau — meet Anna at Workshop Corner. And that Joshi girl, Priya, was asking for you near Visava Garden.'],
      ]),
    ],
    onPass: g => g.hud.help('New contacts are marked on your radar and map (<kbd>M</kbd>) with their initials. Walk into a marker to start.', 9),
  },
  {
    id: 'm2', giver: 'ANNA', title: 'चहा आणि राडा', subtitle: 'CHAI & CHAOS', reward: 800, requires: ['m1'],
    start: { x: P.workshop.x, z: P.workshop.z },
    steps: g => [
      S.say([
        ['ANNA', 'Sunny! Pune made you thin, re.'],
        ['ANNA', "Listen. Vicky Deshmukh's boys took my Tejas bike right out of my garage. Called it 'protection money'."],
        ['YOU', "Vicky Deshmukh? The neta's son? Still playing goonda?"],
        ['ANNA', 'Worse. Now he has a white SUV and a "BOSS" sticker. His boys sit at Taroda Naka. Bring my bike back. Use your hands, not your mouth.'],
      ], { block: true }),
      S.goTo(P.tarodaNaka, 'Go to <b>Taroda Naka</b>.', { radius: 16, stop: false }),
      S.call(c => {
        const b = kerbSpawn(c, 'bike', 'bike', P.tarodaNaka, { dx: 8, label: "Anna's Tejas", color: 0xb71c1c });
        for (let i = 0; i < 3; i++) nearPed(c, `g${i}`, 'goon', { x: b.x, z: b.z }, Math.cos(i * 2.1) * 2.4, Math.sin(i * 2.1) * 2.4, { pose: 'idle' });
      }),
      S.say([['GOON', 'Ae hero! Anna sent you? Go home before you get hurt.'], ['YOU', 'Funny. Anna said the same about you.']]),
      S.fight(['g0', 'g1', 'g2'], "Beat up Vicky's boys. <i>(Click / J to punch)</i>"),
      S.enter('bike', "Take back <b>Anna's bike</b>."),
      S.goTo(P.workshop, 'Ride it back to <b>Workshop Corner</b>.', { vehicle: 'bike', radius: 7 }),
      S.say([
        ['ANNA', 'My Tejas! Not a scratch. Well… a few scratches.'],
        ['ANNA', "Here's your money. And remember: if the police are on your tail, drive into my garage. New colour, new number plate, no questions."],
      ]),
    ],
    onPass: g => { g.save.data.garage = true; g.save.flush(); g.hud.help("Anna's <b>Rang Garage</b> is open: drive in while wanted to lose the police for ₹250 (it also repairs your ride).", 9); },
  },
  {
    id: 'm3', giver: 'ANNA', title: 'गुटखा एक्सप्रेस', subtitle: 'GUTKHA EXPRESS', reward: 1500, requires: ['m2'],
    start: { x: P.workshop.x + 4, z: P.workshop.z + 4 },
    steps: g => [
      S.say([
        ['ANNA', 'Small job, Sunny. My friend at Old Mondha has some "supari" boxes for two paan shops.'],
        ['YOU', 'Supari. Of course.'],
        ['ANNA', "Don't ask, don't open, don't get caught. That stuff is banned in Maharashtra, haan."],
      ], { block: true }),
      S.goTo(P.sarafa, 'Go to <b>Old Mondha</b> in the old city.', { radius: 10, stop: false }),
      S.call(c => kerbSpawn(c, 'tempo', 'tempo', P.sarafa, { dx: 6, label: 'tempo', color: 0xf2f2f2 })),
      S.enter('tempo', 'Get in the <b>tempo</b>.'),
      S.goTo(P.hingoliGate, 'Deliver to the paan shop at <b>Hingoli Gate</b>.', { vehicle: 'tempo', radius: 7, timer: 200, timerFail: 'The paan shops shut for the day.' }),
      S.say([['PAANWALA', "Anna's boy? Wah. But careful — there's a police checkpost on the next road."]]),
      S.call(c => { c.g.hud.big('WANTED', 'The checkpost spotted the tempo', 'wanted', 2.5); }),
      S.escape(2, 'Lose the cops — or get a respray at <b>Anna\'s Rang Garage</b>.'),
      S.goTo(P.phule, 'Deliver the last boxes at <b>Phule Market</b>.', { vehicle: 'tempo', radius: 7, timer: 200, timerFail: 'The paan shops shut for the day.' }),
      S.say([['PAANWALA', 'Perfect timing. Tell Anna his "supari" is the best in Nanded.'], ['YOU', "I'm telling Anna nothing."]]),
    ],
  },
  {
    id: 'm4', giver: 'PRIYA', title: 'मॉक टेस्ट', subtitle: 'MOCK TEST MAYHEM', reward: 1000, requires: ['m1'],
    start: P.visava,
    steps: g => [
      S.call(c => {
        kerbSpawn(c, 'scooty', 'scooter', P.visava, { dx: 5, label: "Priya's scooty", color: 0xe53935 });
        nearPed(c, 'priya', 'student', P.visava, 2, 1.5, { outfit: { flags: new Set(['kurta', 'bun', 'pack']), shirt: 0xff8fb1, sleeve: 0xff8fb1, pants: 0xf2f2f2, legs: 0xf2f2f2, extra: 0x1f3a93 }, pose: 'phone' });
        c.ent.priya.blip = '#ff8fb1';
      }),
      S.say([
        ['PRIYA', 'Sunny? Sunny Patil from seventh standard? Never mind. Do you have a vehicle?'],
        ['YOU', 'I have… charm.'],
        ['PRIYA', "I have a NEET mock test at IIB Parnakuti in a minute and a half. My scooty won't start for me. Maybe it likes boys. Drive!"],
      ], { block: true }),
      S.enter('scooty', "Get on <b>Priya's scooty</b>."),
      S.call(c => {
        const p = c.ent.priya;
        if (p) { const outfit = p.h.outfit; c.g.peds.remove(p); delete c.ent.priya; c.g.vehicles.addPassenger(c.ent.scooty, outfit); }
        c.ent.scooty.lastImpact = 0;
      }),
      guarded(S.goTo(P.iib, 'Get Priya to <b>IIB Parnakuti</b> before the test starts!', {
        vehicle: 'scooty', radius: 7, timer: 95, timerFail: 'Priya missed her mock test.',
        chatter: [
          [0.85, [['PRIYA', 'Faster! Physics starts at ten sharp!']]],
          [0.6, [['PRIYA', 'LEFT! The other left!']]],
          [0.35, [['PRIYA', "If I get AIR 47, it's because of you. If I fail, also because of you."]]],
        ],
      }), c => {
        const v = c.ent.scooty;
        if (v && v.lastImpact > 7) return 'fail:Priya fell off. She is taking an auto — and not talking to you.';
        if (v) v.lastImpact = 0;
        return null;
      }),
      S.say([['PRIYA', "Made it! You're a menace on wheels, Patil. Thank you."], ['YOU', 'Best of luck. Bring me a laddoo when you top.']]),
    ],
  },
  {
    id: 'm5', giver: 'ANNA', title: 'बॉसची गाडी', subtitle: "THE BOSS'S SUV", reward: 2500, requires: ['m3', 'm4'],
    start: { x: P.workshop.x - 4, z: P.workshop.z - 4 },
    steps: g => [
      S.say([
        ['ANNA', 'Vicky came here this morning. Kicked my toolbox. Called me "buddha".'],
        ['ANNA', 'His white SUV is parked outside Hotel Taj Patil while he gives a speech at ITI Corner.'],
        ['ANNA', "Bring that SUV to my garage. In one piece. I'll give it a… makeover."],
      ], { block: true }),
      S.goTo(P.tajPatil, 'Go to <b>Hotel Taj Patil</b>, ITI Corner.', { radius: 18, stop: false }),
      S.call(c => {
        const v = kerbSpawn(c, 'boss', 'suv', P.tajPatil, { dx: -6, label: "Vicky's SUV", color: 0xf7f7f7, driver: true });
        v.vital = true; v.vitalMsg = "Vicky's SUV was wrecked.";
        nearPed(c, 'guard', 'goon', { x: v.x, z: v.z }, 2.5, 2.5, {});
      }),
      S.enter('boss', "Steal <b>Vicky's SUV</b>."),
      S.call(c => {
        c.g.police.setLevel(2);
        const rp = c.roadPoint(P.tajPatil.x + 30, P.tajPatil.z + 10, 1);
        const h = c.spawnVehicle('chaser', 'suv', rp.x, rp.z, rp.heading, { color: 0x111111, driver: true, label: "Vicky's boys" });
        c.g.vehicles.addPassenger(h, Object.assign(c.g.peds.randomOutfit(), { kind: 'goon' }));
      }),
      S.hunters(['chaser']),
      S.say([['VICKY', 'Who touched my gaadi?! Whoever you are, you are DEAD!']]),
      S.goTo(P.workshop, "Take the SUV to <b>Anna's garage</b> — keep it in one piece.", { vehicle: 'boss', radius: 8, maxDamage: 0.55, damageFail: "Vicky's SUV is too smashed to sell." }),
      S.say([['ANNA', 'Beautiful. By tomorrow it will be a Pune taxi. Here, your share.']]),
      S.call(c => { c.g.police.clear(); }),
    ],
  },
  {
    id: 'm6', giver: 'VICKY', title: 'पुलावरची शर्यत', subtitle: 'THE BRIDGE RACE', reward: 3000, requires: ['m5'],
    start: P.gandhiPutla,
    steps: g => {
      const cps = routeCheckpoints(g, [P.gandhiPutla, P.ghatBridge, P.dam], 320);
      return [
        S.call(c => {
          const a = kerbSpawn(c, 'racer', 'hatch', P.gandhiPutla, { dx: 4, label: 'your race car', color: 0xd62f2f });
          const v = kerbSpawn(c, 'vicky', 'suv', P.gandhiPutla, { dx: 12, label: 'Vicky', color: 0xf7f7f7, driver: true });
          const r2 = kerbSpawn(c, 'rival', 'bike', P.gandhiPutla, { dx: 18, label: 'a rival bike', driver: true });
          v.blip = '#ff5c5c'; r2.blip = '#ff9e80'; void a;
        }),
        S.say([
          ['VICKY', 'So you are the Pune-wala who stole my car. Fine. Race me. Vazirabad to Vishnupuri Dam, over the Govardhan Ghat bridge.'],
          ['VICKY', 'You win, I forget the car. I win, you work for me. For life.'],
          ['YOU', 'Deal. Try to keep up, Deshmukh.'],
        ], { block: true }),
        S.enter('racer', 'Get in <b>your race car</b>.'),
        S.wait(1),
        S.race(cps, ['vicky', 'rival'], 'Win the race to <b>Vishnupuri Dam</b>.'),
        S.say([['VICKY', 'You cheated! …Fine. A deal is a deal. For now.']]),
      ];
    },
  },
  {
    id: 'm7', giver: 'PAAJI', title: 'लंगर सेवा', subtitle: 'LANGAR SEVA', reward: 0, passText: 'सेवा पूर्ण · FULL HEALTH · RESPECT +', requires: ['m2'],
    start: P.hazur,
    steps: g => [
      S.say([
        ['PAAJI', 'Sat Sri Akal, puttar! Pakya says you drive like the wind.'],
        ['PAAJI', 'The langar is short of atta for the evening sangat. The sacks are waiting at New Mondha.'],
        ['PAAJI', 'Bring the tempo to Gurudwara Langar Sahib. Gently — no broken sacks, and no racing near the sangat.'],
      ], { block: true }),
      S.goTo(P.newMondha, 'Go to <b>New Mondha</b>.', { radius: 12, stop: false }),
      S.call(c => kerbSpawn(c, 'tempo', 'tempo', P.newMondha, { dx: 6, label: 'flour tempo', color: 0xfbc02d })),
      S.enter('tempo', 'Get in the <b>flour tempo</b>.'),
      S.goTo(P.langar, 'Drive to <b>Gurudwara Langar Sahib</b>. Gently!', { vehicle: 'tempo', radius: 8, timer: 210, timerFail: 'The sangat waited. Try again.', maxDamage: 0.3, damageFail: 'The atta sacks burst.' }),
      S.say([['PAAJI', 'Waheguru! Right on time. Come, sit with the sangat and eat langar, puttar.'], ['YOU', 'Waheguru ji ka Khalsa, Waheguru ji ki Fateh.']]),
    ],
    onPass: g => { g.player.health = g.player.maxHealth; },
  },
  {
    id: 'm8', giver: 'PRIYA', title: 'कदमांचा सापळा', subtitle: "KADAM'S TRAP", reward: 5000, requires: ['m6', 'm7'],
    start: { x: HOME.x + 4, z: HOME.z + 3 },
    policeLock: true,
    steps: g => [
      S.say([
        ['PRIYA', "Sunny, don't panic. Vicky told Inspector Kadam that YOU stole his SUV and robbed Anna's garage."],
        ['PRIYA', 'Kadam is coming with half the police station. Get to Nandgiri Fort. Pakya is waiting there. I have a plan.'],
        ['KADAM', 'All units: suspect Sunny Patil. Bring him in. Alive, and preferably not on the news.'],
      ], { block: true }),
      S.call(c => { c.g.police.setLevel(3); c.g.police.lock = true; }),
      S.goTo(P.fort, 'Get to <b>Nandgiri Fort</b> in Old Nanded.', { radius: 14, stop: false }),
      S.call(c => {
        c.g.police.lock = false; c.g.police.clear();
        const f = P.fort;
        nearPed(c, 'vicky', 'goon', f, 6, 8, { outfit: { shirt: 0xf7f7f7, sleeve: 0xf7f7f7, pants: 0x111111, legs: 0x111111 } });
        for (let i = 0; i < 3; i++) nearPed(c, `g${i}`, 'goon', f, 3 + i * 2.5, 12, {});
      }),
      S.say([['VICKY', 'You came yourself! You saved me the trouble, Patil.'], ['PAKYA', "Bhau! I'm recording everything! Priya's idea!"]]),
      S.fight(['vicky', 'g0', 'g1', 'g2'], 'Take down <b>Vicky</b> and his boys.', { vicky: 3 }),
      S.say([
        ['KADAM', "Enough! Deshmukh, I heard everything — Pakya's phone, Priya's video, all of it."],
        ['VICKY', 'Do you know who my father is?!'],
        ['KADAM', 'Yes. He is the one who called me to arrest you.'],
        ['KADAM', 'Patil — the SUV goes back. Anna\'s garage gets an inspection. And you: stay out of trouble.'],
        ['YOU', 'In Nanded, saheb? Impossible.'],
      ], { block: true }),
    ],
    onPass: g => setTimeout(() => g.hud.big('TO BE CONTINUED…', 'Free roam: the city is yours', 'title', 6), 5200),
  },
];

/** Run `guard` before a step's own update; a non-null result ends the step. */
function guarded(step, guard) {
  return {
    enter: step.enter, exit: step.exit,
    update(c, dt) { return guard(c, dt) ?? step.update(c, dt); },
  };
}
