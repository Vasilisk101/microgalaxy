import * as Geography from '../../simulator-v08/src/geography.mjs';
const resources = ['food','raw','energy','equipment'];
const changed = (a,b) => Math.abs(a-b) > 1e-9 * Math.max(1,Math.abs(a),Math.abs(b));

export function routeOverride(w, edgeId) {
  return Geography.experimentalPassage(w,edgeId);
}

// Only the basin's physical crossing can be reopened; other causes of a
// closed trading route are not changed by a topographic intervention.
export function conditionModes(w, edgeId) {
  const edge=w.geography.edges.find(e=>e.id===edgeId);
  if(!edge)return ['none'];
  const blocked=w.observatory?.living?.basin?.blockedEdge===edgeId;
  return blocked?['none','open']:['none','closed'];
}

export function validate(w) {
  const x = w.observatory?.experiment;
  if (x == null) return true;
  const fail = () => { throw new Error('Некорректные сведения об эксперименте.'); };
  const id = s => typeof s === 'string' && s.length > 0 && s.length <= 128;
  const year = n => Number.isSafeInteger(n) && n >= 0 && n <= 10000;
  if (!id(x.pairId) || !id(x.peerId) || !id(x.parentId) || x.peerId === x.parentId
    || !['control','experimental'].includes(x.role) || !year(x.year) || x.year > w.year
    || !Number.isSafeInteger(x.parentRevision) || x.parentRevision < 1) fail();
  const c = x.condition;
  if (c !== null && (!c || !['open','closed'].includes(c.mode) || !year(c.until) || c.until <= x.year
    || !w.geography.edges.some(e => e.id === c.edge))) fail();
  if (x.report != null) {
    const r = x.report;
    if (!year(r.end) || r.end < x.year || r.end > w.year || r.start !== x.year
      || r.site !== null && !w.regions.some(place => place.id === r.site)
      || r.edge !== null && !w.geography.edges.some(e => e.id === r.edge)
      || !Array.isArray(r.samples) || r.samples.length < 1 || r.samples.length > 70) fail();
    for (const change of [r.firstMovement, r.firstEconomy, r.lastEconomy]) {
      if (change !== null && (!change || !year(change.year) || change.year <= x.year || change.year > r.end
        || typeof change.metric !== 'string' || typeof change.place !== 'string'
        || !Number.isFinite(change.control) || !Number.isFinite(change.experimental))) fail();
    }
    // Reports created before this field existed remain valid and readable.
    if(r.firstFreight!=null){
      const f=r.firstFreight;
      if(!year(f.year)||f.year<=x.year||f.year>r.end||!['shared','independent'].includes(f.kind)||(!f.control&&!f.experimental))fail();
      if(f.kind==='shared'&&f.control&&f.experimental&&f.control.id!==f.experimental.id)fail();
      for(const item of [f.control,f.experimental])if(item!==null){
        if(!item||!id(item.id)||!w.regions.some(p=>p.id===item.from)||!w.regions.some(p=>p.id===item.to)
          ||!resources.includes(item.resource)||!Array.isArray(item.path)||!item.path.length||item.path.length>12
          ||item.path.some(edge=>!w.geography.edges.some(e=>e.id===edge))||!year(item.departure)
          ||item.departure>f.year||!Number.isSafeInteger(item.arrival)||item.arrival<=f.year||!['transit','waiting'].includes(item.status)||!Number.isFinite(item.amount)||item.amount<0)fail();
        let at=item.from;for(const id of item.path){const edge=w.geography.edges.find(e=>e.id===id);if(![edge.a,edge.b].includes(at))fail();at=edge.a===at?edge.b:edge.a;}if(at!==item.to)fail();
      }
    }
    let last = -1;
    for (const row of r.samples) {
      if (!Array.isArray(row) || row.length !== 5 || !year(row[0]) || row[0]<x.year || row[0]>r.end
        || row[0]<=last || row.slice(1).some(n => !Number.isFinite(n))) fail();
      last = row[0];
    }
    if (last !== r.end) fail();
  }
  return true;
}

