/* Microgalaxy v1: deterministic game-scale orbital and colony rules.
 * People and food remain in the core's colonies, regions and missions. */
import * as ColonialExchange from './colonial-exchange.mjs';
import * as LivingWorld from './living-world.mjs';
const SKILLS=new Set(['farming','workshops','records','councils','irrigation','roads','schools','regional_councils','industry','science','coordination','rocketry','orbital','settlement']);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const clone=x=>structuredClone(x);
function hash(value){let h=2166136261;for(const c of String(value)){h^=c.codePointAt(0);h=Math.imul(h,16777619);}return h>>>0;}
function rand(...key){return hash(key.join('|'))/4294967296;}
const byId=(w,id)=>w.planets.find(p=>p.id===id);
const local=(w,id)=>w.observatory?.space?.colonies?.[id];
const homeOf=w=>w.planets.find(p=>p.home);

// Called on a NEW v1 world before any missions/colonies are created.
export function generateBodies(w){
 if(w.year!==0||w.missions.length||w.colonies.length)throw Error('Пересоздавать тела существующего мира нельзя.');
 const count=5+Math.floor(rand(w.seed,'space-count')*3),homeIndex=1+Math.floor(rand(w.seed,'home-slot')*(count-2));
 const scale=Math.sqrt(w.star.luminosity),mass=w.star.mass, family=Math.floor(rand(w.seed,'orbit-family')*3), spacing=[1.32,1.55,1.85][family];
 const names=['Алар','Белен','Верас','Делин','Ерна','Калар','Мелис','Норис','Орин','Тарин','Фелар','Эрис'];
 const bodies=[];
 for(let i=0;i<count;i++){
  const a=scale*spacing**(i-homeIndex),home=i===homeIndex;
  const kind=home?'terrestrial':i>homeIndex+1?'gas':rand(w.seed,'kind',i)<.5?'rock':'ice';
  const radius=home?.8+rand(w.seed,'home-radius')*.5:kind==='gas'?3+rand(w.seed,'radius',i)*4:.4+rand(w.seed,'radius',i)*.8;
  bodies.push({id:'p'+i,name:names[(hash(w.seed)%names.length+i)%names.length]+' · '+(i+1),a,radius,kind,home,temperature:home?Math.round(12+rand(w.seed,'temp')*9):Math.round(278*(w.star.luminosity/a**2)**.25-273),phase:rand(w.seed,'phase',i)*Math.PI*2,period:Math.sqrt(a**3/mass),moons:0,parentId:null,orbit:null});
 }
 const parent=bodies[homeIndex];
 if(rand(w.seed,'has-moon')>.32){
  const moon={id:'moon-'+parent.id,name:parent.name+' · спутник',a:parent.a,radius:.18+rand(w.seed,'moon-radius')*.25,kind:rand(w.seed,'moon-kind')>.5?'rock':'ice',home:false,temperature:parent.temperature-20,phase:rand(w.seed,'moon-phase')*Math.PI*2,period:parent.period,moons:0,parentId:parent.id,orbit:{distance:.002+rand(w.seed,'moon-orbit')*.005,period:.06+rand(w.seed,'moon-period')*.08}};
  parent.moons=1;bodies.push(moon);
 }
 w.planets=bodies;return bodies;
}
export function initialize(w){
 w.observatory??={};if(w.observatory.space)throw Error('Космическая история уже создана.');
 w.observatory.space={version:1,colonies:{},messages:[],nextMessage:1,returns:[],nextReturn:1,links:[]};
 ColonialExchange.initialize(w);
}
function starOrbit(w,p){return p.parentId?byId(w,p.parentId):p;}
// Radians in the viewing plane. The same positions govern observation and launch windows.
export function orbitalPhase(body,year){return body.phase+2*Math.PI*year/Math.max(.1,body.period);}
export function satellitePhase(moon,year){return moon.phase+2*Math.PI*year/Math.max(.001,moon.orbit?.period??1);}
export function stellarLight(world,body,year=world.year){
 const angle=orbitalPhase(starOrbit(world,body),year), inclination=.68;
 return [-Math.cos(angle),inclination*Math.sin(angle),-Math.sqrt(1-inclination**2)*Math.sin(angle)];
}
export function distance(w,fromId,toId){const a=byId(w,fromId),b=byId(w,toId);if(!a||!b)throw Error('Неизвестное тело.');if(a.id===b.id)return 0;if(a.parentId===b.id||b.parentId===a.id)return (a.orbit?.distance??b.orbit?.distance??.005);const x=starOrbit(w,a),y=starOrbit(w,b);return Math.abs(x.a-y.a)+(a.orbit?.distance??0)+(b.orbit?.distance??0);}
export function launchWindow(w,fromId,toId,year=w.year){
 const a=byId(w,fromId),b=byId(w,toId);if(!a||!b||a.id===b.id)return false;
 if(a.parentId===b.id||b.parentId===a.id)return true;
 const x=starOrbit(w,a),y=starOrbit(w,b),angle=p=>orbitalPhase(p,year);
 const delta=Math.atan2(Math.sin(angle(x)-angle(y)),Math.cos(angle(x)-angle(y)));
 return Math.abs(delta)<.8;
}
export function targetOptions(w,originId,engineering=1,year=w.year){
 return w.planets.filter(p=>p.id!==originId).map(p=>{const d=distance(w,originId,p.id),suitable=p.kind!=='gas',reachable=d<=Math.max(.01,engineering*1.5),window=launchWindow(w,originId,p.id,year);return {id:p.id,parentId:p.parentId,suitable,reachable,window,distance:d,travelYears:Math.max(1,Math.ceil(d*2/Math.max(.5,engineering*.3)))};});
}
// Skills are inherited only once at founding, then exist locally; do not read parent tech each year.
export function registerColony(w,colonyId,{skills=[],raw=0,equipment=0,knownBodies=[],deposits=1000,homeRegion=null}={}){
 const c=w.colonies.find(x=>x.id===colonyId);if(!c||!w.observatory?.space)throw Error('Колония или космический архив отсутствует.');
 if(local(w,colonyId))throw Error('Колония уже зарегистрирована.');
 if(!Array.isArray(skills)||skills.some(x=>!SKILLS.has(x)))throw Error('Неизвестный местный навык.');
 if(!Number.isFinite(raw)||raw<0||!Number.isFinite(equipment)||equipment<0||!Number.isFinite(deposits)||deposits<0)throw Error('Некорректные местные запасы.');
 const home=homeOf(w),known=[...new Set([c.planet,...(home?[home.id]:[]),...knownBodies])].filter(id=>byId(w,id));
 w.observatory.space.colonies[colonyId]={skills:[...new Set(skills.filter(s=>typeof s==='string'))],raw,equipment,deposits,knownBodies:known,connected:false,linkReason:'не проверено',lastLaunch:null,lastReport:null};
 const site=w.regions.find(r=>r.id===homeRegion)??w.regions.filter(r=>r.owner===c.parent).sort((a,b)=>b.population-a.population||a.id.localeCompare(b.id))[0];
 local(w,colonyId).homeRegion=site?.id??null;
 if(w.modelVersion==='1.0.1')local(w,colonyId).homeMemory={
  body:home.id,carriers:Math.min(c.population,Math.ceil(c.population*.24)),received:w.year,source:'основатели',evidence:null
 };
 refreshLink(w,colonyId);return local(w,colonyId);
}
// Returns production only. Core applies its own food decay, consumption, births and deaths once.
export function localFoodOutput(w,colonyId){const c=w.colonies.find(x=>x.id===colonyId),s=local(w,colonyId);if(!c||!s||!c.population)return 0;const skill=s.skills.includes('farming')?1:.35,kit=clamp(s.equipment/Math.max(1,c.population*.1),0,1);return c.population*(.25+1.05*skill)*(.4+.6*kit);}
// Local material production draws on existing residents and local reserves; no population is added.
export function localResourceYear(w,colonyId){
 const c=w.colonies.find(x=>x.id===colonyId),s=local(w,colonyId),body=c&&byId(w,c.planet);if(!c||!s||!body||!c.population)return {rawProduced:0,equipmentProduced:0};
 const rawProduced=s.skills.includes('workshops')&&body.kind!=='gas'?Math.min(s.deposits,c.population*.01):0;s.deposits-=rawProduced;s.raw+=rawProduced;
 const equipmentProduced=s.skills.includes('industry')?Math.min(s.raw,c.population*.005):0;s.raw-=equipmentProduced;s.equipment+=equipmentProduced;
 return {rawProduced,equipmentProduced};
}
// Equipment wears in service. A staffed workshop can restore lost communication skills locally.
function maintainColony(w,c,s) {
 if(!c.population)return;
 const upkeep=Math.min(s.equipment,c.population*.00022);
 s.equipment-=upkeep;
 s.hardYears=c.food<c.population*.7?(s.hardYears??0)+1:0;
 if(s.hardYears>=12&&c.population<120&&s.skills.includes('orbital')){
   s.skills=s.skills.filter(k=>k!=='orbital');
   s.lastTeaching={year:w.year,kind:'loss',skill:'orbital'};
 }
 const canTrain=!s.skills.includes('orbital')&&s.skills.includes('rocketry')&&s.skills.includes('workshops')&&s.equipment>=10&&s.raw>=8&&c.population>=150&&c.food>c.population*2;
 s.training=canTrain?(s.training??0)+1:0;
 if(s.training>=12){
   s.raw-=8;s.equipment-=3;s.skills.push('orbital');s.training=0;
   s.lastTeaching={year:w.year,kind:'training',skill:'orbital'};
 }
}
export function messageDelay(w,fromBody,toBody){return Math.max(1,Math.ceil(distance(w,fromBody,toBody)*3));}
function endpointBody(w,endpoint){if(endpoint==='home')return homeOf(w)?.id;if(endpoint.startsWith('body:'))return byId(w,endpoint.slice(5))?.id;return w.colonies.find(c=>c.id===endpoint)?.planet;}
export function sendMessage(w,from,to,payload,{observedYear=w.year}={}){
 const state=w.observatory?.space,a=endpointBody(w,from),b=endpointBody(w,to);if(!state||!a||!b||from===to)throw Error('Неизвестная сторона связи.');
 if((from!=='home'&&!local(w,from)?.connected)||(to!=='home'&&!local(w,to)?.connected))return null;
 if(!Number.isSafeInteger(observedYear)||observedYear<0||observedYear>w.year)throw Error('Некорректный год наблюдения.');
 const msg={id:'signal'+state.nextMessage++,from,to,observedYear,sentYear:w.year,receiveYear:w.year+messageDelay(w,a,b),payload:clone(payload),delivered:false,deliveredYear:null};
 if(w.modelVersion==='1.0.1'&&from==='home'&&local(w,to))msg.homeOrigin=homeOf(w).id;
 state.messages.push(msg);return msg;
}
export function processMessages(w){const result=[];for(const msg of w.observatory.space.messages){if(msg.delivered||msg.receiveYear>w.year)continue;if(msg.to!=='home'&&!local(w,msg.to)?.connected)continue;msg.delivered=true;msg.deliveredYear=w.year;result.push(msg);
 if(w.modelVersion==='1.0.1'&&msg.from==='home'&&msg.homeOrigin===homeOf(w).id){
  const c=w.colonies.find(x=>x.id===msg.to),memory=local(w,msg.to)?.homeMemory;
  if(c?.population&&memory){
   memory.carriers=Math.min(c.population,Math.max(memory.carriers,Math.ceil(c.population*.12)));
   memory.received=w.year;memory.source='сообщение с родины';memory.evidence=msg.id;
  }
 }
 if(msg.payload?.kind==='probe-result'){const society=w.societies.find(x=>x.id===msg.payload.owner);if(society&&!society.probed.includes(msg.payload.target))society.probed.push(msg.payload.target);}if(msg.to!=='home'&&msg.payload?.kind==='skills'){const s=local(w,msg.to);if(s)for(const name of msg.payload.skills??[])if(typeof name==='string'&&!s.skills.includes(name))s.skills.push(name);}}return result;}
