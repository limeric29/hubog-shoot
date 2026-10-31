import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const product = { name: 'Firefly rechargeable fan', label_text: 'FIREFLY' };
const verdict = { pass: true, problems: [], seller_note: 'Your product matches.' };

// Load the actual handlers, validators, and prompts without a Next server. Only
// the paid model client is replaced, so these regressions make no network calls.
function handlers() {
  const calls = [];
  const cache = new Map();
  const metaFile = path.join(root, 'src/lib/server/meta.ts');
  const meta = {
    MetaError: class extends Error {
      constructor(status, message) { super(message); this.status = status; }
    },
    sparkJson: async (options) => {
      calls.push(options);
      if (options.name === 'verdict') return verdict;
      return {
        question: '', product: {}, listing: {},
        shots: [{ id: 'main', kind: 'main', title: '', platform: 'shopee', aspect: '1:1', scene: '', backdrop: '', headline: '', caption: '' }],
      };
    },
  };
  function load(file) {
    if (file === metaFile) return meta;
    if (cache.has(file)) return cache.get(file).exports;
    const loadedModule = { exports: {} };
    cache.set(file, loadedModule);
    const code = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const require = (specifier) => {
      const target = specifier.startsWith('@/')
        ? path.join(root, 'src', specifier.slice(2))
        : path.resolve(path.dirname(file), specifier);
      return load(target + '.ts');
    };
    runInNewContext(code, {
      exports: loadedModule.exports, module: loadedModule, require, Response, Error,
      process: { env: { NODE_ENV: 'test' } },
      console: { error() {} },
    }, { filename: file });
    return loadedModule.exports;
  }
  return {
    plan: load(path.join(root, 'src/app/api/plan/route.ts')).POST,
    check: load(path.join(root, 'src/app/api/check/route.ts')).POST,
    calls,
  };
}

const request = (body) => new Request('https://shoot.example/api/check', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

for (const length of [201, 1500, 2000]) {
  test(`a ${length}-character brief accepted by planning also reaches the photo check`, async () => {
    const { plan, check, calls } = handlers();
    const brief = 'Rechargeable fan with night light. '.repeat(70).slice(0, length);
    assert.equal(brief.length, length);
    assert.equal((await plan(request({ photo, brief }))).status, 200);
    const response = await check(request({ photo, image: photo, product, language: brief }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), verdict);
    assert.equal(calls.length, 2);
    assert.deepEqual(Array.from(calls[1].images), [photo, photo]);
    assert.ok(calls[1].text.includes(brief.slice(0, 200)));
    assert.ok(!calls[1].text.includes(brief.slice(0, 201)), 'Language hint stays bounded in the prompt.');
  });
}

test('empty language falls back to Taglish', async () => {
  const { check, calls } = handlers();
  assert.equal((await check(request({ photo, image: photo, product, language: '' }))).status, 200);
  assert.ok(calls[0].text.includes('Taglish'));
});

for (const language of ['x'.repeat(2001), { locale: 'en' }]) {
  test(`rejects ${typeof language === 'string' ? 'oversized' : 'non-text'} language before calling a paid model`, async () => {
    const { check, calls } = handlers();
    const response = await check(request({ photo, image: photo, product, language }));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /language/);
    assert.equal(calls.length, 0);
  });
}
