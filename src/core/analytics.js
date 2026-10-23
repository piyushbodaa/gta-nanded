// Announces countable moments (a game started, a mission passed) to public/analytics.js, which
// forwards an allowlisted few to Google Analytics on gta.nanded.fun only. Never pass player or game
// state here. Outside a browser (the tests) there is no window to tell, and nothing happens.
export function track(name, detail) {
  globalThis.dispatchEvent?.(new CustomEvent('nanded:analytics', { detail: { name, ...detail } }));
}
