import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
for(const version of ['03','04'])test(`v${version} renders pending metadata honestly, then indexes only two after display`,async()=>{
  const source=readFileSync(new URL(`../simulator-v${version}/src/ui.js`,import.meta.url),'utf8');
  const part=source.slice(source.indexOf('let archiveRequest=0;'),source.indexOf('function about()'));
  const nodes={'#dialog':{open:false},'#dialog-title':{textContent:''},'#dialog-body':{innerHTML:''}},timers=[],calls=[];
  let ready=false;
  const store={persistent:true,async list(){return ready?[{id:'legacy',name:'Проверенный мир',seed:'MG',year:12,revision:1,updatedAt:'',cloud:null}]:[{id:'legacy',name:'Прежнее сохранение',seed:'',year:0,revision:0,updatedAt:'',cloud:null,metadataPending:true}];},async indexLegacy(n){calls.push(n);ready=true;}};
  const ctx=vm.createContext({store,world:null,localConflict:false,cloudRows:new Map(),cloudCursor:null,cloudState:'ready',cloudIssue:'',Storage:{isCloudDirty:()=>true},h:String,$:key=>nodes[key],setTimeout:fn=>timers.push(fn),cloudClient:{list:async()=>({worlds:[],nextCursor:null})},modal:(title)=>{nodes['#dialog'].open=true;nodes['#dialog-title'].textContent=title;},showSaveStatus(){}});
  vm.runInContext(part+';this.open=worldDialog;',ctx);await ctx.open();
  assert.match(nodes['#dialog-body'].innerHTML,/Метаданные ещё не проверены/);assert.doesNotMatch(nodes['#dialog-body'].innerHTML,/год 0/);assert.deepEqual(calls,[]);
  timers[0]();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,[2]);assert.match(nodes['#dialog-body'].innerHTML,/Проверенный мир/);assert.match(nodes['#dialog-body'].innerHTML,/год 12/);
});
