import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as Core from '../src/core.mjs';

const source=fs.readFileSync(new URL('../src/ui.js',import.meta.url),'utf8');
function harness(){
  const fixture=Core.createWorld('ТУЛА-71',{era:'industrial'}),data=Core.economySummary(fixture);
  data.routes[0].effectiveCapacity=12.34;data.routes[0].capacity=9999;data.routes[0].condition=0.5;
  const edge=fixture.geography.edges[0],next=fixture.geography.edges.find(e=>e.id!==edge.id&&(e.a===edge.b||e.b===edge.b)),destination=next.a===edge.b?next.b:next.a;
  data.shipments=Array.from({length:85},(_,i)=>({id:'test'+i,from:edge.a,to:destination,path:[edge.id,next.id],resource:'food',amount:i+1,status:'transit',arrival:1}));
  const past={...data,routes:data.routes.slice(0,13),shipments:data.shipments.slice(0,7)};
  const nodes=new Map(),listeners=new Map();
  const node=s=>{if(!nodes.has(s))nodes.set(s,{innerHTML:'',textContent:'',hidden:false,open:false,disabled:false,dataset:{},classList:{toggle(){},add(){},remove(){}},addEventListener(){},setAttribute(){},removeAttribute(){},focus(){},close(){}});return nodes.get(s);};
  const context={Core:{...Core,economySummary:w=>w.marker==='past'?past:data,allEvents:()=>[]},Storage:{},Cloud:{createCloudClient:()=>({})},Renderer:class{},fixture,console,URL,URLSearchParams,clearTimeout(){},setTimeout(){},setInterval(){},localStorage:{getItem(){return null;}},window:{addEventListener(){}},document:{querySelector:node,querySelectorAll:()=>[],addEventListener(name,fn){listeners.set(name,fn);}}};
  vm.createContext(context);vm.runInContext(source.replace(/boot\(\)\.catch\([\s\S]*$/,''),context);
  const run=code=>vm.runInContext(code,context);
  run('world=fixture;view="economy";');
  return {run,node,data,past,click:async id=>listeners.get('click')({target:{closest(selector){return selector==='button'?{id,dataset:{},disabled:false}:null;}},preventDefault(){}})};
}
test('bounded economy lists disclose totals and expose all multi-edge shipments and routes',async()=>{
  const t=harness();assert(t.data.routes.length>80);t.run('renderEconomy(world)');
  assert.match(t.node('#page-content').innerHTML,new RegExp('Показано 40 из '+t.data.routes.length+' путей'));
  assert.match(t.node('#page-content').innerHTML,/Показано 40 из 85 грузов/);
  assert.ok(t.node('#page-content').innerHTML.includes(new Intl.NumberFormat('ru-RU').format(12.34)+' ед./год'));
  assert.match(t.node('#page-content').innerHTML,/путь: 2 участк\./);
  for(let i=0;i<4;i++){await t.click('more-economy-routes');await t.click('more-economy-shipments');}
  assert.match(t.node('#page-content').innerHTML,new RegExp('Показано '+t.data.routes.length+' из '+t.data.routes.length+' путей'));
  assert.match(t.node('#page-content').innerHTML,/Показано 85 из 85 грузов/);
  assert.doesNotMatch(t.node('#page-content').innerHTML,/id="more-economy-(routes|shipments)"/);
});
test('historical view uses slice counts and resetting pagination returns bounded initial state',()=>{
  const t=harness();t.run('economyRouteLimit=200;economyShipmentLimit=200;resetEconomyPages();snapshotIndex=0;renderEconomy({...world,marker:"past"});');
  assert.match(t.node('#page-content').innerHTML,/Показано 13 из 13 путей/);
  assert.match(t.node('#page-content').innerHTML,/Показано 7 из 7 грузов/);
  assert.equal(t.run('economyRouteLimit'),40);assert.equal(t.run('economyShipmentLimit'),40);
});
