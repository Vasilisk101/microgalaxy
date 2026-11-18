import {readFile,writeFile,mkdir} from 'node:fs/promises';
const read = async path => (await readFile(new URL(path, import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
const core=await read('./src/core.mjs'),storage=await read('./src/storage.mjs'),cloud=await read('./src/cloud.mjs');
function wrap(src,pre=''){const names=[...src.matchAll(/^export\s+(?:async\s+)?(?:const|let|function|class)\s+(\w+)/gm)].map(m=>m[1]);return `(()=>{${pre}\n${src.replace(/^import .*;\n/gm,'').replace(/^export /gm,'')}\nreturn {${names.join(',')}};})()`;}
const policy=await read("../lib/retention-policy.mjs"),locks=await read("../lib/local-retention-locks.mjs"),retention=await read("../lib/local-retention.mjs");
const retentionClient=await read("../lib/retention-client.mjs");
const registry=await read("../lib/world-models.mjs");
const retentionModules="const WorldModels="+wrap(registry)+";\nconst RetentionClient="+wrap(retentionClient)+";\n"+"const RetentionPolicy="+wrap(policy)+";\nconst RetentionLocks="+wrap(locks)+";\nconst Retention="+wrap(retention,"const {WORLD_MODELS}=WorldModels;const {planRetention,retentionConfirmation,DEFAULT_LIMIT_BYTES,LIMIT_OPTIONS_BYTES}=RetentionPolicy;const {withRetentionLock,acquireWorldLease,withInactiveWorld}=RetentionLocks;")+";\n";
const worker=core.replace(/^export /gm,'')+`\nself.onmessage=({data:d})=>{try{self.postMessage({id:d.id,result:advance(d.world,d.years,{stopOnImportant:d.stopOnImportant})});}catch(e){self.postMessage({id:d.id,error:e.message});}};self.postMessage({ready:true});`;
const app=retentionModules+'const Core='+wrap(core)+';\nconst Storage='+wrap(storage,'const {validateWorld,clone,SCHEMA,MODEL_VERSION}=Core;const {openRetentionDatabase,attachRetentionStore,writeRetentionMetadata}=Retention;')+';\nconst Cloud='+wrap(cloud,'const {validateWorld,clone}=Core;const {retentionHeaders,releaseCloudWorld,rememberCloudLease}=RetentionClient;')+';\n'+await read('./src/renderer.js')+'\n'+await read('./src/ui.js');
const style=await read('./src/styles.css');
const html=(await read('./src/index.template.html')).replace('/*STYLE*/',()=>style).replace('/*WORKER*/',()=>JSON.stringify(worker).replace(/</g,'\\u003c')).replace('/*APP*/',()=>'(function(){\n'+app+'\n})();');
await mkdir(new URL('./dist/',import.meta.url),{recursive:true});await writeFile(new URL('./dist/MICROGALAXY-0.3.html',import.meta.url),html);console.log('Built MICROGALAXY 0.3, bytes:',Buffer.byteLength(html));

