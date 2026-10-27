// Heads-up display: radar, health, cash, stars, help box, subtitles and the big cards.
import { Minimap } from './minimap.js';
import { clamp, dist } from '../core/math.js';
import { VEHICLE_TYPES } from '../actors/vehicle-types.js';
import { key } from './controls.js';

const $ = id => document.getElementById(id);

/**
 * The cash counter's next value. It counts towards the real amount like a slot machine: a share of the gap
 * each frame, but at least ₹1, because at 60 fps a rounded share of a small gap is 0 and it would stop short.
 */
export function countCash(shown, cash, dt) {
  const diff = cash - shown;
  if (Math.abs(diff) < 3) return cash;
  return shown + (Math.round(diff * Math.min(1, dt * 8)) || Math.sign(diff));
}

export class Hud {
  constructor(game) {
    this.game = game;
    this.root = $('hud');
    this.radar = new Minimap(game, $('radar'));
    this.el = {
      clock: $('hud-clock'), cash: $('hud-cash'), stars: $('hud-stars'), health: $('hud-health'), stamina: $('hud-stamina'),
      help: $('hud-help'), area: $('hud-area'), vehicle: $('hud-vehicle'), speed: $('hud-speed'), speedNum: $('hud-speed-num'), gear: $('hud-gear'),
      objective: $('hud-objective'), subtitle: $('hud-subtitle'), bark: $('hud-bark'), timer: $('hud-timer'), big: $('hud-big'), toast: $('hud-toast'),
      cashDelta: $('hud-cash-delta'), prompt: $('hud-prompt'), perf: $('hud-perf'), hint: $('hud-hint'),
    };
    this.perfOn = false;
    this.perfT = 0;
    this.timers = { help: 0, subtitle: 0, bark: 0, area: 0, vehicle: 0, big: 0, toast: 0, cash: 0 };
    this.shownCash = 0;
    this.lastDistrict = '';
    this.blipList = [];
    this.route = null;
    this.radarT = 0;
    this.textT = 0;
    this.waypointT = 0;
    this.prompts = [];
    // What the per-frame readouts show now, so they touch the DOM only when it changes.
    this.objText = '';
    this.timerHtml = '';
    this.speedShown = { kmh: -1, gear: '', hp: -1 };
    this.helpLater = null; // [html, seconds] waiting for a big card to go
    addEventListener('resize', () => this.radar.resize());
    requestAnimationFrame(() => this.radar.resize());
  }

  show(on) { this.root.hidden = !on; if (on) requestAnimationFrame(() => this.radar.resize()); }

