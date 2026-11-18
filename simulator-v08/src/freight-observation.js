/* Freight receipts are observer data, kept outside the simulation snapshot. */
const FreightObservation = (()=>{
 let watched=null, worldId=null;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const copy=v=>structuredClone(v);
 const num=n=>Number.isFinite(n)?new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(n):'нет данных';
 const region=(w,id)=>w.regions.find(r=>r.id===id)?.settlement?.name??id;
 const res={energy:'Энергия',food:'Пища',raw:'Сырьё',equipment:'Оборудование'};
 function sync(w){if(worldId!==w?.id){worldId=w?.id??null;watched=null;}}
 function start(w,id){sync(w);const sh=w.economy?.shipments.find(s=>s.id===id);if(!sh)return false;const receiver=w.regions.find(r=>r.id===sh.to);watched={id:sh.id,worldId:w.id,started:w.year,shipment:copy(sh),lastYear:w.year,records:[{year:w.year,kind:'observed',status:sh.status,amount:sh.amount,arrival:sh.arrival,receiverStock:receiver?.economy?.stock?.[sh.resource]??null}]};return true;}
 function active(){return watched?copy(watched):null;}
 function stop(){watched=null;}
 function observeYear(before,after,receipts=[]){
  if(!watched||before?.id!==watched.worldId||after?.id!==watched.worldId)return false;
  if(after.year!==before.year+1||before.year!==watched.lastYear){watched.records.push({year:after.year,kind:'gap',from:watched.lastYear});watched.lastYear=after.year;return false;}
  const old=before.economy.shipments.find(s=>s.id===watched.id),next=after.economy.shipments.find(s=>s.id===watched.id);
  if(!old){watched.lastYear=after.year;return false;}
  const receipt=receipts.find(r=>r.id===watched.id&&r.year===after.year&&['delivered','lost'].includes(r.kind));
  const waitingReceipt=receipts.find(r=>r.id===watched.id&&r.year===after.year&&r.kind==='waiting');
  const closed=Array.isArray(waitingReceipt?.closed)?waitingReceipt.closed.filter(x=>old.path.includes(x.edgeId)&&typeof x.reason==='string'&&x.reason.length<=200).map(x=>({edgeId:x.edgeId,reason:x.reason})):[];
  const receiver=after.regions.find(r=>r.id===old.to),stock=receiver?.economy?.stock?.[old.resource]??null;
  if(next){watched.records.push({year:after.year,kind:'state',status:next.status,amount:next.amount,amountChange:next.amount-old.amount,arrival:next.arrival,receiverStock:stock,...(next.status==='waiting'&&closed.length?{closed}: {})});watched.shipment=copy(next);}
  else if(receipt){watched.records.push({year:after.year,kind:receipt.kind,amountBefore:old.amount,delivered:Number.isFinite(receipt.delivered)?receipt.delivered:null,lost:Number.isFinite(receipt.lost)?receipt.lost:null,receiverStock:stock,...(closed.length?{closed}:{})});}
  else watched.records.push({year:after.year,kind:'unknown',amountBefore:old.amount,receiverStock:stock});
  watched.lastYear=after.year;return true;
 }
 function route(w){if(!watched||watched.worldId!==w.id||w.year<watched.started)return null;return {worldId:watched.worldId,id:watched.id,from:watched.shipment.from,to:watched.shipment.to,path:[...watched.shipment.path]};}
 function economyHtml(w){sync(w);const rows=w.economy?.shipments??[];return '<section class="chart-block freight-observer"><h2>Наблюдение за партией</h2><p class="subtitle">Выберите реальную партию в пути. Журнал начинается с момента выбора. Его можно перенести вместе с соответствующим годом мира через панель наблюдения.</p>'+(watched?'<p>Выбрана партия '+esc(watched.id)+' · с '+watched.started+' года</p><button type="button" data-freight="log">Открыть журнал</button> <button type="button" data-freight="map">Показать путь на глобусе</button> <button type="button" data-freight="stop">Прекратить наблюдение</button>':'')+(rows.length?'<ul class="economy-list">'+rows.slice(0,50).map(s=>'<li><b>'+esc(s.id)+'</b> · '+esc(region(w,s.from))+' → '+esc(region(w,s.to))+' · '+esc(res[s.resource]??s.resource)+' '+num(s.amount)+' · '+(s.status==='waiting'?'ожидает':'в пути')+' <button type="button" data-freight-watch="'+esc(s.id)+'">Следить</button></li>').join('')+'</ul>'+(rows.length>50?'<p class="subtitle">Показаны первые 50 из '+rows.length+' партий.</p>':''):'<p>В выбранном состоянии партий в пути нет.</p>')+'</section>';}
 function portHtml(w,id){const r=w.regions.find(x=>x.id===id);if(!r?.coastal||!(r.economy?.port>0))return '';const edges=new Map(w.economy.routes.map(e=>[e.id,e]));const rows=w.economy.shipments.filter(sh=>(sh.from===id&&edges.get(sh.path[0])?.kind==='sea')||(sh.to===id&&edges.get(sh.path.at(-1))?.kind==='sea'));return '<section class="development-section"><h3>Партии порта</h3><p>Только партии в пути, связанные с морским участком этого региона.</p>'+(rows.length?'<ul>'+rows.map(sh=>'<li>'+esc(sh.id)+' · '+esc(region(w,sh.from))+' → '+esc(region(w,sh.to))+' · '+esc(res[sh.resource]??sh.resource)+' '+num(sh.amount)+' <button data-freight-watch="'+esc(sh.id)+'">Открыть ведомость</button></li>').join('')+'</ul>':'<p>В выбранном году таких партий в пути нет.</p>')+'</section>';}
 function balance(records){
  const first=records[0];if(!first||records.some(r=>r.kind==='gap'||r.kind==='unknown'))return null;
  let lost=0,delivered=0,remaining=first.amount;
  for(const row of records.slice(1)){
    if(row.kind==='state'){if(!Number.isFinite(row.amountChange)||row.amountChange>1e-8)return null;lost-=row.amountChange;remaining=row.amount;}
    else if(row.kind==='delivered'||row.kind==='lost'){if(!Number.isFinite(row.lost)||(row.kind==='delivered'&&!Number.isFinite(row.delivered)))return null;lost+=row.lost;delivered+=row.delivered??0;remaining=0;}
  }
  const residual=first.amount-lost-delivered-remaining;
  return {baseline:first.amount,lost,delivered,remaining,residual};
 }
 function logHtml(w){if(!watched)return '<p>Партия не выбрана.</p>';if(w.year<watched.started)return '<p>На выбранный год наблюдение ещё не началось.</p>';const sh=watched.shipment,visible=watched.records.filter(r=>r.year<=w.year),bal=balance(visible),balanceText=bal?'<p>Баланс с начала наблюдения: '+num(bal.baseline)+' = в пути '+num(bal.remaining)+' + доставлено '+num(bal.delivered)+' + потери '+num(bal.lost)+'; разница '+num(bal.residual)+'.</p>':'<p>Полный баланс с начала наблюдения неизвестен: есть пропуск или неподтверждённый исход.</p>';return '<p><b>'+esc(sh.id)+'</b> · '+esc(region(w,sh.from))+' → '+esc(region(w,sh.to))+' · '+esc(res[sh.resource]??sh.resource)+'</p><p>Отправление: год '+sh.departure+'. Наблюдение начато в '+watched.started+' году; количество в тот момент: '+num(watched.records[0].amount)+'. Первоначальное количество и прошлые потери могут быть неизвестны.</p><p>Известен запланированный путь из '+sh.path.length+' участков. Положение партии на нём модель не записывает.</p><ol class="freight-log">'+visible.map(r=>{let text;if(r.kind==='observed'||r.kind==='state')text=(r.status==='waiting'?'Ожидает открытия пути':'В пути')+' · остаток '+num(r.amount)+' · ожидаемый год прибытия '+r.arrival+(r.kind==='state'&&r.amountChange<0?' · изменение остатка '+num(r.amountChange):'');else if(r.kind==='delivered')text='Подтверждена доставка · доставлено '+num(r.delivered)+' · потери '+num(r.lost);else if(r.kind==='lost')text='Подтверждена потеря · потери '+num(r.lost);else if(r.kind==='gap')text='Пропуск наблюдения после '+r.from+' года: промежуточные изменения неизвестны';else text='Партия отсутствует в следующем состоянии; подтверждение её исхода недоступно';if(r.status==='waiting'||r.kind==='lost'&&r.closed?.length)text+=r.closed?.length?' · закрытые участки: '+r.closed.map(x=>x.edgeId+' — '+x.reason).join('; '):' · причина в журнале не сохранена';return '<li><b>Год '+esc(r.year)+'</b> · '+esc(text)+(r.receiverStock===null||r.receiverStock===undefined?'':'<small>Запас получателя на конец года: '+num(r.receiverStock)+'; на него влияют и другие операции.</small>')+'</li>';}).join('')+'</ol>'+balanceText+'<p class="form-hint">Запас получателя — общий показатель региона, не эффект только этой партии. Журнал не восстанавливает пропущенные годы и не изменяет мир.</p><div class="dialog-actions"><button data-freight="map">Показать путь на глобусе</button></div>';}
 function restore(w,state){sync(w);watched=state?{...copy(state),worldId:w.id}:null;}
 return {sync,start,active,restore,selectedId:()=>watched?.id??null,stop,observeYear,route,economyHtml,portHtml,logHtml};
})();
function freightPortHtml(w,id){return FreightObservation.portHtml(w,id);}
function freightEconomyHtml(w){return FreightObservation.economyHtml(w);}
function freightObserveYear(before,after,receipts=[]){return FreightObservation.observeYear(before,after,receipts);}
function freightRoute(w){return FreightObservation.route(w);}
function freightClick(button){
 if(!button||(!button.dataset.freight&&!button.dataset.freightWatch))return false;
 if(button.dataset.freightWatch){if(snapshotIndex!==null){notice('Начать наблюдение можно только в настоящем состоянии мира.');return true;}if(FreightObservation.start(world,button.dataset.freightWatch)){setRunning(false);render();if(typeof observationChanged==='function')void observationChanged();modal('Журнал партии',FreightObservation.logHtml(world),true);}return true;}
 if(button.dataset.freight==='stop'){FreightObservation.stop();if(typeof observationChanged==='function')void observationChanged();renderer.setFreightRoute(null);render();return true;}
 if(button.dataset.freight==='log'){modal('Журнал партии',FreightObservation.logHtml(displayed()),true);return true;}
 if(button.dataset.freight==='map'){const w=displayed(),route=FreightObservation.route(w);if(!route){notice('Для выбранного года путь не наблюдался.');return true;}setRunning(false);selectedPlanet=w.planets.find(p=>p.home).id;selectedRegion=route.from;view='planet';layer='settlements';if($('#dialog').open)$('#dialog').close();renderer.setFreightRoute(route);render();renderer.focusRegion(route.from);notice('Пунктир — известный путь партии. Текущее положение на пути не хранится.');return true;}
 return false;
}
