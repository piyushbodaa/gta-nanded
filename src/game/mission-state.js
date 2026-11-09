// What the game is in the middle of, for systems that must not start something on top of it.
// Pure and import-free, so weapons.js (no three.js) and the tests can use it.

/** A story or side mission is running (not a street event). */
export const inStory = g => Boolean(g.missions?.active && !g.missions.active.def?.event);
/** A street event is running. */
export const inEvent = g => Boolean(g.missions?.active?.def?.event);
/** Anything that holds the player's attention: a mission or event, a job, a cutscene, a respawn, the retry card, the garage menu. */
export const busy = g => Boolean(g.missions?.active || g.jobs?.active || g.cutscene || g.respawning
  || g.retryCard?.open || g.garageMenu?.open);
