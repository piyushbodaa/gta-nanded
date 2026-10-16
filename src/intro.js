/** A skippable opening film; the caller starts gameplay only after completion. */
export function createIntro() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('cinematic-intro'), video = $('intro-video');
  const skip = $('intro-skip'), sound = $('intro-sound'), fallback = $('intro-fallback');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let active = false, complete = null, returnFocus = null, token = 0, loadingTimer = 0, mode = 'drive';
  let inertElements = [];
  const removers = [];
  function listen(target, name, handler, options) {
    target?.addEventListener(name, handler, options);
    removers.push(() => target?.removeEventListener(name, handler, options));
  }
  function soundLabel() {
    const audible = !video.muted;
    sound.setAttribute('aria-pressed', String(audible));
    sound.setAttribute('aria-label', `Turn opening film sound ${audible ? 'off' : 'on'}`);
    $('intro-sound-label').textContent = audible ? 'Sound on' : 'Sound off';
  }
  function formatTime(value) {
    const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
  function progress() {
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 18;
    const percent = Math.min(100, Math.max(0, video.currentTime / duration * 100));
    $('intro-time').textContent = `${formatTime(video.currentTime)} / ${formatTime(duration)}`;
    $('intro-progress').setAttribute('aria-valuenow', String(Math.round(percent)));
    $('intro-progress-fill').style.width = `${percent}%`;
  }
  function staticOpening(message) {
    if (!active) return;
    clearTimeout(loadingTimer);
    video.pause();
    overlay.classList.add('is-static');
    fallback.hidden = false;
    sound.hidden = true;
    $('intro-fallback-message').textContent = message;
    $('intro-status').textContent = 'Your streets are waiting';
    $('intro-continue').textContent = mode === 'replay' ? 'Back to Nanded ↗' : mode === 'guide' ? 'Explore Nanded ↗' : 'Start game ↗';
  }
  function finish({ notify = true } = {}) {
    if (!active) return;
    active = false;
    token += 1;
    clearTimeout(loadingTimer);
    video.pause();
    video.removeAttribute('src');
    video.load();
    overlay.hidden = true;
    document.body.classList.remove('intro-active');
    inertElements.forEach(([element, previous]) => { element.inert = previous; });
    inertElements = [];
    const callback = complete;
    complete = null;
    if (returnFocus?.isConnected && returnFocus.getClientRects().length) returnFocus.focus({ preventScroll: true });
    if (notify) callback?.();
  }
  function play(onComplete, options = {}) {
    if (active) return false;
    active = true;
    const currentToken = ++token;
    complete = typeof onComplete === 'function' ? onComplete : null;
    mode = options.mode || 'drive';
    returnFocus = document.activeElement;
    inertElements = [...document.querySelectorAll('.site-header,#welcome,#hud,#pause-menu,#map-overlay,#touch-controls,#game-canvas')].map((element) => [element, element.inert]);
    inertElements.forEach(([element]) => { element.inert = true; });
    overlay.hidden = false;
    overlay.classList.remove('is-static');
    document.body.classList.add('intro-active');
    fallback.hidden = true;
    sound.hidden = false;
    video.muted = true;
    soundLabel();
    $('intro-status').textContent = 'Opening film…';
    $('intro-time').textContent = '0:00 / 0:18';
    $('intro-progress-fill').style.width = '0%';
    $('intro-progress').setAttribute('aria-valuenow', '0');
    skip.textContent = mode === 'replay' ? 'Back to Nanded ↗' : 'Skip opening ↗';
    skip.focus({ preventScroll: true });
    if (reducedMotion.matches) {
      staticOpening('The city is ready. Begin at Zenda Chowk, Taroda Khurd.');
      return true;
    }
    video.src = '/media/nanded-opening.mp4';
    video.currentTime = 0;
    loadingTimer = setTimeout(() => {
      if (active && currentToken === token) staticOpening('The city is ready. You can jump straight into your story.');
    }, 8000);
    try {
      const promise = video.play();
      promise?.catch(() => {
        if (active && currentToken === token) staticOpening('The city is ready. Begin your story whenever you like.');
      });
    } catch {
      staticOpening('The city is ready. Begin your story whenever you like.');
    }
    return true;
  }
  function replay() { return play(null, { mode: 'replay' }); }
  listen(skip, 'click', () => finish());
  listen($('intro-continue'), 'click', () => finish());
  listen($('intro-replay'), 'click', replay);
  listen(sound, 'click', () => { video.muted = !video.muted; soundLabel(); });
  listen(video, 'timeupdate', progress);
  listen(video, 'durationchange', progress);
  listen(video, 'playing', () => {
    if (!active || overlay.classList.contains('is-static')) return;
    clearTimeout(loadingTimer);
    $('intro-status').textContent = 'An original Nanded opening';
  });
  listen(video, 'waiting', () => {
    if (!active || overlay.classList.contains('is-static')) return;
    clearTimeout(loadingTimer);
    const currentToken = token;
    loadingTimer = setTimeout(() => {
      if (active && currentToken === token) staticOpening('Your streets are waiting. Continue whenever you like.');
    }, 6000);
  });
  listen(video, 'ended', () => finish());
  listen(video, 'error', () => staticOpening('Your streets are waiting. Continue whenever you like.'));
  listen(window, 'keydown', (event) => {
    if (!active) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      finish();
    } else if (event.key === 'Tab') {
      const buttons = [...overlay.querySelectorAll('button')].filter((button) => !button.disabled && button.getClientRects().length);
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }, true);
  if ($('intro-replay')) $('intro-replay').disabled = false;
  return {
    play, replay,
    get active() { return active; },
    destroy() { finish({ notify: false }); removers.forEach((remove) => remove()); },
  };
}
