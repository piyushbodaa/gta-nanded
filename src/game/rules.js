// The rules of the city: crimes and consequences, money, damage, wrecks,
// WASTED and BUSTED, discoveries and photos. Wires the systems together.
import { dist, clamp } from '../core/math.js';
import { speedOf, forwardSpeed } from '../actors/vehicle-physics.js';
import { VEHICLE_TYPES } from '../actors/vehicle-types.js';
import { HOSPITAL, POLICE_STATION } from './story.js';
import { DynamicDriver } from '../actors/traffic.js';
import { driveHunters } from './missions.js';
import { drivingHelp, vehicleKeys } from '../ui/controls.js';

const SHRINES = ['hazur-sahib', 'nagina-ghat', 'langar-sahib', 'sangat-sahib', 'mata-sahib', 'hira-ghat', 'shikar-ghat', 'banda-ghat', 'kaleshwar-temple', 'ram-ghat', 'govardhan-ghat', 'urvashi-ghat'];

export function installRules(g) {
  g.DynamicDriver = DynamicDriver;
  const shrines = SHRINES.map(id => g.city.places.find(p => p.id === id)).filter(Boolean);

  g.addCash = delta => {
    if (!delta) return;
    g.save.cash = g.save.cash + delta;
    g.hud.cashChange(delta);
  };

  g.nearShrine = () => { const p = g.player.pos; return shrines.some(s => dist(s.x, s.z, p.x, p.z) < 70); };

  g.contextAction = () => g.jobs?.contextAction();

  g.playerPunch = player => {
    g.audio.sfx('step', 2);
    const hit = g.peds.punchFrom(player);
    if (hit) {
      g.audio.sfx('punch');
      g.camera.addShake(0.08);
      g.save.stat('punches');
      // The one report of a landed punch (peds.onPedHurt fires for it too). A fight the story
      // picks, with its own enemies, is not a crime.
      if (!hit.mission) g.police.report(hit.cop ? 'hitCop' : 'punch', player.x, player.z, { cop: hit.cop });
    }
  };

  g.pedAttacks = (p, dmg) => {
    if (g.cutscene) return; // the player is held still and can't fight back
    const P = g.player;
    if (P.state !== 'foot' || dist(p.h.x, p.h.z, P.x, P.z) > 1.5) return;
    P.damage(dmg, p.cop ? 'police' : 'fight');
    g.audio.sfx('punch', 0.7);
    g.camera.addShake(0.12);
    // Down long enough to fall before getting up (a shorter one skips the fall: player.js _down).
    if (p.cop && Math.random() < 0.15) P.knockDown(Math.sin(p.h.yaw) * 2, Math.cos(p.h.yaw) * 2, 1.5);
  };

  g.onPedHitByVehicle = (p, v, spd) => {
    if (v.role !== 'player') return;
    g.audio.sfx('crash', 0.3);
    g.police.report(p.cop ? 'hitCop' : 'hitPed', v.x, v.z, { cop: p.cop });
    g.camera.addShake(0.1);
  };

  g.carjack = (v, player) => {
    const h = g.vehicles.ejectDriver(v);
    if (!h) return;
    const door = g.vehicles.doorWorld(v);
    h.x = door.x; h.z = door.z;
    g.peds.adoptEjected(h, v, player);
    g.save.stat('jacked');
    g.audio.sfx('door');
    if (v.type === 'police') g.police.report('hitCop', v.x, v.z, { cop: true });
    else if (v.role === 'traffic' || v.role === 'mission') g.police.report('carjack', v.x, v.z);
    // Passengers bail out too; a police jeep's second officer stays on the job, as when its crew
    // gets out (police._dismount).
    for (const ph of v.passengers.splice(0)) {
      ph.x = door.x + 1; ph.z = door.z + 1; const pp = g.peds._make(ph, ph.x, ph.z, null); pp.state = 'flee'; pp.t = 6;
      if (v.type === 'police' && g.police.level > 0) { Object.assign(pp, { state: 'fight', t: 30, keep: true, cop: true, grudge: 2 }); g.police.foot.push(pp); }
    }
  };

  g.onBeginEnter = v => { if (v.driver && v.ai) { v.ai.wait = 3; } };

  g.onEnteredVehicle = v => {
    g.traffic.cars = g.traffic.cars.filter(c => c !== v);
    const spec = VEHICLE_TYPES[v.type];
    const st = g.audio.radio?.station;
    g.hud.vehicleName(spec.name, `${spec.mr}${st ? ` · 📻 ${st.name}` : ''}`);
    g.audio.sfx('door');
    if (!g.save.data.seenDriveHelp && !g.missions.active) {
      g.save.data.seenDriveHelp = true;
      g.hud.help(`${drivingHelp(g)}<br>${vehicleKeys(g)}`, 8);
    }
  };

  g.onExitedVehicle = (v, spd) => { g.audio.sfx('door'); if (spd > 7) g.camera.addShake(0.3); };

  // Who ran into whom: each car's speed toward the other before this frame's physics (onImpact
  // comes after the bounce; the rules hook notes the speeds just before it). Police units ram the
  // player on purpose, and being rammed is no crime.
  const playerRammed = (v, pv) => {
    const dx = v.x - pv.x, dz = v.z - pv.z, d = Math.hypot(dx, dz) || 1;
    const mine = ((pv.vx0 ?? pv.vx) * dx + (pv.vz0 ?? pv.vz) * dz) / d;
    const theirs = -((v.vx0 ?? v.vx) * dx + (v.vz0 ?? v.vz) * dz) / d;
    return mine > 3 && mine > theirs;
  };

  g.vehicles.onImpact = (v, speed, other) => {
    if (v.role === 'player' || other?.role === 'player') {
      const k = clamp(speed / 20, 0.1, 1);
      if (v.role === 'player') { g.camera.addShake(k * 0.7); g.audio.sfx('crash', k); g.save.stat('crashes'); }
      // (Barging a mission's or a race's own cars is part of the job, not a crime.)
      if (other?.role === 'player' && v.role !== 'mission' && v.role !== 'rival' && playerRammed(v, other)) {
        const fresh = g.time - (v.rammedT ?? -9) > 1; // one shunt (and its bounces) is one crime
        v.rammedT = g.time; // and if it blows up, that's the player's doing too (explode)
        if (fresh && v.type === 'police' && !v.wrecked) g.police.report('ramPolice', v.x, v.z, { cop: true });
      }
      if (speed > 9) g.effects.sparks(v.x, v.y + 0.7, v.z, Math.round(4 + speed * 0.4));
      // Hard hits through the windscreen hurt.
      if (v.role === 'player' && speed > 16 && !v.spec.two) g.player.damage((speed - 16) * 1.6, 'crash');
      if (v.role === 'player' && speed > 8 && v.spec.two) {
        // Off the bike!
        const P = g.player;
        P.leaveVehicle(true);
        P.knockDown(v.vx * 0.5, v.vz * 0.5, 1.6);
        P.damage(8 + speed * 1.4, 'crash');
      }
    }
  };

  // Speed breakers and potholes: a thud and a shake under the player.
  g.vehicles.onBump = (v, speed, hole) => {
    if (v.role !== 'player') return;
    const k = clamp(speed / (hole ? 4 : 6), 0.15, 1);
    g.camera.addShake(k * (hole ? 0.22 : 0.4));
    g.audio.sfx('thud', k);
    if (!hole && speed > 3) g.effects.dust(v.x, v.z, 3, undefined, v.y);
  };

  g.vehicles.onWreck = v => {
    // Fire, then a fireball.
    v.onFire = 0.01;
    v.explodeAt = g.time + (v.role === 'player' ? 3.5 : 2.5);
  };

  // Damage that isn't a crash (a blast, a cow) ends the way a crash's does (Vehicles._impact):
  // below 250 the car catches fire, at nothing it is wrecked and blows up in turn.
  const damaged = v => {
    if (v.wrecked) return;
    if (v.health <= 0) { v.health = 0; v.wrecked = true; v.onFire = 0; g.vehicles.onWreck(v); }
    else if (v.health < 250 && !v.onFire) v.onFire = 0.01;
  };

  const explode = v => {
    v.exploded = true;
    v.onFire = 0;
    g.effects.explosion(v.x, v.y + 0.5, v.z);
    const P = g.player, pos = P.pos;
    const d = dist(pos.x, pos.z, v.x, v.z);
    g.audio.sfx('explosion', 1 / (1 + d / 30)); // a bang down the road, not in your ear
    g.camera.addShake(clamp(1.2 - d / 40, 0, 1.2));
    // The blast throws people and cars away from it, hardest close in, and only on its own level
    // (a car blowing up on a flyover doesn't reach the street below).
    const level = o => Math.abs((o.y || 0) - v.y) < 3;
    if (P.vehicle === v) { P.leaveVehicle(true); P.damage(70, 'explosion'); P.knockDown(Math.random() * 4 - 2, Math.random() * 4 - 2, 2); }
    else if (d < 7 && P.state === 'foot' && level(P)) { const k = (3 + 6 * (1 - d / 7)) / Math.max(d, 0.5); P.damage((7 - d) * 12, 'explosion'); P.knockDown((pos.x - v.x) * k, (pos.z - v.z) * k, 1.5); }
    g.peds.forEachNear(v.x, v.z, 8, p => {
      if (!level(p.h)) return;
      const dx = p.h.x - v.x, dz = p.h.z - v.z, pd = Math.max(0.5, Math.hypot(dx, dz)), k = (3 + 9 * (1 - pd / 8)) / pd;
      g.peds.knock(p, dx * k, dz * k, 3, 'explosion');
    });
    for (const o of g.vehicles.list) {
      if (o === v || !level(o)) continue;
      const od = dist(o.x, o.z, v.x, v.z);
      if (od > 9) continue;
      if (o.kinematic) g.vehicles.wake(o);
      const k = (9 - od) * 1.2;
      o.vx += (o.x - v.x) / Math.max(od, 0.5) * k; o.vz += (o.z - v.z) / Math.max(od, 0.5) * k;
      o.health -= (9 - od) * 60;
      damaged(o);
    }
    // Blowing up a car you rammed is a crime (your own, wrecked by the police or a wall, isn't).
    if (g.time - (v.rammedT ?? -1e9) < 30) g.police.report('wreck', v.x, v.z);
  };

  // Per-frame rules.
  let skidT = 0, smokeT = 0, saveT = 0;
  g.hooks = [dt => {
    const P = g.player;
    g.save.data.stats.playTime += dt;
    if (P.vehicle) g.save.data.stats.distance += speedOf(P.vehicle) * dt;
    driveHunters(g, dt);
    g.jobs.update(dt);
    // Damage effects and wrecks.
    smokeT -= dt;
    for (const v of g.vehicles.list) {
      v.vx0 = v.vx; v.vz0 = v.vz; // speeds before this frame's physics: who rammed whom (onImpact)
      if (v.exploded) continue;
      const near = dist(v.x, v.z, P.pos.x, P.pos.z) < 140;
      if (v.explodeAt && g.time > v.explodeAt) { explode(v); continue; }
      if (!near) continue;
      // Nothing burns under the river (a car that sank is wrecked, but not on fire).
      if (smokeT <= 0 && !(v.sinking > 0.4)) {
        const hx = v.x + Math.sin(v.heading) * v.hd * 0.7, hz = v.z + Math.cos(v.heading) * v.hd * 0.7;
        if (v.onFire || v.wrecked) { for (let k = 0; k < 2; k++) g.effects.fire(hx, v.y + 1.0, hz); g.effects.smoke(hx, v.y + 1.6, hz, 0.12, 1); }
        else if (v.health < 450) g.effects.smoke(hx, v.y + 1.2, hz, v.health < 300 ? 0.2 : 0.55, 1);
      }
      if (v.onFire && !v.wrecked) v.health -= dt * 40;
      damaged(v);
    }
    if (smokeT <= 0) smokeT = 0.08;
    // Skids and tyre smoke for the player's car.
    const v = P.vehicle;
    skidT -= dt;
    if (v && skidT <= 0 && v.slip > 0.28 && speedOf(v) > 5 && !v.spec.two) {
      skidT = 0.035;
      const s = Math.sin(v.heading), c = Math.cos(v.heading);
      for (const side of [-1, 1]) {
        const x = v.x - s * v.hd * 0.7 - c * side * v.hw * 0.75, z = v.z - c * v.hd * 0.7 + s * side * v.hw * 0.75;
        g.effects.skid(v, x, z, v.heading);
        if (v.slip > 0.45) g.effects.tyreSmoke(x, z, v.y);
      }
    }
    if (v && Math.abs(forwardSpeed(v)) > 8 && g.city.densityAt(v.x, v.z) < 0.15 && Math.random() < 0.3) g.effects.dust(v.x - Math.sin(v.heading) * v.hd, v.z - Math.cos(v.heading) * v.hd, 1, undefined, v.y);
    // Vehicle into the Godavari.
    if (v && v.sinking > 0.4) { if (!v.splashed) { v.splashed = true; g.effects.splash(v.x, v.z); g.audio.sfx('crash', 0.5); } if (v.sinking > 1.5) { const vv = v; P.leaveVehicle(true); g.wasted('drowned'); vv.wrecked = true; } }
    // Health regenerates slowly to half.
    if (P.health < 50 && P.state !== 'dead') P.heal(dt * 1.2);
    // Radio, camera, map, photo.
    const inp = g.input;
    if (inp.pressed('radio') && P.vehicle) { const st = g.audio.radio?.cycle(); if (st) g.hud.radioText(st.name, st.tag, '#ffd27a'); }
    if (inp.pressed('camera')) g.camera.cycleView();
    if (inp.pressed('photo')) g.takePhoto(null);
    if (inp.pressed('action') && P.state === 'foot') { const a = g.contextAction(); a?.run?.(); }
    saveT += dt;
    if (saveT > 10) { saveT = 0; g.save.flush(); }
  }];

  // ---------------------------------------------------------------- cheat codes
  // Type them while playing, GTA style.
  const CHEATS = {
    BHAUMONEY: () => { g.addCash(5000); return '₹5,000. Paisa hi paisa!'; },
    KADAMCHUTTI: () => { g.police.clear(); return 'Inspector Kadam is on leave.'; },
    JUGAAD: () => { const v = g.player.vehicle; if (v) { v.health = 1000; v.onFire = 0; v.wrecked = false; v.explodeAt = 0; } g.player.health = g.player.maxHealth; return 'Jugaad: everything fixed.'; },
    LALPARI: () => spawnNear('bus', 'Lal Pari at your service.'),
    RICKSHAW: () => spawnNear('auto', 'Auto aala!'),
    POLICEWALA: () => spawnNear('police', 'A jeep, no questions asked.'),
    PAUSKALA: () => { g.sky.setWeather(g.sky.weather === 'rain' ? 'clear' : 'rain'); return 'Monsoon on demand.'; },
    RAATRANI: () => { g.sky.hours = (g.sky.hours + 12) % 24; return 'Day for night.'; },
  };
  function spawnNear(type, msg) {
    const P = g.player, pos = P.pos, n = g.net.nearest(pos.x + Math.sin(P.heading) * 8, pos.z + Math.cos(P.heading) * 8, 40, {}, r => !g.net.raised[r]);
    if (!n) return null;
    const v = g.vehicles.spawn(type, n.x, n.z, Math.atan2(n.dx, n.dz) + (g.net.oneway[n.road] < 0 ? Math.PI : 0), { role: 'parked', driver: false });
    v.kinematic = true;
    return msg;
  }
  /** Run a cheat by name (Settings has a box for it on phones): its message, null if it had no effect, '' if unknown. */
  g.cheat = code => {
    const run = CHEATS[String(code).toUpperCase().replace(/[^A-Z]/g, '')];
    if (!run) return '';
    const msg = run();
    if (msg) g.audio.sfx('checkpoint');
    return msg ?? null;
  };
  let typed = '';
  addEventListener('keydown', e => {
    if (!g.started || g.paused || e.key.length !== 1) return;
    typed = (typed + e.key.toUpperCase()).slice(-12);
    for (const code in CHEATS) {
      if (!typed.endsWith(code)) continue;
      typed = '';
      const msg = g.cheat(code);
      if (msg) g.hud.big('CHEAT ACTIVATED', msg, 'title', 2.5);
    }
  });

  // ---------------------------------------------------------------- death and arrest
  // A mission fails at once, but its card waits for the respawn: the HUD has one big-message slot.
  const endMission = reason => g.missions.active ? (g.missions.fail(reason), reason) : null;
  g.wasted = cause => {
    if (g.player.state === 'dead' || g.respawning) return;
    g.player.state = 'dead';
    g.player.human.pose = 'lie';
    g.respawning = true;
    document.body.classList.add('wasted');
    const failed = endMission('You were wasted.');
    g.hud.big('WASTED', cause === 'drowned' ? 'The Godavari wins this one' : '', 'wasted', 4.2);
    g.audio.sfx('wasted');
    g.save.stat('wasted');
    g.jobs.stop(true);
    setTimeout(() => respawn(HOSPITAL, fee => fee ? `SGGS Civil Hospital: ₹${fee} for the stitches.` : 'SGGS Civil Hospital patched you up for free.', 200, failed), 4200);
  };
  g.busted = () => {
    if (g.respawning) return;
    g.respawning = true;
    g.player.state = 'dead';
    document.body.classList.add('busted');
    const failed = endMission('You were busted.');
    g.hud.big('BUSTED', 'Inspector Kadam sends his regards', 'busted', 4);
    g.audio.sfx('busted');
    g.save.stat('busted');
    g.jobs.stop(true);
    setTimeout(() => respawn(POLICE_STATION, fee => fee ? `Released from Vazirabad Police Station. Fine: ₹${fee}.` : 'Released from Vazirabad Police Station with a warning.', 300, failed), 4000);
  };
  /** Back on your feet at `at`; msg(fee charged) says where. A mission that failed shows its card now. */
  function respawn(at, msg, fee, failed) {
    const P = g.player;
    if (P.vehicle) P.leaveVehicle(true);
    g.police.clear();
    document.body.classList.remove('wasted', 'busted');
    const fine = Math.min(fee, g.save.cash);
    if (fine) g.addCash(-fine);
    P.health = P.maxHealth;
    const n = g.net.nearest(at.x, at.z, 50, {}, r => !g.net.raised[r]);
    const off = n ? (g.net.width[n.road] / 2 + 1) * (g.net.kerbSide(n.road) || 1) : 0;
    P.teleport(n ? n.x + n.dz * off : at.x, n ? n.z - n.dx * off : at.z, n ? Math.atan2(n.dx, n.dz) : 0);
    g.respawning = false;
    g.hud.help(msg(fine), 5);
    if (failed) g.hud.big('MISSION FAILED', failed, 'failed', 4);
    g.save.flush();
  }

  g.onPlayerDamage = () => {};
  g.onWantedChange = (level, before) => {
    if (level > before) { g.audio.sfx('wanted'); if (before === 0 && !g.save.data.seenWantedHelp) { g.save.data.seenWantedHelp = true; g.hud.help(`You are <b>wanted</b>. Break line of sight and get out of the flashing search area on the radar to lose the police.${g.save.data.garage ? ' A respray at Anna\'s garage works too.' : ''}`, 8); } }
  };
  g.onEvaded = () => g.hud.toast('Lost them. <b>Wanted level cleared.</b>');

  g.onDistrict = name => {
    const d = g.save.data.districts;
    if (!g.started || d.includes(name)) return;
    if (g.time < 3) { d.push(name); return; } // where you start doesn't count as a discovery
    {
      d.push(name);
      g.addCash(50);
      g.hud.toast(`New neighbourhood: <b>${name}</b> · ${d.length}/${g.city.districts.length} · +₹50`);
    }
  };

  g.vehicleSank = () => {};

  // Photos: the frame as you see it (graded, smoothed), at least 1280 pixels across even when a
  // slow phone plays at a lower resolution, with a caption strip naming the place and the game.
  // Share hands it to the phone's share sheet (WhatsApp, Instagram...); Save downloads it.
  const photo = document.getElementById('photo');
  const hidePhotoLater = ms => { clearTimeout(g._photoT); g._photoT = setTimeout(() => (photo.hidden = true), ms); };
  g.takePhoto = title => {
    const r = g.renderer, ratio = r.getPixelRatio(), want = Math.min(2, Math.max(ratio, 1280 / innerWidth));
    try {
      if (want > ratio * 1.1) { r.setPixelRatio(want); r.setSize(innerWidth, innerHeight, false); }
      g.post.render(g.scene, g.camera3, 0);
      const name = title || g.city.district(g.player.pos.x, g.player.pos.z).name;
      const src = r.domElement, W = src.width, H = src.height, bar = Math.round(Math.max(40, W * 0.045));
      const shot = document.createElement('canvas');
      shot.width = W; shot.height = H + bar;
      const ctx = shot.getContext('2d');
      ctx.drawImage(src, 0, 0);
      ctx.fillStyle = '#f7f2e6'; ctx.fillRect(0, H, W, bar);
      ctx.fillStyle = '#222'; ctx.textBaseline = 'middle';
      ctx.font = `700 ${Math.round(bar * 0.46)}px Georgia, serif`;
      ctx.fillText(`${name} · नांदेड`, bar * 0.35, H + bar / 2);
      ctx.textAlign = 'right'; ctx.font = `${Math.round(bar * 0.5)}px Anton, "Barlow Condensed", sans-serif`;
      ctx.fillText('GTA NANDED · gta.nanded.fun', W - bar * 0.35, H + bar / 2);
      document.getElementById('photo-img').src = src.toDataURL('image/jpeg', 0.85);
      document.getElementById('photo-title').textContent = `${name} · नांदेड`;
      photo.hidden = false;
      hidePhotoLater(9000);
      g._photoName = name; g._photoFile = null;
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'nanded';
      shot.toBlob(b => { if (b) g._photoFile = new File([b], `gta-nanded-${slug}.jpg`, { type: 'image/jpeg' }); }, 'image/jpeg', 0.88);
    } catch { /* tainted or lost context */ } finally {
      if (r.getPixelRatio() !== ratio) { r.setPixelRatio(ratio); r.setSize(innerWidth, innerHeight, false); }
    }
  };
  // Touching the photo keeps it up; it goes away a while after you leave it.
  photo.addEventListener('pointerdown', () => hidePhotoLater(20000));
  document.getElementById('photo-close').addEventListener('click', () => { clearTimeout(g._photoT); photo.hidden = true; });
  document.getElementById('photo-save').addEventListener('click', () => {
    const file = g._photoFile;
    if (!file) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  });
  document.getElementById('photo-share').addEventListener('click', async () => {
    const text = `${g._photoName || 'Nanded'} in GTA Nanded! Play free in your browser: https://gta.nanded.fun`;
    const file = g._photoFile;
    try {
      if (file && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], text });
      else if (navigator.share) await navigator.share({ text });
      else open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    } catch { /* closed the share sheet */ }
  });
}
