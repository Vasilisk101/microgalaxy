import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const css=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
function luminance(hex){const c=hex.match(/[0-9a-f]{2}/gi).map(x=>parseInt(x,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];}
function ratio(a,b){const [hi,lo]=[luminance(a),luminance(b)].sort((x,y)=>y-x);return (hi+.05)/(lo+.05);}
test('dark pane and light economy card hover and focus retain readable contrast',()=>{
  assert.match(css,/dialog button:not\(\.primary\):hover,dialog button:not\(\.primary\):focus-visible\{background:#293a37;color:#f2f5f2\}/);
  assert.match(css,/\.page-content \.economy-card button:not\(\.primary\):focus-visible\{background:#d8dfdb;color:#1b2523\}/);
  assert.ok(ratio('293a37','f2f5f2')>=4.5);assert.ok(ratio('d8dfdb','1b2523')>=4.5);
});
