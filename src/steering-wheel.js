// Turning the wheel about 150° either way reaches full lock: one comfortable thumb sweep.
const MAX_TURN = 2.6;
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Wheel rotation (radians, clockwise positive) after a thumb moves between two screen angles around its centre. */
export function turnWheel(rotation, fromAngle, toAngle, max = MAX_TURN) {
  return Math.max(-max, Math.min(max, rotation + wrap(toAngle - fromAngle)));
}

/** A released wheel springs back to centre. */
export function settleWheel(rotation, dt, rate = 7) {
  const next = rotation * Math.exp(-rate * Math.max(0, Number.isFinite(dt) ? dt : 0));
  return Math.abs(next) < 0.002 ? 0 : next;
}

/**
 * Touch steering wheel: grab it anywhere and turn it like a real wheel; let go and it
 * recentres. steer follows the game's convention (left positive). Capturing its own
 * pointer leaves other fingers free for the pedals and looking around.
 */
export function createSteeringWheel(pad, rim, { canInteract = () => true, max = MAX_TURN } = {}) {
  let pointerId = null, rotation = 0, lastAngle = 0, centerX = 0, centerY = 0, deadRadius = 10, drawn = null;
  const cleanups = [];

  function listen(target, name, callback, options) {
    if (!target?.addEventListener) return;
    target.addEventListener(name, callback, options);
    cleanups.push(() => target.removeEventListener(name, callback, options));
  }

  function draw() {
    if (rim && rotation !== drawn) { rim.style.transform = `rotate(${rotation}rad)`; drawn = rotation; }
  }

  function release() {
    const released = pointerId;
    pointerId = null;
    pad?.classList.remove('active');
    // Release can synchronously dispatch lostpointercapture, so clear the ID first.
    if (released !== null) try { pad.releasePointerCapture?.(released); } catch { /* Already released. */ }
  }

  listen(pad, 'pointerdown', event => {
    if (pointerId !== null || !canInteract()) return;
    event.preventDefault();
    const rect = pad.getBoundingClientRect();
    centerX = rect.left + rect.width / 2; centerY = rect.top + rect.height / 2;
    deadRadius = Math.min(rect.width, rect.height) * 0.08;
    lastAngle = Math.atan2(event.clientY - centerY, event.clientX - centerX);
    pointerId = event.pointerId;
    try { pad.setPointerCapture?.(pointerId); } catch { /* Window release still works. */ }
    pad.classList.add('active');
  }, { passive: false });
  listen(pad, 'pointermove', event => {
    if (event.pointerId !== pointerId) return;
    event.preventDefault();
    if (!canInteract()) { release(); return; }
    const dx = event.clientX - centerX, dy = event.clientY - centerY, angle = Math.atan2(dy, dx);
    // Near the hub the angle is unstable: follow it without turning the wheel.
    if (Math.hypot(dx, dy) > deadRadius) rotation = turnWheel(rotation, lastAngle, angle, max);
    lastAngle = angle;
    draw();
  }, { passive: false });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(pad, type, event => { if (event.pointerId === pointerId) release(); });

  return {
    update(dt) { if (pointerId === null) rotation = settleWheel(rotation, dt); draw(); },
    reset() { release(); rotation = 0; draw(); },
    get steer() { return -rotation / max; },
    get active() { return pointerId !== null; },
    get turning() { return pointerId !== null || rotation !== 0; },
    destroy() { release(); cleanups.splice(0).forEach(cleanup => cleanup()); },
  };
}