function cargoRow(s){return s?{id:s.id,from:s.from,to:s.to,resource:s.resource,path:[...s.path],departure:s.departure,arrival:s.arrival,status:s.status,amount:s.amount}:null;}
function cargoState(s){return s?JSON.stringify([s.status,s.arrival,s.amount,s.path]):null;}
function cargoOrigin(s){return JSON.stringify([s.from,s.to,s.resource,s.departure,s.path]);}
/** IDs issued after the split are branch-local. Never pair them by number. */
export function firstFreightDifference(a,b,sharedIds){
  const left=new Map(a.economy.shipments.map(s=>[s.id,s])),right=new Map(b.economy.shipments.map(s=>[s.id,s]));
  for(const id of sharedIds){const x=left.get(id),y=right.get(id);if(cargoState(x)!==cargoState(y))return {year:a.year,kind:'shared',control:cargoRow(x),experimental:cargoRow(y)};}
  const keys=new Set(),groups=[new Map(),new Map()];
  for(const [i,w] of [a,b].entries())for(const s of w.economy.shipments){
    if(sharedIds.has(s.id))continue;const key=cargoOrigin(s);keys.add(key);const g=groups[i].get(key)??[];g.push(s);groups[i].set(key,g);
  }
  const differences=[[],[]];
  for(const key of [...keys].sort()){
    const x=groups[0].get(key)??[],y=groups[1].get(key)??[];
    const unmatched=(first,second)=>{const pool=second.map(cargoState);return first.filter(item=>{const i=pool.indexOf(cargoState(item));if(i<0)return true;pool.splice(i,1);return false;});};
    differences[0].push(...unmatched(x,y));differences[1].push(...unmatched(y,x));
  }
  if(differences[0].length||differences[1].length)return {year:a.year,kind:'independent',control:cargoRow(differences[0][0]),experimental:cargoRow(differences[1][0])};
  return null;
}

function firstMovement(a, b) {
  for (let i=0; i<a.economy.routes.length; i++) {
    const p = a.economy.routes[i], q = b.economy.routes[i];
    if (changed(p.used,q.used)) return {year:a.year, metric:'Перевезено по пути',place:p.id,control:p.used,experimental:q.used};
  }
  const keys = new Map();
  for (const [index,w] of [a,b].entries()) {
    for (const s of w.economy.shipments) {
      const k = JSON.stringify([s.from,s.to,s.resource,s.status,s.arrival,s.path]);
      const row = keys.get(k) ?? {metric:'Груз в пути · '+s.resource,place:s.from+' → '+s.to,values:[0,0]};
      row.values[index] += s.amount;
      keys.set(k,row);
    }
    for (const m of w.geography.movements) {
      const k = JSON.stringify([m.from,m.to,m.edgeIds]);
      const row = keys.get(k) ?? {metric:'Переселилось жителей',place:m.from+' → '+m.to,values:[0,0]};
      row.values[index] += m.people;
      keys.set(k,row);
    }
  }
  for (const row of keys.values()) if (changed(...row.values)) {
    return {year:a.year,metric:row.metric,place:row.place,control:row.values[0],experimental:row.values[1]};
  }
  return null;
}

function economyChange(a,b) {
  for (let i=0; i<a.regions.length; i++) {
    const p = a.regions[i], q = b.regions[i];
    if (p.population !== q.population) return {year:a.year,metric:'Жители',place:p.id,control:p.population,experimental:q.population};
    for (const key of resources) {
      const av=p.economy.stock[key], bv=q.economy.stock[key];
      if (changed(av,bv)) return {year:a.year,metric:'Запас · '+key,place:p.id,control:av,experimental:bv};
    }
  }
  return null;
}

