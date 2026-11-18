import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as Core from '../src/core.mjs';
const ctx={Core,structuredClone,Intl,Number,document:{}};
vm.runInNewContext(readFileSync(new URL('../src/freight-observation.js',import.meta.url),'utf8')+';globalThis.FreightTest=FreightObservation;',ctx);
const F=ctx.FreightTest;
function getWorldWithShipment(){let w=Core.createWorld('freight-test');for(let i=0;i<60&&!w.economy.shipments.length;i++)w=Core.advance(w,1).world;assert.ok(w.economy.shipments.length);return w;}
test('real shipment observation is session-only and route is model path',()=>{
 let w=getWorldWithShipment();const before=JSON.stringify(w),s=w.economy.shipments[0];assert.equal(F.start(w,s.id),true);assert.equal(JSON.stringify(w),before);
 assert.deepEqual(Array.from(F.route(w).path),s.path);assert.equal(F.active().records[0].amount,s.amount);
 const next=Core.advance(w,1).world;F.observeYear(w,next,[]);const log=F.active().records.at(-1);
 if(!next.economy.shipments.some(x=>x.id===s.id))assert.equal(log.kind,'unknown');
 assert.equal(JSON.stringify(w),before);F.stop();
});
test('confirmed delivery and unknown outcome stay distinct',()=>{
 let w=getWorldWithShipment();let s=w.economy.shipments[0];F.start(w,s.id);
 const next=structuredClone(w);next.year=w.year+1;next.economy.shipments=next.economy.shipments.filter(x=>x.id!==s.id);
 F.observeYear(w,next,[{id:s.id,year:next.year,kind:'delivered',delivered:s.amount*.9,lost:s.amount*.1}]);
 assert.equal(F.active().records.at(-1).kind,'delivered');assert.equal(F.active().records.at(-1).delivered,s.amount*.9);
 F.start(w,s.id);F.observeYear(w,next,[]);assert.equal(F.active().records.at(-1).kind,'unknown');
 assert.match(F.logHtml(next),/подтверждение её исхода недоступно/);F.stop();
});
test('unobserved multi-year gaps are explicit and future journal is hidden',()=>{
 const w=getWorldWithShipment(),s=w.economy.shipments[0];F.start(w,s.id);const later=structuredClone(w);later.year+=3;F.observeYear(w,later,[]);
 assert.equal(F.active().records.at(-1).kind,'gap');assert.match(F.logHtml(later),/Пропуск наблюдения/);
 const past=structuredClone(w);past.year--;assert.match(F.logHtml(past),/наблюдение ещё не началось/);assert.equal(F.route(past),null);F.stop();
});

test('a port lists its own active sea cargo and opens its original identifier',()=>{
 const w=getWorldWithShipment(),edge=w.economy.routes.find(e=>e.kind==='sea');assert.ok(edge);const r=w.regions.find(r=>r.id===edge.a);r.coastal=true;r.economy.port=.5;const shipment=w.economy.shipments[0];shipment.from=edge.a;shipment.to=edge.b;shipment.path=[edge.id];
 const html=F.portHtml(w,r.id);assert.match(html,new RegExp('data-freight-watch="'+shipment.id+'"'));assert.match(html,/Открыть ведомость/);r.economy.port=0;assert.equal(F.portHtml(w,r.id),'');
});
test('waiting reason is shown only when supplied by an explicit annual receipt',()=>{
 const w=getWorldWithShipment(),s=w.economy.shipments[0];F.start(w,s.id);const next=structuredClone(w);next.year=w.year+1;const item=next.economy.shipments.find(x=>x.id===s.id);item.status='waiting';item.arrival++;item.amount*=.99;
 F.observeYear(w,next,[{id:s.id,year:next.year,kind:'waiting',closed:[{edgeId:s.path[0],reason:'путь закрыт из-за занятия'}]}]);assert.match(F.logHtml(next),/путь закрыт из-за занятия/);assert.match(F.logHtml(next),new RegExp(s.path[0]));
 F.start(w,s.id);F.observeYear(w,next,[]);assert.match(F.logHtml(next),/причина в журнале не сохранена/);F.stop();
});
