// Bablu Mistri's Jugaad Garage: a right-side panel for landscape phones. Big category chips, a
// list of big option buttons with ₹ prices; the first tap tries an option on the car (which turns
// on the turntable to the left), the second tap pays. DONE leaves, SELL sells the car (two taps).
// Keyboard: arrows move, Enter buys, Esc closes. Gamepad: D-pad / stick, A buys, B closes.
import { CATEGORIES, MODS, valueOf, PRICES } from '../game/garage-data.js';
import { VEHICLE_TYPES } from '../actors/vehicle-types.js';

if (typeof document !== 'undefined') import('./garage.css');

const LABELS = { engine: 'ENGINE', brakes: 'BRAKES', armour: 'ARMOUR', tyres: 'TYRES', horn: 'HORN', neon: 'NEON', sticker: 'STICKER', paint: 'PAINT' };
const rupees = n => `₹${Math.round(n).toLocaleString('en-IN')}`;
const hex = c => `#${(c >>> 0).toString(16).padStart(6, '0').slice(-6)}`;

export class GarageMenu {
  constructor(game) {
    this.game = game;
    this.open = false;
    this.v = null;
    this.cat = 'engine';
    this.sel = undefined; // the option being tried on (undefined: none)
    this.focus = 0;
    this.selling = false;
    this.msg = '';
    this._held = { up: false, down: false, left: false, right: false };
    this.el = null;
  }

