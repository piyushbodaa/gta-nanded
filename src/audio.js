export class GameAudio {
  constructor() { this.enabled=false;this.ctx=null; }
  async toggle() {
    if(!this.ctx) {
      const AudioContext=window.AudioContext||window.webkitAudioContext;
      if(!AudioContext)return false;
      this.ctx=new AudioContext();this.gain=this.ctx.createGain();this.gain.gain.value=0;
      this.engine=this.ctx.createOscillator();this.engine.type='triangle';this.engine.frequency.value=50;
      this.filter=this.ctx.createBiquadFilter();this.filter.type='lowpass';this.filter.frequency.value=250;
      this.engine.connect(this.filter);this.filter.connect(this.gain);this.gain.connect(this.ctx.destination);this.engine.start();
    }
    this.enabled=!this.enabled;await this.ctx.resume();if(!this.enabled)this.gain.gain.value=0;return this.enabled;
  }
  update(speed,driving,paused) {
    if(!this.ctx)return;
    this.gain.gain.setTargetAtTime(this.enabled&&driving&&!paused?0.045:0,this.ctx.currentTime,0.12);
    this.engine.frequency.setTargetAtTime(42+Math.abs(speed)*3.2,this.ctx.currentTime,0.1);
  }
  tone(frequency,duration=0.15,type='sine',volume=0.07) {
    if(!this.enabled||!this.ctx)return;
    const o=this.ctx.createOscillator(),g=this.ctx.createGain();o.type=type;o.frequency.value=frequency;
    g.gain.setValueAtTime(volume,this.ctx.currentTime);g.gain.exponentialRampToValueAtTime(0.001,this.ctx.currentTime+duration);
    o.connect(g);g.connect(this.ctx.destination);o.start();o.stop(this.ctx.currentTime+duration);
  }
  success(){[440,554,660].forEach((f,i)=>setTimeout(()=>this.tone(f,0.25),i*100));}
  horn(){this.tone(300,0.3,'sawtooth',0.035);this.tone(380,0.3,'sine',0.045);}
  // Rain is a looping, low-passed noise bed: it fades in while it rains and stays silent when sound is off.
  setRain(raining){
    if(!this.ctx)return;
    if(!this.rain){
      const buffer=this.ctx.createBuffer(1,this.ctx.sampleRate*2,this.ctx.sampleRate),data=buffer.getChannelData(0);
      for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
      const source=this.ctx.createBufferSource(),filter=this.ctx.createBiquadFilter(),gain=this.ctx.createGain();
      source.buffer=buffer;source.loop=true;filter.type='lowpass';filter.frequency.value=900;gain.gain.value=0;
      source.connect(filter);filter.connect(gain);gain.connect(this.ctx.destination);source.start();
      this.rain=gain;
    }
    this.rain.gain.setTargetAtTime(raining&&this.enabled?0.035:0,this.ctx.currentTime,0.8);
  }
  // A soft temple bell: a struck fundamental with a fifth above it that fades slowly.
  bell(){this.tone(523,1.4,'sine',0.05);setTimeout(()=>this.tone(784,1.8,'sine',0.025),120);}
  // The two-tone chime that precedes an Indian Railways announcement.
  announcement(){[660,523].forEach((f,i)=>setTimeout(()=>this.tone(f,0.35,'sine',0.05),i*260));}
  // A long dual-tone train horn, low and far away.
  trainHorn(){this.tone(311,1.1,'sawtooth',0.028);this.tone(370,1.1,'sawtooth',0.022);}
  /**
   * Place ambience: a soft murmur bed whose level follows where you stand —
   * market lanes loudest — and a quiet harmonium-like drone near shrines.
   * Levels are 0..1 proximities; everything stays under the engine mix.
   */
  setAmbience({market=0,shrine=0}={}) {
    if(!this.ctx)return;
    if(!this.ambience){
      const buffer=this.ctx.createBuffer(1,this.ctx.sampleRate*2,this.ctx.sampleRate),data=buffer.getChannelData(0);
      let last=0;for(let i=0;i<data.length;i++){const white=Math.random()*2-1;last=(last+0.04*white)/1.04;data[i]=last*3;}
      const source=this.ctx.createBufferSource(),filter=this.ctx.createBiquadFilter(),gain=this.ctx.createGain();
      source.buffer=buffer;source.loop=true;filter.type='bandpass';filter.frequency.value=620;filter.Q.value=0.6;gain.gain.value=0;
      source.connect(filter);filter.connect(gain);gain.connect(this.ctx.destination);source.start();
      const droneGain=this.ctx.createGain();droneGain.gain.value=0;droneGain.connect(this.ctx.destination);
      for(const f of [146.83,220,293.66]){const o=this.ctx.createOscillator();o.type='triangle';o.frequency.value=f;o.connect(droneGain);o.start();}
      this.ambience={murmur:gain,drone:droneGain};
    }
    const t=this.ctx.currentTime,on=this.enabled?1:0;
    this.ambience.murmur.gain.setTargetAtTime(on*Math.max(0,Math.min(1,market))*0.05,t,0.9);
    this.ambience.drone.gain.setTargetAtTime(on*Math.max(0,Math.min(1,shrine))*0.016,t,1.2);
  }
}
