import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as policy from '../lib/retention-policy.mjs';
import * as registry from '../lib/world-models.mjs';
let last:Record<string,unknown>={};
export function retentionTestModule(modules:Record<string,unknown>){
  if(modules['cloudflare:workers']){
    const source=readFileSync(new URL('../lib/retention-cloud.ts',import.meta.url),'utf8');
    const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
    const out:Record<string,unknown>={};new Function('require','exports',outputText)((name:string)=>{if(name==='./world-models.mjs')return registry;if(name==='./retention-policy.mjs')return policy;if(name==='cloudflare:workers')return modules[name];throw new Error(name);},out);last=out;
  }
  return last;
}
