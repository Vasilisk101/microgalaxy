import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as Core from '../src/core.mjs';
import {previousCore as ReleasedCore} from '../src/previous-core.mjs';
import * as LegacyCore from '../../simulator-v08/src/core.mjs';
import * as LivingWorld from '../src/living-world.mjs';

const source=readFileSync(new URL('../src/field-guide.js',import.meta.url),'utf8');
function harness(world=null){
  const context={Core,LegacyCore,ReleasedCore,LivingWorld,world,snapshotIndex:null,selectedPlanet:null,view:'planet',Intl,URL,Blob,structuredClone};
  let html='',title='',progress=null,saved=0,focused=null;
  const dialog={open:false};
  Object.assign(context,{
    h:s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
    setRunning(){},yieldFrame:async()=>{},render(){},resetEconomyPages(){},notice(){},
    modal(t,body){title=t;html=body;dialog.open=true;progress=body.includes('field-guide-progress')?{}:null;},
    $:sel=>sel==='#dialog'?dialog:sel==='#field-guide-progress'?progress:null,
    displayed:()=>context.snapshotIndex===null?context.world:Core.viewSnapshot(context.world,context.snapshotIndex),
    showRegionMap:id=>{focused=[id,context.displayed().year];},
    transition:fn=>fn(),installWorld:async w=>{saved++;context.world={...w,id:'explicit-copy'};},
  });
  vm.createContext(context);vm.runInContext(source+';globalThis.api=FieldGuide;globalThis.onGuide=fieldGuideClick;',context);
  return {context,guide:context.api,click:(guide,params={})=>context.onGuide({dataset:{guide,...params}}),
    inspect:()=>({title,html,saved,focused,world:context.world}),preview:()=>vm.runInContext('guidePreview',context)};
}

test('quiet suggestions point to a real region at the selected exact year and never advance the history',async()=>{
  const w=Core.createWorld('TIHAIA-DOLINA'),h=harness(w),before=JSON.stringify(w);
  await h.click('open');assert.match(h.inspect().html,/Спокойное наблюдение/);
  const hints=h.guide.suggestions(w,Core),region=hints.find(x=>x.quiet);
  assert.ok(w.regions.some(r=>r.id===region.target.site));
  const live=Core.advance(w,51).world;
  // Follow the original hint after another view has selected a later year.
  h.context.world=live;await h.click('tip',{guideIndex:String(hints.indexOf(region))});
  assert.deepEqual(h.inspect().focused,[region.target.site,0]);
  assert.equal(h.guide.yearIndex(live,{...region.target,year:1}),undefined);
  assert.equal(h.guide.yearIndex({...live,id:'other'},region.target),undefined);
  assert.equal(JSON.stringify(w),before);assert.equal(h.inspect().saved,0);
});
test('historical hints contain only subjects and records present by that snapshot',()=>{
  const live=Core.advance(Core.createWorld('BASIN-1',{era:'industrial'}),100).world;
  const h=harness(live),historical=Core.viewSnapshot(live,0);
  assert.ok(live.observatory.living.facts.some(f=>f.kind==='completed'));
  assert.equal(h.guide.suggestions(historical,Core).some(x=>x.target.type==='fact'),false);
  const year=Core.advance(Core.createWorld('BASIN-1',{era:'industrial'}),57).world;
  const fact=h.guide.suggestions(year,Core).find(x=>x.target.type==='fact');
  assert.equal(fact.target.year,57);assert.equal(fact.target.site,'r10');
  assert.ok(year.observatory.living.facts.some(x=>x.id===fact.target.id));
});

test('gallery replays all three records from the actual engines before any world exists',async()=>{
  const h=harness();
  await h.click('open');assert.match(h.inspect().html,/Галерея наблюдений/);assert.match(h.inspect().html,/ГОРИЗОНТ-12/);
  for(const [key,years,site,version] of [
    ['doron',[65,78],'Дорон','0.8.0'],['basin',[47,57],'r10','1.0.0'],['voyage',[139,140],'r26','1.0.0'],
  ]){
    await h.click('demo',{guideKey:key});
    let preview=h.preview();
    assert.deepEqual(Array.from(preview.points,p=>p.year),years);
    assert.equal(preview.w.modelVersion,version);assert.equal(preview.w.year,years[1]);
    if(key==='doron')assert.equal(h.guide.name(preview.w,preview.points[0].site),site);
    else assert.equal(preview.points.at(-1).site,site);
    assert.equal(h.inspect().world,null);assert.equal(h.inspect().saved,0);
    await h.click('moment',{guideIndex:'0'});preview=h.preview();
    assert.equal(preview.w.year,years[0]);assert.equal(preview.points.length,1);
    assert.equal(h.inspect().world,null);assert.equal(h.inspect().saved,0);
    if(key==='doron'){assert.match(h.inspect().html,/Скачать мир для версии 0.8/);assert.doesNotMatch(h.inspect().html,/Сохранить отдельным миром/);}
  }
  await h.click('save');
  const out=h.inspect();assert.equal(out.saved,1);assert.equal(out.world.year,139);assert.equal(h.context.selectedPlanet,out.world.colonies.find(c=>c.id===out.world.observatory.space.returns[0].origin).planet);
});
test('gallery cancellation and completed previews leave a running user world byte-for-byte intact',async()=>{
  const w=Core.createWorld('SAVED-MY-WORLD'),before=JSON.stringify(w),h=harness(w);
  let release;
  h.context.yieldFrame=()=>new Promise(resolve=>{release=resolve;});
  const pending=h.click('demo',{guideKey:'voyage'});
  while(!release)await new Promise(resolve=>setImmediate(resolve));
  await h.click('open');release();await pending;
  assert.equal(h.inspect().title,'Куда посмотреть');assert.equal(h.preview(),null);
  h.context.yieldFrame=async()=>{};
  await h.click('demo',{guideKey:'basin'});assert.equal(h.preview().w.year,57);
  assert.equal(h.inspect().saved,0);assert.equal(h.inspect().world,w);assert.equal(JSON.stringify(w),before);
});
