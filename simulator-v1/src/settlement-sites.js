// A regional activity has one selectable identity. Its drawn parcels and buildings
// are representative geometry, positioned in the same projection as the terrain.
const SettlementSites = (() => {
  function draw({kind,s,h,x,z,project,poly,line,pixelUnit,rnd,mark}){
    if(!['fields','mine','workshops'].includes(kind))return false;
    const detail=s.detail, unit=pixelUnit;
    function point(u,v,height=0){
      const p=project(x+u,z+v);
      return {x:p.x,y:p.y-height*h*.53/(1+.54*(z+v))};
    }
    function footprint(points){
      const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
      const left=Math.min(...xs),top=Math.min(...ys);
      mark(kind,left,top,Math.max(...xs)-left,Math.max(...ys)-top,points);
    }
    const trace=(points,color,width=1)=>line(points,color,Math.max(.52,width*unit));
    function shed(u,v,width,depth,height,wall,roof){
      const p=(i,j,y=0)=>point(u+i*width+j*depth*.22,v+j*depth,y);
      const a=p(0,0),b=p(1,0),c=p(1,1);
      const la=p(0,0,height),lb=p(1,0,height),lc=p(1,1,height),ld=p(0,1,height);
      const peak=p(.5,0,height*1.35),back=p(.5,1,height*1.35);
      poly([a,b,lb,peak,la],wall);poly([b,c,lc,lb],'#4b5351');
      poly([la,peak,back,ld],roof);poly([peak,lb,lc,back],'#6d7772');
      poly([p(.37,0),p(.72,0),p(.72,0,height*.64),p(.37,0,height*.64)],'#343f3d');
      if(detail){
        for(let j=.12;j<1;j+=.14)trace([p(.5,j,height*1.35),p(1,j,height)],'rgba(208,200,171,.42)',.55);
        trace([p(.1,0,height*.6),p(.22,0,height*.6)],'#dfc398',2);
      }
      footprint([a,b,c,lc,back,peak,la]);
    }
    function fields(){
      const harvest=['#b7a05d','#7d894c','#c6a467','#748453','#96895b','#a49458'];
      const dark=['#796744','#4c6649','#8b744a','#526849','#695d42','#645e40'];
      // The strips follow a common sloping field lane. Their boundaries stay
      // fixed when the observer returns to an earlier year.
      for(let row=2;row>=0;row--){
        for(let col=0;col<2;col++){
          const i=row*2+col, v0=.035+row*.26, u0=-.53+col*.32+.032*row;
          const width=.285+.022*rnd(i,901), length=.226+.013*rnd(i,902);
          const patch=(u,v,lift=0)=>point(u0+u*width+.046*v+.018*u*v,
            v0+v*length+.035*u+.008*Math.sin(u*3+v*2),lift);
          const shape=[patch(0,0),patch(1,0),patch(1,1),patch(0,1)];
          poly(shape,dark[i]);footprint(shape);
          const count=detail?19:10;
          for(let f=0;f<count;f++){
            const lo=(f+.15)/count,hi=(f+.78)/count;
            const band=[patch(lo,.02),patch(hi,.02),patch(hi+.007,.48),
              patch(hi,.98),patch(lo,.98),patch(lo+.007,.48)];
            poly(band,harvest[i]);
            if(detail&&f%3===1)trace([patch(lo,.07),patch(lo+.006,.48),patch(lo,.91)],'#cbba80',.58);
          }
          trace([shape[0],shape[1],shape[2]],'#c0ab7d',1.05);
        }
      }
      const lane=[point(-.24,.008),point(-.186,.28),point(-.16,.54),point(-.095,.839)];
      trace(lane,'#716c50',3.4);trace(lane,'#beaa80',1.35);
      shed(.052,.35,.068,.11,.036,'#9a8a70','#9a7b59');
    }
    function mine(){
      // Nested cut faces and benches describe one extraction site. The visible
      // scale and palette do not imply an excavated volume in the simulation.
      const corners=[[-.39,.30],[-.31,.51],[-.10,.565],[.095,.5],[.17,.34],
        [.14,.14],[.015,.045],[-.19,.015],[-.37,.12]];
      const ring=(k,depth)=>corners.map(([u,v])=>point(-.103+(u+.103)*k,.284+(v-.284)*k,-depth));
      const outside=ring(1,0);poly(outside,'#ac9b80');footprint(outside);
      const hues=['#ac9c84','#8e8171','#766e63','#68655d'];
      for(let layer=0;layer<4;layer++){
        const radius=1-layer*.155, crest=ring(radius,layer*.006);
        const foot=ring(radius-.058,layer*.006+.018),bench=ring(radius-.155,(layer+1)*.006);
        for(let i=0;i<crest.length;i++){
          const j=(i+1)%crest.length,color=i<4?hues[layer]:['#7d7061','#776c62','#645e56','#524f49'][layer];
          poly([crest[i],crest[j],foot[j],foot[i]],color);
          poly([foot[i],foot[j],bench[j],bench[i]],layer%2?'#a39276':'#b3a388');
        }
        trace([...crest,crest[0]],'#c4b698',.83);
      }
      const floor=ring(.38,.035);poly(floor,'#706f64');
      const ramp=[point(.15,.40),point(.074,.26),point(-.052,.168,-.011),point(-.175,.125,-.014),
        point(-.235,.20,-.025),point(-.226,.285,-.032)];
      trace(ramp,'#675e52',3.8);trace(ramp,'#b1a185',2.2);
      const industrial=s.entities.find(e=>e.kind==='mine')?.industrial;
      if(industrial){
        const l=point(-.357,.31),r=point(-.27,.31),a=point(-.328,.31,.113),b=point(-.293,.31,.113);
        trace([l,a,b,r],'#525752',2.4);trace([l,b,r,a],'#8d7c5f',1.35);
        poly([point(-.35,.31,.117),point(-.271,.31,.117),point(-.271,.31,.129),point(-.35,.31,.129)],'#b39a75');
        if(detail){
          for(let k=1;k<5;k++)trace([point(-.325,.31,.017*k),point(-.30,.31,.017*k)],'#c1aa81',.75);
          trace([b,point(-.215,.36,.021)],'#484b46',.8);
        }
        footprint([l,a,b,r]);shed(.023,.49,.106,.10,.051,'#8c8171','#a18a70');
      }
    }
    function workshops(){
      const yard=[point(-.24,.01),point(.095,.035),point(.135,.34),point(-.22,.36)];
      poly(yard,'#827e68');footprint(yard);
      shed(-.216,.207,.198,.118,.062,'#937c67','#9e846a');
      shed(-.072,.085,.149,.107,.046,'#978671','#a88d72');
      if(detail){
        for(let n=0;n<5;n++)trace([point(-.197,.055+n*.015),point(-.13,.055+n*.015)],'#b4a184',1.8);
      }
    }
    if(kind==='fields')fields();
    else if(kind==='mine')mine();
    else workshops();
    return true;
  }
  return {draw};
})();
