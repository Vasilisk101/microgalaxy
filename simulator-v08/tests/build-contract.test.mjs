import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import vm from 'node:vm';

test('production build includes conflict model in both UI and worker',async()=>{
  await promisify(execFile)(process.execPath,[fileURLToPath(new URL('../build.mjs',import.meta.url))]);
  const html=await readFile(new URL('../dist/MICROGALAXY-0.8.html',import.meta.url),'utf8');
  const worker=JSON.parse(html.match(/<script id="worker-source" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  const app=html.match(/<\/script><script>([\s\S]*?)<\/script><\/body>/)[1];
  for(const source of [worker,app]){assert.match(source,/const Conflicts=/);assert.doesNotThrow(()=>new vm.Script(source));}
});
