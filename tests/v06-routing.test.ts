import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function load(path: string) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  const exports: Record<string, unknown> = {};
  new Function('require', 'exports', outputText)((id: string) => {
    if (id.includes('simulator-v05/')) return { default: 'old-five' };
    if (id.includes('simulator-v06/')) return { default: 'new-six' };
    if (id.includes('simulator-v07/')) return { default: 'new-seven' };
    if (id.includes('simulator-v08/')) return { default: 'new-eight' };
    if (id.includes('simulator-v1/')) return { default: 'one' };
    throw new Error('Unexpected import ' + id);
  }, exports);
  return exports as { GET(request: Request): Response };
}

test('root legacy links retain v05, canonical routes select their model', async () => {
  const root = load('../app/route.ts'), old = load('../app/v05/route.ts'), previous = load('../app/v06/route.ts'), seven = load('../app/v07/route.ts'), current = load('../app/v08/route.ts');
  const request = (query = '') => new Request('https://example.test/' + query);
  const legacy = root.GET(request('?world=00000000-0000-4000-8000-000000000001&source=cloud'));
  assert.equal(await legacy.text(), 'old-five');
  assert.equal(legacy.headers.get('X-Microgalaxy-Version'), '0.5.0');
  assert.equal(await root.GET(request()).text(), 'one');
  assert.equal(await root.GET(request('?source=cloud')).text(), 'one');
  assert.equal(await old.GET(request()).text(), 'old-five');
  assert.equal(await previous.GET(request()).text(), 'new-six');
  assert.equal(await seven.GET(request()).text(), 'new-seven');
  assert.equal(await load('../app/v1/route.ts').GET(request()).text(), 'one');
  assert.equal(await current.GET(request()).text(), 'new-eight');
});
