import test from 'node:test';
import assert from 'node:assert/strict';
import * as Core from '../../simulator-v08/src/core.mjs';
import * as Space from '../src/space-world.mjs';
const make=seed=>{const w=Core.createWorld(seed);Space.generateBodies(w);Space.initialize(w);return w;};
function fixture(){
 let w;for(let i=0;i<40;i++){w=make('space-fixture-'+i);if(w.planets.some(p=>p.parentId&&p.parentId===w.planets.find(q=>q.home).id))break;}
 const home=w.planets.find(p=>p.home),moon=w.planets.find(p=>p.parentId===home.id),region=w.regions.find(r=>r.population>500),soc=w.societies.find(s=>s.id===region.owner),people=100;
 region.population-=people;soc.population-=people;const c={id:'c'+w.nextEntity++,name:'Луна',planet:moon.id,parent:soc.id,population:people,food:800,capacity:150,autonomy:1,independent:true,founded:0,losses:0};w.colonies.push(c);
 Space.registerColony(w,c.id,{skills:['farming','rocketry','orbital'],raw:40,equipment:20});return {w,c,home,moon,region,soc};
}
test('families are reproducible, vary home orbit and keep moon parent relation',()=>{
 const positions=new Set();let withMoon=false,withoutMoon=false;
 for(let i=0;i<35;i++){const a=make('family-'+i),b=make('family-'+i);assert.deepEqual(a.planets,b.planets);const home=a.planets.find(p=>p.home);positions.add(a.planets.filter(p=>!p.parentId).findIndex(p=>p.id===home.id));for(const moon of a.planets.filter(p=>p.parentId)){withMoon=true;assert.ok(a.planets.some(p=>p.id===moon.parentId));assert.ok(moon.orbit.distance>0);}if(!a.planets.some(p=>p.parentId))withoutMoon=true;}
 assert.ok(positions.size>=3);assert.ok(withMoon&&withoutMoon);
});
test('target suitability, reach and orbital windows are distinct',()=>{
 const {w,home,moon}=fixture();w.planets.find(p=>p.id!==home.id&&!p.parentId).kind='gas';const targets=Space.targetOptions(w,home.id,2);
 const m=targets.find(t=>t.id===moon.id);assert.equal(m.parentId,home.id);assert.equal(m.reachable,true);assert.equal(m.window,true);
 assert.ok(targets.some(t=>!t.suitable));const planet=w.planets.find(p=>p.id!==home.id&&!p.parentId);assert.ok(Array.from({length:100},(_,year)=>Space.launchWindow(w,home.id,planet.id,year)).some(Boolean));assert.ok(Array.from({length:100},(_,year)=>Space.launchWindow(w,home.id,planet.id,year)).some(x=>!x));
});
test('colony food production uses local skill and kit, never live parent technology',()=>{
 const {w,c,soc}=fixture(),before=Space.localFoodOutput(w,c.id);soc.tech[0]=99;assert.equal(Space.localFoodOutput(w,c.id),before);w.observatory.space.colonies[c.id].skills=[];assert.ok(Space.localFoodOutput(w,c.id)<before);
});
test('messages arrive after delay, isolate knowledge, and archives omit future messages',()=>{
 const {w,c}=fixture(),s=w.observatory.space.colonies[c.id];s.skills=[];
 const sent=Space.sendMessage(w,'home',c.id,{kind:'skills',skills:['farming']});assert.ok(sent.receiveYear>sent.sentYear);Space.processMessages(w);assert.deepEqual(s.skills,[]);
 w.year=sent.receiveYear;assert.equal(Space.receivedMessages(w,c.id,w.year-1).length,0);Space.processMessages(w);assert.deepEqual(s.skills,['farming']);assert.equal(Space.receivedMessages(w,c.id,w.year-1).length,0);assert.equal(Space.receivedMessages(w,c.id,w.year).length,1);
 s.connected=false;assert.equal(Space.sendMessage(w,c.id,'home',{kind:'test'}),null);
});
test('scarcity blocks flight; funded return conserves people and records arrival',()=>{
 const {w,c}=fixture(),s=w.observatory.space.colonies[c.id];const original=Core.totalPopulation(w);
 s.connected=false;c.food=c.population;assert.equal(Space.returnAssessment(w,c.id).reason,'нужны запасы для жителей');assert.equal(Space.returnAssessment(w,c.id).allowed,false);assert.equal(Space.launchReturn(w,c.id).launched,false);
 c.food=800;s.connected=false;const out=Space.launchReturn(w,c.id);assert.equal(out.launched,true);assert.equal(Core.totalPopulation(w),original);assert.equal(s.raw,28);assert.equal(s.equipment,15);
 const region=w.regions.find(r=>r.id===out.mission.originRegion),oldRegion=region.population;w.year=out.mission.arrival;assert.deepEqual(Space.resolveReturns(w),[out.mission.id]);assert.equal(Core.totalPopulation(w),original);assert.equal(region.population,oldRegion+out.mission.people);assert.equal(w.observatory.space.returns[0].arrival,w.year);assert.deepEqual(Space.resolveReturns(w),[]);
});
test('checkpoint serialisation preserves in-flight missions and delayed signals',()=>{
 const {w,c}=fixture();Space.sendMessage(w,c.id,'home',{kind:'colony-status',food:c.food});w.observatory.space.colonies[c.id].connected=false;const flight=Space.launchReturn(w,c.id);assert.equal(flight.launched,true);
 const saved=JSON.parse(JSON.stringify(w));saved.year=flight.mission.arrival;w.year=flight.mission.arrival;Space.processMessages(saved);Space.processMessages(w);Space.resolveReturns(saved);Space.resolveReturns(w);assert.deepEqual(saved,w);
});

