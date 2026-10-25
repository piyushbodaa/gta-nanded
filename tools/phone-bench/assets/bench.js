// Scripted run of GTA Nanded on a real phone: first launch (tuning included), a few seconds on
// the menu, Free Roam, the busiest places, a fast "drive" that keeps new streets streaming in,
// and the 30 fps saver.
// Every measurement goes to the console as "BENCH {json}" (logcat, and Test Lab's results file).
(async () => {
  const log = o => console.log('BENCH ' + JSON.stringify(o));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const done = () => { try { Bench.done(); } catch (e) { /* not in the app */ } };
  try {
    try { localStorage.clear(); } catch (e) { /* first launch anyway */ }
    const t0 = performance.now();
    for (;;) {
      const b = document.getElementById('menu-free');
      if (b && !b.disabled && window.gtaNanded) break;
      if (document.getElementById('fatal') && !document.getElementById('fatal').hidden) { log({ stage: 'fatal', msg: document.getElementById('fatal-msg').textContent }); done(); return; }
      if (performance.now() - t0 > 240000) { log({ stage: 'timeout', status: document.getElementById('loading-status')?.textContent }); done(); return; }
      await wait(250);
    }
    const g = window.gtaNanded, q = g.quality, gl = g.renderer.getContext();
    while (q.fpsCap !== 60) q.cycleFps(); // a phone's default, whatever an earlier run left
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const c = () => [g.renderer.domElement.width, g.renderer.domElement.height];
    const programs = () => g.renderer.info.programs.length;
    // When each loading stage began, in ms since the page started loading (the game marks them;
    // this script itself only starts once the page has loaded, partway through).
    const stages = [];
    for (const m of performance.getEntriesByType('mark')) if (m.name.startsWith('loading: ') && stages.at(-1)?.[0] !== m.name.slice(9)) stages.push([m.name.slice(9), Math.round(m.startTime)]);
    log({ stage: 'menu', loadS: +((performance.now() - t0) / 1000).toFixed(1), loadMs: Math.round(performance.now()), stages, ua: navigator.userAgent, renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      gpu: q.gpu, tier: q.tier, scale: q.scale, canvas: c(), css: [innerWidth, innerHeight], dpr: devicePixelRatio, cores: navigator.hardwareConcurrency, memGB: navigator.deviceMemory, learned: q.learned,
      parallelCompile: !!gl.getExtension('KHR_parallel_shader_compile'), programs: programs() });
    // A player reads the menu for a few seconds while the game gets the start ready: here at least
    // 4 s, and until it is ready (at most 12 s), timed.
    const m0 = performance.now(), onMenu = () => performance.now() - m0;
    let readyMs = null;
    while (onMenu() < 12000 && (readyMs === null || onMenu() < 4000)) {
      if (readyMs === null && g.ready?.done) readyMs = Math.round(onMenu());
      await wait(100);
    }
    log({ stage: 'tap', programs: programs(), readyMs, ready: g.ready });
    // The tap until play starts, until its first frame, and the first frames, each as the gap to the next.
    const gaps = [], t1 = performance.now();
    let last = 0, firstMs = null;
    const frame = g.frame;
    g.frame = function (...a) {
      const t = performance.now();
      if (last) gaps.push(Math.round(t - last)); else firstMs = Math.round(t - t1);
      last = t;
      if (gaps.length >= 40) delete g.frame;
      return frame.apply(this, a);
    };
    document.getElementById('menu-free').click();
    while (!g.started) await wait(10);
    const startMs = Math.round(performance.now() - t1);
    g.save.data.settings.perf = true; g.hud.showPerf(true);
    const sample = async (stage, seconds) => {
      const rows = [], s0 = performance.now();
      while (performance.now() - s0 < seconds * 1000) { await wait(500); if (g.paused) continue; rows.push([g.perf.fps, g.perf.worstMs, g.cpuMs]); }
      const n = rows.length || 1;
      log({ stage, fps: +(rows.reduce((a, r) => a + r[0], 0) / n).toFixed(1), minFps: rows.length ? +Math.min(...rows.map(r => r[0])).toFixed(1) : null, worstMs: rows.length ? Math.round(Math.max(...rows.map(r => r[1]))) : null,
        cpuMs: +(rows.reduce((a, r) => a + r[2], 0) / n).toFixed(1), tier: q.tier, scale: q.scale, crowd: q.crowd, cap: q.fpsCap, canvas: c(), heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null, programs: programs() });
    };
    await wait(3000);
    log({ stage: 'start', startMs, firstMs, worstMs: Math.max(0, ...gaps), gaps, programs: programs() });
    await sample('free-roam', 8);
    for (const id of ['nanded-station', 'hazur-sahib', 'old-mondha-clock-tower', 'shivaji-putla']) {
      const p = g.city.places.find(x => x.id === id);
      g.player.teleport(p.ax, p.az, 0); g.sky.hours = 11;
      await wait(4000);
      await sample(id, 10);
    }
    // A fast drive down the longest wide road: 12 m every 0.6 s, so new streets keep streaming in.
    const net = g.net; let road = -1;
    for (let r = 0; r < net.count; r++) if (!net.raised[r] && net.width[r] >= 9 && (road < 0 || net.length[r] > net.length[road])) road = r;
    let s = 20;
    const tick = setInterval(() => { const p = net.pointAt(road, s, {}); g.player.teleport(p.x + p.dz * 2, p.z - p.dx * 2, Math.atan2(p.dx, p.dz)); s = Math.min(net.length[road] - 5, s + 12); }, 600);
    await sample('driving', 20);
    clearInterval(tick);
    while (q.fpsCap !== 30) q.cycleFps();
    await wait(3000);
    await sample('battery-saver', 8);
    log({ stage: 'end', learned: q.learned, tier: q.tier, scale: q.scale });
  } catch (e) {
    log({ stage: 'error', msg: String(e && e.stack || e).slice(0, 500) });
  }
  done();
})();
