// Coming back to the game after WhatsApp, the camera or a phone call.
//
// - Going to the background (hidden, pagehide, Chrome's freeze): save where the player is
//   (resume.js), flush, pause, close the weapon wheel so slow motion can't stick.
// - The phone takes the graphics away (webglcontextlost): a card covers the black screen,
//   "The city is coming back". three.js rebuilds its caches on webglcontextrestored and uploads
//   everything again at the next draw; the two pictures nothing refreshes (the shadow map, the
//   sky's light) are marked stale here, the shaders compile behind the card, and then one big
//   TAP TO CONTINUE. That tap is a user gesture: full screen and sound come back with it.
// - The graphics never come back (6 s visible, two losses in a minute, a warm-up past 15 s):
//   the card offers a reload, and the menu after it offers TAP TO CARRY ON at the same spot.
// - The screen stays on while actually playing (Screen Wake Lock), and may dim when paused.
//
// The browser objects are passed in, so node tests drive it with fakes.
import { snapshotResume, LIVE_KEY } from '../game/resume.js';

const LOST_VISIBLE_MS = 6000; // lost, on screen, and no restore: give up and reload
const WARM_MAX_MS = 15000; // a warm-up longer than this is stuck
const SHADER_MAX_MS = 4000; // compile-only warm-up: whatever is left compiles on first draw
const LOSS_WINDOW_MS = 60000; // two losses within this go straight to the reload
const LOCK_RETRY_MS = 5000; // after the browser refuses the wake lock
const SNAPSHOT_MS = 10000; // the resume slot follows the player at the autosave's pace

const g0 = name => (typeof globalThis[name] !== 'undefined' ? globalThis[name] : null);
const safeStore = () => { try { return g0('sessionStorage'); } catch { return null; } };

export class Lifecycle {
  constructor(game, { doc = g0('document'), win = g0('window'), nav = g0('navigator'), store = safeStore(), now, ui } = {}) {
    this.game = game;
    this.doc = doc; this.win = win; this.nav = nav; this.store = store;
    this.now = now || (() => (g0('performance') ? performance.now() : Date.now()));
    this.state = 'ok'; // ok | lost | warming | ready | reload
    this.lostAt = 0;
    this.losses = [];
    this.lock = null; // the screen wake lock held
    this._asking = false;
    this._lockRetryAt = 0;
    this._visibleSince = null; // lost and on screen since
    this._warmAt = 0; this._warmStep = 0; this._shadersDone = false;
    this._snapAt = 0;
    this._live = false;
    this._off = [];
    this.ui = ui || new LostCard(doc, () => this.tap());
    const canvas = game?.renderer?.domElement || game?.canvas;
    const on = (t, type, fn, opts) => { if (!t?.addEventListener) return; t.addEventListener(type, fn, opts); this._off.push(() => t.removeEventListener?.(type, fn, opts)); };
    on(canvas, 'webglcontextlost', e => { e?.preventDefault?.(); this.lost(); });
    on(canvas, 'webglcontextrestored', () => this.restored());
    on(doc, 'visibilitychange', () => (doc.hidden ? this.leaving() : this.back()));
    on(win, 'pagehide', () => this.leaving());
    on(win, 'pageshow', e => { if (e?.persisted) this.back(true); });
    on(doc, 'freeze', () => this.leaving());
    on(doc, 'resume', () => this.back());
  }

  /** Anything but a working picture: menus must not close onto a black screen. */
  get blocking() { return this.state !== 'ok'; }

  dispose() { for (const f of this._off) f(); this._off.length = 0; this._releaseLock(); this.ui.hide?.(); }

  /** The page is going away, maybe for good: keep the spot and everything earned, and pause. */
  leaving() {
    const g = this.game;
    if (!g) return;
    this._snapshot();
    if (g.weapons?.toSave && g.save?.set) g.save.set('inventory', g.weapons.toSave());
    g.save?.flush?.();
    if (g.weapons?.wheelOpen) g.weapons.closeWheel?.();
    if (g.started && !g.paused && !g.respawning) g.pause?.openMenu?.(g.pause.tab);
    this._releaseLock();
    this._visibleSince = null;
  }

  /** On screen again (visible, unfrozen, out of the back/forward cache). */
  back(fromCache = false) {
    const g = this.game;
    if (fromCache && this._gl()?.isContextLost?.()) { this.lost(); return; }
    if (g) g._pauseDrawn = false; // behind the menu the picture may be blank: draw it once more
    if (this.state === 'lost' && this._visibleSince === null) this._visibleSince = this.now();
    // The audio stops on hide; a phone may hand it back suspended, and the next tap restarts it anyway.
    if (g?.audio?.enabled && g.audio.ctx?.state === 'suspended') g.audio.ctx.resume?.().catch?.(() => {});
  }

