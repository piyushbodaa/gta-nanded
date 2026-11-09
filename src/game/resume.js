// Carry on where you were: a small snapshot of the street (where, in what, what time of day), taken
// when the page goes to the background and every autosave. If Android throws the tab away while
// WhatsApp is open, or the graphics never come back and the game reloads itself, the menu offers
// TAP TO CARRY ON and puts the player back on the same spot, in the same vehicle.
// Pure functions: no DOM, so node tests drive them with a fake game.

/** A snapshot older than this is a different sitting: the menu offers the usual CONTINUE. */
export const RESUME_MAX_AGE = 10 * 60 * 1000;
/** sessionStorage key: '1' once a game has been played in this tab, 'reload' when the game reloaded itself. */
export const LIVE_KEY = 'gta-nanded-live';

const fin = n => typeof n === 'number' && Number.isFinite(n);
const r2 = n => Math.round(n * 100) / 100;

/**
 * The player's situation, or null when it isn't a moment to come back to (a cutscene, WASTED or
 * BUSTED, the retry card, a wreck). The caller then keeps the snapshot it had.
 */
export function snapshotResume(g) {
  const P = g?.player;
  if (!P || !g.started || g.cutscene || g.respawning || g.retryCard?.open) return null;
  if (P.state === 'dead' || P.state === 'down' || !(P.health > 0)) return null;
  const v = P.state === 'driving' ? P.vehicle : null;
  if (v && (v.wrecked || !v.type)) return null;
  const at = v || P;
  if (!fin(at.x) || !fin(at.z)) return null;
  const m = g.missions?.active?.def;
  let place = '';
  try { place = g.city?.district?.(at.x, at.z)?.name || ''; } catch { /* no city in a test */ }
  return {
    v: 1,
    at: Date.now(),
    x: r2(at.x), z: r2(at.z), y: fin(at.y) ? r2(at.y) : 0,
    heading: fin(at.heading) ? r2(at.heading) : 0,
    hours: fin(g.sky?.hours) ? r2(g.sky.hours) : null,
    weather: g.sky?.weather || null,
    freeRoam: Boolean(g.freeRoam),
    wanted: g.police?.level || 0,
    health: Math.round(P.health),
    equipped: g.weapons?.current || null,
    vehicle: v ? { type: v.type, color: v.color ?? null, health: Math.round(v.health ?? 1000), owned: v.owned || 0 } : null,
    mission: m?.id || null,
    missionTitle: m?.title || null,
    place,
  };
}

/** Whether the menu should offer TAP TO CARRY ON: a fresh snapshot, in a tab that was playing or was thrown away. */
export function shouldResume(resume, { now = Date.now(), live = false, discarded = false } = {}) {
  if (!resume || resume.v !== 1 || !fin(resume.at) || !fin(resume.x) || !fin(resume.z)) return false;
  const age = now - resume.at;
  if (age < 0 || age >= RESUME_MAX_AGE) return false;
  return Boolean(live || discarded);
}

/** What `shouldResume` needs from the browser. Storage that is blocked means no resume, never an error. */
export function resumeContext({
  store = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
  doc = typeof document !== 'undefined' ? document : null,
  now = Date.now(),
} = {}) {
  let live = false;
  try { live = Boolean(store?.getItem(LIVE_KEY)); } catch { /* blocked */ }
  return { now, live, discarded: Boolean(doc?.wasDiscarded) };
}

/** The menu button's second line: "Zenda Chowk · in your auto · ★★". */
export function resumeLabel(r) {
  if (!r) return '';
  const parts = [];
  if (r.place) parts.push(r.place);
  parts.push(r.vehicle ? `in your ${r.vehicle.type === 'auto' ? 'auto' : r.vehicle.type}` : 'on foot');
  return parts.join(' · ');
}

/**
 * Put the player back: same spot, same time of day, same vehicle (an owned car is moved, not
 * copied). Wanted stars start at zero unless `keepWanted`; a mission is never restored, only
 * mentioned. Returns the vehicle the player sits in, or null on foot.
 */
export function applyResume(g, r, { keepWanted = false } = {}) {
  const P = g?.player;
  if (!P || !r) return null;
  P.teleport(r.x, r.z, r.heading || 0);
  if (fin(r.y) && r.y > (P.y ?? 0) + 0.5) { P.y = P.groundY = r.y; } // up on a flyover
  if (g.sky) {
    if (fin(r.hours)) g.sky.hours = ((r.hours % 24) + 24) % 24;
    if (r.weather) g.sky.setWeather ? g.sky.setWeather(r.weather) : (g.sky.weather = r.weather);
  }
  if (r.freeRoam) g.freeRoam = true;
  if (fin(r.health)) P.health = Math.max(25, Math.min(P.maxHealth ?? 100, r.health));
  let v = null;
  if (r.vehicle?.type && g.vehicles) {
    const s = r.vehicle;
    if (s.owned) {
      v = g.garage?.vehicleById?.(s.owned) || null;
      if (v && !v.wrecked) {
        v.x = r.x; v.z = r.z; v.heading = r.heading || 0;
        v.vx = v.vz = 0; v.w = 0;
      } else v = null;
    }
    if (!v) {
      try { v = g.vehicles.spawn(s.type, r.x, r.z, r.heading || 0, { color: s.color ?? undefined, role: 'player', driver: false }); } catch { v = null; }
    }
    if (v) {
      if (fin(r.y)) v.y = r.y;
      P.enterVehicle(v);
      // Never back into a burning car: whatever it had, above the fire line.
      if (fin(s.health)) v.health = Math.max(260, Math.min(1000, s.health));
    }
  }
  if (!v && r.equipped && g.weapons?.current !== r.equipped) g.weapons?.equip?.(r.equipped);
  g.police?.setLevel?.(keepWanted ? r.wanted || 0 : 0);
  if (r.mission) g.hud?.toast?.(`<b>${r.missionTitle || 'Your mission'}</b> was interrupted — its marker is on the radar.`, 6);
  return v;
}
