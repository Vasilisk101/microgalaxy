const PlaceFocus = (() => {
  let host, controls, observer, canvas, selected, selectedYear, sourceOpen = false;
  let historyLimit = 5, compareYear = null, sceneKey = '', lastScene = null;
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
    if (!project) return 'Жители региона · '+pop;
    const purpose = {passage:'переправа',irrigation:'водоснабжение хозяйств'}[project.purpose];
    const state = {building:'Строится',paused:'Работы приостановлены',completed:'Завершено',dismantled:'Разобрано'}[project.status];
    return [state,purpose].filter(Boolean).join(' · ') || 'Работы на реке';
  }
  function drawScene() {
    if (!host || !canvas || !lastScene || typeof PlaceLandscape === 'undefined') return;
    const {world, region, project, basin} = lastScene;
    if (world && region) PlaceLandscape.draw(canvas, world, region, {project, basin, year:world.year});
  }
  function ensureScene(s) {
    const region = s.region, world = s.world;
    const key = JSON.stringify([world?.seed, world?.year, region?.id, s.project, s.basin]);
    lastScene = {world, region, project:s.project, basin:s.basin};
    if (key !== sceneKey) {sceneKey = key; drawScene();}
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
    const label = s.label || s.region?.settlement?.name || s.region?.name || s.region?.id || 'Выбранное место';
    const projectButton = projectRecord(s, records) ? '<button type="button" class="pf-project" data-pf="project">Сооружение →</button>' : '';
    return '<section class="place-focus" aria-label="Наблюдение за местом">'+
      '<header class="pf-header"><button type="button" data-pf="close">← '+(s.demo?'К обсерватории':'К планете')+'</button><div class="pf-heading"><span>'+escapeHtml(world.seed || 'Мир')+'</span><h2>'+escapeHtml(label)+'</h2></div><div class="pf-year">Год <strong>'+escapeHtml(year ?? '—')+'</strong><small>'+(year === live ? 'Настоящее' : 'Исторический срез · настоящее '+escapeHtml(live))+'</small></div></header>'+
      '<div class="pf-main"><div class="pf-scene"><div class="pf-canvas-slot"></div><p class="pf-scene-data">'+escapeHtml(sceneCaption(s))+'</p><p class="pf-scene-label">Реконструкция места · детали условны</p>'+projectButton+'</div>'+
      '<aside class="pf-card"><div class="pf-actions"><button type="button" data-pf="pin" aria-pressed="'+!!s.pinned+'">'+(s.pinned?'Открепить':'Закрепить')+'</button><button type="button" data-pf="next"'+(s.busy?' disabled':'')+'>Следующее изменение →</button></div>'+
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
    const button = event.target.closest('[data-pf]');
    if (!button || !host?.contains(button) || button.tagName === 'SELECT') return;
    const action = button.dataset.pf, s = state();
    if (action === 'record') {selected = button.dataset.id; sourceOpen = false; render();}
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
    if (event.target.dataset.pf !== 'compare-year') return;
    const year = Number(event.target.value);
    if (availableYears(state()).includes(year)) {compareYear = year; render();}
  }
  function open(node, api) {
    if (host) close();
    host = node; controls = api; selected = null; selectedYear = undefined; sourceOpen = false; historyLimit = 5; compareYear = null; sceneKey = ''; previousFocus = document.activeElement;
    canvas = document.createElement('canvas'); canvas.setAttribute('aria-label','Реконструкция выбранного места');
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
