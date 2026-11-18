import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import vm from 'node:vm';
import '../build.mjs';
test('Готовый HTML содержит синтаксически корректный JavaScript',async()=>{const html=await readFile(new URL('../dist/MICROGALAXY-0.3.html',import.meta.url),'utf8');const source=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];assert.ok(source);assert.doesNotThrow(()=>new vm.Script(source));assert.ok(source.includes('$$=s=>'));});
test('Сборка разрешает только своё облако, без внешних библиотек и ИИ',async()=>{const html=await readFile(new URL('../dist/MICROGALAXY-0.3.html',import.meta.url),'utf8');assert.ok(html.includes("connect-src 'self'"));assert.equal((html.match(/<script[^>]+src=/g)??[]).length,0);assert.ok(html.includes('/classic'));assert.ok(!html.includes('ЛОКАЛЬНЫЙ КАНДИДАТ'));assert.ok(html.includes('/api/v03/worlds'));});

