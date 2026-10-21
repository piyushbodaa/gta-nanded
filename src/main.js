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
import { Traffic } from './actors/traffic.js';
import { Peds } from './actors/peds.js';
import { Police } from './game/police.js';
import { Missions } from './game/missions.js';
import { Jobs } from './game/jobs.js';
import { Save } from './game/save.js';
import { STORY, HOME } from './game/story.js';
import { GameAudio } from './audio/audio.js';
import { installRules } from './game/rules.js';

const $ = id => document.getElementById(id);
const status = (text, f) => { $('loading-status').textContent = text.toUpperCase(); if (f !== undefined) $('load-bar').style.width = `${Math.round(f * 100)}%`; };

function fatal(msg) { $('fatal-msg').textContent = msg; $('fatal').hidden = false; }

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
  game.hud = new Hud(game);
  game.effects = new Effects(game.scene);
  game.traffic = new Traffic(game);
  game.peds = new Peds(game);
  game.police = new Police(game);
  game.missions = new Missions(game, STORY);
  game.jobs = new Jobs(game);
  game.staticBlips = game.jobs.staticBlips();
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
  game.input.mouseSensitivity = 0.0024 * (st.sensitivity || 1);
  game.toggleSound = async () => {
    if (!game.audio.ctx) { await game.audio.init(); game.audio.setVolumes({ music: st.music, sfx: st.sfx }); game.audio.setEnabled(true); st.sound = true; }
    else { game.audio.setEnabled(!game.audio.enabled); st.sound = game.audio.enabled; }
    game.save.flush();
  };
  // Draw the city once behind the cover so the first frame after it is instant.
  game.renderWorld(0);
  status('The city is yours', 1);
  const has = game.save.hasProgress;
  const done = STORY.filter(m => game.save.done(m.id)).length;
  if (has) { $('menu-continue').hidden = false; $('menu-continue-meta').textContent = `${done}/${STORY.length} MISSIONS · ₹${game.save.cash.toLocaleString('en-IN')}`; }
  for (const id of ['menu-continue', 'menu-new', 'menu-free']) $(id).disabled = false;

  const begin = async mode => {
    if (game.started) return;
    if (st.sound !== false) { try { await game.audio.init(); game.audio.setVolumes({ music: st.music, sfx: st.sfx }); game.audio.setEnabled(true); } catch { /* audio is optional */ } }
    const play = () => startGame(game, mode);
    if (mode === 'new' && !game.save.data.seenIntro) { game.save.data.seenIntro = true; intro.play(play, { mode: 'drive' }); }
    else play();
  };
  $('menu-continue').addEventListener('click', () => begin('continue'));
  $('menu-new').addEventListener('click', () => {
    if (has && !$('menu-new').dataset.confirm) {
      $('menu-new').dataset.confirm = '1';
      $('menu-new').querySelector('small').textContent = 'TAP AGAIN: THIS ERASES YOUR SAVE';
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
  const P = game.player;
  game.save.data.started = true;
  if (mode === 'new') {
    // The story opens on the station forecourt, Hazur Sahib Nanded.
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
  game.start();
  game.save.flush();
  if (mode === 'new') setTimeout(() => game.missions.start('m1'), 400);
  else if (mode === 'free') game.hud.help('<b>Free roam.</b> The whole city is open. Press <kbd>M</kbd> for the map, or find a contact marker to play the story.', 7);
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