  /** The graphics are gone: cover the black screen until they are back. */
  lost() {
    if (this.state === 'reload') return;
    this.leaving();
    const t = this.now();
    this.losses = this.losses.filter(x => t - x < LOSS_WINDOW_MS);
    this.losses.push(t);
    this.lostAt = t;
    this.state = 'lost';
    this._visibleSince = this.doc?.hidden ? null : t;
    if (this.losses.length >= 2) { this._toReload(); return; }
    this.ui.show?.('lost');
  }

  /** three.js has its context back: mark what it can't rebuild by itself, then warm up behind the card. */
  restored() {
    if (this.state === 'reload') return;
    try { this._rebuild(); } catch (err) { console.warn('GTA Nanded: restoring the graphics failed', err); this._toReload(); return; }
    this.state = 'warming';
    this._warmAt = 0; this._warmStep = 0; this._shadersDone = false;
    this._visibleSince = null;
    this.ui.show?.('lost');
  }

  _rebuild() {
    const g = this.game;
    if (g.restoreGpu) { g.restoreGpu(); return; }
    g._pauseDrawn = false;
    const r = g.renderer;
    if (r?.shadowMap) r.shadowMap.needsUpdate = true;
    g.shadowAt?.set?.(1e9, 0, 0);
    const sky = g.sky;
    if (sky?.refreshEnv) sky.refreshEnv();
    else if (sky?.env) { sky.env.t = Infinity; sky.env.hours = undefined; }
    const post = g.post;
    if (post?.restore) post.restore();
    else post?._dispose?.(); // the next draw builds the targets again and re-checks them on the new context
    if (g.player) g.player.teleportAt = g.time; // the governor's grace: re-uploads aren't a slow GPU
  }

  /** Every frame, from game.update (a few comparisons). */
  update() {
    const g = this.game, doc = this.doc;
    const t = this.now();
    if (this.state === 'lost') {
      if (this._visibleSince !== null && !doc?.hidden && t - this._visibleSince > LOST_VISIBLE_MS) this._toReload();
    } else if (this.state === 'warming' && !doc?.hidden) this._warm(t);
    if (g?.started && this.state === 'ok') {
      if (!this._live) { this._live = true; this._mark('1'); }
      if (!g.paused && t - this._snapAt > SNAPSHOT_MS) { this._snapAt = t; this._snapshot(); }
    }
    this._wake();
  }

  // Hidden pages get no frames: the warm-up only runs on screen, one step per frame.
  _warm(t) {
    const g = this.game;
    if (!this._warmAt) this._warmAt = t;
    if (t - this._warmAt > WARM_MAX_MS) { this._toReload(); return; }
    try {
      if (this._warmStep === 0) {
        g.renderWorld?.(0, false); // the city's own meshes upload and compile; the post targets come back
        this._warmStep = 1;
        if (g.warmShaders) g.warmShaders(() => this.state === 'warming', () => { this._shadersDone = true; });
        else this._shadersDone = true;
        this._shaderAt = t;
      } else if (this._warmStep === 1) {
        if (this._shadersDone || t - this._shaderAt > SHADER_MAX_MS) this._warmStep = 2;
      } else if (this._warmStep < 4) {
        g.renderWorld?.(0, false);
        this._warmStep++;
      } else {
        this.state = 'ready';
        if (g) g._pauseDrawn = false;
        this.ui.show?.('ready');
      }
    } catch (err) { console.warn('GTA Nanded: warming up after a restore failed', err); this._toReload(); }
  }

  /** The card's one button. */
  tap() {
    const g = this.game;
    if (this.state === 'ready') {
      this.state = 'ok';
      this.ui.hide?.();
      if (g) g._pauseDrawn = false;
      if (g?.audio?.enabled) g.audio.ctx?.resume?.().catch?.(() => {});
      if (g?.pause?.open) g.pause.close?.();
    } else if (this.state === 'reload') {
      this.leaving();
      this._mark('reload');
      try { this.win?.location?.reload?.(); } catch { /* nothing more to do */ }
    }
  }

  _toReload() {
    this.state = 'reload';
    this._releaseLock();
    this.ui.show?.('reload');
  }

  _snapshot() {
    const g = this.game;
    const r = snapshotResume(g);
    if (!r || !g.save) return;
    if (g.save.setResume) g.save.setResume(r); else g.save.set?.('resume', r);
  }

  _mark(v) { try { this.store?.setItem(LIVE_KEY, v); } catch { /* storage blocked: no resume */ } }

  _gl() { try { return this.game?.renderer?.getContext?.() || null; } catch { return null; } }

  // ---------------------------------------------------------------- screen wake lock
  _wants() {
    const g = this.game;
    return Boolean(g?.started && !g.paused && this.state === 'ok' && !this.doc?.hidden && g.save?.data?.settings?.awake !== false);
  }

