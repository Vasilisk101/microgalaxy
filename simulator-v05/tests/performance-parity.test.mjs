import test from 'node:test';
import assert from 'node:assert/strict';
import * as current from '../src/core.mjs';
// Reference source from 2547b9e6ca2ba445a890cc6e30934173412be643.
import * as baseline from './baseline/core.mjs';
const verdict=(module,w)=>{try{module.validateWorld(w);return true;}catch{return false;}};
const w=current.advance(current.createWorld('PARITY',{era:'industrial'}),300).world;
const mutate=(fn)=>{const copy=current.clone(w);fn(copy);return copy;};

test('baseline parity: snapshots, identity, chronology, archive and guards',()=>{
  const future=current.allEvents(w).find(e=>e.year>0);
  const cases=[['valid',w,true],
    ['snapshot capital',mutate(x=>{x.snapshots[0].societies[0].capitalId='missing';}),false],
    ['snapshot future memory',mutate(x=>{x.snapshots[0].societies[0].politics.events.test={id:future.id,year:future.year};}),false],
    ['duplicate society',mutate(x=>{x.societies[1].id=x.societies[0].id;}),false],
    ['event counter',mutate(x=>{x.nextEvent++;}),false],
    ['event year',mutate(x=>{(x.eventArchive[0]??x.events)[0].year=10001;}),false],
    ['route identity',mutate(x=>{x.snapshots[0].geography.edges[0].id='invalid';}),false],
    ['shared aliases under node guard',mutate(x=>{const a=Array(999).fill(1);x.extra=Array(2005).fill(a);}),false],
    ['depth guard',mutate(x=>{let a=x.extra={};for(let i=0;i<26;i++)a=a.n={};}),false],
    ['cycle guard',mutate(x=>{x.extra={};x.extra.self=x.extra;}),false]];
  for(const [label,world,expected] of cases){assert.equal(verdict(baseline,world),expected,`${label} baseline`);assert.equal(verdict(current,world),expected,`${label} current`);}
});

test('generation and advancement remain byte-identical to baseline',()=>{
  for(const era of ['agriculture','industrial','space']){
    const a=baseline.advance(baseline.createWorld('DETERMINISM',{era}),30).world;
    const b=current.advance(current.createWorld('DETERMINISM',{era}),30).world;
    assert.equal(JSON.stringify(b),JSON.stringify(a));
    const before=JSON.stringify(b);current.validateWorld(b);assert.equal(JSON.stringify(b),before);
  }
});
