// The RETRY / QUIT card after MISSION FAILED (or WASTED / BUSTED during a mission, or a lost race).
// Big thumb-sized buttons on a phone, Enter / F / Space or gamepad A / Y to retry, Esc or B / Start
// to quit. It waits for the player: no timeout. It owns `g.respawning` while it is up, so no
// mission starts, nobody busts the player and the pause menu stays shut.
import { tapButtons } from './tap.js';

const CSS = `
#retry { position: fixed; left: 0; right: 0; bottom: calc(12% + env(safe-area-inset-bottom, 0px)); z-index: 16; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 0 16px; opacity: 0; pointer-events: none; transition: opacity .3s; }
#retry.show { opacity: 1; pointer-events: auto; }
#retry .retry-row { display: flex; gap: 16px; flex-wrap: wrap; justify-content: center; }
#retry button { min-height: 64px; min-width: 160px; padding: 0 22px; border-radius: 14px; border: 2px solid #ffffffd9; background: #000000b3; color: #fff; font: 700 22px/1 system-ui, sans-serif; letter-spacing: 1px; touch-action: manipulation; cursor: pointer; }
#retry button.retry-go { background: #f4c430; color: #111; border-color: #f4c430; }
#retry button:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
#retry .retry-from { font: 600 15px/1.2 system-ui, sans-serif; color: #fff; text-shadow: 0 1px 3px #000, 0 0 2px #000; }
#retry kbd { font: 600 12px/1 system-ui, sans-serif; opacity: .7; margin-left: 8px; }
body.retry-choice .touch { display: none !important; }
body.retry-fade::after { content: ''; position: fixed; inset: 0; background: #000; z-index: 35; pointer-events: none; animation: retry-fade .9s ease-out forwards; }
@keyframes retry-fade { 0%, 30% { opacity: 1; } 100% { opacity: 0; } }
@media (pointer: coarse) { #retry kbd { display: none; } }
`;

export class RetryCard {
  constructor(game, doc = typeof document !== 'undefined' ? document : null) {
    this.game = game;
    this.doc = doc;
    this.open = false;
    this.shown = false; // the buttons have faded in and take input
    this._cb = null;
    this._t = null;
    this.root = null;
    this._onKey = e => {
      if (!this.shown) return;
      if (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyF') { e.preventDefault(); this.choose('retry'); }
      else if (e.code === 'Escape') { e.preventDefault(); this.choose('quit'); }
    };
  }

  /** Build the card once (index.html may already hold a static #retry). */
  _build() {
    if (this.root || !this.doc) return this.root;
    const d = this.doc;
    if (!d.getElementById('retry-style')) {
      const st = d.createElement('style');
      st.id = 'retry-style'; st.textContent = CSS;
      d.head.appendChild(st);
    }
    let root = d.getElementById('retry');
    if (!root) {
      root = d.createElement('div');
      root.id = 'retry';
      d.body.appendChild(root);
    }
    root.setAttribute('role', 'dialog');
    root.innerHTML = '<div class="retry-row"><button type="button" class="retry-go">RETRY · पुन्हा<kbd>Enter</kbd></button>'
      + '<button type="button" class="retry-quit">QUIT<kbd>Esc</kbd></button></div><div class="retry-from"></div>';
    root.hidden = true;
    root.querySelector('.retry-go').addEventListener('click', () => this.choose('retry'));
    root.querySelector('.retry-quit').addEventListener('click', () => this.choose('quit'));
    tapButtons(root);
    this.root = root;
    return root;
  }

  /** Show the card: { title, from (where a retry begins), onRetry, onQuit }. */
  offer({ title = 'MISSION FAILED', from = '', onRetry, onQuit } = {}) {
    const g = this.game;
    this._cb = { onRetry, onQuit };
    this.title = title;
    this.open = true;
    this.shown = false;
    g.respawning = true;
    g.weapons?.closeWheel?.();
    const root = this._build();
    this.doc?.body?.classList.add('retry-choice');
    if (root) {
      root.querySelector('.retry-from').textContent = from ? `From: ${from}` : '';
      root.setAttribute('aria-label', title);
      root.classList.remove('show');
      root.hidden = false;
    }
    clearTimeout(this._t);
    this._t = setTimeout(() => this._reveal(), 1200);
  }

  _reveal() {
    if (!this.open) return;
    this.shown = true;
    this.root?.classList.add('show');
    this.root?.querySelector('.retry-go')?.focus?.({ preventScroll: true });
    if (typeof addEventListener === 'function') addEventListener('keydown', this._onKey);
  }

  /** Hide without choosing (the callbacks are dropped). */
  close() {
    clearTimeout(this._t);
    this.open = false; this.shown = false;
    if (typeof removeEventListener === 'function') removeEventListener('keydown', this._onKey);
    this.doc?.body?.classList.remove('retry-choice');
    if (this.root) { this.root.classList.remove('show'); this.root.hidden = true; }
  }

  choose(which) {
    if (!this.open) return;
    const cb = this._cb;
    this._cb = null;
    this.close();
    (which === 'retry' ? cb?.onRetry : cb?.onQuit)?.();
  }

  /** A short black fade that covers a retry's teleport and the streets filling in. */
  fade() {
    const b = this.doc?.body;
    if (!b) return;
    b.classList.remove('retry-fade');
    void b.offsetWidth; // restart the animation
    b.classList.add('retry-fade');
    clearTimeout(this._fadeT);
    this._fadeT = setTimeout(() => b.classList.remove('retry-fade'), 950);
  }

  /** Gamepad (and any key the game's input maps): A / Y retry, B / Start quit. Called every frame. */
  update() {
    if (!this.shown) return;
    const inp = this.game.input;
    if (!inp?.pressed) return;
    if (inp.pressed('confirm') || inp.pressed('jump') || inp.pressed('enter')) this.choose('retry');
    else if (inp.pressed('pause') || inp.pressed('reload')) this.choose('quit');
  }
}