  _wake() {
    const want = this._wants();
    if (!want) { if (this.lock) this._releaseLock(); return; }
    if (this.lock || this._asking) return;
    const wl = this.nav?.wakeLock;
    if (!wl?.request) return;
    const t = this.now();
    if (t < this._lockRetryAt) return;
    this._asking = true;
    const refused = () => { this._asking = false; this._lockRetryAt = this.now() + LOCK_RETRY_MS; };
    try {
      Promise.resolve(wl.request('screen')).then(lock => {
        this._asking = false;
        if (!lock) return;
        if (!this._wants()) { try { lock.release?.(); } catch { /* already gone */ } return; }
        this.lock = lock;
        // The browser drops the lock on hide: forget it, so it is asked for again on return.
        lock.addEventListener?.('release', () => { if (this.lock === lock) this.lock = null; });
      }, refused);
    } catch { refused(); }
  }

  _releaseLock() {
    const lock = this.lock;
    if (!lock) return;
    this.lock = null;
    try { Promise.resolve(lock.release?.()).catch(() => {}); } catch { /* already released */ }
  }
}

/**
 * The full-screen card over the pause menu (z-index 40; fatal is 50). Its own DOM and styles, built
 * the first time it is needed. Bright text on a dark card over what is a black canvas anyway.
 */
export class LostCard {
  constructor(doc, onTap) {
    this.doc = doc; this.onTap = onTap;
    this.el = null; this.mode = null;
  }

  _build() {
    const d = this.doc;
    if (this.el || !d?.createElement || !d.body) return this.el;
    if (!d.getElementById?.('gpu-lost-style')) {
      const st = d.createElement('style');
      st.id = 'gpu-lost-style';
      st.textContent = `
#gpu-lost{position:fixed;inset:0;z-index:40;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;
  padding:max(16px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));
  background:rgba(12,14,22,.94);color:#fff;font-family:inherit;text-align:center;touch-action:manipulation;user-select:none;-webkit-user-select:none}
#gpu-lost[hidden]{display:none}
#gpu-lost .gl-dot{width:18px;height:18px;border-radius:50%;background:#ffc93c;box-shadow:0 0 18px #ffc93c;animation:gl-pulse 1s ease-in-out infinite alternate}
#gpu-lost .gl-mr{font-size:clamp(22px,5vw,34px);font-weight:800;line-height:1.2}
#gpu-lost .gl-en{font-size:clamp(16px,3.4vw,22px);color:#e8ecf4;max-width:34em;line-height:1.35}
#gpu-lost button{min-height:64px;min-width:240px;padding:0 28px;border:0;border-radius:14px;background:#ffc93c;color:#141414;
  font:inherit;font-size:clamp(20px,4.4vw,28px);font-weight:900;letter-spacing:.04em;cursor:pointer}
#gpu-lost button[hidden]{display:none}
body.gpu-lost .touch{display:none !important}
@keyframes gl-pulse{from{transform:scale(.7);opacity:.6}to{transform:scale(1.15);opacity:1}}
@media (prefers-reduced-motion:reduce){#gpu-lost .gl-dot{animation:none}}`;
      (d.head || d.body).appendChild(st);
    }
    const el = d.createElement('section');
    el.id = 'gpu-lost';
    el.setAttribute?.('role', 'alertdialog');
    el.setAttribute?.('aria-live', 'assertive');
    el.hidden = true;
    el.innerHTML = '<div class="gl-dot"></div><div class="gl-mr" lang="mr">नांदेड परत येतंय…</div><div class="gl-en"></div><button type="button" hidden></button>';
    this.en = el.querySelector('.gl-en');
    this.btn = el.querySelector('button');
    this.dot = el.querySelector('.gl-dot');
    // The whole card is the button once it shows: a phone player shouldn't have to aim.
    el.addEventListener('click', e => { e.stopPropagation?.(); if (!this.btn.hidden) this.onTap(); });
    d.body.appendChild(el);
    this.el = el;
    return el;
  }

  show(mode) {
    if (!this._build()) return;
    if (mode === this.mode && !this.el.hidden) return;
    this.mode = mode;
    const text = {
      lost: ['The city is coming back', ''],
      ready: ['The city is back.', 'TAP TO CONTINUE ▶'],
      reload: ["The picture didn't come back. Reloading the city takes about 10 s — you carry on right here.", 'TAP TO RELOAD ▶'],
    }[mode] || ['', ''];
    this.en.textContent = text[0];
    this.btn.textContent = text[1];
    this.btn.hidden = !text[1];
    this.dot.hidden = mode !== 'lost';
    this.el.hidden = false;
    this.doc.body.classList?.add('gpu-lost');
  }

  hide() {
    this.mode = null;
    if (this.el) this.el.hidden = true;
    this.doc?.body?.classList?.remove('gpu-lost');
  }
}
