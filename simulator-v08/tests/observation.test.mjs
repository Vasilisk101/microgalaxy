import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as Core from '../src/core.mjs';
const ctx={Core,document:{getElementById:()=>null}};
vm.runInNewContext(readFileSync(new URL('../src/observation.js',import.meta.url),'utf8')+';globalThis.ObserverTest=Observation;',ctx);
const obs=ctx.ObserverTest;
test('watch matches only explicit important links and resets between worlds',()=>{
 const w=Core.createWorld('observation-tests');const r=w.regions[0],s=w.societies[0];
 assert.equal(obs.setWatch(w,'region',r.id),true);
 assert.equal(obs.matches({important:true,regionIds:[r.id]}),true);
 assert.equal(obs.matches({important:false,regionIds:[r.id]}),false);
 assert.equal(obs.matches({important:true,entityIds:[r.owner]}),false);
 assert.equal(obs.matches({important:true,movement:{from:r.id,to:'other'}}),true);
 assert.equal(obs.setWatch(w,'society',s.id),true);
 assert.equal(obs.matches({important:true,entityIds:[s.id]}),true);
 assert.equal(obs.matches({important:true,regionIds:[r.id]}),false);
 obs.sync(Core.createWorld('another-world'));assert.equal(obs.getWatch(),null);
});
test('snapshot lookup never selects a later snapshot',()=>{
 const w={snapshots:[{year:0},{year:25},{year:75}]};
 assert.equal(obs.closestIndex(w,-1),-1);assert.equal(obs.closestIndex(w,65),1);assert.equal(obs.closestIndex(w,75),2);
});
test('archive demonstration is reproducible without mutating the active world',()=>{
 const active=Core.createWorld('untouched'),before=JSON.stringify(active);
 const demo=Core.advance(Core.createWorld('АРХИВ-09',{era:'agriculture'}),78).world;
 const region=demo.regions.find(r=>r.settlement.name==='Дорон');assert.ok(region);
 const events=Core.allEvents(demo).filter(e=>(e.regionIds??[]).includes(region.id));
 assert.ok(events.some(e=>e.year===65&&e.title==='Оккупация региона'));
 assert.ok(events.some(e=>e.year===78&&e.title==='Мирное соглашение'));
 assert.equal(JSON.stringify(active),before);
});
