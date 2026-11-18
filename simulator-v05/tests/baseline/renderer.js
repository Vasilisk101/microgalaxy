/* Procedural Canvas globe: visual coordinates and camera never alter simulation state. */
class Renderer {
  constructor(canvas,onSelect,onSociety,onRegion){
    this.canvas=canvas;this.ctx=canvas.getContext('2d');this.rotation=.25;this.zoom=1;this.layer='nature';this.cacheKey='';this.texture=null;this.onSelect=onSelect;this.onSociety=onSociety;this.onRegion=onRegion;this.hits=[];this.selectedSociety=null;this.selectedRegion=null;
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
  focusSociety(id){const s=this.world?.societies.find(s=>s.id===id),r=s?this.world.regions.find(r=>r.id===s.capitalId):null;if(r){this.rotation=r.lon*Math.PI/180;this.selectedSociety=id;this.draw();}}
  focusRegion(id){const r=this.world?.regions.find(r=>r.id===id);if(r){this.rotation=r.lon*Math.PI/180;this.selectedRegion=id;this.draw();}}
  makeTexture(){
    const w=this.world,p=this.planet,key=w.seed+p.id+this.layer+Math.floor(w.year/10)+w.regions.map(r=>r.owner).join('');
    if(key===this.cacheKey)return;this.cacheKey=key;
    const tw=480,th=240,data=new Uint8ClampedArray(tw*th*4),owners=new Uint16Array(tw*th),socIndexes=new Map(w.societies.map((s,i)=>[s.id,i+1]));
    const col=s=>[1,3,5].map(i=>parseInt(s.slice(i,i+2),16)),colors=new Map(w.societies.map(s=>[s.id,col(s.color)]));
    for(let y=0;y<th;y++)for(let x=0;x<tw;x++){
      const lat=90-y/th*180,lon=x/tw*360-180,land=Core.terrain(w.seed,lon,lat),n=Core.rand(w.seed,'tex',Math.floor(x/2),Math.floor(y/2));let c;
      if(!p.home){if(p.kind==='gas'){const bands=.5+.5*Math.sin(lat*.4+Math.sin(lon*.05));c=[145+bands*45,111+bands*30,77+bands*20];}else if(p.kind==='ice')c=[126+n*32,153+n*28,165+n*22];else c=[104+land*40+n*15,83+land*30+n*10,67+land*20+n*10];}
      else if(Math.abs(lat)>76+n*9)c=[192+n*25,206+n*23,205+n*25];
      else if(land<.02)c=[12+n*7,37+n*9,52+n*12];
      else{
        const dry=Math.max(0,.45-Math.abs(lat-22)/35);c=[42+land*75+dry*47+n*15,68+land*60+dry*20+n*12,48+land*40+n*9];
        if(this.layer==='political'){
          let near=w.regions[0],dist=Infinity;
          for(const r of w.regions){const d=((lon-r.lon+540)%360-180)**2*Math.cos(lat*Math.PI/180)**2+(lat-r.lat)**2;if(d<dist){dist=d;near=r;}}
          const co=colors.get(near.owner);if(co){c=co.map((v,i)=>v*.83+c[i]*.17);owners[y*tw+x]=socIndexes.get(near.owner)??0;}
        }else if(this.layer==='climate'){const t=Core.clamp((38-Math.abs(lat)*.65+w.climate.warming+6*land+10)/55,0,1);c=[50+185*t,110+50*(1-Math.abs(t-.5)*2),170-125*t];}
      }
      if(p.home&&this.layer==='nature'){const cloud=Math.sin(lon*.09+Math.sin(lat*.1)*3)+Math.cos(lat*.23-lon*.03)+Math.sin((lat+lon)*.17)*.5,alpha=Core.clamp((cloud-1.1)*.45,0,.68);c=c.map(v=>v*(1-alpha)+224*alpha);}
      const i=(y*tw+x)*4;data[i]=c[0];data[i+1]=c[1];data[i+2]=c[2];data[i+3]=255;
    }
    if(p.home&&this.layer==='political'){
      for(let y=1;y<th-1;y++)for(let x=0;x<tw;x++){const i=y*tw+x,owner=owners[i],right=owners[y*tw+(x+1)%tw],below=owners[i+tw];if(owner&&((right&&right!==owner)||(below&&below!==owner))){const p=i*4;data[p]=211;data[p+1]=220;data[p+2]=199;}}
    }
    this.texture={data,width:tw,height:th};
  }
  draw(){
    if(!this.world||!this.canvas.clientWidth||!this.ctx)return;
    const c=this.canvas,ctx=this.ctx,dpr=Math.min(window.devicePixelRatio||1,1.5),W=c.clientWidth,H=c.clientHeight;
    c.width=Math.round(W*dpr);c.height=Math.round(H*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#070d10';ctx.fillRect(0,0,W,H);this.hits=[];
    for(let i=0;i<110;i++){const x=Core.rand(this.world.seed,'sky',i,'x')*W,y=Core.rand(this.world.seed,'sky',i,'y')*H;ctx.fillStyle='rgba(184,202,209,'+(.1+Core.rand(this.world.seed,i,'brightness')*.5)+')';ctx.fillRect(x,y,i%9===0?1.5:.8,i%9===0?1.5:.8);}
    if(this.mode==='system')this.system(ctx,W,H);else this.globe(ctx,W,H);
  }
  project(region,cx,cy,R){const p=region.lat*Math.PI/180,l=region.lon*Math.PI/180-this.rotation;return {x:cx+Math.cos(p)*Math.sin(l)*R,y:cy-Math.sin(p)*R,z:Math.cos(p)*Math.cos(l)};}
  globe(ctx,W,H){
    this.makeTexture();
    const R=Math.min(W*.36,H*.39)*this.zoom,cx=W*.53,cy=H*.53,political=this.layer==='political'&&this.planet.home,regional=['settlements','routes'].includes(this.layer)&&this.planet.home;
    const glow=ctx.createRadialGradient(cx,cy,R*.92,cx,cy,R*1.09);glow.addColorStop(0,'#67afd600');glow.addColorStop(.5,'#4887ae66');glow.addColorStop(1,'#4887ae00');ctx.fillStyle=glow;ctx.beginPath();ctx.arc(cx,cy,R*1.1,0,Math.PI*2);ctx.fill();
    const sz=Math.min(660,Math.max(220,Math.ceil(R*2))),r=sz/2,off=document.createElement('canvas');off.width=sz;off.height=sz;const o=off.getContext('2d'),img=o.createImageData(sz,sz),a=img.data,t=this.texture;
    for(let y=0;y<sz;y++)for(let x=0;x<sz;x++){
      const nx=(x-r+.5)/r,ny=(r-y-.5)/r,d=nx*nx+ny*ny;if(d>1)continue;
      const z=Math.sqrt(1-d),lat=Math.asin(ny),lon=Math.atan2(nx,z)+this.rotation,tx=Math.floor(((lon/(Math.PI*2)+.5)%1+1)%1*t.width),ty=Math.min(t.height-1,Math.floor((.5-lat/Math.PI)*t.height)),si=(ty*t.width+tx)*4,di=(y*sz+x)*4;
      const sun=Math.max(0,nx*-.62+ny*.32+z*.67),shade=(political||regional)?.42+.58*sun:.065+.935*sun,limb=(1-z)**4;
      for(let k=0;k<3;k++)a[di+k]=t.data[si+k]*shade+[35,76,110][k]*limb*.4;a[di+3]=255;
    }
    o.putImageData(img,0,0);ctx.drawImage(off,cx-R,cy-R,R*2,R*2);
    if(!this.planet.home)return;
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
      if(selected&&political){ctx.strokeStyle='#f2efcd';ctx.lineWidth=1.2;ctx.beginPath();ctx.arc(point.x,point.y,rad+4,0,Math.PI*2);ctx.stroke();}
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
      if(selected){ctx.strokeStyle='#f3edc3';ctx.lineWidth=1.4;ctx.beginPath();ctx.arc(point.x,point.y,rad+5,0,Math.PI*2);ctx.stroke();}
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
    const cx=W*.5,cy=H*.56,max=Math.min(W*.43,H*.38)*this.zoom,ps=this.world.planets;ctx.save();ctx.strokeStyle='#43535a55';ctx.lineWidth=1;
    ps.forEach((p,i)=>{const r=35+(i+1)/ps.length*(max-35);ctx.beginPath();ctx.ellipse(cx,cy,r,r*.65,0,0,Math.PI*2);ctx.stroke();const a=p.phase+this.world.year/Math.max(1,p.period)*.25,x=cx+Math.cos(a)*r,y=cy+Math.sin(a)*r*.65,rad=p.kind==='gas'?8:p.home?7:4;ctx.fillStyle=p.home?'#72a9b7':p.kind==='ice'?'#b4ced4':p.kind==='gas'?'#cfa873':'#9c8a78';ctx.beginPath();ctx.arc(x,y,rad,0,Math.PI*2);ctx.fill();ctx.fillStyle='#c2ccc8';ctx.font='10px Segoe UI';ctx.fillText(p.name,x+rad+5,y+4);this.hits.push({id:p.id,type:'planet',x,y,r:rad});});
    const g=ctx.createRadialGradient(cx,cy,2,cx,cy,38);g.addColorStop(0,'#fff1be');g.addColorStop(.28,'#ffcb80');g.addColorStop(1,'#f3a95300');ctx.fillStyle=g;ctx.beginPath();ctx.arc(cx,cy,38,0,Math.PI*2);ctx.fill();ctx.fillStyle='#d6e2be';ctx.font='10px Consolas';ctx.fillText('Обзорный масштаб · орбиты схематичны',20,H-22);ctx.restore();
  }
}
