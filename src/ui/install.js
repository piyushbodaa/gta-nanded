// Add to Home Screen. Chrome on Android offers an install prompt we can show from Settings;
// Safari on iPhone has no prompt, so we show the steps instead. Installed, the game opens
// full screen like an app, and iPhones stop clearing its saves after a week away.
let deferred = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; });
addEventListener('appinstalled', () => { deferred = null; });

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Launched from the home screen (a browser tab in fullscreen doesn't count). */
export function installed() {
  return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches || (matchMedia('(display-mode: fullscreen)').matches && !document.fullscreenElement);
}

/** 'prompt' when the browser can install now, 'ios' when we can only explain how, else null. */
export function installKind() {
  if (installed()) return null;
  if (deferred) return 'prompt';
  return isIOS() ? 'ios' : null;
}

/** Show the browser's install prompt; true if the player accepted. */
export async function promptInstall() {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  e.prompt();
  const { outcome } = await e.userChoice;
  return outcome === 'accepted';
}
