/* Counts visits, game starts and passed missions with Google Analytics 4, on gta.nanded.fun only:
   local builds and previews send nothing. The game announces moments with a 'nanded:analytics'
   event (src/core/analytics.js); of those, only allowlisted names and modes are sent, never the
   URL, referrer, player or game state. Advertising features and Google signals are off.
   gtag.js also sends GA4's own session events (first_visit, session_start, user_engagement) and
   whatever Enhanced measurement the web stream has switched on in GA4 Admin. Keep all of that off
   there: form interactions, for one, would report the settings cheat form with the real address. */
(() => {
  const host = 'gta.nanded.fun';
  const id = 'G-0GVL1WWPS8';
  if (location.hostname !== host || window.__nandedAnalyticsInitialized) return;
  window.__nandedAnalyticsInitialized = true;
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'granted' });
  gtag('js', new Date());
  const safePage = { page_location: 'https://' + host + '/', page_referrer: '', page_title: 'GTA Nanded' };
  gtag('set', safePage);
  gtag('config', id, { ...safePage, send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false, cookie_domain: host });
  gtag('event', 'page_view', { ...safePage, send_to: id });
  const modes = new Set(['new', 'continue', 'free']); // new story, continue the story, free roam
  const events = new Set(['game_start', 'mission_complete']);
  window.addEventListener('nanded:analytics', event => {
    const detail = event.detail;
    if (!detail || !events.has(detail.name)) return;
    const params = { ...safePage, send_to: id };
    if (modes.has(detail.mode)) params.game_mode = detail.mode;
    gtag('event', detail.name, params);
  });
  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://www.googletagmanager.com/gtag/js?id=' + id;
  document.head.appendChild(script);
})();
