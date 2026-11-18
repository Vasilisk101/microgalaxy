import * as Economy from './economy.mjs';

// A fixed acyclic graph. Memory survives loss of a working capability.
export const NODES = Object.freeze([
  ['farming','Земледельческие практики',[],0],['workshops','Мастерские',[],1],['records','Учёт и записи',[],2],['councils','Представительные советы',[],3],
  ['irrigation','Орошение',['farming'],0],['roads','Содержание путей',['workshops'],1],['schools','Обучение',['records'],2],['regional_councils','Региональное представительство',['councils'],3],
  ['industry','Механизированное производство',['workshops','roads'],1],['science','Систематические исследования',['schools'],2],['coordination','Межрегиональная координация',['regional_councils','records'],3],
  ['rocketry','Ракетная техника',['industry','science'],1],['orbital','Орбитальные системы',['rocketry','coordination'],2],['settlement','Внеземное поселение',['orbital','irrigation'],0]
].map(([id,name,requires,field])=>({id,name,requires,field})));
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function initialize(s,era){const n=era==='space'?14:era==='industrial'?11:4;s.knowledge=NODES.map((d,i)=>({id:d.id,memory:i<n?1:0,active:i<n,progress:0,neglect:0,lastChange:0,reason:i<n?'Исходные навыки эпохи':'Пока не освоено',eventId:null}));derive(s);}
export function derive(s){s.tech=[.25,.2,.2,.25];for(const d of NODES){const n=s.knowledge.find(x=>x.id===d.id);if(n?.active)s.tech[d.field]+={farming:.35,workshops:.4,records:.4,councils:.35,irrigation:.8,roads:.65,schools:.65,regional_councils:.65,industry:1.25,science:1.25,coordination:.85,rocketry:1.1,orbital:1.25,settlement:.9}[d.id];}}
export function has(s,id){return !!s.knowledge.find(n=>n.id===id)?.active;}
// Each year only two lines of inquiry can use the society's limited attention.
// Inputs are observed model state, not a hidden fixed technological script.
function priorities(w,s){
  const land=w.regions.filter(r=>r.owner===s.id),pop=Math.max(1,s.population),weighted=f=>land.reduce((a,r)=>a+r.population*f(r),0)/pop;
  const trade=clamp(w.relations.filter(r=>r.a===s.id||r.b===s.id).reduce((a,r)=>a+r.trade,0)/pop*5,0,1);
  const access=weighted(r=>r.social.access),representation=weighted(r=>r.social.representation),agriculture=weighted(r=>r.settlement.specialization==='agriculture'?1:0),crafts=weighted(r=>r.settlement.specialization==='crafts'||r.settlement.specialization==='mining'?1:0);
  const equipment=clamp(land.reduce((a,r)=>a+r.economy.stock.equipment,0)/pop*10,0,1),c=s.culture,p=s.politics.policy;
  const food=clamp((1-s.supply)*2+agriculture*.6+(p==='food'?.35:0),0,1.5),industry=clamp(crafts*.8+equipment*.35+trade*.45+(p==='trade'?.3:0),0,1.5),learning=clamp(c.exchange*.3+equipment*.15+(p==='research'?.6:0),0,1.5),regional=clamp((1-representation)*.5+(1-access)*.35+c.autonomy*.45+(p==='food'?.1:0),0,1.5);
  const scores={farming:food,workshops:industry,records:learning,councils:regional,irrigation:food,roads:industry+trade*.2,schools:learning+industry*.08,regional_councils:regional,industry:industry,science:learning,coordination:regional+trade*.15,rocketry:industry+learning*.25,orbital:learning+industry*.2,settlement:food+regional*.3};
  return {scores,trade,food,industry,learning,regional};
}
function tie(seed,id,node){let h=2166136261;for(const c of `${seed}:${id}:${node}`){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0)/4294967296;}
export function step(w,s,emit){
  const context=priorities(w,s),research=s.politics.policy==='research',culture=s.culture;
  const selected=new Set(NODES.filter(d=>{const n=s.knowledge.find(x=>x.id===d.id);return !n.active&&d.requires.every(id=>has(s,id));}).map(d=>{const n=s.knowledge.find(x=>x.id===d.id);return {id:d.id,score:context.scores[d.id]+n.progress*.12+n.memory*.18+tie(w.seed,s.id,d.id)*.00001};}).sort((a,b)=>b.score-a.score).slice(0,2).map(x=>x.id));
  for(const d of NODES){const n=s.knowledge.find(x=>x.id===d.id),parents=d.requires.every(id=>has(s,id));
    if(!n.active&&!parents){n.progress=Math.max(0,n.progress-.001);continue;}
    if(!n.active&&!selected.has(d.id))continue;
    const required=Math.max(.015,s.population*.000002)*(1+d.requires.length*.5),energy=Economy.spend(w,s.id,'energy',required,'maintenance'),equipment=Economy.spend(w,s.id,'equipment',required*.25,'maintenance');
    const supplied=energy>=required*.99&&equipment>=required*.25*.99&&s.supply>.78;
    if(n.active){n.neglect=parents&&supplied?Math.max(0,n.neglect-1):n.neglect+1;if(!parents||n.neglect>=8){n.active=false;n.neglect=0;n.reason=!parents?'Утрата предпосылки':'Длительный недостаток ресурсов или продовольствия';n.lastChange=w.year;n.eventId=emit(s,d,'lost',n.reason);}}
    else if(parents&&supplied&&s.stability>.32){const activity=(.004+(research?.002:0))*(.7+culture.exchange*.3)*(n.memory?3:1);n.progress=clamp(n.progress+activity,0,1);if(n.progress>=1){const recovered=!!n.memory;n.active=true;n.memory=1;n.progress=0;const contextText=`пища ${context.food.toFixed(2)}, производство ${context.industry.toFixed(2)}, обучение ${context.learning.toFixed(2)}, регионы ${context.regional.toFixed(2)}, торговля ${context.trade.toFixed(2)}, курс ${s.politics.policy}`;n.reason=`${recovered?'Восстановлено благодаря памяти':'Выбрано среди направлений'}: ${contextText}`;n.lastChange=w.year;n.eventId=emit(s,d,'gained',n.reason);}}
    else n.progress=Math.max(0,n.progress-.001);
  }derive(s);
}
export function summary(s){return {nodes:NODES.map(d=>{const n=s.knowledge.find(x=>x.id===d.id);return {...d,...structuredClone(n),status:n.active?'active':n.memory?'lost':'unlearned'};}),edges:NODES.flatMap(d=>d.requires.map(from=>({from,to:d.id})))};}
export function validate(w,s,fail){if(!Array.isArray(s.knowledge)||s.knowledge.length!==NODES.length)fail('граф знаний');for(let i=0;i<NODES.length;i++){const n=s.knowledge[i],d=NODES[i];if(!n||n.id!==d.id||![0,1].includes(n.memory)||typeof n.active!=='boolean'||n.active&&!n.memory||n.active&&d.requires.some(id=>!has(s,id))||!Number.isFinite(n.progress)||n.progress<0||n.progress>1||!Number.isSafeInteger(n.neglect)||n.neglect<0||n.neglect>8||!Number.isSafeInteger(n.lastChange)||n.lastChange<0||n.lastChange>w.year||typeof n.reason!=='string'||(n.eventId!==null&&typeof n.eventId!=='string'))fail('состояние знаний');}const expected={knowledge:structuredClone(s.knowledge)};derive(expected);if(expected.tech.some((n,i)=>Math.abs(n-s.tech[i])>1e-9))fail('показатели знаний');}
