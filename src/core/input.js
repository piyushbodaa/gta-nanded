// One input state for keyboard + mouse, gamepad and touch. Systems read
// continuous axes from `state` and consume one-shot presses with `pressed()`.
const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  Space: 'jump', ShiftLeft: 'sprint', ShiftRight: 'sprint', KeyF: 'enter', KeyE: 'enter', KeyQ: 'action', KeyH: 'horn',
  KeyM: 'map', Escape: 'pause', KeyP: 'pause', KeyV: 'camera', KeyR: 'radio', KeyC: 'lookBack', KeyN: 'job', KeyJ: 'attack',
  ControlLeft: 'attack', KeyX: 'photo', Tab: 'map', KeyB: 'phone', Enter: 'confirm',
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.held = new Set();
    this.events = new Set();
    this.state = { moveX: 0, moveY: 0, throttle: 0, brake: 0, steer: 0, handbrake: false, sprint: false, horn: false, lookBack: false, attackHeld: false };
    this.look = { x: 0, y: 0 }; // accumulated look delta (radians), consumed by the camera
    this.lastLookAt = 0; // time of the last deliberate look input
    this.touch = { moveX: 0, moveY: 0, gas: 0, brake: 0, handbrake: false, sprint: false, horn: false, active: false };
    this.mode = 'keyboard'; // keyboard | touch | gamepad
    this.keyboardUsed = false;
    this.enabled = true;
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
      if (['up', 'down', 'left', 'right', 'jump', 'map'].includes(a) || e.code === 'Tab') e.preventDefault();
      if (t instanceof HTMLButtonElement && (e.code === 'Space' || e.code === 'Enter')) return;
      this.mode = 'keyboard'; this.keyboardUsed = true;
      if (!e.repeat) this.events.add(a);
      this.held.add(a);
    });
    addEventListener('keyup', e => { const a = KEYMAP[e.code]; if (a) this.held.delete(a); });
    addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.clear(); });

    const c = this.canvas;
    c.addEventListener('mousedown', e => {
      if (!this.enabled) return;
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
      if (e.pointerType !== 'mouse') this.mode = 'touch';
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
    const end = e => { if (drag && e.pointerId === drag.id) drag = null; };
    addEventListener('pointerup', end);
    addEventListener('pointercancel', end);
    addEventListener('wheel', e => { this.zoom = (this.zoom || 0) + Math.sign(e.deltaY); }, { passive: true });
  }

  clear() {
    this.held.clear();
    this.events.clear();
    Object.assign(this.touch, { moveX: 0, moveY: 0, gas: 0, brake: 0, handbrake: false, sprint: false, horn: false });
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
    // Touch controls.
    if (t.active) {
      if (Math.abs(t.moveX) > 0.02 || Math.abs(t.moveY) > 0.02) { mx = t.moveX; my = t.moveY; steer = t.moveX; }
      throttle = Math.max(throttle, t.gas);
      brake = Math.max(brake, t.brake);
      handbrake ||= t.handbrake; sprint ||= t.sprint; horn ||= t.horn;
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
      handbrake ||= btn(0); sprint ||= btn(2); horn ||= btn(10); lookBack ||= btn(11);
      const edge = (i, a) => { const k = `pad${i}`; if (btn(i) && !this.held.has(k)) { this.events.add(a); this.held.add(k); } else if (!btn(i)) this.held.delete(k); };
      edge(0, 'jump'); edge(3, 'enter'); edge(1, 'attack'); edge(9, 'pause'); edge(8, 'map'); edge(2, 'action'); edge(5, 'radio'); edge(4, 'camera');
      edge(12, 'job'); edge(13, 'photo');
    }
    const l = Math.hypot(mx, my);
    if (l > 1) { mx /= l; my /= l; }
    s.moveX = mx; s.moveY = my; s.throttle = throttle; s.brake = brake; s.steer = Math.max(-1, Math.min(1, steer));
    s.handbrake = handbrake; s.sprint = sprint; s.horn = horn;
    s.lookBack = lookBack;
    s.attackHeld = h.has('attack') || h.has('attackMouse');
    s.aim = h.has('aim');
  }

  /** Clear one-shot presses that nobody consumed this frame. */
  endFrame() { this.events.clear(); }
}
