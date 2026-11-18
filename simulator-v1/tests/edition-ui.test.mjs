import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as Core from '../../simulator-v08/src/core.mjs';
import * as LivingWorld from '../src/living-world.mjs';
import * as SpaceWorld from '../src/space-world.mjs';
const ctx={Core,LivingWorld,SpaceWorld,Intl,Number,Math,document:{getElementById:()=>null}};
vm.runInNewContext(readFileSync(new URL('../src/edition-ui.js',import.meta.url),'utf8')+';globalThis.EditionTest=EditionUI;',ctx);
const E=ctx.EditionTest;
const make=seed=>{const w=Core.createWorld(seed,{era:'industrial'});SpaceWorld.generateBodies(w);SpaceWorld.initialize(w);LivingWorld.initialize(w);return w;};
test('young world honestly shows missing work, evidence and colonies',()=>{
 const w=make('young-edition');let html=E.html(w,w);assert.match(html,/Условная схема/);assert.match(html,/не расположение улиц/);
 E.action('tab','evidence',w);html=E.html(w,w);assert.match(html,/подтверждённых находок нет/);
 E.action('tab','colonies',w);html=E.html(w,w);assert.match(html,/внеземных поселений нет/);
});
test('unknown or undiscovered evidence cannot be selected or judged',()=>{
 const w=make('BASIN-3');E.action('tab','evidence',w);assert.equal(E.action('trace','trace-999',w),false);assert.doesNotMatch(E.html(w,w),/Проверить мою версию/);
});
test('evidence and hypothesis follow recorded source without modifying model',()=>{
 const w=make('BASIN-3'),b=w.observatory.living.basin;w.year=31;
 w.observatory.living.facts.push({id:'river-1',kind:'foundation',year:1,site:b.upper});
 w.observatory.living.traces.push({id:'trace-1',kind:'кладка опоры',site:b.upper,source:'river-1',formed:1,discovered:30,lost:null});
 const before=JSON.stringify(w);E.action('tab','evidence',w);assert.equal(E.action('trace','trace-1',w),true);E.set('theory','foundation',w);E.action('check',null,w);assert.match(E.html(w,w),/согласуется с датированной записью/);
 E.set('theory','completed',w);E.action('check',null,w);assert.match(E.html(w,w),/не совпадает/);assert.equal(JSON.stringify(w),before);
});
test('family uses actual moon parent and home gets only received report',()=>{
 let w;for(let i=0;i<20;i++){w=make('edition-space-'+i);if(w.planets.some(p=>p.parentId))break;}const home=w.planets.find(p=>p.home),moon=w.planets.find(p=>p.parentId===home.id),s=w.societies[0];
 const c={id:'c1',name:'Тест',planet:moon.id,parent:s.id,population:100,food:500};w.colonies.push(c);SpaceWorld.registerColony(w,c.id,{skills:['orbital'],equipment:5});const msg=SpaceWorld.publishColonyStatus(w,c.id);E.action('tab','skies',w);assert.match(E.html(w,w),/спутник/);
 E.action('tab','colonies',w);assert.match(E.html(w,w),/Доставленных домой сообщений/);w.year=msg.receiveYear;SpaceWorld.processMessages(w);const html=E.html(w,w);assert.match(html,/Последнее полученное сообщение/);assert.match(html,new RegExp('получено в '+msg.receiveYear));
});
test('labels from untrusted names are escaped',()=>{const w=make('escape-edition');w.regions[0].settlement.name='<img src=x onerror=alert(1)>';E.action('tab','place',w);assert.doesNotMatch(E.html(w,w),/<img src=x/);});

test('demo renders only facts from the supplied independent result',()=>{
 const live=make('live-kept'),before=JSON.stringify(live),demo=make('BASIN-1');demo.year=100;
 const basin=demo.observatory.living.basin;
 if(basin)demo.observatory.living.facts.push({id:'river-1',kind:'foundation',year:47,site:basin.upper});
 const html=E.demoHtml(demo);assert.match(html,/BASIN-1/);assert.match(html,/год 100/);if(basin)assert.match(html,/Год 47/);assert.equal(JSON.stringify(live),before);
});

test('two dated river courses are drawn in the same view and absent outside the basin',()=>{
 const w=make('BASIN-0'),b=w.observatory.living.basin;
 w.snapshots=[{year:0,observatory:structuredClone(w.observatory)}];
 w.year=3;b.diverted=true;
 E.action('tab','place',w);E.action('basin','',w);
 const html=E.html(w,w);
 assert.match(html,/data-channel="previous"/);assert.match(html,/Год 0 — золотой пунктир/);assert.match(html,/Год 3 — бирюзовая полоса/);
 const outside=w.regions.find(r=>![b.upper,b.lower,b.alternate].includes(r.id));
 E.set('site',outside.id,w);assert.match(E.html(w,w),/Пунктир соединяет соседние регионы/);
});

test('river comparison distinguishes axes of flow from measured shorelines',()=>{
 const w=make('BASIN-0'),b=w.observatory.living.basin;w.snapshots=[{year:0,observatory:structuredClone(w.observatory)}];w.year=3;b.diverted=true;
 E.action('tab','place',w);E.action('basin','',w);const html=E.html(w,w);assert.match(html,/условные направления водотока между центрами регионов/);assert.match(html,/не контуры берегов/);assert.match(html,/история границ воды в модели не хранится/);
});
test('astronomical evidence respects selected society and received signal time',()=>{
 const w=make('sky-evidence'),home=w.planets.find(p=>p.home),target=w.planets.find(p=>!p.home&&!p.parentId),observer=w.societies[0],other=w.societies[1],region=w.regions.find(r=>r.owner===observer.id);
 E.html(w,w);E.action('tab','skies',w);E.set('sky-society',observer.id,w);observer.tech[1]=1.23;
 const before=E.html(w,w);assert.match(before,/инженерный уровень 1,23/);assert.match(before,/Состав и пригодность поверхности неизвестны/);
 const m={id:'m'+w.nextEntity++,kind:'probe',status:'arrived',target:target.id,owner:observer.id,originRegion:region.id,people:0,cargo:0,cost:1,departure:0,arrival:1};w.year=1;w.missions.push(m);const signal=SpaceWorld.probeArrived(w,m);
 let text=E.html(w,w);assert.match(text,/Зонд отправлен в 0 году; полученного подтверждения нет/);assert.doesNotMatch(text,/Данные зонда получены/);
 w.year=signal.receiveYear;SpaceWorld.processMessages(w);text=E.html(w,w);assert.match(text,new RegExp('Данные зонда получены в '+signal.deliveredYear+' году'));assert.match(text,/наблюдение у цели — 1 год/);
 E.set('sky-society',other.id,w);const otherView=E.html(w,w);assert.doesNotMatch(otherView,/Данные зонда получены/);assert.match(otherView,/Состав и пригодность поверхности неизвестны/);
});
test('climate history uses only recorded values from selected year',()=>{
 const w=make('climate-evidence');w.year=20;w.climate.warming=.4;w.climate.pollution=.6;w.history=[{year:0,warming:.1},{year:10,warming:.2,pollution:.3},{year:30,warming:9,pollution:9}];E.action('tab','place',w);
 const html=E.html(w,w);assert.match(html,/Выбранный срез · год 20: потепление 0,4 · загрязнение 0,6/);assert.match(html,/Год 0 · потепление 0,1 · загрязнение не записано/);assert.match(html,/Год 10 · потепление 0,2 · загрязнение 0,3/);assert.doesNotMatch(html,/Год 30 · потепление/);
});
