// Usage: node simulator-v05/tools/benchmark-renderer.mjs /path/to/baseline/simulator-v05/src
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import * as Core from '../src/core.mjs';
const load=code=>new Function('Core','ResizeObserver',code+'\nreturn Renderer;')(Core,class{observe(){}});
const variants=[['baseline',load(readFileSync(resolve(process.argv[2],'renderer.js'),'utf8'))],['current',load(readFileSync(new URL('../src/renderer.js',import.meta.url),'utf8'))]];
const w=Core.createWorld('RENDER-BENCH'),planet=w.planets.find(p=>p.home);
const canvas=()=>({getContext:()=>({}),addEventListener(){}});
const median=a=>a.sort((x,y)=>x-y)[Math.floor(a.length/2)];
for(const layer of ['nature','political'])for(const [version,Renderer] of variants){
  const cold=[],rebuild=[],hit=[];
  for(let i=0;i<4;i++){
    const r=new Renderer(canvas());Object.assign(r,{world:w,planet,layer});let t=performance.now();r.makeTexture();let elapsed=performance.now()-t;
    if(i)cold.push(elapsed);
    r.cacheKey='';t=performance.now();r.makeTexture();elapsed=performance.now()-t;if(i)rebuild.push(elapsed);
    t=performance.now();for(let j=0;j<1000;j++)r.makeTexture();elapsed=(performance.now()-t)/1000;if(i)hit.push(elapsed);
  }
  console.log(JSON.stringify({layer,version,texture:'480x240',regions:w.regions.length,cold_ms_median:+median(cold).toFixed(2),rebuild_ms_median:+median(rebuild).toFixed(2),cache_hit_ms_median:+median(hit).toFixed(4)}));
}
