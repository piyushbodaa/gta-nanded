// Vibration: one short buzz for a hit, a crash or a button, on Android phones (navigator.vibrate)
// and on a gamepad that can rumble. Off in Settings, while paused, or in the background; at most
// one buzz every 100 ms so rapid fire doesn't turn into one long drone (WASTED is let through).

const GAP = 100; // ms between buzzes

/** Total length of a pattern (a number, or [on, off, on, ...]) and its buzzing part, in ms. */
export function patternLength(pattern) {
  if (!Array.isArray(pattern)) return { total: +pattern || 0, on: +pattern || 0 };
  let total = 0, on = 0;
  pattern.forEach((ms, i) => { total += ms; if (!(i & 1)) on += ms; });
  return { total, on };
}

/**
 * Buzz `pattern` (ms, or [on, off, on...]) if the player allows it and the game is in front.
 * `force` skips the rate limit (WASTED). Returns whether it buzzed. `env` is for tests.
 */
export function haptic(game, pattern, force = false, env = globalThis) {
  if (!game || !pattern) return false;
  if (game.save?.data?.settings?.haptics === false) return false;
  if (game.paused || env.document?.hidden) return false;
  const now = env.performance?.now?.() ?? Date.now();
  if (!force && now - (game._hapticAt ?? -1e9) < GAP) return false;
  game._hapticAt = now;
  const nav = env.navigator;
  if (game.input?.mode === 'gamepad') {
    const pads = nav?.getGamepads?.() || [];
    for (const p of pads) {
      const act = p?.vibrationActuator;
      if (!act?.playEffect) continue;
      const { on } = patternLength(pattern);
      try { act.playEffect('dual-rumble', { duration: Math.min(400, on), strongMagnitude: on >= 60 ? 0.8 : 0.45, weakMagnitude: 0.5 }); } catch { /* not supported */ }
      return true;
    }
  }
  try { return !!nav?.vibrate?.(pattern); } catch { return false; }
}
