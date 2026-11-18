// The control world lives in a separate worker. Normal site timings come from DeviceSession.
let deviceRun=null,deviceReport=null,deviceCandidate=null;
const deviceMs=value=>Math.round(value*10)/10;
const deviceProfiles={quiet:{seed:'BASIN-20',era:'agriculture'},freight:{seed:'long-run-08-final',era:'space'}};
const deviceLabels={'catalogue-displayed':'Каталог после чтения источников','snapshot-read':'Чтение снимка','full-validation':'Полная проверка снимка','world-selected':'Открытие мира','globe-prepare':'Подготовка глобуса','globe-interactive':'Первый доступный кадр от начала загрузки страницы','globe-rotated':'Поворот глобуса жестом',hidden:'Уход в фон',visible:'Возврат из фона','background-save':'Сохранение при уходе в фон',pagehide:'Закрытие страницы',reopened:'Сверка с предыдущим сохранением','snapshot-size':'Размер и SHA-256 содержимого'};
function deviceDownload(text,name,type='application/json'){
  const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');
  a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function sessionSummary(){
  const r=DeviceSession.report(),v=r.visits.at(-1);if(!v)return '<p>Запуски ещё не записаны.</p>';
  const rows=Object.entries(deviceLabels).map(([key,label])=>{
    const e=v.events.filter(x=>x.kind===key).at(-1);
    let value='нет измерения';
    if(e){const parts=[];
      if(e.source)parts.push(e.source==='cloud'?'облако':'устройство');
      if(e.year!=null)parts.push('год '+e.year);
      if(e.ms!=null||e.navigationMs!=null)parts.push((e.ms??e.navigationMs)+' мс');
      if(e.afterSelectionMs!=null)parts.push(e.afterSelectionMs+' мс после выбора снимка');
      if(e.jsonBytes!=null)parts.push(e.jsonBytes.toLocaleString('ru-RU')+' байт');
      if(e.ok!=null)parts.push(e.ok?'успешно':'ошибка');
      if(e.sameWorld!=null)parts.push(e.sameWorld&&e.sameYear?'тот же мир и год':'мир или год изменился');
      if(e.paused!=null)parts.push(e.paused?'на паузе':'время идёт');
      value=parts.join(' · ')||'зарегистрировано';
    }
    return '<tr><th scope="row">'+h(label)+'</th><td>'+h(value)+'</td></tr>';
  }).join('');
  const series=r.pauseSeries.filter(x=>x.visit===v.id).map(x=>h(x.seed)+' · '+x.n+' нажатий · P95 '+(x.p95Ms===null?'после 20 нажатий':x.p95Ms+' мс'));
  return '<p>'+h(v.device||'Устройство не указано')+' · '+h(v.date)+' · '+h(v.mode)+(v.pauseTargetMs?' · цель P95 '+h(v.pauseTargetMs)+' мс':'')+'</p><table><caption>Последние наблюдения этого запуска</caption><tbody>'+rows+'</tbody></table><p>Обычная пауза · '+(series.join('<br>')||'ещё нет нажатий')+'</p>';
}
function sessionText(){
  const report=DeviceSession.report(),lines=['MICROGALAXY · Сеансы сайта','Версия модели '+report.model,'Устройство: '+(report.device||'не указано'),report.launchMethod,report.pauseMethod];
  for(const visit of report.visits){
    const mode={cold:'холодный, отмечен наблюдателем',warm:'повторный, отмечен наблюдателем'}[visit.mode]||visit.mode;
    lines.push('','Запуск '+visit.date+' · '+mode,'Браузер '+visit.browser+' · '+visit.viewport.join(' × ')+' · тип перехода '+(visit.navigationType||'неизвестен'));
    if(visit.pauseTargetMs!=null)lines.push('Согласованная цель P95 '+visit.pauseTargetMs+' мс');
    for(const e of visit.events){
      const parts=[e.atMs+' мс',deviceLabels[e.kind]||e.kind];
      if(e.seed)parts.push(e.seed+' · год '+e.year);
      if(e.revision!=null)parts.push('ревизия '+e.revision);
      if(e.source)parts.push(e.source==='cloud'?'источник: облако':'источник: устройство');
      if(e.ms!=null)parts.push('заняло '+e.ms+' мс');
      if(e.navigationMs!=null)parts.push('от начала страницы '+e.navigationMs+' мс; после выбора снимка '+e.afterSelectionMs+' мс');
      if(e.jsonBytes!=null)parts.push(e.jsonBytes+' байт; SHA-256 '+e.contentSHA256);
      if(e.ok!=null)parts.push(e.ok?'успешно':'ошибка');
      if(e.cloudState)parts.push('записей на устройстве '+e.local+', в облаке '+e.cloud+' ('+e.cloudState+')');
      if(e.kind==='hidden'||e.kind==='visible')parts.push('до смены видимости '+(e.wasRunning?'время шло':'на паузе')+', после '+(e.paused?'на паузе':'время идёт'));
      if(e.kind==='pagehide')parts.push(e.unsaved?'есть несохранённые изменения':'нет ожидающих сохранения изменений');
      if(e.kind==='reopened')parts.push('ожидались '+e.expected.seed+' · год '+e.expected.year+', открыт '+e.actual.seed+' · год '+e.actual.year,(e.sameWorld&&e.sameYear)?'совпало':'расхождение');
      lines.push(parts.join(' · '));
    }
    if(!visit.events.length)lines.push('Действия в этом запуске ещё не записаны.');
    const groups=report.pauseSeries.filter(g=>g.visit===visit.id);
    if(!groups.length)lines.push('Обычная пауза: нет измерений.');
    for(const g of groups)lines.push('Обычная пауза · '+g.seed+' · нажатий '+g.n+' · P95 '+(g.p95Ms==null?'нужно 20 нажатий':g.p95Ms+' мс'),'Образцы, мс: '+g.samples.join(', '));
  }
  return lines.join('\n');
}
function deviceDialog(){
  if(deviceRun)return;
  const active=DeviceSession.configured(),hasVisits=DeviceSession.report().visits.length>0;
  const links=world?'<p>Открыть этот же мир из выбранного источника: <a href="'+h(modelPath(activeModel,world.id,'local'))+'">на устройстве</a> · <a href="'+h(modelPath(activeModel,world.id,'cloud'))+'">в облаке</a>.</p>':'';
  const sessionButtons=active?'<p>Запись действий включена.</p><button data-device="session-cold">Следующий запуск — холодный</button> <button data-device="session-warm">Следующий запуск — повторный</button> <button data-device="session-stop">Закончить запись</button>':'<label>Устройство<input id="device-model" maxlength="100" placeholder="Например, OnePlus 8 Pro"></label><label>Согласованная цель P95 паузы, мс (при наличии)<input id="device-target" type="number" min="1" step="any" inputmode="decimal"></label><button data-device="session-start">Включить запись действий</button>';
  modal('Проверка скорости','<h2>Сеанс сайта на телефоне</h2>'+sessionButtons+'<details><summary>Как проверить сайт</summary><ol><li>Включите запись на своём телефоне. Подготовьте контрольный мир за 1 000 или 10 000 лет ниже: скачайте файл, выберите «Импорт» в меню сайта и дождитесь сохранения в облаке.</li><li>Отметьте следующий запуск как холодный, закройте браузер и откройте адрес мира самостоятельно. Откройте «Мои миры», выберите копию, поверните глобус пальцем. Повторите со второго источника. Сверьте год и отпечаток содержимого в отчёте.</li><li>На работающем мире до предельного года включите время и нажмите обычную паузу. Повторите 20 раз в одном запуске одного мира. Уйдите на главный экран во время хода, вернитесь, запишите возобновившийся год. На году 10 000 измеряется открытие; для проверки паузы подходит копия на 9 990 или 1 000.</li><li>Отметьте повторный запуск, закройте вкладку и самостоятельно откройте тот же адрес. Проверьте восстановленный год. Повторите для обеих историй и длин, затем скачайте протокол. Браузер сообщает тип навигации; состояние кеша отмечает наблюдатель.</li></ol></details>'+links+(hasVisits?'<p><button data-device="session-show">Просмотреть измерения</button> <button data-device="session-download">Скачать данные JSON</button> <button data-device="session-text">Скачать читаемый протокол</button></p>':'')+'<h2>Вычисление контрольного мира</h2><label>История<select id="device-profile"><option value="freight">long-run-08-final · перевозки и переселения</option><option value="quiet">BASIN-20 · более редкая хроника</option></select></label><label>Длина истории<select id="device-depth"><option value="1000">1 000 лет</option><option value="9990">9 990 лет</option><option value="10000">10 000 лет</option></select></label><label><input type="checkbox" id="device-keep"> Подготовить файл этого мира для проверки обычного открытия</label><div class="dialog-actions"><button data-device="start" class="primary">Начать замер</button></div>',true);
}
function devicePaint(){return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));}
function stopDevice(){
  const run=deviceRun;if(!run)return;
  run.removeVisibility?.();run.worker.terminate();URL.revokeObjectURL(run.url);deviceRun=null;$('#dialog').removeEventListener('close',stopDevice);
}
function showDeviceReport(){
  const r=deviceReport;
  const rows=r.checks.map(x=>'<tr><td>'+x.year+'</td><td>'+x.validation+'</td><td>'+x.stepFrom+' → '+(x.stepFrom+1)+': '+x.annual+'</td><td>'+x.bytes.toLocaleString('ru-RU')+'</td><td>'+x.recentEvents+' / '+x.shipments+' / '+x.movements+'</td></tr>').join('');
  modal('Результаты на этом устройстве','<p>Модель '+h(r.version)+' · '+h(r.seed)+' · '+h(r.date)+'</p><table><caption>Полная проверка состояния и расчёт года в отдельном потоке, мс</caption><thead><tr><th>Год</th><th>Проверка</th><th>Шаг, мс</th><th>Байт</th><th>Записи за 100 лет / все грузы / все переселения</th></tr></thead><tbody>'+rows+'</tbody></table><p>Создание мира: '+r.create+' мс. Наибольший интервал видимых кадров во время расчёта: '+r.longestFrame+' мс. Кнопка «Пауза замера»: '+(r.pause===null?'нет измерения':r.pause+' мс')+'.</p><button data-device="download">Скачать протокол расчёта</button> '+(deviceCandidate?'<button data-device="control-export">Скачать контрольный мир</button> ':'')+'<button data-device="open">К сеансу сайта</button>',true);
}
// Serialized into its own Worker, so this function depends only on Core and browser globals.
function deviceWorker(){
  let paused=false;
  self.onmessage=async({data})=>{
    if(data.pause!==undefined){paused=data.pause;postMessage({paused});return;}
    try{
      const start=performance.now(),w=Core.createWorld(data.seed,{era:data.era}),s=Core.createWorkerSession(w);
      postMessage({create:performance.now()-start});
      let finalStep=null;
      for(const year of data.checks){
        while(w.year<year){
          if(paused){await new Promise(r=>setTimeout(r,20));continue;}
          if(year===10000&&w.year===9999){const t=performance.now();s.step(1);finalStep=performance.now()-t;}
          else s.step(Math.min(25,(year===10000?9999:year)-w.year));
          postMessage({progress:w.year});await new Promise(r=>setTimeout(r,0));
        }
        const t=performance.now();Core.validateWorld(w);const validation=performance.now()-t;
        const bytes=new TextEncoder().encode(JSON.stringify(w)).length;
        let annual=finalStep,stepFrom=9999;
        if(year<10000){const copy=Core.createWorkerSession(structuredClone(w));stepFrom=year;const t=performance.now();copy.step(1);annual=performance.now()-t;}
        const entries=Core.allEvents(w),recentEvents=entries.filter(e=>e.year>year-100).length;
        const shipments=Math.max(0,w.economy.nextShipment-1),movements=entries.filter(e=>e.movement).length;
        postMessage({sample:{year,validation,annual,stepFrom,bytes,recentEvents,shipments,movements}});
      }
      postMessage(data.keep?{done:true,world:w}:{done:true});
    }catch(e){postMessage({failure:e.message});}
  };
}
function startDevice(){
  const end=Number($('#device-depth').value),profile=deviceProfiles[$('#device-profile').value];
  if(![1000,9990,10000].includes(end)||!profile||deviceRun)return;
  const keep=$('#device-keep').checked,checks=end===1000?[0,1000]:[0,1000,end];
  const base=JSON.parse($('#worker-source').textContent),url=URL.createObjectURL(new Blob([base,'\n(',deviceWorker.toString(),')();'],{type:'text/javascript'}));
  let worker;try{worker=new Worker(url);}catch(e){URL.revokeObjectURL(url);notice(e.message);return;}
  const run={worker,url,last:null,press:null,paused:false};deviceCandidate=null;
  const r={type:'isolated-worker',version:Core.MODEL_VERSION,...profile,date:new Date().toISOString(),browser:navigator.userAgent,viewport:[innerWidth,innerHeight],create:0,checks:[],longestFrame:0,pause:null};
  deviceReport=r;deviceRun=run;
  function tick(now){if(deviceRun!==run)return;if(document.hidden)run.last=null;else{if(run.last!==null)r.longestFrame=Math.max(r.longestFrame,deviceMs(now-run.last));run.last=now;}requestAnimationFrame(tick);}
  const clearFrame=()=>{run.last=null;};document.addEventListener('visibilitychange',clearFrame);
  run.removeVisibility=()=>document.removeEventListener('visibilitychange',clearFrame);
  modal('Замер браузера','<p id="device-progress" role="status">Подготовка контрольного мира…</p><button data-device="pause">Пауза замера</button> <button data-device="cancel">Завершить без сохранения</button>',true);$('#dialog').addEventListener('close',stopDevice);
  worker.onerror=()=>{stopDevice();notice('Поток измерения прерван.');};
  worker.onmessage=async({data})=>{if(deviceRun!==run)return;if(data.failure){stopDevice();notice(data.failure);return;}
    if(data.create!==undefined)r.create=deviceMs(data.create);
    if(data.sample)r.checks.push({...data.sample,validation:deviceMs(data.sample.validation),annual:deviceMs(data.sample.annual)});
    if(data.progress!==undefined&&!run.paused)$('#device-progress').textContent='Год '+Math.min(end,data.progress)+' из '+end;
    if(data.paused!==undefined){run.paused=data.paused;const button=document.querySelector('[data-device=pause]');if(button){button.textContent=data.paused?'Продолжить замер':'Пауза замера';button.disabled=false;}if(data.paused&&run.press!==null){await devicePaint();r.pause=deviceMs(performance.now()-run.press);}}
    if(data.done){deviceCandidate=data.world??null;stopDevice();showDeviceReport();}
  };
  requestAnimationFrame(tick);worker.postMessage({...profile,checks,keep});
}
document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-device]');if(!b)return;
  try{switch(b.dataset.device){
    case 'open':deviceDialog();break;
    case 'session-start':DeviceSession.enable($('#device-model').value,$('#device-target').value);deviceDialog();break;
    case 'session-stop':DeviceSession.finish();deviceDialog();break;
    case 'session-cold':case 'session-warm':DeviceSession.next(b.dataset.device==='session-cold'?'cold':'warm');b.textContent='Отмечено для следующего запуска';break;
    case 'session-show':modal('Действия на устройстве',sessionSummary()+'<button data-device="session-download">Скачать данные JSON</button> <button data-device="session-text">Скачать читаемый протокол</button> <button data-device="open">Вернуться</button>',true);break;
    case 'session-text':deviceDownload(sessionText(),'Microgalaxy-'+Core.MODEL_VERSION+'-session.txt','text/plain;charset=utf-8');break;
    case 'session-download':deviceDownload(JSON.stringify({...DeviceSession.report(),labels:deviceLabels},null,2),'Microgalaxy-'+Core.MODEL_VERSION+'-session.json');break;
    case 'start':startDevice();break;
    case 'pause':if(deviceRun){deviceRun.press=performance.now();b.disabled=true;deviceRun.worker.postMessage({pause:!deviceRun.paused});}break;
    case 'cancel':stopDevice();$('#dialog').close();break;
    case 'download':if(deviceReport)deviceDownload(JSON.stringify(deviceReport,null,2),'Microgalaxy-'+Core.MODEL_VERSION+'-device.json');break;
    case 'control-export':if(deviceCandidate){b.disabled=true;const candidate={...deviceCandidate,id:crypto.randomUUID()};try{deviceDownload(await Storage.encodeSave(candidate),'Microgalaxy-'+candidate.seed+'-'+candidate.year+'.json');}finally{b.disabled=false;}}break;
  }}catch(error){notice(error.message);}
});