test('local deposits are finite and equipment costs extracted raw',()=>{
 const {w,c}=fixture(),s=w.observatory.space.colonies[c.id];s.skills=['workshops','industry'];s.raw=0;s.equipment=0;s.deposits=.25;
 const first=Space.localResourceYear(w,c.id),second=Space.localResourceYear(w,c.id);
 assert.equal(first.rawProduced,.25);assert.equal(s.deposits,0);assert.equal(second.rawProduced,0);assert.ok(s.raw+s.equipment<=.25+1e-9);
});
test('connected colony has no invented restoration motive and historical report arrives later',()=>{
 const {w,c}=fixture();assert.equal(Space.returnAssessment(w,c.id).allowed,false);
 const report=Space.publishColonyStatus(w,c.id);const oldFood=c.food;c.food=5;
 assert.equal(Space.receivedMessages(w,'home',w.year).length,0);w.year=report.receiveYear;Space.processMessages(w);
 assert.equal(Space.receivedMessages(w,'home',w.year)[0].payload.food,oldFood);assert.equal(Space.receivedMessages(w,'home',w.year-1).length,0);
});

test('validator rejects bad parents, dates, duplicate messages and bad resources',()=>{
 const {w,c}=fixture();assert.equal(Space.validate(w),true);
 const a=structuredClone(w);a.planets.find(p=>p.parentId).parentId='missing';assert.throws(()=>Space.validate(a));
 const b=structuredClone(w);b.observatory.space.colonies[c.id].raw=-1;assert.throws(()=>Space.validate(b));
 const msg=Space.publishColonyStatus(w,c.id);assert.ok(msg);assert.equal(Space.validate(w),true);
 const d=structuredClone(w);d.observatory.space.messages.push(structuredClone(d.observatory.space.messages[0]));assert.throws(()=>Space.validate(d));
});
test('probe signal reaches parent only after light delay',()=>{
 const {w,home,soc,region}=fixture(),target=w.planets.find(x=>x.id!==home.id),m={id:'m'+w.nextEntity++,name:'Зонд',kind:'probe',status:'arrived',target:target.id,owner:soc.id,originRegion:region.id,people:0,cargo:0,cost:1,departure:0,arrival:1};w.year=1;w.missions.push(m);
 const msg=Space.probeArrived(w,m);assert.ok(!soc.probed.includes(target.id));Space.processMessages(w);assert.ok(!soc.probed.includes(target.id));w.year=msg.receiveYear;Space.processMessages(w);assert.ok(soc.probed.includes(target.id));assert.equal(Space.validate(w),true);
});
test('connection failure delays a signal until repair',()=>{
 const {w,c}=fixture(),s=w.observatory.space.colonies[c.id],m=Space.sendMessage(w,'home',c.id,{kind:'skills',skills:['science']});s.equipment=0;Space.refreshLink(w,c.id);w.year=m.receiveYear;Space.processMessages(w);assert.equal(m.delivered,false);assert.ok(!s.skills.includes('science'));
 s.equipment=5;Space.refreshLink(w,c.id);w.year++;Space.processMessages(w);assert.equal(m.deliveredYear,w.year);assert.ok(s.skills.includes('science'));assert.equal(Space.validate(w),true);
});
test('return cargo is accounted once via external input callback',()=>{
 const {w,c}=fixture(),s=w.observatory.space.colonies[c.id];s.connected=false;const out=Space.launchReturn(w,c.id);assert.equal(out.launched,true);w.year=out.mission.arrival;
 let received=0;const record=(world,resource,amount)=>{assert.equal(world,w);assert.equal(resource,'food');received+=amount;};
 assert.throws(()=>Space.beforeSpace(w),/учёт|Учёт/);Space.beforeSpace(w,record);Space.beforeSpace(w,record);assert.equal(received,out.mission.cargo);assert.equal(Space.validate(w),true);
});
test('thousand annual steps of a living colony keep facts bounded and validate',()=>{
 const {w,c}=fixture(),s=w.observatory.space.colonies[c.id];s.skills=['farming','workshops','industry','orbital','rocketry'];
 for(let year=1;year<=1000;year++){w.year=year;c.food=Math.min(c.population*6,c.food*.98+Space.localFoodOutput(w,c.id));const supply=Math.min(1,c.food/Math.max(1,c.population));c.food=Math.max(0,c.food-c.population);const deaths=Math.min(c.population,Math.floor(c.population*(.009+.1*(1-supply)))),births=Math.min(Math.max(0,Math.floor(c.capacity)-c.population+deaths),Math.floor(c.population*.024*supply*Math.max(0,Math.min(1,c.capacity/Math.max(1,c.population)-.5))));c.population+=births-deaths;Space.afterSpace(w);}
 assert.ok(c.population>0);assert.ok(w.observatory.space.messages.length<100);assert.equal(Space.validate(w),true);
});
