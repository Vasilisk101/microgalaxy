/** MICROGALAXY 0.5: living geography and a paged history of civilizations.
 * All quantities are conditional game-model units, not scientific forecasts.
 * One deterministic annual step; camera, frame rate, wall clock and UI never enter it.
 * The 0.3 model remains separate; prior worlds are never silently converted.
 */
import * as Geography from './geography.mjs';
import * as Archive from './archive.mjs';
export const MODEL_VERSION = '0.5.0';
export const SCHEMA = 'microgalaxy.geography/1';
export const LIMITS = Object.freeze({years:10000, societies:16, missions:160, colonies:24, events:256, snapshots:64});
export const COLORS = ['#eab66a','#6db7c5','#c384b1','#93b981','#ac9bd2','#cd8b70','#70b7a1','#e2cc82','#7f9dc6','#b3bf7b','#d39fa2','#77b1cf','#b7a688','#aab9c7','#9d8cbf','#d79d65'];
export const GOVERNMENTS = ['Совет общин','Наследственная власть','Союз городов','Федерация'];
export const TECH_NAMES = ['Земледелие','Производство','Исследования','Институты'];
export const FACTIONS = Object.freeze([{id:'growers',name:'Общины земледельцев'},{id:'merchants',name:'Торговые объединения'},{id:'scholars',name:'Сообщество исследователей'},{id:'guard',name:'Военная знать'}]);
export const POLICIES = Object.freeze({food:'Продовольственная устойчивость',trade:'Открытая торговля',research:'Развитие знаний',security:'Безопасность'});
const FACTION_POLICY = {growers:'food',merchants:'trade',scholars:'research',guard:'security'};
const SUCCESSION = {'Совет общин':'Выбор делегатов каждые 12 лет','Наследственная власть':'Наследование после ухода правителя','Союз городов':'Городские выборы каждые 12 лет','Федерация':'Федеральные выборы каждые 12 лет'};
export const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
export const clone = v => structuredClone(v);
export function hash(s) { let h=2166136261; for (const c of String(s)) {h^=c.charCodeAt(0); h=Math.imul(h,16777619);} return h>>>0; }
export function rand(seed,...keys) { let x=hash(JSON.stringify([seed,...keys])); x^=x>>>16; x=Math.imul(x,0x7feb352d); x^=x>>>15; x=Math.imul(x,0x846ca68b); x^=x>>>16; return (x>>>0)/4294967296; }
const rr = (w,...k) => rand(w.seed,...k);
const ryear = (w,...k) => rr(w,w.year,...k);
const rounded = (w,v,...k) => Math.floor(v)+(ryear(w,...k)<v-Math.floor(v)?1:0);
const sum = (a,f) => a.reduce((n,x)=>n+f(x),0);
const metric = n => Math.round(n*1000)/1000;
const agricultureMultiplier = s => s.politics.policy==='food'?1.12:s.politics.policy==='research'?.96:s.politics.policy==='security'?.97:1;
function name(seed,key) {const a=['Ар','Ве','Ил','Ка','Ли','Ме','Но','Ор','Ре','Са','Та','Эл']; const b=['ден','лан','мир','нар','рион','сар','тес','вар','вен'];return a[Math.floor(rand(seed,key,'a')*a.length)]+b[Math.floor(rand(seed,key,'b')*b.length)];}
export function terrain(seed,lon,lat) {const q=rand(seed,'terrain')*6.28, x=lon*Math.PI/180,y=lat*Math.PI/180;return Math.sin(x*2+q+Math.sin(y*3))*.46+Math.cos(x*3-y*2+q)*.25+Math.sin(x*5+y*4)*.13+Math.cos(x*11-y*8+q)*.07-Math.abs(lat)/310;}
export function distance(a,b) { const p=Math.PI/180;return Math.acos(clamp(Math.sin(a.lat*p)*Math.sin(b.lat*p)+Math.cos(a.lat*p)*Math.cos(b.lat*p)*Math.cos((a.lon-b.lon)*p),-1,1)); }
function event(w,type,title,detail,entityId=null,causes=[],important=false,causeEventIds=[],otherEntities=[],metadata={}) {return Archive.appendEvent(w,{year:w.year,type,title,detail,entityId,entityIds:[...new Set([entityId,...otherEntities].filter(Boolean))],causes:clone(causes),important,causeEventIds:[...new Set(causeEventIds.filter(Boolean))].slice(0,4),...clone(metadata)});}
export function allEvents(w,throughYear=Infinity){return Archive.allEvents(w,throughYear);}
export function allMissions(w,throughYear=Infinity){return Archive.allMissions(w,throughYear);}
export function eventPage(w,pageIndex,options={}){return Archive.eventPage(w,pageIndex,options);}
export function eventCount(w,throughYear=Infinity){return Archive.eventCount(w,throughYear);}
export function eventPageCount(w,throughYear=Infinity){return Archive.eventPageCount(w,throughYear);}
export function geographySummary(w){return Geography.geographySummary(w);}
export function regionSummary(w,id){return Geography.regionSummary(w,id);}
export function routeBetweenRegions(w,from,to,options={}){return Geography.routeBetweenRegions(w,from,to,options);}
const why = (label,value) => ({label,value:typeof value==='number'?metric(value):String(value)});
function leader(w,s,index=0) {return {name:name(w.seed,`${s.id}:leader:${index}`),index,age:32+Math.floor(rr(w,s.id,index,'age')*19),skill:.3+rr(w,s.id,index,'skill')*.7};}
function initialPolitics(w,s){
  const values=FACTIONS.map(f=>.3+rr(w,s.id,f.id,'influence')),total=sum(values,x=>x);
  const factions=FACTIONS.map((f,i)=>({id:f.id,influence:values[i]/total,support:.5+rr(w,s.id,f.id,'support')*.3}));
  const rulingFaction=factions.reduce((a,b)=>a.influence>b.influence?a:b).id;
  return {legitimacy:.55+rr(w,s.id,'legitimacy')*.25,institutionalMemory:.35+rr(w,s.id,'memory')*.3,rulingFaction,policy:FACTION_POLICY[rulingFaction],factions,since:w.year,nextReview:w.year+12,lastPolicyChange:w.year,crisisSince:null,recoveryYears:0,hungerYears:0,migrationPressure:0,defenseReadiness:0,events:{}};
}
function remember(s,key,e){s.politics.events[key]={id:e.id,year:e.year};return e;}
function recent(w,s,key,age=40){const e=s.politics.events[key];return e&&w.year-e.year<=age?e.id:null;}
function relation(a,b,trust){return {a,b,trust,trade:0,dependencyA:0,dependencyB:0,treaty:null,lastTreatyYear:-40,lastEventId:null,lastTradeEventId:null,lastTradeYear:-40,tradeYears:0};}
function society(w,id,idx,pop,tech) {let s={id,name:name(w.seed,id),color:COLORS[idx],population:pop,food:pop*1.7,minerals:40,tech:tech.slice(),stability:.62+rr(w,id,'stability')*.25,government:GOVERNMENTS[Math.floor(rr(w,id,'government')*GOVERNMENTS.length)],leader:null,language:name(w.seed,id+'lang'),divergence:0,parentId:null,foundingYear:0,unrestYears:0,lastReform:-40,supply:1,production:0,capacity:0,satellite:false,probed:[],lastLaunch:-50};s.leader=leader(w,s);s.politics=initialPolitics(w,s);return s;}
export function createWorld(seed='MICROGALAXY', options={}) {
  if(typeof seed!=='string'||!seed.trim()||seed.length>128) throw new Error('Код мира должен содержать 1–128 символов.');
  const era=options.era??'agriculture';if(!['agriculture','industrial','space'].includes(era))throw new Error('Неизвестная начальная эпоха.');
  const count=4+Math.floor(rand(seed,'societies')*3),mass=.75+rand(seed,'mass')*.5,luminosity=mass**3.5;
  const w={schema:SCHEMA,modelVersion:MODEL_VERSION,id:'w-'+hash(seed+era).toString(16),seed,era,name:name(seed,'star')+' · '+String(hash(seed)%1000).padStart(3,'0'),year:0,nextEvent:1,nextEntity:100,star:{mass,luminosity,temperature:4800+mass*900,age:2+rand(seed,'age')*4},planets:[],regions:[],societies:[],relations:[],wars:[],missions:[],missionArchive:[],colonies:[],events:[],eventArchive:[],history:[],snapshots:[],geography:{edges:[],movements:[]},climate:{warming:0,pollution:0},ledger:{births:0,deaths:0,totalBefore:0,totalAfter:0},archivalCoverage:'Начало + последние 16 срезов + разреженные опоры всей истории (до 64); показатели — каждые 10 лет'};
  const np=5+Math.floor(rand(seed,'nplanets')*4);
  for(let i=0;i<np;i++){const a=Math.sqrt(luminosity)*(.35*1.69**i),kind=i===2?'terrestrial':i>4?'gas':rand(seed,i,'type')>.5?'rock':'ice';w.planets.push({id:'p'+i,name:name(seed,'p'+i),a:i===2?Math.sqrt(luminosity):a,radius:i===2?1:i>4?3+rand(seed,i,'radius')*5:.4+rand(seed,i,'radius')*.9,kind,home:i===2,temperature:i===2?12+rand(seed,'homeTemp')*9:Math.round(278*(luminosity/a**2)**.25-273),phase:rand(seed,i,'phase')*Math.PI*2,period:Math.sqrt(a**3/mass),moons:Math.floor(rand(seed,i,'moons')*(i>4?8:3))});}
  w.planets[2].period=Math.sqrt(w.planets[2].a**3/mass);
  // Land cells share the same terrain function as the globe, rather than imaginary overlay locations.
  for(let i=0;i<500&&w.regions.length<60;i++){const lat=(rand(seed,'region',i,'lat')-.5)*135,lon=rand(seed,'region',i,'lon')*360-180;if(terrain(seed,lon,lat)<0.02)continue;if(w.regions.some(r=>distance(r,{lat,lon})<.1))continue;w.regions.push({id:'r'+w.regions.length,lat,lon,owner:null,fertility:.45+rand(seed,i,'fertility')*.5,water:.45+rand(seed,i,'water')*.5,biomass:.7+rand(seed,i,'bio')*.3,reserves:1500+rand(seed,i,'reserve')*5000,stress:0,disasterUntil:0});}
  const centers=[w.regions[0]];for(let n=1;n<count;n++){const c=w.regions.reduce((best,r)=>Math.min(...centers.map(c=>distance(c,r)))>Math.min(...centers.map(c=>distance(c,best)))?r:best,w.regions[0]);centers.push(c);}
  w.regions.forEach(r=>{let ci=0;for(let i=1;i<count;i++)if(distance(r,centers[i])<distance(r,centers[ci]))ci=i;r.owner='s'+ci;});
  const levels={agriculture:[.4,.2,.15,.3],industrial:[1.6,1.5,1.3,1.1],space:[2.6,3.7,3.3,2.2]}[era];
  for(let i=0;i<count;i++){const land=w.regions.filter(r=>r.owner==='s'+i);const pop=Math.round(sum(land,r=>4500*r.fertility)*(.62+rand(seed,i,'pop')*.2));const s=society(w,'s'+i,i,pop,levels.map((x,j)=>x+rand(seed,i,j,'tech')*.12));s.capitalId=centers[i].id;s.capacity=sum(land,r=>4500*r.fertility);w.societies.push(s);}
  for(let i=0;i<count;i++)for(let j=i+1;j<count;j++)w.relations.push(relation('s'+i,'s'+j,.3+rand(seed,i,j,'trust')*.55));
  Geography.initializeGeography(w);
  for(const s of w.societies)s.capacity=sum(w.regions.filter(r=>r.owner===s.id),r=>Geography.regionalCapacity(w,r))*agricultureMultiplier(s);
  event(w,'origin','Начало наблюдения',`Сформировавшаяся система и ${count} обществ. Исходное состояние задано генератором, а не вычислено из происхождения жизни.`,null,[why('Код',seed),why('Эпоха',era)],true);
  w.ledger.totalBefore=w.ledger.totalAfter=totalPopulation(w);checkpoint(w);validateWorld(w);return w;
}
export function totalPopulation(w) {return sum(w.societies,s=>s.population)+sum(w.colonies,c=>c.population)+sum(w.missions,m=>m.status==='transit'?m.people:0);}
export function epoch(s){const t=(s.tech[0]+s.tech[1]+s.tech[2])/3;return t<1?'Ранние общества':t<1.8?'Городские цивилизации':t<2.6?'Промышленная эпоха':s.satellite?'Космическая эпоха':'Технологическая эпоха';}
export function summary(w){return {year:w.year,population:totalPopulation(w),societies:w.societies.filter(s=>s.population>0).length,colonies:w.colonies.filter(c=>c.population>0).length,warming:metric(w.climate.warming),wars:w.wars.filter(c=>c.active).length,knowledge:metric(sum(w.societies,s=>s.tech[2])/w.societies.length),activeTreaties:w.relations.filter(r=>r.treaty).length,tradeVolume:metric(sum(w.relations,r=>r.trade)),avgLegitimacy:metric(sum(w.societies,s=>s.politics.legitimacy)/w.societies.length)};}
export function politicsSummary(w,id){const s=w.societies.find(s=>s.id===id);if(!s)return null;const p=s.politics;return {government:s.government,legitimacy:p.legitimacy,institutionalMemory:p.institutionalMemory,policyLabel:POLICIES[p.policy],rulingFactionLabel:FACTIONS.find(f=>f.id===p.rulingFaction).name,factions:p.factions.map(f=>({...clone(f),name:FACTIONS.find(a=>a.id===f.id).name})),since:p.since,successionLabel:SUCCESSION[s.government],crisis:p.crisisSince!==null};}
export function diplomacySummary(w){return w.relations.map(r=>({id:[r.a,r.b].sort().join(':'),a:r.a,b:r.b,trust:r.trust,status:w.wars.some(c=>c.active&&[c.a,c.b].includes(r.a)&&[c.a,c.b].includes(r.b))?'Вооружённый конфликт':r.trust<.25?'Напряжённость':r.trust>.7?'Партнёрство':'Мирные отношения',treaty:r.treaty?({trade:'Торговый договор',alliance:'Договор взаимопомощи',truce:'Мирный договор'}[r.treaty.kind]):'Нет договора',trade:r.trade,dependencyA:r.dependencyA,dependencyB:r.dependencyB,startYear:r.treaty?.since??null,causeEventIds:[r.treaty?.eventId??r.lastEventId,r.lastTradeEventId].filter((x,i,a)=>x&&a.indexOf(x)===i)}));}
export function eventThread(w,eventId){
  const events=allEvents(w),byId=new Map(events.map(e=>[e.id,e])),focus=byId.get(eventId);if(!focus)return {before:[],focus:null,after:[]};
  const beforeIds=new Set(),queue=[...(focus.causeEventIds??[])];
  while(queue.length&&beforeIds.size<160){const id=queue.shift();if(beforeIds.has(id)||!byId.has(id))continue;beforeIds.add(id);queue.push(...byId.get(id).causeEventIds);}
  const afterIds=new Set([eventId]);for(const e of events){if(afterIds.size>=161)break;if(e.causeEventIds.some(id=>afterIds.has(id)))afterIds.add(e.id);}
  afterIds.delete(eventId);return {before:events.filter(e=>beforeIds.has(e.id)).map(clone),focus:clone(focus),after:events.filter(e=>afterIds.has(e.id)).map(clone)};
}
export function storylines(w){
  // Connected components of explicit causal edges; isolated and origin events are not stories.
  const events=allEvents(w),parent=new Map(events.map(e=>[e.id,e.id])),index=new Map(events.map((e,i)=>[e.id,i]));
  const find=id=>{let n=id;while(parent.get(n)!==n)n=parent.get(n);while(parent.get(id)!==id){const next=parent.get(id);parent.set(id,n);id=next;}return n;};
  for(const e of events)for(const id of e.causeEventIds){if(!parent.has(id))continue;const a=find(id),b=find(e.id);if(a!==b)parent.set(index.get(a)<index.get(b)?b:a,index.get(a)<index.get(b)?a:b);}
  const groups=new Map();for(const e of events){const id=find(e.id);if(!groups.has(id))groups.set(id,[]);groups.get(id).push(e);}
  return [...groups.values()].filter(es=>es.length>1).map(es=>({id:es[0].id,title:es[0].title,startYear:es[0].year,endYear:es.at(-1).year,eventCount:es.length,eventIds:es.map(e=>e.id),societyIds:[...new Set(es.flatMap(e=>e.entityIds))],status:w.year-es.at(-1).year<=20?'Есть недавние последствия':'Историческая цепочка'})).sort((a,b)=>b.endYear-a.endYear||b.eventCount-a.eventCount);
}
function snapshot(w){return clone({year:w.year,nextEvent:w.nextEvent,nextEntity:w.nextEntity,ledger:w.ledger,climate:w.climate,geography:w.geography,regions:w.regions,societies:w.societies,colonies:w.colonies,missions:w.missions,wars:w.wars,relations:w.relations});}
function checkpoint(w){w.snapshots=Archive.retainSnapshots([...w.snapshots,snapshot(w)],{limit:LIMITS.snapshots,recent:16});if(w.year%10===0||w.year===0)w.history.push(summary(w));}
export function viewSnapshot(w,index){const s=w.snapshots[index];if(!s)throw new Error('Нет такой контрольной точки.');return clone({...w,...s,...Archive.archiveThroughYear(w,s.year),history:w.history.filter(h=>h.year<=s.year),snapshots:w.snapshots.slice(0,index+1)});}

