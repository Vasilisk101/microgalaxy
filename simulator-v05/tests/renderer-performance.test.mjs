import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as Core from '../src/core.mjs';

function load(code){return new Function('Core','ResizeObserver',code+'\nreturn Renderer;')(Core,class{observe(){}});}
function canvas(){return {getContext:()=>({}),addEventListener(){}};}
const old=load(readFileSync(new URL('./baseline/renderer.js',import.meta.url),'utf8'));
const now=load(readFileSync(new URL('../src/renderer.js',import.meta.url),'utf8'));
test('texture pixels match baseline across layers and planets',()=>{
  const w=Core.createWorld('PIXELS'),a=new old(canvas()),b=new now(canvas());
  for(const p of [w.planets.find(p=>p.home),w.planets.find(p=>!p.home)])for(const layer of ['nature','political','climate']){
    Object.assign(a,{world:w,planet:p,layer,cacheKey:''});Object.assign(b,{world:w,planet:p,layer,cacheKey:''});a.makeTexture();b.makeTexture();
    assert.deepEqual(b.texture.data,a.texture.data,`${p.kind} ${layer}`);
  }
});
