// The view reconstructs an oblique landscape from one dated regional snapshot.
const PlaceLandscape = (() => {
  const views = new WeakMap();
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const mix = (a, b, t) => a + (b - a) * t;
  const rgb = (r, g, b) => 'rgb(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ')';

  function hash(text) {
    let value = 2166136261;
    for (const c of text) value = Math.imul(value ^ c.charCodeAt(0), 16777619);
    return value >>> 0;
  }
  function grain(seed, a, b = 0) {
    let n = seed ^ Math.imul(a, 374761393) ^ Math.imul(b, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  function noise(seed, x, z) {
    const a = Math.floor(x), b = Math.floor(z);
    let u = x-a, v = z-b;
    u = u*u*(3-2*u); v = v*v*(3-2*v);
    return mix(mix(grain(seed,a,b),grain(seed,a+1,b),u),
      mix(grain(seed,a,b+1),grain(seed,a+1,b+1),u),v);
  }
  function snapshot(world, region, record) {
    const year = record?.year ?? world.year;
    const basin = record?.basin;
    const inside = basin && [basin.upper, basin.lower, basin.alternate].includes(region.id);
    const p = inside && region.id === basin.upper ? record?.project : null;
    const started = p && p.site === region.id && p.started <= year;
    const demolished = started && p.dismantled?.year <= year;
    const completed = started && p.completed != null && p.completed <= year;
    const settlement = region.settlement;
    return {
      seed:hash(world.seed+'|'+region.id), biome:region.biome, water:clamp(region.water??.5),
      elevation:clamp(region.elevation??.2), cover:clamp(region.biomass??.5), coastal:!!region.coastal,
      basin:!!inside, diverted:!!inside && !!basin.diverted,
      activeChannel:!!inside && (region.id===basin.upper || region.id===(basin.diverted?basin.alternate:basin.lower)),
      oldChannel:!!inside && basin.diverted && region.id===basin.lower,
      upperSite:!!inside && region.id===basin.upper,
      flow:inside?clamp(basin.flow):0, silt:inside?clamp(basin.silt):0,
      people:settlement && settlement.founded<=year?Math.max(0,region.population??0):0,
      kind:settlement?.kind, specialty:settlement?.specialization, infra:clamp(settlement?.infrastructure??0),
      port:!!region.coastal && (region.economy?.port??0)>0,
      drought:!!region.disasterEventId && region.disasterUntil>=year,
      project:started ? {completed,demolished,paused:p.status==='paused',passage:p.purpose==='passage',
        progress:completed?1:clamp(p.labor/Math.max(1,p.required))} : null
    };
  }

  // A seaward view has a single landmass. Distance runs from the horizon (0)
  // towards the observer (1); positive cross-shore coordinates are on land.
  function coast(g,s,w,h) {
    const rnd=(i,k)=>grain(s.seed,i,k),phase=rnd(27,3)*6.28,seaY=.285;
    const arid=s.drought||s.biome==='drylands',cold=s.biome==='tundra';
    const blueHour=s.biome==='forest'||cold,px=Math.min(w/760,h/360);
    const pt=(x,y)=>({x,y});
    function polygon(points,fill) {
      g.fillStyle=fill;g.beginPath();g.moveTo(points[0].x,points[0].y);
      for(let i=1;i<points.length;i++)g.lineTo(points[i].x,points[i].y);
      g.closePath();g.fill();
    }
    function stroke(points,color,weight) {
      g.strokeStyle=color;g.lineWidth=weight;g.beginPath();g.moveTo(points[0].x,points[0].y);
      for(let i=1;i<points.length;i++)g.lineTo(points[i].x,points[i].y);
      g.stroke();
    }
    const horizonX=.80+.06*rnd(31,2);
    function shore(d) {
      return horizonX-.83*d+Math.sin(Math.PI*d)*(.070*Math.sin(5*d+phase)+.022*Math.sin(18*d+phase));
    }
    function at(u,d,alt=0) {
      const scale=.10+.90*d;
      return pt(w*(shore(d)+u*scale*.85),h*(seaY+.80*d-alt*scale*.82));
    }
    function land(u,d) {
      const rise=1-Math.exp(-Math.max(0,u)*2.2);
      return rise*(.045+s.elevation*.26+.065*noise(s.seed,u*4,d*9));
    }
    const ground=(u,d)=>at(u,d,land(u,d));
    const sky=g.createLinearGradient(0,0,w*.035,h*seaY);
    sky.addColorStop(0,'#14293e');sky.addColorStop(.37,'#446679');
    sky.addColorStop(.73,blueHour?'#8da8b2':'#b7a59b');sky.addColorStop(1,blueHour?'#adc0bd':'#ead1ae');
    g.fillStyle=sky;g.fillRect(0,0,w,h*seaY+2);
    const sunX=w*(.23+.11*rnd(18,31)),sunY=h*(seaY-.04);
    const aureole=g.createRadialGradient(sunX,sunY,0,sunX,sunY,w*.27);
    aureole.addColorStop(0,'rgba(255,218,151,.70)');aureole.addColorStop(.16,'rgba(255,199,141,.32)');aureole.addColorStop(1,'rgba(243,183,145,0)');
    g.fillStyle=aureole;g.fillRect(0,0,w,h*seaY);
    for(let i=0;i<30;i++){
      const x=rnd(i,5)*w,y=rnd(i,6)*h*seaY,length=(.018+.16*rnd(i,7))*w;
      polygon([pt(x-length*.5,y),pt(x-length*.18,y-h*.004),pt(x+length*.13,y-h*.005),pt(x+length*.5,y),pt(x,y+h*.003)],
        i%4?'rgba(87,99,117,.22)':'rgba(238,202,167,.30)');
    }
    const sea=g.createLinearGradient(0,h*seaY,w*.09,h);
    sea.addColorStop(0,'#94aab0');sea.addColorStop(.06,'#698995');sea.addColorStop(.23,'#476d7d');
    sea.addColorStop(.60,'#2c5667');sea.addColorStop(1,'#133c4b');
    g.fillStyle=sea;g.fillRect(0,h*seaY,w,h*(1-seaY)+1);
    stroke([pt(0,h*seaY),pt(w,h*seaY)],'rgba(201,211,202,.73)',Math.max(.55,.8*px));
    // Wave crests widen near the observer. The highlights follow the same light as the sky.
    for(let i=0;i<2300;i++){
      const d=rnd(i,11)**1.55,x=rnd(i,12)*w,y=h*(seaY+d*(1-seaY));
      const gleam=Math.max(0,1-Math.abs(x-sunX)/(w*(.04+.23*d)));
      const width=(.6+(1+12*d)*rnd(i,14))*px;
      const a=.07+.27*rnd(i,15)+.24*gleam;
      stroke([pt(x-width,y),pt(x,y-.36*d*px),pt(x+.66*width,y)],
        gleam>.35?'rgba(239,207,162,'+a+')':'rgba(156,192,196,'+a+')',Math.max(.45,px*(.4+d*.6)));
    }
    // Distant low headland leaves the open sea horizon visible.
    const headland=[pt(w*.52,h*seaY)];
    for(let i=0;i<=80;i++){
      const u=i/80,x=w*(.52+.48*u),rise=(.009+.023*u+s.elevation*.035)*Math.sin(u*Math.PI*.7);
      headland.push(pt(x,h*(seaY-rise*(.47+.65*noise(s.seed+11,u*6,8)))));
    }
    polygon([...headland,pt(w,h*(seaY+.012))],'#718686');
    const landline=[];
    for(let i=0;i<=140;i++)landline.push(at(0,i/140*1.10));
    const landGradient=g.createLinearGradient(0,h*.29,w*.1,h);
    if(arid){landGradient.addColorStop(0,'#8f977a');landGradient.addColorStop(.38,'#9b9168');landGradient.addColorStop(1,'#675e47');}
    else {landGradient.addColorStop(0,cold?'#99ada7':'#849882');landGradient.addColorStop(.35,cold?'#94a6a1':'#779074');landGradient.addColorStop(1,cold?'#5a7173':'#405d4f');}
    polygon([...landline,pt(w*1.5,h*1.18),pt(w*1.5,h*.255)],landGradient);
    // Broad interleaved swathes are low coastal grass and soil, never a second mountain range.
    for(let i=0;i<45;i++){
      const d=.12+.94*rnd(i,421),u=.13+rnd(i,422)*1.7,reach=.07+.37*rnd(i,423);
      const swath=[ground(u,d),ground(u+reach*.40,d-.014),ground(u+reach,d-.019),
        ground(u+reach*.61,d-.004),ground(u+.03,d+.014)];
      polygon(swath,arid?i%3?'rgba(200,175,120,.12)':'rgba(84,83,64,.13)':
        i%3?'rgba(171,181,131,.14)':'rgba(70,101,77,.18)');
    }
    // Tidal rocks, a narrow shingle apron and a bright irregular line of surf.
    const high=[],edge=[],wash=[];
    for(let i=0;i<=150;i++){
      const d=i/150*1.10,rough=noise(s.seed+32,d*78,1);
      high.push(at(.035+.032*rough,d,.005));
      edge.push(at(-.008-.016*rough,d));
      wash.push(at(-.029-.021*rough,d));
    }
    polygon([...edge,...high.slice().reverse()],arid?'#b0a183':'#a4a590');
    polygon([...wash,...edge.slice().reverse()],'#849b97');
    stroke(edge,'rgba(227,232,211,.84)',Math.max(.7,1.4*px));
    for(let i=0;i<280;i++){
      const d=.03+rnd(i,25)*.99,u=-.04+rnd(i,26)*.10,p=at(u,d),sz=(.35+2.7*d*rnd(i,27))*px;
      polygon([pt(p.x-sz,p.y),pt(p.x-.2*sz,p.y-.43*sz),pt(p.x+.65*sz,p.y-.25*sz),pt(p.x+sz,p.y+.18*sz)],i%3?'#84918a':'#637c7d');
    }
    for(let i=0;i<1250;i++){
      const d=rnd(i,232)*1.08,u=.08+2.6*rnd(i,233),p=ground(u,d);
      if(p.x>w+5||p.y>h+4)continue;
      const n=(.35+3.5*d*rnd(i,234))*px;
      stroke([pt(p.x-n*.6,p.y+.2*n),p,pt(p.x+n*.8,p.y-.27*n)],arid?'rgba(198,187,135,.49)':'rgba(176,190,148,.42)',Math.max(.45,.67*px));
    }
    const zDock=.61,zMine=.43;
    if(s.people>0){
      const points=[];
      for(let i=0;i<=64;i++){
        const d=.09+i/64*.99,u=.30+.12*Math.sin(d*6+phase*.3);
        points.push(ground(u,d));
      }
      stroke(points,'#5a655d',Math.max(1.8,4.3*px));
      stroke(points,arid?'#b6a582':'#aba98e',Math.max(.8,2.5*px));
      for(const [u,d] of [[.75,.3],[.65,.50],[.55,.71],[.88,.86],...(s.specialty==='mining'?[[.70,zMine]]:[])]){
        const junction=ground(.30+.12*Math.sin(d*6+phase*.3),d);
        const sideRoad=[junction,ground(u*.73,d+.019),ground(u,d)];
        stroke(sideRoad,'rgba(91,92,74,.76)',Math.max(.9,1.7*px*(.35+d)));
        stroke(sideRoad,'rgba(176,163,131,.79)',Math.max(.48,.75*px*(.35+d)));
      }
    }
    if(s.specialty==='mining'&&s.people>0){
      // Benches of the working landscape, reconstructed from the recorded specialization.
      for(let bench=0;bench<5;bench++){
        const outline=[],radius=1-bench*.13;
        for(let i=0;i<37;i++){
          const a=i/36*Math.PI*2,shape=1+.073*Math.sin(3*a+phase)+.045*Math.sin(5*a);
          outline.push(ground(.66+Math.cos(a)*.22*radius*shape,zMine+Math.sin(a)*.053*radius*shape+bench*.002));
        }
        polygon(outline,['#a69d83','#817b6d','#aaa38f','#797b72','#8b8678'][bench]);
        stroke(outline.slice(0,18),'#b5ac94',Math.max(.6,1.1*px));
      }
    }
    function house(u,d,id,warehouse=false) {
      const origin=ground(u,d),k=px*(.24+d*1.36),width=(warehouse?39:9+rnd(id,76)*7)*k;
      const depth=width*(warehouse?.37:.47),wall=(warehouse?11:6+rnd(id,78)*6)*k,roof=(warehouse?7:3.6+rnd(id,79)*3)*k;
      const x=origin.x,y=origin.y, a=pt(x-width*.5,y),b=pt(x+width*.5,y+width*.10),
        c=pt(x+width*.5+depth*.73,y-depth*.38+width*.10),d0=pt(x-width*.5+depth*.73,y-depth*.38);
      const lift=(p,n)=>pt(p.x,p.y-n),left=lift(a,wall),right=lift(b,wall),back=lift(c,wall),end=lift(d0,wall);
      const ridge=pt((left.x+right.x)/2,(left.y+right.y)/2-roof),rear=pt((end.x+back.x)/2,(end.y+back.y)/2-roof);
      polygon([a,b,c,pt(c.x+wall*.95,c.y+wall*.26),pt(b.x+wall*.95,b.y+wall*.26)],'rgba(34,47,47,.32)');
      polygon([a,b,right,ridge,left],warehouse?'#778486':id%3?'#a69b82':'#b3a78c');
      polygon([b,c,back,right],warehouse?'#485b63':'#6d736b');
      polygon([left,ridge,rear,end],id%4?'#9a7360':'#77888a');
      polygon([ridge,rear,back,right],warehouse?'#546671':id%3?'#73685d':'#66797b');
      stroke([end,rear,ridge,left],id%4?'#c4a082':'#aab4aa',Math.max(.55,.72*k));
      const count=warehouse?7:3;
      for(let j=0;j<count;j++){
        const t=(j+1)/(count+1),wx=mix(a.x,b.x,t),wy=mix(a.y,b.y,t)-wall*.80;
        g.fillStyle='#384e52';g.fillRect(wx-k*.4,wy-k*.4,Math.max(.8,width*.054+k*.7),Math.max(.8,wall*.30+k*.65));
        g.fillStyle=(j+id)%3?'#ffd58d':'#c5b68e';g.fillRect(wx,wy,Math.max(.65,width*.051),Math.max(.75,wall*.25));
      }
      if(!warehouse){
        const chimney=pt(rear.x-depth*.25,rear.y+roof*.25);
        g.fillStyle='#555e5b';g.fillRect(chimney.x,chimney.y-2.8*k,1.65*k,3.75*k);
        stroke([pt(chimney.x-.3*k,chimney.y-2.8*k),pt(chimney.x+1.7*k,chimney.y-2.8*k)],'#b8a994',.75*k);
      }else{
        g.fillStyle='#435354';g.fillRect(x-width*.12,y-wall*.52,width*.22,wall*.55);
      }
    }
    function dock() {
      const start=ground(.075,zDock),end=at(-.37,zDock+.045,.024);
      const k=Math.max(.65,px);
      const quayA=at(-.025,zDock-.105,.022),quayB=at(-.025,zDock+.080,.022);
      const inA=ground(.070,zDock-.105),inB=ground(.070,zDock+.080);
      polygon([quayA,quayB,inB,inA],'#9e9c87');
      polygon([quayA,quayB,pt(quayB.x,quayB.y+3.6*k),pt(quayA.x,quayA.y+3.0*k)],'#626f6b');
      stroke([quayA,quayB],'#d5c8a8',1.1*k);
      for(let j=0;j<=12;j++){
        const q=j/12,x=mix(quayA.x,quayB.x,q),y=mix(quayA.y,quayB.y,q);
        stroke([pt(x,y+.5*k),pt(x,y+2.7*k)],'#89948a',.66*k);
        if(j%4===0){stroke([pt(x,y),pt(x,y-2.2*k)],'#48585a',1.5*k);stroke([pt(x-k,y-2.3*k),pt(x+k,y-2.3*k)],'#77817b',.8*k);}
      }
      const dx=end.x-start.x,dy=end.y-start.y;
      const cross=7*k;
      polygon([pt(start.x,start.y+cross),pt(end.x,end.y+cross),pt(end.x+12*k,end.y+19*k),pt(start.x+12*k,start.y+18*k)],'rgba(31,55,60,.39)');
      for(let j=0;j<=9;j++){
        const t=j/9,x=start.x+dx*t,y=start.y+dy*t;
        stroke([pt(x,y+1.6*k),pt(x,y+cross+4*k)],'#3f5353',2*k);
        stroke([pt(x,y+cross+4*k),pt(x+4*k,y+cross+10*k)],'rgba(45,73,75,.39)',1.2*k);
      }
      polygon([pt(start.x,start.y),pt(end.x,end.y),pt(end.x,end.y+cross),pt(start.x,start.y+cross)],'#a1977f');
      stroke([pt(start.x,start.y+cross),pt(end.x,end.y+cross)],'#585f59',2*k);
      for(let j=0;j<=24;j++){
        const t=j/24,x=start.x+dx*t,y=start.y+dy*t;
        stroke([pt(x,y+.5*k),pt(x,y+cross-.6*k)],j%3?'#8b826d':'#c2ad82',.65*k);
      }
      const x=start.x+dx*.68,y=start.y+dy*.68;
      const cap=pt(x+4*k,y-24*k),boom=pt(x-13*k,y-27*k);
      stroke([pt(x-4*k,y),cap,pt(x+8*k,y+2*k)],'#5a5f54',2*k);
      stroke([cap,boom,pt(x-2*k,y-10*k)],'#938467',1.45*k);
      stroke([boom,pt(boom.x,y-6*k)],'#606961',.8*k);
      g.fillStyle='#f0c281';g.fillRect(cap.x-.75*k,cap.y-1.5*k,1.6*k,1.6*k);
      house(.115,zDock-.024,201,true);
    }
    const layers=[];
    if(s.people>0){
      const count=({village:43,town:75,city:122}[s.kind]??32);
      for(let i=0;i<count;i++){
        const district=i%4,slot=Math.floor(i/4),lane=slot%3;
        const d=[.30,.50,.70,.86][district]+(Math.floor(slot/3)-1.3)*.018+.010*rnd(i,122);
        const u=[.74,.42,.42,.75][district]+lane*.115+rnd(i,121)*.035;
        if(d>.39&&d<.48&&u>.48&&s.specialty==='mining')continue;
        layers.push({d,draw:()=>house(u,d,i)});
      }
      if(s.specialty==='mining')layers.push({d:zMine+.05,draw:()=>{
        house(.47,zMine+.06,215,true);
        const foot=ground(.63,zMine+.057),k=Math.max(.59,px*.82),p=pt(foot.x,foot.y-24*k);
        stroke([pt(foot.x-6*k,foot.y),p,pt(foot.x+7*k,foot.y)],'#736b57',2.5*k);
        stroke([p,pt(p.x+10*k,p.y+2*k),pt(foot.x+11*k,foot.y)],'#6b7165',1.6*k);
        stroke([pt(p.x+3*k,p.y+6*k),pt(foot.x-4*k,foot.y)],'#bcac86',1*k);
      }});
    }
    if(s.port)layers.push({d:zDock,draw:dock});
    layers.sort((a,b)=>a.d-b.d);for(const item of layers)item.draw();
    const air=g.createLinearGradient(0,h*.75,0,h);
    air.addColorStop(0,'rgba(19,34,42,0)');air.addColorStop(1,'rgba(21,37,41,.19)');
    g.fillStyle=air;g.fillRect(0,h*.75,w,h*.25);
  }

  function render(canvas, s, w, h, dpr) {
    const g=canvas.getContext('2d'); if(!g)return;
    canvas.width=Math.max(1,Math.round(w*dpr)); canvas.height=Math.max(1,Math.round(h*dpr));
    g.setTransform(canvas.width/w,0,0,canvas.height/h,0,0);
    if(!s.basin&&s.coastal){coast(g,s,w,h);return;}
    const seed=s.seed, rnd=(n,k=0)=>grain(seed,n,k);
    const phase=rnd(13)*Math.PI*2, cold=s.biome==='tundra', dry=s.biome==='drylands';
    const tones=({forest:[38,78,66],grassland:[91,97,69],drylands:[127,98,72],
      highlands:[89,96,94],tundra:[108,126,128]})[s.biome]??[76,91,76];
    const horizon=.19, focus=.74, hasWater=s.activeChannel||s.oldChannel||s.coastal;
    const reach=s.basin ? (s.activeChannel ? .12+s.flow*.16 : .043+s.flow*.025) : (s.coastal ? .37 : 0);
    const pool=s.project?.completed&&!s.project.demolished&&!s.project.passage;
    const pixelUnit=Math.min(w/720,h/345);
    const poly=(points,color)=>{
      g.fillStyle=color;g.beginPath();g.moveTo(points[0].x,points[0].y);
      for(let i=1;i<points.length;i++)g.lineTo(points[i].x,points[i].y);
      g.closePath();g.fill();
    };
    const line=(points,color,width=1)=>{
      g.strokeStyle=color;g.lineWidth=width;g.beginPath();g.moveTo(points[0].x,points[0].y);
      for(let i=1;i<points.length;i++)g.lineTo(points[i].x,points[i].y);
      g.stroke();
    };
    const pt=(x,y)=>({x,y});
    function channel(z) {
      return .18+.43*Math.sin(z*1.26+phase*.37)+.17*Math.sin(z*2.9+phase)-.18*z;
    }
    function width(z) {
      if(!hasWater)return 0;
      const expanded=pool&&z>focus ? .17*(1-Math.exp(-(z-focus)*4)) : 0;
      const shore=s.coastal&&!s.basin ? .12*(1+Math.sin(z*1.6+phase)) : 0;
      return reach*(.91+.15*Math.sin(2.4*z+phase))+expanded+shore;
    }
    function elevation(x,z) {
      if(!s.basin)return .055+s.elevation*.24+(.13+s.elevation*.40)*noise(seed,x*1.45,z*1.15)+.06*noise(seed+25,x*3.0,z*2.6);
      const delta=x-channel(z),bank=Math.max(0,Math.abs(delta)-width(z));
      const rise=1-Math.exp(-bank*(.9+s.elevation*.63));
      const fold=noise(seed,x*1.9+8,z*1.55+9),ledge=noise(seed+74,x*6.4,z*6.4);
      const summits=.34+.35*s.elevation+.24*Math.sin(z*1.12+phase+(delta<0?2.2:0))+.31*fold;
      return .018+rise*(summits+.065*ledge+.21*Math.abs(Math.sin(x*3.7+z*2+fold*5)));
    }
    function project(x,z,e=elevation(x,z)) {
      const k=1/(1+.54*z);
      return {x:w*(.50+x*.64*k),y:h*(horizon+(.86-e*.53)*k)};
    }

    // Backlight, then successive ridgelines with increasingly distinct rock faces.
    const sky=g.createLinearGradient(0,0,w*.08,h*.50);
    sky.addColorStop(0,'#08172b');sky.addColorStop(.34,'#234258');
    sky.addColorStop(.72,cold?'#8ca4ac':'#917a79');sky.addColorStop(1,'#bf9376');
    g.fillStyle=sky;g.fillRect(0,0,w,h);
    const lightX=w*(.67+.10*rnd(5)),lightY=h*.18;
    const glow=g.createRadialGradient(lightX,lightY,0,lightX,lightY,w*.37);
    glow.addColorStop(0,'rgba(255,207,138,.39)');glow.addColorStop(.35,'rgba(251,163,105,.16)');glow.addColorStop(1,'rgba(251,163,105,0)');
    g.fillStyle=glow;g.fillRect(0,0,w,h*.52);
    for(let i=0;i<65;i++){
      const x=rnd(i,16)*w,y=rnd(i,17)*h*.18;
      g.fillStyle='rgba(208,229,238,'+((1-y/(h*.18))*(.2+.52*rnd(i,18)))+')';
      g.fillRect(x,y,.6+rnd(i,19)*.65,.7);
    }
    for(let i=0;i<36;i++){
      const x=rnd(i,227)*w,y=(.045+.12*rnd(i,230))*h,span=(.016+.075*rnd(i,231))*w;
      const points=[pt(x-span,y),pt(x-span*.27,y-h*.003),pt(x+span*.24,y-h*.004),pt(x+span,y+h*.001),pt(x,y+h*.002)];
      poly(points,i%4===0?'rgba(210,165,140,.16)':'rgba(86,102,121,.17)');
    }
    for(let band=0;band<4;band++){
      const top=[],base=.135+band*.037,bump=(.055+.022*band)*(s.biome==='highlands'?1.35:1);
      for(let i=0;i<=88;i++){
        const t=i/88, ridge=noise(seed+band*41,t*(6+band),21)+.38*noise(seed+15*band,t*30,3)+.16*rnd(i,55+band);
        top.push(pt(t*w,h*(base-bump*(ridge-.6))));
      }
      const bottom=h*(.43+band*.03);
      poly([...top,pt(w,bottom),pt(0,bottom)],['#7f8590','#677688','#506779','#3b5667'][band]);
      for(let j=1;j<top.length-1;j++){
        const a=top[j],b=top[j+1],fall=(bottom-a.y)*(.36+.53*rnd(j,30+band));
        if(a.y>b.y)poly([a,b,pt(b.x-w*(.022+.065*rnd(j,46)),a.y+fall*.58)],
          band<2?'rgba(234,195,166,.07)':'rgba(139,171,178,.1)');
      }
    }

    // Use cross-sections following both banks so the mesh and the water share a shoreline.
    g.fillStyle='#213c42';g.fillRect(0,h*.49,w,h*.52);
    const far=6.2,near=-.74,rows=82,columns=33,step=(far-near)/rows;
    const slices=[],objects=Array.from({length:rows},()=>[]);
    const rowFor=z=>clamp(Math.floor((far-z)/step),0,rows-1);
    function section(z) {
      const middle=channel(z),half=width(z),extent=2.2+z*.57;
      const banks=[[],[]];
      for(let side=0;side<2;side++)for(let j=0;j<=columns;j++){
        const t=j/columns,x=middle+(side?1:-1)*(half+extent*t);
        banks[side].push({x,z,e:elevation(x,z),p:project(x,z)});
      }
      return banks;
    }
    for(let i=0;i<=rows;i++)slices.push(section(far-step*i));
    function groundColor(a,b,c,side,idx,row) {
      const dx=(b.e-a.e)/(b.x-a.x),dz=(a.e-c.e)/step;
      const slope=clamp(.51+.30*dx-.42*dz,.10,1.12);
      const f=clamp((a.z-.5)/7,0,.65),ridge=clamp((a.e-.46)*1.4);
      const stone=[97,105,105],grain=(rnd(idx+side*100,row)-.5)*3;
      const base=tones.map((n,k)=>mix(n+[18,-3,-11][k]*(.55-s.water),stone[k],ridge));
      return rgb(...base.map((n,k)=>mix(n*(.47+.68*slope)+[9,6,11][k]*slope+grain,[86,106,115][k],f)));
    }
    function bankPos(side,z,lane) {
      // A different river level cannot move the streets.
      const terrace=s.basin ? .25 : (s.coastal ? .61 : 0);
      return channel(z)+side*(terrace+.14+lane*.15+.045*Math.sin(z*2.1+lane+phase));
    }
    // Objects are placed from stable site coordinates; time affects their observed state and extent.
    if(s.people>0){
      const homes=Math.round(({village:54,town:105,city:180}[s.kind]??32)*(.83+.25*s.infra));
      for(let i=0;i<homes;i++){
        const sequence=Math.floor(i/4),lane=Math.floor(sequence/2)%4;
        const block=i%4,z=[.17,1.04,1.84,2.91][block]+.12*(Math.floor(sequence/8)-2)+.09*(rnd(i,3)-.5);
        const side=sequence%2?1:-1, x=bankPos(side,z,lane)+side*(.025+.035*rnd(i,6));
        if(s.upperSite&&Math.abs(z-focus)<.20&&lane===0)continue;
        objects[rowFor(z)].push({kind:'house',x,z,id:i});
      }
      objects[rowFor(1.38)].push({kind:'yard',z:1.38});
    }
    const trees=cold?40:dry?44:Math.round(130+s.water*260+s.cover*320+(s.biome==='forest'?720:0));
    for(let i=0;i<trees;i++){
      const grove=Math.floor(i/7),z=near+(far-near)*rnd(grove,88)+.16*(rnd(i,86)-.5);
      const x=(rnd(grove,87)-.5)*(3.2+z*.85)+.19*(rnd(i,85)-.5);
      const offset=Math.abs(x-channel(z))-width(z);
      if(offset<.045||s.people&&z<3.6&&offset>.10&&offset<.66||s.project&&Math.abs(z-focus)<.25&&offset<.35)continue;
      objects[rowFor(z)].push({kind:'tree',x,z,id:i});
    }
    for(let i=0;i<95;i++){
      const z=near+(far-near)*rnd(i,316),x=(rnd(i,318)-.5)*(2.7+z*.74);
      if(Math.abs(x-channel(z))<width(z)+.28||elevation(x,z)<.26)continue;
      objects[rowFor(z)].push({kind:'stone',x,z,id:i});
    }
    if(s.project)objects[rowFor(focus)].push({kind:'project',z:focus});

    function tree(x,z,i) {
      const p=project(x,z),t=(2.5+6*rnd(i,71))*pixelUnit/(1+z*.45);
      if(dry){line([pt(p.x-t,p.y),p,pt(p.x+.85*t,p.y-.34*t)],'#596053',Math.max(.55,t*.28));return;}
      const peak=pt(p.x,p.y-t*1.85);
      poly([pt(p.x-t*.48,p.y-.03*t),pt(p.x-t*.28,p.y-.62*t),pt(p.x-t*.37,p.y-.58*t),peak,
        pt(p.x+t*.28,p.y-.65*t),pt(p.x+t*.2,p.y-.67*t),pt(p.x+t*.41,p.y-.11*t)],'#243c3c');
      poly([peak,pt(p.x+t*.39,p.y-t*.12),pt(p.x+t*.06,p.y-.3*t)],cold?'#9aaba8':'#53715e');
    }
    function house(x,z,i) {
      const e=elevation(x,z),size=.023+.044*rnd(i,11),depth=size*(1.15+rnd(i,12));
      const wall=.032+.033*rnd(i,13)+(s.kind==='city'&&i%8===0 ? .037 : 0),roof=.018+.019*rnd(i,14);
      const front=project(x-size/2,z,e),right=project(x+size/2,z,e);
      const back=project(x+size/2+.012,z+depth,e),farLeft=project(x-size/2+.012,z+depth,e);
      const up=(p,dy)=>pt(p.x,p.y-dy),sy=h*.53/(1+z*.54),rise=wall*sy;
      const a=up(front,rise),b=up(right,rise),c=up(back,rise),d=up(farLeft,rise);
      const peak=pt((a.x+b.x)/2,(a.y+b.y)/2-roof*sy),rear=pt((c.x+d.x)/2,(c.y+d.y)/2-roof*sy);
      poly([front,right,back,pt(back.x+size*w*.22,back.y+size*h*.13),pt(right.x+size*w*.22,right.y+size*h*.13)],'rgba(9,23,29,.27)');
      poly([front,right,b,peak,a],i%3?'#596665':'#817969');
      poly([right,back,c,b],i%4?'#384f54':'#4d5858');
      poly([d,rear,peak,a],cold?'#aebbbb':i%4?'#937b68':'#b79976');
      poly([peak,rear,c,b],cold?'#71898c':i%3?'#50666a':'#6c6961');
      line([d,rear,peak],cold?'#c2cdcb':'#ac9580',Math.max(.45,pixelUnit*.6));
      if(rnd(i,24)>.18){
        const windows=wall>.05?4:2;
        for(let j=0;j<windows;j++){
          const u=.22+.53*(j%2),wx=mix(front.x,right.x,u),wy=front.y-rise*(j<2?.65:.3);
          const ww=Math.max(.72,Math.abs(right.x-front.x)*.12),hh=Math.max(.72,rise*.17);
          g.fillStyle='rgba(254,173,81,.21)';g.fillRect(wx-ww*.46,wy-hh*.38,ww*1.95,hh*1.86);
          g.fillStyle=i%4===0?'#ffde97':'#f1bd79';g.fillRect(wx,wy,ww,hh);
        }
      }
    }
    function stone(x,z,i) {
      const b=project(x,z),n=pixelUnit*(.65+2.4*rnd(i,355))/(1+.42*z);
      const p=pt(b.x+n*.65,b.y-n*.72),a=pt(b.x-n,b.y-.13*n),c=pt(b.x+n*1.65,b.y-.13*n);
      poly([a,p,c,pt(b.x+n*.3,b.y+n*.25)],cold?'#8a9d9b':'#75837b');
      poly([p,c,pt(b.x+n*.3,b.y+n*.25)],'#43575a');
    }
    function yard(z) {
      const x=bankPos(-1,z,1),e=elevation(x,z);
      if(s.specialty==='agriculture'){
        for(let j=0;j<10;j++){
          const nearZ=z+j*.016;
          const edge=[0,.04,.09,.14,.19].map(d=>project(x-d,nearZ));
          line(edge,j%3?'#787d59':'#ac9c71',Math.max(.9,pixelUnit*1.65));
        }
      }else if(s.port&&hasWater){
        const shore=channel(z)-width(z),foot=project(shore-.06,z),tip=project(shore+.13,z,.033);
        line([foot,tip],'#706956',4*pixelUnit);
        for(const u of [.3,.65,.92]){
          const q=pt(mix(foot.x,tip.x,u),mix(foot.y,tip.y,u));
          line([q,pt(q.x,q.y+2*pixelUnit)],'#443e36',1.2*pixelUnit);
        }
      }else if(s.specialty==='mining'){
        const a=project(x-.035,z,e),b=project(x+.035,z,e);
        const top=project(x,z,e+.116),cap=project(x+.045,z,e+.112),right=project(x+.074,z,e);
        line([a,top,b],'#a38a68',2*pixelUnit);line([b,cap,right],'#665f54',1.8*pixelUnit);
        line([top,cap],'#b8a487',2*pixelUnit);line([a,cap],'#9b8771',pixelUnit);
        line([cap,pt(cap.x,cap.y+(right.y-cap.y)*.7)],'#514c45',pixelUnit*.65);
        house(x-.10,z,175);stone(x-.16,z-.01,176);
      }else if(s.specialty==='crafts'||s.specialty==='administration'){
        house(x-.07,z,176);house(x+.03,z+.04,177);
      }
    }
    function works() {
      const p=s.project,z=focus,xc=channel(z),half=width(z)+.10;
      const base=.028,span=half*2,deck=.10+(p.passage ? .038 : 0),parts=p.passage?5:8;
      const point=(u,d,ht)=>project(xc-half+span*u,z+d,base+ht);
      function beam(a,b,color,wide){line([a,b],color,Math.max(.7,wide*pixelUnit));}
      const ratio=p.demolished?0:p.progress;
      if(p.demolished){
        for(let j=0;j<5;j++){const t=.04+.92*j/4;poly([point(t-.025,-.02,0),point(t+.035,-.016,0),point(t+.03,.016,.018),point(t,.03,.026)],'#78817a');}
        return;
      }
      for(let j=0;j<=parts;j++){
        const u=j/parts,fraction=clamp(ratio*1.52-.53*Math.abs(2*u-1)),height=deck*(.24+.76*fraction);
        if(ratio<.87&&j>Math.max(1,Math.ceil(ratio*parts)))continue;
        const thick=.014+(p.passage ? .005 : .014);
        poly([point(u-thick,0,0),point(u+thick,0,0),point(u+thick,0,height),point(u-thick,0,height)],'#a09b84');
        poly([point(u+thick,0,0),point(u+thick,.036,.008),point(u+thick,.036,height),point(u+thick,0,height)],'#475e64');
        if(!p.passage&&j<parts&&fraction>.34){
          const to=(j+1)/parts,wall=height*.76;
          poly([point(u,0,0),point(to,0,0),point(to,0,wall),point(u,0,wall)],'#667879');
          beam(point(u,0,wall),point(to,0,wall),'#bbba9e',1.3);
          if(fraction>.88){
            const left=u+.024,right=to-.02;
            poly([point(left,-.004,.008),point(right,-.004,.008),point(right,-.004,wall*.82),point(left,-.004,wall*.82)],'#394f55');
            for(let seam=1;seam<=3;seam++)beam(point(left,-.005,wall*seam*.18),point(right,-.005,wall*seam*.18),'#84908b',.55);
          }
        }
      }
      const built=p.completed?1:Math.max(0,ratio-.18);
      if(built>0){
        if(!p.passage){
          // A continuous sloping water-retaining face sits on the valley floor.
          // The central spillway and the high abutments differ from a crossing.
          for(let j=0;j<12;j++){
            const a=j/12,b=Math.min(built,(j+1)/12);if(b<=a)break;
            const spill=j>=5&&j<=7,crest=deck*(spill?.64:.94),toe=-.09-(spill?.055:0);
            poly([point(a,toe,.001),point(b,toe,.001),point(b,0,crest),point(a,0,crest)],spill?'#879a97':j%3?'#788984':'#84928a');
            beam(point(a,toe,.002),point(a,0,crest),'rgba(210,208,179,.62)',.8);
            if(spill){
              for(let r=1;r<=4;r++)beam(point(a,mix(toe,0,r/5),crest*r/5),point(b,mix(toe,0,r/5),crest*r/5),'#b2bdb0',.7);
            }else if(j%3===1){
              beam(point(a+.012,-.002,crest*.72),point(Math.max(a+.012,b-.012),-.002,crest*.72),'#4c6465',1.15);
            }
          }
          if(p.completed){
            const chamber=[point(.065,.02,deck),point(.21,.02,deck),point(.21,.02,deck+.056),point(.065,.02,deck+.056)];
            poly(chamber,'#8d9b92');
            poly([chamber[2],point(.21,.062,deck+.056),point(.065,.062,deck+.056),chamber[3]],'#b9af93');
            for(const u of [.089,.126,.163])beam(point(u,.019,deck+.026),point(u+.016,.019,deck+.026),'#e5c285',1.35);
          }
        }
        poly([point(0,0,deck-.016),point(built,0,deck-.016),point(built,0,deck),point(0,0,deck)],'#6f736c');
        poly([point(0,0,deck),point(built,0,deck),point(built,.065,deck),point(0,.065,deck)],p.passage?'#b1a18a':'#999d8c');
        beam(point(0,0,deck),point(built,0,deck),'#dfc69e',1.25);
        beam(point(0,.056,deck+.013),point(built,.056,deck+.013),'#8e9c98',1);
        for(let j=0;j<=Math.floor(18*built);j++)beam(point(j/18,.056,deck),point(j/18,.056,deck+.014),'#9eaba5',.7);
        if(p.passage){
          for(let j=0;j<parts*built-1e-6;j++){
            const l=j/parts,r=Math.min(built,(j+1)/parts),mid=(l+r)/2;
            const arch=[point(l,0,deck*.31),point(mix(l,r,.14),0,deck*.64),point(mid,0,deck*.85),point(mix(l,r,.86),0,deck*.64),point(r,0,deck*.31)];
            poly([...arch,point(r,0,deck-.013),point(l,0,deck-.013)],'#8a8e80');
            line(arch,'#afb3a0',1.3*pixelUnit);
          }
        }
        for(const end of [0,1]){
          if(end===1&&!p.completed)continue;
          const out=end?1.25:-.25,feet=project(xc-half+span*out,z);
          const farFeet=project(xc-half+span*out,z+.065);
          poly([feet,point(end,0,deck),point(end,.065,deck),farFeet],'#8c8875');
        }
      }
      if(!p.completed){
        const u=clamp(built-.05,.08,.86);
        beam(point(u,0,0),point(u,0,deck+.065),'#715f4c',2);
        beam(point(u-.07,0,deck+.063),point(u+.09,0,deck+.069),'#d7b889',1.55);
        beam(point(u-.055,0,deck+.06),point(u,0,deck+.024),'#9c896e',1);
        if(!p.paused)beam(point(u+.068,0,deck+.069),point(u+.068,0,deck+.018),'#b9b1a0',.7);
      }
    }

    for(let row=0;row<rows;row++){
      const z0=far-row*step,z1=z0-step;
      for(let side=0;side<2;side++){
        const farBank=slices[row][side],nearBank=slices[row+1][side];
        for(let j=columns-1;j>=0;j--){
          const a=farBank[j],b=farBank[j+1],c=nearBank[j],d=nearBank[j+1];
          if(Math.min(a.p.x,b.p.x,c.p.x,d.p.x)>w+2||Math.max(a.p.x,b.p.x,c.p.x,d.p.x)<-2)continue;
          const color=groundColor(a,b,c,side,j,row);
          poly([a.p,b.p,d.p,c.p],color);g.strokeStyle=color;g.lineWidth=.9;g.stroke();
          if((rnd(j+side*100,row+130)>.63)&&Math.abs(b.e-a.e)>.024)
            poly([a.p,d.p,c.p],side?'rgba(149,164,149,.065)':'rgba(11,37,47,.075)');
          const turf=rnd(j+side*90,row+270),nearby=z1<3.3;
          if(nearby&&turf>.29){
            const length=Math.abs(b.p.x-a.p.x);
            const count=2+Math.floor(turf*3);
            for(let mark=0;mark<count;mark++){
              const u=rnd(j*9+mark+side*410,row+488),v=rnd(j*13+mark,row+559);
              const x=mix(mix(a.p.x,b.p.x,u),mix(c.p.x,d.p.x,u),v);
              const y=mix(mix(a.p.y,b.p.y,u),mix(c.p.y,d.p.y,u),v);
              const rock=Math.abs(b.e-a.e)>.045;
              const dx=(side?1:-1)*(.4+length*(rock ? .19 : .045))*turf;
              const dy=(b.p.y-a.p.y)*(rock ? .15 : .045);
              line([pt(x,y),pt(x+dx,y+dy)],rock?'rgba(162,164,143,.20)':'rgba(175,178,139,.21)',Math.max(.45,pixelUnit*.56));
            }
          }
        }
      }
      if(hasWater){
        const a=slices[row],b=slices[row+1];
        const v=clamp((z0+.2)/6),estuary=s.basin&&s.silt>.5;
        const water=rgb(mix(19,87,v)+(estuary?9:0),mix(59,103,v),mix(72,112,v));
        const corners=[a[0][0].p,a[1][0].p,b[1][0].p,b[0][0].p];
        poly(corners,water);line([corners[0],corners[1]],water,.9);
        line([corners[1],corners[2]],'rgba(160,183,168,.43)',Math.max(.65,pixelUnit));
        for(let j=0;j<7;j++){
          const z=z1+step*rnd(row,j+150),u=rnd(row,j+180),x=channel(z)+(u*2-1)*width(z)*.91;
          const p=project(x,z,.020),l=(.6+2.8*rnd(row,j+210))*pixelUnit/(1+z*.17);
          line([pt(p.x-l,p.y),pt(p.x+l,p.y-.15)],j%5?'rgba(141,182,183,.28)':'rgba(231,192,143,.54)',Math.max(.5,.72*pixelUnit));
        }
      }
      if(s.people>0&&z0<4){
        for(const side of [-1,1]){
          const lane=side<0?1:0;
          const a=project(bankPos(side,z0,lane),z0),b=project(bankPos(side,z1,lane),z1);
          line([a,b],'#686d64',Math.max(1.1,(3.2+s.infra)*pixelUnit/(1+.48*z0)));
          line([pt(a.x+.5,a.y),pt(b.x+.5,b.y)],'rgba(195,172,124,.63)',Math.max(.5,pixelUnit*.66));
          if(s.infra>.32&&row%3===0&&rnd(row,side+64)>.23){
            g.fillStyle='rgba(255,183,95,.19)';g.beginPath();g.arc(a.x,a.y-1,2.6*pixelUnit/(1+z0*.23),0,Math.PI*2);g.fill();
            g.fillStyle='#ffcf8d';g.fillRect(a.x-.55,a.y-1.3,Math.max(.85,pixelUnit*1.3),Math.max(.65,pixelUnit));
          }
        }
      }
      objects[row].sort((a,b)=>b.z-a.z);
      for(const o of objects[row]){
        if(o.kind==='house')house(o.x,o.z,o.id);
        else if(o.kind==='tree')tree(o.x,o.z,o.id);
        else if(o.kind==='stone')stone(o.x,o.z,o.id);
        else if(o.kind==='yard')yard(o.z);
        else works();
      }
    }
    const veil=g.createLinearGradient(0,h*.22,0,h*.62);
    veil.addColorStop(0,'rgba(137,159,162,0)');veil.addColorStop(.27,'rgba(152,162,157,.11)');veil.addColorStop(1,'rgba(137,159,162,0)');
    g.fillStyle=veil;g.fillRect(0,h*.22,w,h*.4);
    const edge=g.createRadialGradient(w*.50,h*.47,w*.21,w*.50,h*.47,Math.max(w*.74,h*.8));
    edge.addColorStop(0,'rgba(4,14,24,0)');edge.addColorStop(1,'rgba(4,14,24,.27)');
    g.fillStyle=edge;g.fillRect(0,0,w,h);
  }

  function paint(canvas,view) {
    const box=canvas.getBoundingClientRect(),w=Math.round(box.width),h=Math.round(box.height);
    if(w<2||h<2)return;
    const dpr=Math.min(globalThis.devicePixelRatio||1,2,Math.sqrt(1500000/(w*h)));
    const key=[w,h,dpr,view.signature].join('|');
    if(key===view.painted)return;
    render(canvas,view.scene,w,h,dpr);view.painted=key;
  }
  function draw(canvas,world,region,record) {
    if(!canvas||!world||!region)return;
    let view=views.get(canvas);
    if(!view){
      view={};views.set(canvas,view);
    }
    view.scene=snapshot(world,region,record);view.signature=JSON.stringify(view.scene);
    paint(canvas,view);
  }
  return {draw};
})();
