/* Procedural Canvas globe: visual coordinates and camera never alter simulation state. */
// Continuous value noise and its analytic gradient, evaluated in unit-sphere
// space. These are schematic material/relief details, NOT additional model
// geography: they never change the coastline, region identity or route costs.
const materialHash = (()=>{const imul=Math.imul;return (x,y,z,seed)=>{
  let h=imul(x,374761393)^imul(y,668265263)^imul(z,1442695041)^seed;
  h=imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/2147483647.5-1;
};})();
function materialNoise(x,y,z,seed,out){
  const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z),fx=x-ix,fy=y-iy,fz=z-iz;
  const u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy),w=fz*fz*(3-2*fz);
  const a=materialHash(ix,iy,iz,seed),b=materialHash(ix+1,iy,iz,seed),c=materialHash(ix,iy+1,iz,seed),d=materialHash(ix+1,iy+1,iz,seed);
  const e=materialHash(ix,iy,iz+1,seed),f=materialHash(ix+1,iy,iz+1,seed),g=materialHash(ix,iy+1,iz+1,seed),h=materialHash(ix+1,iy+1,iz+1,seed);
  const ab=a+(b-a)*u,cd=c+(d-c)*u,ef=e+(f-e)*u,gh=g+(h-g)*u,lo=ab+(cd-ab)*v,hi=ef+(gh-ef)*v;
  out[0]=lo+(hi-lo)*w;
  out[1]=6*fx*(1-fx)*((b-a)*(1-v)*(1-w)+(d-c)*v*(1-w)+(f-e)*(1-v)*w+(h-g)*v*w);
  out[2]=6*fy*(1-fy)*((cd-ab)*(1-w)+(gh-ef)*w);
  out[3]=6*fz*(1-fz)*(hi-lo);
}
function sampleWrappedTexture(t,lon,lat,out){
  const xf=(((lon/(Math.PI*2)+.5)%1+1)%1)*t.width, yf=Math.max(0,Math.min(t.height-1,(.5-lat/Math.PI)*(t.height-1)));
  const x0=Math.floor(xf),x1=(x0+1)%t.width,y0=Math.floor(yf),y1=Math.min(t.height-1,y0+1),fx=xf-x0,fy=yf-y0;
  for(let k=0;k<3;k++){const a=t.data[(y0*t.width+x0)*4+k]*(1-fx)+t.data[(y0*t.width+x1)*4+k]*fx,b=t.data[(y1*t.width+x0)*4+k]*(1-fx)+t.data[(y1*t.width+x1)*4+k]*fx;out[k]=a*(1-fy)+b*fy;}
}
class Renderer {
  constructor(canvas,onSelect,onSociety,onRegion){
    this.canvas=canvas;this.ctx=canvas.getContext('2d');this.rotation=.25;this.zoom=1;this.layer='nature';this.cacheKey='';this.texture=null;this.renderStats={terrainBuilds:0,textureBuilds:0,projectionBuilds:0};this.onSelect=onSelect;this.onSociety=onSociety;this.onRegion=onRegion;this.hits=[];this.selectedSociety=null;this.selectedRegion=null;
    const pointers=new Map();let lastX=0,lastY=0,moved=0,pinchDistance=0;
    const distance=()=>{const p=[...pointers.values()];return p.length===2?Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y):0;};
    canvas.addEventListener('pointerdown',e=>{pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});lastX=e.clientX;lastY=e.clientY;moved=pointers.size>1?20:0;pinchDistance=distance();canvas.setPointerCapture(e.pointerId);});
    canvas.addEventListener('pointermove',e=>{
      if(!pointers.has(e.pointerId))return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(pointers.size>1){const next=distance();if(pinchDistance>0)this.zoom=Core.clamp(this.zoom*next/pinchDistance,.65,1.65);pinchDistance=next;moved=20;}
      else{const dx=e.clientX-lastX,dy=e.clientY-lastY;moved+=Math.hypot(dx,dy);this.rotation+=dx*.007;}
      lastX=e.clientX;lastY=e.clientY;this.draw();
    });
    canvas.addEventListener('pointerup',e=>{
      const click=pointers.size===1&&moved<8;pointers.delete(e.pointerId);pinchDistance=distance();
      if(click){const box=canvas.getBoundingClientRect(),x=e.clientX-box.left,y=e.clientY-box.top;const hit=this.hits.find(p=>Math.hypot(x-p.x,y-p.y)<p.r+8||(p.label&&x>=p.label.x&&x<=p.label.x+p.label.w&&y>=p.label.y&&y<=p.label.y+p.label.h));if(hit){if(hit.type==='society')this.onSociety?.(hit.id);else if(hit.type==='region')this.onRegion?.(hit.id);else this.onSelect(hit.id);}}
    });
    canvas.addEventListener('pointercancel',e=>{pointers.delete(e.pointerId);moved=20;});
    canvas.addEventListener('wheel',e=>{e.preventDefault();this.zoom=Core.clamp(this.zoom-e.deltaY*.001,.65,1.65);this.draw();},{passive:false});
    canvas.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','+','=','-','0'].includes(e.key))return;e.preventDefault();if(e.key==='ArrowLeft')this.rotation-=.15;else if(e.key==='ArrowRight')this.rotation+=.15;else if(e.key==='0'){this.reset();return;}else this.zoom=Core.clamp(this.zoom+(e.key==='-'?-.1:.1),.65,1.65);this.draw();});
    this.ro=new ResizeObserver(()=>this.draw());this.ro.observe(canvas);
  }
  update(world,mode,planet,layer,selectedSociety=null,selectedRegion=null,movements=[]){this.world=world;this.mode=mode;this.planet=planet;this.layer=layer;this.selectedSociety=selectedSociety;this.selectedRegion=selectedRegion;this.movements=movements;this.draw();}
  reset(){this.rotation=.25;this.zoom=1;this.draw();}
  setFreightRoute(route){this.freightRoute=route;this.draw();}
  focusSociety(id){const s=this.world?.societies.find(s=>s.id===id),r=s?this.world.regions.find(r=>r.id===s.capitalId):null;if(r){this.rotation=r.lon*Math.PI/180;this.selectedSociety=id;this.draw();}}
  focusRegion(id){const r=this.world?.regions.find(r=>r.id===id);if(r){this.rotation=r.lon*Math.PI/180;this.selectedRegion=id;this.draw();}}
  makeTexture(){
    return this.makeCachedTexture();
  }
  makeCachedTexture(){
    const w=this.world,p=this.planet,tw=480,th=240;
    const geography=w.regions.map(r=>[r.id,r.lon,r.lat,r.biome].join(':')).join('|');
    const baseKey=JSON.stringify([w.seed,p.id,p.kind,p.home,geography]);
    if(this.baseKey!==baseKey){
      this.baseKey=baseKey;this.cacheKey='';this.renderStats.terrainBuilds++;
      const base=new Uint8ClampedArray(tw*th*4),indices=new Int16Array(tw*th),heights=new Float32Array(tw*th);
      const q=Core.rand(w.seed,'terrain')*6.28,materialSeed=(Core.rand(w.seed,p.id,'material')*4294967295)>>>0;
      const biomes={highlands:[137,131,119],tundra:[151,161,145],forest:[42,86,56],grassland:[122,143,77],drylands:[192,165,112]};
      const regionVectors=w.regions.map(region=>{const lat=region.lat*Math.PI/180,lon=region.lon*Math.PI/180;return [Math.cos(lat)*Math.cos(lon),Math.sin(lat),Math.cos(lat)*Math.sin(lon)];});
      const regionTones=w.regions.map(region=>biomes[region.biome]??biomes.grassland),noise=[0,0,0,0],frequencies=[18,39,83],amplitudes=[.58,.29,.13];
      // Decorative atmospheric cells, not a simulated fluid/weather model.
      // Storms use spherical local frames, so an oval can cross the UV seam.
      const storms=p.kind==='gas'&&!p.home?[0,1,2].map(n=>{
        const lon=Core.rand(w.seed,p.id,'storm-origin')*Math.PI*2+n*2.1,lat=(n-1)*.38+(Core.rand(w.seed,p.id,'storm-lat',n)-.5)*.18;
        const cl=Math.cos(lat),sl=Math.sin(lat),co=Math.cos(lon),si=Math.sin(lon);
        return {center:[cl*co,sl,cl*si],east:[-si,0,co],north:[-sl*co,cl,-sl*si],width:.22+Core.rand(w.seed,p.id,'storm-size',n)*.09,height:.075+n*.012};
      }):[];
      // This is the same aggregate elevation field that defines the model's
      // regions and land/sea routes; regional biomes are schematic cells.
      for(let y=0;y<th;y++)for(let x=0;x<tw;x++){
        const lat=90-y/(th-1)*180,lon=x/tw*360-180,px=lon*Math.PI/180,py=lat*Math.PI/180;
        const h=Math.sin(px*2+q+Math.sin(py*3))*.46+Math.cos(px*3-py*2+q)*.25+Math.sin(px*5+py*4)*.13+Math.cos(px*11-py*8+q)*.07-Math.abs(lat)/310;
        const i=y*tw+x;heights[i]=h;let near=-1,dist=Infinity,total=0,red=0,green=0,blue=0,highland=0;
        const sx=Math.cos(py)*Math.cos(px),sy=Math.sin(py),sz=Math.cos(py)*Math.sin(px);
        if(p.home&&h>=.02)for(let n=0;n<regionVectors.length;n++){
          const v=regionVectors[n],rawDistance=2-2*(sx*v[0]+sy*v[1]+sz*v[2]),d=rawDistance>0?rawDistance:0,inv=1/(d+.035),weight=inv*inv*inv,tone=regionTones[n];
          total+=weight;red+=tone[0]*weight;green+=tone[1]*weight;blue+=tone[2]*weight;if(w.regions[n].biome==='highlands')highland+=weight;
          if(d<dist){dist=d;near=n;}
        }
        indices[i]=near;
        let c;
        if(!p.home){
          if(p.kind==='gas'){
            materialNoise(sx*7+8.2,sy*11-3.1,sz*7+2.7,materialSeed,noise);const eddy=noise[0];
            materialNoise(sx*23+1.7,sy*43+5.1,sz*23-3.2,materialSeed+1013,noise);const cells=noise[0];
            materialNoise(sx*61-4.3,sy*97+7.4,sz*61+8.1,materialSeed+2026,noise);const wisps=noise[0];
            const latitude=sy+(.028*eddy+.009*cells)*(1-sy*sy),phase=latitude*31+q*.5;
            const broad=.5+.5*Math.sin(phase),ribbons=Math.sin(latitude*91+eddy*3+cells*1.3),filaments=cells*11+wisps*6;
            const belt=Core.clamp(broad*.82+ribbons*.1+.1,0,1),cool=Math.max(0,Math.sin(phase*.5+1.1))*.2;
            c=[116+belt*108+filaments,91+belt*117+filaments+cool*20,70+belt*108+filaments+cool*31];
            for(const storm of storms){
              const front=sx*storm.center[0]+sy*storm.center[1]+sz*storm.center[2];if(front<.88)continue;
              const u=(sx*storm.east[0]+sz*storm.east[2])/storm.width,v=(sx*storm.north[0]+sy*storm.north[1]+sz*storm.north[2])/storm.height;
              const radius=Math.sqrt(u*u+v*v);if(radius>1.8)continue;
              const mask=Math.exp(-radius*radius*1.6),swirl=Math.sin(radius*18-Math.atan2(v,u)*2+cells*1.8)*8*Math.min(1,radius*3);
              const rim=Math.exp(-(((radius-1.05)*5)**2))*.24;
              const tone=[183+swirl,130+swirl,92+swirl];
              for(let k=0;k<3;k++)c[k]=c[k]*(1-mask*.74-rim)+tone[k]*mask*.74+[231,217,187][k]*rim;
            }
          }else{
          const phase=Core.rand(w.seed,p.id,'surface-phase')*Math.PI*2;
          const grain=(Math.sin(sx*83+sy*47+phase)*Math.sin(sz*71+phase)+Math.cos(sx*31+sz*41+sy*17+phase))*.5;
          const detail=Math.sin(sx*23+Math.sin(sy*19+phase)*1.7)*Math.cos(sz*29-sy*4)+.45*Math.sin(sx*57-sz*43+phase)*Math.sin(sy*53+sz*8);
          if(p.kind==='ice'){
            materialNoise(sx*8+12,sy*8-4,sz*8+3,materialSeed,noise);const drift=noise[0];
            const fracture=Math.exp(-Math.abs(Math.sin(sx*13+sy*8+sz*5+phase+drift*2))*22);
            const ice=drift*24-fracture*38+grain*7;c=[158+ice,181+ice,189+ice];
          }else c=[119+detail*12+grain*8,101+detail*9+grain*7,87+detail*7+grain*6];
          }
        }
        else if(h<.02){
          // Bathymetry, not cloudy noise: a narrow clear shelf and calm deep sea.
          const depth=Core.clamp((.02-h)*2.8,0,1),shelf=Math.exp(-Math.max(0,.02-h)*50);
          c=[14-depth*6+shelf*29,57-depth*22+shelf*49,86-depth*19+shelf*35];
        }
        else {
          // Biomes are aggregate samples, not surveyed borders: blend their
          // colours for material only. Ownership overlays retain categorical cells.
          const biome=total?[red/total,green/total,blue/total]:biomes.grassland;
          // Three spatial scales keep ridge structure readable at a 320px globe.
          // Analytic derivatives avoid extra neighbour samples and UV/pole seams.
          let relief=0,gx=0,gy=0,gz=0,fine=0;
          for(let octave=0;octave<3;octave++){
            const freq=frequencies[octave],amp=amplitudes[octave];
            materialNoise(sx*freq+17.3,sy*freq-9.1,sz*freq+4.7,materialSeed+octave*1013,noise);
            const derivative=-2*noise[0];
            relief+=(1-noise[0]*noise[0])*amp;gx+=noise[1]*derivative*amp*freq;gy+=noise[2]*derivative*amp*freq;gz+=noise[3]*derivative*amp*freq;
            if(octave===2)fine=noise[0];
          }
          materialNoise(sx*7+32.1,sy*7+11.7,sz*7-3.9,materialSeed,noise);
          const patch=noise[0],mountain=Core.clamp((h-.14)*1.55+(total?highland/total:0)*.6,0,1);
          const dhx=2*.46*Math.cos(px*2+q+Math.sin(py*3))-3*.25*Math.sin(px*3-py*2+q)+5*.13*Math.cos(px*5+py*4)-11*.07*Math.sin(px*11-py*8+q);
          const dhy=3*.46*Math.cos(py*3)*Math.cos(px*2+q+Math.sin(py*3))+2*.25*Math.sin(px*3-py*2+q)+4*.13*Math.cos(px*5+py*4)+8*.07*Math.sin(px*11-py*8+q);
          const east=-gx*Math.sin(px)+gz*Math.cos(px),north=-gx*sy*Math.cos(px)+gy*Math.cos(py)-gz*sy*Math.sin(px);
          const slope=(east*.58+north*.42)*(.012+.024*mountain),light=Core.clamp(1+slope+(dhx*.5-dhy*.4)*.035,.8,1.2);
          const exposed=Core.clamp((h-.36)*1.8+(relief-.64)*mountain*1.6,0,.85),snow=Core.clamp((h-.72)*3.8+(Math.abs(lat)-65)/35,0,.9)*Core.clamp((relief-.44)*3,0,1);
          const shore=Core.clamp((.04-h)/.02,0,1),texture=patch*17+fine*9+(relief-.65)*(8+mountain*18);
          c=biome.map((v,k)=>{
            const rock=[164,157,143][k],ice=[218,226,220][k],sand=[178,164,124][k];
            let material=(v+texture)*(1-exposed)+rock*exposed;material=material*(1-snow)+ice*snow;material=material*(1-shore*.55)+sand*shore*.55;
            return material*light;
          });
          if(Math.abs(lat)>76)c=[190+fine*7,200+fine*7,195+fine*7];
        }
        const o=i*4;base[o]=c[0];base[o+1]=c[1];base[o+2]=c[2];base[o+3]=255;
      }
      // Longitude is undefined at the poles. Blend just the outer three raster
      // rows to their own circular mean; retain the model field everywhere else.
      for(const edge of [0,th-1]){const mean=[0,0,0];for(let x=0;x<tw;x++)for(let k=0;k<3;k++)mean[k]+=base[(edge*tw+x)*4+k]/tw;for(let n=0;n<3;n++){const y=edge===0?n:th-1-n,blend=1-n/3;for(let x=0;x<tw;x++)for(let k=0;k<3;k++){const o=(y*tw+x)*4+k;base[o]=base[o]*(1-blend)+mean[k]*blend;}}}
      this.baseTexture={data:base,indices,heights};
    }
    const dynamic=this.layer==='political'?w.regions.map(r=>r.owner).join('|')+'|'+w.societies.map(s=>s.id+':'+s.color).join('|'):this.layer==='climate'?String(w.climate.warming):['cohesion','autonomy'].includes(this.layer)?w.regions.map(r=>this.layer==='cohesion'?r.social?.cohesion:r.culture?.autonomy).join('|'):'';
    const key=JSON.stringify([baseKey,this.layer,dynamic]);if(key===this.cacheKey)return;
    this.cacheKey=key;this.renderStats.textureBuilds++;
    const {data:base,indices,heights}=this.baseTexture,data=new Uint8ClampedArray(base),owners=new Int16Array(tw*th);
    const colors=new Map(w.societies.map((s,i)=>[s.id,{rgb:[1,3,5].map(j=>parseInt(s.color.slice(j,j+2),16)),index:i+1}]));
    if(p.home&&['political','climate','cohesion','autonomy'].includes(this.layer))for(let i=0;i<indices.length;i++){
      const ri=indices[i];if(ri<0)continue;const r=w.regions[ri],o=i*4;let c=null;
      if(this.layer==='political'){const owner=colors.get(r.owner);if(owner){c=owner.rgb;owners[i]=owner.index;}}
      else if(this.layer==='climate'){const lat=90-Math.floor(i/tw)/th*180,t=Core.clamp((48-Math.abs(lat)*.65+w.climate.warming+6*heights[i])/55,0,1);c=[65+151*t,124+30*(1-Math.abs(t-.5)*2),162-90*t];}
      else {const raw=this.layer==='cohesion'?r.social?.cohesion:r.culture?.autonomy;if(Number.isFinite(raw)){const v=Core.clamp(raw,0,1);c=[97+82*v,115+25*v,108-44*v];}}
      if(c)for(let k=0;k<3;k++)data[o+k]=base[o+k]*.28+c[k]*.72;
    }
    if(p.home&&this.layer==='political')for(let y=1;y<th-1;y++)for(let x=0;x<tw;x++){const i=y*tw+x,owner=owners[i],right=owners[y*tw+(x+1)%tw],below=owners[i+tw];if(owner&&((right&&right!==owner)||(below&&below!==owner))){const o=i*4;data[o]=216;data[o+1]=219;data[o+2]=196;}}
    this.texture={data,width:tw,height:th};
  }
  draw(){
    if(!this.world||!this.canvas.clientWidth||!this.ctx)return;
    const c=this.canvas,ctx=this.ctx,dpr=Math.min(window.devicePixelRatio||1,1.5),W=c.clientWidth,H=c.clientHeight;
    const pixelWidth=Math.round(W*dpr),pixelHeight=Math.round(H*dpr);if(c.width!==pixelWidth)c.width=pixelWidth;if(c.height!==pixelHeight)c.height=pixelHeight;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#070d10';ctx.fillRect(0,0,W,H);this.hits=[];
    for(let i=0;i<110;i++){const x=Core.rand(this.world.seed,'sky',i,'x')*W,y=Core.rand(this.world.seed,'sky',i,'y')*H;ctx.fillStyle='rgba(184,202,209,'+(.1+Core.rand(this.world.seed,i,'brightness')*.5)+')';ctx.fillRect(x,y,i%9===0?1.5:.8,i%9===0?1.5:.8);}
    if(this.mode==='system')this.system(ctx,W,H);else this.globe(ctx,W,H);
  }
  project(region,cx,cy,R){const p=region.lat*Math.PI/180,l=region.lon*Math.PI/180-this.rotation;return {x:cx+Math.cos(p)*Math.sin(l)*R,y:cy-Math.sin(p)*R,z:Math.cos(p)*Math.cos(l)};}
  globe(ctx,W,H){
    this.makeTexture();
    const R=Math.min(W*.43,H*.44)*this.zoom,cx=W*.5,cy=H*.5,political=this.layer==='political'&&this.planet.home,regional=['settlements','routes'].includes(this.layer)&&this.planet.home;
    const sz=Math.min(600,Math.max(180,Math.ceil(R*2))),r=sz/2,off=this.globeCanvas??=document.createElement('canvas');if(off.width!==sz||off.height!==sz){off.width=sz;off.height=sz;this.globeImage=null;this.projectionKey='';}const o=off.getContext('2d'),img=this.globeImage??=o.createImageData(sz,sz),a=img.data,t=this.texture;
    const projectionKey=JSON.stringify([this.cacheKey,sz,this.rotation,political,regional]);
    if(projectionKey!==this.projectionKey){this.projectionKey=projectionKey;this.renderStats.projectionBuilds++;
    const sampled=[0,0,0];for(let y=0;y<sz;y++)for(let x=0;x<sz;x++){
      const nx=(x-r+.5)/r,ny=(r-y-.5)/r,d=nx*nx+ny*ny;if(d>1)continue;
      const z=Math.sqrt(1-d),lat=Math.asin(ny),lon=Math.atan2(nx,z)+this.rotation,di=(y*sz+x)*4;sampleWrappedTexture(t,lon,lat,sampled);
      const sun=Math.max(0,nx*-.43+ny*.3+z*.82),shade=(political||regional)?.58+.42*sun:.39+.61*sun,limb=(1-z)**4;
      for(let k=0;k<3;k++)a[di+k]=sampled[k]*shade+[29,50,58][k]*limb*.3;a[di+3]=255;
    }
    o.putImageData(img,0,0);}ctx.drawImage(off,cx-R,cy-R,R*2,R*2);
    if(this.planet.home){ctx.strokeStyle='rgba(153,186,188,.38)';ctx.lineWidth=1;ctx.beginPath();ctx.arc(cx,cy,R-.5,0,Math.PI*2);ctx.stroke();}
    if(!this.planet.home)return;
    if(!this.hideSignals){
      this.drawFreightRoute(ctx,cx,cy,R);
      if(this.signalRegions?.length){
        ctx.save();ctx.lineWidth=1.6;ctx.strokeStyle='#ffc47e';
        for(const region of this.signalRegions){
          const p=this.project(region,cx,cy,R);if(p.z<.04)continue;
          ctx.beginPath();ctx.moveTo(p.x,p.y-6);ctx.lineTo(p.x+6,p.y);ctx.lineTo(p.x,p.y+6);ctx.lineTo(p.x-6,p.y);ctx.closePath();ctx.stroke();
        }
        ctx.restore();
      }
    }
    if(regional){if(this.layer==='routes'){this.regionConnections(ctx,cx,cy,R);this.migrationRoutes(ctx,cx,cy,R);}this.settlements(ctx,W,H,cx,cy,R);return;}
    if(political){
      const previous=this.world.snapshots.filter(s=>s.year<this.world.year).at(-1),oldOwners=previous?new Map(previous.regions.map(r=>[r.id,r.owner])):null;
      if(oldOwners)for(const region of this.world.regions){if(oldOwners.get(region.id)===region.owner)continue;const point=this.project(region,cx,cy,R);if(point.z<.08)continue;ctx.strokeStyle='#f2d999';ctx.lineWidth=1.3;ctx.beginPath();ctx.moveTo(point.x,point.y-4);ctx.lineTo(point.x+4,point.y);ctx.lineTo(point.x,point.y+4);ctx.lineTo(point.x-4,point.y);ctx.closePath();ctx.stroke();}
    }
    const occupied=[{x:0,y:0,w:W*.7,h:133},{x:0,y:H-133,w:Math.min(W-30,420),h:133}];
    const overlaps=box=>occupied.some(p=>box.x<p.x+p.w+3&&box.x+box.w+3>p.x&&box.y<p.y+p.h+3&&box.y+box.h+3>p.y);
    const societies=this.world.societies.slice().sort((a,b)=>Number(b.id===this.selectedSociety)-Number(a.id===this.selectedSociety)||b.population-a.population);
    for(const s of societies){
      const region=this.world.regions.find(r=>r.id===s.capitalId);if(!region||s.population<=0)continue;
      const point=this.project(region,cx,cy,R);if(point.z<.08)continue;
      const selected=s.id===this.selectedSociety,rad=selected?5:3.5;
      ctx.fillStyle=political?s.color:'#f7d294';ctx.strokeStyle='#071317';ctx.lineWidth=3;ctx.beginPath();ctx.arc(point.x,point.y,rad,0,Math.PI*2);ctx.stroke();ctx.fill();
      if(selected&&political){ctx.strokeStyle='#e15b4a';ctx.lineWidth=2;ctx.beginPath();ctx.arc(point.x,point.y,rad+5,0,Math.PI*2);ctx.stroke();}
      if(!political)continue;
      const hit={id:s.id,type:'society',x:point.x,y:point.y,r:rad+3};this.hits.push(hit);
      ctx.font=(selected?'600 ':'')+'11px Segoe UI, sans-serif';
      const name=s.name+(this.world.societies.some(other=>other.id!==s.id&&other.name===s.name)?' · '+s.id:'');
      const width=ctx.measureText(name).width+16,height=24;
      const positions=[{x:point.x+12,y:point.y-height-5},{x:point.x-width-12,y:point.y-height-5},{x:point.x+12,y:point.y+8},{x:point.x-width-12,y:point.y+8}];
      const label=positions.map(p=>({...p,w:width,h:height})).find(p=>p.x>=10&&p.x+p.w<=W-10&&p.y>=10&&p.y+p.h<=H-10&&!overlaps(p));
      if(!label)continue;occupied.push(label);hit.label=label;
      ctx.strokeStyle=s.color;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(point.x,point.y);ctx.lineTo(label.x>point.x?label.x:label.x+label.w,label.y+label.h/2);ctx.stroke();
      ctx.fillStyle='#0c151bea';ctx.fillRect(label.x,label.y,label.w,label.h);ctx.strokeStyle=selected?'#e3eac9':'#485c58';ctx.strokeRect(label.x+.5,label.y+.5,label.w-1,label.h-1);ctx.fillStyle='#f0f3e8';ctx.fillText(name,label.x+8,label.y+16);
    }
  }
  routePoint(a,b,t){
    const vector=r=>{const lat=r.lat*Math.PI/180,lon=r.lon*Math.PI/180;return [Math.cos(lat)*Math.cos(lon),Math.cos(lat)*Math.sin(lon),Math.sin(lat)];};
    const av=vector(a),bv=vector(b),v=av.map((x,i)=>x*(1-t)+bv[i]*t),length=Math.hypot(...v)||1;
    return {lat:Math.asin(Core.clamp(v[2]/length,-1,1))*180/Math.PI,lon:Math.atan2(v[1],v[0])*180/Math.PI};
  }
  drawFreightRoute(ctx,cx,cy,R){
    const route=this.freightRoute;if(!route||route.worldId!==this.world.id)return;
    const regions=new Map(this.world.regions.map(r=>[r.id,r])),edges=new Map(this.world.geography.edges.map(e=>[e.id,e]));
    ctx.save();ctx.strokeStyle='#f5c86b';ctx.lineWidth=3;ctx.setLineDash([7,5]);
    for(const id of route.path){const edge=edges.get(id),a=regions.get(edge?.a),b=regions.get(edge?.b);if(!a||!b)continue;ctx.beginPath();let visible=false;for(let j=0;j<=32;j++){const p=this.project(this.routePoint(a,b,j/32),cx,cy,R*1.01);if(p.z>.025){if(visible)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);visible=true;}else visible=false;}ctx.stroke();}
    ctx.setLineDash([]);for(const id of [route.from,route.to]){const region=regions.get(id);if(!region)continue;const p=this.project(region,cx,cy,R*1.01);if(p.z<=.025)continue;ctx.beginPath();ctx.arc(p.x,p.y,6,0,Math.PI*2);ctx.fillStyle='#f5c86b';ctx.fill();ctx.strokeStyle='#102529';ctx.lineWidth=2;ctx.stroke();}ctx.restore();
  }
  regionConnections(ctx,cx,cy,R){
    if(!this.selectedRegion)return;
    const regions=new Map(this.world.regions.map(r=>[r.id,r]));
    for(const edge of this.world.geography.edges){
      if(edge.a!==this.selectedRegion&&edge.b!==this.selectedRegion)continue;
      const a=regions.get(edge.a),b=regions.get(edge.b);if(!a||!b)continue;
      ctx.strokeStyle=edge.kind==='sea'?'#6d91a4a8':'#89977fa8';ctx.lineWidth=.8;ctx.setLineDash(edge.kind==='sea'?[3,5]:[]);ctx.beginPath();let last=null;
      for(let j=0;j<=32;j++){const p=this.project(this.routePoint(a,b,j/32),cx,cy,R*1.002);if(p.z>.025){if(last)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);last=p;}else last=null;}
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  migrationRoutes(ctx,cx,cy,R){
    const regions=new Map(this.world.regions.map(r=>[r.id,r])),edges=new Map(this.world.geography.edges.map(e=>[e.id,e]));
    for(const movement of this.movements??[]){
      if(movement.year>this.world.year||movement.year<this.world.year-9||movement.people<=0)continue;
      for(let i=0;i<movement.path.length-1;i++){
        const a=regions.get(movement.path[i]),b=regions.get(movement.path[i+1]),edge=edges.get(movement.edgeIds[i]);if(!a||!b||!edge)continue;
        const color=edge.kind==='sea'?'#87c7e4':'#d3dda4',width=Core.clamp(1+Math.log10(movement.people+1)*.4,1.2,2.8);
        ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(edge.kind==='sea'?[5,4]:[]);ctx.beginPath();
        let last=null;
        for(let j=0;j<=32;j++){const p=this.project(this.routePoint(a,b,j/32),cx,cy,R*1.003);if(p.z>.025){if(last)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);last=p;}else last=null;}
        ctx.stroke();ctx.setLineDash([]);
        const from=this.project(this.routePoint(a,b,.48),cx,cy,R*1.006),tip=this.project(this.routePoint(a,b,.55),cx,cy,R*1.006);
        if(from.z>.05&&tip.z>.05){const angle=Math.atan2(tip.y-from.y,tip.x-from.x),size=4+width;ctx.beginPath();ctx.moveTo(tip.x-Math.cos(angle-.55)*size,tip.y-Math.sin(angle-.55)*size);ctx.lineTo(tip.x,tip.y);ctx.lineTo(tip.x-Math.cos(angle+.55)*size,tip.y-Math.sin(angle+.55)*size);ctx.stroke();}
      }
    }
    ctx.setLineDash([]);
  }
  settlements(ctx,W,H,cx,cy,R){
    const occupied=[{x:0,y:0,w:W*.7,h:133},{x:0,y:H-218,w:Math.min(W-20,455),h:218}],colors=new Map(this.world.societies.map(s=>[s.id,s.color]));
    const overlaps=box=>occupied.some(p=>box.x<p.x+p.w+3&&box.x+box.w+3>p.x&&box.y<p.y+p.h+3&&box.y+box.h+3>p.y);
    const rows=this.world.regions.slice().sort((a,b)=>Number(b.id===this.selectedRegion)-Number(a.id===this.selectedRegion)||b.population-a.population);
    let labels=0;
    for(const region of rows){
      if(!region.settlement)continue;const point=this.project(region,cx,cy,R);if(point.z<.08)continue;
      const selected=region.id===this.selectedRegion,kind=region.settlement.kind,rad=(kind==='city'?4.5:kind==='town'?3.7:2.7)+(selected?1.5:0),color=colors.get(region.owner)??'#c9d5a6';
      ctx.fillStyle=color;ctx.strokeStyle='#061115';ctx.lineWidth=2.5;ctx.beginPath();
      if(kind==='city'){ctx.rect(point.x-rad,point.y-rad,rad*2,rad*2);}else if(kind==='town'){ctx.moveTo(point.x,point.y-rad-1);ctx.lineTo(point.x+rad+1,point.y);ctx.lineTo(point.x,point.y+rad+1);ctx.lineTo(point.x-rad-1,point.y);ctx.closePath();}else ctx.arc(point.x,point.y,rad,0,Math.PI*2);
      ctx.stroke();ctx.fill();
      if(selected){ctx.strokeStyle='#e15b4a';ctx.lineWidth=2;ctx.beginPath();ctx.arc(point.x,point.y,rad+5,0,Math.PI*2);ctx.stroke();}
      const hit={id:region.id,type:'region',x:point.x,y:point.y,r:rad+3};this.hits.push(hit);
      if(labels>=8&&!selected)continue;
      const baseName=region.settlement.name,name=baseName+(this.world.regions.some(r=>r.id!==region.id&&r.settlement?.name===baseName)?' · '+region.id:'');
      ctx.font=(selected?'600 ':'')+'11px Segoe UI, sans-serif';const width=ctx.measureText(name).width+16,height=24;
      const positions=[{x:point.x+12,y:point.y-height-5},{x:point.x-width-12,y:point.y-height-5},{x:point.x+12,y:point.y+8},{x:point.x-width-12,y:point.y+8}];
      const label=positions.map(p=>({...p,w:width,h:height})).find(p=>p.x>=10&&p.x+p.w<=W-10&&p.y>=10&&p.y+p.h<=H-10&&!overlaps(p));if(!label)continue;
      occupied.push(label);hit.label=label;labels++;
      ctx.strokeStyle=color;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(point.x,point.y);ctx.lineTo(label.x>point.x?label.x:label.x+label.w,label.y+label.h/2);ctx.stroke();
      ctx.fillStyle='#0c151bf2';ctx.fillRect(label.x,label.y,label.w,label.h);ctx.strokeStyle=selected?'#e3eac9':'#485c58';ctx.strokeRect(label.x+.5,label.y+.5,label.w-1,label.h-1);ctx.fillStyle='#f0f3e8';ctx.fillText(name,label.x+8,label.y+16);
    }
  }
  system(ctx,W,H){
    const cx=W*.5,cy=H*.56,max=Math.min(W*.43,H*.38)*this.zoom;
    const bodies=this.world.planets,planets=bodies.filter(p=>!p.parentId).slice().sort((a,b)=>a.a-b.a),positions=new Map(),labels=[];
    const label=(name,x,y)=>{if(W<500)return;const width=Math.min(160,name.length*6),candidates=[[x+12,y-15],[x+12,y+17],[x-width-12,y-15],[x-width-12,y+17]];for(const [lx,ly] of candidates){const box={x:lx,y:ly-10,w:width,h:14};if(box.x<4||box.x+box.w>W-4||box.y<4||box.y+box.h>H-4||labels.some(z=>box.x<z.x+z.w+4&&box.x+box.w+4>z.x&&box.y<z.y+z.h+4&&box.y+box.h+4>z.y))continue;labels.push(box);ctx.fillStyle='#d8e7e3';ctx.font='10px Segoe UI';ctx.fillText(name,lx,ly);return;}};
    const minA=Math.min(...planets.map(p=>p.a)),maxA=Math.max(...planets.map(p=>p.a)),span=Math.max(.001,Math.log(maxA/minA));
    ctx.save();ctx.strokeStyle='#43535a88';ctx.lineWidth=1;
    for(const p of planets){const r=35+(Math.log(p.a/minA)/span)*(Math.max(40,max)-35);ctx.beginPath();ctx.ellipse(cx,cy,r,r*.65,0,0,Math.PI*2);ctx.stroke();
      const a=p.phase+this.world.year/Math.max(1,p.period)*.25,x=cx+Math.cos(a)*r,y=cy+Math.sin(a)*r*.65,rad=p.kind==='gas'?8:p.home?7:4;
      positions.set(p.id,{x,y,rad});ctx.fillStyle=p.home?'#72a9b7':p.kind==='ice'?'#b4ced4':p.kind==='gas'?'#cfa873':'#9c8a78';ctx.beginPath();ctx.arc(x,y,rad,0,Math.PI*2);ctx.fill();label(p.name,x,y);this.hits.push({id:p.id,type:'planet',x,y,r:rad});
    }
    // Moons orbit the parent on screen; their display separation is schematic.
    for(const p of planets){const parent=positions.get(p.id),moons=bodies.filter(m=>m.parentId===p.id);moons.forEach((moon,i)=>{const radius=20+i*9,angle=moon.phase+this.world.year/Math.max(.01,moon.orbit?.period??1)*.04,x=parent.x+Math.cos(angle)*radius,y=parent.y+Math.sin(angle)*radius;ctx.strokeStyle='#93adb466';ctx.lineWidth=.8;ctx.beginPath();ctx.arc(parent.x,parent.y,radius,0,Math.PI*2);ctx.stroke();ctx.fillStyle=moon.kind==='ice'?'#c9e1e4':'#b8aa9b';ctx.beginPath();ctx.arc(x,y,3.5,0,Math.PI*2);ctx.fill();label(moon.name,x,y);this.hits.push({id:moon.id,type:'planet',x,y,r:5});});}
    const g=ctx.createRadialGradient(cx,cy,2,cx,cy,38);g.addColorStop(0,'#fff1be');g.addColorStop(.28,'#ffcb80');g.addColorStop(1,'#f3a95300');ctx.fillStyle=g;ctx.beginPath();ctx.arc(cx,cy,38,0,Math.PI*2);ctx.fill();ctx.fillStyle='#d6e2be';ctx.font='10px Consolas';ctx.fillText(W<500?'Выбор тела — список «Объект»':'Обзорный масштаб · расстояния спутников условны',20,H-22);ctx.restore();
  }}
