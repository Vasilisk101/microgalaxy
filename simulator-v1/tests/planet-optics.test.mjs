import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as Core from '../src/core.mjs';

const source=readFileSync(new URL('../src/planet-optics.js',import.meta.url),'utf8');
class Canvas {
  constructor(width,height){
    this.width=width;this.height=height;this.ownerDocument={createElement:()=>new Canvas(1,1)};
    this.ctx={save(){},restore(){},setTransform(){},clearRect(){},createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),
      putImageData:image=>{this.pixels=image.data;},drawImage:(buffer,...rect)=>{this.buffer=buffer;this.rect=rect;}};
  }
  getContext(){return this.ctx;}
}
function setup(){
  const context=vm.createContext({Core,Uint8ClampedArray,OffscreenCanvas:Canvas});
  const instrumented=source.replace('const engine=opticsEngine();','const engine=opticsEngine();globalThis.engine=engine;');
  const optics=vm.runInContext(instrumented+';PlanetOptics;',context);
  return {optics,engine:context.engine};
}
const world=Core.createWorld('КАЛЛИСТО',{era:'industrial'});
const other=Core.createWorld('ПОЛЯРИС',{era:'industrial'});
const kinds={land:world.planets.find(p=>p.home),rock:other.planets.find(p=>p.kind==='rock'),
  ice:world.planets.find(p=>p.kind==='ice'),gas:world.planets.find(p=>p.kind==='gas')};
function draw(optics,body,options={},width=137,height=137){
  const canvas=new Canvas(width,height);
  const bounds=optics.draw(canvas,world,body,{fit:'disc',dpr:1,lon:.48,lat:.12,light:[-.55,.23,.8],...options,sync:true});
  assert.ok(canvas.buffer?.pixels);return {canvas,bounds,buffer:canvas.buffer,pixels:canvas.buffer.pixels};
}

test('the exact land mask stays tied to Core.terrain at navigation positions and both sides of the coastline',()=>{
  const {engine}=setup();const raw={key:'surface-check',kind:'terrestrial',terrainPhase:Core.rand(world.seed,'terrain')*6.28};
  let land=0,sea=0,coast=0;
  for(let lat=-90;lat<=90;lat+=1.9)for(let lon=-180;lon<=180;lon+=2.3){
    const expected=Core.terrain(world.seed,lon,lat),actual=engine.height(raw,lon*Math.PI/180,lat*Math.PI/180);
    assert.ok(Math.abs(expected-actual)<1e-12);if(Math.abs(expected-.02)<.002)coast++;
    if(actual>=.02)land++;else sea++;
  }
  assert.ok(land&&sea&&coast>10);
});

test('all four bodies produce their own reproducible transparent portrait with the documented centre and radius',()=>{
  const {optics}=setup(),before=JSON.stringify(world),samples=[];
  for(const body of Object.values(kinds)){
    const a=draw(optics,body),b=draw(optics,body);
    assert.equal(a.bounds.cx,68.5);assert.equal(a.bounds.cy,68.5);assert.equal(a.bounds.radius,137*.48);
    assert.equal(a.pixels[3],0);assert.deepEqual(a.pixels,b.pixels);
    const center=(Math.floor(a.buffer.height/2)*a.buffer.width+Math.floor(a.buffer.width/2))*4;
    assert.equal(a.pixels[center+3],255);samples.push([...a.pixels.slice(center,center+3)].join(','));
    const seamA=draw(optics,body,{lon:Math.PI}),seamB=draw(optics,body,{lon:-Math.PI});
    let worst=0;for(let i=0;i<seamA.pixels.length;i++)worst=Math.max(worst,Math.abs(seamA.pixels[i]-seamB.pixels[i]));
    assert.ok(worst<=1,'horizontal seam, '+body.kind+': '+worst);
  }
  assert.equal(new Set(samples).size,4);assert.equal(JSON.stringify(world),before);
});

test('the same screen-space star illuminates the corresponding hemisphere on every material',()=>{
  const {optics}=setup();
  for(const body of Object.values(kinds)){
    const a=draw(optics,body,{light:[1,0,0]}),b=draw(optics,body,{light:[-1,0,0]});
    const mid=Math.floor(a.buffer.width/2),cy=Math.floor(a.buffer.height/2);
    function light(frame,x){const at=(cy*frame.buffer.width+x)*4;return frame.pixels[at]+frame.pixels[at+1]+frame.pixels[at+2];}
    assert.ok(light(a,mid+25)>light(b,mid+25)*1.9);assert.ok(light(b,mid-25)>light(a,mid-25)*1.9);
  }
});

test('surface zoom resolves spatial variation within former pixels on the same dated world; the pole stays finite',()=>{
  const {optics}=setup();
  for(const body of Object.values(kinds)){
    const a=draw(optics,body,{mode:'surface',zoom:1},160,160),b=draw(optics,body,{mode:'surface',zoom:4},160,160);
    let diff=0,varies=0;
    for(let y=24;y<136;y++)for(let x=24;x<136;x++){
      const i=(y*160+x)*4,j=(Math.floor(80+(y+.5-80)/4)*160+Math.floor(80+(x+.5-80)/4))*4;
      diff+=Math.abs(b.pixels[i]-a.pixels[j]);if(b.pixels[i]!==b.pixels[i+4])varies++;
    }
    assert.ok(diff>1000&&varies>300,body.kind);
    const pole=draw(optics,body,{mode:'surface',lat:Math.PI/2,zoom:14});
    assert.ok(pole.pixels.every(Number.isFinite));assert.ok(pole.pixels.some(x=>x>5&&x<250));
  }
});

test('a redrawn shared canvas restores its cached disc; surface navigation keeps the native globe geometry',()=>{
  const {optics}=setup(),canvas=new Canvas(500,300);
  const options={dpr:1,moving:true,lon:0,lat:0,zoom:1.12};
  const bounds=optics.draw(canvas,world,kinds.land,options),original=canvas.buffer;
  assert.equal(bounds.radius,Math.min(500*.43,300*.44)*1.12);
  canvas.buffer=null;optics.draw(canvas,world,kinds.land,options);assert.equal(canvas.buffer,original);
  optics.cancel(canvas);optics.draw(canvas,world,kinds.land,options);assert.notEqual(canvas.buffer,original);
});