function dominantFaction(s){
  const favored={'Совет общин':'growers','Наследственная власть':'guard','Союз городов':'merchants','Федерация':'scholars'}[s.government];
  return [...s.politics.factions].sort((a,b)=>(b.influence*(.4+.6*b.support)+(b.id===favored?.05:0))-(a.influence*(.4+.6*a.support)+(a.id===favored?.05:0))||a.id.localeCompare(b.id))[0].id;
}
function changePolicy(w,s){
  const p=s.politics,war=w.wars.some(c=>c.active&&[c.a,c.b].includes(s.id));
  const next=p.hungerYears>=4?'food':war?'security':FACTION_POLICY[p.rulingFaction];
  if(next===p.policy||w.year-p.lastPolicyChange<12)return;
  const old=p.policy;p.policy=next;p.lastPolicyChange=w.year;
  const causes=p.hungerYears>=4?[recent(w,s,'food',20)]:war?[recent(w,s,'war',30)]:[p.events.leadership?.id];
  remember(s,'policy',event(w,'politics','Изменение политического курса',`${s.name}: «${POLICIES[old]}» → «${POLICIES[next]}». Меняется распределение хозяйственных и исследовательских усилий.`,s.id,[why('Правящая группа',FACTIONS.find(f=>f.id===p.rulingFaction).name),why('Годы нехватки пищи',p.hungerYears),why('Действующий конфликт',war?'да':'нет')],false,causes));
}
function succession(w,s,reason,causeEventIds=[]){
  const p=s.politics,old=s.leader.name,previousFaction=p.rulingFaction;
  s.leader=leader(w,s,s.leader.index+1);p.since=w.year;p.rulingFaction=dominantFaction(s);
  const disruption=(s.government==='Наследственная власть'?.09:.04)*(1-p.institutionalMemory);
  s.stability=clamp(s.stability-disruption,.03,.97);p.legitimacy=clamp(p.legitimacy+(previousFaction===p.rulingFaction?.015:.05)-disruption,0,1);
  remember(s,'leadership',event(w,'politics','Смена руководства',`${s.name}: ${old} уступил место ${s.leader.name}. ${reason}.`,s.id,[why('Порядок',SUCCESSION[s.government]),why('Институциональная память',p.institutionalMemory),why('Изменение устойчивости',-disruption),why('Правящая группа',FACTIONS.find(f=>f.id===p.rulingFaction).name)],false,causeEventIds));
  changePolicy(w,s);
}
function politics(w,s){
  const p=s.politics,atWar=w.wars.some(c=>c.active&&[c.a,c.b].includes(s.id)),links=w.relations.filter(r=>[r.a,r.b].includes(s.id));
  p.migrationPressure*=.9;p.hungerYears=s.supply<.88?p.hungerYears+1:Math.max(0,p.hungerYears-1);
  const commerce=clamp(sum(links,r=>r.trade)/Math.max(1,s.population),0,1);
  const wants={growers:.3+(1-s.supply)*.9,merchants:.22+commerce*.8,scholars:.16+s.tech[2]*.055,guard:.2+(atWar?.45:0)+(1-s.stability)*.2},weight=sum(Object.values(wants),x=>x);
  for(const f of p.factions){const support={growers:s.supply*.7+s.stability*.3,merchants:.4+s.stability*.35+commerce*.3-(atWar?.3:0),scholars:.35+s.tech[2]*.05+p.institutionalMemory*.2+(p.policy==='research'?.12:0),guard:.3+s.stability*.4+(p.policy==='security'?.2:0)}[f.id];f.support=clamp(f.support*.92+support*.08,0,1);f.influence=f.influence*.96+wants[f.id]/weight*.04;}
  const target=clamp(sum(p.factions,f=>f.influence*f.support)*.7+p.institutionalMemory*.2+s.stability*.1-(atWar?.08:0)-p.migrationPressure*.12,0,1);
  p.legitimacy=clamp(p.legitimacy+(target-p.legitimacy)*.055-(1-s.supply)*.018,0,1);
  p.institutionalMemory=clamp(p.institutionalMemory+(s.stability>.45?.0008:-.0012)*(p.crisisSince===null?1:2),.05,.98);
  s.stability=clamp(s.stability+(p.legitimacy-.55)*.006-p.migrationPressure*.004,.03,.97);
  if(p.crisisSince===null&&p.legitimacy<.4&&(s.stability<.5||p.hungerYears>=6)){
    p.crisisSince=w.year;p.recoveryYears=0;
    remember(s,'crisis',event(w,'politics','Кризис легитимности',`${s.name}: поддержка власти упала; действующие процедуры оспариваются группами влияния.`,s.id,[why('Легитимность',p.legitimacy),why('Годы нехватки пищи',p.hungerYears),why('Миграционная нагрузка',p.migrationPressure),why('Устойчивость',s.stability)],true,[p.hungerYears>0?recent(w,s,'food',25):null,p.migrationPressure>.001?recent(w,s,'migration',20):null,atWar?recent(w,s,'war',25):null]));
  }
  if(p.crisisSince!==null&&w.year-p.crisisSince>=6&&w.year-s.lastReform>30){
    const old=s.government,winner=dominantFaction(s),forms={growers:'Совет общин',merchants:'Союз городов',scholars:'Федерация',guard:'Наследственная власть'};
    s.government=forms[winner];s.lastReform=w.year;p.rulingFaction=winner;p.institutionalMemory*=.9;p.legitimacy=clamp(p.legitimacy+.12,0,1);s.stability=clamp(s.stability+.12,.03,.97);
    const reform=remember(s,'reform',event(w,'politics','Перестройка институтов',`${s.name}: ${old===s.government?'реформа сохраняет форму «'+s.government+'»':old+' → '+s.government}. Часть действующих процедур сохранена.`,s.id,[why('Группа, проводящая реформу',FACTIONS.find(f=>f.id===winner).name),why('Сохранённая институциональная память',p.institutionalMemory),why('Рост легитимности',.12)],true,[p.events.crisis?.id]));
    succession(w,s,'Передача полномочий после институциональной реформы',[reform.id]);p.nextReview=w.year+12;
  }
  p.recoveryYears=p.crisisSince!==null&&p.legitimacy>.55&&s.supply>.95&&s.stability>.45?p.recoveryYears+1:0;
  if(p.recoveryYears>=3){const reform=p.events.reform,policy=p.events.policy;remember(s,'recovery',event(w,'politics','Завершение политического кризиса',`${s.name}: снабжение и поддержка власти восстановились; конфликт вокруг институтов ослаб.`,s.id,[why('Легитимность',p.legitimacy),why('Обеспеченность',s.supply)],true,[p.events.crisis?.id,reform?.year>=p.crisisSince?reform.id:null,p.policy==='food'&&policy?.year>=p.crisisSince?policy.id:null,recent(w,s,'supply',10)]));p.crisisSince=null;p.recoveryYears=0;}
  s.leader.age++;
  const departure=s.leader.age>=88||(s.leader.age>64&&ryear(w,s.id,'succession')<.04);
  if(departure)succession(w,s,s.government==='Наследственная власть'?'Наследование власти':'Выбор нового руководителя после ухода предшественника');
  else if(w.year>=p.nextReview&&s.government!=='Наследственная власть'){
    if(dominantFaction(s)!==p.rulingFaction||w.year-p.since>=24)succession(w,s,'Плановое обновление выборного руководства');
  }
  if(w.year>=p.nextReview)p.nextReview=w.year+12;
  changePolicy(w,s);
}
function diplomacy(w,ss){
  for(const r of w.relations){
    const a=ss.find(s=>s.id===r.a),b=ss.find(s=>s.id===r.b);r.trade=0;r.dependencyA*=.8;r.dependencyB*=.8;
    if(!a?.population||!b?.population)continue;
    const war=w.wars.find(c=>c.active&&[c.a,c.b].includes(a.id)&&[c.a,c.b].includes(b.id));
    if(r.treaty&&(war||(r.trust<.26&&r.treaty.kind!=='truce'))){
      const prior=r.treaty;const e=event(w,'diplomacy','Разрыв договора',`${a.name} и ${b.name} прекратили договорные отношения. Льготные поставки и союзная помощь остановлены.`,a.id,[why('Доверие',r.trust),why('Договор действовал, лет',w.year-prior.since),why('Конфликт',war?'да':'нет')],true,[prior.eventId,war?.originEventId],[b.id]);r.treaty=null;r.lastTreatyYear=w.year;r.lastEventId=e.id;
    }
    if(war)continue;
    if(r.treaty?.kind==='truce'&&w.year-r.treaty.since>=20){r.treaty=null;r.lastTreatyYear=w.year;}
    const phase=hash([r.a,r.b].join(':'))%8;
    if(w.year%8===phase&&!r.treaty&&r.trust>.62&&w.year-r.lastTreatyYear>=20){
      const e=event(w,'diplomacy','Торговый договор',`${a.name} и ${b.name} открыли договорный канал снабжения. Базовый лимит продовольственных поставок партнёру увеличен с 14% до 24% годовой потребности; курс открытой торговли может его повысить.`,a.id,[why('Взаимное доверие',r.trust),why('Базовый лимит поставок',.24)],true,[w.year-r.lastTradeYear<=40?r.lastTradeEventId:null],[b.id]);r.treaty={kind:'trade',since:w.year,eventId:e.id};r.lastTreatyYear=w.year;r.lastEventId=e.id;remember(a,'treaty',e);remember(b,'treaty',e);
    }else if(w.year%8===phase&&r.treaty?.kind==='trade'&&r.trust>.82&&w.year-r.treaty.since>=20&&a.stability>.55&&b.stability>.55){
      const e=event(w,'diplomacy','Договор взаимопомощи',`${a.name} и ${b.name} расширили торговый договор до взаимопомощи. Союзники могут передавать материалы на оборону, а базовый продовольственный лимит составляет 30%.`,a.id,[why('Доверие',r.trust),why('Опыт договора, лет',w.year-r.treaty.since),why('Базовый лимит поставок',.3)],true,[r.treaty.eventId],[b.id]);r.treaty={kind:'alliance',since:w.year,eventId:e.id};r.lastTreatyYear=w.year;r.lastEventId=e.id;remember(a,'treaty',e);remember(b,'treaty',e);
    }
    const [seller,buyer]=a.food/a.population>b.food/b.population?[a,b]:[b,a];
    if(r.trust>.22){
      const limit=r.treaty?.kind==='alliance'?.3:r.treaty?.kind==='trade'?.24:.14,openness=(seller.politics.policy==='trade'||buyer.politics.policy==='trade')?1.12:1;
      let amount=Math.min(Math.max(0,seller.food-seller.population*1.7),Math.max(0,buyer.population*1.2-buyer.food),buyer.population*limit*openness);
      if(amount>0&&!Geography.routeBetweenRegions(w,seller.capitalId,buyer.capitalId,{societyId:seller.id,allowForeign:true}))amount=0;
      seller.food-=amount;buyer.food+=amount;r.trade=amount;
      if(buyer===a)r.dependencyA=clamp(r.dependencyA+.2*amount/buyer.population,0,1);else r.dependencyB=clamp(r.dependencyB+.2*amount/buyer.population,0,1);
      if(amount>buyer.population*.025&&w.year-r.lastTradeYear>=35){
        const e=event(w,'economy','Поставки восполняют нехватку пищи',`${seller.name} передало ${Math.round(amount)} единиц продовольствия обществу ${buyer.name}. Запас поставщика уменьшен на тот же объём.`,buyer.id,[why('Доля годовой потребности',amount/buyer.population),why('Передано пищи',amount),why('Договор',r.treaty?.kind??'нет')],false,[recent(w,buyer,'food',20),r.treaty?.eventId],[seller.id]);r.lastTradeYear=w.year;r.lastTradeEventId=e.id;remember(buyer,'supply',e);
      }
    }
    r.tradeYears=r.trade>0?r.tradeYears+1:0;
    r.trust=clamp(r.trust+(r.trade>0?.006:0)+(r.treaty?.kind==='alliance'?.0006:0)-Math.max(0,1-a.food/a.population,1-b.food/b.population)*.025+(ryear(w,r.a,r.b,'relation')-.5)*.015,.01,.99);
  }
}
function alliedSupport(w,c,s){
  c.supportedBy??=[];
  for(const r of w.relations){
    if(r.treaty?.kind!=='alliance'||![r.a,r.b].includes(s.id))continue;
    const id=r.a===s.id?r.b:r.a;if([c.a,c.b].includes(id))continue;
    const donor=w.societies.find(t=>t.id===id);if(!donor?.population||donor.supply<.9)continue;
    if(!Geography.routeBetweenRegions(w,donor.capitalId,s.capitalId,{societyId:donor.id,allowForeign:true}))continue;
    const amount=Math.min(Math.max(0,donor.minerals-5),s.population*.00004);if(amount<=0)continue;
    donor.minerals-=amount;s.minerals+=amount;s.politics.defenseReadiness=clamp(s.politics.defenseReadiness+.1,0,1);
    if(!c.supportedBy.includes(id)){
      c.supportedBy.push(id);event(w,'diplomacy','Союзная помощь',`${donor.name} передало ${metric(amount)} единиц материалов обществу ${s.name}; оборонная готовность выросла.`,s.id,[why('Передано материалов',amount),why('Готовность обороны',s.politics.defenseReadiness)],false,[r.treaty.eventId,c.originEventId],[id]);
    }
  }
}
function tick(w) {
  if(w.year>=LIMITS.years)throw new Error('Достигнут предел этой модели — 10 000 лет.');
  w.year++;w.geography.movements=[];const before=totalPopulation(w);w.ledger={births:0,deaths:0,totalBefore:before,totalAfter:before};
  const ss=[...w.societies].sort((a,b)=>a.id.localeCompare(b.id));
  w.climate.pollution=clamp(w.climate.pollution*.996+sum(ss,s=>s.population*Math.max(0,s.tech[1]-1.2))*1e-8,0,12);
  w.climate.warming+=(w.climate.pollution*.7-w.climate.warming)*.008;
  for(const r of w.regions){const pressure=r.population/30000;const seasonal=.09*Math.sin(w.year*.13+r.lat);r.water=clamp(r.water+(.65-.002*Math.abs(r.lat)-.016*w.climate.warming-r.water)*.03+seasonal*.07,.08,.98);r.biomass=clamp(r.biomass+r.biomass*(1-r.biomass)*.06-pressure*.006-.002*w.climate.warming,.08,1);r.stress=clamp((.5-r.water)*1.3+(.5-r.biomass),0,1);
    if(ryear(w,r.id,'disaster')<.0008&&w.year>r.disasterUntil){r.disasterUntil=w.year+3+Math.floor(ryear(w,r.id,'duration')*5);const e=event(w,'climate','Региональная засуха',`Урожайность региона ${r.id} снижена до ${r.disasterUntil} года.`,r.owner,[why('Водообеспеченность',r.water),why('Длительность',r.disasterUntil-w.year)],false);r.disasterEventId=e.id;}
  }
  // Economy uses an explicit food stock and bounded ore reserves. Numerical units are abstract.
  for(const s of ss){const land=w.regions.filter(r=>r.owner===s.id),pop=s.population;if(!pop)continue;const policy=s.politics.policy,agriculture=agricultureMultiplier(s);s.capacity=sum(land,r=>Geography.regionalCapacity(w,r))*agriculture;s.production=Math.max(0,Math.min(s.capacity,pop*(1.08+.18*s.tech[0])*agriculture));s.food=Math.min(pop*6,s.food*.94+s.production);
    let work=pop*.00035*(.3+s.tech[1]);for(const r of land){const mined=Math.min(r.reserves,work/Math.max(1,land.length));r.reserves-=mined;s.minerals+=mined;}s.minerals=Math.min(s.minerals,1e7);const defenseBudget=policy==='security'?Math.min(s.minerals,pop*.00008):0;s.minerals-=defenseBudget;s.politics.defenseReadiness=clamp(defenseBudget/Math.max(.001,pop*.00008)*.8+s.politics.institutionalMemory*.1,0,1);
  }
  // Trade transfers are real quantities: seller loses exactly what buyer receives.
  // Land routes are annual aggregated flows, not a simulated ship/freight network.
  diplomacy(w,ss);
  for(const s of ss){if(!s.population)continue;const pop=s.population;s.supply=Math.min(1,s.food/pop);s.food=Math.max(0,s.food-pop);const deaths=rounded(w,pop*(.012+.11*(1-s.supply)+Math.max(0,.2-s.stability)*.025),s.id,'deaths'),births=rounded(w,pop*.023*s.supply*clamp(s.capacity/(pop*1.2),0,1),s.id,'births');s.population=pop+births-Math.min(pop,deaths);w.ledger.births+=births;w.ledger.deaths+=Math.min(pop,deaths);
    s.stability=clamp(s.stability+((s.supply-.9)*.04)+(ryear(w,s.id,'politics')-.5)*.009-.002*w.wars.filter(c=>c.active&&[c.a,c.b].includes(s.id)).length,.03,.97);
    s.unrestYears=s.stability<.27?s.unrestYears+1:Math.max(0,s.unrestYears-1);
    if(s.supply<.88&&!recent(w,s,'food',11)){
      const disasters=w.regions.filter(r=>r.owner===s.id&&r.disasterUntil>=w.year).map(r=>r.disasterEventId).filter(Boolean);
      remember(s,'food',event(w,'economy','Недостаток продовольствия',`${s.name}: запасов хватило на ${Math.round(s.supply*100)}% годовой потребности.`,s.id,[why('Производство',s.production),why('Потребность',pop),why('Устойчивость',s.stability)],true,[...disasters,(s.politics.policy==='research'||s.politics.policy==='security')?recent(w,s,'policy',30):null]));
    }
    politics(w,s);
    const priorities={food:[1.2,.9,.75,1],trade:[.95,1.15,.95,1],research:[.9,.95,1.5,1.15],security:[.9,1.1,.8,.85]}[s.politics.policy];
    for(let i=0;i<4;i++){const old=Math.floor(s.tech[i]);const cost=Math.min(s.minerals,Math.max(.02,s.population*.00003));s.minerals-=cost;const inc=(.0005+.0016*s.stability)*s.supply*(.65+.35*s.leader.skill)*(cost>0?1:.4)/(1+s.tech[i]*.12)*priorities[i]*(.75+.4*s.politics.institutionalMemory);s.tech[i]=Math.min(6,s.tech[i]+inc*(i===2?1.08:1));if(Math.floor(s.tech[i])>old)event(w,'science','Новая технологическая ступень',`${s.name}: ${TECH_NAMES[i].toLowerCase()} — ступень ${Math.floor(s.tech[i])}.`,s.id,[why('Обеспеченность',s.supply),why('Устойчивость',s.stability),why('Приоритет отрасли',priorities[i]),why('Институциональная память',s.politics.institutionalMemory)],true,[recent(w,s,'policy',150)]);}
    s.divergence+=.00015*(1-s.stability*.5);
  }
  Geography.syncRegionalPopulations(w);
  // Migration is evaluated every ten model years, independent of UI frame rate.
  // Every actual transfer is attached to its exact regional path in the chronicle.
  if(w.year%10===0)migrateRegions(w,ss);
  for(const rel of w.relations){const a=ss.find(s=>s.id===rel.a),b=ss.find(s=>s.id===rel.b);if(!a||!b||a.population<1000||b.population<1000||['alliance','truce'].includes(rel.treaty?.kind))continue;const alliances=w.relations.filter(r=>r.treaty?.kind==='alliance'&&[r.a,r.b].some(id=>id===a.id||id===b.id)).length,pressure=1+(1-Math.min(a.supply,b.supply))*.6;if(rel.trust<.17&&ryear(w,rel.a,rel.b,'war')<.018*pressure/(1+alliances*.6)&&!w.wars.some(c=>c.active&&[c.a,c.b].some(id=>id===a.id||id===b.id))){const id='war'+w.nextEntity++;const e=event(w,'conflict','Начало конфликта',`${a.name} и ${b.name} вступили в конфликт.`,a.id,[why('Взаимное доверие',rel.trust),why('Обеспеченность',Math.min(a.supply,b.supply)),why('Сдерживающие союзы',alliances)],true,[recent(w,a,'food',30),recent(w,b,'food',30)],[b.id]);w.wars.push({id,a:a.id,b:b.id,start:w.year,active:true,losses:0,originEventId:e.id,supportedBy:[]});remember(a,'war',e);remember(b,'war',e);}}
  resolveWars(w);
  secede(w,ss);
  space(w);
  Archive.archiveCompletedMissions(w);
  Geography.syncRegionalPopulations(w);
  Geography.updateSettlements(w);
  for(const s of w.societies)if(sum(w.regions.filter(r=>r.owner===s.id),r=>r.population)!==s.population)throw new Error('Нарушен баланс регионов. Шаг отменён.');
  w.ledger.totalAfter=totalPopulation(w);
  if(w.ledger.totalAfter!==before+w.ledger.births-w.ledger.deaths)throw new Error('Нарушен баланс населения. Шаг отменён.');
  if(w.year%25===0)w.snapshots=Archive.retainSnapshots([...w.snapshots,snapshot(w)],{limit:LIMITS.snapshots,recent:16});
  if(w.year%10===0)w.history.push(summary(w));
}

