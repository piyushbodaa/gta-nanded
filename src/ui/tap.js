// Buttons that answer a tap while the other thumb rests on the stick: the pause menu and the photo card.
// Kept on its own, with no imports and nothing run on load, so the game rules can use it without the menus.

/**
 * A browser makes a click only from a lone finger, and the game's own buttons invite a thumb resting on the
 * stick, so a menu tapped with the other thumb ignored every tap. A tap by a second finger acts on pointerup
 * instead (a finger that moved was scrolling), and cancelling its touchend stops the browser from clicking too.
 * A lone finger keeps the browser's own click, which knows that a tap on a gliding list only stops it, and which
 * moves focus (so the keyboard closes after a search). Mouse, pen and keyboard keep the plain click.
 * Pointerup counts as a user gesture, so a button it presses can still open the share sheet or a download.
 */
export function tapButtons(root) {
  const downs = new Map(); // second-finger pointerId -> where it went down, and on which button
  let tapped = false, scrolled = -Infinity;
  root.addEventListener('scroll', e => { scrolled = e.timeStamp; }, { capture: true, passive: true });
  root.addEventListener('pointerdown', e => {
    // A finger that lands while a list still glides is stopping it, not tapping.
    if (e.pointerType !== 'touch' || e.isPrimary || e.timeStamp - scrolled < 100) return;
    downs.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.target.closest('button') });
  });
  root.addEventListener('pointercancel', e => downs.delete(e.pointerId));
  root.addEventListener('pointerup', e => {
    const d = downs.get(e.pointerId);
    downs.delete(e.pointerId);
    if (!d?.button || d.button.disabled || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 12) return;
    tapped = true;
    // The browser's tap would take focus off the search box; without it the phone's keyboard stays open.
    if (document.activeElement?.matches('input, textarea')) document.activeElement.blur();
    d.button.click();
  });
  root.addEventListener('touchend', e => { if (tapped && e.cancelable) e.preventDefault(); tapped = false; }, { passive: false });
}
