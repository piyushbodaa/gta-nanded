// Heads-up display: radar, health, cash, stars, help box, subtitles and the big cards.
import { Minimap } from './minimap.js';
import { clamp, dist } from '../core/math.js';
import { VEHICLE_TYPES } from '../actors/vehicle-types.js';

const $ = id => document.getElementById(id);

export class Hud {
  constructor(game) {
    this.game = game;
    this.root = $('hud');
    this.radar = new Minimap(game, $('radar'));
    this.el = {
      clock: $('hud-clock'), cash: $('hud-cash'), stars: $('hud-stars'), health: $('hud-health'), stamina: $('hud-stamina'),
      help: $('hud-help'), area: $('hud-area'), vehicle: $('hud-vehicle'), speed: $('hud-speed'), speedNum: $('hud-speed-num'), gear: $('hud-gear'),
      objective: $('hud-objective'), subtitle: $('hud-subtitle'), bark: $('hud-bark'), timer: $('hud-timer'), big: $('hud-big'), toast: $('hud-toast'),
      cashDelta: $('hud-cash-delta'), prompt: $('hud-prompt'),
    };
    this.timers = { help: 0, subtitle: 0, bark: 0, area: 0, vehicle: 0, big: 0, toast: 0, cash: 0 };
    this.shownCash = 0;
    this.lastDistrict = '';
    this.blipList = [];
    this.route = null;
    this.radarT = 0;
    this.textT = 0;
    this.prompts = [];
    addEventListener('resize', () => this.radar.resize());
    requestAnimationFrame(() => this.radar.resize());
  }

  show(on) { this.root.hidden = !on; if (on) requestAnimationFrame(() => this.radar.resize()); }

  help(html, seconds = 6) { this.el.help.innerHTML = html; this.el.help.hidden = false; this.timers.help = seconds; }
  subtitle(speaker, text, seconds = 4.5, color = '#ffd27a') {
    this.el.subtitle.innerHTML = speaker ? `<b style="color:${color}">${speaker}:</b> ${text}` : text;
    this.el.subtitle.hidden = false; this.timers.subtitle = seconds;
  }
  clearSubtitle() { this.el.subtitle.hidden = true; this.timers.subtitle = 0; }
  objective(text) { this.el.objective.innerHTML = text || ''; this.el.objective.hidden = !text; }
  bark(text) { this.el.bark.textContent = text; this.el.bark.hidden = false; this.timers.bark = 2.6; this.el.bark.classList.remove('pop'); void this.el.bark.offsetWidth; this.el.bark.classList.add('pop'); }
  toast(text, seconds = 3) { this.el.toast.innerHTML = text; this.el.toast.hidden = false; this.timers.toast = seconds; }
  big(title, sub = '', kind = 'passed', seconds = 4.5) {
    const el = this.el.big;
    el.className = `big-message ${kind}`;
    el.innerHTML = `<strong>${title}</strong>${sub ? `<span>${sub}</span>` : ''}`;
    el.hidden = false; this.timers.big = seconds;
  }
  area(name) { this.el.area.innerHTML = name; this.el.area.hidden = false; this.timers.area = 4; this.el.area.classList.remove('fade'); void this.el.area.offsetWidth; this.el.area.classList.add('fade'); }
  vehicleName(name, extra = '') { this.el.vehicle.innerHTML = `<strong>${name}</strong>${extra ? `<span>${extra}</span>` : ''}`; this.el.vehicle.hidden = false; this.timers.vehicle = 3.5; }
  setTimer(seconds, label = '') {
    if (seconds === null || seconds === undefined) { this.el.timer.hidden = true; return; }
    const s = Math.max(0, Math.ceil(seconds));
    this.el.timer.innerHTML = `${label ? `<small>${label}</small>` : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.el.timer.hidden = false;
    this.el.timer.classList.toggle('urgent', seconds < 10);
  }
  cashChange(delta) {
    const el = this.el.cashDelta;
    el.textContent = `${delta >= 0 ? '+' : '−'}₹${Math.abs(delta).toLocaleString('en-IN')}`;
    el.className = `cash-delta ${delta >= 0 ? 'gain' : 'loss'}`;
    el.hidden = false; this.timers.cash = 2.5;
  }
  /** Contextual button hints near the bottom: [{key, label}] */
  prompt(list) {
    const key = list.map(p => p.key + p.label).join('|');
    if (key === this._promptKey) return;
    this._promptKey = key;
    const touch = this.game.input.mode === 'touch';
    this.el.prompt.innerHTML = list.map(p => `<span>${touch ? '' : `<kbd>${p.key}</kbd>`}${p.label}</span>`).join('');
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
      }
    }
    // Cash counts up like a slot machine.
    const cash = g.save?.cash ?? 0;
    if (this.shownCash !== cash) {
      const diff = cash - this.shownCash;
      this.shownCash += Math.abs(diff) < 3 ? diff : Math.round(diff * Math.min(1, dt * 8));
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
    }
    // Speedometer.
    const v = g.player.vehicle;
    this.el.speed.hidden = !v;
    if (v) {
      const kmh = Math.round(Math.abs(v.vx * Math.sin(v.heading) + v.vz * Math.cos(v.heading)) * 3.6);
      this.el.speedNum.textContent = kmh;
      this.el.gear.textContent = v.gear < 0 ? 'R' : kmh < 1 ? 'N' : String(v.gear);
      const hp = clamp(v.health / 1000, 0, 1);
      this.el.speed.style.setProperty('--hp', hp);
      this.el.speed.classList.toggle('damaged', hp < 0.35);
    }
    // Radar at ~30 fps.
    this.radarT -= dt;
    if (this.radarT <= 0) { this.radarT = 1 / 30; this.radar.draw(this.collectBlips(), this.route); }
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
      if (v) list.push({ key: 'F', label: v.driver ? `Jack ${VEHICLE_TYPES[v.type].name}` : `Get in ${VEHICLE_TYPES[v.type].name}` });
      const act = g.contextAction?.();
      if (act) list.push({ key: 'Q', label: act.label });
    } else if (P.state === 'driving') {
      const act = g.contextAction?.();
      if (act) list.push({ key: act.key || 'Q', label: act.label });
    }
    this.prompt(list);
  }
}
