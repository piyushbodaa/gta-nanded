import { PLACES } from './city-data.js';

const landmarkOrder = ['hazur-sahib','nagina-ghat','godavari-river','nandgiri-fort','kaleshwar-temple','vishnupuri-dam','mal-tekdi','old-mondha-clock-tower','langar-sahib','urvashi-ghat','ram-ghat','govardhan-ghat','banda-ghat','sangat-sahib','hira-ghat','mata-sahib','shikar-ghat'];
export const LANDMARKS = landmarkOrder.map(id => PLACES.find(p => p.id === id)).filter(Boolean);
export const STAMP_REWARD = 150;
const validIds = new Set(LANDMARKS.map(p => p.id));
export function loadStamps(storage) {
  try {
    const progress = JSON.parse(storage.getItem('nanded-stories-v1'));
    // An explicit empty or invalid field is authoritative: never resurrect an
    // old passport after a reset or split newly saved cash from its stamp state.
    const value = progress && typeof progress === 'object' && Object.hasOwn(progress, 'stamps')
      ? progress.stamps
      : JSON.parse(storage.getItem('gta-nanded-passport-v1'));
    return new Set(Array.isArray(value) ? value.filter(id => validIds.has(id)) : []);
  } catch { return new Set(); }
}
export function nearestPhotoSpot(position, onFoot, radius = 24) {
  if (!onFoot) return null;
  return LANDMARKS.filter(p => Math.hypot(p.approach.x-position.x,p.approach.z-position.z) <= radius)
    .sort((a,b) => Math.hypot(a.approach.x-position.x,a.approach.z-position.z)-Math.hypot(b.approach.x-position.x,b.approach.z-position.z))[0] || null;
}
export function collectStamp(stamps, placeId) {
  if (!validIds.has(placeId) || stamps.has(placeId)) return 0;
  stamps.add(placeId); return STAMP_REWARD;
}

const el = (tag, className, text) => { const node=document.createElement(tag); if(className)node.className=className;if(text!==undefined)node.textContent=text;return node; };
const photoPrompts = {
  'hazur-sahib':'Golden dome, white courtyard, your Nanded memory. Find a view you like and collect the stamp.',
  'nagina-ghat':'Leave the busy streets for a moment. Find the shrine beside the Godavari and take your postcard.',
  'godavari-river':'Every Nanded story comes back to the Godavari. Add a riverfront frame to your passport.',
  'nandgiri-fort':'Head into old Nanded and find the stone gateway. The fort is your next photo stop.',
  'kaleshwar-temple':'A Vishnupuri detour for the temple silhouette and a fresh view of the city.',
  'vishnupuri-dam':'Find the barrage gates, the water and the skyline. Complete your Vishnupuri pair of stamps.',
  'mal-tekdi':'Look for the white dome and the entrance arch. Another familiar Nanded silhouette for your collection.',
  'old-mondha-clock-tower':'Old Mondha, one tower and four clock faces. Look up before you take your photo.',
  'langar-sahib':'Make a stop in the riverfront shrine district. Collect a quiet moment before your next adventure.',
  'urvashi-ghat':'Follow the steps down toward the river. Your Godavari collection starts with a new angle.',
  'ram-ghat':'Another ghat, another familiar view. Find its mint ring and add Ram Ghat to the passport.',
  'govardhan-ghat':'Find a riverfront frame around Govardhan Ghat. Three ghats make a good evening plan.',
  'banda-ghat':'Keep exploring the riverfront. A small detour earns another Nanded memory.',
  'sangat-sahib':'Find the riverside shrine and collect its photo stamp. Take your time looking around.',
  'hira-ghat':'An eastern river detour. Visit on foot here, or make a longer ride out of it.',
  'mata-sahib':'Continue your eastern Nanded trail with another shrine beside the river.',
  'shikar-ghat':'Finish your outer-river collection here. One more memory for the Nanded passport.',
};
const kindLabel = {story:'YOUR FIRST CHAPTER',sprint:'ON FOOT / TIME TRIAL',photo:'PHOTO ADVENTURE',social:'LOCAL STORIES',race:'STREET CIRCUIT',chase:'ARCADE GETAWAY'};
const kindLabelMr = {story:'तुमचा पहिला धडा',sprint:'पायी वेळेची शर्यत',photo:'फोटो साहस',social:'स्थानिक गप्पा',race:'रेस ट्रॅक',chase:'आर्केड पळ'};
const photoPromptsMr = {
  'hazur-sahib':'सोनेरी घुमट, पांढरं अंगण, तुमची नांदेडची आठवण. एक दृश्य निवडा आणि शिक्का मिळवा.',
  'nagina-ghat':'गर्दीतून थोडं बाजूला या. गोदावरीकाठचं मंदिर शोधा आणि पोस्टकार्ड घ्या.',
  'godavari-river':'प्रत्येक नांदेड गोष्ट गोदावरीकडे परत येते. एक नदीकाठची फ्रेम जोडा.',
  'nandgiri-fort':'जुन्या नांदेडमध्ये जा आणि दगडी दरवाजा शोधा. पुढचा फोटो थांबा किल्ला.',
};
const kindIcon = {story:'01',sprint:'↗',photo:'◎',social:'✦',race:'⚑',chase:'★'};

