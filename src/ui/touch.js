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
    this.stick = null;
    this._bind();
  }

  show(on) {
    this.active = on && matchMedia('(any-pointer: coarse)').matches;
    this.root.hidden = !this.active;
    this.input.touch.active = this.active;
    document.body.classList.toggle('touch-ui', this.active);
  }

  _bind() {
    const t = this.input.touch;
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
      this.knob.style.transform = ''; this.base.classList.remove('on');
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
  }

  /** Swap button sets for on foot / driving and show contextual ones. */
  update() {
    if (!this.active) return;
    const g = this.game, P = g.player;
    const driving = P.state === 'driving';
    this.root.classList.toggle('driving', driving);
    const near = P.state === 'foot' && g.nearestEnterable(P.x, P.z, 4.2);
    $('tb-enter').hidden = !(near || driving);
    $('tb-enter').textContent = driving ? 'EXIT' : near?.driver ? 'JACK' : 'ENTER';
    const act = g.contextAction?.();
    $('tb-action').hidden = !act || driving;
    if (act) $('tb-action').textContent = act.label.length > 18 ? act.label.split('·')[0].trim() : act.label;
    $('tb-job').hidden = !(driving && act && act.key === 'N');
    $('tb-job').textContent = g.jobs?.active ? 'STOP JOB' : 'START JOB';
  }
}
