// Visual materials are evaluated on the unit sphere. Camera changes never alter the world.
const PlanetOptics = (() => {
  const tau=Math.PI*2, radians=Math.PI/180;
  const surfaces=new Map(), frames=new Map(), targets=new WeakMap();
  const frameBudget=12*1024*1024;
  let frameBytes=0,worker=null,workerFailed=false,activeJob=null,jobs=[],serial=0;

  // Self-contained pixel engine, shared by the immediate preview and the refinement worker.
  function opticsEngine(){
    const PI=Math.PI,TAU=PI*2,clamp=(n,a=0,b=1)=>Math.min(b,Math.max(a,n)),mix=(a,b,t)=>a+(b-a)*t;
    const prepared=new Map();
    function prepare(raw){
      if(prepared.has(raw.key))return prepared.get(raw.key);
      let seed=2166136261;
      for(const c of raw.materialSeed??raw.key)seed=Math.imul(seed^c.charCodeAt(0),16777619);
      let counter=seed>>>0;
      const random=()=>{counter=(counter+0x6D2B79F5)|0;let t=Math.imul(counter^(counter>>>15),1|counter);t=(t+Math.imul(t^(t>>>7),61|t))^t;return ((t^(t>>>14))>>>0)/4294967296;};
      const perm=new Uint8Array(512);
      for(let i=0;i<256;i++)perm[i]=i;
      for(let i=255;i>0;i--){const j=Math.floor(random()*(i+1));[perm[i],perm[j]]=[perm[j],perm[i]];}
      perm.set(perm.subarray(0,256),256);
      const phase=random()*TAU,base=raw.kind==='rock'?[[169,145,124],[160,157,149],[181,136,106],[163,153,130]][Math.floor(random()*4)]
        :raw.kind==='ice'?[[178,211,215],[185,207,225],[184,215,206]][Math.floor(random()*3)]
        :[[202,158,114],[188,163,128],[190,155,145],[144,177,177]][Math.floor(random()*4)];
      const craters=new Map(),microCraters=new Map(),storms=[],plates=[];
      if(raw.kind==='ice'){
        const rot=random()*TAU;
        for(let i=0;i<42;i++){
          const y=i%3?1-2*(i+.15+.7*random())/42:2*random()-1;
          const lon=rot+i*2.39996+.84*(random()-.5),c=Math.sqrt(1-y*y);
          plates.push([c*Math.cos(lon),y,c*Math.sin(lon),random()]);
        }
      }
      if(raw.kind==='rock'){
        for(let i=0;i<680;i++){
          const y=2*random()-1,lon=TAU*random(),c=Math.sqrt(1-y*y),x=c*Math.cos(lon),z=c*Math.sin(lon);
          const r=i<12?.15+.15*random():i<115?.038+.095*random():.006+.034*random();
          const point={x,y,z,r,age:random(),texture:random(),ex:-Math.sin(lon),ez:Math.cos(lon)},extent=r*1.43;
          const idx=n=>clamp(Math.floor((n+1)*6),0,11);
          for(let k=idx(z-extent);k<=idx(z+extent);k++)for(let j=idx(y-extent);j<=idx(y+extent);j++)for(let l=idx(x-extent);l<=idx(x+extent);l++){
            const cell=l+12*(j+12*k);let set=craters.get(cell);if(!set)craters.set(cell,set=[]);set.push(point);
          }
        }
      }
      function ensureMicro(){
        if(microCraters.size)return;
        for(let i=0;i<4800;i++){
          const y=2*random()-1,lon=TAU*random(),c=Math.sqrt(1-y*y),x=c*Math.cos(lon),z=c*Math.sin(lon);
          const r=.0015+.009*random()**2,extent=r*1.3,point=[x,y,z,r,.4+.6*random()];
          const idx=n=>clamp(Math.floor((n+1)*20),0,39);
          for(let k=idx(z-extent);k<=idx(z+extent);k++)for(let j=idx(y-extent);j<=idx(y+extent);j++)for(let a=idx(x-extent);a<=idx(x+extent);a++){
            const cell=a+40*(j+40*k);let set=microCraters.get(cell);if(!set)microCraters.set(cell,set=[]);set.push(point);
          }
        }
      }
      if(raw.kind==='gas'){
        for(let i=0;i<6;i++){
          const lon=phase+i*2.24+(random()-.5)*.3,lat=(i===0?-.28:i===1?.24:(random()-.5)*1.5),c=Math.cos(lat),s=Math.sin(lat);
          storms.push({x:c*Math.cos(lon),y:s,z:c*Math.sin(lon),ex:-Math.sin(lon),ez:Math.cos(lon),
            nx:-s*Math.cos(lon),ny:c,nz:-s*Math.sin(lon),w:i<3?.28+.12*random():.12+.11*random(),h:i<3?.11+.045*random():.05+.045*random(),sign:random()<.5?-1:1});
        }
      }
      const s={...raw,perm,phase,base,craters,microCraters,ensureMicro,storms,plates};
      if(prepared.size>=4)prepared.delete(prepared.keys().next().value);
      prepared.set(raw.key,s);return s;
    }
    function noise(s,x,y,z){
      const p=s.perm,ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z);
      let u=x-ix,v=y-iy,w=z-iz;u=u*u*(3-2*u);v=v*v*(3-2*v);w=w*w*(3-2*w);
      const i=ix&255,j=iy&255,k=iz&255,a=p[i]+j,b=p[i+1]+j;
      const c=p[a]+k,d=p[b]+k,e=p[a+1]+k,f=p[b+1]+k;
      return (mix(mix(mix(p[c],p[d],u),mix(p[e],p[f],u),v),mix(mix(p[c+1],p[d+1],u),mix(p[e+1],p[f+1],u),v),w)/255);
    }
    // This deterministic expression is Core.terrain with its seed-only phase hoisted once;
    // Core consumes degrees, while the camera already supplies spherical radians.
    function height(s,lon,lat){
      const q=s.terrainPhase;
      return Math.sin(lon*2+q+Math.sin(lat*3))*.46+Math.cos(lon*3-lat*2+q)*.25+
        Math.sin(lon*5+lat*4)*.13+Math.cos(lon*11-lat*8+q)*.07-Math.abs(lat*180/PI)/310;
    }
    function sampleBiome(s,lon,lat,c){
      const u=(lon/TAU+.5)*48,v=clamp(.5-lat/PI)*24,ix=Math.floor(u),iy=Math.min(23,Math.floor(v)),fx=u-ix,fy=v-iy;
      const x=(ix%48+48)%48,next=(x+1)%48,p=s.biomes;
      const a=(x+iy*48)*3,b=(next+iy*48)*3,d=a+144,e=b+144;
      for(let k=0;k<3;k++)c[k]=mix(mix(p[a+k],p[b+k],fx),mix(p[d+k],p[e+k],fx),fy);
    }
    function earth(s,x,y,z,lod,c){
      const lon=Math.atan2(z,x),lat=Math.asin(clamp(y,-1,1)),h=height(s,lon,lat);
      const land=h>=.02,f=18,warp=noise(s,x*5+13,y*5,z*5)-.5;
      const broad=noise(s,x*f+warp*3,y*f+18,z*f),rock=noise(s,x*49,y*49+warp*5,z*49-23);
      const fine=lod>0?noise(s,x*142+2,y*142,z*142)-.5:0;
      if(land){
        sampleBiome(s,lon,lat,c);
        const range=clamp((h-.10)*1.9),ridge=Math.abs(broad-.53),spine=clamp(1-ridge*8);
        const ridgelet=1-Math.abs(2*noise(s,x*74+warp*2,y*74+rock,z*74)-1);
        const alpine=clamp((h-.38)*1.7+.26*spine),snow=clamp((h-.69)*2.8+(Math.abs(lat)-1.13)*1.7)*clamp(.85+1.7*(rock-.5));
        const beach=clamp((.041-h)/.021)*.82,shade=(broad-.48)*22+(rock-.5)*(22+22*range)+fine*16+
          range*(spine*spine*12+(ridgelet-.68)*26);
        const b0=c[0],b1=c[1],b2=c[2];
        c[0]=mix(mix(mix(b0,153,alpine),222,snow),180,beach)+shade;
        c[1]=mix(mix(mix(b1,146,alpine),228,snow),166,beach)+shade;
        c[2]=mix(mix(mix(b2,133,alpine),223,snow),132,beach)+shade;
        c[3]=.04+snow*.15;c[4]=.13+(spine*.31+range*.18);
        if(lod>0){
          const q=s.terrainPhase,A=lon*2+q+Math.sin(lat*3),B=lon*3-lat*2+q,C=lon*5+lat*4,D=lon*11-lat*8+q;
          const east=(.92*Math.cos(A)-.75*Math.sin(B)+.65*Math.cos(C)-.77*Math.sin(D))*.095;
          const north=(1.38*Math.cos(A)*Math.cos(3*lat)+.5*Math.sin(B)+.52*Math.cos(C)+.56*Math.sin(D)-Math.sign(lat)*.185)*.10;
          const cs=Math.cos(lon),sn=Math.sin(lon);
          c[5]=-sn*east-cs*y*north;c[6]=Math.cos(lat)*north;c[7]=cs*east-sn*y*north;
        }
      }else{
        const shelf=Math.exp(-Math.max(0,.02-h)*17),swirl=broad*4+rock*2;
        c[0]=12+shelf*36+swirl;c[1]=43+shelf*87+swirl;c[2]=66+shelf*64+swirl;
        if(h>-.055){const surf=Math.exp(-Math.abs(.017-h)*415)*(.45+.55*rock);
          c[0]+=surf*74;c[1]+=surf*79;c[2]+=surf*64;}
        c[3]=.69;c[4]=.025;
      }
      // At the mathematical pole the model accepts many aliases of one longitude.
      // Fade only the optical material in that last fraction of a degree.
      const cap=clamp((Math.abs(lat)-(PI/2-.012))/.012);
      if(cap){c[0]=mix(c[0],202,cap);c[1]=mix(c[1],214,cap);c[2]=mix(c[2],213,cap);c[3]=mix(c[3],.11,cap);for(let i=4;i<8;i++)c[i]*=1-cap;}
    }
    function stone(s,x,y,z,lod,c){
      const cells=s.craters.get(clamp(Math.floor((x+1)*6),0,11)+12*(clamp(Math.floor((y+1)*6),0,11)+12*clamp(Math.floor((z+1)*6),0,11)));
      const large=noise(s,x*3.4+12,y*3.4,z*3.4),rubble=noise(s,x*23,y*23+9,z*23);
      const fine=lod>0?noise(s,x*126,y*126,z*126)-.5:0;
      const impactDust=noise(s,x*9+large,y*9+53,z*9),fracture=Math.abs(noise(s,x*35+large*3,y*35,z*35+17)-.48);
      let tone=(large-.49)*60+(rubble-.52)*27+fine*24+(impactDust-.5)*23-Math.exp(-fracture*63)*6,dx=0,dy=0,dz=0;
      if(cells)for(const crater of cells){
        const vx=x-crater.x,vy=y-crater.y,vz=z-crater.z,d2=vx*vx+vy*vy+vz*vz,rr=crater.r*crater.r;
        if(d2>rr*1.92)continue;
        const rawD=Math.sqrt(d2/rr),d=rawD*(.98+.06*(rubble-.35)+.025*fine);
        const rim=Math.exp(-((d-.91)**2)*152),inside=Math.max(0,1-d*d),age=.37+crater.age*.66;
        const tangentX=vx*crater.ex+vz*crater.ez,tangentY=(vy-crater.y*(vx*crater.x+vy*crater.y+vz*crater.z));
        const angle=Math.atan2(tangentY,tangentX),rays=Math.abs(Math.sin(angle*9+crater.texture*4+2*rubble))**13;
        const apron=clamp(1-Math.abs(d-1.1)*3.5);
        tone+=age*(rim*20-inside*(17+crater.texture*13)+apron*((rubble-.35)*21+rays*24));
        if(d<.24&&crater.r>.13)tone+=(.24-d)*(61+fine*42);
        if(crater.r>.095)tone+=Math.exp(-((d-.70)**2)*350)*6;
        // Derivative of the bowl and rim, in the tangent space of the crater.
        const radial=(inside*1.20*d-3.4*(d-.91)*rim*10)*age/Math.max(.008,d*crater.r);
        dx+=vx*radial;dy+=vy*radial;dz+=vz*radial;
      }
      if(lod===2){
        const small=s.microCraters.get(clamp(Math.floor((x+1)*20),0,39)+40*(clamp(Math.floor((y+1)*20),0,39)+40*clamp(Math.floor((z+1)*20),0,39)));
        if(small)for(const crater of small){
          const vx=x-crater[0],vy=y-crater[1],vz=z-crater[2],r=crater[3],d=Math.sqrt(vx*vx+vy*vy+vz*vz)/r;
          if(d>=1.28)continue;
          const rim=Math.exp(-((d-.88)**2)*72),bowl=Math.max(0,1-d*d),strength=crater[4];
          tone+=(rim*29-bowl*25)*strength;
          const slope=(bowl*d-(d-.88)*rim*13)*strength/Math.max(.0007,d*r);
          dx+=vx*slope;dy+=vy*slope;dz+=vz*slope;
        }
      }
      c[0]=s.base[0]+tone;c[1]=s.base[1]+tone+(large-.5)*5;c[2]=s.base[2]+tone;
      c[3]=.035;c[4]=.30;c[5]=dx;c[6]=dy;c[7]=dz;
    }
    function ice(s,x,y,z,lod,c){
      const warp=noise(s,x*4.8+2,y*4.8,z*4.8)-.5,grain=noise(s,x*34,y*34+9,z*34);
      const xx=x+.145*warp,yy=y+.084*(noise(s,x*7,y*7+15,z*7)-.5),zz=z+.041*(grain-.5);
      let best=-2,next=-2,p=s.plates[0],q=p;
      for(const cell of s.plates){const d=xx*cell[0]+yy*cell[1]+zz*cell[2];
        if(d>best){next=best;q=p;best=d;p=cell;}else if(d>next){next=d;q=cell;}}
      const a=p[0]-q[0],b=p[1]-q[1],e=p[2]-q[2],norm=Math.hypot(a,b,e)||1;
      const width=(best-next)/norm,age=.38+.62*Math.abs(p[3]-q[3]);
      const open=Math.exp(-width*290)*age,rift=Math.exp(-width*56)*age,rim=Math.exp(-((width-.018)**2)*9900)*age;
      const secondary=noise(s,x*13+warp*2,y*12,z*16+11)-.49;
      const oldFault=x*.83-y*.39+z*.43+.102*warp;
      const faults=Math.sin(oldFault*13.7+s.phase+grain*.20),stain=Math.exp(-Math.abs(faults)*17)*clamp(.4+1.2*p[3]);
      const groove=Math.exp(-Math.abs(faults-.064)*47),lines=Math.exp(-Math.abs(secondary)*95)*clamp(.85-width);
      const streak=Math.sin((x*.23+y*.66+z*.71)*169+warp*6+grain*1.2);
      const frost=(noise(s,x*10,y*10+15,z*10)-.47)*25+(grain-.49)*14+(lod>0?(noise(s,x*179,y*179,z*179)-.5)*19:0);
      const lift=11*(p[3]-.45);
      c[0]=s.base[0]+frost+lift-open*68-rift*39-lines*32+rim*14-stain*17+groove*8;
      c[1]=s.base[1]+frost+lift-open*65-rift*26-lines*26+rim*12-stain*37+groove*8;
      c[2]=s.base[2]+frost+lift-open*45-rift*12-lines*18+rim*9+streak*(2+rim*7)-stain*47+groove*7;
      c[3]=.30+rim*.12;c[4]=.16+rim*.14;
      const slope=(open*.56-rim*.12)/norm;c[5]=a*slope;c[6]=b*slope;c[7]=e*slope;
    }
    function gas(s,x,y,z,lod,c){
      const warp=noise(s,x*6+2,y*10,z*6)-.5,eddy=noise(s,x*17,y*28+warp*4,z*17)-.5;
      let bend=0,whorl=0,eye=0;
      for(const v of s.storms){
        if(x*v.x+y*v.y+z*v.z<.76)continue;
        const u=(x*v.ex+z*v.ez)/v.w,t=(x*v.nx+y*v.ny+z*v.nz)/v.h;const rr=u*u+t*t;
        if(rr>6)continue;
        const r=Math.sqrt(rr),theta=v.sign*2.8*Math.exp(-rr*.76),wave=Math.sin(theta)*u+Math.cos(theta)*t;
        bend+=(wave-t)*v.h*Math.exp(-rr*.31);
        const mask=Math.exp(-rr*1.7),spiral=Math.sin(24*r-v.sign*Math.atan2(t,u)*2+eddy*4);
        whorl+=mask*spiral*21+Math.exp(-((r-.96)**2)*32)*18;eye+=mask;
      }
      const stripe=y+.095*warp+.030*eddy+bend;
      const belt=Math.sin(stripe*27+s.phase+.48*Math.sin(stripe*12)),band=(belt+1)*.5;
      const strand=Math.sin(stripe*112+s.phase+warp*6+eddy*3),thin=Math.sin(stripe*236+eddy*5+warp*8);
      const marble=noise(s,x*41+eddy*3,y*62+warp*8,z*40)-.5;
      const fine=lod>0?(noise(s,x*138,y*174+warp*8,z*140)-.5)*14:0;
      const light=clamp((band-.22)*1.65),filament=strand*8+thin*3+Math.exp(-Math.abs(strand)*7)*6+marble*22+fine+whorl;
      c[0]=s.base[0]+(light-.45)*56-(1-light)*16+filament+eye*8;
      c[1]=s.base[1]+(light-.45)*65-(1-light)*27+filament-eye*9;
      c[2]=s.base[2]+(light-.45)*70-(1-light)*36+filament-eye*15;
      c[3]=.045;c[4]=.048;
    }

    function render(input){
      const {width,height:rows,view,moving,raw}=input,s=prepare(raw),out=new Uint8ClampedArray(width*rows*4);
      const c=new Float64Array(8),fwd=view.forward,east=view.east,north=view.north,L=view.light;
      const lx=L[0],ly=L[1],lz=L[2];
      const sunX=east[0]*lx+north[0]*ly+fwd[0]*lz,sunY=east[1]*lx+north[1]*ly+fwd[1]*lz,sunZ=east[2]*lx+north[2]*ly+fwd[2]*lz;
      const dxEast=.006*sunX,dyEast=.006*sunY,dzEast=.006*sunZ;
      const surface=view.mode==='surface',lod=moving?0:(surface?2:1);
      if(lod===2&&raw.kind==='rock')s.ensureMicro();
      for(let j=0;j<rows;j++){
        const v=(view.cy-(input.top+(j+.5)*input.spanY/rows))/view.radius;
        for(let i=0;i<width;i++){
          let nx=(input.left+(i+.5)*input.spanX/width-view.cx)/view.radius,ny=v,nz;
          const r2=nx*nx+ny*ny,limit=1+2/Math.max(40,width);
          if(!surface&&r2>limit)continue;
          let coverage=1;
          if(surface){const inv=1/Math.sqrt(1+r2);nx*=inv;ny*=inv;nz=inv;}
          else {coverage=clamp((1-Math.sqrt(r2))*view.radius*width/input.spanX+.5);nz=Math.sqrt(Math.max(0,1-r2));}
          const x=east[0]*nx+north[0]*ny+fwd[0]*nz,y=east[1]*nx+north[1]*ny+fwd[1]*nz,z=east[2]*nx+north[2]*ny+fwd[2]*nz;
          c[5]=c[6]=c[7]=0;
          if(raw.home)earth(s,x,y,z,lod,c);else if(raw.kind==='rock')stone(s,x,y,z,lod,c);else if(raw.kind==='ice')ice(s,x,y,z,lod,c);else gas(s,x,y,z,lod,c);
          let diffuse=nx*lx+ny*ly+nz*lz;
          const macro=diffuse;
          if(c[4]>.02&&!moving){
            // Project the light tangent to the sphere; use the same star for material relief and the disc.
            const tx=dxEast-.006*macro*x,ty=dyEast-.006*macro*y,tz=dzEast-.006*macro*z;
            const a=noise(s,29*x,29*y,29*z),b=noise(s,29*(x+tx),29*(y+ty),29*(z+tz));
            diffuse+=(a-b)*c[4]*1.85;
          }
          diffuse-=((sunX-macro*x)*c[5]+(sunY-macro*y)*c[6]+(sunZ-macro*z)*c[7])*.67;
          if(surface&&!moving){
            // Fixed wavelengths: approaching reveals existing grains, without sliding
            // or re-seeding the material under the centre of the camera.
            const micro=noise(s,x*205,y*205+13,z*205)-.5;
            const detail=clamp(Math.log2(1+view.zoom)-.45),fine=detail*(noise(s,x*491+23,y*491,z*491)-.5);
            const tiny=view.zoom>2?clamp(Math.log2(view.zoom)-1)*(noise(s,x*1391,y*1391+4,z*1391)-.5):0;
            const extra=(micro*12+fine*15+tiny*9)*(raw.kind==='gas'?.5:1);
            c[0]+=extra;c[1]+=extra;c[2]+=extra;
          }
          const sun=clamp(macro*10+.5),intensity=.105+sun*(.13+.77*Math.max(0,diffuse)**.83);
          const spec=Math.max(0,2*macro*nz-lz),spark=Math.pow(spec,raw.home?48:23)*c[3]*102*sun;
          const haze=surface?0:(1-nz)**3*clamp(.58+.65*macro)*(raw.home?72:raw.kind==='gas'?43:raw.kind==='ice'?17:4);
          const off=(j*width+i)*4;
          out[off]=c[0]*intensity+spark+haze*.36;out[off+1]=c[1]*intensity+spark*.94+haze*.74;out[off+2]=c[2]*intensity+spark*.84+haze;
          out[off+3]=Math.round(coverage*255);
        }
      }
      return out;
    }
    return {render,height,prepare};
  }

  const engine=opticsEngine();
  const biomes={forest:[52,92,65],grassland:[125,143,78],drylands:[184,151,103],highlands:[132,132,114],tundra:[149,167,151]};
  function modelSurface(world,body){
    const areas=body.home?world.regions??[]:[];
    const geo=areas.map(r=>[r.id,r.lon,r.lat,r.biome].join(',')).join(';');
    const key=JSON.stringify([world.seed,body.id,body.kind,!!body.home,geo]);
    if(surfaces.has(key))return surfaces.get(key);
    let map=null;
    if(body.home){
      const samples=areas.map(r=>{
        const a=r.lon*radians,b=r.lat*radians;return [Math.cos(a)*Math.cos(b),Math.sin(b),Math.sin(a)*Math.cos(b),biomes[r.biome]??biomes.grassland];});
      map=new Uint8Array(48*25*3);
      for(let j=0;j<=24;j++)for(let i=0;i<48;i++){
        const a=(i/48-.5)*tau,b=(.5-j/24)*Math.PI,x=Math.cos(a)*Math.cos(b),y=Math.sin(b),z=Math.sin(a)*Math.cos(b);
        let r=0,g=0,blue=0,sum=0;
        for(const p of samples){const d=Math.max(0,2-2*(x*p[0]+y*p[1]+z*p[2])),inv=1/(d+.035),w=inv*inv*inv;
          sum+=w;r+=p[3][0]*w;g+=p[3][1]*w;blue+=p[3][2]*w;}
        const off=(j*48+i)*3;map[off]=sum?r/sum:115;map[off+1]=sum?g/sum:133;map[off+2]=sum?blue/sum:88;
      }
    }
    const raw={key,materialSeed:JSON.stringify([world.seed,body.id,'optical-material']),home:!!body.home,kind:body.kind,biomes:map,terrainPhase:body.home?Core.rand(world.seed,'terrain')*6.28:0};
    if(surfaces.size>=4)surfaces.delete(surfaces.keys().next().value);surfaces.set(key,raw);return raw;
  }
  function makeView(w,h,o){
    const lon=Number.isFinite(o.lon)?o.lon:0,lat=Math.max(-Math.PI/2,Math.min(Math.PI/2,Number.isFinite(o.lat)?o.lat:0));
    const zoom=Math.max(.2,Math.min(64,Number.isFinite(o.zoom)?o.zoom:1)),mode=o.mode==='surface'?'surface':'globe';
    const radius=mode==='surface'?Math.min(w,h)*1.30*zoom : (o.fit==='disc'?Math.min(w,h)*.48:Math.min(w*.43,h*.44))*zoom;
    const x=Math.cos(lon),z=Math.sin(lon),y=Math.sin(lat),c=Math.cos(lat);
    let light=o.light;const norm=light&&Math.hypot(light[0],light[1],light[2]);
    light=norm>0&&Number.isFinite(norm)?[light[0]/norm,light[1]/norm,light[2]/norm]:[-.45,.30,Math.sqrt(1-.45**2-.30**2)];
    return {mode,zoom,lon,lat,cx:w/2,cy:h/2,radius,light,forward:[c*x,y,c*z],east:[-z,0,x],north:[-y*x,c,-y*z]};
  }
  function getWorker(){
    if(worker||workerFailed||typeof Worker!=='function')return worker;
    let url;
    try{
      const code='const engine=('+opticsEngine.toString()+')();self.onmessage=({data})=>{try{const pixels=engine.render(data.input);self.postMessage({id:data.id,pixels},[pixels.buffer]);}catch{self.postMessage({id:data.id,failed:true});}};';
      url=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));worker=new Worker(url);
      worker.onmessage=({data})=>{const job=activeJob;activeJob=null;if(job&&job.id===data.id){if(data.pixels)finish(job,data.pixels);else fail(job);}pump();};
      worker.onerror=()=>{worker.terminate();worker=null;workerFailed=true;const all=[activeJob,...jobs];activeJob=null;jobs=[];for(const job of all)if(job)fail(job);};
    }catch{workerFailed=true;}finally{if(url)URL.revokeObjectURL(url);}
    return worker;
  }
  function pump(){
    if(activeJob||!worker)return;
    while(jobs.length){const job=jobs.shift();if(current(job)){activeJob=job;try{worker.postMessage({id:job.id,input:job.input});}
      catch{activeJob=null;fail(job);continue;}break;}}
  }
  function current(job){return targets.get(job.canvas)?.serial===job.id&&(!job.isCurrent||job.isCurrent());}
  function cancel(canvas){targets.delete(canvas);jobs=jobs.filter(job=>job.canvas!==canvas);}
  function fail(job){
    if(!current(job))return;
    // A blocked worker still gets an actual, bounded surface refinement.
    const i=job.input,k=Math.min(1,300/Math.max(i.width,i.height));
    job.input={...i,width:Math.max(1,Math.round(i.width*k)),height:Math.max(1,Math.round(i.height*k))};
    finish(job,engine.render(job.input));
  }
  function createBuffer(canvas,width,height){
    if(typeof OffscreenCanvas==='function')return new OffscreenCanvas(width,height);
    const b=canvas.ownerDocument.createElement('canvas');b.width=width;b.height=height;return b;
  }
  function bufferPixels(canvas,input,pixels){
    const b=createBuffer(canvas,input.width,input.height),ctx=b.getContext('2d'),image=ctx.createImageData(input.width,input.height);
    image.data.set(pixels);ctx.putImageData(image,0,0);return b;
  }
  function blit(c,buffer,input,target){
    const ctx=c.getContext('2d');if(!ctx)return;
    if(c.width!==target.pixelWidth)c.width=target.pixelWidth;if(c.height!==target.pixelHeight)c.height=target.pixelHeight;
    ctx.save();ctx.setTransform(c.width/target.width,0,0,c.height/target.height,0,0);
    ctx.clearRect(0,0,target.width,target.height);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    ctx.drawImage(buffer,input.left,input.top,input.spanX,input.spanY);ctx.restore();
  }
  function finish(job,pixels){
    if(!current(job))return;
    const {canvas,input,target,key}=job,b=bufferPixels(canvas,input,pixels);
    if(!frames.has(key)){
      const bytes=b.width*b.height*4;
      while(frames.size&&(frameBytes+bytes>frameBudget||frames.size>=20)){const first=frames.keys().next().value,old=frames.get(first);frameBytes-=old.width*old.height*4;frames.delete(first);}
      if(bytes<=frameBudget){frames.set(key,b);frameBytes+=bytes;}
    }
    const state=targets.get(canvas);state.buffer=b;
    blit(canvas,b,input,target);job.notify?.();
  }
  function draw(canvas,world,body,o={}){
    if(!canvas||!world||!body)return null;
    const w=Math.round(o.width||canvas.clientWidth||canvas.width),h=Math.round(o.height||canvas.clientHeight||canvas.height);
    if(w<1||h<1)return null;
    const dpr=Math.min(2,Math.max(.5,o.dpr||((canvas.clientWidth||canvas.clientHeight)?globalThis.devicePixelRatio||1:1)),Math.sqrt(2200000/(w*h)));
    const target={width:w,height:h,pixelWidth:Math.max(1,Math.round(w*dpr)),pixelHeight:Math.max(1,Math.round(h*dpr))};
    const view=makeView(w,h,o),raw=modelSurface(world,body),r=view.radius;
    const surface=view.mode==='surface',left=surface?0:Math.max(0,Math.floor(view.cx-r-1)),top=surface?0:Math.max(0,Math.floor(view.cy-r-1));
    const spanX=surface?w:Math.min(w,Math.ceil(view.cx+r+1))-left,spanY=surface?h:Math.min(h,Math.ceil(view.cy+r+1))-top;
    const moving=!!o.moving,portrait=Math.max(spanX,spanY)<=138;
    const scale=Math.min(dpr,(moving?155:portrait?240:surface?920:780)/Math.max(spanX,spanY));
    const input={raw,view,moving,left,top,spanX,spanY,width:Math.max(1,Math.round(spanX*scale)),height:Math.max(1,Math.round(spanY*scale))};
    const key=JSON.stringify([raw.key,w,h,dpr,view.mode,view.lon,view.lat,view.zoom,view.radius,view.light,moving]);
    const bounds={cx:view.cx,cy:view.cy,radius:r,width:w,height:h};
    const previous=targets.get(canvas);
    if(previous?.key===key&&previous.buffer){blit(canvas,previous.buffer,input,target);return bounds;}
    const id=++serial;targets.set(canvas,{serial:id,key});
    const hit=frames.get(key);
    if(hit){frames.delete(key);frames.set(key,hit);targets.get(canvas).buffer=hit;blit(canvas,hit,input,target);return bounds;}
    const job={id,canvas,input,target,key,notify:typeof o.onDetail==='function'?o.onDetail:null,isCurrent:typeof o.isCurrent==='function'?o.isCurrent:null};
    if(moving||portrait){const fallback=engine.render(input);if(portrait&&!moving){job.notify=null;finish(job,fallback);}else{const b=bufferPixels(canvas,input,fallback);targets.get(canvas).buffer=b;blit(canvas,b,input,target);}return bounds;}
    const ratio=Math.min(1,138/Math.max(input.width,input.height)),preview={...input,moving:true,
      width:Math.max(1,Math.round(input.width*ratio)),height:Math.max(1,Math.round(input.height*ratio))};
    const initial=bufferPixels(canvas,preview,engine.render(preview));targets.get(canvas).buffer=initial;
    blit(canvas,initial,preview,target);
    if(o.sync===true){job.notify=null;finish(job,engine.render(input));return bounds;}
    if(!getWorker()){fail(job);return bounds;}
    jobs=jobs.filter(old=>old.canvas!==canvas&&current(old));
    if(jobs.length>=4){const skipped=jobs.shift();if(current(skipped))targets.delete(skipped.canvas);}
    jobs.push(job);pump();return bounds;
  }
  return {draw,cancel};
})();
