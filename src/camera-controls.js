const TAU = Math.PI * 2;
const DEFAULT_PITCH = 0.44;
const MIN_PITCH = 0.14;
const MAX_PITCH = 1.1;
const RECENTER_DELAY = 2;
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** World-space walking direction for screen-relative input; diagonals are normalized. */
export function movementForCamera(right, forward, heading) {
  const length = Math.max(1, Math.hypot(right, forward));
  right /= length;
  forward /= length;
  return {
    x: Math.cos(heading) * right - Math.sin(heading) * forward,
    z: -Math.sin(heading) * right - Math.cos(heading) * forward,
  };
}

/**
 * Drag only the game canvas to orbit. Capturing one canvas pointer leaves other
 * pointers free to steer/accelerate through their own button handlers.
 *
 * update() returns an absolute orbit heading in the game's +sin/+cos camera
 * convention, and a pitch in radians. Driving follows the vehicle with a manual
 * offset. Walking holds the camera's world heading independently of the avatar.
 */
export function createCameraControls(canvas, {
  canInteract = () => true,
  windowTarget = canvas.ownerDocument?.defaultView ?? globalThis.window,
  documentTarget = canvas.ownerDocument ?? globalThis.document,
} = {}) {
  let heading = 0, actorHeading = 0, yawOffset = 0, pitch = DEFAULT_PITCH;
  let initialized = false, onFoot = false, pointerId = null;
  let lastX = 0, lastY = 0, idleSeconds = 0, destroyed = false;
  const cleanups = [];

  function listen(target, name, callback, options) {
    if (!target?.addEventListener) return;
    target.addEventListener(name, callback, options);
    cleanups.push(() => target.removeEventListener(name, callback, options));
  }

  function cancel() {
    if (pointerId === null) return;
    const released = pointerId;
    pointerId = null;
    idleSeconds = 0;
    // Release can synchronously dispatch lostpointercapture, so clear the ID first.
    try { canvas.releasePointerCapture?.(released); } catch { /* Already released. */ }
  }

  function allowed() {
    if (destroyed || !canInteract() || documentTarget?.hidden) {
      cancel();
      return false;
    }
    return true;
  }

  function pointerDown(event) {
    if (!allowed() || pointerId !== null) return;
    if (event.pointerType !== 'touch' && event.button !== undefined && event.button !== 0) return;
    // A thumb on an accelerator may own the primary pointer. The looking finger
    // is still valid, so deliberately do not filter on event.isPrimary.
    pointerId = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    idleSeconds = 0;
    try { canvas.setPointerCapture?.(pointerId); } catch { /* Window release still works. */ }
    event.preventDefault();
    // preventDefault suppresses native focus. Move keyboard focus out of the last
    // HUD button so Space applies the handbrake instead of clicking that button.
    canvas.focus?.({ preventScroll: true });
  }

  function pointerMove(event) {
    if (event.pointerId !== pointerId || !allowed()) return;
    if (event.pointerType === 'mouse' && event.buttons === 0) { cancel(); return; }
    const dx = event.clientX - lastX, dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    const rect = canvas.getBoundingClientRect();
    const horizontal = -dx / Math.max(240, rect.width || 600) * TAU * 0.75;
    const vertical = -dy / Math.max(240, rect.height || 600) * Math.PI * 0.75;
    heading = wrap(heading + horizontal);
    yawOffset = wrap(heading - actorHeading);
    pitch = clamp(pitch + vertical, MIN_PITCH, MAX_PITCH);
    idleSeconds = 0;
    event.preventDefault();
  }

  function pointerEnd(event) {
    if (event.pointerId === pointerId) cancel();
  }

  function reset(nextHeading = 0) {
    cancel();
    heading = actorHeading = wrap(Number.isFinite(nextHeading) ? nextHeading : 0);
    yawOffset = 0;
    pitch = DEFAULT_PITCH;
    idleSeconds = 0;
    initialized = true;
  }

  function update(dt, { heading: nextHeading = actorHeading, speed = 0, onFoot: nextOnFoot = false } = {}) {
    const targetHeading = Number.isFinite(nextHeading) ? wrap(nextHeading) : actorHeading;
    if (!initialized) reset(targetHeading);
    // Preserve the inspected angle when getting out of or entering a vehicle.
    if (onFoot !== nextOnFoot) yawOffset = wrap(heading - targetHeading);
    actorHeading = targetHeading;
    onFoot = nextOnFoot;
    const enabled = allowed();
    if (!onFoot) heading = wrap(actorHeading + yawOffset);
    if (enabled && pointerId === null) {
      const elapsed = Number.isFinite(dt) ? Math.max(0, dt) : 0;
      idleSeconds += elapsed;
      if (!onFoot && Math.abs(speed) > 2 && idleSeconds > RECENTER_DELAY) {
        const recenterTime = Math.min(elapsed, idleSeconds - RECENTER_DELAY);
        const blend = 1 - Math.exp(-recenterTime * 2.3);
        yawOffset *= 1 - blend;
        pitch += (DEFAULT_PITCH - pitch) * blend;
        if (Math.abs(yawOffset) < 0.0001) yawOffset = 0;
        if (Math.abs(pitch - DEFAULT_PITCH) < 0.0001) pitch = DEFAULT_PITCH;
        heading = wrap(actorHeading + yawOffset);
      }
    }
    return { heading, pitch, dragging: pointerId !== null };
  }

  listen(canvas, 'pointerdown', pointerDown, { passive: false });
  listen(canvas, 'pointermove', pointerMove, { passive: false });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(canvas, type, pointerEnd);
  for (const type of ['pointerup', 'pointercancel']) listen(windowTarget, type, pointerEnd);
  listen(windowTarget, 'blur', cancel);
  listen(documentTarget, 'visibilitychange', () => { if (documentTarget.hidden) cancel(); });

  return {
    update, reset, cancel,
    get heading() { return heading; },
    get pitch() { return pitch; },
    get dragging() { return pointerId !== null; },
    destroy() { cancel(); destroyed = true; cleanups.splice(0).forEach(cleanup => cleanup()); },
  };
}
