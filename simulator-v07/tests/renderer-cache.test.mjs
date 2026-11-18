import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const code=readFileSync(new URL('../src/renderer.js',import.meta.url),'utf8')+'\nthis.Renderer=Renderer;';
const context={Core:{clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),rand:()=>.42},ResizeObserver:class {observe(){}},window:{devicePixelRatio:1}};
vm.runInNewContext(code,context);
function setup(){
  const canvas={getContext:()=>({}),addEventListener(){},clientWidth:0};
  const renderer=new context.Renderer(canvas,()=>{});
  renderer.world={seed:'test',year:10,climate:{warming:0},societies:[{id:'s',color:'#a06040'}],regions:[{id:'r',lon:0,lat:0,biome:'forest',owner:'s',social:{cohesion:.2},culture:{autonomy:.3}}]};
  renderer.planet={id:'p',home:true,kind:'rock'};renderer.layer='nature';return renderer;
}
test('static terrain is cached across redraw and historical year changes',()=>{
  const r=setup();r.makeTexture();const original=r.texture.data.slice();r.makeTexture();r.world.year=20;r.makeTexture();
  assert.equal(r.renderStats.terrainBuilds,1);assert.equal(r.renderStats.textureBuilds,1);assert.deepEqual(r.texture.data,original);
});
test('model overlays refresh without regenerating terrain',()=>{
  const r=setup();r.layer='political';r.makeTexture();const first=r.texture.data.slice();r.world.societies[0].color='#307090';r.makeTexture();
  assert.equal(r.renderStats.terrainBuilds,1);assert.equal(r.renderStats.textureBuilds,2);assert.notDeepEqual(r.texture.data,first);
  r.layer='cohesion';r.makeTexture();const before=r.texture.data.slice();r.world.regions[0].social.cohesion=.9;r.makeTexture();assert.notDeepEqual(r.texture.data,before);assert.equal(r.renderStats.terrainBuilds,1);
});
test('world geography and seed invalidate the bounded single-world cache',()=>{
  const r=setup();r.makeTexture();r.world.regions[0].biome='drylands';r.makeTexture();r.world.seed='other';r.makeTexture();assert.equal(r.renderStats.terrainBuilds,3);assert.equal(r.baseTexture.data.length,480*240*4);
});