function sample(w, route, site) {
  const moved = route ? w.economy.routes.find(r=>r.id===route).used : w.economy.routes.reduce((n,r)=>n+r.used,0);
  const food = site ? w.regions.find(r=>r.id===site).economy.stock.food : w.regions.reduce((n,r)=>n+r.economy.stock.food,0);
  return [moved,food];
}

/** Run both private copies from the same complete pause, sampling both after every year.
 * A report refers to this comparison interval even if either saved branch is later played on. */
export async function comparePair(parent, options, core, onProgress = () => {}) {
  core.validateWorld(parent);
  const {condition=null,horizon,parentRevision} = options;
  if (!parent.observatory || !Number.isSafeInteger(horizon) || horizon <= parent.year || horizon > core.LIMITS.years
    || !Number.isSafeInteger(parentRevision) || parentRevision < 1) throw new Error('Выберите доступный год после полной точки наблюдения.');
  const selectedEdge = condition?.edge ?? options.observedEdge;
  const edge = parent.geography.edges.find(e=>e.id===selectedEdge);
  if (selectedEdge && !edge) throw new Error('Выбранный путь отсутствует в этом мире.');
  if (condition !== null && (!edge || !['open','closed'].includes(condition.mode)
    || !Number.isSafeInteger(condition.until) || condition.until <= parent.year || condition.until > core.LIMITS.years)) {
    throw new Error('Условие должно относиться к существующему пути и будущему году.');
  }
  if(parent.modelVersion==='1.0.1'&&condition!==null&&!conditionModes(parent,condition.edge).includes(condition.mode))
    throw new Error('Выбранное изменение неприменимо к природной проходимости этого пути.');
  const ids = [crypto.randomUUID(),crypto.randomUUID()], pairId = 'pair-'+crypto.randomUUID();
  const pair = ids.map((id,i)=>{
    const w=structuredClone(parent);
    w.id=id;
    w.name=parent.name.slice(0,85)+' · '+(i?'Опыт':'Контроль')+' '+parent.year;
    w.observatory.experiment={pairId,parentId:parent.id,parentRevision,year:parent.year,role:i?'experimental':'control',
      peerId:ids[1-i],condition:structuredClone(condition),report:null};
    return w;
  });
  const [a,b]=pair;
  const left=core.createWorkerSession(a), right=core.createWorkerSession(b);
  const sharedIds=new Set(parent.economy.shipments.map(s=>s.id));
  const report={start:parent.year,end:horizon,firstMovement:null,firstEconomy:null,lastEconomy:null,firstFreight:null,
    site:edge?.b??null, edge:edge?.id??null, samples:[]};
  const stride = Math.max(1,Math.ceil((horizon-parent.year)/60));
  const capture=()=>{
    const [ac,af]=sample(a,edge?.id,report.site),[bc,bf]=sample(b,edge?.id,report.site);
    report.samples.push([a.year,ac,bc,af,bf]);
  };
  capture();
  let lastYield=performance.now();
  while(a.year < horizon){
    left.step(1);right.step(1);
    const hadMovement=report.firstMovement!==null, hadEconomy=report.firstEconomy!==null,hadFreight=report.firstFreight!==null;
    report.firstMovement ??= firstMovement(a,b);
    report.firstFreight ??= firstFreightDifference(a,b,sharedIds);
    const difference=economyChange(a,b);
    report.firstEconomy ??= difference;
    report.lastEconomy=difference;
    if((a.year-parent.year)%stride===0||a.year===horizon||!hadMovement&&report.firstMovement||!hadEconomy&&report.firstEconomy||!hadFreight&&report.firstFreight)capture();
    if(performance.now()-lastYield>=80){
      await onProgress(a.year,horizon);
      await new Promise(resolve=>setTimeout(resolve,0));
      lastYield=performance.now();
    }
  }
  for(const w of pair){
    w.observatory.experiment.report=structuredClone(report);
    core.validateWorld(w);
  }
  return pair;
}
