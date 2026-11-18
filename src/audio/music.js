// The audio clock drives playback even when a busy frame takes longer than a beat.
// Only the current recording and one incoming recording need decoded PCM on a phone.
export async function decodeFile(ctx, url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Audio unavailable (${response.status})`);
  return ctx.decodeAudioData(await response.arrayBuffer());
}

export class MusicPlayer {
  constructor(ctx, bus, load = decodeFile) {
    this.ctx = ctx;
    this.bus = bus;
    this.load = load;
    this.current = null;
    this.pending = null;
    this.cached = null;
    this.failed = null;
  }

  prepare(url) {
    if (this.pending?.url === url && !this.pending.controller.signal.aborted) return this.pending.promise;
    this.pending?.controller.abort();
    if (this.cached?.url === url) return Promise.resolve(this.cached.buffer);
    const controller = new AbortController();
    const promise = this.load(this.ctx, url, controller.signal).then(buffer => {
      if (!controller.signal.aborted) this.cached = { url, buffer };
      return buffer;
    }).finally(() => { if (this.pending?.controller === controller) this.pending = null; });
    this.pending = { url, controller, promise };
    return promise;
  }

  play(url, level, offset = () => 0, loop = true, onError) {
    if (url === this.wanted || (url === this.failed?.url && this.ctx.currentTime < this.failed.retry)) return;
    this.wanted = url;
    const token = this.token = {};
    // Leave the outgoing mix promptly even on a slow connection.
    this._fadeOut(.32);
    this.prepare(url).then(buffer => {
      if (token !== this.token) return;
      const ctx = this.ctx, now = ctx.currentTime, at = offset();
      if (!loop && at >= buffer.duration) return;
      const source = ctx.createBufferSource(), gain = ctx.createGain();
      source.buffer = buffer; source.loop = loop;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(level, now + (loop ? .42 : .035));
      source.connect(gain).connect(this.bus);
      source.onended = () => { source.disconnect(); gain.disconnect(); };
      source.start(now, Math.max(0, at) % buffer.duration);
      this.current = { url, source, gain };
      this.failed = null;
    }).catch(() => {
      if (token !== this.token) return;
      this.failed = { url, retry: this.ctx.currentTime + 5 };
      this.wanted = null;
      onError?.();
    });
  }

  _fadeOut(seconds) {
    if (!this.current) return;
    const { gain, source } = this.current, now = this.ctx.currentTime;
    const volume = gain.gain.value;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.linearRampToValueAtTime(0, now + seconds);
    source.stop(now + seconds + .005);
    this.current = null;
  }

  stop(seconds = .18) {
    if (!this.wanted && !this.pending && !this.current) return;
    this.wanted = null; this.token = null;
    this.pending?.controller.abort();
    this.pending = null;
    this._fadeOut(seconds);
  }
}