  help(html, seconds = 6) {
    // On touch screens the help box sits mid-screen, where a big card (MISSION PASSED, WANTED) goes: it waits for the card.
    if (this.timers.big > 0 && this.game.input.touch?.active) { this.helpLater = [html, seconds]; return; }
    this.el.help.innerHTML = html; this.el.help.hidden = false; this.timers.help = seconds;
  }
  subtitle(speaker, text, seconds = 4.5, color = '#ffd27a') {
    this.el.subtitle.innerHTML = speaker ? `<b style="color:${color}">${speaker}:</b> ${text}` : text;
    this.el.subtitle.hidden = false; this.timers.subtitle = seconds;
  }
  clearSubtitle() { this.el.subtitle.hidden = true; this.timers.subtitle = 0; }
  objective(text) {
    // Missions and jobs set it every frame: write only when it changes.
    text = text || '';
    if (text === this.objText) return;
    this.objText = text;
    this.el.objective.innerHTML = text; this.el.objective.hidden = !text;
  }
  bark(text) { this.el.bark.textContent = text; this.el.bark.hidden = false; this.timers.bark = 2.6; this.el.bark.classList.remove('pop'); void this.el.bark.offsetWidth; this.el.bark.classList.add('pop'); }
  toast(text, seconds = 3) { this.el.toast.innerHTML = text; this.el.toast.hidden = false; this.timers.toast = seconds; }
  big(title, sub = '', kind = 'passed', seconds = 4.5) {
    const el = this.el.big;
    // The line under the title is a sentence, even when it starts with a name ('Sand tipper was wrecked.').
    if (sub) sub = String(sub)[0].toUpperCase() + String(sub).slice(1);
    el.className = `big-message ${kind}`;
    el.innerHTML = `<strong>${title}</strong>${sub ? `<span>${sub}</span>` : ''}`;
    el.hidden = false; this.timers.big = seconds;
    // A help box already up on a touch screen steps aside, and comes back after the card with the time it had left.
    if (this.game.input.touch?.active && !this.el.help.hidden && this.timers.help > 0) {
      this.helpLater = [this.el.help.innerHTML, this.timers.help];
      this.el.help.hidden = true; this.timers.help = 0;
    }
  }
  area(name) { this.el.area.innerHTML = name; this.el.area.hidden = false; this.timers.area = 4; this.el.area.classList.remove('fade'); void this.el.area.offsetWidth; this.el.area.classList.add('fade'); }
  vehicleName(name, extra = '') { this.el.vehicle.innerHTML = `<strong>${name}</strong>${extra ? `<span>${extra}</span>` : ''}`; this.el.vehicle.hidden = false; this.timers.vehicle = 3.5; }
  /** A countdown (red in its last 10 s), or a stopwatch with urgent false: counting up never runs out. */
  setTimer(seconds, label = '', urgent = seconds < 10) {
    const el = this.el.timer;
    if (seconds === null || seconds === undefined) { el.hidden = true; return; }
    const s = Math.max(0, Math.ceil(seconds));
    const html = `${label ? `<small>${label}</small>` : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    // Set every frame: write only when the readout changes.
    if (html !== this.timerHtml) { this.timerHtml = html; el.innerHTML = html; }
    el.hidden = false;
    el.classList.toggle('urgent', Boolean(urgent));
  }
  cashChange(delta) {
    const el = this.el.cashDelta;
    el.textContent = `${delta >= 0 ? '+' : '−'}₹${Math.abs(delta).toLocaleString('en-IN')}`;
    el.className = `cash-delta ${delta >= 0 ? 'gain' : 'loss'}`;
    el.hidden = false; this.timers.cash = 2.5;
    // Restart the rise, or a change soon after another shows at the first one's faded end.
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  }
  /** The performance readout (Settings): what this device really does, for tuning and bug reports. */
  showPerf(on) { this.perfOn = on; this.el.perf.hidden = !on; this.perfT = 0; }
  _perf() {
    const g = this.game, q = g.quality, p = g.perf, c = g.renderer.domElement;
    const mem = performance.memory ? ` · ${Math.round(performance.memory.usedJSHeapSize / 1e6)} MB` : '';
    this.el.perf.textContent = `${Math.round(p.fps)} fps · ${Math.round(p.ms)} ms (worst ${Math.round(p.worstMs)}) · CPU ${g.cpuMs.toFixed(1)} · ${c.width}×${c.height} ${q.settings.name}${q.crowd < 1 ? ` · crowd ${Math.round(q.crowd * 100)}%` : ''} · ${q.gpu}${mem}`;
  }

  /** Contextual button hints near the bottom: [{action, label}], with the key or button of the device in use. */
  prompt(list) {
    const mode = this.game.input.mode;
    const id = mode + list.map(p => p.action + p.label).join('|');
    if (id === this._promptKey) return;
    this._promptKey = id;
    const touch = mode === 'touch';
    this.el.prompt.innerHTML = list.map(p => `<span>${touch ? '' : key(this.game, p.action)}${p.label}</span>`).join('');
    this.el.prompt.hidden = !list.length || touch;
  }

  update(dt) {
    const g = this.game;
    for (const k in this.timers) {
      if (this.timers[k] <= 0) continue;
      this.timers[k] -= dt;
      if (this.timers[k] <= 0) {
        if (k === 'cash') this.el.cashDelta.hidden = true;
        else if (this.el[k]) this.el[k].hidden = true;
        if (k === 'big' && this.helpLater) { const [html, seconds] = this.helpLater; this.helpLater = null; this.help(html, seconds); }
      }
    }
    // Cash counts up like a slot machine.
    const cash = g.save?.cash ?? 0;
    if (this.shownCash !== cash) {
      this.shownCash = countCash(this.shownCash, cash, dt);
      this.el.cash.textContent = `₹${Math.round(this.shownCash).toLocaleString('en-IN')}`;
    }
    this.textT -= dt;
    if (this.textT <= 0) {
      this.textT = 0.2;
      this.el.clock.textContent = g.sky.clockText();
      const lvl = g.police?.level || 0;
      const flash = lvl > 0 && !g.police.seen && Math.floor(g.time * 2.5) % 2;
      this.el.stars.innerHTML = [1, 2, 3, 4, 5].map(i => `<i class="${i <= lvl ? (flash ? 'on flash' : 'on') : ''}">★</i>`).join('');
      this.el.health.style.transform = `scaleX(${clamp(g.player.health / g.player.maxHealth, 0, 1)})`;
      this.el.health.parentElement.classList.toggle('low', g.player.health < 30);
      this.el.stamina.style.transform = `scaleX(${g.player.stamina})`;
      // District name, GTA style, whenever it changes.
      const pos = g.player.pos;
      const d = g.city.district(pos.x, pos.z).name;
      if (d !== this.lastDistrict) { if (this.lastDistrict) this.area(d); this.lastDistrict = d; g.onDistrict?.(d); }
      this._prompts();
      // The corner hint names the keys of the device in use (touch screens hide it).
      if (g.input.mode !== this.hintMode) { this.hintMode = g.input.mode; this.el.hint.innerHTML = `${key(g, 'pause')} Pause ${key(g, 'map')} Map`; }
    }
    // Speedometer: every frame while driving, so it writes only what changed.
    const v = g.player.vehicle, shown = this.speedShown;
    if (this.el.speed.hidden !== !v) this.el.speed.hidden = !v;
    if (v) {
      const kmh = Math.round(Math.abs(v.vx * Math.sin(v.heading) + v.vz * Math.cos(v.heading)) * 3.6);
      const gear = v.gear < 0 ? 'R' : kmh < 1 ? 'N' : String(v.gear);
      if (kmh !== shown.kmh) { shown.kmh = kmh; this.el.speedNum.textContent = kmh; }
      if (gear !== shown.gear) { shown.gear = gear; this.el.gear.textContent = gear; }
      const hp = clamp(v.health / 1000, 0, 1);
      if (hp !== shown.hp) { shown.hp = hp; this.el.speed.style.setProperty('--hp', hp); this.el.speed.classList.toggle('damaged', hp < 0.35); }
    }
    // The waypoint's GPS line follows the player whenever no mission or job is drawing its own route.
    this.waypointT -= dt;
    if (this.waypointT <= 0) { this.waypointT = 1.2; this._waypointRoute(); }
    // Radar at ~30 fps.
    this.radarT -= dt;
    if (this.radarT <= 0) { this.radarT = 1 / 30; this.radar.draw(this.collectBlips(), this.route); }
    if (this.perfOn && (this.perfT -= dt) <= 0) { this.perfT = 0.5; this._perf(); }
  }

  /** Route to the map waypoint from where the player is now; arriving clears it. */
  _waypointRoute() {
    const g = this.game, wp = g.waypoint;
    if (!wp || g.missions?.active || g.jobs?.active) return;
    const pos = g.player.pos;
    if (dist(pos.x, pos.z, wp.x, wp.z) < 20) { g.waypoint = null; this.route = null; return; }
    this.route = g.net.route(pos.x, pos.z, wp.x, wp.z);
    if (this.route) this.route.color = '#c77dff';
  }

  collectBlips() {
    const g = this.game, out = [];
    for (const b of this.blipList) out.push(b);
    if (g.missions) for (const b of g.missions.blips()) out.push(b);
    if (g.waypoint) out.push({ x: g.waypoint.x, z: g.waypoint.z, color: '#c77dff' });
    if (g.police?.level) for (const u of g.police.units) out.push({ x: u.v.x, z: u.v.z, kind: 'police', clamp: false });
    for (const b of g.staticBlips || []) {
      const pos = g.player.pos;
      if (dist(b.x, b.z, pos.x, pos.z) < 260) out.push({ ...b, clamp: false });
    }
    return out;
  }

  _prompts() {
    const g = this.game, P = g.player, list = [];
    if (P.state === 'foot') {
      const v = g.nearestEnterable(P.x, P.z, 4.2);
      if (v) list.push({ action: 'enter', label: v.driver ? `Jack ${VEHICLE_TYPES[v.type].name}` : `Get in ${VEHICLE_TYPES[v.type].name}` });
      const act = g.contextAction?.();
      if (act) list.push({ action: 'action', label: act.label });
    } else if (P.state === 'driving') {
      // Behind the wheel the context action starts or stops a job (jobs.contextAction names its key, N).
      const act = g.contextAction?.();
      if (act) list.push({ action: act.key === 'N' ? 'job' : 'action', label: act.label });
    }
    this.prompt(list);
  }
}
