import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

// DOM/event/timer fixture only. This deliberately does not claim browser rendering,
// media decoding, accessibility-tree or autoplay-policy coverage.
const root = fileURLToPath(new URL('../', import.meta.url));
const mockedGlobals = ['document','window','matchMedia','performance','requestAnimationFrame','cancelAnimationFrame','setTimeout','clearTimeout','Image','Audio','HTMLElement','HTMLButtonElement','getComputedStyle','navigator'];
const originalGlobals = new Map(mockedGlobals.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
afterEach(()=>{for(const [name,descriptor] of originalGlobals){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}});
let clock = 0, nextTimer = 1, timers = new Map(), imageMode='ready', audios=[];
class Target {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn, options) {
    const list = this.listeners.get(type) || [];
    list.push({ fn, once: typeof options === 'object' && options.once });
    this.listeners.set(type, list);
  }
  removeEventListener(type, fn) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(x => x.fn !== fn));
  }
  dispatchEvent(event) {
    event.target ||= this; event.currentTarget = this;
    event.preventDefault ||= function () { this.defaultPrevented = true; };
    event.stopPropagation ||= function () { this.stopped = true; };
    event.stopImmediatePropagation ||= function () { this.immediateStopped = true; this.stopped = true; };
    if (typeof this['on'+event.type] === 'function') this['on'+event.type](event);
    for (const listener of [...(this.listeners.get(event.type) || [])]) {
      listener.fn(event);
      if (listener.once) this.removeEventListener(event.type, listener.fn);
      if (event.immediateStopped) break;
    }
    return !event.defaultPrevented;
  }
  emit(type, extra = {}) { const event = { type, ...extra }; this.dispatchEvent(event); return event; }
}
class Classes {
  constructor() { this.names = new Set(); }
  add(...names) { names.forEach(n => this.names.add(n)); }
  remove(...names) { names.forEach(n => this.names.delete(n)); }
  contains(name) { return this.names.has(name); }
  toggle(name, force = !this.contains(name)) { force ? this.add(name) : this.remove(name); return force; }
}
let doc;
class Element extends Target {
  constructor(tag = 'div') {
    super(); this.tagName = tag.toUpperCase(); this.id = ''; this.classList = new Classes();
    this.attributes = new Map(); this.style = { setProperty(k,v) { this[k] = v; }, removeProperty(k) { delete this[k]; } };
    this.dataset = {}; this.children = []; this.parentElement = null; this.hidden = false; this.disabled = false;
    this.inert = false; this.isConnected = true; this.textContent = ''; this.src = ''; this.paused = true;
    this.muted = true; this.volume = 1; this.currentTime = 0; this.duration = 18; this.readyState = 4;
    this.complete = true; this.naturalWidth = 1920; this.naturalHeight = 1080; this.animations=[];
  }
  set innerHTML(value) { this.children=[]; parseFragment(this,value); }
  get innerHTML() { return ''; }
  set src(value) {this._src=value;if(value&&this.tagName==='IMG'&&imageMode==='ready')queueMicrotask(()=>{this.complete=true;this.naturalWidth=1920;this.emit('load');});}
  get src() {return this._src||'';}
  setAttribute(name,value) {
    value = String(value); this.attributes.set(name,value);
    if (name === 'id') this.id = value;
    if (name === 'class') this.classList.add(...value.split(/\s+/));
    if (name === 'hidden') this.hidden = true;
    if (name === 'src') this.src = value;
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g,(_,s)=>s.toUpperCase())] = value;
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); if(name === 'src')this.src = ''; if(name === 'hidden')this.hidden = false; }
  appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
  append(...children) { children.forEach(c => this.appendChild(c)); }
  remove() { if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(c=>c!==this); this.isConnected=false; }
  contains(el) { return this === el || this.children.some(c=>c.contains(el)); }
  querySelectorAll(selector) { return allChildren(this).filter(el=>matches(el,selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getClientRects() { let el=this; while(el){if(el.hidden)return [];el=el.parentElement;} return this.isConnected?[{width:100,height:40}]:[]; }
  getBoundingClientRect() { return { x:0,y:0,left:0,top:0,width:1280,height:720,right:1280,bottom:720 }; }
  focus() { doc.activeElement=this; }
  click() { if(!this.disabled)this.emit('click'); }
  pause() { this.paused=true; }
  play() { this.paused=false; return Promise.resolve(); }
  load() { this.currentTime=0; }
  decode() { return Promise.resolve(); }
  animate(keyframes,options) { const animation={currentTime:0,playState:'running',effect:{getTiming:()=>options},pause(){this.playState='paused';},play(){this.playState='running';},cancel(){this.playState='idle';},finish(){this.playState='finished';}};this.animations.push(animation);return animation; }
  getAnimations() { return this.animations; }
  cloneNode() { const e=new Element(this.tagName); for(const [k,v]of this.attributes)e.setAttribute(k,v);return e; }
}
function allChildren(el) { return el.children.flatMap(c=>[c,...allChildren(c)]); }
function matches(el,selectors) {
  return selectors.split(',').some(raw=>{
    const parts=raw.trim().split(/\s+/);let cursor=el;
    const partMatches=(e,s)=>{const tag=s.match(/^[a-zA-Z][\w-]*/)?.[0];if(tag&&e.tagName.toLowerCase()!==tag.toLowerCase())return false;
      const id=s.match(/#([\w-]+)/)?.[1];if(id&&e.id!==id)return false;
      if([...s.matchAll(/\.([\w-]+)/g)].some(m=>!e.classList.contains(m[1])))return false;
      if([...s.matchAll(/\[([\w-]+)(?:=["']?([^"'\]]+)["']?)?\]/g)].some(m=>!e.hasAttribute(m[1])||(m[2]!==undefined&&e.getAttribute(m[1])!==m[2])))return false;
      return true;};
    if(!partMatches(cursor,parts.pop()))return false;
    while(parts.length){const part=parts.pop();cursor=cursor.parentElement;while(cursor&&!partMatches(cursor,part))cursor=cursor.parentElement;if(!cursor)return false;}return true;
  });
}
function parseFragment(parent,source) {
  const stack=[parent];
  for(const m of source.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g)) {
    const [,close,tag,attrs]=m;
    if(close){const index=stack.findLastIndex(el=>el.tagName===tag.toUpperCase());if(index>0)stack.length=index;continue;}
    if(['html','head','body','meta','link','script','title'].includes(tag.toLowerCase()))continue;
    const element=new Element(tag);
    for(const a of attrs.matchAll(/([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'))?/g))element.setAttribute(a[1],a[2]??a[3]??'');
    element.disabled=element.hasAttribute('disabled');stack.at(-1).append(element);
    if(!['img','input','br','hr','source','path','rect','circle'].includes(tag.toLowerCase())&&!attrs.endsWith('/'))stack.push(element);
  }
}
const html = await readFile(`${root}/index.html`,'utf8');
function reset({ reduced = false, pendingImages = false, rejectAudio = false }={}) {
  timers = new Map(); clock=0; nextTimer=1;
  doc=new Target();doc.body=new Element('body');doc.documentElement=new Element('html');doc.documentElement.append(doc.body);
  imageMode=pendingImages?'pending':'ready';audios=[];parseFragment(doc.body,html);
  doc.getElementById=id=>[doc.body,...allChildren(doc.body)].find(e=>e.id===id)||null;
  doc.querySelectorAll=s=>allChildren(doc.body).filter(e=>matches(e,s));
  doc.querySelector=s=>doc.querySelectorAll(s)[0]||null;
  doc.createElement=tag=>new Element(tag);doc.activeElement=doc.body;doc.hidden=false;doc.visibilityState='visible';
  if(pendingImages)for(const image of doc.querySelectorAll('img')){image.complete=false;image.naturalWidth=0;}
  globalThis.document=doc;globalThis.window=new Target();window.document=doc;window.innerWidth=1280;window.innerHeight=720;
  const query = new Target();query.matches=reduced;globalThis.matchMedia=()=>query;window.matchMedia=matchMedia;
  globalThis.performance={now:()=>clock};
  globalThis.requestAnimationFrame=fn=>{const id=nextTimer++;timers.set(id,{at:clock+16,fn:()=>fn(clock),kind:'raf'});return id;};
  globalThis.cancelAnimationFrame=id=>timers.delete(id);
  globalThis.setTimeout=(fn,delay=0)=>{const id=nextTimer++;timers.set(id,{at:clock+delay,fn,kind:'timeout'});return id;};
  globalThis.clearTimeout=id=>timers.delete(id);
  globalThis.Image=class extends Element{constructor(){super('img');if(pendingImages){this.complete=false;this.naturalWidth=0;}}};
  globalThis.Audio=class extends Element{constructor(src){super('audio');this.src=src||'';audios.push(this);}play(){if(rejectAudio){this.paused=true;return Promise.reject(new Error('Blocked media'));}return super.play();}};
  globalThis.HTMLElement=Element;globalThis.HTMLButtonElement=Element;
  globalThis.getComputedStyle=el=>({display:el.hidden?'none':'block',visibility:'visible'});
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{language:'en-IN',connection:{saveData:false}}});
  return {doc,query,$:id=>doc.getElementById(id)};
}
async function tick(ms) {
  for(let i=0;i<12;i++)await Promise.resolve();
  const until=clock+ms;let count=0;
  while(true){const pending=[...timers].filter(([,t])=>t.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];if(!pending)break;
    if(++count>20000)throw Error('timer loop');const[id,t]=pending;timers.delete(id);clock=t.at;t.fn();await Promise.resolve();}
  clock=until;await Promise.resolve();
}
const { createIntro } = await import(pathToFileURL(`${root}/src/intro.js`).href+`?test=${Date.now()}`);
test('skip completes once; active guard; original inert and focus restore',async()=>{
  const {$,doc}=reset();let calls=0;const trigger=$('start-drive');trigger.focus();$('hud').inert=true;
  const intro=createIntro();assert.equal(intro.play(()=>calls++,{mode:'drive'}),true);assert.equal(intro.active,true);
  assert.equal(intro.play(()=>{calls+=100}),false);assert.equal($('welcome').inert,true);assert.equal(doc.activeElement,$('intro-skip'));
  $('intro-skip').click();$('intro-skip').click();await tick(30000);
  assert.equal(calls,1);assert.equal(intro.active,false);assert.equal($('welcome').inert,false);assert.equal($('hud').inert,true);assert.equal(doc.activeElement,trigger);
  intro.destroy();
});
test('Escape prevents main handler from receiving same event',()=>{
  const {$}=reset();let calls=0,escaped=0;const intro=createIntro();window.addEventListener('keydown',()=>escaped++);
  intro.play(()=>calls++);const event=window.emit('keydown',{key:'Escape',code:'Escape'});
  assert.equal(calls,1);assert.equal(escaped,0);assert.equal(event.defaultPrevented,true);assert.equal($('cinematic-intro').hidden,true);intro.destroy();
});
test('focus trap wraps visible controls',()=>{
  const {doc,$}=reset();const intro=createIntro();intro.play(()=>{});
  const controls=$('cinematic-intro').querySelectorAll('button').filter(b=>!b.disabled&&b.getClientRects().length);
  controls.at(-1).focus();window.emit('keydown',{key:'Tab'});assert.equal(doc.activeElement,controls[0]);
  controls[0].focus();window.emit('keydown',{key:'Tab',shiftKey:true});assert.equal(doc.activeElement,controls.at(-1));intro.destroy();
});
test('reduced motion stays static until explicit Continue',async()=>{
  const {$}=reset({reduced:true});let calls=0;const intro=createIntro();intro.play(()=>calls++,{mode:'foot'});
  await tick(30000);assert.equal(calls,0);assert.equal(intro.active,true);assert.equal(doc.querySelector('.launch-static').hidden,false);
  $('intro-continue').click();assert.equal(calls,1);assert.equal(intro.active,false);intro.destroy();
});
test('destroy while active suppresses completion and removes handlers',async()=>{
  const {$}=reset();let calls=0;const intro=createIntro();intro.play(()=>calls++);intro.destroy();
  $('intro-skip').click();$('intro-continue').click();await tick(30000);
  assert.equal(calls,0);assert.equal(intro.active,false);assert.equal($('welcome').inert,false);
});
test('replay preserves chosen sound and does not reuse previous completion callback',async()=>{
  const {$}=reset();let calls=0;const intro=createIntro();intro.play(()=>calls++);$('intro-sound').click();
  assert.equal($('intro-sound').getAttribute('aria-pressed'),'true');$('intro-skip').click();
  assert.equal(calls,1);assert.equal(intro.replay(),true);assert.equal($('intro-sound').getAttribute('aria-pressed'),'true');
  $('intro-skip').click();await tick(30000);assert.equal(calls,1);intro.destroy();
});

test('natural ending completes once, then clears its short reveal',async()=>{
  const {$}=reset();let calls=0;const intro=createIntro();intro.play(()=>calls++);
  assert.equal($('intro-sound').getAttribute('aria-pressed'),'false');
  await tick(11000);assert.equal(calls,0);assert.equal(intro.active,true);
  await tick(700);assert.equal(calls,1);assert.equal(intro.active,false);
  await tick(500);assert.equal($('cinematic-intro').hidden,true);assert.equal(calls,1);intro.destroy();
});
test('hidden tab pauses elapsed time and enabled audio until visible',async()=>{
  const {doc,$}=reset();let calls=0;const intro=createIntro();intro.play(()=>calls++);await tick(3000);$('intro-sound').click();
  assert.equal(audios[0].paused,false);doc.hidden=true;doc.visibilityState='hidden';doc.emit('visibilitychange');
  assert.equal(audios[0].paused,true);await tick(30000);assert.equal(calls,0);assert.equal(intro.active,true);
  doc.hidden=false;doc.visibilityState='visible';doc.emit('visibilitychange');assert.equal(audios[0].paused,false);
  await tick(8000);assert.equal(calls,0);await tick(800);assert.equal(calls,1);intro.destroy();
});
test('broken image offers Continue and rescues focus from hidden sound button',async()=>{
  const {doc,$}=reset({pendingImages:true});let calls=0;const intro=createIntro();intro.play(()=>calls++);$('intro-sound').focus();
  doc.querySelector('img[data-art]').emit('error');assert.equal(doc.querySelector('.launch-static').hidden,false);
  assert.equal(doc.activeElement,$('intro-continue'));await tick(30000);assert.equal(calls,0);
  $('intro-continue').click();assert.equal(calls,1);intro.destroy();
});
test('image loading timeout leaves an explicit Continue instead of starting game',async()=>{
  const {doc,$}=reset({pendingImages:true});let calls=0;const intro=createIntro();intro.play(()=>calls++);await tick(6000);
  assert.equal(doc.querySelector('.launch-static').hidden,false);assert.equal(calls,0);assert.equal(intro.active,true);
  $('intro-continue').click();assert.equal(calls,1);intro.destroy();
});
test('blocked sound returns to off without preventing natural completion',async()=>{
  const {$}=reset({rejectAudio:true});let calls=0;const intro=createIntro();intro.play(()=>calls++);await tick(0);$('intro-sound').click();await tick(0);
  assert.equal($('intro-sound').getAttribute('aria-pressed'),'false');await tick(12200);assert.equal(calls,1);intro.destroy();
});
test('changing reduced-motion preference during playback offers Continue',async()=>{
  const {doc,query,$}=reset();let calls=0;const intro=createIntro();intro.play(()=>calls++);await tick(2000);
  query.matches=true;query.emit('change');await tick(30000);assert.equal(calls,0);assert.equal(doc.querySelector('.launch-static').hidden,false);
  $('intro-continue').click();assert.equal(calls,1);intro.destroy();
});
test('replaying during the reveal cannot be hidden by the prior cleanup timer',async()=>{
  const {$}=reset();let calls=0;const intro=createIntro();intro.play(()=>calls++);await tick(11700);assert.equal(calls,1);
  assert.equal(intro.replay(),true);await tick(600);assert.equal(intro.active,true);assert.equal($('cinematic-intro').hidden,false);
  $('intro-skip').click();assert.equal(calls,1);intro.destroy();
});
test('destroy during reveal is final and rejects future playback',async()=>{
  const {$}=reset();let calls=0;const intro=createIntro();intro.play(()=>calls++);await tick(11700);intro.destroy();await tick(10000);
  assert.equal(calls,1);assert.equal(intro.active,false);assert.equal($('cinematic-intro').hidden,true);assert.equal(intro.play(()=>calls++),false);
});