// An archive query uses delivery time, never current local state or future messages.
export function receivedMessages(w,endpoint,asOf=w.year){return w.observatory.space.messages.filter(m=>m.to===endpoint&&m.deliveredYear!==null&&m.deliveredYear<=asOf&&m.delivered).map(clone);}
export function publishColonyStatus(w,colonyId){const c=w.colonies.find(c=>c.id===colonyId);if(!c)return null;return sendMessage(w,colonyId,'home',{kind:'colony-status',colony:colonyId,population:c.population,food:c.food});}

// Launch decision is local: a healthy reserve, knowledge, equipment, motive, window and crew are all required.
export function returnAssessment(w,colonyId){
 const c=w.colonies.find(x=>x.id===colonyId),s=local(w,colonyId),home=homeOf(w);if(!c||!s||!home)return {allowed:false,reason:'нет данных'};
 const region=w.regions.find(r=>r.id===s.homeRegion);
 const target=targetOptions(w,c.planet,2).find(x=>x.id===home.id),crew=Math.min(20,Math.floor(c.population*.05));
 const cost={raw:12,equipment:5,food:crew*3};
 // A first crewed exchange needs evidence of sustained contact and a surplus in the colony.
 const reported=s.lastReport&&w.observatory.space.messages.some(m=>m.from===c.id&&m.to==='home'&&m.delivered);
 const exchange=s.connected&&reported&&s.lastLaunch===null&&c.autonomy>=.1&&c.population>=400&&c.food>=4.5*c.population;
 const motive=exchange?'отправить экипаж и продовольствие в родной регион для первого обмена':'восстановить связь с родной планетой';
 let reason='';if(s.connected&&!exchange)reason='связь действует, пока нет условий для дальнего обмена';else if(w.missions.length>=160)reason='достигнут предел миссий';else if(!s.knownBodies.includes(home.id))reason='цель неизвестна';else if(w.modelVersion==='1.0.1'&&!s.homeMemory?.carriers)reason='утрачено предание о родной планете';else if(!s.skills.includes('rocketry'))reason='нет местного навыка';else if(!s.skills.includes('farming')||c.food<c.population*4+cost.food)reason='нужны запасы для жителей';else if(!region)reason='нет известного места прибытия';else if(crew<5)reason='нет экипажа';else if(s.raw<cost.raw||s.equipment<cost.equipment)reason='нет материалов';else if(s.lastLaunch!==null&&w.year-s.lastLaunch<30)reason='недавний вылет';else if(w.missions.some(m=>m.kind==='return'&&m.originColony===c.id&&m.status==='transit'))reason='рейс уже в пути';else if(!target?.reachable)reason='цель недостижима';else if(!target.window)reason='окно закрыто';
 return {allowed:!reason,reason,crew,cost,target:home.id,region:region?.id??null,travelYears:target?.travelYears??null,motive};
}
export function launchReturn(w,colonyId){
 const decision=returnAssessment(w,colonyId);if(!decision.allowed)return {launched:false,...decision};
 const c=w.colonies.find(x=>x.id===colonyId),s=local(w,colonyId);c.population-=decision.crew;c.food-=decision.cost.food;s.raw-=decision.cost.raw;s.equipment-=decision.cost.equipment;s.lastLaunch=w.year;
 if(w.modelVersion==='1.0.1')s.homeMemory.carriers=Math.min(s.homeMemory.carriers,c.population);
 const m={id:'m'+w.nextEntity++,name:'Экспедиция '+c.name,owner:c.parent,target:decision.target,originColony:c.id,originRegion:decision.region,kind:'return',people:decision.crew,cargo:decision.cost.food,cost:decision.cost.raw,departure:w.year,arrival:w.year+decision.travelYears,status:'transit'};
 w.missions.push(m);w.observatory.space.returns.push({mission:m.id,origin:c.id,target:decision.target,region:decision.region,year:w.year,motive:decision.motive,cost:clone(decision.cost),arrival:null,recipient:null});return {launched:true,mission:m,decision};
}
// Run before the old mission-arrival handler; core must skip return missions itself.
export function resolveReturns(w,onFood=null){
 const arrived=[];
 for(const m of w.missions){
  if(m.kind!=='return'||m.status!=='transit'||m.arrival>w.year)continue;
  const r=w.regions.find(x=>x.id===m.originRegion),s=w.societies.find(x=>x.id===r?.owner);
  const record=w.observatory.space.returns.find(x=>x.mission===m.id);
  if(!r||!s){m.arrival=w.year+1;continue;}
  if(w.modelVersion==='1.0.1'&&r.occupation){
   if(record&&!record.hold)record.hold={since:w.year,reason:'место прибытия занято',war:r.occupation.warId};
   m.arrival=w.year+1;
   continue;
  }
  if(onFood)onFood(m.cargo);
  r.population+=m.people;s.population+=m.people;r.economy.stock.food+=m.cargo;m.status='arrived';
  if(record){record.arrival=w.year;record.recipient=s.id;}
  arrived.push(m.id);
 }
 return arrived;
}



