import {readFile,writeFile,mkdir} from 'node:fs/promises';

const read = async path => (await readFile(new URL(path, import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
const withoutImports = src => src.replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
function wrap(src,pre='') {
  const names=[...src.matchAll(/^export\s+(?:async\s+)?(?:const|let|function\s*\*?|class)\s+(\w+)/gm)].map(m=>m[1]);
  return '(()=>{'+pre+'\n'+withoutImports(src)+'\nreturn {'+names.join(',')+'};})()';
}
async function modules(entries) {
  const parts=await Promise.all(entries.map(async ([name,path,pre])=>
    'const '+name+'='+wrap(await read(path),pre)+';\n'));
  return parts.join('');
}
const retention=await modules([
  ['WorldModels','../lib/world-models.mjs'], ['RetentionClient','../lib/retention-client.mjs'],
  ['RetentionPolicy','../lib/retention-policy.mjs'], ['RetentionLocks','../lib/local-retention-locks.mjs'],
  ['Retention','../lib/local-retention.mjs','const {WORLD_MODELS}=WorldModels;const {planRetention,retentionConfirmation,DEFAULT_LIMIT_BYTES,LIMIT_OPTIONS_BYTES}=RetentionPolicy;const {withRetentionLock,acquireWorldLease,withInactiveWorld}=RetentionLocks;']
]);
const physics=await modules(['Geography','Archive','Economy','Knowledge','Societies','Conflicts'].map(name=>[name,'./src/'+name.toLowerCase()+'.mjs']));
const next='../simulator-v1/src/';
const editionModules=await modules([['LivingWorld',next+'living-world.mjs'],['ColonialExchange',next+'colonial-exchange.mjs'],['SpaceWorld',next+'space-world.mjs'],['Branches',next+'branches.mjs'],['Editions',next+'edition.mjs']]);
const places=await modules([['PlaceRecords',next+'place-records.mjs'],['PlaceTime',next+'place-time.mjs']]);
const factory=withoutImports(await read('./src/simulation.mjs'));
const storage=await read('./src/storage.mjs'), cloud=await read('./src/cloud.mjs');
const ui=await read('./src/ui.js'), template=await read('./src/index.template.html');
const observer=(await Promise.all(['renderer','observation','freight-observation'].map(f=>read('./src/'+f+'.js')))).join('\n');
const journal=await modules([['ObservationJournal','./src/observation-journal.mjs','const {ROUTE_CLOSURES}=Economy;']]);
const deviceCheck=await read('./src/device-session.js')+'\n'+await read('./src/device-check.js');
const nextUI=(await Promise.all(['edition-ui.js','branches-ui.js','field-guide.js','signal-view.js','place-landscape.js','place-focus.js','place-visit.js'].map(f=>read(next+f)))).join('\n');
const style=await read('./src/styles.css'), extraStyle=await read(next+'edition.css')+'\n'+await read(next+'night.css')+'\n'+await read(next+'place-focus.css')+'\n'+await read(next+'place-entry.css');
const stepWorker=await read('./src/worker.js');

for(const v1 of [false,true]){
  const version=v1?'1.0':'0.8';
  const source=physics+(v1?editionModules:'')+factory+'\nconst Core=createSimulation('+(v1?'Editions.edition':'')+');\n';
  const placeWorker = v1 ? stepWorker.replace('  try {', `  if(data.type==='place'){
    PlaceTime.perform(Core,PlaceRecords.placeRecords,data.input,()=>Promise.resolve()).then(
      result=>self.postMessage({id:data.id,result}), error=>self.postMessage({id:data.id,error:error.message}));
    return;
  }
  try {`) : stepWorker;
  const worker=source+(v1?places:'')+'const {validateWorld,createWorkerSession}=Core;\n'+placeWorker;
  const storageSrc=v1?storage.replaceAll("'v08'","'v1'"):storage;
  const cloudSrc=v1?cloud.replaceAll('v08','v1'):cloud;
  const modelUI=v1?ui.replaceAll('microgalaxy_conflicts_v08_last','microgalaxy_observatory_v1_last')
    .replaceAll('microgalaxy:v08:sound','microgalaxy:v1:sound')
    .replaceAll('через меню «Файл»','через «Меню»')
    .replaceAll('0.8 «Конфликты и новый порядок»','1.1 «Ночная орбита»'):ui;
  const app=retention+source+(v1?'const LegacyCore=createSimulation();const ReleasedCore=createSimulation({...Editions.edition,version:"1.0.0",acceptsModelVersion:v=>v==="1.0.0"});\n':'')
    +'const Storage='+wrap(storageSrc,'const {validateWorld,clone,SCHEMA,MODEL_VERSION,acceptsModelVersion}=Core;const {openRetentionDatabase,attachRetentionStore,writeRetentionMetadata,withBranchQuota}=Retention;')+';\n'
    +'const Cloud='+wrap(cloudSrc,'const {validateWorld,clone}=Core;const {retentionHeaders,releaseCloudWorld,rememberCloudLease}=RetentionClient;const {MAX_FILE_BYTES,ensureSaveSize}=Storage;')+';\n'
    +journal+observer+'\n'+(v1?places+nextUI:'')+'\n'+deviceCheck+'\n'+modelUI+(v1?'\nPlaceVisit.attach();':'');
  const page=v1?template.replace('0.8 — Конфликты и новый порядок','1.1 — Ночная орбита')
    .replace('0.8 · Конфликты и новый порядок','1.1 · Ночная орбита')
    .replace('История обществ одной звёздной системы</span></div>', 'История обществ одной звёздной системы</span><nav class="field-tools" aria-label="Инструменты наблюдателя"><button data-place-open>Место крупным планом</button></nav></div>')
    .replace('<dialog id="dialog"', '<dialog id="place-dialog" class="place-dialog" aria-label="Место и его хроника"></dialog><dialog id="dialog"')
    .replace('<div class="scene-note"', '<button type="button" class="place-map-entry" data-place-open hidden>Приблизить место ↗</button><div class="scene-note"')
    .replace('<button id="sound"', '<button data-place-sample="meander">Открыть МЕАНДР-19</button><button data-place-sample="basin">Открыть BASIN-6</button><button id="sound"')
    .replace('<div class="layers">','<div class="layers"><span class="observer-modes" role="group" aria-label="Режим наблюдения"><button data-observer-mode="optical" aria-pressed="false">◉ Оптика</button><button data-observer-mode="signals" aria-pressed="true">◇ Сигналы</button></span>')
    .replace('<section id="observation-panel"', '<details id="signal-log" hidden></details><section id="observation-panel"')
    .replace('<button id="next-event">До события</button>','')
    .replace('<details class="time-more">','<button id="next-event" class="next-event-direct">До события</button><details class="time-more">')
    .replace('<summary>Файл</summary>', '<summary>Меню</summary>')
    .replace('class="primary" hidden>Новая система +', 'class="primary">Новая система +')
    .replace('<button id="about">','<button data-guide="open">Куда посмотреть</button><button data-edition="open">Полевой атлас</button><button data-branches="open">Миры-двойники</button><button id="about">'):template;
  const html=page.replace('<button id="about">','<button data-device="open">Проверка скорости</button><button id="about">').replace('/*STYLE*/',()=>style+(v1?extraStyle:''))
    .replace('/*WORKER*/',()=>JSON.stringify(worker).replace(/</g,'\\u003c'))
    .replace('/*APP*/',()=>'(function(){\n'+app+'\n})();');
  const directory=new URL(v1?'../simulator-v1/dist/':'./dist/',import.meta.url);
  await mkdir(directory,{recursive:true});
  await writeFile(new URL('MICROGALAXY-'+version+'.html',directory),html);
  console.log('Built MICROGALAXY '+version+', bytes:',Buffer.byteLength(html));
}
