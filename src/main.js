// Boot: load the city behind the cover, then hand the streets to the player.
import './ui/cover.css';
import './ui/launch.css';
import './ui/game.css';
import { Game } from './game/game.js';
import { createIntro } from './ui/intro.js';
import { Hud } from './ui/hud.js';
import { TouchControls } from './ui/touch.js';
import { PauseMenu } from './ui/menus.js';
import { Effects } from './game/effects.js';
import { Traffic, Parked } from './actors/traffic.js';
import { Signals } from './world/signals.js';
import { Stands } from './actors/stands.js';
import { Markets } from './actors/markets.js';
import { Peds } from './actors/peds.js';
import { Animals } from './actors/animals.js';
import { Police } from './game/police.js';
import { Missions } from './game/missions.js';
import { Jobs } from './game/jobs.js';
import { Save } from './game/save.js';
import { STORY, HOME, dressWorld } from './game/story.js';
import { GameAudio } from './audio/audio.js';
import { installRules } from './game/rules.js';
import { track } from './core/analytics.js';
import { press } from './ui/controls.js';
import { installKind } from './ui/install.js';

const $ = id => document.getElementById(id);
// Each stage is also a performance mark, so a profiler (or the phone benchmark) can time it.
const status = (text, f) => { $('loading-status').textContent = text.toUpperCase(); performance.mark?.(`loading: ${text}`); if (f !== undefined) $('load-bar').style.width = `${Math.round(f * 100)}%`; };

function fatal(msg) { $('fatal-msg').textContent = msg; $('fatal').hidden = false; }

/** Phones and tablets play full screen, sideways. Browsers that can't (iPhone Safari) carry on as they are. */
function fullscreen() {
  const el = document.documentElement;
  if (!matchMedia('(pointer: coarse)').matches || document.fullscreenElement || !el.requestFullscreen) return;
  el.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
}

async function boot() {
  const probe = document.createElement('canvas').getContext('webgl2');
  if (!probe) { fatal('GTA Nanded needs WebGL 2. Use a current Chrome, Edge, Firefox or Safari with hardware acceleration on, then reload.'); return; }
  const intro = createIntro();
  const canvas = $('game-canvas');
  const game = new Game(canvas);
  window.gtaNanded = game;
  game.save = new Save();
  game.audio = new GameAudio();
  await game.load((label, f) => status(label, f));
  // Compile the city's shaders on the GPU's own thread while the rest of the game is set up,
  // instead of stalling the first frame on them (KHR_parallel_shader_compile where available).
  const compiled = game.renderer.extensions.has('KHR_parallel_shader_compile') ? game.renderer.compileAsync(game.scene, game.camera3).catch(() => {}) : null;
  game.hud = new Hud(game);
  game.effects = new Effects(game.scene);
  game.traffic = new Traffic(game);
  game.signals = new Signals(game.scene, game.net, game.traffic, game.colliders);
  game.parked = new Parked(game);
  game.stands = new Stands(game);
  game.markets = new Markets(game);
  game.peds = new Peds(game);
  game.animals = new Animals(game);
  game.police = new Police(game);
  game.missions = new Missions(game, STORY);
  dressWorld(game);
  game.jobs = new Jobs(game);
  game.staticBlips = [...game.jobs.staticBlips(), ...game.city.pumps.map(p => ({ x: p.x, z: p.z, kind: 'icon', label: '⛽', color: '#f07c1e' }))];
  game.touch = new TouchControls(game);
  game.pause = new PauseMenu(game);
  installRules(game);
  game.hud.radioText = (name, tag, color = '#fff') => {
    const el = $('hud-radio');
    el.innerHTML = `<strong style="color:${color}">📻 ${name}</strong>${tag ? `<span>${tag}</span>` : ''}`;
    el.hidden = false; el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    clearTimeout(game.hud._radioT); game.hud._radioT = setTimeout(() => (el.hidden = true), 4500);
  };
  const st = game.save.data.settings;
  game.input.setSensitivity(st.sensitivity || 1);
  if (st.perf || new URLSearchParams(location.search).has('perf')) game.hud.showPerf(true);
  game.toggleSound = async () => {
    if (!game.audio.ctx) { await game.audio.init(); game.audio.setVolumes({ music: st.music, sfx: st.sfx }); game.audio.setEnabled(true); st.sound = true; }
    else { game.audio.setEnabled(!game.audio.enabled); st.sound = game.audio.enabled; }
    game.save.flush();
  };
  // Draw the city once behind the cover so the first frame after it is instant.
  await compiled;
  game.renderWorld(0);
  // The first time on this device: find the graphics it can hold before anyone plays.
  if (game.quality.mode === 'auto' && (!game.quality.learned || game.quality.learned.promote)) {
    status('Tuning the graphics for this device');
    await new Promise(r => setTimeout(r, 30)); // let the status paint before the GPU is busy
    game.calibrate();
  }
  status('The city is yours', 1);
  const has = game.save.hasProgress;
  const done = STORY.filter(m => game.save.done(m.id)).length;
  if (has) { $('menu-continue').hidden = false; $('menu-continue-meta').textContent = `${done}/${STORY.length} MISSIONS · ₹${game.save.cash.toLocaleString('en-IN')}`; }
  for (const id of ['menu-continue', 'menu-new', 'menu-free']) $(id).disabled = false;
  // While the player reads the menu, compile the shaders that play would otherwise stop for.
  let onMenu = true;
  game.warmShaders(() => onMenu && !game.started);

  const begin = async mode => {
    if (game.started) return;
    onMenu = false;
    fullscreen(); // while the tap still counts as a user gesture
    if (st.sound !== false) { try { await game.audio.init(); game.audio.setVolumes({ music: st.music, sfx: st.sfx }); game.audio.setEnabled(true); } catch { /* audio is optional */ } }
    const play = () => startGame(game, mode);
    if (mode === 'new' && !game.save.data.seenIntro) { game.save.data.seenIntro = true; intro.play(play, { mode: 'drive' }); }
    else play();
  };
  $('menu-continue').addEventListener('click', () => begin('continue'));
  $('menu-new').addEventListener('click', () => {
    if (has && !$('menu-new').dataset.confirm) {
      $('menu-new').dataset.confirm = '1';
      $('menu-new').querySelector('small').textContent = `${matchMedia('(pointer: coarse)').matches ? 'TAP' : 'CLICK'} AGAIN: THIS ERASES YOUR SAVE`;
      return;
    }
    if (has) { const settings = game.save.data.settings; game.save.reset(); game.save.data.settings = settings; }
    begin('new');
  });
  $('menu-free').addEventListener('click', () => begin('free'));
  // Development only: start without the menu (automated checks).
  if (import.meta.env.DEV) game.debugStart = mode => { if (mode === 'new') { const s2 = game.save.data.settings; game.save.reset(); game.save.data.settings = s2; } startGame(game, mode); };
}

