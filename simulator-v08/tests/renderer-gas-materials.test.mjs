import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as Core from '../src/core.mjs';

const context={Core,Math,ResizeObserver:class{observe(){}},window:{devicePixelRatio:1}};
vm.runInNewContext(readFileSync(new URL('../src/renderer.js',import.meta.url),'utf8')+';this.Renderer=Renderer;this.sample=sampleWrappedTexture;',context);
test('gas atmosphere has bounded seeded detail along belts, continuous sampling and no state mutation',()=>{
  const r=new context.Renderer({getContext:()=>({}),addEventListener(){},clientWidth:0});
  r.world=Core.createWorld('MICROGALAXY-V08-UI-REVIEW');r.planet=r.world.planets.find(p=>p.kind==='gas')??{id:'gas',kind:'gas',home:false};r.layer='nature';
  const before=JSON.stringify(r.world);r.makeTexture();const texture=r.texture,{data,width,height}=texture;
  assert.equal(width*height,480*240);assert.equal(JSON.stringify(r.world),before);
  const rowVariations=[];
  for(const y of [45,75,105,135,165,195]){
    const row=Array.from({length:width},(_,x)=>data[(y*width+x)*4+1]),mean=row.reduce((a,b)=>a+b,0)/width;
    rowVariations.push(Math.sqrt(row.reduce((n,v)=>n+(v-mean)**2,0)/width));
  }
  assert.ok(rowVariations.filter(v=>v>4).length>=4,'cloud cells must vary along latitude, not only smooth horizontal bands');
  const a=[],b=[];
  for(let lat=-1.5;lat<=1.5;lat+=.17){
    context.sample(texture,Math.PI-1e-7,lat,a);context.sample(texture,-Math.PI+1e-7,lat,b);
    assert.ok(a.every((v,k)=>Math.abs(v-b[k])<.001));
  }
  for(const y of [0,height-1])for(let x=1;x<width;x++)for(let k=0;k<3;k++)assert.equal(data[(y*width+x)*4+k],data[y*width*4+k]);
  const first=data.slice();r.makeTexture();r.world.year++;r.makeTexture();assert.equal(r.renderStats.terrainBuilds,1);assert.deepEqual(r.texture.data,first);
  r.baseKey='';r.makeTexture();assert.deepEqual(r.texture.data,first);
  r.planet={...r.planet,id:r.planet.id+'-different'};r.makeTexture();assert.notDeepEqual(r.texture.data,first,'gas material/storm placement is planet-seeded');
});
