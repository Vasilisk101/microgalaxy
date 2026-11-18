const OrbitAtlas = (() => {
  let host, world, options, selected, mode, year, lon, lat, zoom, observer, canvas, hits, drag, previousFocus;
  let portraits = new Map();
  let orbitZoom=1;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const bodies = () => world?.planets || [];
  const body = () => bodies().find(p => p.id === selected);
  const parent = p => bodies().find(b => b.id === p?.parentId) || p;
  const moons = p => bodies().filter(b => b.parentId === p?.id);
  const kind = p => ({gas:'газовый гигант',ice:'ледяное тело',rock:'каменистое тело',terrestrial:'землеподобная планета'}[p?.kind] || 'тип не указан');
  const number = n => Number.isFinite(n) ? Number(n.toFixed(2)).toLocaleString('ru-RU') : 'не указан';
  function close() {
    if (!host) return;
    observer?.disconnect(); observer = null;
    if (canvas && typeof PlanetOptics !== 'undefined') PlanetOptics.cancel(canvas);
    host.removeEventListener('click', click); host.removeEventListener('change', change); host.removeEventListener('keydown', keydown); host.removeEventListener('cancel', cancel);
    canvas?.removeEventListener('pointerdown', pointerdown); canvas?.removeEventListener('pointermove', pointermove); canvas?.removeEventListener('pointerup', pointerup); canvas?.removeEventListener('pointercancel', pointerup);
    host.innerHTML = ''; host = null; world = null; options = null; canvas = null; hits = []; portraits.clear();
    if (previousFocus?.isConnected) previousFocus.focus({preventScroll:true}); previousFocus = null;
  }
  function requestClose() { const callback = options?.onClose; if (callback) callback(); else {const dialog=host; close(); if(dialog?.open)dialog.close();} }
  function cancel(event) {event.preventDefault(); requestClose();}
  function open(node, value, opts = {}) {
    if (host) close();
    host=node; world=value; options=opts; selected=bodies().some(p=>p.id===opts.bodyId)?opts.bodyId:(bodies().find(p=>p.home)?.id || bodies()[0]?.id);
    mode=['system','family','globe','surface'].includes(opts.mode)?opts.mode:'system'; year=opts.demo && Number.isFinite(opts.year)?opts.year:world.year;
    lon=0; lat=.15; zoom=1; orbitZoom=1; hits=[]; previousFocus=document.activeElement;
    host.addEventListener('click',click); host.addEventListener('change',change); host.addEventListener('keydown',keydown); host.addEventListener('cancel',cancel);
    if (!host.open && typeof host.showModal === 'function') host.showModal();
    host.innerHTML = `<section class="orbit-atlas" aria-label="Орбитальный атлас">
      <header class="oa-top">
        <button type="button" data-orbit="close">← К обсерватории</button>
        <div><span>ОРБИТАЛЬНЫЙ АТЛАС</span><h2></h2></div>
        <div class="oa-time"></div>
      </header>
      <main class="oa-layout">
        <div class="oa-stage">
          <canvas class="oa-canvas" tabindex="0" aria-label="Карта орбит и планет. Выберите тело из списка; в приближении управляйте стрелками."></canvas>
          <p class="oa-stage-note"></p>
          <div class="oa-camera" aria-label="Управление камерой">
            <button type="button" data-orbit="left" aria-label="Повернуть влево">←</button>
            <button type="button" data-orbit="right" aria-label="Повернуть вправо">→</button>
            <button type="button" data-orbit="up" aria-label="Повернуть вверх">↑</button>
            <button type="button" data-orbit="down" aria-label="Повернуть вниз">↓</button>
            <button type="button" data-orbit="in" aria-label="Приблизить">＋</button>
            <button type="button" data-orbit="out" aria-label="Отдалить">−</button>
          </div>
        </div>
        <aside class="oa-panel"></aside>
      </main>
    </section>`;
    canvas=host.querySelector('canvas'); canvas.addEventListener('pointerdown',pointerdown); canvas.addEventListener('pointermove',pointermove); canvas.addEventListener('pointerup',pointerup); canvas.addEventListener('pointercancel',pointerup);
    if(typeof ResizeObserver!=='undefined'){observer=new ResizeObserver(draw);observer.observe(canvas);}
    render(); host.querySelector('[data-orbit="close"]').focus({preventScroll:true});
  }
  function render() {
    if (!host) return;
    const p=body(), root=parent(p), active=document.activeElement, focus=host.contains(active)?{action:active.dataset.orbit, id:active.dataset.id}:null;
    host.querySelector('.oa-top h2').textContent = world.name || 'Звёздная система';
    host.querySelector('.oa-top h2').title = world.seed || '';
    host.querySelector('.oa-top h2').nextElementSibling?.remove();
    if (world.seed) host.querySelector('.oa-top h2').insertAdjacentHTML('afterend','<small class="oa-seed">Код мира · '+esc(world.seed)+'</small>');
    host.querySelector('.oa-time').innerHTML=options.demo?'<label>Год обзора <input type="number" data-orbit="year" min="0" max="10000" step="1" value="'+esc(year)+'"></label><small>Меняет положение тел в примере, не историю мира.</small>':'<span>Год <b>'+esc(world.year)+'</b></span><small>Текущее состояние мира</small>';
    const choices=bodies().map(b=>'<option value="'+esc(b.id)+'"'+(b.id===selected?' selected':'')+'>'+(b.parentId?'↳ ':'')+esc(b.name)+'</option>').join('');
    const linked=moons(root), family= root ? [root,...linked] : [];
    const familyButtons=family.map(b=>'<button type="button" data-orbit="select" data-id="'+esc(b.id)+'" aria-pressed="'+(b.id===selected)+'">'+esc(b.name)+'</button>').join('');
    const tabs=[['system','Система'],['family','Семейство'],['globe','Планета'],['surface','Поверхность']].map(([id,label])=>'<button type="button" data-orbit="mode" data-id="'+id+'" aria-pressed="'+(mode===id)+'">'+label+'</button>').join('');
    const surfaceNote=p?.kind==='gas'?'Газовый гигант: твёрдая поверхность не моделируется.':'Оптическая реконструкция, отдельные детали условны.';
    const description = mode === 'system'
      ? 'Орбиты и размеры показаны условно; положения рассчитаны для указанного года.'
      : mode === 'family'
        ? 'Спутники показаны рядом со своим родителем; масштаб расстояний условный.'
        : surfaceNote;
    const familyMarkup = familyButtons
      ? `<div class="oa-family"><strong>Семейство</strong>${familyButtons}</div>` : '';
    const placeMarkup = p?.home && options.onPlace
      ? '<button type="button" data-orbit="place">Наблюдать места →</button>' : '';
    host.querySelector('.oa-panel').innerHTML = `
      <span class="oa-kicker">ВЫБРАННОЕ ТЕЛО</span>
      <h3>${esc(p?.name || 'Нет доступных тел')}</h3>
      <p class="oa-meta">${esc(kind(p))}${p?.home ? ' · обитаемый мир' : ''}${p?.parentId ? ' · Вокруг планеты: ' + esc(root?.name) : ''}</p>
      <label>Выбрать тело <select data-orbit="body">${choices}</select></label>
      <nav class="oa-tabs" aria-label="Масштаб наблюдения">${tabs}</nav>
      <div class="oa-facts">
        <div><span>Радиус</span><b>${number(p?.radius)} R⊕</b></div>
        <div><span>Температура</span><b>${number(p?.temperature)} °C</b></div>
        <div><span>${p?.parentId ? 'До планеты' : 'Орбита'}</span><b>${p?.parentId && Number.isFinite(p.orbit?.distance) ? esc(p.orbit.distance.toLocaleString('ru-RU',{maximumFractionDigits:5})) : number(p?.a)} а. е.</b></div>
        <div><span>Звезда</span><b>${number(Math.round(world.star?.temperature))} K</b></div>
      </div>
      <p class="oa-hint">${description}</p>${familyMarkup}${placeMarkup}`;
    host.querySelector('.oa-stage-note').textContent=mode==='system'?'ОБЗОР СИСТЕМЫ · МАСШТАБ УСЛОВНЫЙ':mode==='family'?'СЕМЕЙСТВО · МАСШТАБ УСЛОВНЫЙ':'ОПТИЧЕСКАЯ РЕКОНСТРУКЦИЯ';
    const controls=host.querySelector('.oa-camera');
    controls.hidden=mode==='family';
    for(const action of ['left','right','up','down'])controls.querySelector('[data-orbit="'+action+'"]').hidden=mode==='system';
    draw();
    if(focus){const el=[...host.querySelectorAll('[data-orbit]')].find(e=>e.dataset.orbit===focus.action&&e.dataset.id===focus.id);el?.focus({preventScroll:true});}
  }
  function phase(p) {
    return p.parentId ? SpaceWorld.satellitePhase(p, year) : SpaceWorld.orbitalPhase(p, year);
  }
  function light(p) {
    return typeof SpaceWorld.stellarLight === 'function'
      ? SpaceWorld.stellarLight(world, p, year) : [-.6, -.4, 1];
  }
  function prepare() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return {ctx, w:rect.width, h:rect.height};
  }
  function sky(ctx, w, h) {
    const gradient = ctx.createRadialGradient(w*.46,h*.47,2,w*.46,h*.47,Math.max(w,h)*.72);
    gradient.addColorStop(0,'#162c38'); gradient.addColorStop(1,'#040b12');
    ctx.fillStyle=gradient; ctx.fillRect(0,0,w,h);
    let seed=7139;
    for(let i=0;i<105;i++) {
      seed=(seed*1664525+1013904223)>>>0; const x=seed/4294967296*w;
      seed=(seed*1664525+1013904223)>>>0; const y=seed/4294967296*h;
      ctx.fillStyle=i%9===0?'#b4d7d377':'#adc8cc3b';
      ctx.fillRect(x,y,i%13===0?1.5:.8,i%13===0?1.5:.8);
    }
  }
  function star(ctx,x,y,r) {
    const t=world.star?.temperature || 5500;
    const color=t<4800?'#ffb170':t<6500?'#ffe0a4':'#cce8ff';
    const glow=ctx.createRadialGradient(x,y,1,x,y,r*4);
    glow.addColorStop(0,'#fff9e6'); glow.addColorStop(.18,color); glow.addColorStop(1,'transparent');
    ctx.fillStyle=glow; ctx.fillRect(x-r*4,y-r*4,r*8,r*8);
  }
  function portrait(p, radius) {
    if (typeof PlanetOptics === 'undefined') return null;
    const size=Math.max(64,Math.min(512,Math.ceil(radius*2.4)));
    const key=[p.id,year,size].join(':');
    if (!portraits.has(key)) {
      const image=document.createElement('canvas');
      PlanetOptics.draw(image,world,p,{mode:'globe',fit:'disc',width:size,height:size,
        lon:0,lat:.15,zoom:1,light:light(p),moving:false,dpr:1,sync:true});
      portraits.set(key,image);
      if(portraits.size>50) portraits.delete(portraits.keys().next().value);
    }
    return portraits.get(key);
  }
  function planet(ctx,p,x,y,r) {
    const image=portrait(p,r);
    if(image) ctx.drawImage(image,x-r,y-r,r*2,r*2);
    else {
      ctx.fillStyle={terrestrial:'#64a7a7',rock:'#a6907a',ice:'#c0dde0',gas:'#cda677'}[p.kind] || '#aab6b0';
      ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();
    }
    if(p.id===selected) {
      ctx.strokeStyle='#d5f7e9';ctx.lineWidth=1.4;
      ctx.beginPath();ctx.arc(x,y,r+5,0,Math.PI*2);ctx.stroke();
    }
    hits.push({id:p.id,x,y,r:Math.max(16,r+5)});
  }
  function labels(ctx,items,w,h) {
    ctx.font='12px system-ui';ctx.textBaseline='middle';
    const occupied=[];
    for(const item of items.sort((a,b)=>(b.priority||0)-(a.priority||0))) {
      const tw=Math.min(w-16,ctx.measureText(item.text).width), th=18;
      const choices=[[item.x+item.r+8,item.y-12],[item.x-item.r-tw-8,item.y-12],
        [item.x-tw/2,item.y-item.r-15],[item.x-tw/2,item.y+item.r+15]];
      let found=null;
      for(const [px,py] of choices) {
        const x=Math.max(8,Math.min(w-tw-8,px)),y=Math.max(12,Math.min(h-12,py));
        const box={x,y:y-th/2,w:tw,h:th};
        if(occupied.every(b=>box.x+box.w+5<b.x||b.x+b.w+5<box.x||box.y+box.h+3<b.y||b.y+b.h+3<box.y)){found=box;break;}
      }
      if(!found) continue;
      occupied.push(found);ctx.fillStyle='#07121bd9';ctx.fillRect(found.x-3,found.y,found.w+6,found.h);
      ctx.fillStyle=item.priority?'#e3fff5':'#bfd6d3';ctx.fillText(item.text,found.x,found.y+th/2,found.w);
    }
  }
  function drawFamily(ctx,w,h,p) {
    const root=parent(p), children=moons(root), side=Math.min(w,h);
    const cx=w*.45, cy=h*.48, radius=side*.24;
    const orbitalRadius=side*.40;
    ctx.strokeStyle='#8fb7b446';ctx.lineWidth=1;ctx.beginPath();
    ctx.arc(cx,cy,orbitalRadius,0,Math.PI*2);ctx.stroke();
    planet(ctx,root,cx,cy,radius);
    const names=[{text:root.name,x:cx,y:cy,r:radius,priority:root.id===selected?2:1}];
    children.forEach((moon,i)=>{
      const angle=phase(moon),distance=orbitalRadius+i*22;
      const x=cx+Math.cos(angle)*distance,y=cy+Math.sin(angle)*distance;
      const r=Math.max(9,Math.min(side*.075,radius*moon.radius/Math.max(.1,root.radius)));
      planet(ctx,moon,x,y,r);names.push({text:moon.name,x,y,r,priority:moon.id===selected?3:1});
    });
    labels(ctx,names,w,h);
  }
  function drawSystem(ctx,w,h) {
    const roots=bodies().filter(b=>!b.parentId).sort((a,b)=>a.a-b.a);
    if(!roots.length)return;
    const cx=w*.46,cy=h*.48,maxR=Math.max(45,Math.min(w*.49,h*.66))*orbitZoom;
    const min=Math.min(...roots.map(b=>b.a)),max=Math.max(...roots.map(b=>b.a));
    const scale=Math.log1p(Math.max(32,max)),names=[];
    star(ctx,cx,cy,Math.max(10,Math.min(22,maxR*.055)));
    roots.forEach(q=>{
      const rr=maxR*(.12+.82*Math.log1p(q.a)/scale), a=phase(q);
      const x=cx+Math.cos(a)*rr,y=cy+Math.sin(a)*rr*.67;
      ctx.strokeStyle=q.id===selected?'#a7e9dba3':'#a3c7c347';ctx.lineWidth=q.id===selected?1.5:.8;
      ctx.beginPath();ctx.ellipse(cx,cy,rr,rr*.67,0,0,Math.PI*2);ctx.stroke();
      const r=Math.max(9,Math.min(25,8+Math.sqrt(q.radius)*6));
      planet(ctx,q,x,y,r);
      names.push({text:q.name,x,y,r,priority:q.id===selected?3:1});
      moons(q).forEach((m,i)=>{
        const mr=r+18+i*12,ma=phase(m),mx=x+Math.cos(ma)*mr,my=y+Math.sin(ma)*mr*.7;
        ctx.strokeStyle='#a6cfcb55';ctx.beginPath();ctx.ellipse(x,y,mr,mr*.7,0,0,Math.PI*2);ctx.stroke();
        planet(ctx,m,mx,my,7);names.push({text:m.name,x:mx,y:my,r:7,priority:m.id===selected?4:0});
      });
    });
    labels(ctx,names,w,h);
    ctx.fillStyle='#adc5c4';ctx.font='11px system-ui';
    ctx.fillText('Орбиты: '+number(min)+'–'+number(max)+' а. е. · логарифмический масштаб',15,22);
  }
  function draw() {
    if(!canvas||!host)return;
    const p=body();if(!p)return;
    if(mode==='globe'||mode==='surface') {
      hits=[];
      if(typeof PlanetOptics!=='undefined') PlanetOptics.draw(canvas,world,p,
        {mode,lon,lat,zoom,light:light(p),moving:!!drag});
      return;
    }
    if (typeof PlanetOptics !== 'undefined') PlanetOptics.cancel(canvas);
    const {ctx,w,h}=prepare();sky(ctx,w,h);hits=[];
    if(mode==='family')drawFamily(ctx,w,h,p);else drawSystem(ctx,w,h);
  }
  function updateCamera(action){
    if(mode==='family')return;
    if(mode==='system'){
      if(action==='in')orbitZoom=Math.min(2.5,orbitZoom*1.25);
      else if(action==='out')orbitZoom=Math.max(.65,orbitZoom/1.25);
      else return;
    }else{
      if(action==='left')lon-=.2;
      if(action==='right')lon+=.2;
      if(action==='up')lat=Math.min(1.4,lat+.15);
      if(action==='down')lat=Math.max(-1.4,lat-.15);
      if(action==='in')zoom=Math.min(3,zoom*1.2);
      if(action==='out')zoom=Math.max(.65,zoom/1.2);
    }
    draw();
  }
  function click(e){const target=e.target.closest('[data-orbit]');if(!target||!host.contains(target))return;const a=target.dataset.orbit;if(a==='close')requestClose();else if(a==='mode'){mode=target.dataset.id;render();}else if(a==='select'){selected=target.dataset.id;render();}else if(a==='place')options.onPlace?.(body());else if(['left','right','up','down','in','out'].includes(a))updateCamera(a);}
  function change(e){const a=e.target.dataset.orbit;if(a==='body'&&bodies().some(p=>p.id===e.target.value)){selected=e.target.value;render();}else if(a==='year'&&options.demo){const n=Number(e.target.value);if(Number.isInteger(n)&&n>=0&&n<=10000){year=n;render();}else e.target.value=year;}}
  function keydown(e){if(e.target!==canvas)return;const action={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down','+':'in','-':'out'}[e.key];if(action){e.preventDefault();updateCamera(action);}}
  function pointerdown(e){drag={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY};canvas.setPointerCapture(e.pointerId);}
  function pointermove(e){if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.x=e.clientX;drag.y=e.clientY;if(mode==='globe'||mode==='surface'){lon+=dx*.008;lat=Math.max(-1.4,Math.min(1.4,lat+dy*.008));draw();}}
  function pointerup(e){if(!drag)return;const d=drag;drag=null;if(Math.hypot(e.clientX-d.startX,e.clientY-d.startY)<8&&(mode==='system'||mode==='family')){const rect=canvas.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;const matches=hits.filter(h=>Math.hypot(h.x-x,h.y-y)<=h.r).sort((a,b)=>Math.hypot(a.x-x,a.y-y)-Math.hypot(b.x-x,b.y-y));if(matches.length){selected=matches[0].id;render();return;}}draw();}
  return {open,close};
})();


