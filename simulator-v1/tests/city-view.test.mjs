import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as Core from '../../simulator-v08/src/core.mjs';
import * as LivingWorld from '../src/living-world.mjs';
import * as SpaceWorld from '../src/space-world.mjs';
const context={Core,LivingWorld,SpaceWorld,Intl,Math,Number,document:{getElementById:()=>null}};
vm.runInNewContext(readFileSync(new URL('../src/edition-ui.js',import.meta.url),'utf8')+';globalThis.EditorTest=EditionUI;',context);
const E=context.EditorTest;
function fixture(){const w=Core.createWorld('city-check');SpaceWorld.generateBodies(w);SpaceWorld.initialize(w);LivingWorld.initialize(w);return w;}
test('selected region opens deterministic city view without model writes',()=>{const w=fixture(),r=w.regions[0],before=JSON.stringify(w);assert.equal(E.action('city',r.id,w),true);const a=E.html(w,w),b=E.html(w,w);assert.equal(a,b);assert.match(a,/Крупный план/);assert.match(a,/Процедурная реконструкция/);assert.match(a,/не отдельные объекты модели/);assert.equal(JSON.stringify(w),before);});
test('city responds to real settlement kind, specialization, biome and infrastructure',()=>{const w=fixture(),r=w.regions[0];E.action('city',r.id,w);const a=E.html(w,w);r.settlement.kind='city';r.settlement.specialization='mining';r.biome='tundra';r.settlement.infrastructure=.95;const b=E.html(w,w);assert.notEqual(a,b);assert.match(b,/крупный город/);assert.match(b,/Добыча сырья/);assert.match(b,/тундра/);assert.match(b,/инфраструктура 95%/);assert.equal(E.action('city-detail','special',w),true);assert.match(E.html(w,w),/специализация «добыча»/);});
test('coast is distinct from working port and selection remains accessible',()=>{const w=fixture(),r=w.regions[0];r.coastal=true;r.settlement.specialization='crafts';E.action('city',r.id,w);E.action('city-detail','shore',w);let html=E.html(w,w);assert.match(html,/работающий порт по этим данным не подтверждён/);assert.match(html,/aria-pressed="true"/);r.settlement.specialization='port';r.economy.port=.5;html=E.html(w,w);assert.match(html,/портовая специализация и инфраструктура/);});

test('an individual drawn silhouette can be selected without inventing a recorded building',()=>{const w=fixture(),r=w.regions[0];E.action('city',r.id,w);let html=E.html(w,w);const match=html.match(/<option value="(house-\d+)"/);assert.ok(match,'expected at least one silhouette');assert.equal(E.set('city-object',match[1],w),true);html=E.html(w,w);assert.match(html,/Выбран дом \d+ на рисунке/);assert.match(html,/не хранит отдельного дома/);assert.match(html,/Север сверху/);assert.match(html,/той же функции рельефа/);});