function recordMovement(w,from,to,n,path,kind,causes=[]){
  const actual=Geography.movePopulation(w,from.id,to.id,n,{kind,path});if(!actual)return 0;
  const movement=clone(w.geography.movements.find(m=>m.year===w.year&&m.from===from.id&&m.to===to.id&&m.kind===kind));movement.people=actual;
  const source=w.societies.find(s=>s.id===movement.fromOwner),target=w.societies.find(s=>s.id===movement.toOwner);
  const e=event(w,'migration',kind==='internal'?'Переселение внутри общества':'Переселение',
    `${actual} жителей: ${from.settlement.name} → ${to.settlement.name}. ${kind==='internal'?source.name:source.name+' → '+target.name}. Путь: ${Math.round(path.distance)} условных км.`,
    source.id,[why('Переселенцы',actual),why('Расстояние, условные км',path.distance),why('Стоимость пути, условные дни',path.cost),why('Регион отправления',from.id),why('Регион прибытия',to.id)],false,causes,[target.id],{movement});
  // Only immigration creates this political pressure. Internal moves and
  // emigration remain recorded, but cannot replace the pressure's real cause.
  if(source.id!==target.id){target.politics.migrationPressure=clamp(target.politics.migrationPressure+actual/Math.max(1,target.population)*4,0,1);remember(target,'migration',e);}
  return actual;
}
function migrateRegions(w,ss){
  for(const s of ss){
    if(s.population<100)continue;
    const land=w.regions.filter(r=>r.owner===s.id),sources=land.filter(r=>r.population>50).sort((a,b)=>Geography.regionAttractiveness(w,a)-Geography.regionAttractiveness(w,b)||a.id.localeCompare(b.id));
    const from=sources[0];if(!from)continue;
    const destinations=land.filter(r=>r.id!==from.id&&Geography.regionalCapacity(w,r)>r.population*1.03).sort((a,b)=>Geography.regionAttractiveness(w,b)-Geography.regionAttractiveness(w,a)||a.id.localeCompare(b.id));
    for(const to of destinations){
      if(Geography.regionAttractiveness(w,to)-Geography.regionAttractiveness(w,from)<.07)break;
      const path=Geography.routeBetweenRegions(w,from.id,to.id,{societyId:s.id,allowForeign:false});if(!path)continue;
      const n=Math.min(Math.floor(from.population*.025),Math.floor((Geography.regionalCapacity(w,to)-to.population)*.06));
      recordMovement(w,from,to,n,path,'internal',from.disasterUntil>=w.year?[from.disasterEventId]:[]);break;
    }
    if(s.supply>.87||s.population<500)continue;
    const origin=w.regions.filter(r=>r.owner===s.id&&r.population>50).sort((a,b)=>Geography.regionAttractiveness(w,a)-Geography.regionAttractiveness(w,b)||b.population-a.population||a.id.localeCompare(b.id))[0];
    if(!origin)continue;
    const candidates=[];
    for(const to of w.regions){if(to.owner===s.id)continue;const target=w.societies.find(t=>t.id===to.owner);if(!target||target.supply<.95||Geography.regionalCapacity(w,to)<=to.population*1.05)continue;
      const path=Geography.routeBetweenRegions(w,origin.id,to.id,{societyId:s.id,allowForeign:true});if(path)candidates.push({to,path,score:Geography.regionAttractiveness(w,to)-path.cost*.0008});
    }
    candidates.sort((a,b)=>b.score-a.score||a.path.cost-b.path.cost||a.to.id.localeCompare(b.to.id));
    const destination=candidates[0];if(!destination)continue;
    const n=Math.min(Math.floor(origin.population*.06),Math.floor((Geography.regionalCapacity(w,destination.to)-destination.to.population)*.08),Math.floor(s.population*.03));
    recordMovement(w,origin,destination.to,n,destination.path,'migration',[recent(w,s,'food',25)]);
  }
}
function resolveWars(w){
  for(const c of w.wars.filter(c=>c.active)){
    const a=w.societies.find(s=>s.id===c.a),b=w.societies.find(s=>s.id===c.b);
    for(const s of [a,b]){alliedSupport(w,c,s);const loss=Math.min(s.population,Math.floor(s.population*(.001+.004*ryear(w,c.id,s.id,'casualties'))*(1-.3*s.politics.defenseReadiness)));s.population-=loss;c.losses+=loss;w.ledger.deaths+=loss;s.food=Math.max(0,s.food-s.population*.03);}
    Geography.syncRegionalPopulations(w);
    if(w.year-c.start<5||!(ryear(w,c.id,'peace')<.16||w.year-c.start>20))continue;
    c.active=false;const winner=a.population*(.5+a.tech[1])*a.supply>b.population*(.5+b.tech[1])*b.supply?a:b,loser=winner===a?b:a,capital=w.regions.find(r=>r.id===winner.capitalId);
    const land=w.regions.filter(r=>r.owner===loser.id&&r.id!==loser.capitalId).sort((x,y)=>distance(x,capital)-distance(y,capital)||x.id.localeCompare(y.id));let acquired=null,transferred=0;
    for(const r of land){const oldPopulation=loser.population,n=r.population,ratio=n/Math.max(1,oldPopulation),food=loser.food*ratio,minerals=loser.minerals*ratio;
      if(Geography.transferRegion(w,r.id,winner.id)){loser.food-=food;winner.food+=food;loser.minerals-=minerals;winner.minerals+=minerals;acquired=r;transferred=n;break;}
    }
    const rel=w.relations.find(r=>[r.a,r.b].includes(a.id)&&[r.a,r.b].includes(b.id));
    const e=event(w,'conflict','Мирное соглашение',`${a.name} и ${b.name} завершили конфликт. Потери: ${c.losses} жителей. ${acquired?'Пограничный регион '+acquired.settlement.name+' перешёл к '+winner.name+'.':'Границы не изменились.'} На 20 лет установлен мирный договор.`,winner.id,[why('Продолжительность',w.year-c.start),why('Потери',c.losses),why('Переданные жители',transferred)],true,[c.originEventId],[loser.id],acquired?{regionIds:[acquired.id]}:{});
    if(rel){rel.trust=.35;rel.treaty={kind:'truce',since:w.year,eventId:e.id};rel.lastTreatyYear=w.year;rel.lastEventId=e.id;}
  }
}
function secede(w,ss){
  if(w.societies.length>=LIMITS.societies)return;
  for(const s of ss){const land=w.regions.filter(r=>r.owner===s.id);if(s.unrestYears<15||land.length<6||s.population<15000)continue;
    const chosenIds=Geography.connectedSecession(w,s.id),chosen=chosenIds.map(id=>w.regions.find(r=>r.id===id));if(chosen.length<2)continue;
    const n=sum(chosen,r=>r.population);if(!n)continue;const ratio=n/s.population,id='s'+w.nextEntity++,t=society(w,id,w.societies.length,n,s.tech);
    t.parentId=s.id;t.foundingYear=w.year;t.food=s.food*ratio;t.minerals=s.minerals*ratio;t.capitalId=[...chosen].sort((a,b)=>b.population-a.population||a.id.localeCompare(b.id))[0].id;t.language=s.language;t.divergence=s.divergence+.04;t.politics.institutionalMemory=s.politics.institutionalMemory*.7;
    s.population-=n;s.food-=t.food;s.minerals-=t.minerals;s.unrestYears=0;chosen.forEach(r=>r.owner=id);for(const o of w.societies)w.relations.push(relation(o.id,id,o.id===s.id?.2:.5));w.societies.push(t);
    const e=event(w,'politics','Возникло новое государство',`${t.name} отделилось от ${s.name} как связная область из ${chosen.length} регионов; часть институтов предшественника сохранена.`,id,[why('Предшественник',s.id),why('Перешедшие жители',n),why('Регионы',chosen.length),why('Унаследованная институциональная память',t.politics.institutionalMemory)],true,[recent(w,s,'crisis',100),recent(w,s,'food',40)],[s.id],{regionIds:chosenIds});remember(t,'founding',e);break;
  }
}

