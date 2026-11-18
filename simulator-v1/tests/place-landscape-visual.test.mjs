import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as Core from '../src/core.mjs';
import {describeSettlement} from '../src/settlement-view.mjs';

const code=await readFile(new URL('../src/place-landscape.js',import.meta.url),'utf8');
const sites=await readFile(new URL('../src/settlement-sites.js',import.meta.url),'utf8');
function fakeCanvas(){
 const grad={addColorStop(){}};
 const ctx=new Proxy({createLinearGradient:()=>grad,createRadialGradient:()=>grad},
  {get:(o,k)=>k in o?o[k]:()=>{},set:(o,k,v)=>(o[k]=v,true)});
 return {width:960,height:540,getBoundingClientRect:()=>({width:960,height:540}),
  getContext:()=>ctx,ownerDocument:{createElement:()=>fakeCanvas()}};
}
function setup(){const scope={};vm.createContext(scope);vm.runInContext(sites+'\n'+code+';globalThis.landscape=PlaceLandscape;',scope);return scope.landscape;}
function world(seed,year){return Core.advance(Core.createWorld(seed,{era:'industrial'}),year).world;}
function points(atlas,canvas){const ids=new Set();for(let y=0;y<540;y+=4)for(let x=0;x<960;x+=4){const id=atlas.hitTest(canvas,x,y);if(id)ids.add(id);}return ids;}
function paint(atlas,canvas,w,id,detail='region'){
 const region=w.regions.find(r=>r.id===id),basin=w.observatory.living.basin;
 const settlement=describeSettlement(w,region);
 atlas.draw(canvas,w,region,{year:w.year,basin,project:basin?.project,settlement,detail});
 return settlement;
}

test('project becomes selectable only after the recorded start',()=>{
 const atlas=setup(),canvas=fakeCanvas(),before=world('МЕАНДР-19',2),after=world('МЕАНДР-19',16);
 const a=paint(atlas,canvas,before,'r8');assert.ok(!a.objects.some(o=>o.kind==='project'));
 assert.ok(!points(atlas,canvas).has('r8:project'));
 const b=paint(atlas,canvas,after,'r8');assert.ok(b.objects.some(o=>o.kind==='project'));
 assert.ok(points(atlas,canvas).has('r8:project'));
});
test('port and housing hits come from recorded objects and exist in both views',()=>{
 const atlas=setup(),canvas=fakeCanvas(),w=world('BASIN-6',30);
 const desc=paint(atlas,canvas,w,'r15');assert.ok(desc.objects.some(o=>o.kind==='harbor'));
 const hits=points(atlas,canvas);assert.ok(hits.has('r15:harbor'));assert.ok(hits.has('r15:housing'));
 const again=points(atlas,canvas);assert.deepEqual([...hits],[...again]);
 paint(atlas,canvas,w,'r15','district');assert.ok(points(atlas,canvas).has('r15:housing'));
});
test('confirmed fields and mine are selectable in their distinct landscapes',()=>{
 const atlas=setup(),canvas=fakeCanvas();
 const field=world('МЕАНДР-19',8);paint(atlas,canvas,field,'r48');
 assert.ok(points(atlas,canvas).has('r48:fields'));
 const mine=world('ПЕРСЕИДЫ',30);paint(atlas,canvas,mine,'r15');
 assert.ok(points(atlas,canvas).has('r15:mine'));
 assert.equal(atlas.hitTest(canvas,-20,-20),null);
});
test('a precise scene pick keeps its normalized position through visual selection',()=>{
 const atlas=setup(),canvas=fakeCanvas(),w=world('МЕАНДР-19',8),r=w.regions.find(r=>r.id==='r48');
 const basin=w.observatory.living.basin,settlement=describeSettlement(w,r);
 const options={year:w.year,basin,project:basin?.project,settlement,detail:'region'};
 atlas.draw(canvas,w,r,options);
 let chosen,xy;
 for(let y=0;y<540&&!chosen;y+=3)for(let x=0;x<960;x+=3){
   const hit=atlas.pick(canvas,x,y);if(hit?.id==='r48:fields'){chosen=hit;xy={x,y};break;}
 }
 assert.ok(chosen);assert.ok(chosen.anchor.x>=0&&chosen.anchor.x<=1);
 atlas.draw(canvas,w,r,{...options,selectedId:chosen.id,anchor:chosen.anchor,signals:true});
 assert.equal(atlas.pick(canvas,xy.x,xy.y)?.id,chosen.id);
 atlas.draw(canvas,w,r,{...options,detail:'district',selectedId:chosen.id,anchor:chosen.anchor});
 assert.ok(points(atlas,canvas).has(chosen.id));
});
test('uninhabited terrain does not create selectable housing',()=>{
 const atlas=setup(),canvas=fakeCanvas(),w=Core.advance(Core.createWorld('ПЕРСЕИДЫ',{era:'agriculture'}),530).world;
 const region=w.regions.find(r=>r.id==='r15');assert.equal(region.population,0);
 const desc=paint(atlas,canvas,w,region.id);assert.equal(desc.scale,'empty');
 assert.ok(!desc.objects.some(o=>o.kind==='housing'));
 assert.ok(!points(atlas,canvas).has(region.id+':housing'));
});
