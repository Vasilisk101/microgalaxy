// The home observatory forwards a dated report. A ship can act only once it reaches its prospective partner.
export function initialize(w) {
  w.observatory.space.exchange={active:[],recent:[],sent:0,arrived:0,deliveries:0,next:1};
}
export function advance(w, distance, options) {
  const space=w.observatory.space, x=space.exchange;
  const colonies=new Map(w.colonies.map(c=>[c.id,c]));
  for(const trip of x.active.filter(t=>t.arrival<=w.year)){
    colonies.get(trip.to).food+=trip.food;
    x.arrived+=trip.food;x.deliveries++;
    x.recent.push(trip);if(x.recent.length>12)x.recent.shift();
  }
  x.active=x.active.filter(t=>t.arrival>w.year);
  if(colonies.size<2)return;
  // Quantities are the last received observation, so discovery and news both take time.
  const reports=new Map();
  for(const m of space.messages){
    if(m.delivered&&m.to==='home'&&m.payload.kind==='colony-status')reports.set(m.from,m);
  }
  const home=w.planets.find(p=>p.home);
  for(const donor of colonies.values()){
    const local=space.colonies[donor.id];
    if(!local?.connected||!local.skills.includes('orbital')||!donor.population||donor.food<4.5*donor.population||local.equipment<6||local.raw<6)continue;
    if(local.lastFreight!=null&&w.year-local.lastFreight<30)continue;
    if(!reports.has(donor.id))continue;
    const relay=Math.max(1,Math.ceil(distance(w,home.id,donor.planet)*3));
    const received=[...reports.values()].filter(m=>m.from!==donor.id&&m.deliveredYear+relay<=w.year&&w.year-m.observedYear<=75&&m.payload.population>0&&m.payload.food<2.5*m.payload.population)
      .sort((a,b)=>a.payload.food/a.payload.population-b.payload.food/b.payload.population||a.from.localeCompare(b.from));
    for(const m of received){
      const receiver=colonies.get(m.from);
      if(!receiver||x.active.some(t=>t.to===receiver.id))continue;
      const leg=receiver.planet===donor.planet?{reachable:true,window:true,travelYears:1}:options(w,donor.planet,local.skills.includes('industry')?3:1).find(t=>t.id===receiver.planet);
      if(!leg?.reachable||!leg.window)continue;
      const food=Math.floor(Math.min(donor.food-4*donor.population,3*m.payload.population-m.payload.food,donor.population*.5));
      if(food<=0)continue;
      donor.food-=food;local.raw-=2;local.equipment-=1;local.lastFreight=w.year;
      x.sent+=food;x.active.push({id:x.next++,from:donor.id,to:receiver.id,food,departure:w.year,arrival:w.year+leg.travelYears,reportYear:m.observedYear,knownYear:m.deliveredYear+relay});
      break;
    }
  }
}
export function validate(w) {
  const x=w.observatory.space.exchange,ids=new Set(w.colonies.map(c=>c.id));
  const bounded=n=>Number.isSafeInteger(n)&&n>=0;
  if(!x||!Array.isArray(x.recent)||x.recent.length>12||!Array.isArray(x.active)||x.active.length>w.colonies.length||![x.sent,x.arrived,x.next,x.deliveries].every(bounded))throw Error('Некорректный учёт перевозок между поселениями.');
  const refs=new Set();
  for(const t of [...x.recent,...x.active]){
    if(!t||!ids.has(t.from)||!ids.has(t.to)||t.from===t.to||!bounded(t.id)||t.id<1||t.id>=x.next||refs.has(t.id)||!bounded(t.food)||!t.food||![t.departure,t.arrival,t.knownYear,t.reportYear].every(bounded)||t.reportYear>t.knownYear||t.knownYear>t.departure||t.departure>w.year||t.arrival<=t.departure)throw Error('Некорректный межколониальный рейс.');
    refs.add(t.id);
  }
  if(x.recent.some(t=>t.arrival>w.year)||x.active.some(t=>t.arrival<=w.year)||x.arrived+x.active.reduce((a,t)=>a+t.food,0)!==x.sent||x.next!==1+x.active.length+x.deliveries)throw Error('Расхождение в движении межколониальных грузов.');
}