/** A paused activity picker: every card starts a real playable activity. */
export function createAdventureMenu({missions,onMission,onVisit,onRoam,onClose,getStamps,t=(en)=>en}) {
  const panel=document.getElementById('adventure-menu'), grid=document.getElementById('adventure-grid');
  const tabs=[...panel.querySelectorAll('[data-adventure-tab]')];
  let view='activities', returnFocus=null, inert=[];
  function render(){
    const stamps=getStamps();
    document.getElementById('passport-count').textContent=t(`${stamps.size} / ${LANDMARKS.length} stamps`,`${stamps.size} / ${LANDMARKS.length} शिक्के`);
    document.getElementById('adventure-roam').textContent=t('Just roam →','फक्त फिरा →');
    tabs.forEach(tab=>{tab.textContent=t(tab.dataset.adventureTab==='activities'?'Adventures':'Landmark passport',tab.dataset.adventureTab==='activities'?'साहसं':'खुणांची पासपोर्ट');});
    document.getElementById('adventure-description').textContent=view==='activities'
      ? t('A quick gully sprint, a landmark photo walk, or a proper getaway. Pick your next story. Each activity takes you to its starting point.','गल्लीत धाव, खुणांची फोटो फेरी किंवा मोठा पळ. तुमची पुढची गोष्ट निवडा. प्रत्येक साहस तुम्हाला सुरुवातीच्या ठिकाणी नेईल.')
      : t('Collect the places that make Nanded, Nanded. Arrive on foot and take a photo with Q or the Photo button. Each new stamp earns ₹150.','नांदेड घडवणारी ठिकाणं गोळा करा. पायी पोहोचा आणि Q किंवा Photo दाबून फोटो काढा. प्रत्येक नवा शिक्का ₹150 मिळवून देतो.');
    grid.replaceChildren();
    tabs.forEach(tab=>tab.setAttribute('aria-pressed',String(tab.dataset.adventureTab===view)));
    (view==='activities'?missions:LANDMARKS).forEach((item,index)=>{
      const card=el('article',`adventure-card ${view==='landmarks'?'landmark-card':''}`);
      const collected=stamps.has(item.id);
      const top=el('div','adventure-card-top');
      top.append(el('span','adventure-symbol',view==='landmarks'?(collected?'✓':'◇'):(kindIcon[item.kind]||'↗')),
        el('span','adventure-type',view==='landmarks'?(collected?t('STAMP COLLECTED','शिक्का मिळाला'):item.area):t(kindLabel[item.kind]||item.kind.toUpperCase(),kindLabelMr[item.kind]||kindLabel[item.kind]||item.kind.toUpperCase())));
      card.append(top,el('h3','',view==='landmarks'?item.shortName:t(item.title,item.title)));
      card.append(el('p','',view==='landmarks'?t(photoPrompts[item.id]||'Step into a familiar part of Nanded and collect its photo stamp.',photoPromptsMr[item.id]||'नांदेडच्या ओळखीच्या भागात पाऊल ठेवा आणि शिक्का मिळवा.'):t(item.shortDescription,item.shortDescriptionMr||item.shortDescription)));
      const bottom=el('div','adventure-card-bottom');
      bottom.append(el('span','',view==='landmarks'?(collected?t('In your passport','पासपोर्टमध्ये'):t('+₹150 · PHOTO STAMP','+₹150 · फोटो शिक्का')):(item.survive||item.seconds?`${Math.ceil(item.survive||item.seconds)}s · ₹${item.reward}`:`${t('NO TIMER','वेळेचं बंधन नाही')} · ₹${item.reward}`)));
      const button=el('button','',view==='landmarks'?t('Visit on foot →','पायी भेट द्या →'):t('Play activity →','साहस सुरू करा →'));button.type='button';
      button.setAttribute('aria-label',`${view==='landmarks'?'Visit':'Play'} ${view==='landmarks'?item.shortName:item.title}`);
      button.addEventListener('click',()=>view==='landmarks'?onVisit(item):onMission(index));bottom.append(button);card.append(bottom);grid.append(card);
    });
  }
  tabs.forEach(tab=>tab.addEventListener('click',()=>{view=tab.dataset.adventureTab;render();}));
  document.getElementById('adventure-close').addEventListener('click',onClose);
  document.getElementById('adventure-roam').addEventListener('click',onRoam);
  panel.addEventListener('keydown',event=>{
    event.stopPropagation();
    if(event.key==='Escape'){event.preventDefault();onClose();}
    if(event.key==='Tab'){
      const controls=[...panel.querySelectorAll('button')].filter(n=>!n.disabled&&n.getClientRects().length);
      const first=controls[0],last=controls.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
  });
  return {
    open(tab='activities'){
      view=tab;returnFocus=document.activeElement;render();panel.hidden=false;
      inert=[...document.querySelectorAll('.site-header,#hud,#touch-controls')].map(n=>[n,n.inert]);inert.forEach(([n])=>{n.inert=true;});
      document.getElementById('adventure-close').focus();
    },
    close(){panel.hidden=true;inert.forEach(([n,previous])=>{n.inert=previous;});inert=[];returnFocus?.focus?.({preventScroll:true});},
  };
}
