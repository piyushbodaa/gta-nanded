// Pause menu: map and place search, story, activities, passport, stats, settings, controls.
import { CityMap } from './minimap.js';
import { STORY, CHARACTERS } from '../game/story.js';
import { dist } from '../core/math.js';
import { key, verb, pick } from './controls.js';
import { installKind, promptInstall } from './install.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class PauseMenu {
  constructor(game) {
    this.game = game;
    this.root = $('pause');
    this.open = false;
    this.tab = 'map';
    this.map = new CityMap(game, $('city-map'));
    this.map.onPick = (x, z) => this.setWaypoint(x, z);
    this._bind();
  }

  _bind() {
    const g = this.game;
    for (const b of this.root.querySelectorAll('[data-tab]')) b.addEventListener('click', () => this.show(b.dataset.tab));
    $('pause-resume').addEventListener('click', () => this.close());
    $('map-zoom-in').addEventListener('click', () => this.map.zoomBy(1.4));
    $('map-zoom-out').addEventListener('click', () => this.map.zoomBy(0.7));
    $('map-me').addEventListener('click', () => { const p = g.player.pos; this.map.focus(p.x, p.z, 0.8); });
    $('map-clear').addEventListener('click', () => { g.waypoint = null; g.hud.route = null; this._drawMap(); });
    $('map-search').addEventListener('input', () => this._search());
    $('set-quality').addEventListener('click', () => { g.quality.cycle(g); this._settings(); });
    $('set-fps').addEventListener('click', () => { g.quality.cycleFps(); this._settings(); });
    $('set-perf').addEventListener('click', () => { const s = g.save.data.settings; s.perf = !s.perf; g.hud.showPerf(s.perf); g.save.dirty(); this._settings(); });
    $('set-install').addEventListener('click', async () => {
      if (installKind() === 'ios') { $('set-install-help').hidden = !$('set-install-help').hidden; return; }
      await promptInstall();
      this._settings();
    });
    $('set-sound').addEventListener('click', async () => { await g.toggleSound(); this._settings(); });
    $('set-music').addEventListener('input', e => { g.save.data.settings.music = Number(e.target.value); g.audio.setVolumes({ music: Number(e.target.value) }); g.save.dirty(); });
    $('set-sfx').addEventListener('input', e => { g.save.data.settings.sfx = Number(e.target.value); g.audio.setVolumes({ sfx: Number(e.target.value) }); g.save.dirty(); });
    $('set-sens').addEventListener('input', e => { g.save.data.settings.sensitivity = Number(e.target.value); g.input.setSensitivity(Number(e.target.value)); g.save.dirty(); });
    $('set-cheat-form').addEventListener('submit', e => {
      e.preventDefault();
      const field = $('set-cheat'), msg = g.cheat?.(field.value);
      field.value = '';
      field.placeholder = msg === null ? 'Nothing happened' : msg ? 'Cheat activated' : 'Not a cheat code';
      if (msg) { this.close(); g.hud.big('CHEAT ACTIVATED', msg, 'title', 2.5); }
    });
    $('set-time').addEventListener('click', () => { g.sky.hours = (g.sky.hours + 3) % 24; g.renderer.shadowMap.needsUpdate = true; this._settings(); });
    $('set-weather').addEventListener('click', () => { g.sky.cycleWeather(); this._settings(); });
    $('set-reset').addEventListener('click', () => {
      if (this._confirmReset) { g.save.reset(); location.reload(); return; }
      this._confirmReset = true; $('set-reset').textContent = `${verb(g) === 'tap' ? 'Tap' : 'Click'} again to erase everything`;
      setTimeout(() => { this._confirmReset = false; $('set-reset').textContent = 'Start over (erase progress)'; }, 4000);
    });
    addEventListener('resize', () => { if (this.open && this.tab === 'map') this._drawMap(); });
  }

  setWaypoint(x, z, label) {
    const g = this.game;
    const n = g.net.nearest(x, z, 200, {});
    g.waypoint = n ? { x: n.x, z: n.z, label } : { x, z, label };
    const pos = g.player.pos;
    g.hud.route = g.net.route(pos.x, pos.z, g.waypoint.x, g.waypoint.z);
    if (g.hud.route) g.hud.route.color = '#c77dff';
    this._drawMap();
  }

  toggle(tab) { if (this.open) this.close(); else this.openMenu(tab); }
  openMenu(tab = 'map') {
    const g = this.game;
    this.open = true;
    g.paused = true;
    g.input.clear();
    if (document.pointerLockElement) document.exitPointerLock();
    this.root.hidden = false;
    const p = g.player.pos;
    this.map.focus(p.x, p.z, this.map.zoom || 0.35);
    this.show(tab);
  }
  close() {
    const g = this.game;
    this.open = false;
    this.root.hidden = true;
    g.paused = false;
    g.clock.getDelta();
    g.save.flush();
    g.canvas.focus();
  }

  show(tab) {
    this.tab = tab;
    for (const b of this.root.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    for (const p of this.root.querySelectorAll('[data-pane]')) p.classList.toggle('on', p.dataset.pane === tab);
    if (tab === 'map') { requestAnimationFrame(() => this._drawMap()); this._search(); }
    if (tab === 'story') this._story();
    if (tab === 'jobs') this._jobs();
    if (tab === 'passport') this._passport();
    if (tab === 'stats') this._stats();
    if (tab === 'settings') this._settings();
  }

  _drawMap() {
    const g = this.game;
    const blips = [...g.hud.collectBlips(), ...g.missions.blips(), ...(g.jobs?.staticBlips() || [])];
    this.map.draw(blips, g.hud.route);
  }

  _search() {
    const g = this.game, q = $('map-search').value.trim().toLowerCase();
    const pos = g.player.pos;
    let list = g.city.places;
    if (q) list = list.filter(p => [p.name, p.shortName, p.area, ...(p.aliases || [])].some(s => s && s.toLowerCase().includes(q)));
    list = list.slice().sort((a, b) => dist(a.x, a.z, pos.x, pos.z) - dist(b.x, b.z, pos.x, pos.z)).slice(0, 40);
    $('map-results').innerHTML = list.map(p => `<button type="button" data-id="${p.id}">${esc(p.shortName)}<small>${esc(p.category)} · ${esc(p.area)} · ${(dist(p.x, p.z, pos.x, pos.z) / 500).toFixed(1)} km</small></button>`).join('') || '<p class="small">No place by that name — yet.</p>';
    for (const b of $('map-results').querySelectorAll('button')) b.addEventListener('click', () => {
      const p = g.city.places.find(pl => pl.id === b.dataset.id);
      this.map.focus(p.x, p.z, 1.1);
      this.setWaypoint(p.ax, p.az, p.shortName);
      g.hud.help(`Waypoint set: <b>${esc(p.shortName)}</b>${p.detail ? ` — ${esc(p.detail.slice(0, 140))}${p.detail.length > 140 ? '…' : ''}` : ''}`, 6);
    });
  }

  _story() {
    const g = this.game, s = g.save;
    $('story-list').innerHTML = STORY.map((m, i) => {
      const done = s.done(m.id), open = (m.requires || []).every(r => s.done(r));
      const ch = CHARACTERS[m.giver];
      return `<div class="card ${done ? 'done' : open ? '' : 'locked'}"><span class="sub">${String(i + 1).padStart(2, '0')} · ${esc(ch?.name || '')}</span><h3>${esc(m.subtitle)}</h3><p lang="mr">${esc(m.title)}${m.reward ? ` · ₹${m.reward.toLocaleString('en-IN')}` : ''}</p>${!done && open ? `<button type="button" data-go="${m.id}">Set waypoint</button>` : done ? '' : '<p>Locked: finish earlier missions.</p>'}</div>`;
    }).join('');
    for (const b of $('story-list').querySelectorAll('[data-go]')) b.addEventListener('click', () => {
      const m = STORY.find(x => x.id === b.dataset.go);
      const p = g.missions.startPoint(m);
      this.setWaypoint(p.x, p.z, m.subtitle);
      this.show('map');
    });
  }

  _jobs() {
    const g = this.game, j = g.jobs, rec = g.save.data.records;
    const job = `${verb(g)} ${key(g, 'job')}`;
    const cards = [
      ['RICKSHAW FARES', 'रिक्षा', `Get in any auto-rickshaw and ${job}. Pick up passengers and drive them to real places across Nanded. Fast, clean rides earn tips and streak bonuses.`, `${g.save.data.stats.fares} fares so far`],
      ['BHOOKH EXPRESS', 'डिलिव्हरी', `On any bike or scooty ${job}. Collect orders from restaurants and deliver them while they are still hot.`, `${g.save.data.stats.deliveries} deliveries`],
      ...j.races.map(r => [r.name.toUpperCase(), 'STREET RACE', `Drive into the orange marker to start. ₹${r.reward} for first place.`, rec[r.id] ? `Best: ${rec[r.id].toFixed(1)}s` : 'Not raced yet', r]),
      ['RANG GARAGE', 'रंग गॅरेज', g.save.data.garage ? "Drive into Anna's garage at Workshop Corner while wanted: new colour, repairs, stars cleared. ₹250." : 'Unlocks during the story.', ''],
      ['ROADSIDE SNACKS', 'चहा · वडा पाव', `Walk up to a tea stall or handcart and ${pick(g, { keyboard: `press ${key(g, 'action')}`, gamepad: `press ${key(g, 'action')}`, touch: 'tap the button that appears' })}: chai, vada pav, misal… They heal you and give you a burst of energy.`, ''],
    ];
    $('jobs-list').innerHTML = cards.map(([t, sub, p, meta, race], i) => `<div class="card"><span class="sub">${sub}</span><h3>${t}</h3><p>${p}</p>${meta ? `<p class="small">${meta}</p>` : ''}${race ? `<button type="button" data-race="${i}">Set waypoint</button>` : ''}</div>`).join('');
    for (const b of $('jobs-list').querySelectorAll('[data-race]')) b.addEventListener('click', () => { const r = cards[Number(b.dataset.race)][4]; this.setWaypoint(r.start.x, r.start.z, r.name); this.show('map'); });
  }

  _passport() {
    const g = this.game, stamps = g.save.data.stamps;
    $('passport-list').innerHTML = g.jobs.landmarks.map(lm => {
      const done = stamps.includes(lm.id);
      return `<div class="card ${done ? 'done' : ''}"><span class="sub">${done ? 'STAMPED' : 'TO VISIT'} · ${esc(lm.area)}</span><h3>${esc(lm.shortName)}</h3><p>${esc((lm.detail || '').slice(0, 150))}</p>${done ? '' : `<button type="button" data-lm="${lm.id}">Set waypoint</button>`}</div>`;
    }).join('');
    for (const b of $('passport-list').querySelectorAll('[data-lm]')) b.addEventListener('click', () => { const lm = g.jobs.landmarks.find(l => l.id === b.dataset.lm); this.setWaypoint(lm.ax, lm.az, lm.shortName); this.show('map'); });
  }

  _stats() {
    const s = this.game.save.data, st = s.stats;
    const items = [
      [`${STORY.filter(m => s.story.includes(m.id)).length}/${STORY.length}`, 'Story missions'],
      [`₹${s.cash.toLocaleString('en-IN')}`, 'Cash'],
      [`${(st.distance / 500).toFixed(1)} km`, 'Driven (city scale)'],
      [st.fares, 'Rickshaw fares'], [st.deliveries, 'Deliveries'],
      [`${s.stamps.length}/17`, 'Passport stamps'], [`${s.districts.length}/53`, 'Neighbourhoods'],
      [st.jacked, 'Vehicles jacked'], [st.crashes, 'Crashes'], [st.punches, 'Punches thrown'],
      [st.busted, 'Times busted'], [st.wasted, 'Times wasted'],
      [`${Math.floor(st.playTime / 3600)}h ${Math.floor((st.playTime % 3600) / 60)}m`, 'Played'],
    ];
    $('stats-list').innerHTML = items.map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
  }

  _settings() {
    const g = this.game, s = g.save.data.settings;
    $('set-quality').textContent = g.quality.label();
    $('set-fps').textContent = g.quality.fpsLabel();
    $('set-perf').textContent = s.perf ? 'On' : 'Off';
    const install = installKind();
    $('set-install-row').hidden = !install;
    $('set-install').textContent = install === 'ios' ? 'How?' : 'Install the game';
    if (!install) $('set-install-help').hidden = true;
    $('set-sound').textContent = g.audio.enabled ? 'On' : 'Off';
    $('set-music').value = s.music; $('set-sfx').value = s.sfx; $('set-sens').value = s.sensitivity;
    $('set-weather').textContent = { clear: 'Clear', haze: 'Summer haze', rain: 'Monsoon rain' }[g.sky.weather];
    $('set-time').textContent = `${g.sky.clockText()} · advance 3 hours`;
  }
}
