/** MICROGALAXY: independent local candidate. All quantities are game-model units.
 * One deterministic annual step; camera, frame rate, wall clock and UI never enter it.
 * This is NOT the source of the deployed 0.1/0.2 application.
 */
export const MODEL_VERSION = '0.3-local.1';
export const SCHEMA = 'microgalaxy.local/1';
export const LIMITS = Object.freeze({years:10000, societies:16, missions:160, colonies:24, events:16000, snapshots:64});
export const COLORS = ['#eab66a','#6db7c5','#c384b1','#93b981','#ac9bd2','#cd8b70','#70b7a1','#e2cc82','#7f9dc6','#b3bf7b','#d39fa2','#77b1cf','#b7a688','#aab9c7','#9d8cbf','#d79d65'];
export const GOVERNMENTS = ['Совет общин','Наследственная власть','Союз городов','Федерация'];
export const TECH_NAMES = ['Земледелие','Производство','Исследования','Институты'];
export const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
export const clone = v => structuredClone(v);
export function hash(s) { let h=2166136261; for (const c of String(s)) {h^=c.charCodeAt(0); h=Math.imul(h,16777619);} return h>>>0; }
export function rand(seed,...keys) { let x=hash(JSON.stringify([seed,...keys])); x^=x>>>16; x=Math.imul(x,0x7feb352d); x^=x>>>15; x=Math.imul(x,0x846ca68b); x^=x>>>16; return (x>>>0)/4294967296; }
const rr = (w,...k) => rand(w.seed,...k);
const ryear = (w,...k) => rr(w,w.year,...k);
const rounded = (w,v,...k) => Math.floor(v)+(ryear(w,...k)<v-Math.floor(v)?1:0);
const sum = (a,f) => a.reduce((n,x)=>n+f(x),0);
const metric = n => Math.round(n*1000)/1000;
function name(seed,key) {const a=['Ар','Ве','Ил','Ка','Ли','Ме','Но','Ор','Ре','Са','Та','Эл']; const b=['ден','лан','мир','нар','рион','сар','тес','вар','вен'];return a[Math.floor(rand(seed,key,'a')*a.length)]+b[Math.floor(rand(seed,key,'b')*b.length)];}
export function terrain(seed,lon,lat) {const q=rand(seed,'terrain')*6.28, x=lon*Math.PI/180,y=lat*Math.PI/180;return Math.sin(x*2+q+Math.sin(y*3))*.46+Math.cos(x*3-y*2+q)*.25+Math.sin(x*5+y*4)*.13+Math.cos(x*11-y*8+q)*.07-Math.abs(lat)/310;}
export function distance(a,b) { const p=Math.PI/180;return Math.acos(clamp(Math.sin(a.lat*p)*Math.sin(b.lat*p)+Math.cos(a.lat*p)*Math.cos(b.lat*p)*Math.cos((a.lon-b.lon)*p),-1,1)); }
function event(w,type,title,detail,entityId=null,causes=[],important=false) {if(w.events.length>=LIMITS.events) throw new Error('Архив событий заполнен. Экспортируйте мир; новые события не отброшены.');const e={id:`e${w.nextEvent++}`,year:w.year,type,title,detail,entityId,causes:clone(causes),important};w.events.push(e);return e;}
const why = (label,value) => ({label,value:typeof value==='number'?metric(value):String(value)});
function leader(w,s,index=0) {return {name:name(w.seed,`${s.id}:leader:${index}`),index,age:32+Math.floor(rr(w,s.id,index,'age')*19),skill:.3+rr(w,s.id,index,'skill')*.7};}
function society(w,id,idx,pop,tech) {let s={id,name:name(w.seed,id),color:COLORS[idx],population:pop,food:pop*1.7,minerals:40,tech:tech.slice(),stability:.62+rr(w,id,'stability')*.25,government:GOVERNMENTS[Math.floor(rr(w,id,'government')*3)],leader:null,language:name(w.seed,id+'lang'),divergence:0,parentId:null,foundingYear:0,unrestYears:0,lastReform:-40,supply:1,production:0,capacity:0,satellite:false,probed:[],lastLaunch:-50};s.leader=leader(w,s);return s;}
export function createWorld(seed='MICROGALAXY', options={}) {
  if(typeof seed!=='string'||!seed.trim()||seed.length>128) throw new Error('Код мира должен содержать 1–128 символов.');
  const era=options.era??'agriculture';if(!['agriculture','industrial','space'].includes(era))throw new Error('Неизвестная начальная эпоха.');
  const count=4+Math.floor(rand(seed,'societies')*3),mass=.75+rand(seed,'mass')*.5,luminosity=mass**3.5;
  const w={schema:SCHEMA,modelVersion:MODEL_VERSION,id:'w-'+hash(seed+era).toString(16),seed,era,name:name(seed,'star')+' · '+String(hash(seed)%1000).padStart(3,'0'),year:0,nextEvent:1,nextEntity:100,star:{mass,luminosity,temperature:4800+mass*900,age:2+rand(seed,'age')*4},planets:[],regions:[],societies:[],relations:[],wars:[],missions:[],colonies:[],events:[],history:[],snapshots:[],climate:{warming:0,pollution:0},ledger:{births:0,deaths:0,totalBefore:0,totalAfter:0},archivalCoverage:'0 + последние 63 контрольные точки; показатели — каждые 10 лет'};
  const np=5+Math.floor(rand(seed,'nplanets')*4);
  for(let i=0;i<np;i++){const a=Math.sqrt(luminosity)*(.35*1.69**i),kind=i===2?'terrestrial':i>4?'gas':rand(seed,i,'type')>.5?'rock':'ice';w.planets.push({id:'p'+i,name:name(seed,'p'+i),a:i===2?Math.sqrt(luminosity):a,radius:i===2?1:i>4?3+rand(seed,i,'radius')*5:.4+rand(seed,i,'radius')*.9,kind,home:i===2,temperature:i===2?12+rand(seed,'homeTemp')*9:Math.round(278*(luminosity/a**2)**.25-273),phase:rand(seed,i,'phase')*Math.PI*2,period:Math.sqrt(a**3/mass),moons:Math.floor(rand(seed,i,'moons')*(i>4?8:3))});}
  w.planets[2].period=Math.sqrt(w.planets[2].a**3/mass);
  // Land cells share the same terrain function as the globe, rather than imaginary overlay locations.
  for(let i=0;i<500&&w.regions.length<60;i++){const lat=(rand(seed,'region',i,'lat')-.5)*135,lon=rand(seed,'region',i,'lon')*360-180;if(terrain(seed,lon,lat)<0.02)continue;if(w.regions.some(r=>distance(r,{lat,lon})<.1))continue;w.regions.push({id:'r'+w.regions.length,lat,lon,owner:null,fertility:.45+rand(seed,i,'fertility')*.5,water:.45+rand(seed,i,'water')*.5,biomass:.7+rand(seed,i,'bio')*.3,reserves:1500+rand(seed,i,'reserve')*5000,stress:0,disasterUntil:0});}
  const centers=[w.regions[0]];for(let n=1;n<count;n++){const c=w.regions.reduce((best,r)=>Math.min(...centers.map(c=>distance(c,r)))>Math.min(...centers.map(c=>distance(c,best)))?r:best,w.regions[0]);centers.push(c);}
  w.regions.forEach(r=>{let ci=0;for(let i=1;i<count;i++)if(distance(r,centers[i])<distance(r,centers[ci]))ci=i;r.owner='s'+ci;});
  const levels={agriculture:[.4,.2,.15,.3],industrial:[1.6,1.5,1.3,1.1],space:[2.6,3.7,3.3,2.2]}[era];
  for(let i=0;i<count;i++){const land=w.regions.filter(r=>r.owner==='s'+i);const pop=Math.round(sum(land,r=>4500*r.fertility)*(.62+rand(seed,i,'pop')*.2));const s=society(w,'s'+i,i,pop,levels.map((x,j)=>x+rand(seed,i,j,'tech')*.12));s.capitalId=centers[i].id;s.capacity=sum(land,r=>4500*r.fertility);w.societies.push(s);}
  for(let i=0;i<count;i++)for(let j=i+1;j<count;j++)w.relations.push({a:'s'+i,b:'s'+j,trust:.3+rand(seed,i,j,'trust')*.55,trade:0});
  event(w,'origin','Начало наблюдения',`Сформировавшаяся система и ${count} обществ. Исходное состояние задано генератором, а не вычислено из происхождения жизни.`,null,[why('Код',seed),why('Эпоха',era)],true);
  w.ledger.totalBefore=w.ledger.totalAfter=totalPopulation(w);checkpoint(w);validateWorld(w);return w;
}
export function totalPopulation(w) {return sum(w.societies,s=>s.population)+sum(w.colonies,c=>c.population)+sum(w.missions,m=>m.status==='transit'?m.people:0);}
export function epoch(s){const t=(s.tech[0]+s.tech[1]+s.tech[2])/3;return t<1?'Ранние общества':t<1.8?'Городские цивилизации':t<2.6?'Промышленная эпоха':s.satellite?'Космическая эпоха':'Технологическая эпоха';}
export function summary(w){return {year:w.year,population:totalPopulation(w),societies:w.societies.filter(s=>s.population>0).length,colonies:w.colonies.filter(c=>c.population>0).length,warming:metric(w.climate.warming),wars:w.wars.filter(c=>c.active).length,knowledge:metric(sum(w.societies,s=>s.tech[2])/w.societies.length)};}
function snapshot(w){return clone({year:w.year,climate:w.climate,regions:w.regions,societies:w.societies,colonies:w.colonies,missions:w.missions,wars:w.wars,relations:w.relations});}
function checkpoint(w){w.snapshots.push(snapshot(w));if(w.snapshots.length>LIMITS.snapshots)w.snapshots.splice(1,1);if(w.year%10===0||w.year===0)w.history.push(summary(w));}
export function viewSnapshot(w,index){const s=w.snapshots[index];if(!s)throw new Error('Нет такой контрольной точки.');return {...clone(w),...clone(s),events:w.events.filter(e=>e.year<=s.year),history:w.history.filter(h=>h.year<=s.year)};}
function tick(w) {
  if(w.year>=LIMITS.years)throw new Error('Достигнут предел этой модели — 10 000 лет.');
  w.year++;const before=totalPopulation(w);w.ledger={births:0,deaths:0,totalBefore:before,totalAfter:before};
  const ss=[...w.societies].sort((a,b)=>a.id.localeCompare(b.id));
  w.climate.pollution=clamp(w.climate.pollution*.996+sum(ss,s=>s.population*Math.max(0,s.tech[1]-1.2))*1e-8,0,12);
  w.climate.warming+=(w.climate.pollution*.7-w.climate.warming)*.008;
  for(const r of w.regions){const s=ss.find(s=>s.id===r.owner),landCount=w.regions.filter(x=>x.owner===r.owner).length,pressure=(s?.population??0)/Math.max(1,landCount)/30000;const seasonal=.09*Math.sin(w.year*.13+r.lat);r.water=clamp(r.water+(.65-.002*Math.abs(r.lat)-.016*w.climate.warming-r.water)*.03+seasonal*.07,.08,.98);r.biomass=clamp(r.biomass+r.biomass*(1-r.biomass)*.06-pressure*.006-.002*w.climate.warming,.08,1);r.stress=clamp((.5-r.water)*1.3+(.5-r.biomass),0,1);
    if(ryear(w,r.id,'disaster')<.0008&&w.year>r.disasterUntil){r.disasterUntil=w.year+3+Math.floor(ryear(w,r.id,'duration')*5);event(w,'climate','Региональная засуха',`Урожайность региона ${r.id} снижена до ${r.disasterUntil} года.`,r.owner,[why('Водообеспеченность',r.water),why('Длительность',r.disasterUntil-w.year)],false);}
  }
  // Economy uses an explicit food stock and bounded ore reserves. Numerical units are abstract.
  for(const s of ss){const land=w.regions.filter(r=>r.owner===s.id),pop=s.population;if(!pop)continue;s.capacity=sum(land,r=>5500*r.fertility*r.biomass*(.6+r.water)*(.7+.65*s.tech[0])*(w.year<=r.disasterUntil?.48:1));s.production=Math.max(0,Math.min(s.capacity,pop*(1.08+.18*s.tech[0])));s.food=Math.min(pop*6,s.food*.94+s.production);
    let work=pop*.00035*(.3+s.tech[1]);for(const r of land){const mined=Math.min(r.reserves,work/Math.max(1,land.length));r.reserves-=mined;s.minerals+=mined;}s.minerals=Math.min(s.minerals,1e7);
  }
  // Trade transfers are real quantities: seller loses exactly what buyer receives.
  // Land routes are annual aggregated flows, not a simulated ship/freight network.
  for(const rel of w.relations){const a=ss.find(s=>s.id===rel.a),b=ss.find(s=>s.id===rel.b);rel.trade=0;if(!a||!b||!a.population||!b.population)continue;const war=w.wars.some(c=>c.active&&[c.a,c.b].includes(a.id)&&[c.a,c.b].includes(b.id));if(war)continue;const [seller,buyer]=a.food/a.population>b.food/b.population?[a,b]:[b,a];if(rel.trust>.22){const amount=Math.min(Math.max(0,seller.food-seller.population*1.7),Math.max(0,buyer.population*1.2-buyer.food),buyer.population*.14);seller.food-=amount;buyer.food+=amount;rel.trade=amount;}
    rel.trust=clamp(rel.trust+(rel.trade>0?.006:0)-Math.max(0,1-a.food/a.population,1-b.food/b.population)*.025+(ryear(w,rel.a,rel.b,'relation')-.5)*.015,.01,.99);
  }
  for(const s of ss){if(!s.population)continue;const pop=s.population;s.supply=Math.min(1,s.food/pop);s.food=Math.max(0,s.food-pop);const deaths=rounded(w,pop*(.012+.11*(1-s.supply)+Math.max(0,.2-s.stability)*.025),s.id,'deaths'),births=rounded(w,pop*.023*s.supply*clamp(s.capacity/(pop*1.2),0,1),s.id,'births');s.population=pop+births-Math.min(pop,deaths);w.ledger.births+=births;w.ledger.deaths+=Math.min(pop,deaths);
    const oldStable=s.stability;s.stability=clamp(s.stability+((s.supply-.9)*.04)+(ryear(w,s.id,'politics')-.5)*.009-.002*w.wars.filter(c=>c.active&&[c.a,c.b].includes(s.id)).length,.03,.97);
    s.unrestYears=s.stability<.27?s.unrestYears+1:Math.max(0,s.unrestYears-1);
    if(s.supply<.8&&w.year%8===0)event(w,'economy','Недостаток продовольствия',`${s.name}: запасов хватило на ${Math.round(s.supply*100)}% годовой потребности.`,s.id,[why('Производство',s.production),why('Потребность',pop),why('Устойчивость',s.stability)],true);
    for(let i=0;i<4;i++){const old=Math.floor(s.tech[i]);const cost=Math.min(s.minerals,Math.max(.02,s.population*.00003));s.minerals-=cost;const inc=(.0005+.0016*s.stability)*s.supply*(.65+.35*s.leader.skill)*(cost>0?1:.4)/(1+s.tech[i]*.12);s.tech[i]=Math.min(6,s.tech[i]+inc*(i===2?1.08:1));if(Math.floor(s.tech[i])>old)event(w,'science','Новая технологическая ступень',`${s.name}: ${TECH_NAMES[i].toLowerCase()} — ступень ${Math.floor(s.tech[i])}.`,s.id,[why('Обеспеченность',s.supply),why('Устойчивость',s.stability),why('Доступные материалы',s.minerals)],true);}
    s.leader.age++;if(s.leader.age>=88||(s.leader.age>64&&ryear(w,s.id,'succession')<.04)){const old=s.leader.name;s.leader=leader(w,s,s.leader.index+1);event(w,'politics','Смена руководства',`${s.name}: ${old} уступил место ${s.leader.name}.`,s.id,[why('Порядок',s.government),why('Устойчивость',s.stability)],false);}
    if(s.stability<.32&&w.year-s.lastReform>30){const prior=s.government;s.government=GOVERNMENTS[(GOVERNMENTS.indexOf(prior)+1)%GOVERNMENTS.length];s.lastReform=w.year;s.stability=clamp(s.stability+.12,.03,.97);event(w,'politics','Перестройка институтов',`${s.name}: ${prior} → ${s.government}.`,s.id,[why('Прежняя устойчивость',oldStable),why('Обеспеченность пищей',s.supply)],true);}
    s.divergence+=.00015*(1-s.stability*.5);
  }
  // Migration is computed in a stable order and conserves the planetary population.
  for(const s of ss){if(s.supply>.87||s.population<500)continue;const neighbors=w.relations.filter(r=>r.trust>.3&&[r.a,r.b].includes(s.id)).map(r=>ss.find(t=>t.id===(r.a===s.id?r.b:r.a))).filter(t=>t&&t.supply>.95&&t.capacity>t.population*1.05).sort((a,b)=>a.id.localeCompare(b.id));if(!neighbors.length)continue;const to=neighbors[0],n=Math.min(Math.floor(s.population*.008),Math.floor((to.capacity-to.population)*.05));if(n>0){s.population-=n;to.population+=n;if(w.year%10===0)event(w,'migration','Переселение',`${n} жителей: ${s.name} → ${to.name}.`,s.id,[why('Нехватка пищи',1-s.supply),why('Свободная ёмкость принимающего общества',to.capacity-to.population)],false);}}
  for(const rel of w.relations){const a=ss.find(s=>s.id===rel.a),b=ss.find(s=>s.id===rel.b);if(!a||!b||a.population<1000||b.population<1000)continue;if(rel.trust<.17&&ryear(w,rel.a,rel.b,'war')<.018&&!w.wars.some(c=>c.active&&[c.a,c.b].some(id=>id===a.id||id===b.id))){const id='war'+w.nextEntity++;w.wars.push({id,a:a.id,b:b.id,start:w.year,active:true,losses:0});event(w,'conflict','Начало конфликта',`${a.name} и ${b.name} вступили в конфликт.`,a.id,[why('Взаимное доверие',rel.trust),why('Обеспеченность',Math.min(a.supply,b.supply))],true);}}
  for(const c of w.wars.filter(c=>c.active)){const a=w.societies.find(s=>s.id===c.a),b=w.societies.find(s=>s.id===c.b);for(const s of [a,b]){const loss=Math.min(s.population,Math.floor(s.population*(.001+.004*ryear(w,c.id,s.id,'casualties'))));s.population-=loss;c.losses+=loss;w.ledger.deaths+=loss;s.food=Math.max(0,s.food-s.population*.03);}if(w.year-c.start>=5&&(ryear(w,c.id,'peace')<.16||w.year-c.start>20)){c.active=false;const winner=a.population*(.5+a.tech[1])*a.supply>b.population*(.5+b.tech[1])*b.supply?a:b,loser=winner===a?b:a;const land=w.regions.filter(r=>r.owner===loser.id&&r.id!==loser.capitalId);if(land.length>1)land[0].owner=winner.id;const rel=w.relations.find(r=>[r.a,r.b].includes(a.id)&&[r.a,r.b].includes(b.id));if(rel)rel.trust=.35;event(w,'conflict','Мирное соглашение',`${a.name} и ${b.name} завершили конфликт. Потери: ${c.losses} жителей.`,winner.id,[why('Продолжительность',w.year-c.start),why('Потери',c.losses)],true);}}
  if(w.societies.length<LIMITS.societies){for(const s of ss){const land=w.regions.filter(r=>r.owner===s.id);if(s.unrestYears<15||land.length<6||s.population<15000)continue;const chosen=land.slice(-Math.max(2,Math.floor(land.length/3))),ratio=chosen.length/land.length,n=Math.floor(s.population*ratio),id='s'+w.nextEntity++;const t=society(w,id,w.societies.length,n,s.tech);t.parentId=s.id;t.foundingYear=w.year;t.food=s.food*ratio;t.minerals=s.minerals*ratio;t.capitalId=chosen[0].id;t.language=s.language;t.divergence=s.divergence+.04;s.population-=n;s.food-=t.food;s.minerals-=t.minerals;s.unrestYears=0;chosen.forEach(r=>r.owner=id);for(const o of w.societies)w.relations.push({a:o.id,b:id,trust:o.id===s.id?.2:.5,trade:0});w.societies.push(t);event(w,'politics','Возникло новое государство',`${t.name} отделилось от ${s.name}.`,id,[why('Предшественник',s.id),why('Перешедшие жители',n),why('Регионы',chosen.length)],true);break;}}
  space(w);
  w.ledger.totalAfter=totalPopulation(w);
  if(w.ledger.totalAfter!==before+w.ledger.births-w.ledger.deaths)throw new Error('Нарушен баланс населения. Шаг отменён.');
  if(w.year%25===0) {w.snapshots.push(snapshot(w));if(w.snapshots.length>LIMITS.snapshots)w.snapshots.splice(1,1);}
  if(w.year%10===0)w.history.push(summary(w));
}
function space(w){
  const home=w.planets.find(p=>p.home);
  for(const m of w.missions){if(m.status!=='transit'||w.year<m.arrival)continue;m.status='arrived';const s=w.societies.find(s=>s.id===m.owner);if(m.kind==='probe'){if(!s.probed.includes(m.target))s.probed.push(m.target);event(w,'space','Зонд достиг цели',`${m.name}: получены данные о ${w.planets.find(p=>p.id===m.target).name}.`,s.id,[why('Год отправления',m.departure),why('Путь, лет',m.arrival-m.departure)],true);}else {const c={id:'c'+w.nextEntity++,name:m.name,planet:m.target,parent:s.id,population:m.people,food:m.people*3,capacity:m.people*1.4,autonomy:0,independent:false,founded:w.year,losses:0};w.colonies.push(c);event(w,'space','Основано внеземное поселение',`${c.name}: ${c.population} переселенцев.`,s.id,[why('Отправление',m.departure),why('Прибытие',m.arrival),why('Расход материалов',m.cost)],true);}}
  for(const c of w.colonies){if(!c.population)continue;const s=w.societies.find(s=>s.id===c.parent),p=w.planets.find(p=>p.id===c.planet);const autonomousOutput=c.population*clamp(.42+(s.tech[0]-2)*.15,.2,1.3);c.food+=autonomousOutput;
    // Supply dispatch is a travelling freight mission, not instant interplanetary trade.
    if(!c.independent&&c.food<c.population*3&&s.food>s.population*1.8&&!w.missions.some(m=>m.kind==='supply'&&m.target===c.id&&m.status==='transit')&&w.missions.length<LIMITS.missions){const cargo=Math.min(s.food-s.population*1.8,c.population*4);s.food-=cargo;w.missions.push({id:'m'+w.nextEntity++,name:'Снабжение '+c.name,owner:s.id,target:c.id,kind:'supply',people:0,cargo,cost:0,departure:w.year,arrival:w.year+Math.max(1,Math.ceil(Math.abs(p.a-home.a)*2)),status:'transit'});}
    const supply=Math.min(1,c.food/c.population);c.food=Math.max(0,c.food-c.population);const deaths=Math.min(c.population,Math.floor(c.population*(.009+.1*(1-supply)))),births=Math.floor(c.population*.024*supply*clamp(c.capacity/c.population-.5,0,1));c.population+=births-deaths;c.losses+=deaths;w.ledger.births+=births;w.ledger.deaths+=deaths;c.capacity+=Math.max(0,autonomousOutput*.008);c.autonomy=clamp(c.autonomy+.0015+Math.abs(p.a-home.a)*.0003,0,1);
    if(c.autonomy>.75&&!c.independent&&autonomousOutput>=c.population){c.independent=true;event(w,'politics','Колония получила самостоятельность',`${c.name} больше не зависит от регулярного продовольственного снабжения.`,c.parent,[why('Самообеспечение',autonomousOutput/Math.max(1,c.population)),why('Возраст поселения',w.year-c.founded)],true);}
  }
  for(const s of w.societies){if(s.population<10000||s.supply<.97||w.year-s.lastLaunch<30||s.tech[1]<2.6||s.tech[2]<2.4)continue;if(!s.satellite&&s.minerals>=25){s.minerals-=25;s.satellite=true;s.lastLaunch=w.year;event(w,'space','Первый искусственный спутник',`${s.name} вышло на орбиту родного мира.`,s.id,[why('Производство',s.tech[1]),why('Исследования',s.tech[2]),why('Материалы списаны',25)],true);continue;}if(!s.satellite||w.missions.length>=LIMITS.missions)continue;
    const target=w.planets.filter(p=>!p.home&&p.kind!=='gas').sort((a,b)=>Math.abs(a.a-home.a)-Math.abs(b.a-home.a)).find(p=>!w.missions.some(m=>m.owner===s.id&&m.target===p.id&&m.kind==='colony')&&(!s.probed.includes(p.id)||!w.colonies.some(c=>c.parent===s.id&&c.planet===p.id)));
    if(!target)continue;const probed=s.probed.includes(target.id);if(w.missions.some(m=>m.owner===s.id&&m.target===target.id&&m.status==='transit'))continue;
    const kind=probed?'colony':'probe',cost=probed?90:15;if(s.minerals<cost)continue;if(probed&&(s.tech[1]<3.6||s.tech[2]<3.1||w.colonies.length+w.missions.filter(m=>m.kind==='colony'&&m.status==='transit').length>=LIMITS.colonies||s.food<s.population*1.5))continue;
    const people=probed?300:0;s.minerals-=cost;s.population-=people;s.food=Math.max(0,s.food-people*3);s.lastLaunch=w.year;const duration=Math.max(1,Math.ceil(2*Math.abs(target.a-home.a)/Math.max(.5,s.tech[1]*.3)));const m={id:'m'+w.nextEntity++,name:probed?'Поселение '+name(w.seed,'colony'+w.nextEntity):'Зонд '+name(w.seed,'probe'+w.nextEntity),owner:s.id,target:target.id,kind,people,cargo:0,cost,departure:w.year,arrival:w.year+duration,status:'transit'};w.missions.push(m);event(w,'space',probed?'Отправлены переселенцы':'Начало межпланетной экспедиции',`${s.name} → ${target.name}. Расчётное прибытие: ${m.arrival} год.`,s.id,[why('Участники',people),why('Материалы списаны',cost),why('В пути, лет',duration)],true);
  }
}
// Freight has a separate arrival phase. A supply cargo never creates a settlement.
function deliverSupplies(w){for(const m of w.missions){if(m.kind==='supply'&&m.status==='transit'&&m.arrival<=w.year+1){const c=w.colonies.find(c=>c.id===m.target);if(c)c.food+=m.cargo;m.status='arrived';}}}
export function advance(world,years=1,options={}) {
  if(!Number.isSafeInteger(years)||years<0||years>1000)throw new Error('Один запрос: от 0 до 1000 лет.');
  validateWorld(world);const w=clone(world),startEvents=w.events.length;let advanced=0;
  for(let i=0;i<years&&w.year<LIMITS.years;i++){deliverSupplies(w);tick(w);advanced++;if(options.stopOnImportant&&w.events.slice(startEvents).some(e=>e.important))break;}
  validateWorld(w);return {world:w,advanced,newEvents:w.events.slice(startEvents),stopped:advanced<years};
}
export function validateWorld(w,{checkSnapshots=true}={}){
  const fail=s=>{throw new Error('Некорректный мир: '+s);};
  if(!w||w.schema!==SCHEMA||w.modelVersion!==MODEL_VERSION)fail('неподдерживаемая версия; сохранения прежнего сайта требуют отдельной миграции.');
  if(typeof w.seed!=='string'||!w.seed||w.seed.length>128||typeof w.id!=='string'||w.id.length>128||typeof w.name!=='string'||w.name.length>128)fail('идентичность');
  if(!['agriculture','industrial','space'].includes(w.era))fail('эпоха');
  if(!Number.isSafeInteger(w.year)||w.year<0||w.year>LIMITS.years)fail('год');
  const spec={planets:[4,12],regions:[1,90],societies:[1,LIMITS.societies],missions:[0,LIMITS.missions],colonies:[0,LIMITS.colonies],events:[1,LIMITS.events],snapshots:[1,LIMITS.snapshots],wars:[0,3000],relations:[0,200],history:[1,1100]};
  for(const [k,[lo,hi]]of Object.entries(spec))if(!Array.isArray(w[k])||w[k].length<lo||w[k].length>hi)fail(k);
  let nodes=0;const walk=(v,d=0)=>{if(++nodes>2000000||d>24)fail('слишком сложный файл');if(typeof v==='number'&&!Number.isFinite(v))fail('нечисловое значение');if(typeof v==='string'&&v.length>3000)fail('слишком длинный текст');if(v&&typeof v==='object')for(const [k,x]of Object.entries(v)){if(['__proto__','prototype','constructor'].includes(k))fail('служебный ключ');walk(x,d+1);}};walk(w);
  const ids=(xs,k)=>{const set=new Set();for(const x of xs){if(!x||typeof x.id!=='string'||x.id.length>128||set.has(x.id))fail('дубликат/ошибка '+k);set.add(x.id);}return set;};
  const pids=ids(w.planets,'планеты'),sids=ids(w.societies,'общества'),rids=ids(w.regions,'регионы'),cids=ids(w.colonies,'колонии');ids(w.events,'события');ids(w.missions,'экспедиции');ids(w.wars,'войны');
  const positive=(x,name,max=1e12)=>{if(typeof x!=='number'||!Number.isFinite(x)||x<0||x>max)fail(name);};const population=(x)=>{positive(x,'население');if(!Number.isSafeInteger(x))fail('дробное население');};const unit=(x,name)=>{positive(x,name,1);};
  if(!w.star||!w.climate||!w.ledger)fail('среда/учёт');positive(w.star.mass,'масса звезды',10);positive(w.star.luminosity,'светимость',100);if(w.star.mass===0||w.star.luminosity===0)fail('звезда');positive(w.climate.warming,'потепление',20);positive(w.climate.pollution,'загрязнение',20);
  for(const k of ['nextEvent','nextEntity'])if(!Number.isSafeInteger(w[k])||w[k]<1)fail(k);
  if(w.planets.filter(p=>p.home).length!==1)fail('родная планета');
  for(const p of w.planets){if(!['terrestrial','rock','ice','gas'].includes(p.kind)||typeof p.name!=='string')fail('планета');positive(p.a,'орбита',10000);positive(p.radius,'радиус',100);positive(p.period,'период',1000000);if(p.a===0||p.radius===0||p.period===0)fail('нулевая орбита/размер');}
  for(const s of w.societies){population(s.population);for(const k of ['food','minerals','capacity','production'])positive(s[k],k);unit(s.stability,'устойчивость');unit(s.supply,'обеспеченность');if(!Array.isArray(s.tech)||s.tech.length!==4)fail('технологии');s.tech.forEach(v=>positive(v,'технология',6));if(!rids.has(s.capitalId)||!s.leader||!Array.isArray(s.probed)||s.probed.some(id=>!pids.has(id))||typeof s.name!=='string'||typeof s.color!=='string'||!/^#[0-9a-f]{6}$/i.test(s.color))fail('общество');}
  for(const r of w.regions){if(!sids.has(r.owner)||typeof r.lat!=='number'||Math.abs(r.lat)>90||typeof r.lon!=='number'||Math.abs(r.lon)>180)fail('регион');positive(r.reserves,'руда');unit(r.water,'вода');unit(r.biomass,'биомасса');unit(r.fertility,'плодородие');}
  for(const m of w.missions){if(!sids.has(m.owner)||!['transit','arrived'].includes(m.status)||!['probe','colony','supply'].includes(m.kind))fail('экспедиция');if(!(m.kind==='supply'?cids:pids).has(m.target))fail('цель экспедиции');population(m.people);positive(m.cargo,'груз');if(!Number.isSafeInteger(m.departure)||!Number.isSafeInteger(m.arrival)||m.arrival<=m.departure||m.departure>w.year||(m.status==='arrived'&&m.arrival>w.year)||(m.status==='transit'&&m.arrival<=w.year))fail('время экспедиции');}
  for(const c of w.colonies){population(c.population);positive(c.food,'еда колонии');positive(c.capacity,'ёмкость колонии');unit(c.autonomy,'автономия');if(!pids.has(c.planet)||!sids.has(c.parent))fail('колония');}
  for(const r of w.relations){if(!sids.has(r.a)||!sids.has(r.b)||r.a===r.b)fail('отношения');unit(r.trust,'доверие');positive(r.trade,'торговля');}
  for(const c of w.wars)if(!sids.has(c.a)||!sids.has(c.b)||c.a===c.b)fail('конфликт');
  let y=-1;for(const e of w.events){if(!Number.isSafeInteger(e.year)||e.year<y||e.year>w.year||typeof e.title!=='string'||typeof e.detail!=='string'||!Array.isArray(e.causes)||e.causes.length>12)fail('хроника');y=e.year;}
  let previousYear=-1;for(const s of w.snapshots){if(!Number.isSafeInteger(s.year)||s.year> w.year||s.year<=previousYear||!Array.isArray(s.societies)||!Array.isArray(s.regions))fail('контрольная точка');previousYear=s.year;if(checkSnapshots){const archive={...w,...s,events:w.events.filter(e=>e.year<=s.year),history:w.history.filter(h=>h.year<=s.year),snapshots:[{year:s.year,societies:[],regions:[]}]};validateWorld(archive,{checkSnapshots:false});}}
  if(w.events.some(e=>e.id==='e'+w.nextEvent))fail('счётчик событий');
  return true;
}

