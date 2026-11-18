const PlaceFocus = (() => {
  let host, controls, observer, canvas, selected, selectedYear, sourceOpen = false;
  let historyLimit = 5, compareYear = null, sceneKey = '', lastScene = null;
  let detail = 'region', signals = false, selectedObject = null, selectedAnchor = null;
  let previousFocus;
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const state = () => controls?.get?.() || {};
  const liveYear = s => Number.isFinite(s.liveYear) ? s.liveYear : s.world?.year;
  function availableYears(s) {
    const end = liveYear(s);
    return [...new Set((Array.isArray(s.timeline) ? s.timeline : [])
      .map(item => typeof item === 'number' ? item : item?.year)
      .filter(year => Number.isFinite(year) && year <= end)
      .concat(Number.isFinite(s.world?.year) ? [s.world.year] : []))].sort((a,b) => a-b);
  }
  function visibleRecords(s) {
    return (Array.isArray(s.records) ? s.records : [])
      .filter(record => Number.isFinite(record.year) && record.year <= s.world?.year)
      .sort((a,b) => b.year-a.year);
  }
  function projectRecord(s, records) {
    if (!s.project) return null;
    const id = s.project.id;
    const kinds=['foundation','payment','purpose','completed','ownership','dismantled'];
    return records.find(r => r.regionId===s.project.site && r.year>=s.project.started && kinds.includes(r.kind))
      || records.find(r => id!=null && r.sourceId===id) || null;
  }
  function sceneCaption(s) {
    const pop = new Intl.NumberFormat('ru-RU').format(s.region.population);
    const project = s.project;
    if (!project) return s.region.population?'Жители региона · '+pop:'Постоянных жителей нет';
    const purpose = {passage:'переправа',irrigation:'водоснабжение хозяйств'}[project.purpose];
    const state = {building:'Строится',paused:'Работы приостановлены',completed:'Завершено',dismantled:'Разобрано'}[project.status];
    return [state,purpose].filter(Boolean).join(' · ') || 'Работы на реке';
  }
  function drawScene() {
    if (!host || !canvas || !lastScene || typeof PlaceLandscape === 'undefined') return;
    const {world,region,project,basin,settlement}=lastScene;
    if (world && region) PlaceLandscape.draw(canvas, world, region, {
      project, basin, year:world.year, settlement, detail, signals, selectedId:selectedObject, anchor:selectedAnchor
    });
  }
  function ensureScene(s) {
    const region = s.region, world = s.world;
    const key = JSON.stringify([world?.seed, world?.year, region?.id, s.settlement, s.project, detail, signals, selectedObject, selectedAnchor]);
    lastScene = {world, region, project:s.project, basin:s.basin, settlement:s.settlement};
    if (key !== sceneKey) {sceneKey = key; drawScene();}
  }
  function sceneControls(){
    return '<div class="pf-scene-controls"><div role="group" aria-label="Масштаб местности">'+
      '<button type="button" data-pf="detail" data-id="region" aria-pressed="'+(detail==='region')+'">Общий вид</button>'+
      '<button type="button" data-pf="detail" data-id="district" aria-pressed="'+(detail==='district')+'">Крупный план</button></div>'+
      '<button type="button" data-pf="signals" aria-pressed="'+signals+'">Сигналы</button></div>';
  }
  function objectCard(s,records){
    const objects=s.settlement?.objects||[];
    const current=objects.find(o=>o.id===selectedObject);
    const options=objects.map(o=>'<option value="'+escapeHtml(o.id)+'"'+(current===o?' selected':'')+'>'+escapeHtml(o.label)+'</option>').join('');
    const sourceLink=current?.kind==='project'&&projectRecord(s,records)
      ? '<button type="button" data-pf="project">Запись о сооружении →</button>' : '';
    return '<section class="pf-object"><label>Объект на местности<select data-pf="object">'+
      '<option value="">Выбрать на сцене или из списка</option>'+options+'</select></label>'+
      '<div class="pf-object-note" aria-live="polite">'+(current?'<span>Состояние на год '+escapeHtml(s.world.year)+'</span>'+
      '<p>'+escapeHtml(current.evidence)+'</p>'+sourceLink:'')+'</div></section>';
  }
  function recordMarkup(record, s) {
    if (!record) return '<p>К этому году записей о месте нет.</p>';
    const related=(record.relatedIds||[]).map(id=>s.records.find(item=>item.id===id&&item.year<=s.world.year)).filter(Boolean);
    const links=related.map(item=>'<button type="button" data-pf="record" data-id="'+escapeHtml(item.id)+'">'+escapeHtml(item.year)+' · '+escapeHtml(item.title)+'</button>').join('');
    const source = sourceOpen
      ? '<div class="pf-source"><b>Источник</b><p>'+escapeHtml(record.source || 'Не указан')+' · '+escapeHtml(record.sourceId||record.id)+'</p>'+(record.detail ? '<p>'+escapeHtml(record.detail)+'</p>' : '') +links+'<button type="button" data-pf="source">← К записи</button></div>'
      : '<p>'+escapeHtml(record.text || 'Описание не записано.')+'</p><button type="button" data-pf="source">Источник →</button>';
    const jump = availableYears(s).includes(record.year) && record.year !== s.world?.year
      ? '<button type="button" data-pf="record-year">Показать год записи '+escapeHtml(record.year)+'</button>' : '';
    return '<article class="pf-record"><span class="pf-overline">ЗАПИСЬ · '+escapeHtml(record.year)+'</span><h3>'+escapeHtml(record.title || 'Запись')+'</h3>'+source+jump+'</article>';
  }
  function markup(s, records, record) {
    const world = s.world || {}, year = world.year, live = liveYear(s), dates = availableYears(s);
    if (!dates.includes(compareYear)) compareYear = dates.filter(y => y < year).at(-1) ?? year;
    const options = dates.map(y => '<option value="'+y+'"'+(y===compareYear?' selected':'')+'>'+y+(y===live?' · настоящее':'')+'</option>').join('');
    const list = records.slice(0, historyLimit).map(r => '<li><button type="button" data-pf="record" data-id="'+escapeHtml(r.id)+'" aria-pressed="'+(r === record)+'"><time>'+escapeHtml(r.year)+'</time> '+escapeHtml(r.title || 'Запись')+'</button></li>').join('');
    const more = records.length > historyLimit ? '<button type="button" data-pf="more">Показать ещё записи ('+(records.length-historyLimit)+')</button>' : '';
    const label = s.region?.settlement?.name || s.label || s.region?.id || 'Выбранное место';
    const location = s.label?.startsWith(label+' (') ? ' · '+s.label.slice(label.length+2).replace(/\)$/,'') : '';
    return '<section class="place-focus" aria-label="Наблюдение за местом">'+
      '<header class="pf-header"><button type="button" data-pf="close">← '+(s.demo?'К обсерватории':'К планете')+'</button><div class="pf-heading"><span>'+escapeHtml((world.seed||'Мир')+location)+'</span><h2>'+escapeHtml(label)+'</h2></div><div class="pf-year">Год <strong>'+escapeHtml(year ?? '—')+'</strong><small>'+(year === live ? (s.demo?'Год примера':'Настоящее') : 'Исторический срез · последнее наблюдение '+escapeHtml(live))+'</small></div></header>'+
      '<div class="pf-main"><div class="pf-land"><div class="pf-scene"><div class="pf-canvas-slot"></div></div>'+
      '<div class="pf-scene-bar">'+sceneControls()+'<p>'+escapeHtml(sceneCaption(s))+'</p></div></div>'+
      '<aside class="pf-card">'+objectCard(s,records)+'<div class="pf-actions"><button type="button" data-pf="pin" aria-pressed="'+!!s.pinned+'">'+(s.pinned?'Открепить':'Закрепить')+'</button><button type="button" data-pf="next"'+(s.busy?' disabled':'')+'>Следующее изменение →</button></div>'+
      (s.message?'<p class="pf-message" role="status">'+escapeHtml(s.message)+'</p>':'')+recordMarkup(record, s)+
      '<div class="pf-date"><label>Сравнить с годом <select data-pf="compare-year">'+options+'</select></label><button type="button" data-pf="goto-year"'+(compareYear===year || s.busy?' disabled':'')+'>Показать '+escapeHtml(compareYear)+'</button></div>'+
      '<div class="pf-archive"><h4>История до '+escapeHtml(year ?? '—')+' года</h4><ol>'+list+'</ol>'+more+'</div></aside></div></section>';
  }
  function render() {
    if (!host) return;
    const s = state(), year = s.world?.year;
    if (year !== selectedYear) {selected = null; selectedYear = year; sourceOpen = false; historyLimit = 5;}
    const records = visibleRecords(s);
    const record = records.find(r => String(r.id) === String(selected)) || records[0] || null;
    selected = record?.id ?? null;
    const active = document.activeElement;
    const focus = host.contains(active) ? {action:active.dataset.pf, id:active.dataset.id} : null;
    host.innerHTML = markup(s, records, record);
    host.querySelector('.pf-canvas-slot').appendChild(canvas);
    ensureScene(s);
    if (focus) {
      const target = [...host.querySelectorAll('[data-pf]')].find(el => el.dataset.pf === focus.action && el.dataset.id === focus.id && !el.disabled);
      target?.focus({preventScroll:true});
    }
  }
  function click(event) {
    if(event.target===canvas){
      const rect=canvas.getBoundingClientRect();
      const picked=PlaceLandscape.pick(canvas,event.clientX-rect.left,event.clientY-rect.top);
      if(picked && (state().settlement?.objects||[]).some(o=>o.id===picked.id)){
        selectedObject=picked.id;selectedAnchor=picked.anchor;render();
      }
      return;
    }
    const button = event.target.closest('[data-pf]');
    if (!button || !host?.contains(button) || button.tagName === 'SELECT') return;
    const action = button.dataset.pf, s = state();
    if (action === 'detail') {detail=button.dataset.id==='district'?'district':'region';render();}
    else if (action === 'signals') {signals=!signals;render();}
    else if (action === 'record') {selected = button.dataset.id; sourceOpen = false; render();}
    else if (action === 'project') {const record = projectRecord(s, visibleRecords(s)); if (record) {selected = record.id; sourceOpen = false; render(); host.querySelector('.pf-record')?.scrollIntoView({block:'nearest'});}}
    else if (action === 'source') {sourceOpen = !sourceOpen; render();}
    else if (action === 'more') {historyLimit += 20; render();}
    else if (action === 'record-year') {const record = visibleRecords(s).find(r => String(r.id) === String(selected)); if (record && availableYears(s).includes(record.year)) controls.onAction('year', record.year);}
    else if (action === 'goto-year' && availableYears(s).includes(compareYear)) {
      const targetYear = compareYear;
      compareYear = s.world.year;
      controls.onAction('year',targetYear);
    }
    else if (['close','next','pin'].includes(action)) controls.onAction(action);
  }
  function change(event) {
    if(event.target.dataset.pf==='object'){
      selectedObject=(state().settlement?.objects||[]).find(o=>o.id===event.target.value)?.id||null;
      selectedAnchor=null;
      render();return;
    }
    if (event.target.dataset.pf !== 'compare-year') return;
    const year = Number(event.target.value);
    if (availableYears(state()).includes(year)) {compareYear = year; render();}
  }
  function open(node, api) {
    if (host) close();
    host = node; controls = api; selected = null; selectedYear = undefined; sourceOpen = false; historyLimit = 5; compareYear = null; sceneKey = ''; previousFocus = document.activeElement;
    const initial=state();
    selectedObject=initial.settlement?.objects.find(o=>o.kind===initial.focusKind)?.id||null;
    detail=selectedObject && initial.focusKind!=='terrain'?'district':'region';
    signals=false;selectedAnchor=null;
    canvas = document.createElement('canvas'); canvas.setAttribute('aria-label','Вид выбранного места. Объекты также доступны в списке под названием «Объект на местности».');
    host.addEventListener('click', click); host.addEventListener('change', change); render();
    if (typeof ResizeObserver !== 'undefined') {observer = new ResizeObserver(() => drawScene()); observer.observe(canvas);}
    host.querySelector('[data-pf="close"]')?.focus({preventScroll:true});
  }
  function close() {
    if (!host) return;
    observer?.disconnect(); observer = null;
    host.removeEventListener('click', click); host.removeEventListener('change', change); host.innerHTML = '';
    host = null; controls = null; canvas = null; lastScene = null;
    if (previousFocus?.isConnected) previousFocus.focus({preventScroll:true}); previousFocus = null;
  }
  return {open, refresh:render, close};
})();
