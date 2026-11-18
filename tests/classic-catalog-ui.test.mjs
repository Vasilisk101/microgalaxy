import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../app/simulation-app.tsx',import.meta.url),'utf8');
const start=source.indexOf('const boot=async()=>{'),end=source.indexOf('void boot();',start);
const boot=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const id='00000000-0000-4000-8000-000000000101';
function harness(query=''){
  const log=[],record={world:{id,year:4},revision:1,syncedYear:4};let installed,issue;
  const run=new Function('getLocalWorlds','getLocalWorld','window','installWorld','setBootIssue','preference','worldApi','cloudReady','notify','let active=true;'+boot+';return boot();');
  return {log,get installed(){return installed;},get issue(){return issue;},run:()=>run(async()=>[{id,summary:null}],async requested=>(log.push('lease '+requested),record),{location:{search:query}},r=>{log.push('install');installed=r;},error=>{issue=error;},()=>id,async()=>{log.push('network');return {ok:false};},{current:false},()=>{})};
}
test('classic selected local world is leased before cloud wait and installation',async()=>{
  const h=harness();await h.run();assert.deepEqual(h.log,['lease '+id,'network','install']);assert.equal(h.installed.world.id,id);
});
test('classic explicit local link loads only that protected world',async()=>{
  const h=harness('?world='+id+'&source=local');await h.run();assert.deepEqual(h.log,['lease '+id,'install']);assert.equal(h.issue,undefined);
});
test('classic archive renders unknown metadata without invented population or year',()=>{
  assert.match(source,/metadataPending\?<span>Метаданные ещё не проверены<\/span>/);
  assert.match(source,/metadataPending\?'Открыть':`Год/);
  assert.match(source,/await indexLocalWorldMetadata\(2\)/);
});
