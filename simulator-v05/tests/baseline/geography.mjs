/** Deterministic, deliberately aggregate geography for MICROGALAXY 0.5.
 * Region markers represent areas, not surveyed points. Distances assume an
 * Earth-sized sphere; route costs are model travel days, not predictions.
 * This module has no dependency on Core, the DOM, randomness or wall time.
 */
const clampGeo = (n, a, b) => Math.max(a, Math.min(b, n));
const sumGeo = (items, fn) => items.reduce((total, item) => total + fn(item), 0);
const copyGeo = value => structuredClone(value);
const cmpGeo = (a, b) => String(a).localeCompare(String(b), 'en');
const EARTH_RADIUS = 6371;
const MAX_MOVEMENTS = 192;
export const BIOME_NAMES = Object.freeze({highlands:'Нагорья',tundra:'Холодные равнины',forest:'Лесной край',grassland:'Плодородные равнины',drylands:'Засушливый край'});
export const SETTLEMENT_NAMES = Object.freeze({village:'Поселение',town:'Город',city:'Крупный город'});
export const SPECIALIZATION_NAMES = Object.freeze({agriculture:'Земледелие',mining:'Добыча сырья',port:'Портовый центр',administration:'Административный центр',crafts:'Ремёсла'});

function hashGeo(value) {
  let h = 2166136261;
  for (const c of String(value)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function randomGeo(seed, ...keys) {
  let x = hashGeo(JSON.stringify([seed, ...keys]));
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
function terrainGeo(seed, lon, lat) {
  const q = randomGeo(seed, 'terrain') * 6.28, x = lon * Math.PI / 180, y = lat * Math.PI / 180;
  return Math.sin(x * 2 + q + Math.sin(y * 3)) * .46 + Math.cos(x * 3 - y * 2 + q) * .25 +
    Math.sin(x * 5 + y * 4) * .13 + Math.cos(x * 11 - y * 8 + q) * .07 - Math.abs(lat) / 310;
}
function angleGeo(a, b) {
  const p = Math.PI / 180;
  return Math.acos(clampGeo(Math.sin(a.lat*p)*Math.sin(b.lat*p)+Math.cos(a.lat*p)*Math.cos(b.lat*p)*Math.cos((a.lon-b.lon)*p), -1, 1));
}
function vecGeo(r) {
  const p = Math.PI / 180, c = Math.cos(r.lat * p);
  return [c * Math.cos(r.lon * p), Math.sin(r.lat * p), c * Math.sin(r.lon * p)];
}
function pointAlongGeo(a, b, t) {
  const av = vecGeo(a), bv = vecGeo(b), theta = angleGeo(a, b), sine = Math.sin(theta);
  const u = Math.abs(sine) < 1e-7 ? 1-t : Math.sin((1-t)*theta)/sine;
  const v = Math.abs(sine) < 1e-7 ? t : Math.sin(t*theta)/sine;
  const x = av[0]*u+bv[0]*v, y = av[1]*u+bv[1]*v, z = av[2]*u+bv[2]*v;
  return {lon:Math.atan2(z,x)*180/Math.PI,lat:Math.atan2(y,Math.hypot(x,z))*180/Math.PI};
}
function edgeBetweenGeo(w, a, b) {
  const radians = angleGeo(a, b), n = Math.max(3, Math.min(96, Math.ceil(radians/.035)));
  let wet = 0, peak = Math.max(a.elevation, b.elevation);
  for (let i=1; i<n; i++) {
    const p = pointAlongGeo(a,b,i/n), h = terrainGeo(w.seed,p.lon,p.lat);
    if (h < .02) wet++;
    peak = Math.max(peak, clampGeo((h-.02)/1.1,0,1));
  }
  const kind = wet ? 'sea' : 'land', distance = Math.max(1,Math.round(radians*EARTH_RADIUS));
  const cost = kind === 'sea' ? 8+distance/280 : distance/150*(1+peak*1.8);
  const ids = [a.id,b.id].sort(cmpGeo);
  return {id:'g:'+ids.join(':'),a:ids[0],b:ids[1],kind,distance,cost:Math.round(cost*1000)/1000};
}
function adjacencyGeo(w) {
  const map = new Map(w.regions.map(r => [r.id, []]));
  for (const edge of w.geography?.edges ?? []) {
    if (map.has(edge.a) && map.has(edge.b)) {
      map.get(edge.a).push({to:edge.b,edge});
      map.get(edge.b).push({to:edge.a,edge});
    }
  }
  for (const values of map.values()) values.sort((a,b)=>cmpGeo(a.to,b.to));
  return map;
}
function connectedIdsGeo(ids, adjacency) {
  if (!ids.length) return true;
  const allowed = new Set(ids), visited = new Set([ids[0]]), queue = [ids[0]];
  for (let n=0; n<queue.length; n++) for (const {to} of adjacency.get(queue[n]) ?? []) {
    if (allowed.has(to) && !visited.has(to)) { visited.add(to); queue.push(to); }
  }
  return visited.size === allowed.size;
}
function allocationsGeo(amount, regions, weights) {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Неверное изменение населения региона.');
  if (!regions.length) { if (amount) throw new Error('У населения нет территории.'); return []; }
  const safe = weights.map(n=>Number.isFinite(n)&&n>0?n:0), total = sumGeo(safe,n=>n);
  const raw = safe.map(n=>amount*(total?n/total:1/regions.length)), result = raw.map(Math.floor);
  const order = regions.map((r,i)=>({id:r.id,i,f:raw[i]-result[i]})).sort((a,b)=>b.f-a.f||cmpGeo(a.id,b.id));
  let remainder = amount-sumGeo(result,n=>n);
  for (let i=0; remainder>0; i++,remainder--) result[order[i%order.length].i]++;
  return result;
}
function nameGeo(seed,id) {
  const a=['Ар','Бел','Вел','Дор','Ил','Кам','Лин','Мер','Нар','Ор','Рен','Тар'];
  const b=['ана','бор','дор','ей','ино','ис','мир','он','ос','тан','ур','ья'];
  return a[Math.floor(randomGeo(seed,id,'settlement-a')*a.length)]+b[Math.floor(randomGeo(seed,id,'settlement-b')*b.length)];
}
function settlementKindGeo(population, infrastructure) {
  return population>=18000&&infrastructure>=.45?'city':population>=5000&&infrastructure>=.18?'town':'village';
}
function societyOfGeo(w, id) { return w.societies.find(s=>s.id===id); }
function regionOfGeo(w, id) { return typeof id==='object'&&id!==null?id:w.regions.find(r=>r.id===id); }

/** Reassign the old geometric Voronoi ownership through actual graph growth.
 * Each claim is reached through an already-owned predecessor, so all initial
 * territories are connected, including archipelagos linked by sea routes.
 */
export function initializeGeography(w) {
  const ids = new Set(w.regions.map(r=>r.id));
  if (ids.size !== w.regions.length || w.regions.length < w.societies.length) throw new Error('Недостаточно различных регионов.');
  const capitals = new Map();
  for (const s of w.societies) {
    if (!ids.has(s.capitalId) || capitals.has(s.capitalId)) throw new Error('Неверная исходная столица.');
    capitals.set(s.capitalId,s.id);
  }
  for (const r of w.regions) {
    r.elevation = clampGeo((terrainGeo(w.seed,r.lon,r.lat)-.02)/1.1,0,1);
    r.coastal = [[2.5,0],[-2.5,0],[0,2.5],[0,-2.5]].some(([x,y])=>terrainGeo(w.seed,r.lon+x,r.lat+y)<.02);
    r.biome = r.elevation>.58?'highlands':Math.abs(r.lat)>51?'tundra':r.water<.5?'drylands':r.water>.7&&r.biomass>.8?'forest':'grassland';
    r.population = 0;
  }
  const all = [];
  for (let i=0; i<w.regions.length; i++) for(let j=i+1; j<w.regions.length; j++) all.push(edgeBetweenGeo(w,w.regions[i],w.regions[j]));
  const order = (a,b)=>a.cost-b.cost||a.distance-b.distance||cmpGeo(a.id,b.id);
  all.sort(order);
  const selected = new Map();
  // Local neighbours provide alternative routes; Kruskal bridges remaining components.
  for (const r of w.regions) for (const e of all.filter(e=>e.a===r.id||e.b===r.id).slice(0,3)) selected.set(e.id,e);
  const parent = new Map(w.regions.map(r=>[r.id,r.id]));
  const find = id=>{while(parent.get(id)!==id){parent.set(id,parent.get(parent.get(id)));id=parent.get(id);}return id;};
  for(const e of all){const a=find(e.a),b=find(e.b);if(a!==b){parent.set(a,b);selected.set(e.id,e);}}
  w.geography = {edges:[...selected.values()].sort((a,b)=>cmpGeo(a.id,b.id)),movements:[]};
  for(const e of w.geography.edges) if(e.kind==='sea') {regionOfGeo(w,e.a).coastal=true;regionOfGeo(w,e.b).coastal=true;}
  const adjacency=adjacencyGeo(w), queue=[], settled=new Set();
  for(const r of w.regions)r.owner=null;
  for(const s of w.societies){regionOfGeo(w,s.capitalId).owner=s.id;queue.push({id:s.capitalId,owner:s.id,cost:0});}
  while(queue.length){
    queue.sort((a,b)=>a.cost-b.cost||cmpGeo(a.owner,b.owner)||cmpGeo(a.id,b.id));
    const item=queue.shift(),r=regionOfGeo(w,item.id);
    if(settled.has(item.id))continue;
    if(r.owner!==null&&r.owner!==item.owner)continue;
    if(r.owner===null)r.owner=item.owner;
    settled.add(r.id);
    for(const {to,edge} of adjacency.get(r.id))if(regionOfGeo(w,to).owner===null)queue.push({id:to,owner:item.owner,cost:item.cost+edge.cost});
  }
  for(const r of w.regions){
    const capital=capitals.has(r.id), specialization=capital?'administration':r.coastal&&randomGeo(w.seed,r.id,'port')>.45?'port':r.reserves>4400?'mining':r.fertility>.62?'agriculture':'crafts';
    const infrastructure=clampGeo(({agriculture:.12,industrial:.37,space:.58}[w.era]??.12)+(capital?.1:0)+randomGeo(w.seed,r.id,'infrastructure')*.08,0,1);
    r.settlement={id:'settlement:'+r.id,name:nameGeo(w.seed,r.id),kind:'village',specialization,infrastructure,founded:w.year};
  }
  syncRegionalPopulations(w);
  for(const r of w.regions)r.settlement.kind=settlementKindGeo(r.population,r.settlement.infrastructure);
  return w.geography;
}

export function regionalCapacity(w, region) {
  const r=regionOfGeo(w,region);if(!r)return 0;
  const s=societyOfGeo(w,r.owner),tech=s?.tech?.[0]??0,infra=r.settlement?.infrastructure??0;
  const specialty=r.settlement?.specialization==='agriculture'?1.1:r.settlement?.specialization==='port'?1.03:1;
  const height=1-r.elevation*.28,climate=Math.abs(r.lat)>51?.84:1,disaster=r.disasterUntil>0&&w.year<=r.disasterUntil?.48:1;
  return Math.max(1,5500*r.fertility*r.biomass*(.6+r.water)*(.7+.65*tech)*height*climate*(.9+infra*.25)*specialty*disaster);
}
export function regionAttractiveness(w, region) {
  const r=regionOfGeo(w,region);if(!r)return 0;
  const s=societyOfGeo(w,r.owner),capacity=regionalCapacity(w,r),density=r.population/Math.max(1,capacity);
  return clampGeo(.2+r.water*.2+r.fertility*.18+(r.settlement?.infrastructure??0)*.18+(s?.stability??.5)*.12+
    Math.max(0,1-density)*.2-r.stress*.18-r.elevation*.09-(r.disasterUntil>0&&w.year<=r.disasterUntil?.22:0),.01,1);
}

/** Allocate only the aggregate population delta; residents do not get reset to
 * a freshly generated distribution every year. This is not a migration event.
 */
export function syncRegionalPopulations(w) {
  for(const s of w.societies){
    if(!Number.isSafeInteger(s.population)||s.population<0)throw new Error('Неверное население общества.');
    const land=w.regions.filter(r=>r.owner===s.id).sort((a,b)=>cmpGeo(a.id,b.id));
    const previous=sumGeo(land,r=>r.population??0),delta=s.population-previous;
    if(!delta)continue;
    if(delta>0){
      const weights=land.map(r=>previous?(r.population??0)*(.8+.2*regionAttractiveness(w,r)):regionalCapacity(w,r));
      const parts=allocationsGeo(delta,land,weights);land.forEach((r,i)=>{r.population=(r.population??0)+parts[i];});
    }else{
      const parts=allocationsGeo(-delta,land,land.map(r=>r.population??0));
      land.forEach((r,i)=>{r.population-=parts[i];if(r.population<0)throw new Error('Нарушен региональный баланс.');});
    }
  }
}
export function syncSocietyPopulations(w) {
  for(const s of w.societies)s.population=sumGeo(w.regions.filter(r=>r.owner===s.id),r=>r.population);
}
/** Call once per model year. Infrastructure is productive but bounded; a
 * deprived region loses it. The current-year movement overlay is not an archive.
 */
export function updateSettlements(w) {
  w.geography.movements=w.geography.movements.filter(m=>m.year===w.year);
  for(const r of w.regions){
    const s=societyOfGeo(w,r.owner),supply=s?.supply??0,tech=s?.tech?.[1]??0;
    const change=supply>.92?.00045*(.6+tech)*(.4+regionAttractiveness(w,r)):-.0015*(1-supply);
    r.settlement.infrastructure=clampGeo(r.settlement.infrastructure+change-r.stress*.0002,.02,.95);
    r.settlement.kind=settlementKindGeo(r.population,r.settlement.infrastructure);
  }
}
function canEnterGeo(w, traveller, owner, options) {
  if(owner===traveller)return true;
  if(!options.allowForeign)return false;
  if(options.ignoreRelations)return true;
  if(w.wars.some(c=>c.active&&[c.a,c.b].includes(traveller)&&[c.a,c.b].includes(owner)))return false;
  const rel=w.relations.find(r=>(r.a===traveller&&r.b===owner)||(r.b===traveller&&r.a===owner));
  return !!rel&&rel.trust>.3;
}
function effectiveCostGeo(w, edge) {
  const a=regionOfGeo(w,edge.a),b=regionOfGeo(w,edge.b);
  return edge.cost/(1+.45*((a.settlement?.infrastructure??0)+(b.settlement?.infrastructure??0)));
}
export function routeBetweenRegions(w, from, to, options={}) {
  if(typeof options==='string')options={societyId:options};
  const start=regionOfGeo(w,from),end=regionOfGeo(w,to);if(!start||!end)return null;
  const traveller=options.societyId??start.owner;
  if(!canEnterGeo(w,traveller,start.owner,options)||!canEnterGeo(w,traveller,end.owner,options))return null;
  if(start.id===end.id)return {regions:[start.id],edges:[],distance:0,cost:0,seaLegs:0};
  const adjacency=adjacencyGeo(w),dist=new Map([[start.id,0]]),previous=new Map(),pending=new Set(w.regions.map(r=>r.id));
  while(pending.size){
    const id=[...pending].sort((a,b)=>(dist.get(a)??Infinity)-(dist.get(b)??Infinity)||cmpGeo(a,b))[0];
    if(!Number.isFinite(dist.get(id)))break;
    pending.delete(id);if(id===end.id)break;
    for(const {to:next,edge} of adjacency.get(id)??[]){
      if(!pending.has(next)||!canEnterGeo(w,traveller,regionOfGeo(w,next).owner,options))continue;
      const cost=dist.get(id)+effectiveCostGeo(w,edge),old=dist.get(next)??Infinity;
      if(cost<old-1e-10||(Math.abs(cost-old)<1e-10&&cmpGeo(id,previous.get(next)?.id??'~')<0)){dist.set(next,cost);previous.set(next,{id,edge});}
    }
  }
  if(!previous.has(end.id))return null;
  const regions=[end.id],edges=[];let cursor=end.id;
  while(cursor!==start.id){const p=previous.get(cursor);if(!p)return null;edges.unshift(p.edge);regions.unshift(p.id);cursor=p.id;}
  return {regions,edges:edges.map(e=>e.id),distance:sumGeo(edges,e=>e.distance),cost:dist.get(end.id),seaLegs:edges.filter(e=>e.kind==='sea').length};
}

/** A route is rechecked at movement time. Supplied paths are display hints only;
 * callers cannot use them to bypass borders or teleport through missing edges.
 */
export function movePopulation(w, from, to, requested, options={}) {
  if(!Number.isSafeInteger(requested)||requested<0)throw new Error('Неверное число переселенцев.');
  const a=regionOfGeo(w,from),b=regionOfGeo(w,to);if(!a||!b||a.id===b.id||!requested)return 0;
  const same=a.owner===b.owner,route=routeBetweenRegions(w,a.id,b.id,{societyId:a.owner,allowForeign:!same});
  if(!route)return 0;
  const count=Math.min(requested,a.population);if(!count)return 0;
  const current=w.geography.movements.filter(m=>m.year===w.year);
  const existing=current.find(m=>m.from===a.id&&m.to===b.id&&m.kind===(same?'internal':'migration')&&m.path.join('|')===route.regions.join('|'));
  if(!existing&&current.length>=MAX_MOVEMENTS)return 0;
  a.population-=count;b.population+=count;
  if(!same){societyOfGeo(w,a.owner).population-=count;societyOfGeo(w,b.owner).population+=count;}
  if(existing)existing.people+=count;
  else current.push({year:w.year,from:a.id,to:b.id,fromOwner:a.owner,toOwner:b.owner,people:count,kind:same?'internal':'migration',path:route.regions,edgeIds:route.edges,distance:route.distance,cost:route.cost});
  w.geography.movements=current;
  return count;
}
export function connectedTerritories(w, ownerId, regionIds) {
  const ids=regionIds??w.regions.filter(r=>r.owner===ownerId).map(r=>r.id);
  return ids.every(id=>w.regions.some(r=>r.id===id))&&connectedIdsGeo(ids,adjacencyGeo(w));
}
export function connectedSecession(w, ownerId, targetCount) {
  const s=societyOfGeo(w,ownerId);if(!s)return [];
  const land=w.regions.filter(r=>r.owner===ownerId),ids=land.map(r=>r.id),adjacency=adjacencyGeo(w);
  if(land.length<3||!connectedIdsGeo(ids,adjacency))return [];
  const target=clampGeo(Number.isSafeInteger(targetCount)?targetCount:Math.max(2,Math.floor(land.length/3)),1,land.length-1);
  const capital=regionOfGeo(w,s.capitalId);
  const candidates=land.filter(r=>r.id!==s.capitalId).sort((a,b)=>angleGeo(capital,b)-angleGeo(capital,a)||cmpGeo(a.id,b.id));
  let best=[];
  for(const root of candidates){
    const chosen=new Set([root.id]);
    if(!connectedIdsGeo(ids.filter(id=>!chosen.has(id)),adjacency))continue;
    while(chosen.size<target){
      const frontier=[...new Set([...chosen].flatMap(id=>(adjacency.get(id)??[]).map(e=>e.to)))].filter(id=>ids.includes(id)&&id!==s.capitalId&&!chosen.has(id));
      frontier.sort((a,b)=>angleGeo(capital,regionOfGeo(w,b))-angleGeo(capital,regionOfGeo(w,a))||cmpGeo(a,b));
      const next=frontier.find(id=>connectedIdsGeo(ids.filter(other=>!chosen.has(other)&&other!==id),adjacency));
      if(!next)break;chosen.add(next);
    }
    if(chosen.size>best.length)best=[...chosen];
    if(chosen.size===target)break;
  }
  return best.sort(cmpGeo);
}
export function transferRegion(w, regionId, newOwnerId) {
  const r=regionOfGeo(w,regionId),newOwner=societyOfGeo(w,newOwnerId),oldOwner=r?societyOfGeo(w,r.owner):null;
  if(!r||!oldOwner||!newOwner||newOwner.id===oldOwner.id||r.id===oldOwner.capitalId)return false;
  const oldLand=w.regions.filter(x=>x.owner===oldOwner.id&&x.id!==r.id).map(x=>x.id),newLand=w.regions.filter(x=>x.owner===newOwner.id).map(x=>x.id),adjacency=adjacencyGeo(w);
  if(!oldLand.length||!(adjacency.get(r.id)??[]).some(e=>newLand.includes(e.to))||!connectedIdsGeo(oldLand,adjacency)||!connectedIdsGeo([...newLand,r.id],adjacency))return false;
  r.owner=newOwner.id;oldOwner.population-=r.population;newOwner.population+=r.population;
  return true;
}

export function geographySummary(w) {
  const moves=(w.geography?.movements??[]).filter(m=>m.year===w.year);
  return {regions:w.regions.length,settlements:w.regions.filter(r=>r.population>0).length,towns:w.regions.filter(r=>r.population>0&&r.settlement.kind==='town').length,cities:w.regions.filter(r=>r.population>0&&r.settlement.kind==='city').length,
    landRoutes:w.geography.edges.filter(e=>e.kind==='land').length,seaRoutes:w.geography.edges.filter(e=>e.kind==='sea').length,population:sumGeo(w.regions,r=>r.population),internalMigrants:sumGeo(moves.filter(m=>m.kind==='internal'),m=>m.people),externalMigrants:sumGeo(moves.filter(m=>m.kind==='migration'),m=>m.people)};
}
export function regionSummary(w, id) {
  const r=regionOfGeo(w,id);if(!r)return null;
  const neighbours=(adjacencyGeo(w).get(r.id)??[]).map(({to,edge})=>{const n=regionOfGeo(w,to);return {id:n.id,name:n.settlement.name,owner:n.owner,kind:edge.kind,distance:edge.distance,cost:effectiveCostGeo(w,edge)};});
  return {id:r.id,name:r.settlement.name,owner:r.owner,population:r.population,capacity:regionalCapacity(w,r),attractiveness:regionAttractiveness(w,r),elevation:r.elevation,coastal:r.coastal,biome:r.biome,biomeLabel:BIOME_NAMES[r.biome],water:r.water,fertility:r.fertility,biomass:r.biomass,stress:r.stress,reserves:r.reserves,settlement:{...copyGeo(r.settlement),kindLabel:SETTLEMENT_NAMES[r.settlement.kind],specializationLabel:SPECIALIZATION_NAMES[r.settlement.specialization]},neighbors:neighbours,movements:copyGeo(w.geography.movements.filter(m=>m.from===r.id||m.to===r.id))};
}

function validateMovementGeo(w,m,rids,sids,byEdge) {
  const fail=label=>{throw new Error('Некорректная география: '+label);};
  if(!m||!Number.isSafeInteger(m.year)||m.year<0||m.year>w.year||!rids.has(m.from)||!rids.has(m.to)||m.from===m.to||!sids.has(m.fromOwner)||!sids.has(m.toOwner)||!Number.isSafeInteger(m.people)||m.people<=0||m.people>1e12||!['internal','migration'].includes(m.kind)||(m.kind==='internal')!==(m.fromOwner===m.toOwner))fail('переселение');
  if(!Array.isArray(m.path)||m.path.length<2||m.path.length>w.regions.length||new Set(m.path).size!==m.path.length||m.path.some(id=>!rids.has(id))||m.path[0]!==m.from||m.path.at(-1)!==m.to||!Array.isArray(m.edgeIds)||m.edgeIds.length!==m.path.length-1||!Number.isFinite(m.cost)||m.cost<=0||!Number.isFinite(m.distance)||m.distance<=0)fail('путь переселения');
  let distance=0;
  for(let i=0;i<m.edgeIds.length;i++){
    const e=byEdge.get(m.edgeIds[i]);if(!e||!([e.a,e.b].includes(m.path[i])&&[e.a,e.b].includes(m.path[i+1])))fail('несуществующий этап');
    distance+=e.distance;
  }
  if(distance!==m.distance)fail('длина переселения');
  // These are historical facts. Neither current borders/diplomacy nor current
  // infrastructure costs can invalidate a route used in a preceding year.
  return true;
}

/** Validate one archived movement against the stable region/route identities.
 * Does not recalculate access, population balances or the full world graph.
 * The owning world's geography is validated separately by validateGeography.
 */
export function validateMovement(w,m) {
  return validateMovementGeo(w,m,new Set(w.regions.map(r=>r.id)),new Set(w.societies.map(s=>s.id)),new Map(w.geography.edges.map(e=>[e.id,e])));
}

export function validateGeography(w) {
  const fail=label=>{throw new Error('Некорректная география: '+label);};
  if(!w.geography||!Array.isArray(w.geography.edges)||!Array.isArray(w.geography.movements))fail('сеть');
  if(w.geography.edges.length>w.regions.length*4||w.geography.movements.length>MAX_MOVEMENTS)fail('размер сети');
  const rids=new Set(w.regions.map(r=>r.id)),sids=new Set(w.societies.map(s=>s.id)),settlements=new Set(),edgeIds=new Set(),pairs=new Set();
  for(const r of w.regions){
    if(!Number.isSafeInteger(r.population)||r.population<0||r.population>1e12)fail('население региона');
    if(!sids.has(r.owner)||!Number.isFinite(r.elevation)||r.elevation<0||r.elevation>1||typeof r.coastal!=='boolean'||!Object.hasOwn(BIOME_NAMES,r.biome))fail('среда региона');
    const s=r.settlement;
    if(!s||s.id!=='settlement:'+r.id||settlements.has(s.id)||typeof s.name!=='string'||!s.name||s.name.length>128||!Object.hasOwn(SETTLEMENT_NAMES,s.kind)||!Object.hasOwn(SPECIALIZATION_NAMES,s.specialization)||!Number.isFinite(s.infrastructure)||s.infrastructure<0||s.infrastructure>1||!Number.isSafeInteger(s.founded)||s.founded<0||s.founded>w.year)fail('поселение');
    settlements.add(s.id);
  }
  for(const e of w.geography.edges){
    const pair=[e.a,e.b].sort(cmpGeo).join(':');
    if(!rids.has(e.a)||!rids.has(e.b)||e.a===e.b||typeof e.id!=='string'||e.id!=='g:'+pair||edgeIds.has(e.id)||pairs.has(pair)||!['land','sea'].includes(e.kind)||!Number.isFinite(e.distance)||e.distance<=0||e.distance>Math.PI*EARTH_RADIUS+1||!Number.isFinite(e.cost)||e.cost<=0||e.cost>1000)fail('маршрут');
    edgeIds.add(e.id);pairs.add(pair);
  }
  const adjacency=adjacencyGeo(w);
  if(!connectedIdsGeo([...rids],adjacency))fail('разорванная сеть');
  for(const s of w.societies){
    const land=w.regions.filter(r=>r.owner===s.id);
    if(!land.some(r=>r.id===s.capitalId)||!connectedIdsGeo(land.map(r=>r.id),adjacency)||sumGeo(land,r=>r.population)!==s.population)fail('территория/баланс общества');
  }
  const byEdge=new Map(w.geography.edges.map(e=>[e.id,e]));
  for(const m of w.geography.movements)validateMovementGeo(w,m,rids,sids,byEdge);
  return true;
}
