import { MusicPlayer } from './music.js';

const track = (id, title, bars, bpm) => ({ id, title, seconds: bars * 240 / bpm });
export const STATIONS = [
  { id: 'godavari', name: 'Radio Godavari 92.7', tag: 'Bass, brass & dhol breaks', color: '#ffcf3f',
    tracks: [track('forecourt', 'Forecourt Funk', 24, 94), track('ring-road', 'Ring Road Relay', 24, 100)] },
  { id: 'lavani', name: 'Lavani Express 98.3', tag: 'ढोलकी आणि हार्मोनियम', color: '#ff8fb1',
    tracks: [track('goods-yard', 'Goods Yard Express', 24, 112), track('last-local', 'Last Local', 24, 106)] },
  { id: 'katta', name: 'Katta Lo-Fi 101.1', tag: 'After-hours instrumentals', color: '#7fd1ff',
    tracks: [track('blue-shutter', 'Blue Shutter', 20, 80), track('chai-at-four', 'Chai at Four', 20, 75)] },
];

export class Radio {
  constructor(ctx, out, load) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.connect(out);
    this.player = new MusicPlayer(ctx, this.out, load);
    this.index = 0;
    this.epochs = new Map();
    this.duckUntil = 0;
    this.song = null;
    this.playing = false;
  }

  get station() { return STATIONS[this.index] ?? null; }

  cycle() {
    this.setIndex(this.index >= STATIONS.length - 1 ? -1 : this.index + 1);
    return this.station || { name: 'Radio off', tag: '' };
  }

  setIndex(index) {
    this.index = Math.max(-1, Math.min(STATIONS.length - 1, Math.round(index) || 0));
  }

  duck(seconds) {
    this.duckUntil = Math.max(this.duckUntil, this.ctx.currentTime + seconds);
  }

  update(dt, inVehicle, game) {
    const now = this.ctx.currentTime;
    const quiet = game?.paused || game?.cutscene || game?.respawning || game?.audio?.volume.music === 0;
    const pursuit = game?.police?.level >= 2;
    const station = inVehicle ? this.station : null;
    let id, epoch, volume;
    if (quiet || (inVehicle && !station)) {
      this.song = null; this.playing = false; this.player.stop();
      return;
    }
    const duck = now < this.duckUntil;
    this.out.gain.setTargetAtTime(duck ? .36 : 1, now, duck ? .04 : .24);
    if (station && !pursuit) {
      // Tuning away or getting out leaves the broadcast running on the dial.
      if (!this.epochs.has(station.id)) this.epochs.set(station.id, now);
      const [a, b] = station.tracks;
      const elapsed = (now - this.epochs.get(station.id)) % (a.seconds + b.seconds);
      const song = elapsed < a.seconds ? a : b;
      epoch = now - (song === a ? elapsed : elapsed - a.seconds);
      id = song.id; volume = .67;
      if (id !== this.song) game?.hud?.radioText?.(station.name, song.title, station.color);
    } else {
      id = pursuit ? 'checkpost' : 'backstreets';
      // Return to a different part of the street arrangement after a short drive.
      if (!this.epochs.has(id) || (pursuit && this.song !== id)) this.epochs.set(id, now);
      epoch = this.epochs.get(id);
      volume = pursuit ? .47 : .29;
    }
    this.song = id; this.playing = true;
    this.player.play(`/media/music/${id}.m4a`, volume, () => this.ctx.currentTime - epoch);
  }
}
