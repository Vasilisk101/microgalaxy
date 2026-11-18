import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as Core from '../src/core.mjs';

const context={Core,Math,ResizeObserver:class{observe(){}},window:{devicePixelRatio:1}};
vm.runInNewContext(readFileSync(new URL('../src/renderer.js',import.meta.url),'utf8')+';this.Renderer=Renderer;this.noise=materialNoise;',context);
function setup(seed){
  const r=new context.Renderer({getContext:()=>({}),addEventListener(){},clientWidth:0});
  r.world=Core.createWorld(seed);r.planet=r.world.planets.find(p=>p.home);r.layer='nature';r.makeTexture();return r;
}
test('continuous material gradients match numerical derivatives, including lattice faces',()=>{
  const a=[],b=[],center=[],eps=1e-5;
  for(const point of [[1.25,-2.4,3.7],[2,-1,0],[-12.001,8.999,1.5]]){
    context.noise(...point,123,center);
    for(let axis=0;axis<3;axis++){
      const lo=[...point],hi=[...point];lo[axis]-=eps;hi[axis]+=eps;
      context.noise(...lo,123,a);context.noise(...hi,123,b);
      assert.ok(Math.abs(center[axis+1]-(b[0]-a[0])/(2*eps))<.0002);
    }
  }
});
test('decorative materials retain exact model coastline, deterministic output and bounded cache',()=>{
  const r=setup('MICROGALAXY-V08-UI-REVIEW'),before=JSON.stringify(r.world),{width,height,data}=r.texture;
  for(let y=0;y<height;y+=7)for(let x=0;x<width;x+=7){
    const i=y*width+x,h=Core.terrain(r.world.seed,x/width*360-180,90-y/(height-1)*180);
    assert.ok(Math.abs(r.baseTexture.heights[i]-h)<1e-6);
    assert.equal(r.baseTexture.indices[i]>=0,h>=.02);
  }
  const copy=data.slice();r.baseKey='';r.makeTexture();assert.deepEqual(r.texture.data,copy);assert.equal(JSON.stringify(r.world),before);
  assert.equal(width*height,480*240);
  const persistentBytes=r.baseTexture.data.byteLength+r.baseTexture.indices.byteLength+r.baseTexture.heights.byteLength+r.texture.data.byteLength;
  assert.equal(persistentBytes,1612800);
});
test('land has readable multiscale relief while open ocean stays calm',()=>{
  for(const seed of ['MICROGALAXY-V08-UI-REVIEW','material-sea-2']){
    const r=setup(seed),{data,width:w,height:h}=r.texture,hs=r.baseTexture.heights;
    const luminance=i=>.2126*data[i*4]+.7152*data[i*4+1]+.0722*data[i*4+2];
    const land=[],ocean=[],tones=[];
    for(let y=20;y<h-20;y++)for(let x=0;x<w;x++){
      const i=y*w+x,neighbours=[y*w+(x+w-1)%w,y*w+(x+1)%w,i-w,i+w],height=hs[i];
      if(neighbours.some(j=>(hs[j]>=.02)!==(height>=.02)))continue;
      const residual=Math.abs(luminance(i)-neighbours.reduce((n,j)=>n+luminance(j),0)/4);
      if(height>.09){land.push(residual);tones.push(luminance(i));}else if(height<-.08)ocean.push(residual);
    }
    const mean=a=>a.reduce((a,b)=>a+b,0)/a.length;tones.sort((a,b)=>a-b);
    assert.ok(land.length>1000&&ocean.length>1000);
    assert.ok(mean(land)>.7,'land must not regress to a smooth flat wash');
    assert.ok(mean(land)>mean(ocean)*3,'do not put cloudy terrain noise in open water');
    assert.ok(tones[Math.floor(tones.length*.95)]-tones[Math.floor(tones.length*.05)]>35,'biomes and relief need meaningful dynamic range');
  }
});
