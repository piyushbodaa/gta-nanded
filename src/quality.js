/**
 * Adaptive graphics quality.
 *
 * The city is one big static dataset (200k+ instanced parts), so the frame
 * cost is dominated by pixel fill, the shadow pass and how many chunks are
 * inside the view distance. Those three knobs are exactly what a tier
 * controls. `auto` watches a smoothed frame time and steps down (or back up)
 * between tiers; the player can also pin a tier, and the choice persists.
 */
export const QUALITY_MODES = ['auto', 'high', 'balanced', 'performance'];
export const QUALITY_KEY = 'nanded-quality-v1';

// Ordered best → cheapest. `shadowEvery` = render the shadow map once per
// N frames (the city itself never moves, so stale actor shadows are the
// only cost); 0 disables shadows entirely.
export const QUALITY_TIERS = Object.freeze([
  Object.freeze({ name: 'high', pixelRatio: 1.6, mobilePixelRatio: 1.25, shadowMap: 2048, mobileShadowMap: 1024, shadowEvery: 2, viewDistance: 640, actorDistance: 300 }),
  Object.freeze({ name: 'balanced', pixelRatio: 1.25, mobilePixelRatio: 1, shadowMap: 1024, mobileShadowMap: 1024, shadowEvery: 3, viewDistance: 520, actorDistance: 240 }),
  Object.freeze({ name: 'performance', pixelRatio: 1, mobilePixelRatio: 0.85, shadowMap: 1024, mobileShadowMap: 512, shadowEvery: 6, viewDistance: 420, actorDistance: 190 }),
  Object.freeze({ name: 'potato', pixelRatio: 0.75, mobilePixelRatio: 0.7, shadowMap: 0, mobileShadowMap: 0, shadowEvery: 0, viewDistance: 340, actorDistance: 150 }),
]);

/** Pick the starting tier from what the device reports about itself. */
export function initialTier({ coarse = false, smallScreen = false, cores = 8, memory = 8 } = {}) {
  let tier = 0;
  if (coarse || smallScreen) tier++;
  if (cores <= 4) tier++;
  if (memory && memory <= 4) tier++;
  return Math.min(tier, QUALITY_TIERS.length - 1);
}

export function loadQualityMode(storage) {
  try {
    const saved = storage?.getItem(QUALITY_KEY);
    return QUALITY_MODES.includes(saved) ? saved : 'auto';
  } catch { return 'auto'; }
}

export function saveQualityMode(storage, mode) {
  try { storage?.setItem(QUALITY_KEY, mode); return true; } catch { return false; }
}

export function nextQualityMode(mode) {
  const index = QUALITY_MODES.indexOf(mode);
  return QUALITY_MODES[(index + 1) % QUALITY_MODES.length];
}

/** The concrete tier a mode resolves to, given the auto tracker's position. */
export function tierForMode(mode, autoTier = 0) {
  if (mode === 'high') return QUALITY_TIERS[0];
  if (mode === 'balanced') return QUALITY_TIERS[1];
  if (mode === 'performance') return QUALITY_TIERS[2];
  return QUALITY_TIERS[Math.max(0, Math.min(autoTier, QUALITY_TIERS.length - 1))];
}

/**
 * Exponentially-smoothed frame-time tracker. `sample(dt)` returns the new
 * tier index when it changes, otherwise null. Steps down quickly when the
 * frame budget is blown, and only steps back up after a long calm stretch,
 * so the resolution does not visibly hunt up and down.
 */
export function createAutoQuality(startTier = 0) {
  let tier = Math.max(0, Math.min(startTier, QUALITY_TIERS.length - 1));
  let ema = 1 / 60, calmFor = 0, sinceChange = 0;
  return {
    get tier() { return tier; },
    get fps() { return Math.round(1 / Math.max(ema, 1e-4)); },
    sample(dt) {
      if (!Number.isFinite(dt) || dt <= 0) return null;
      // Tab-switch gaps and hitches say nothing about steady-state cost.
      const frame = Math.min(dt, 0.1);
      ema += (frame - ema) * 0.05;
      sinceChange += dt;
      if (ema > 1 / 38 && tier < QUALITY_TIERS.length - 1 && sinceChange > 2) {
        tier++; sinceChange = 0; calmFor = 0; return tier;
      }
      if (ema < 1 / 57) {
        calmFor += dt;
        if (calmFor > 20 && tier > 0 && sinceChange > 20) { tier--; sinceChange = 0; calmFor = 0; return tier; }
      } else calmFor = 0;
      return null;
    },
  };
}

/** Renderer settings for a tier on this device (capped by the real DPR). */
export function tierSettings(tier, { mobile = false, devicePixelRatio = 1 } = {}) {
  const cap = mobile ? tier.mobilePixelRatio : tier.pixelRatio;
  return {
    pixelRatio: Math.max(0.5, Math.min(devicePixelRatio || 1, cap)),
    shadowMap: mobile ? tier.mobileShadowMap : tier.shadowMap,
    shadowEvery: tier.shadowEvery,
    viewDistance: tier.viewDistance,
    actorDistance: tier.actorDistance,
  };
}