  _build() {
    if (this.el || typeof document === 'undefined') return;
    const el = (this.el = document.createElement('div'));
    el.className = 'gmenu';
    el.hidden = true;
    el.innerHTML = `
      <header><div><b class="gm-car"></b><small>Jugaad Garage · Bablu Mistri</small></div><span class="gm-cash"></span></header>
      <nav class="gm-cats">${CATEGORIES.map(c => `<button type="button" data-cat="${c}">${LABELS[c]}</button>`).join('')}</nav>
      <div class="gm-list" role="list"></div>
      <p class="gm-msg" aria-live="polite"></p>
      <footer><button type="button" class="gm-done">DONE</button><button type="button" class="gm-sell">SELL</button></footer>`;
    document.body.appendChild(el);
    this.$ = k => el.querySelector(k);
    el.addEventListener('pointerdown', e => e.stopPropagation()); // taps here never reach the touch controls
    el.querySelector('.gm-cats').addEventListener('click', e => { const c = e.target.closest('[data-cat]')?.dataset.cat; if (c) this.setCat(c); });
    el.querySelector('.gm-list').addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) this.tap(Number(b.dataset.i)); });
    el.querySelector('.gm-done').addEventListener('click', () => this.close());
    el.querySelector('.gm-sell').addEventListener('click', () => this.sell());
  }

  /** Open on car `v` (Garage.openMenu calls this). */
  show(v) {
    this._build();
    this.v = v; this.open = true; this.cat = 'engine'; this.sel = undefined; this.focus = 0; this.selling = false; this.msg = '';
    if (this.el) this.el.hidden = false;
    if (typeof document !== 'undefined') document.body.classList.add('garage-open');
    this.render();
  }

  close() {
    if (!this.open) return;
    this.open = false;
    if (this.el) this.el.hidden = true;
    if (typeof document !== 'undefined') document.body.classList.remove('garage-open');
    this.game.garage?.closedMenu?.(this.v);
    this.v = null;
  }

  rows() { return this.v ? this.game.garage?.options?.(this.cat, this.v) || [] : []; }

  setCat(c) {
    if (c === this.cat) return;
    this.game.garage?.revert?.(this.v); // leaving a category without buying undoes the try-on
    this.cat = c; this.sel = undefined; this.focus = 0; this.selling = false; this.msg = '';
    this.render();
  }
  cycleCat(d) { const i = CATEGORIES.indexOf(this.cat); this.setCat(CATEGORIES[(i + d + CATEGORIES.length) % CATEGORIES.length]); }
  move(d) { const n = this.rows().length; if (n) { this.focus = (this.focus + d + n) % n; this.render(); } }

  /** First tap tries it on; the second (BUY ₹…) pays. */
  tap(i) {
    const g = this.game, G = g.garage, row = this.rows()[i];
    if (!row || !this.v || !G) return;
    this.focus = i; this.selling = false;
    if (row.done || (row.current && !row.price)) { this.msg = row.done ? 'Already fitted.' : ''; this.render(); return; }
    if (this.sel !== row.val) {
      G.revert(this.v);
      G.preview(this.v, this.cat, row.val);
      this.sel = row.val; this.msg = row.price > (g.save?.cash ?? 0) ? 'Not enough cash for this one.' : '';
    } else if (G.buyMod(this.v, this.cat, row.val)) {
      this.sel = undefined;
      this.msg = row.price ? `Fitted · −${rupees(row.price)}` : 'Done.';
      g.hud?.toast?.(`Jugaad Garage: <b>${row.label || LABELS[this.cat]}</b>${row.price ? ` · −${rupees(row.price)}` : ''}`);
    } else this.msg = G.lastRefusal || 'Not enough cash.';
    this.render();
  }

  sell() {
    const G = this.game.garage, r = G?.record?.(this.v);
    if (!r) { this.msg = 'Not your gaadi to sell.'; this.render(); return; }
    if (!this.selling) { this.selling = true; this.msg = `Tap SELL again: ${rupees(valueOf(r) * PRICES.sellShare)}`; this.render(); return; }
    const v = this.v;
    this.close();
    G.sell(v);
  }

  render() {
    if (!this.el || !this.v) return;
    const g = this.game, cash = g.save?.cash ?? 0, v = this.v;
    this.$('.gm-car').textContent = VEHICLE_TYPES[v.type]?.name || v.type;
    this.$('.gm-cash').textContent = rupees(cash);
    for (const b of this.el.querySelectorAll('[data-cat]')) b.classList.toggle('on', b.dataset.cat === this.cat);
    const rows = this.rows();
    this.$('.gm-list').classList.toggle('swatches', this.cat === 'paint');
    this.$('.gm-list').innerHTML = rows.map((r, i) => {
      const trying = this.sel === r.val;
      const price = r.done ? '✓ FITTED' : r.current && !r.price ? '✓' : trying ? `BUY ${r.price ? rupees(r.price) : 'FREE'}` : r.price ? rupees(r.price) : 'FREE';
      const dot = r.color != null ? `<i style="background:${hex(r.color)}"></i>` : '';
      const lvl = MODS[this.cat] ? `<em>${'▮'.repeat(r.val)}${'▯'.repeat(MODS[this.cat].names.length - r.val)}</em>` : '';
      const cls = ['gm-opt', trying && 'trying', r.current && 'current', i === this.focus && 'focus', r.price > cash && !r.done && 'poor'].filter(Boolean).join(' ');
      return `<button type="button" role="listitem" class="${cls}" data-i="${i}">${dot}<span>${escapeHtml(r.label)}${lvl}</span><b>${price}</b></button>`;
    }).join('');
    this.$('.gm-msg').textContent = this.msg;
    const sell = this.$('.gm-sell');
    sell.hidden = !g.garage?.record?.(v);
    sell.classList.toggle('sure', this.selling);
  }

  /** Each frame while open (game.js, before input is zeroed): pad and stick navigation, and leaving. */
  update() {
    if (!this.open) return;
    const g = this.game, inp = g.input, P = g.player;
    if (!this.v || this.v.removed || P?.vehicle !== this.v) { this.close(); return; }
    if (!inp) return;
    if (inp.pressed('pause') || inp.pressed('reload')) { this.close(); return; }
    if (inp.pressed('confirm') || inp.pressed('jump')) this.tap(this.focus);
    const held = inp.held;
    if (held) for (const [k, d, fn] of [['up', -1, 'move'], ['down', 1, 'move'], ['left', -1, 'cycleCat'], ['right', 1, 'cycleCat']]) {
      const h = held.has(k);
      if (h && !this._held[k]) this[fn](d);
      this._held[k] = h;
    }
    // Cash can change under the menu (a fare's tip, a toast): keep the header honest, cheaply.
    const cash = g.save?.cash ?? 0;
    if (cash !== this._cash) { this._cash = cash; if (this.el) this.$('.gm-cash').textContent = rupees(cash); }
  }
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }
