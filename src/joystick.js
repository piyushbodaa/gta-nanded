const DEAD_ZONE = 0.12;
const FULL_AT = 0.85;

/**
 * Stick axes for a drag of (dx, dy) screen pixels from the pad centre: x steers
 * right, y pushes forward (screen up). A small dead zone ignores a resting thumb,
 * and the stick saturates slightly inside the rim so full lock is easy to hold.
 */
export function joystickAxes(dx, dy, radius) {
  const length = Math.hypot(dx, dy), reach = length / radius;
  if (!(radius > 0) || !(reach > DEAD_ZONE)) return { x: 0, y: 0 };
  const strength = Math.min(1, (reach - DEAD_ZONE) / (FULL_AT - DEAD_ZONE));
  return { x: dx / length * strength, y: -dy / length * strength };
}

/** One-thumb touch stick. Capturing its own pointer leaves other fingers free for brake, boost and looking around. */
export function createJoystick(pad, knob, { canInteract = () => true } = {}) {
  let pointerId = null, centerX = 0, centerY = 0, radius = 1, x = 0, y = 0;
  const cleanups = [];

  function listen(target, name, callback, options) {
    if (!target?.addEventListener) return;
    target.addEventListener(name, callback, options);
    cleanups.push(() => target.removeEventListener(name, callback, options));
  }

  function place(clientX, clientY) {
    const dx = clientX - centerX, dy = clientY - centerY, length = Math.hypot(dx, dy) || 1;
    const reach = Math.min(length, radius);
    ({ x, y } = joystickAxes(dx, dy, radius));
    if (knob) knob.style.transform = `translate(${dx / length * reach}px, ${dy / length * reach}px)`;
  }

  function reset() {
    const released = pointerId;
    pointerId = null; x = 0; y = 0;
    if (knob) knob.style.transform = '';
    pad?.classList.remove('active');
    // Release can synchronously dispatch lostpointercapture, so clear the ID first.
    if (released !== null) try { pad.releasePointerCapture?.(released); } catch { /* Already released. */ }
  }

  listen(pad, 'pointerdown', event => {
    if (pointerId !== null || !canInteract()) return;
    event.preventDefault();
    const rect = pad.getBoundingClientRect();
    centerX = rect.left + rect.width / 2; centerY = rect.top + rect.height / 2;
    radius = Math.max(1, Math.min(rect.width, rect.height) / 2);
    pointerId = event.pointerId;
    try { pad.setPointerCapture?.(pointerId); } catch { /* Window release still works. */ }
    pad.classList.add('active');
    place(event.clientX, event.clientY);
  }, { passive: false });
  listen(pad, 'pointermove', event => {
    if (event.pointerId !== pointerId) return;
    event.preventDefault();
    if (!canInteract()) { reset(); return; }
    place(event.clientX, event.clientY);
  }, { passive: false });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(pad, type, event => { if (event.pointerId === pointerId) reset(); });

  return {
    reset,
    get x() { return x; },
    get y() { return y; },
    get active() { return pointerId !== null; },
    destroy() { reset(); cleanups.splice(0).forEach(cleanup => cleanup()); },
  };
}
