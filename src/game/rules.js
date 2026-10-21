// The rules of the city: crimes and consequences, money, damage, wrecks,
// WASTED and BUSTED, discoveries and photos. Wires the systems together.
import { dist, clamp } from '../core/math.js';
import { speedOf, forwardSpeed } from '../actors/vehicle-physics.js';
import { VEHICLE_TYPES } from '../actors/vehicle-types.js';
import { HOSPITAL, POLICE_STATION } from './story.js';
import { DynamicDriver } from '../actors/traffic.js';
import { driveHunters } from './missions.js';

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
      g.police.report(hit.cop ? 'hitCop' : 'punch', player.x, player.z, { cop: hit.cop });
    }
  };

  g.pedAttacks = (p, dmg) => {
    const P = g.player;
    if (P.state !== 'foot' || dist(p.h.x, p.h.z, P.x, P.z) > 1.5) return;
    P.damage(dmg, p.cop ? 'police' : 'fight');
    g.audio.sfx('punch', 0.7);
    g.camera.addShake(0.12);
    if (p.cop && Math.random() < 0.15) P.knockDown(Math.sin(p.h.yaw) * 2, Math.cos(p.h.yaw) * 2, 0.9);
  };

  g.onPedHurt = (p, cause) => { if (p.cop && cause === 'punch') g.police.report('hitCop', p.h.x, p.h.z, { cop: true }); };

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
    // Passengers bail out too.
    for (const ph of v.passengers.splice(0)) { ph.x = door.x + 1; ph.z = door.z + 1; const pp = g.peds._make(ph, ph.x, ph.z, null); pp.state = 'flee'; pp.t = 6; }
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
      g.hud.help('<kbd>W</kbd> gas · <kbd>S</kbd> brake/reverse · <kbd>Space</kbd> handbrake · <kbd>H</kbd> horn · <kbd>R</kbd> radio · <kbd>F</kbd> get out', 7);
    }
  };

  g.onExitedVehicle = (v, spd) => { g.audio.sfx('door'); if (spd > 7) g.camera.addShake(0.3); };

  g.vehicles.onImpact = (v, speed, other) => {
    if (v.role === 'player' || other?.role === 'player') {
      const k = clamp(speed / 20, 0.1, 1);
      if (v.role === 'player') { g.camera.addShake(k * 0.7); g.audio.sfx('crash', k); g.save.stat('crashes'); }
      if (other && other.role === 'player' && v.type === 'police' && !v.wrecked) g.police.report('ramPolice', v.x, v.z, { cop: true });
      if (speed > 9) g.effects.sparks(v.x, 0.7, v.z, Math.round(4 + speed * 0.4));
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

  g.vehicles.onWreck = v => {
    // Fire, then a fireball.
    v.onFire = 0.01;
    v.explodeAt = g.time + (v.role === 'player' ? 3.5 : 2.5);
  };

  const explode = v => {
    v.exploded = true;
    v.onFire = 0;
    g.effects.explosion(v.x, 0.5, v.z);
    g.audio.sfx('explosion');
    const P = g.player, pos = P.pos;
    const d = dist(pos.x, pos.z, v.x, v.z);
    g.camera.addShake(clamp(1.2 - d / 40, 0, 1.2));
    if (P.vehicle === v) { P.leaveVehicle(true); P.damage(70, 'explosion'); P.knockDown(Math.random() * 4 - 2, Math.random() * 4 - 2, 2); }
    else if (d < 7 && P.state === 'foot') { P.damage((7 - d) * 12, 'explosion'); P.knockDown((pos.x - v.x) * 1.5, (pos.z - v.z) * 1.5, 1.5); }
    // Throw nearby people and cars.
    g.peds.forEachNear(v.x, v.z, 8, p => g.peds.knock(p, (p.h.x - v.x) * 2, (p.h.z - v.z) * 2, 3, 'explosion'));
    for (const o of g.vehicles.list) {
      if (o === v) continue;
      const od = dist(o.x, o.z, v.x, v.z);
      if (od > 9) continue;
      if (o.kinematic) g.vehicles.wake(o);
      const k = (9 - od) * 1.2;
      o.vx += (o.x - v.x) / Math.max(od, 0.5) * k; o.vz += (o.z - v.z) / Math.max(od, 0.5) * k;
      o.health -= (9 - od) * 60;
    }
    if (v.role === 'player' || v.lastHitBy === 'player') g.police.report('wreck', v.x, v.z);
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
      if (v.exploded) continue;
      const near = dist(v.x, v.z, P.pos.x, P.pos.z) < 140;
      if (v.explodeAt && g.time > v.explodeAt) { explode(v); continue; }
      if (!near) continue;
      if (smokeT <= 0) {
        const hx = v.x + Math.sin(v.heading) * v.hd * 0.7, hz = v.z + Math.cos(v.heading) * v.hd * 0.7;
        if (v.onFire || v.wrecked) { for (let k = 0; k < 2; k++) g.effects.fire(hx, 1.0, hz); g.effects.smoke(hx, 1.6, hz, 0.12, 1); }
        else if (v.health < 450) g.effects.smoke(hx, 1.2, hz, v.health < 300 ? 0.2 : 0.55, 1);
      }
      if (v.onFire && !v.wrecked) { v.health -= dt * 40; if (v.health <= 0) { v.wrecked = true; g.vehicles.onWreck(v); } }
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
        if (v.slip > 0.45) g.effects.tyreSmoke(x, z);
      }
    }
    if (v && Math.abs(forwardSpeed(v)) > 8 && g.city.densityAt(v.x, v.z) < 0.15 && Math.random() < 0.3) g.effects.dust(v.x - Math.sin(v.heading) * v.hd, v.z - Math.cos(v.heading) * v.hd, 1);
    // Vehicle into the Godavari.
    if (v && v.sinking > 0.4) { if (!v.splashed) { v.splashed = true; g.effects.splash(v.x, v.z); g.audio.sfx('crash', 0.5); } if (v.sinking > 1.5) { const vv = v; P.leaveVehicle(true); g.wasted('drowned'); vv.wrecked = true; } }
    // Health regenerates slowly to half.
    if (P.health < 50 && P.state !== 'dead') P.heal(dt * 1.2);
    // Radio, camera, map, photo.
    const inp = g.input;
    if (inp.pressed('radio') && P.vehicle) { const st = g.audio.radio?.cycle(); if (st) g.hud.radioText(st.name, st.tag, '#ffd27a'); }
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
    const P = g.player, pos = P.pos, n = g.net.nearest(pos.x + Math.sin(P.heading) * 8, pos.z + Math.cos(P.heading) * 8, 40, {});
    if (!n) return null;
    const v = g.vehicles.spawn(type, n.x, n.z, Math.atan2(n.dx, n.dz), { role: 'parked', driver: false });
    v.kinematic = true;
    return msg;
  }
  let typed = '';
  addEventListener('keydown', e => {
    if (!g.started || g.paused || e.key.length !== 1) return;
    typed = (typed + e.key.toUpperCase()).slice(-12);
    for (const code in CHEATS) {
      if (!typed.endsWith(code)) continue;
      typed = '';
      const msg = CHEATS[code]();
      if (msg) { g.hud.big('CHEAT ACTIVATED', msg, 'title', 2.5); g.audio.sfx('checkpoint'); }
    }
  });

  // ---------------------------------------------------------------- death and arrest
  g.wasted = cause => {
    if (g.player.state === 'dead' || g.respawning) return;
    g.player.state = 'dead';
    g.player.human.pose = 'lie'; g.player.human.pitch = -1.45;
    g.respawning = true;
    document.body.classList.add('wasted');
    g.hud.big('WASTED', cause === 'drowned' ? 'The Godavari wins this one' : '', 'wasted', 4.2);
    g.audio.sfx('wasted');
    g.save.stat('wasted');
    g.missions.active && g.missions.fail('You were wasted.');
    g.jobs.stop(true);
    setTimeout(() => respawn(HOSPITAL, 'SGGS Civil Hospital: ₹200 for the stitches.', 200), 4200);
  };
  g.busted = () => {
    if (g.respawning) return;
    g.respawning = true;
    g.player.state = 'dead';
    document.body.classList.add('busted');
    g.hud.big('BUSTED', 'Inspector Kadam sends his regards', 'busted', 4);
    g.audio.sfx('busted');
    g.save.stat('busted');
    g.missions.active && g.missions.fail('You were busted.');
    g.jobs.stop(true);
    setTimeout(() => respawn(POLICE_STATION, 'Released from Vazirabad Police Station. Fine: ₹300.', 300), 4000);
  };
  function respawn(at, msg, fee) {
    const P = g.player;
    if (P.vehicle) P.leaveVehicle(true);
    g.police.clear();
    document.body.classList.remove('wasted', 'busted');
    const fine = Math.min(fee, g.save.cash);
    if (fine) g.addCash(-fine);
    P.health = P.maxHealth;
    const n = g.net.nearest(at.x, at.z, 50, {});
    P.teleport(n ? n.x + n.dz * (g.net.width[n.road] / 2 + 1) : at.x, n ? n.z - n.dx * (g.net.width[n.road] / 2 + 1) : at.z, n ? Math.atan2(n.dx, n.dz) : 0);
    g.respawning = false;
    g.hud.help(msg, 5);
    g.save.flush();
  }

  g.onPlayerDamage = () => {};
  g.onWantedChange = (level, before) => {
    if (level > before) { g.audio.sfx('wanted'); if (before === 0 && !g.save.data.seenWantedHelp) { g.save.data.seenWantedHelp = true; g.hud.help('You are <b>wanted</b>. Break line of sight and get out of the flashing search area on the radar to lose the police. A respray at Anna\'s garage works too.', 8); } }
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

  g.takePhoto = title => {
    g.renderer.render(g.scene, g.camera3);
    try {
      const url = g.renderer.domElement.toDataURL('image/jpeg', 0.9);
      const img = document.getElementById('photo-img');
      img.src = url;
      const name = title || g.city.district(g.player.pos.x, g.player.pos.z).name;
      document.getElementById('photo-title').textContent = `${name} · नांदेड`;
      document.getElementById('photo').hidden = false;
      clearTimeout(g._photoT);
      g._photoT = setTimeout(() => (document.getElementById('photo').hidden = true), 9000);
      g._photoUrl = url; g._photoName = name;
    } catch { /* tainted or lost context */ }
  };
}
