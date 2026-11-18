import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const code=readFileSync(new URL('../src/renderer.js',import.meta.url),'utf8')+'\nthis.Renderer=Renderer;this.sample=sampleWrappedTexture;';
const context={Core:{clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),rand:()=>.42},ResizeObserver:class {observe(){}},window:{devicePixelRatio:1}};
vm.runInNewContext(code,context);
function texture(kind,home=false){const canvas={getContext:()=>({}),addEventListener(){},clientWidth:0};const r=new context.Renderer(canvas,()=>{});r.world={seed:'seam',climate:{warming:0},societies:[{id:'s',color:'#a06040'}],regions:[{id:'r',lon:0,lat:0,biome:'forest',owner:'s'}]};r.planet={id:'p',home,kind};r.layer='nature';r.makeTexture();return r.texture;}
function rgb(t,x,y){const i=(y*t.width+x)*4;return Array.from(t.data.slice(i,i+3));}
test('projection interpolates across longitude wrap and clamps latitude',()=>{
  const t={width:2,height:2,data:new Uint8ClampedArray([0,0,0,255,100,100,100,255,200,200,200,255,255,255,255,255])},out=[0,0,0];
  context.sample(t,-Math.PI/2,Math.PI/2,out);assert.equal(out[0],50);
  context.sample(t,Math.PI-1e-7,Math.PI/2,out);const left=out[0];context.sample(t,-Math.PI+1e-7,Math.PI/2,out);assert.ok(Math.abs(left-out[0])<.001);
  context.sample(t,0,-Math.PI,out);assert.equal(out[0],255);
});
test('gas stripes wrap and both pole rows converge for every longitude',()=>{
  for(const t of [texture('gas'),texture('rock',true)]){
    for(const y of [0,t.height-1])for(let x=1;x<t.width;x++)assert.deepEqual(rgb(t,x,y),rgb(t,0,y));
    for(const y of [30,90,150,210]){const a=rgb(t,0,y),b=rgb(t,t.width-1,y);assert.ok(a.every((v,k)=>Math.abs(v-b[k])<35),`seam at row ${y}: ${a} / ${b}`);}
  }
});
