// Touch controls: a floating stick under the left thumb, contextual buttons
// under the right, and the rest of the screen drags the camera.
const $ = id => document.getElementById(id);

export class TouchControls {
  constructor(game) {
    this.game = game;
    this.root = $('touch');
    this.stickZone = $('touch-stick-zone');
    this.base = $('touch-stick');
    this.knob = $('touch-knob');
    this.input = game.input;
    this.active = false;
    this.wanted = false;
    this.touched = false;
    this.stick = null;
    this._bind();
  }

  /**
   * Show the buttons while playing on a touch screen: phones and tablets from the
   * start, a touch-screen laptop once it is touched. Hints follow, until a key is pressed.
   */
  show(on) {
    this.wanted = on;
    this.active = on && (matchMedia('(pointer: coarse)').matches || this.touched);
    this.root.hidden = !this.active;
    this.input.touch.active = this.active;
    document.body.classList.toggle('touch-ui', this.active);
    if (this.active && this.input.mode === 'keyboard' && !this.input.keyboardUsed) this.input.mode = 'touch';
  }

  _bind() {
    const t = this.input.touch;
    addEventListener('pointerdown', e => {
      if (e.pointerType !== 'touch' || this.touched) return;
      this.touched = true;
      if (this.wanted && !this.active) this.show(true);
    }, { capture: true, passive: true });
    // Floating joystick.
    const R = 56;
    const move = e => {
      if (!this.stick || e.pointerId !== this.stick.id) return;
      let dx = e.clientX - this.stick.x, dy = e.clientY - this.stick.y;
      const l = Math.hypot(dx, dy);
      if (l > R) { dx *= R / l; dy *= R / l; }
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      t.moveX = dx / R; t.moveY = -dy / R;
      this.input.mode = 'touch';
    };
    this.stickZone.addEventListener('pointerdown', e => {
      e.preventDefault();
      this.stickZone.setPointerCapture(e.pointerId);
      this.stick = { id: e.pointerId, x: e.clientX, y: e.clientY };
      this.base.style.left = `${e.clientX}px`; this.base.style.top = `${e.clientY}px`;
      this.base.classList.add('on');
      move(e);
    });
    this.stickZone.addEventListener('pointermove', move);
    const end = e => {
      if (!this.stick || e.pointerId !== this.stick.id) return;
      this.stick = null; t.moveX = 0; t.moveY = 0;
      // The resting ring goes home (its CSS place, which follows rotation) rather than staying where the thumb lifted.
      this.knob.style.transform = ''; this.base.classList.remove('on');
      this.base.style.left = ''; this.base.style.top = '';
    };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) this.stickZone.addEventListener(ev, end);

    // Buttons: data-hold maps to a held touch flag, data-tap triggers a one-shot action.
    for (const b of this.root.querySelectorAll('[data-hold],[data-tap]')) {
      const hold = b.dataset.hold, tap = b.dataset.tap;
      b.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation();
        b.setPointerCapture(e.pointerId);
        b.classList.add('down');
        if (hold) t[hold] = hold === 'gas' || hold === 'brake' ? 1 : true;
        if (tap) this.input.trigger(tap);
        this.input.mode = 'touch';
        navigator.vibrate?.(8);
      });
      const up = () => { b.classList.remove('down'); if (hold) t[hold] = hold === 'gas' || hold === 'brake' ? 0 : false; };
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, up);
    }
    // Everything here acts on pointerdown, so the click a tap makes afterwards is a ghost: MAP and ❚❚ open the
    // pause menu under the finger, and the click would land on whatever tab is there (📷: on Share). Cancelling
    // the touchend stops that click; touch events stay with the button the finger went down on. (A touchend
    // after a drag on the stick can't be cancelled, and makes no click; asking anyway only warns in the console.)
    this.root.addEventListener('touchend', e => { if (e.cancelable) e.preventDefault(); }, { passive: false });
  }

  /** Swap button sets for on foot / driving and show contextual ones. */
  update() {
    if (!this.active) return;
    const g = this.game, P = g.player, v = P.vehicle;
    const driving = P.state === 'driving';
    this.root.classList.toggle('driving', driving);
    // ENTER (or JACK) next to a vehicle; EXIT lives with the driving buttons.
    const near = P.state === 'foot' && g.nearestEnterable(P.x, P.z, 4.2);
    setButton('tb-enter', near && (near.driver ? 'JACK' : 'ENTER'));
    const act = g.contextAction?.();
    setButton('tb-action', !driving && act && (act.label.length > 18 ? act.label.split('·')[0].trim() : act.label));
    setButton('tb-job', driving && act?.key === 'N' && (g.jobs?.active ? 'STOP JOB' : act.label.startsWith('Start race') ? 'START RACE' : 'START JOB'));
    setButton('tb-siren', driving && v && (v.type === 'police' || v.type === 'ambulance') && (v.sirenOn ? 'SIREN OFF' : 'SIREN'));
  }
}

/** Show a contextual button with this label, or hide it (label falsy); touches the DOM only on change. */
function setButton(id, label) {
  const el = $(id);
  if (!label) { if (!el.hidden) el.hidden = true; return; }
  if (el.hidden) el.hidden = false;
  if (el.textContent !== label) el.textContent = label;
}
