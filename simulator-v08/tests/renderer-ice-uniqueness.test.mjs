import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as Core from '../src/core.mjs';
const context={Core,Math,ResizeObserver:class{observe(){}},window:{devicePixelRatio:1}};
vm.runInNewContext(readFileSync(new URL('../src/renderer.js',import.meta.url),'utf8')+';this.Renderer=Renderer;',context);
test('ice bodies have stable distinct spherical materials without mutating world',()=>{
 const world=Core.createWorld('ice-materials-review'),before=JSON.stringify(world);
 const renderer=new context.Renderer({getContext:()=>({}),addEventListener(){},clientWidth:0});
 renderer.world=world;renderer.layer='nature';
 const outputs=[];
 for(const id of ['ice-one','ice-two','ice-three']){
   renderer.planet={id,kind:'ice',home:false};renderer.makeTexture();outputs.push(renderer.texture.data.slice());
 }
 assert.notDeepEqual(outputs[0],outputs[1]);assert.notDeepEqual(outputs[1],outputs[2]);
 renderer.planet={id:'ice-one',kind:'ice',home:false};renderer.makeTexture();assert.deepEqual(renderer.texture.data,outputs[0]);
 assert.equal(JSON.stringify(world),before);
 for(const y of [0,239])for(let x=1;x<480;x++)for(let k=0;k<3;k++)assert.equal(outputs[0][(y*480+x)*4+k],outputs[0][y*480*4+k]);
});
