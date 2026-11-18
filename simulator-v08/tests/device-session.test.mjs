import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=name=>fs.readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const program=read('device-session.js');
function page(db,nav='navigate'){
  let time=0;const frames=[],listeners={},window={addEventListener:(name,fn)=>listeners[name]=fn};
  const c=vm.createContext({Core:{MODEL_VERSION:'test'},crypto,Storage:{digest:async()=>''},TextEncoder,performance:{now:()=>time,getEntriesByType:()=>[{type:nav}]},
    navigator:{userAgent:'test'},innerWidth:390,innerHeight:844,localStorage:{getItem:k=>db.get(k)??null,setItem:(k,v)=>db.set(k,v)},window,document:{hidden:false,querySelector:()=>({})},
    running:false,world:{id:'a',seed:'test seed',year:1000,era:'space'},revision:7,switching:false,busy:false,localUnsaved:false,localConflict:false,view:'planet',
    requestAnimationFrame:fn=>frames.push(fn),setTimeout});
  const session=vm.runInContext(program+'\nDeviceSession;',c);
  const paint=(d=1)=>{time+=d;while(frames.length)frames.shift()();};
  return {session,c,listeners,paint,now:()=>time};
}
test('ordinary pauses use nearest-rank P95, preserving each world and launch separately',()=>{
  const db=new Map(),a=page(db);a.session.enable('Телефон');
  for(let i=1;i<=19;i++){a.session.pause(a.now());a.paint(i);}
  assert.equal(a.session.report().pauseSeries[0].p95Ms,null);
  a.session.pause(a.now());a.paint(20);assert.equal(a.session.report().pauseSeries[0].p95Ms,19);
  a.c.world={...a.c.world,id:'b'};a.session.pause(a.now());a.paint(5);
  assert.equal(a.session.report().pauseSeries.length,2);a.session.next('cold');a.listeners.pagehide();
  const b=page(db);b.session.selecting(b.c.world,7);assert.equal(b.session.report().visits.at(-1).mode,'cold');
  const restored=b.session.report().visits.at(-1).events.find(e=>e.kind==='reopened');assert.equal(restored.sameWorld,false);
  b.session.next('warm');b.session.savedBackground(b.c.world,8,true);const d=page(db,'reload');d.session.selecting(d.c.world,8);
  assert.equal(d.session.report().visits.at(-1).events.at(-1).sameYear,true);
  assert.equal(d.session.report().visits.at(-1).mode,'warm');d.session.finish();assert.equal(page(db).session.active,false);
});
test('globe timing requires the selected planet to be rendered and accessible; gestures and hidden states are observed separately',()=>{
  const a=page(new Map());a.session.enable('test');const ev={};
  const r={update(){},canvas:{addEventListener:(k,fn)=>ev[k]=fn},rotation:.25};a.session.bindRenderer(r);
  a.session.readResult('local',a.c.world,9);a.session.validation(a.c.world,0,true);a.session.selecting(a.c.world,7);a.c.switching=true;
  r.update(a.c.world,'planet');a.paint();assert.ok(!a.session.report().visits[0].events.some(e=>e.kind==='globe-interactive'));
  a.c.switching=false;a.session.firstFrame();a.paint();ev.pointerdown();r.rotation+=.2;ev.pointerup();
  a.session.background(true,a.c.world,7,true);a.session.savedBackground(a.c.world,7,true);a.session.background(false,a.c.world,7,false);
  const kinds=a.session.report().visits[0].events.map(x=>x.kind);
  for(const k of ['snapshot-read','full-validation','globe-prepare','globe-interactive','globe-rotated','hidden','background-save','visible'])assert.ok(kinds.includes(k),k);
});
test('isolated benchmark measures an allowed final transition, preserves exact export year and records observed activity',async()=>{
  const reports=[],scope={document:{addEventListener(){}},performance,TextEncoder,structuredClone,self:{},postMessage:d=>reports.push(d),setTimeout:fn=>queueMicrotask(fn),
    Core:{createWorld:(seed,{era})=>({seed,era,year:0,economy:{nextShipment:307}}),validateWorld:w=>assert.ok(w.year<=10000),allEvents:()=>[{movement:{}}],createWorkerSession:w=>({step(n){assert.ok(n>0&&w.year+n<=10000);w.year+=n;}})}};
  vm.runInNewContext(read('device-check.js')+'\ndeviceWorker();',scope);
  await scope.self.onmessage({data:{seed:'control',era:'space',checks:[0,1000,10000],keep:true}});
  const samples=reports.filter(x=>x.sample).map(x=>x.sample);
  assert.deepEqual(samples.map(v=>v.year),[0,1000,10000]);assert.equal(samples[2].stepFrom,9999);assert.equal(samples[1].shipments,306);
  assert.equal(samples[1].movements,1);assert.equal(reports.at(-1).world.year,10000);
});
