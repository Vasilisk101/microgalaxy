import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../src/ui.js',import.meta.url),'utf8');
const persistence=source.slice(source.indexOf('function persist(){'),source.indexOf('function scheduleSync()'));
function harness({remoteRevision=1,dirty=false}={}){
  const writes=[];const row={id:'world',revision:remoteRevision,cloud:{revision:1,syncedRevision:remoteRevision}};
  const ctx={world:{id:'world',name:'World',seed:'seed',year:12},revision:1,currentRecord:row,localUnsaved:dirty,localConflict:false,changeGeneration:dirty?1:0,saveTail:Promise.resolve(),Core:{clone:structuredClone},store:{persistent:true,async getMetadata(){return {...row};},async put(w,expected){writes.push({w,expected});return expected+1;}},pref(){},showSaveStatus(){},setRunning(){},notice(){},updateControls(){},writes};
  vm.createContext(ctx);vm.runInContext(persistence,ctx);return ctx;
}
test('clean save checks revision without writing or serializing the world',async()=>{const x=harness();await x.persist();assert.equal(x.writes.length,0);assert.equal(x.localUnsaved,false);});
test('dirty save writes once against the observed revision',async()=>{const x=harness({dirty:true});await x.persist();assert.equal(x.writes.length,1);assert.equal(x.writes[0].expected,1);assert.equal(x.revision,2);assert.equal(x.localUnsaved,false);});
test('other tab revision triggers conflict even for a clean world',async()=>{const x=harness({remoteRevision:2});await assert.rejects(x.persist(),{name:'ConflictError'});assert.equal(x.writes.length,0);assert.equal(x.localConflict,true);});
test('new changes during an in-flight save remain dirty',async()=>{const x=harness({dirty:true});let release;const original=x.store.put;x.store.put=async(...args)=>{await new Promise(resolve=>{release=resolve;});return original(...args);};const pending=x.persist();while(!release)await new Promise(resolve=>setTimeout(resolve,0));x.changeGeneration++;release();await pending;assert.equal(x.localUnsaved,true);});

const bootSource=source.slice(source.indexOf('async function boot(){'),source.indexOf('\nboot().catch'));
function bootHarness({requested=null,record,fail=false,last='chosen',pages=null}={}){
  const calls=[];const elem={open:false,hidden:false,innerHTML:''};
  const store={persistent:true,async get(id){calls.push(['get',id]);if(fail)throw Error('corrupt');return record??{id,world:{id},revision:1};},async list(){calls.push(['list']);return pages?.shift()??[];}};
  const ctx={URLSearchParams,window:{location:{search:''}},document:{hidden:false},$:()=>elem,world:null,store:null,switching:false,requestedWorld:null,currentRecord:null,workerReady:true,cloudState:'',cloudIssue:'',cloudRows:new Map(),Core:{createWorld(){calls.push(['create']);return {}; }},Storage:{async openWorldStore(){return store;},isCloudDirty(){return false;}},Cloud:{createCloudSync(){return {}; }},cloudClient:{async list(){calls.push(['cloud']);return {worlds:[],nextCursor:null};}},pref(key){return key==='microgalaxy_economy_v06_last'?last:null;},requestedWorldFromUrl(){return requested;},updateControls(){},updateSound(){},initWorker:async()=>true,validateStoredWorld(){},bootStage(s){calls.push(['stage',s]);},yieldFrame:async()=>{},selectRecord(r){calls.push(['select',r.world.id]);ctx.world=r.world;},refreshBootCloud(){},openRequestedWorld:async()=>{calls.push(['requested']);throw Error('broken');},showRequestedFailure(){calls.push(['failure']);},notice(){},installWorld:async()=>{calls.push(['install']);},showSaveStatus(){},setInterval(){},worldDialog(){},setRunning(){},pageHeading(){return '';},calls};
  vm.createContext(ctx);vm.runInContext(bootSource,ctx);return ctx;
}
test('boot opens the selected world before enumerating the catalog',async()=>{const x=bootHarness({record:{id:'chosen',world:{id:'chosen'},revision:1}});await x.boot();assert.deepEqual(x.calls.filter(c=>['get','list','select'].includes(c[0])).map(c=>c[0]),['get','select']);assert.ok(x.calls.some(c=>c[0]==='stage'));});
test('a failed selected world never creates or selects a replacement',async()=>{const x=bootHarness({fail:true});await x.boot();assert.ok(x.calls.some(c=>c[0]==='failure'));assert.ok(!x.calls.some(c=>['install','create','select','cloud'].includes(c[0])));});
test('a failed explicit link never falls back to another world',async()=>{const x=bootHarness({requested:{id:'given',source:'local'}});await x.boot();assert.ok(x.calls.some(c=>c[0]==='failure'));assert.ok(!x.calls.some(c=>['install','create','select','cloud'].includes(c[0])));});
test('legacy pages finish indexing before choosing the latest world',async()=>{const first=[{id:'id-7'}];first.legacyPending=true;const lastPage=[{id:'id-8'},{id:'id-7'}];lastPage.legacyPending=false;const x=bootHarness({last:null,pages:[first,lastPage]});await x.boot();assert.deepEqual(x.calls.filter(c=>c[0]==='get').map(c=>c[1]),['id-8']);assert.ok(x.calls.some(c=>c[0]==='select'&&c[1]==='id-8'));});

const calculateSource=source.slice(source.indexOf('async function calculate('),source.indexOf('\nfunction showSaveStatus()'));
test('without worker, a visible status and yields precede one-year chunks',async()=>{const calls=[];const ctx={workerReady:false,world:{year:0},bootStage(){calls.push('status');},yieldFrame:async()=>{calls.push('yield');},Core:{advance(w){calls.push('advance');return {world:{year:w.year+1},advanced:1,newEvents:w.year===1?[{important:true}]:[]};}}};vm.createContext(ctx);vm.runInContext(calculateSource,ctx);const task=ctx.calculate(10,true);assert.deepEqual(calls,['status','yield']);const result=await task;assert.equal(result.advanced,2);assert.equal(result.stopped,true);assert.equal(calls.filter(x=>x==='advance').length,2);assert.ok(calls.indexOf('yield')<calls.indexOf('advance'));});
test('worker timeout leaves the original world unchanged and enables fallback',async()=>{let fire;const original={year:0},worker={postMessage(){},terminate(){}};const ctx={workerReady:true,world:original,worker,pending:new Map(),serial:0,setTimeout(fn){fire=fn;return 1;},clearTimeout(){},Error,Promise};vm.createContext(ctx);vm.runInContext(calculateSource,ctx);const task=ctx.calculate(1,false);fire();await assert.rejects(task,/Мир не изменён/);assert.equal(ctx.world,original);assert.equal(ctx.workerReady,false);});
