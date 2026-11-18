// Usage: node simulator-v05/tools/benchmark-validation.mjs /path/to/baseline/simulator-v05/src
// Baseline can be extracted without altering the checkout:
// git archive HEAD simulator-v05/src | tar -x -C /tmp/mg-baseline
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import * as current from '../src/core.mjs';
import {appendEvent} from '../src/archive.mjs';
const base=await import(pathToFileURL(resolve(process.argv[2],'core.mjs')));
const initial=current.createWorld('BENCH-VALIDATION');
const year300=current.advance(initial,300).world;
const large=current.clone(initial);
for(let i=0;i<8000;i++)appendEvent(large,{year:0,type:'scenario',title:'Контрольное событие',detail:'Воспроизводимая нагрузка проверки.',entityId:null,entityIds:[],causes:[],important:false,causeEventIds:[]});
large.year=10000;
const source=large.snapshots[0];source.nextEvent=large.nextEvent;
large.snapshots=Array.from({length:64},(_,i)=>({...current.clone(source),year:i===0?0:Math.round(i*10000/63)}));
const owner=large.societies[0].id,origin=large.societies[0].capitalId,target=large.planets.find(p=>!p.home).id;
const missions=Array.from({length:320},(_,i)=>({id:`m${10000+i}`,name:'Контрольная миссия',owner,target,originRegion:origin,kind:'probe',people:0,cargo:0,cost:1,departure:1,arrival:2,status:'arrived'}));
large.missionArchive=[missions.slice(0,128),missions.slice(128,256),missions.slice(256)];
const median=xs=>xs.sort((a,b)=>a-b)[Math.floor(xs.length/2)];
for(const [name,w] of [['year0',initial],['year300',year300],['synthetic10000',large]]){
  const json=JSON.stringify(w);const result={case:name,bytes:Buffer.byteLength(json),snapshots:w.snapshots.length,events:current.allEvents(w).length,missions:current.allMissions(w).length};
  for(const [label,mod] of [['baseline',base],['current',current]]){mod.validateWorld(w);const times=[];for(let i=0;i<5;i++){const t=performance.now();mod.validateWorld(w);times.push(performance.now()-t);}result[label+'_ms_median']=+median(times).toFixed(2);}
  console.log(JSON.stringify(result));
}
