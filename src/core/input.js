// One input state for keyboard + mouse, gamepad and touch. Systems read
// continuous axes from `state` and consume one-shot presses with `pressed()`.
import { clamp } from './math.js';

const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  Space: 'jump', ShiftLeft: 'sprint', ShiftRight: 'sprint', KeyF: 'enter', KeyE: 'enter', KeyQ: 'action', KeyH: 'horn',
  KeyM: 'map', Escape: 'pause', KeyP: 'pause', KeyV: 'camera', KeyR: 'radio', KeyC: 'lookBack', KeyN: 'job', KeyJ: 'attack',
  KeyX: 'photo', KeyB: 'phone', Enter: 'confirm', KeyG: 'grenade',
  // Held Tab is the weapon wheel, as in GTA (M stays the map); 1-7 pick a wheel slot straight away.
  Tab: 'wheelHold', Digit1: 'slot1', Digit2: 'slot2', Digit3: 'slot3', Digit4: 'slot4', Digit5: 'slot5', Digit6: 'slot6', Digit7: 'slot7',
  Numpad1: 'slot1', Numpad2: 'slot2', Numpad3: 'slot3', Numpad4: 'slot4', Numpad5: 'slot5', Numpad6: 'slot6', Numpad7: 'slot7',
}; // No Ctrl: held for a punch, Ctrl+W would close the tab, and no page can stop that.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.held = new Set();
    this.keys = new Set(); // physical keys down (codes), so W and ArrowUp can share 'up'
    this.padHeld = new Set(); // gamepad buttons down, for one-shot presses on the way down
    this.padRun = new Set(); // gamepads whose L3 click started a run (their index)
    this.events = new Set();
    this.state = { moveX: 0, moveY: 0, throttle: 0, brake: 0, steer: 0, handbrake: false, sprint: false, horn: false, lookBack: false, attackHeld: false, aim: false, wheelHeld: false, stickX: 0, stickY: 0 };
    this.look = { x: 0, y: 0 }; // accumulated look delta (radians), consumed by the camera
    this.lastLookAt = 0; // time of the last deliberate look input
    this.touch = { moveX: 0, moveY: 0, gas: 0, brake: 0, handbrake: false, sprint: false, horn: false, fire: false, fire2: false, aim: false, active: false };
    // Set by the game each frame while the player is on foot: the mouse wheel then changes weapon instead of
    // zooming, and the gamepad's triggers and RB mean fire, aim and the weapon wheel instead of gas, brake and radio.
    this.weaponScroll = false;
    this.scrollAcc = 0; // a trackpad's small wheel steps, adding up to a notch
    this.mode = 'keyboard'; // keyboard | touch | gamepad
    this.keyboardUsed = false;
    this.enabled = true;
    this.live = false; // set when play starts: until then keys belong to the cover and the intro
    this.pointerLocked = false;
    this.setSensitivity(1);
    this._bind();
  }

  /** Look speed for the mouse, a dragging finger and the right stick alike (1 is the default). */
  setSensitivity(k) { this.lookScale = k; this.mouseSensitivity = 0.0024 * k; }

  _bind() {
    addEventListener('keydown', e => {
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
      const a = KEYMAP[e.code];
      if (!a) return;
      // A focused button takes Space and Enter itself; cancelling the keydown would stop its click.
      if (t instanceof HTMLButtonElement && (e.code === 'Space' || e.code === 'Enter')) return;
      // Before play, and on a menu button, Tab moves focus as usual: the only way a keyboard reaches them.
      if (e.code === 'Tab' && (!this.live || (t !== this.canvas && t !== document.body))) return;
      this.mode = 'keyboard'; this.keyboardUsed = true;
      // Keys pressed on the cover or during the intro would otherwise act on the first frame of play.
      if (!this.live) return;
      if (['up', 'down', 'left', 'right', 'jump', 'map', 'wheelHold'].includes(a)) e.preventDefault();
      if (!e.repeat && a !== 'wheelHold') this.events.add(a); // the wheel is held, not pressed
      this.keys.add(e.code);
      this.held.add(a);
    });
    addEventListener('keyup', e => {
      const a = KEYMAP[e.code];
      if (!a) return;
      this.keys.delete(e.code);
      // Let go of ArrowUp while W is still down: still driving.
      for (const k of this.keys) if (KEYMAP[k] === a) return;
      this.held.delete(a);
    });
    addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.clear(); });

    const c = this.canvas;
    // A tap fires the mouse events of a click after the finger lifts. They are not clicks, or
    // every tap on the view would throw a punch: Chrome marks them, and the time since the
    // last touch on the view catches the rest (Safari).
    const fromTouch = e => e.sourceCapabilities?.firesTouchEvents || performance.now() - this._touchAt < 1000;
    this._touchAt = -1e9;
    c.addEventListener('mousedown', e => {
      if (!this.enabled || fromTouch(e)) return;
      if (e.button === 0) {
        if (!this.pointerLocked && matchMedia('(pointer: fine)').matches) c.requestPointerLock?.()?.catch?.(() => {});
        else { this.events.add('attack'); this.held.add('attackMouse'); }
      }
      if (e.button === 2) this.held.add('aim');
    });
    addEventListener('mouseup', e => { if (e.button === 0) this.held.delete('attackMouse'); if (e.button === 2) this.held.delete('aim'); });
    c.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('pointerlockchange', () => { this.pointerLocked = document.pointerLockElement === c; });
    addEventListener('mousemove', e => {
      if (!this.pointerLocked || !this.enabled) return;
      this.look.x -= e.movementX * this.mouseSensitivity;
      this.look.y -= e.movementY * this.mouseSensitivity;
      this.lastLookAt = performance.now();
      this.mode = 'keyboard';
    });
    // Drag to look when the pointer isn't locked (touch, or a mouse before the first click).
    let drag = null;
    c.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && this.pointerLocked) return;
      if (e.pointerType !== 'mouse') { this.mode = 'touch'; this._touchAt = performance.now(); }
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id || !this.enabled) return;
      const k = (e.pointerType === 'mouse' ? 0.005 : 0.0065) * this.lookScale;
      this.look.x -= (e.clientX - drag.x) * k;
      this.look.y -= (e.clientY - drag.y) * k;
      drag.x = e.clientX; drag.y = e.clientY;
      this.lastLookAt = performance.now();
    });
    const end = e => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      if (e.pointerType !== 'mouse') this._touchAt = performance.now(); // a long press's mouse events come after this
    };
    addEventListener('pointerup', end);
    addEventListener('pointercancel', end);
    // Zoom only over the street itself: wheeling the pause menu's city map must not move the camera.
    // One notch is a step; a trackpad's stream of small deltas adds up to the same.
    // On foot the wheel changes weapon instead (V still steps the camera distance): a notch is one weapon, and
    // with the weapon wheel held it moves within the highlighted slot.
    addEventListener('wheel', e => {
      if (e.target !== c || !this.enabled) return;
      const step = clamp(e.deltaY / (e.deltaMode ? 3 : 100), -1, 1);
      if (!this.weaponScroll) { this.zoom = (this.zoom || 0) + step; this.scrollAcc = 0; return; }
      if (Math.sign(step) !== Math.sign(this.scrollAcc)) this.scrollAcc = 0; // turned back: start a fresh notch
      this.scrollAcc += step;
      if (Math.abs(this.scrollAcc) < 1) return;
      const next = this.scrollAcc > 0, inWheel = this.held.has('wheelHold');
      this.events.add(inWheel ? (next ? 'wheelNext' : 'wheelPrev') : next ? 'weaponNext' : 'weaponPrev');
      this.scrollAcc = 0;
    }, { passive: true });
  }

  /**
   * Drop everything held and pressed (menus opening, the window losing focus). Gamepad buttons
   * still down stay remembered (`padHeld`): Start, held while the pause menu opens, would
   * otherwise read as a fresh press next frame and close it again.
   */
  clear() {
    this.held.clear();
    this.keys.clear();
    this.padRun.clear();
    this.events.clear();
    Object.assign(this.touch, { moveX: 0, moveY: 0, gas: 0, brake: 0, handbrake: false, sprint: false, horn: false, fire: false, fire2: false, aim: false });
    this.scrollAcc = 0;
  }

  /** Touch/gamepad UI sends one-shot actions through here. */
  trigger(action) { this.events.add(action); }

  /** Consume a one-shot press. */
  pressed(action) {
    if (this.events.has(action)) { this.events.delete(action); return true; }
    return false;
  }

  /** Call once per frame before systems read the state. */
  update() {
    const h = this.held, s = this.state, t = this.touch;
    let mx = (h.has('right') ? 1 : 0) - (h.has('left') ? 1 : 0);
    let my = (h.has('up') ? 1 : 0) - (h.has('down') ? 1 : 0);
    let throttle = h.has('up') ? 1 : 0, brake = h.has('down') ? 1 : 0, steer = mx;
    let handbrake = h.has('jump'), sprint = h.has('sprint'), horn = h.has('horn'), lookBack = h.has('lookBack');
    let attackHeld = h.has('attack') || h.has('attackMouse'), aim = h.has('aim'), wheelHeld = h.has('wheelHold'), stickX = 0, stickY = 0;
    const foot = this.weaponScroll;
    // Touch controls.
    if (t.active) {
      if (Math.abs(t.moveX) > 0.02 || Math.abs(t.moveY) > 0.02) { mx = t.moveX; my = t.moveY; steer = t.moveX; }
      throttle = Math.max(throttle, t.gas);
      brake = Math.max(brake, t.brake);
      handbrake ||= t.handbrake; sprint ||= t.sprint; horn ||= t.horn;
      attackHeld ||= t.fire || t.fire2; aim ||= t.aim; // the two FIRE buttons (right and left thumb)
    }
    // Gamepad.
    const pads = navigator.getGamepads?.() || [];
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const dz = v => (Math.abs(v) < 0.15 ? 0 : v);
      const lx = dz(pad.axes[0] || 0), ly = dz(pad.axes[1] || 0), rx = dz(pad.axes[2] || 0), ry = dz(pad.axes[3] || 0);
      const btn = i => pad.buttons[i]?.pressed, val = i => pad.buttons[i]?.value || 0;
      if (lx || ly || rx || ry || pad.buttons.some(b => b.pressed)) this.mode = 'gamepad';
      if (lx || ly) { mx = lx; my = -ly; steer = lx; }
      throttle = Math.max(throttle, val(7));
      brake = Math.max(brake, val(6));
      if (rx || ry) { this.look.x -= rx * 0.05 * this.lookScale; this.look.y -= ry * 0.04 * this.lookScale; this.lastLookAt = performance.now(); }
      if (Math.abs(rx) > Math.abs(stickX) || Math.abs(ry) > Math.abs(stickY)) { stickX = rx; stickY = ry; } // the wheel picks with it
      handbrake ||= btn(0); horn ||= btn(10); lookBack ||= btn(11);
      // True on the frame a button goes down (and queues its action, if it has one). Kept per pad. The analog
      // triggers count as down past a third of their travel.
      const down = i => (i === 6 || i === 7 ? val(i) > 0.3 : btn(i));
      const edge = (i, a) => { const k = `${pad.index}.${i}`; if (down(i) && !this.padHeld.has(k)) { if (a) this.events.add(a); this.padHeld.add(k); return true; } if (!down(i)) this.padHeld.delete(k); return false; };
      // B reloads (with empty hands the game makes it the punch it always was). On foot RT fires, LT aims, a held
      // RB opens the weapon wheel and the D-pad's left and right change weapon; behind the wheel RT and LT are the
      // pedals (above) and RB the radio. RB on foot must not send 'radio', which the game reads as reload there.
      const padWheel = foot && btn(5);
      edge(0, 'jump'); edge(3, 'enter'); edge(1, 'reload'); edge(9, 'pause'); edge(8, 'map'); edge(2, 'action'); edge(5, foot ? null : 'radio'); edge(4, 'camera');
      edge(12, 'job'); edge(13, 'photo');
      edge(7, foot ? 'attack' : null);
      edge(14, padWheel || wheelHeld ? 'wheelPrev' : 'weaponPrev'); edge(15, padWheel || wheelHeld ? 'wheelNext' : 'weaponNext');
      if (foot) { attackHeld ||= val(7) > 0.3; aim ||= val(6) > 0.3; wheelHeld ||= padWheel; }
      // L3 runs on foot (X is the action: snacks, photos, the siren, so a run buys nothing). A click
      // starts the run and another ends it, as does letting the stick come back to the middle: held
      // in, a stick pushed to its edge slips out of the click. At the wheel L3 is the horn, held.
      if (edge(10)) this.padRun.has(pad.index) ? this.padRun.delete(pad.index) : this.padRun.add(pad.index);
      if (!lx && !ly) this.padRun.delete(pad.index);
      sprint ||= this.padRun.has(pad.index);
    }
    const l = Math.hypot(mx, my);
    if (l > 1) { mx /= l; my /= l; }
    s.moveX = mx; s.moveY = my; s.throttle = throttle; s.brake = brake; s.steer = Math.max(-1, Math.min(1, steer));
    s.handbrake = handbrake; s.sprint = sprint; s.horn = horn;
    s.lookBack = lookBack;
    s.attackHeld = attackHeld; s.aim = aim; s.wheelHeld = wheelHeld;
    s.stickX = stickX; s.stickY = stickY;
  }

  /** Clear one-shot presses that nobody consumed this frame. */
  endFrame() { this.events.clear(); }
}
