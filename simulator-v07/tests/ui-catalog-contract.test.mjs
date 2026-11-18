import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../src/ui.js',import.meta.url),'utf8');
const models=source.match(/const catalogModels=([^;]+);/)[1];
const pathFunction=source.match(/function modelPath\(model,id,source='auto'\)\{[^\n]+/)[0];
const rowsFunction=source.slice(source.indexOf('function catalogRows(){'),source.indexOf('function catalogOpenButton('));

test('seven model routes retain exact ids and reject unknown models',()=>{
  const context=vm.createContext({encodeURIComponent});
  vm.runInContext(`const catalogModels=${models};${pathFunction};globalThis.paths=Object.keys(catalogModels);globalThis.path=modelPath;`,context);
  assert.deepEqual([...context.paths],['v08','v07','v06','v05','v04','v03','classic']);
  for(const model of context.paths)assert.ok(context.path(model,'same-id','local').endsWith('?world=same-id&source=local'));
  assert.throws(()=>context.path('unknown','same-id'));
});

test('same UUIDs in different models stay distinct in combined catalog',()=>{
  const a={key:'v07:same',model:'v07',id:'same',updatedAt:'2026'}, b={key:'v06:same',model:'v06',id:'same',updatedAt:'2026'};
  const context=vm.createContext({catalogCloudRows:new Map([[a.key,a],[b.key,b]]),catalogLocalRows:new Map(),Date});
  vm.runInContext(`${rowsFunction};globalThis.getRows=catalogRows`,context);
  assert.deepEqual([...context.getRows()].map(r=>r.key).sort(),['v06:same','v07:same']);
});

test('navigation saves before changing models and first run does not create a replacement',()=>{
  assert.match(source,/if\(world\)await persist\(\);window\.location\.assign\(modelPath\(model,id,source\)\)/);
  assert.match(source,/else showWelcome\(\)/);
  assert.match(source,/\['v05','v06'\]\.includes\(model\)&&db\.objectStoreNames\.contains\('metadata'\)/);
});
