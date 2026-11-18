// Offline component QA only: no browser, network, screenshots, or altered renderer.
// Run: node simulator-v08/qa/offline-globes.mjs
import {readFile,mkdir} from 'node:fs/promises';
import vm from 'node:vm';
import sharp from 'sharp';
import * as Core from '../src/core.mjs';

let image,draw;
const offscreen={width:0,height:0,getContext(){return {createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4),width:w,height:h};},putImageData(value){image=value;}};}};
const ctx=new Proxy({drawImage(_canvas,x,y,w,h){draw={x,y,w,h};},measureText(s){return {width:String(s).length*6};}}, {get(target,key){if(key in target)return target[key];return ()=>{};},set(target,key,value){target[key]=value;return true;}});
const context={Core,Math,ResizeObserver:class{observe(){}},window:{devicePixelRatio:1},document:{createElement(){return offscreen;}}};
vm.runInNewContext(await readFile(new URL('../src/renderer.js',import.meta.url),'utf8')+';this.Renderer=Renderer;',context);
const world=Core.createWorld('MICROGALAXY-V08-UI-REVIEW',{era:'industrial'});
const canvas={getContext(){return ctx;},addEventListener(){},clientWidth:0};
const renderer=new context.Renderer(canvas,()=>{},()=>{},()=>{});renderer.world=world;renderer.mode='planet';renderer.layer='nature';
const folder=new URL('./offline-render/',import.meta.url);await mkdir(folder,{recursive:true});
for(const size of [320,480])for(const item of [{name:'home-zero',angle:0,home:true},{name:'home-east-pi',angle:Math.PI,home:true},{name:'home-west-pi',angle:-Math.PI,home:true},{name:'gas-zero',angle:0,home:false}]){
  renderer.planet=item.home?world.planets.find(p=>p.home):(world.planets.find(p=>p.kind==='gas')??{id:'qa-gas',kind:'gas',home:false});
  renderer.rotation=item.angle;renderer.globe(ctx,size,size);
  const diameter=Math.max(1,Math.round(draw.w)),left=Math.round(draw.x),top=Math.round(draw.y);
  const globe=await sharp(Buffer.from(image.data),{raw:{width:image.width,height:image.height,channels:4}}).resize(diameter,diameter).png().toBuffer();
  const filename=new URL(`${item.name}-${size}.png`,folder);
  await sharp({create:{width:size,height:size,channels:4,background:'#070d10'}}).composite([{input:globe,left,top}]).png().toFile(filename.pathname);
  console.log(filename.pathname);
}
