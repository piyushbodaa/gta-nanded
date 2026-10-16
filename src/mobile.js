/** View preferences only. Movement, pause, camera and city-guide state stay in main. */
export function initMobileUI({ onLayout } = {}) {
  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const touchQuery = matchMedia('(any-pointer: coarse)');
  const narrowQuery = matchMedia('(max-width: 760px), (max-width: 960px) and (max-height: 600px)');
  const portraitQuery = matchMedia('(orientation: portrait)');
  const mapToggle = $('minimap-toggle'), localMap = $('local-map');
  const jobToggle = $('job-toggle'), mission = $('mission-panel');
  const wideToggle = $('landscape-toggle'), hint = $('rotate-hint');
  let compact = false, minimapOpen = false, jobExpanded = false, dismissed = false, frame = 0, destroyed = false;
  try { dismissed = sessionStorage.getItem('nanded-rotate-tip-dismissed') === '1'; } catch { /* Storage is optional. */ }
  const cleanup = [];
  function listen(target, type, handler) {
    target?.addEventListener(type, handler);
    cleanup.push(() => target?.removeEventListener(type, handler));
  }
  function render() {
    body.classList.toggle('is-touch-device', compact);
    localMap?.classList.toggle('is-open', minimapOpen);
    mission?.classList.toggle('job-expanded', jobExpanded);
    mapToggle?.setAttribute('aria-expanded', String(!compact || minimapOpen));
    mapToggle?.setAttribute('aria-label', minimapOpen ? 'Hide mini map' : 'Show mini map');
    jobToggle?.setAttribute('aria-expanded', String(!compact || jobExpanded));
    jobToggle?.setAttribute('aria-label', jobExpanded ? 'Hide adventure details' : 'Show adventure details');
    if (hint) hint.hidden = !compact || !portraitQuery.matches || dismissed;
  }
  function refresh() {
    if (destroyed) return;
    const nextCompact = touchQuery.matches || narrowQuery.matches;
    if (nextCompact && !compact) { minimapOpen = false; jobExpanded = false; }
    compact = nextCompact;
    render();
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => onLayout?.({ compact, portrait: portraitQuery.matches }));
  }
  listen(mapToggle, 'click', () => { minimapOpen = !minimapOpen; render(); });
  listen(jobToggle, 'click', () => { jobExpanded = !jobExpanded; render(); });
  listen($('rotate-hint-dismiss'), 'click', () => {
    dismissed = true;
    try { sessionStorage.setItem('nanded-rotate-tip-dismissed', '1'); } catch { /* Storage is optional. */ }
    render();
  });
  listen(wideToggle, 'click', async () => {
    wideToggle.disabled = true;
    let orientationLocked = false;
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        try { await document.documentElement.requestFullscreen(); } catch { /* Some mobile browsers do not offer fullscreen. */ }
      }
      if (screen.orientation?.lock) {
        try { await screen.orientation.lock('landscape'); orientationLocked = true; } catch { /* iOS and some browsers require physical rotation. */ }
      }
      if (!orientationLocked && portraitQuery.matches) {
        dismissed = false;
        if ($('rotate-hint-text')) $('rotate-hint-text').textContent = 'Turn your phone sideways for a wider view';
      }
    } finally {
      if (!destroyed) { wideToggle.disabled = false; refresh(); }
    }
  });
  for (const query of [touchQuery, narrowQuery, portraitQuery]) listen(query, 'change', refresh);
  listen(window, 'resize', refresh);
  listen(window, 'orientationchange', refresh);
  listen(document, 'fullscreenchange', refresh);
  refresh();
  return {
    refresh,
    destroy() { destroyed = true; cancelAnimationFrame(frame); cleanup.forEach((remove) => remove()); },
  };
}
