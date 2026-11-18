import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as WorldModels from '../../lib/world-models.mjs';

const source=await readFile(new URL('../src/ui.js',import.meta.url),'utf8');
const models=source.match(/const catalogModels=([^;]+);/)[1];
const pathFunction=source.match(/function modelPath\(model,id,source='auto'\)\{[^\n]+/)[0];
const rowsFunction=source.slice(source.indexOf('function catalogRows(){'),source.indexOf('function catalogOpenButton('));

test('eight model routes retain exact ids and reject unknown models',()=>{
  const context=vm.createContext({encodeURIComponent, WorldModels});
  vm.runInContext(`const catalogModels=${models};${pathFunction};globalThis.paths=Object.keys(catalogModels);globalThis.path=modelPath;`,context);
  assert.deepEqual([...context.paths],['classic','v03','v04','v05','v06','v07','v08','v1']);
  for(const model of context.paths)assert.ok(context.path(model,'same-id','local').endsWith('?world=same-id&source=local'));
  assert.throws(()=>context.path('unknown','same-id'));
});

test('same UUIDs in different models stay distinct in combined catalog',()=>{
  const a={key:'v08:same',model:'v08',id:'same',updatedAt:'2026'}, b={key:'v06:same',model:'v06',id:'same',updatedAt:'2026'};
  const context=vm.createContext({catalogCloudRows:new Map([[a.key,a],[b.key,b]]),catalogLocalRows:new Map(),Date});
  vm.runInContext(`${rowsFunction};globalThis.getRows=catalogRows`,context);
  assert.deepEqual([...context.getRows()].map(r=>r.key).sort(),['v06:same','v08:same']);
});

test('navigation saves before changing models and first run does not create a replacement',()=>{
  assert.match(source,/if\(world\)await persist\(\);window\.location\.assign\(modelPath\(model,id,source\)\)/);
  assert.match(source,/else showWelcome\(\)/);
  assert.match(source,/Object\.keys\(catalogModels\)\.filter\(model=>model!==activeModel\)/);
  assert.match(source,/Retention\.readModelCatalog\(model,\{knownNames,indexBudget\}\)/);
});