function space(w){
  const home=w.planets.find(p=>p.home);
  for(const m of w.missions){if(m.status!=='transit'||w.year<m.arrival)continue;m.status='arrived';const s=w.societies.find(s=>s.id===m.owner);if(m.kind==='probe'){if(!s.probed.includes(m.target))s.probed.push(m.target);event(w,'space','Зонд достиг цели',`${m.name}: получены данные о ${w.planets.find(p=>p.id===m.target).name}.`,s.id,[why('Год отправления',m.departure),why('Путь, лет',m.arrival-m.departure)],true);}else {const c={id:'c'+w.nextEntity++,name:m.name,planet:m.target,parent:s.id,population:m.people,food:m.people*3,capacity:m.people*1.4,autonomy:0,independent:false,founded:w.year,losses:0};w.colonies.push(c);event(w,'space','Основано внеземное поселение',`${c.name}: ${c.population} переселенцев.`,s.id,[why('Отправление',m.departure),why('Прибытие',m.arrival),why('Расход материалов',m.cost)],true);}}
  for(const c of w.colonies){if(!c.population)continue;const s=w.societies.find(s=>s.id===c.parent),p=w.planets.find(p=>p.id===c.planet);const autonomousOutput=c.population*clamp(.42+(s.tech[0]-2)*.15,.2,1.3);c.food=Math.min(c.population*6,c.food*.98+autonomousOutput);
    // Supply dispatch is a travelling freight mission, not instant interplanetary trade.
    if(!c.independent&&c.food<c.population*3&&s.food>s.population*1.8&&!w.missions.some(m=>m.kind==='supply'&&m.target===c.id&&m.status==='transit')&&w.missions.length<LIMITS.missions){const cargo=Math.min(s.food-s.population*1.8,c.population*4);s.food-=cargo;w.missions.push({id:'m'+w.nextEntity++,name:'Снабжение '+c.name,owner:s.id,target:c.id,kind:'supply',people:0,cargo,cost:0,departure:w.year,arrival:w.year+Math.max(1,Math.ceil(Math.abs(p.a-home.a)*2)),status:'transit'});}
    const supply=Math.min(1,c.food/c.population);c.food=Math.max(0,c.food-c.population);const deaths=Math.min(c.population,Math.floor(c.population*(.009+.1*(1-supply)))),headroom=Math.max(0,Math.floor(c.capacity)-c.population+deaths),births=Math.min(headroom,Math.floor(c.population*.024*supply*clamp(c.capacity/c.population-.5,0,1)));c.population+=births-deaths;c.losses+=deaths;w.ledger.births+=births;w.ledger.deaths+=deaths;
    // Conditional game capacity scales with planet size; this is not a physical ecology forecast.
    // Annual births and six-year food reserves are finite, rather than exponential forever.
    c.capacity=Math.min(250000*p.radius*p.radius,c.capacity+Math.max(0,autonomousOutput*.008));c.autonomy=clamp(c.autonomy+.0015+Math.abs(p.a-home.a)*.0003,0,1);
    if(c.autonomy>.75&&!c.independent&&autonomousOutput>=c.population){c.independent=true;event(w,'politics','Колония получила самостоятельность',`${c.name} больше не зависит от регулярного продовольственного снабжения.`,c.parent,[why('Самообеспечение',autonomousOutput/Math.max(1,c.population)),why('Возраст поселения',w.year-c.founded)],true);}
  }
  for(const s of w.societies){if(s.population<10000||s.supply<.97||w.year-s.lastLaunch<30||s.tech[1]<2.6||s.tech[2]<2.4)continue;if(!s.satellite&&s.minerals>=25){s.minerals-=25;s.satellite=true;s.lastLaunch=w.year;event(w,'space','Первый искусственный спутник',`${s.name} вышло на орбиту родного мира.`,s.id,[why('Производство',s.tech[1]),why('Исследования',s.tech[2]),why('Материалы списаны',25)],true);continue;}if(!s.satellite||w.missions.length>=LIMITS.missions)continue;
    const target=w.planets.filter(p=>!p.home&&p.kind!=='gas').sort((a,b)=>Math.abs(a.a-home.a)-Math.abs(b.a-home.a)).find(p=>!w.missions.some(m=>m.owner===s.id&&m.target===p.id&&m.kind==='colony')&&(!s.probed.includes(p.id)||!w.colonies.some(c=>c.parent===s.id&&c.planet===p.id)));
    if(!target)continue;const probed=s.probed.includes(target.id);if(w.missions.some(m=>m.owner===s.id&&m.target===target.id&&m.status==='transit'))continue;
    const kind=probed?'colony':'probe',cost=probed?90:15;if(s.minerals<cost)continue;if(probed&&(s.tech[1]<3.6||s.tech[2]<3.1||w.colonies.length+w.missions.filter(m=>m.kind==='colony'&&m.status==='transit').length>=LIMITS.colonies||s.food<s.population*1.5))continue;
    const originRegion=w.regions.filter(r=>r.owner===s.id).sort((a,b)=>b.population-a.population||a.id.localeCompare(b.id))[0];const people=probed?Math.min(300,originRegion.population):0;if(probed&&people<50)continue;s.minerals-=cost;s.population-=people;originRegion.population-=people;s.food=Math.max(0,s.food-people*3);s.lastLaunch=w.year;const duration=Math.max(1,Math.ceil(2*Math.abs(target.a-home.a)/Math.max(.5,s.tech[1]*.3)));const m={id:'m'+w.nextEntity++,name:probed?'Поселение '+name(w.seed,'colony'+w.nextEntity):'Зонд '+name(w.seed,'probe'+w.nextEntity),owner:s.id,target:target.id,originRegion:originRegion.id,kind,people,cargo:0,cost,departure:w.year,arrival:w.year+duration,status:'transit'};w.missions.push(m);event(w,'space',probed?'Отправлены переселенцы':'Начало межпланетной экспедиции',`${s.name} → ${target.name}. Расчётное прибытие: ${m.arrival} год.`,s.id,[why('Участники',people),why('Материалы списаны',cost),why('В пути, лет',duration)],true);
  }
}
// Freight has a separate arrival phase. A supply cargo never creates a settlement.
function deliverSupplies(w){for(const m of w.missions){if(m.kind==='supply'&&m.status==='transit'&&m.arrival<=w.year+1){const c=w.colonies.find(c=>c.id===m.target);if(c)c.food+=m.cargo;m.status='arrived';}}}
export function advance(world,years=1,options={}) {
  if(!Number.isSafeInteger(years)||years<0||years>1000)throw new Error('Один запрос: от 0 до 1000 лет.');
  validateWorld(world);const w=clone(world),startEvent=w.nextEvent;let advanced=0;
  for(let i=0;i<years&&w.year<LIMITS.years;i++){const first=w.nextEvent;deliverSupplies(w);tick(w);advanced++;if(options.stopOnImportant){let important=false;for(let n=first;n<w.nextEvent;n++)if(Archive.eventById(w,'e'+n)?.important){important=true;break;}if(important)break;}}
  validateWorld(w);return {world:w,advanced,newEvents:Archive.eventsAfter(w,startEvent-1),stopped:advanced<years};
}
export function validateWorld(w,{checkSnapshots=true}={}){
  const fail=s=>{throw new Error('Некорректный мир: '+s);};
  if(!w||w.schema!==SCHEMA||w.modelVersion!==MODEL_VERSION)fail('неподдерживаемая версия; сохранения прежнего сайта требуют отдельной миграции.');
  if(typeof w.seed!=='string'||!w.seed||w.seed.length>128||typeof w.id!=='string'||w.id.length>128||typeof w.name!=='string'||w.name.length>128)fail('идентичность');
  if(!['agriculture','industrial','space'].includes(w.era))fail('эпоха');
  if(!Number.isSafeInteger(w.year)||w.year<0||w.year>LIMITS.years)fail('год');
  Archive.validateArchive(w);
  const events=allEvents(w),missions=allMissions(w);
  const spec={planets:[4,12],regions:[1,90],societies:[1,LIMITS.societies],missions:[0,LIMITS.missions],colonies:[0,LIMITS.colonies],events:[0,LIMITS.events],snapshots:[1,LIMITS.snapshots],wars:[0,3000],relations:[0,200],history:[1,1100]};
  for(const [k,[lo,hi]]of Object.entries(spec))if(!Array.isArray(w[k])||w[k].length<lo||w[k].length>hi)fail(k);
  let nodes=0;const walk=(v,d=0)=>{if(++nodes>2000000||d>24)fail('слишком сложный файл');if(typeof v==='number'&&!Number.isFinite(v))fail('нечисловое значение');if(typeof v==='string'&&v.length>3000)fail('слишком длинный текст');if(v&&typeof v==='object')for(const [k,x]of Object.entries(v)){if(['__proto__','prototype','constructor'].includes(k))fail('служебный ключ');walk(x,d+1);}};walk(w);
  const ids=(xs,k)=>{const set=new Set();for(const x of xs){if(!x||typeof x.id!=='string'||x.id.length>128||set.has(x.id))fail('дубликат/ошибка '+k);set.add(x.id);}return set;};
  const pids=ids(w.planets,'планеты'),sids=ids(w.societies,'общества'),rids=ids(w.regions,'регионы'),cids=ids(w.colonies,'колонии'),eids=ids(events,'события'),eventById=new Map(events.map(e=>[e.id,e]));ids(missions,'экспедиции');ids(w.wars,'войны');
  const positive=(x,name,max=1e12)=>{if(typeof x!=='number'||!Number.isFinite(x)||x<0||x>max)fail(name);};const population=(x)=>{positive(x,'население');if(!Number.isSafeInteger(x))fail('дробное население');};const unit=(x,name)=>{positive(x,name,1);};
  if(!w.star||!w.climate||!w.ledger)fail('среда/учёт');positive(w.star.mass,'масса звезды',10);positive(w.star.luminosity,'светимость',100);if(w.star.mass===0||w.star.luminosity===0)fail('звезда');positive(w.climate.warming,'потепление',20);positive(w.climate.pollution,'загрязнение',20);
  for(const k of ['nextEvent','nextEntity'])if(!Number.isSafeInteger(w[k])||w[k]<1)fail(k);
  if(w.planets.filter(p=>p.home).length!==1)fail('родная планета');
  for(const p of w.planets){if(!['terrestrial','rock','ice','gas'].includes(p.kind)||typeof p.name!=='string')fail('планета');positive(p.a,'орбита',10000);positive(p.radius,'радиус',100);positive(p.period,'период',1000000);if(p.a===0||p.radius===0||p.period===0)fail('нулевая орбита/размер');}
  for(const s of w.societies){population(s.population);for(const k of ['food','minerals','capacity','production'])positive(s[k],k);unit(s.stability,'устойчивость');unit(s.supply,'обеспеченность');if(!Array.isArray(s.tech)||s.tech.length!==4)fail('технологии');s.tech.forEach(v=>positive(v,'технология',6));if(!rids.has(s.capitalId)||!s.leader||!Array.isArray(s.probed)||s.probed.some(id=>!pids.has(id))||typeof s.name!=='string'||typeof s.color!=='string'||!/^#[0-9a-f]{6}$/i.test(s.color))fail('общество');}
  const time=(v,label,min=0,max=w.year)=>{if(!Number.isSafeInteger(v)||v<min||v>max)fail(label);};
  const optionalEvent=(id,label)=>{if(id!==null&&id!==undefined&&!eids.has(id))fail(label);};
  for(const s of w.societies){
    if(w.regions.find(r=>r.id===s.capitalId)?.owner!==s.id)fail('столица вне своей территории');
    if(!GOVERNMENTS.includes(s.government))fail('форма правления');
    unit(s.leader.skill,'способности руководителя');time(s.leader.age,'возраст руководителя',0,150);time(s.leader.index,'номер руководителя',0,10000);
    const p=s.politics;if(!p||!FACTIONS.some(f=>f.id===p.rulingFaction)||!Object.hasOwn(POLICIES,p.policy))fail('политические институты');
    for(const k of ['legitimacy','institutionalMemory','migrationPressure','defenseReadiness'])unit(p[k],k);
    time(p.since,'начало полномочий');time(p.nextReview,'следующий пересмотр',0,LIMITS.years+12);time(p.lastPolicyChange,'смена курса');time(p.hungerYears,'годы дефицита',0,LIMITS.years);time(p.recoveryYears,'восстановление',0,3);if(p.crisisSince!==null)time(p.crisisSince,'начало кризиса');
    if(!Array.isArray(p.factions)||p.factions.length!==FACTIONS.length||new Set(p.factions.map(f=>f.id)).size!==FACTIONS.length)fail('группы влияния');
    for(const f of p.factions){if(!FACTIONS.some(a=>a.id===f.id))fail('группа влияния');unit(f.influence,'влияние');unit(f.support,'поддержка');}
    if(Math.abs(sum(p.factions,f=>f.influence)-1)>1e-8)fail('сумма политического влияния');
    if(!p.events||typeof p.events!=='object'||Array.isArray(p.events)||Object.keys(p.events).length>16)fail('память институтов');
    for(const e of Object.values(p.events)){if(!e||!eids.has(e.id))fail('ссылка памяти институтов');time(e.year,'год памяти институтов');const actual=eventById.get(e.id);if(actual.year!==e.year||!Array.isArray(actual.entityIds)||!actual.entityIds.includes(s.id))fail('причина памяти институтов');}
  }
  for(const r of w.regions){if(!sids.has(r.owner)||typeof r.lat!=='number'||Math.abs(r.lat)>90||typeof r.lon!=='number'||Math.abs(r.lon)>180)fail('регион');positive(r.reserves,'руда');unit(r.water,'вода');unit(r.biomass,'биомасса');unit(r.fertility,'плодородие');optionalEvent(r.disasterEventId,'история засухи');}
  for(const m of missions){if(!sids.has(m.owner)||!['transit','arrived'].includes(m.status)||!['probe','colony','supply'].includes(m.kind))fail('экспедиция');if(!(m.kind==='supply'?cids:pids).has(m.target))fail('цель экспедиции');if(m.kind!=='supply'&&!rids.has(m.originRegion))fail('регион отправления экспедиции');population(m.people);if(m.kind!=='colony'&&m.people!==0)fail('пассажиры беспилотной миссии');positive(m.cargo,'груз');positive(m.cost,'стоимость миссии');if(!Number.isSafeInteger(m.departure)||!Number.isSafeInteger(m.arrival)||m.arrival<=m.departure||m.departure>w.year||(m.status==='arrived'&&m.arrival>w.year)||(m.status==='transit'&&m.arrival<=w.year))fail('время экспедиции');}
  for(const c of w.colonies){population(c.population);positive(c.food,'еда колонии');positive(c.capacity,'ёмкость колонии');unit(c.autonomy,'автономия');if(!pids.has(c.planet)||!sids.has(c.parent))fail('колония');}
  const pairs=new Set();for(const r of w.relations){if(!sids.has(r.a)||!sids.has(r.b)||r.a===r.b)fail('отношения');const pair=[r.a,r.b].sort().join(':');if(pairs.has(pair))fail('повтор отношений');pairs.add(pair);unit(r.trust,'доверие');positive(r.trade,'торговля');unit(r.dependencyA,'зависимость A');unit(r.dependencyB,'зависимость B');time(r.lastTreatyYear,'год договора',-40);time(r.lastTradeYear,'год поставок',-40);time(r.tradeYears,'стаж поставок',0,LIMITS.years);optionalEvent(r.lastEventId,'ссылка договора');optionalEvent(r.lastTradeEventId,'ссылка поставок');if(r.treaty!==null){if(!r.treaty||!['trade','alliance','truce'].includes(r.treaty.kind)||!eids.has(r.treaty.eventId))fail('договор');time(r.treaty.since,'начало договора');}}
  for(const c of w.wars){if(!sids.has(c.a)||!sids.has(c.b)||c.a===c.b)fail('конфликт');optionalEvent(c.originEventId,'причина войны');if(c.supportedBy!==undefined&&(!Array.isArray(c.supportedBy)||c.supportedBy.length>LIMITS.societies||c.supportedBy.some(id=>!sids.has(id))))fail('союзники');}
  let y=-1;const seen=new Set();for(const e of events){if(!Number.isSafeInteger(e.year)||e.year<y||e.year>w.year||typeof e.title!=='string'||typeof e.detail!=='string'||!Array.isArray(e.causes)||e.causes.length>12||!Array.isArray(e.entityIds)||e.entityIds.length>LIMITS.societies||e.entityIds.some(id=>!sids.has(id))||(e.entityId!==null&&!sids.has(e.entityId))||!Array.isArray(e.causeEventIds)||e.causeEventIds.length>4||new Set(e.causeEventIds).size!==e.causeEventIds.length||e.causeEventIds.some(id=>!seen.has(id)))fail('хроника или причинная связь');
    if(e.regionIds!==undefined&&(!Array.isArray(e.regionIds)||e.regionIds.length>w.regions.length||new Set(e.regionIds).size!==e.regionIds.length||e.regionIds.some(id=>!rids.has(id))))fail('регионы события');
    if(e.type==='migration'&&!e.movement)fail('переселение без маршрута');
    if(e.movement!==undefined){Geography.validateMovement(w,e.movement);if(e.type!=='migration'||e.year!==e.movement.year||e.entityId!==e.movement.fromOwner||![e.movement.fromOwner,e.movement.toOwner].every(id=>e.entityIds.includes(id)))fail('связь события с переселением');}
    y=e.year;seen.add(e.id);
  }
  let previousYear=-1;for(const s of w.snapshots){if(!Number.isSafeInteger(s.year)||s.year> w.year||s.year<=previousYear||!Array.isArray(s.societies)||!Array.isArray(s.regions))fail('контрольная точка');previousYear=s.year;if(checkSnapshots){const archive={...w,...s,...Archive.archiveThroughYear(w,s.year),history:w.history.filter(h=>h.year<=s.year),snapshots:[{year:s.year,societies:[],regions:[]}]};validateWorld(archive,{checkSnapshots:false});}}
  if(events.some(e=>e.id==='e'+w.nextEvent))fail('счётчик событий');
  Geography.validateGeography(w);
  return true;
}