// A link requires a living crew, the local orbital capability and functioning equipment.
export function refreshLink(w,colonyId){
 const c=w.colonies.find(x=>x.id===colonyId),s=local(w,colonyId);if(!c||!s)return null;
 const reason=c.population<=0?'нет жителей':!s.skills.includes('orbital')?'утрачен орбитальный навык':s.equipment<1?'нет исправного оборудования':'связь работает';
 const connected=reason==='связь работает',was=s.connected;if(s.connected!==connected||s.linkReason!==reason){s.connected=connected;s.linkReason=reason;if(connected&&!was)s.lastReport=null;w.observatory.space.links.push({colony:colonyId,year:w.year,connected,reason});}return {connected,reason};
}
// Foundation copies only material and skills explicitly carried by the mission.
export function found(w,c,mission){
 if(!c||!mission||mission.target!==c.planet||mission.kind!=='colony')throw Error('Неверные данные основания.');
 const payload=mission.outfit??{};
 const state=registerColony(w,c.id,{skills:payload.skills??[],raw:payload.raw??0,equipment:payload.equipment??0,knownBodies:payload.knownBodies??[],homeRegion:mission.originRegion});
 return state;
}
// Call after annual economy opening and before Economy.close; externalIn is a new v1 input term.
export function beforeSpace(w,importSupply){
 const due=w.missions.some(m=>m.kind==='return'&&m.status==='transit'&&m.arrival<=w.year);
 if(due&&typeof importSupply!=='function')throw Error('Учёт прибытия извне не подготовлен.');
 return resolveReturns(w,amount=>importSupply(w,'food',amount));
}
function reportNeeded(c,s,w){if(!s.lastReport)return true;const old=s.lastReport;return w.year-old.year>=25&&(Math.abs(c.population-old.population)>=Math.max(1,old.population*.2)||Math.abs(c.food-old.food)>=Math.max(1,old.food*.2));}
// Run once after colony demography and the annual economy; messages arise from genuine changes.
export function afterSpace(w){
 const active=w.colonies.filter(c=>local(w,c.id));
 for(const c of active){const s=local(w,c.id);
  if(w.modelVersion==='1.0.1')s.homeMemory.carriers=LivingWorld.nextGeneration(s.homeMemory.carriers,c.population,s.skills.includes('records')&&c.food>=c.population);
  localResourceYear(w,c.id);maintainColony(w,c,s);refreshLink(w,c.id);
  if(s.connected&&reportNeeded(c,s,w)){const msg=publishColonyStatus(w,c.id);if(msg)s.lastReport={year:w.year,population:c.population,food:c.food};}
  const parent=w.societies.find(x=>x.id===c.parent),missing=(parent?.knowledge??[]).filter(k=>k.active&&!s.skills.includes(k.id)).map(k=>k.id);
  const pending=w.observatory.space.messages.some(m=>m.to===c.id&&!m.delivered&&m.payload?.kind==='skills');
  if(s.connected&&missing.length&&!pending)sendMessage(w,'home',c.id,{kind:'skills',skills:missing});
 }
 processMessages(w);ColonialExchange.advance(w,distance,targetOptions);return active.map(c=>launchReturn(w,c.id));
}