function startGame(game, mode) {
  track('game_start', { mode });
  const P = game.player;
  game.save.data.started = true;
  if (mode === 'new') {
    // The story opens on the station forecourt, Hazur Sahib Nanded, late in the afternoon.
    P.teleport(5.3 - 4, 10.9 + 2, Math.PI * 0.75);
    game.sky.hours = 17.1;
  } else {
    const n = game.net.nearest(HOME.x, HOME.z, 30, {});
    P.teleport(HOME.x + (n ? n.dz * 4 : 0), HOME.z - (n ? n.dx * 4 : 0), n ? Math.atan2(n.dx, n.dz) : 0);
    game.sky.hours = 9.5 + Math.random() * 7;
  }
  if (mode === 'free') game.freeRoam = true;
  document.body.classList.add('playing');
  game.hud.show(true);
  game.touch.show(true);
  // Populate the streets before the first frame.
  for (let i = 0; i < 40; i++) { game.traffic.update(0.05); game.peds.update(0.05); }
  game.parked.t = 0; game.parked.update(1);
  game.start();
  game.save.flush();
  // Ask the browser to keep the save through storage clean-ups (granted quietly where it is).
  navigator.storage?.persist?.().catch(() => {});
  // iPhones clear a site's saves after a week away unless it is on the Home Screen: say so once.
  if (installKind() === 'ios' && !game.save.data.settings.homeTip) {
    setTimeout(() => {
      game.save.data.settings.homeTip = true; game.save.dirty();
      game.hud.help('<b>Tip:</b> add GTA Nanded to your Home Screen — tap <b>Share</b>, then <b>Add to Home Screen</b>. It opens full screen, and your iPhone keeps your progress.', 9);
    }, 150000);
  }
  // A new game: the story's title, then its first mission.
  if (mode === 'new') { game.hud.big('गोदावरी गोल्ड', 'GODAVARI GOLD', 'title', 3.4); setTimeout(() => game.missions.start(STORY[0].id), 3600); }
  else if (mode === 'free') game.hud.help(`<b>Free roam.</b> The whole city is open. ${press(game, 'map')} for the map, or find a contact marker to play the story.`, 7);
  else game.hud.help(`Welcome back to <b>${game.city.district(P.x, P.z).name}</b>. Your next contact is on the radar.`, 6);
  game.canvas.focus();
}

// The service worker keeps the game playable on flaky connections.
if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('/sw.js').catch(() => {});

boot().catch(err => {
  console.error('GTA Nanded failed to start', err);
  status('Something went wrong');
  fatal(`The city could not load (${err?.message || err}). Reload to try again.`);
});
