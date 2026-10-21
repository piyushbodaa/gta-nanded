const LENGTH = 12000, REVEAL_AT = 11600;
const ASSETS = Object.fromEntries(['city','driver','chase','crew'].map(name=>[name,`/media/gta-nanded-${name}.webp`]));

/** Original animated comic panels; gameplay starts behind the final curtain. */
export function createIntro() {
  const overlay = document.getElementById('cinematic-intro');
  if (!overlay) throw new Error('The cinematic-intro container is missing.');
  overlay.classList.add('launch-intro');
  overlay.setAttribute('role','dialog'); overlay.setAttribute('aria-modal','true');
  overlay.setAttribute('aria-labelledby','intro-title'); overlay.setAttribute('aria-describedby','launch-description');
  overlay.innerHTML = `
    <h2 id="intro-title" class="launch-sr">GTA Nanded — your city, your streets</h2>
    <p id="launch-description" class="launch-sr">A twelve-second illustrated opening set in Nanded. Press Escape or Skip intro to begin immediately.</p>
    <div class="launch-frame" aria-hidden="true">
      <div class="launch-stamp"><span>GTA</span><strong>NANDED</strong><small>MAHARASHTRA / INDIA</small></div>
      <div class="launch-slash launch-slash-one"></div><div class="launch-slash launch-slash-two"></div>
      <div class="launch-scene launch-city"><img data-art="city" alt="" draggable="false"><div class="launch-grid"></div></div>
      <div class="launch-location"><span>19.15° N / 77.32° E</span><strong>THIS IS<br><b>NANDED.</b></strong><i>GODAVARI TO TARODA</i></div>
      <div class="launch-scene launch-chase"><img data-art="chase" alt="" draggable="false"><span class="launch-panel-tag">YOUR STREETS.<br>YOUR RULES.</span></div>
      <div class="launch-scene launch-driver"><img data-art="driver" alt="" draggable="false"><span class="launch-driver-tag">LOCAL HERO.<br>BIG PLANS.</span></div>
      <div class="launch-scene launch-crew"><img data-art="crew" alt="" draggable="false"></div>
      <div class="launch-quote" lang="mr"><span>उगं नव्हं मय,</span><strong>नांदेड हाय नांदेड!</strong></div>
      <div class="launch-speed-lines"><i></i><i></i><i></i></div>
      <div class="launch-mosaic">${['driver','city','chase','crew'].map(name=>`<div class="launch-tile launch-tile-${name}"><img data-art="${name}" alt="" draggable="false"></div>`).join('')}</div>
      <div class="launch-final-brand"><span>GTA</span><strong>NANDED</strong><small>YOUR CITY. YOUR STORY.</small></div>
      <div class="launch-vignette"></div>
    </div>
    <div class="launch-static" hidden><span class="launch-static-kicker">YOUR CITY IS WAITING</span><div class="launch-static-brand" aria-hidden="true"><span>GTA</span><strong>NANDED</strong></div><p lang="mr">उगं नव्हं मय,<br>नांदेड हाय नांदेड!</p><p id="intro-fallback-message">Begin at Hazur Sahib Nanded station.</p><button id="intro-continue" class="launch-continue" type="button">Enter Nanded ↗</button></div>
    <header class="launch-header"><span class="launch-edition"><i></i>NANDED / MH 26</span><div class="launch-controls"><button id="intro-sound" type="button" aria-pressed="false"><span aria-hidden="true">♫</span><span id="intro-sound-label">Sound off</span></button><button id="intro-skip" type="button">Skip intro ↗</button></div></header>
    <footer class="launch-footer"><div class="launch-start"><span>YOUR STORY STARTS HERE</span><strong>Hazur Sahib Nanded <i>/</i> Station</strong></div><div class="launch-progress-wrap"><div class="launch-progress-copy"><span id="intro-status" role="status">Your city. Your streets.</span><span id="intro-time">0:00 / 0:12</span></div><div id="intro-progress" role="progressbar" aria-label="Opening sequence elapsed time" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="intro-progress-fill"></span></div></div></footer>
    <div class="launch-curtains" aria-hidden="true"><i></i><i></i></div>`;
  const $ = selector => overlay.querySelector(selector);
  const skip=$('#intro-skip'),sound=$('#intro-sound'),continueButton=$('#intro-continue');
  const fallback=$('.launch-static'),status=$('#intro-status'),time=$('#intro-time'),progress=$('#intro-progress'),fill=$('#intro-progress-fill');
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  const audio=new Audio('/media/launch-theme.m4a'); audio.preload='auto'; audio.volume=.72;
  let active=false,destroyed=false,phase='idle',complete=null,returnFocus=null,mode='drive',generation=0;
  let elapsed=0,previousTime=null,frame=0,assetTimer=0,closingTimer=0,muted=true,audioFailed=false,chapter=-1;
  let inertElements=[],tracks=[],curtainTracks=[];
  const removers=[];
  const records=[...overlay.querySelectorAll('img[data-art]')].map(image=>({image,state:'pending'}));
  function listen(target,event,handler,options){target.addEventListener(event,handler,options);removers.push(()=>target.removeEventListener(event,handler,options));}
  function soundLabel(){const audible=!muted&&!audioFailed;audio.muted=!audible;sound.setAttribute('aria-pressed',String(audible));sound.setAttribute('aria-label',`Turn opening music ${audible?'off':'on'}`);$('#intro-sound-label').textContent=audioFailed?'No sound':audible?'Sound on':'Sound off';sound.disabled=audioFailed;}
  function stopAudio(){audio.pause();try{audio.currentTime=0;}catch{/* Not loaded yet. */}}
  function playAudio(){
    if(!active||phase!=='playing'||document.hidden||muted||audioFailed)return;
    const run=generation;
    if(Number.isFinite(audio.duration))audio.currentTime=Math.min(elapsed/1000,audio.duration);
    try{audio.play()?.catch(error=>{if(run!==generation||!active||error?.name==='AbortError')return;muted=true;soundLabel();});}
    catch{muted=true;soundLabel();}
  }
  function cancelTracks(){tracks.forEach(track=>track.cancel());tracks=[];}
  function clearClosing(){clearTimeout(closingTimer);curtainTracks.forEach(track=>track.cancel());curtainTracks=[];overlay.classList.remove('launch-reveal');}
  function motion(selector,frames){
    const animation=$(selector).animate(frames.map(([at,transform,opacity=1])=>({offset:at/LENGTH,transform,opacity,easing:'cubic-bezier(.2,.75,.2,1)'})),{duration:LENGTH,fill:'both',easing:'linear'});
    animation.pause();animation.currentTime=0;tracks.push(animation);
  }
  function buildTracks(){
    cancelTracks();
    motion('.launch-stamp',[[0,'scale(1.55) rotate(-8deg)',0],[120,'scale(1) rotate(-4deg)'],[620,'scale(1.04) rotate(-4deg)'],[950,'translateX(-125%) rotate(-10deg)',0],[12000,'translateX(-125%)',0]]);
    motion('.launch-slash-one',[[0,'translateX(-130%) rotate(-13deg)',0],[200,'translateX(-20%) rotate(-13deg)'],[800,'translateX(130%) rotate(-13deg)'],[900,'translateX(140%)',0],[12000,'translateX(140%)',0]]);
    motion('.launch-slash-two',[[0,'translateX(130%) rotate(-13deg)',0],[300,'translateX(40%) rotate(-13deg)'],[850,'translateX(-140%) rotate(-13deg)'],[950,'translateX(-140%)',0],[12000,'translateX(-140%)',0]]);
    motion('.launch-city',[[0,'translateX(105%)',0],[550,'translateX(105%)'],[1150,'translateX(0)'],[2850,'translateX(-2%)'],[3400,'translateX(-35%) scale(.96)',.55],[5800,'translateX(-45%)',0],[12000,'translateX(-100%)',0]]);
    motion('.launch-location',[[0,'translateY(50px)',0],[1050,'translateY(50px)',0],[1450,'translateY(0)'],[2600,'translateY(0)'],[3100,'translateY(-60px)',0],[12000,'translateY(-60px)',0]]);
    motion('.launch-chase',[[0,'translateX(-110%) rotate(-3deg)',0],[2700,'translateX(-110%) rotate(-3deg)',0],[3350,'translateX(0) rotate(0deg)'],[5400,'translateX(2%)'],[6050,'translateX(-110%) rotate(3deg)',0],[12000,'translateX(-110%)',0]]);
    motion('.launch-driver',[[0,'translateX(130%) rotate(7deg)',0],[2950,'translateX(130%) rotate(7deg)',0],[3550,'translateX(0) rotate(0deg)'],[5450,'translateX(-2%)'],[6150,'translateX(140%) rotate(-5deg)',0],[12000,'translateX(140%)',0]]);
    motion('.launch-crew',[[0,'translateY(110%) rotate(4deg)',0],[5500,'translateY(110%) rotate(4deg)',0],[6150,'translateY(0) rotate(0deg)'],[8450,'translateY(-2%)'],[9200,'translateY(-110%) rotate(-4deg)',0],[12000,'translateY(-110%)',0]]);
    motion('.launch-quote',[[0,'translateX(-120%) rotate(-5deg)',0],[6000,'translateX(-120%) rotate(-5deg)',0],[6500,'translateX(0) rotate(-3deg)'],[8250,'translateX(0) rotate(-3deg)'],[8850,'translateX(120%) rotate(3deg)',0],[12000,'translateX(120%)',0]]);
    motion('.launch-speed-lines',[[0,'translateX(-110%)',0],[2850,'translateX(-110%)',0],[3200,'translateX(110%)',.65],[3450,'translateX(110%)',0],[5600,'translateX(-110%)',0],[6100,'translateX(110%)',.65],[6350,'translateX(110%)',0],[12000,'translateX(110%)',0]]);
    [['driver','translateX(-120%)',8500],['city','translateY(-120%)',8650],['chase','translateX(120%)',8750],['crew','translateY(120%)',8850]].forEach(([name,from,at])=>motion(`.launch-tile-${name}`,[[0,from,0],[at,from,0],[at+650,'translate(0,0)'],[12000,'translate(0,0)']]));
    motion('.launch-final-brand',[[0,'scale(1.7) rotate(-6deg)',0],[9250,'scale(1.7) rotate(-6deg)',0],[9750,'scale(1) rotate(-3deg)'],[11200,'scale(1.025) rotate(-3deg)'],[12000,'scale(1.025) rotate(-3deg)']]);
  }
  function setProgress(){
    const percent=Math.min(100,elapsed/LENGTH*100);fill.style.transform=`scaleX(${percent/100})`;progress.setAttribute('aria-valuenow',String(Math.round(percent)));time.textContent=`0:${String(Math.floor(elapsed/1000)).padStart(2,'0')} / 0:12`;
    const next=elapsed<800?0:elapsed<3000?1:elapsed<5800?2:elapsed<8700?3:4;
    if(chapter!==next){chapter=next;status.textContent=['Your city. Your streets.','Nanded, Maharashtra','Local hero. Big plans.','उगं नव्हं मय, नांदेड हाय नांदेड!','Welcome to GTA Nanded'][chapter];overlay.dataset.chapter=String(chapter);}
  }
  function staticOpening(message){
    if(!active)return;phase='static';clearTimeout(assetTimer);cancelAnimationFrame(frame);cancelTracks();stopAudio();overlay.classList.add('is-static');fallback.hidden=false;sound.hidden=true;
    $('#intro-fallback-message').textContent=message;continueButton.textContent=mode==='replay'?'Back to Nanded ↗':mode==='foot'?'Walk into Nanded ↗':'Enter Nanded ↗';status.textContent='Ready when you are';time.textContent='READY';
    if(document.activeElement===sound)continueButton.focus({preventScroll:true});
  }
  function finish({notify=true,reveal=false}={}){
    if(!active)return;active=false;phase=reveal?'closing':'idle';const run=++generation;clearTimeout(assetTimer);cancelAnimationFrame(frame);stopAudio();cancelTracks();clearClosing();document.body.classList.remove('intro-active');
    inertElements.forEach(([element,previous])=>{element.inert=previous;});inertElements=[];const callback=complete;complete=null;overlay.hidden=!reveal;overlay.setAttribute('aria-modal',String(!reveal));
    if(reveal){overlay.classList.add('launch-reveal');[...overlay.querySelectorAll('.launch-curtains i')].forEach((curtain,index)=>curtainTracks.push(curtain.animate([{transform:'translateX(0)'},{transform:`translateX(${index?105:-105}%)`}],{duration:400,fill:'both',easing:'cubic-bezier(.7,0,.3,1)'})));
      closingTimer=setTimeout(()=>{if(run!==generation||active||destroyed)return;overlay.hidden=true;clearClosing();phase='idle';},400);}
    if(returnFocus?.isConnected&&returnFocus.getClientRects().length)returnFocus.focus({preventScroll:true});
    if(notify)callback?.();
  }
  function tick(now){
    if(!active||phase!=='playing'||document.hidden)return;if(previousTime!==null)elapsed+=Math.max(0,now-previousTime);previousTime=now;tracks.forEach(animation=>{animation.currentTime=Math.min(elapsed,LENGTH);});setProgress();
    if(elapsed>=REVEAL_AT){finish({reveal:true});return;}frame=requestAnimationFrame(tick);
  }
  function beginTimeline(){
    if(!active||phase!=='loading')return;
    if(records.some(record=>record.state==='failed')){staticOpening('The city is ready. Jump straight into Nanded.');return;}
    if(records.some(record=>record.state==='pending'))return;
    clearTimeout(assetTimer);phase='playing';previousTime=null;playAudio();if(!document.hidden)frame=requestAnimationFrame(tick);
  }
  function play(onComplete,options={}){
    if(destroyed||active)return false;clearClosing();active=true;phase='loading';const run=++generation;complete=typeof onComplete==='function'?onComplete:null;mode=options.mode||'drive';returnFocus=document.activeElement;elapsed=0;previousTime=null;chapter=-1;
    overlay.hidden=false;overlay.setAttribute('aria-modal','true');overlay.classList.remove('is-static');document.body.classList.add('intro-active');fallback.hidden=true;sound.hidden=false;soundLabel();
    inertElements=[...document.body.children].filter(element=>element!==overlay&&!element.contains(overlay)&&!['SCRIPT','STYLE','LINK'].includes(element.tagName)).map(element=>[element,element.inert]);inertElements.forEach(([element])=>{element.inert=true;});
    skip.textContent=mode==='replay'?'Back to Nanded ↗':'Skip intro ↗';skip.focus({preventScroll:true});setProgress();
    if(reducedMotion.matches||typeof overlay.animate!=='function'){staticOpening('Begin at Hazur Sahib Nanded station.');return true;}
    buildTracks();tracks.forEach(animation=>{animation.currentTime=160;});status.textContent='Setting the scene…';
    assetTimer=setTimeout(()=>{if(active&&run===generation&&phase==='loading')staticOpening('Your streets are waiting. Continue whenever you like.');},5000);beginTimeline();return true;
  }
  function replay(){return play(null,{mode:'replay'});}
  records.forEach(record=>{const {image}=record;image.decoding='async';listen(image,'load',()=>{if(record.state!=='pending')return;record.state='ready';beginTimeline();});listen(image,'error',()=>{if(record.state!=='pending')return;record.state='failed';image.src='/media/nanded-key-art.webp';if(active)staticOpening('Your streets are waiting. Continue straight into Nanded.');});image.src=ASSETS[image.dataset.art];});
  listen(skip,'click',()=>finish());listen(continueButton,'click',()=>finish());
  const replayButton=document.getElementById('intro-replay');if(replayButton){listen(replayButton,'click',replay);replayButton.disabled=false;}
  listen(sound,'click',()=>{muted=!muted;soundLabel();if(muted)audio.pause();else playAudio();});
  listen(audio,'error',()=>{audioFailed=true;soundLabel();});
  listen(document,'visibilitychange',()=>{if(!active||phase!=='playing')return;cancelAnimationFrame(frame);previousTime=null;if(document.hidden)audio.pause();else{playAudio();frame=requestAnimationFrame(tick);}});
  listen(reducedMotion,'change',()=>{if(active&&reducedMotion.matches)staticOpening('Begin at Hazur Sahib Nanded station.');});
  listen(window,'keydown',event=>{
    if(!active)return;
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();finish();}
    else if(event.key==='Tab'){const buttons=[...overlay.querySelectorAll('button')].filter(button=>!button.disabled&&!button.hidden&&button.getClientRects().length);const first=buttons[0],last=buttons.at(-1);
      if(!buttons.includes(document.activeElement)){event.preventDefault();first?.focus();}else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
  },true);
  return {play,replay,get active(){return active;},destroy(){if(destroyed)return;finish({notify:false});destroyed=true;generation+=1;clearTimeout(assetTimer);cancelAnimationFrame(frame);clearClosing();cancelTracks();stopAudio();overlay.hidden=true;removers.forEach(remove=>remove());audio.removeAttribute('src');audio.load();}};
}