// Validate the entire v1 extension before accepting a saved world or imported history.
export function validate(w){
 ColonialExchange.validate(w);
 const fail=x=>{throw Error('Некорректная космическая история: '+x);},s=w.observatory?.space;
 const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max, amount=n=>Number.isFinite(n)&&n>=0&&n<=1e12, text=x=>typeof x==='string'&&x.length>0&&x.length<=128;
 if(!s||s.version!==1||!s.colonies||typeof s.colonies!=='object'||Array.isArray(s.colonies)||!Array.isArray(s.messages)||!Array.isArray(s.returns)||!Array.isArray(s.links))fail('структура');
 if(!integer(s.nextMessage,1,1000001)||!integer(s.nextReturn,1,1000001)||s.messages.length>1000000||s.returns.length>1000000||s.links.length>1000000)fail('пределы');
 const bodies=new Map(),colonies=new Map(w.colonies.map(c=>[c.id,c])),societies=new Set(w.societies.map(x=>x.id)),regions=new Set(w.regions.map(x=>x.id)),missions=new Map([...(w.missionArchive??[]).flat(),...w.missions].map(m=>[m.id,m]));
 for(const p of w.planets){if(!p||!text(p.id)||bodies.has(p.id)||!text(p.name)||!amount(p.a)||p.a===0||!amount(p.radius)||p.radius===0||!amount(p.period)||p.period===0||!Number.isFinite(p.phase)||!['ice','rock','gas','terrestrial'].includes(p.kind)||typeof p.home!=='boolean')fail('тело');bodies.set(p.id,p);}
 if([...bodies.values()].filter(p=>p.home).length!==1)fail('родной мир');
 for(const p of bodies.values())if(p.parentId!==null){const parent=bodies.get(p.parentId);if(!parent||parent.parentId!==null||p.home||!p.orbit||!amount(p.orbit.distance)||p.orbit.distance===0||!amount(p.orbit.period)||p.orbit.period===0)fail('орбита спутника');}else if(p.orbit!==null)fail('орбита планеты');
 for(const c of Object.values(s.colonies)){
  if((c.homeRegion!==null&&!regions.has(c.homeRegion))||(c.hardYears!==undefined&&!integer(c.hardYears,0,w.year+1))||(c.training!==undefined&&!integer(c.training,0,12))||(c.lastFreight!=null&&!integer(c.lastFreight,0,w.year)))fail('местная история');
  if(c.lastTeaching&&(!integer(c.lastTeaching.year,0,w.year)||!['training','loss'].includes(c.lastTeaching.kind)||c.lastTeaching.skill!=='orbital'))fail('история обучения');
 }
 const ids=new Set();for(const [id,c] of Object.entries(s.colonies)){const base=colonies.get(id);if(!base||!bodies.has(base.planet)||!c||!Array.isArray(c.skills)||c.skills.length>64||c.skills.some(x=>!SKILLS.has(x))||new Set(c.skills).size!==c.skills.length||!Array.isArray(c.knownBodies)||c.knownBodies.length>bodies.size||c.knownBodies.some(x=>!bodies.has(x))||new Set(c.knownBodies).size!==c.knownBodies.length||![c.raw,c.equipment,c.deposits].every(amount)||typeof c.connected!=='boolean'||!text(c.linkReason)||(c.lastLaunch!==null&&!integer(c.lastLaunch,0,w.year)))fail('локальная колония');if(c.lastReport!==null&&(!integer(c.lastReport.year,0,w.year)||!amount(c.lastReport.population)||!amount(c.lastReport.food)))fail('последнее сообщение');}
 for(const m of s.messages){const n=/^signal([1-9]\d*)$/.exec(m?.id??'');if(!n||ids.has(m.id)||Number(n[1])>=s.nextMessage||!(m.from==='home'||colonies.has(m.from)||(m.from?.startsWith('body:')&&bodies.has(m.from.slice(5))))||!['home',...colonies.keys()].includes(m.to)||m.from===m.to||!integer(m.observedYear,0,w.year)||!integer(m.sentYear,m.observedYear,w.year)||!integer(m.receiveYear,m.sentYear+1,100000000)||typeof m.delivered!=='boolean'||(m.delivered?(!integer(m.deliveredYear,m.receiveYear,w.year)):(m.deliveredYear!==null))||!m.payload||typeof m.payload!=='object'||Array.isArray(m.payload))fail('сообщение');ids.add(m.id);
  if(!['skills','colony-status','probe-result'].includes(m.payload.kind))fail('тип сообщения');
  if(m.payload.kind==='skills'&&(m.from!=='home'||!colonies.has(m.to)||!Array.isArray(m.payload.skills)||m.payload.skills.length>64||m.payload.skills.some(x=>!SKILLS.has(x))))fail('навыки сообщения');
  if(m.payload.kind==='colony-status'&&(!colonies.has(m.payload.colony)||m.from!==m.payload.colony||m.to!=='home'||!amount(m.payload.population)||!amount(m.payload.food)))fail('состояние сообщения');
  if(m.payload.kind==='probe-result'){const probe=missions.get(m.payload.mission);if(!probe||probe.kind!=='probe'||probe.status!=='arrived'||probe.target!==m.payload.target||probe.owner!==m.payload.owner||m.from!=='body:'+probe.target||m.to!=='home')fail('результат зонда');}

 }
 if(w.modelVersion==='1.0.1'){
  const signals=new Map(s.messages.map(m=>[m.id,m])),home=homeOf(w);
  for(const m of s.messages)if(m.homeOrigin!==undefined&&(m.from!=='home'||m.homeOrigin!==home.id||!colonies.has(m.to)))fail('происхождение сигнала');
  for(const [id,local] of Object.entries(s.colonies)){
   const mem=local.homeMemory,c=colonies.get(id);
   if(!mem||mem.body!==home.id||!integer(mem.carriers,0,c.population)||!integer(mem.received,c.founded,w.year))fail('носители памяти о доме');
   if(mem.source==='основатели'){if(mem.evidence!==null||mem.received!==c.founded)fail('память основателей');}
   else {const msg=signals.get(mem.evidence);if(mem.source!=='сообщение с родины'||msg?.homeOrigin!==home.id||msg?.to!==id||msg.deliveredYear!==mem.received)fail('источник памяти о доме');}
  }
 }
 let linkYear=-1;for(const l of s.links){if(!colonies.has(l.colony)||!integer(l.year,0,w.year)||l.year<linkYear||typeof l.connected!=='boolean'||!text(l.reason))fail('состояние связи');linkYear=l.year;}
 const returns=new Set();for(const r of s.returns){const m=missions.get(r?.mission);if(!m||m.kind!=='return'||returns.has(r.mission)||!colonies.has(r.origin)||!bodies.has(r.target)||!regions.has(r.region)||!integer(r.year,0,w.year)||!text(r.motive)||!r.cost||![r.cost.raw,r.cost.equipment,r.cost.food].every(amount)||(r.arrival!==null&&(!integer(r.arrival,r.year,w.year)||!societies.has(r.recipient)))||(r.arrival===null&&r.recipient!==null))fail('возвращение');returns.add(r.mission);}
 if(w.schema==='microgalaxy.observatory/1'){
  let annualFood=0,totalFood=0;
  for(const r of s.returns){
   const m=missions.get(r.mission);
   if(w.modelVersion==='1.0.1'&&r.hold){
    const h=r.hold,war=w.wars.find(c=>c.id===h.war);
    if(!war||!integer(h.since,m.departure+1,w.year)||h.since<war.start||h.reason!=='место прибытия занято'||r.arrival!==null&&h.since>=r.arrival)fail('ожидание безопасного прибытия');
   }
   if(r.origin!==m.originColony||r.target!==m.target||r.region!==m.originRegion||r.year!==m.departure||r.cost.food!==m.cargo||r.cost.raw!==m.cost||!['transit','arrived'].includes(m.status))fail('связь груза с рейсом');
   if((r.arrival!==null)!==(m.status==='arrived')||r.arrival!==null&&r.arrival!==m.arrival)fail('дата разгрузки');
   if(r.arrival!==null){totalFood+=m.cargo;if(r.arrival===w.year)annualFood+=m.cargo;}
  }
  for(const m of missions.values())if(m.kind==='return'&&!returns.has(m.id))fail('рейс без записи');
  for(const [account,food] of [[w.economy?.ledger,annualFood],[w.economy?.cumulative,totalFood]]){
   const incoming=account?.externalIn;
   if(!incoming||!Number.isFinite(incoming.food)||Math.abs(incoming.food-food)>1e-9*Math.max(1,food)||incoming.raw!==0||incoming.equipment!==0||incoming.energy!==0)fail('внешнее поступление без доставленного груза');
  }
 }
 return true;
}

// Call only when a probe really reaches the body; the parent society learns after signal delay.
export function probeArrived(w,mission){
 if(!mission||mission.kind!=='probe'||mission.status!=='arrived'||mission.arrival>w.year||!byId(w,mission.target)||!w.societies.some(x=>x.id===mission.owner))throw Error('Некорректное прибытие зонда.');
 const space=w.observatory.space;if(space.messages.some(m=>m.payload?.kind==='probe-result'&&m.payload.mission===mission.id))throw Error('Сигнал зонда уже записан.');
 const home=homeOf(w),signal={id:'signal'+space.nextMessage++,from:'body:'+mission.target,to:'home',observedYear:w.year,sentYear:w.year,receiveYear:w.year+messageDelay(w,mission.target,home.id),payload:{kind:'probe-result',mission:mission.id,target:mission.target,owner:mission.owner},delivered:false,deliveredYear:null};space.messages.push(signal);return signal;
}
