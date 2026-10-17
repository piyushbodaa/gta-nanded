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
  // A soft temple bell: a struck fundamental with a fifth above it that fades slowly.
  bell(){this.tone(523,1.4,'sine',0.05);setTimeout(()=>this.tone(784,1.8,'sine',0.025),120);}
}
