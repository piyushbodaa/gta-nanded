import test from 'node:test';
import assert from 'node:assert/strict';
import {LANDMARKS,loadStamps,nearestPhotoSpot,collectStamp,STAMP_REWARD} from '../src/adventures.js';
import {loadProgress,saveProgress} from '../src/mechanics.js';

function memoryStorage(entries=[]) {
  const records=new Map(entries),writes=[];
  return {records,writes,getItem:key=>records.get(key)??null,setItem(key,value){writes.push({key,value});records.set(key,value);}};
}

test('landmark stamps require an on-foot visit and cannot be collected remotely',()=>{
  assert.ok(LANDMARKS.length>=13);
  for(const p of LANDMARKS){
    assert.equal(nearestPhotoSpot(p.approach,false),null);
    assert.ok(nearestPhotoSpot(p.approach,true));
  }
  assert.equal(nearestPhotoSpot({x:1e8,z:1e8},true),null);
});
test('each known landmark awards its stamp once; corrupt or unknown IDs cannot earn cash',()=>{
  const stamps=new Set();
  for(const p of LANDMARKS){assert.equal(collectStamp(stamps,p.id),STAMP_REWARD);assert.equal(collectStamp(stamps,p.id),0);}
  assert.equal(collectStamp(stamps,'invented'),0);assert.equal(stamps.size,LANDMARKS.length);
});
test('a stamp and its cash reward persist in the same progress record and single write',()=>{
  const storage=memoryStorage(),stamps=new Set(),id=LANDMARKS[0].id;
  const cash=400+collectStamp(stamps,id);
  assert.equal(saveProgress(storage,{cash,completed:2,stamps:[...stamps]}),true);
  assert.equal(storage.writes.length,1);
  assert.equal(storage.writes[0].key,'nanded-stories-v1');
  assert.deepEqual(JSON.parse(storage.writes[0].value),{cash:400+STAMP_REWARD,completed:2,stamps:[id]});
  assert.deepEqual(loadProgress(storage),{cash,completed:2});
  const restored=loadStamps(storage);assert.deepEqual(restored,stamps);
  assert.equal(collectStamp(restored,id),0,'reloading cannot award the persisted photograph twice');
  assert.equal(storage.records.has('gta-nanded-passport-v1'),false);
});

test('legacy passports migrate only when the progress record has no stamps field',()=>{
  const id=LANDMARKS[0].id,legacy=JSON.stringify([id,'invented',id]);
  const storage=memoryStorage([['gta-nanded-passport-v1',legacy]]);
  assert.deepEqual(loadStamps(storage),new Set([id]));
  storage.records.set('nanded-stories-v1',JSON.stringify({cash:450,completed:1}));
  const migrated=loadStamps(storage);assert.deepEqual(migrated,new Set([id]));
  assert.equal(saveProgress(storage,{...loadProgress(storage),stamps:[...migrated]}),true);
  assert.deepEqual(JSON.parse(storage.records.get('nanded-stories-v1')),{cash:450,completed:1,stamps:[id]});
  for(const stamps of [[],null,'invalid',{}]){
    storage.records.set('nanded-stories-v1',JSON.stringify({cash:0,completed:0,stamps}));
    assert.equal(loadStamps(storage).size,0,'an explicit new passport overrides every legacy stamp');
  }
});

test('passport loading validates known IDs, deduplicates and tolerates corrupt storage',()=>{
  const id=LANDMARKS[0].id,storage=memoryStorage();
  assert.equal(loadStamps(storage).size,0);
  saveProgress(storage,{cash:100,completed:0,stamps:[id,'invented',id,null,{},17]});
  assert.deepEqual(loadStamps(storage),new Set([id]));
  storage.records.set('nanded-stories-v1','{broken');
  storage.records.set('gta-nanded-passport-v1',JSON.stringify([id]));
  assert.equal(loadStamps(storage).size,0,'corrupt progress is not treated as a valid legacy migration');
  storage.records.delete('nanded-stories-v1');storage.records.set('gta-nanded-passport-v1','{broken');
  assert.equal(loadStamps(storage).size,0);
  const unavailable={getItem(){throw Error('Unavailable');},setItem(){throw Error('Unavailable');}};
  assert.equal(loadStamps(unavailable).size,0);
  assert.equal(saveProgress(unavailable,{cash:150,completed:0,stamps:[id]}),false);
});

test('a rejected progress write cannot persist the new cash while losing its stamp',()=>{
  const first=LANDMARKS[0].id,second=LANDMARKS[1].id;
  const prior=JSON.stringify({cash:500,completed:1,stamps:[first]});
  const storage=memoryStorage([['nanded-stories-v1',prior]]),stamps=loadStamps(storage);
  const cash=loadProgress(storage).cash+collectStamp(stamps,second);
  storage.setItem=()=>{throw Error('Storage quota exceeded');};
  assert.equal(saveProgress(storage,{cash,completed:1,stamps:[...stamps]}),false);
  assert.equal(storage.records.get('nanded-stories-v1'),prior);
  assert.deepEqual(loadProgress(storage),{cash:500,completed:1});
  assert.deepEqual(loadStamps(storage),new Set([first]));
});
