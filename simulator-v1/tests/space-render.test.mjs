import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as Core from '../../simulator-v08/src/core.mjs';
import * as Space from '../src/space-world.mjs';
const ctx={Core,Math,window:{devicePixelRatio:1},ResizeObserver:class{observe(){}}};vm.runInNewContext(readFileSync(new URL('../../simulator-v08/src/renderer.js',import.meta.url),'utf8')+';globalThis.R=Renderer;',ctx);
test('system keeps a selectable moon near its actual parent',()=>{let w;for(let i=0;i<20;i++){w=Core.createWorld('orbit-test-'+i);Space.generateBodies(w);if(w.planets.some(p=>p.parentId))break;}const moon=w.planets.find(p=>p.parentId),hits=[];let ellipseCount=0;const c={save(){},restore(){},beginPath(){},ellipse(){ellipseCount++},arc(){},stroke(){},fill(){},fillText(){},createRadialGradient(){return {addColorStop(){}}}};ctx.R.prototype.system.call({world:w,zoom:1,hits},c,800,500);const parent=hits.find(x=>x.id===moon.parentId),satellite=hits.find(x=>x.id===moon.id);assert.ok(parent&&satellite);assert.ok(Math.abs(Math.hypot(satellite.x-parent.x,satellite.y-parent.y)-20)<.001);assert.equal(ellipseCount,w.planets.filter(p=>!p.parentId).length);});
