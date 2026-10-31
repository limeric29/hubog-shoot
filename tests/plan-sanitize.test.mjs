import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';

// Load the real plan/check routes with a scripted model client, so these
// regressions make no network calls.
function handlers(sparkImpl) {
  const cache = new Map();
  const metaFile = path.join(root, 'src/lib/server/meta.ts');
  const meta = {
    MetaError: class extends Error {
      constructor(status, message) { super(message); this.status = status; }
    },
    sparkJson: sparkImpl,
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
  };
}

const request = (body) => new Request('https://shoot.example/api/test', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
// VM-context values fail strict deep comparison, so compare plain JSON.
const plain = (value) => JSON.parse(JSON.stringify(value));

test('an overlong plan is clamped to what shoot and segment accept', async () => {
  const { plan } = handlers(async () => ({
    question: '',
    product: { name: 'N'.repeat(500), category: 'C', colors: ['yellow', 7], label_text: 'L'.repeat(500), sam_phrase: 'S'.repeat(200) },
    shots: [{ id: '', kind: 'main', title: 'T', platform: 'shopee', aspect: 'bogus', scene: 'S'.repeat(2000), backdrop: 'B', headline: 'H'.repeat(100), caption: 'C' }],
    listing: { title: 'T', description: 'D', hashtags: [] },
  }));
  const response = await plan(request({ photo, brief: 'Juice.' }));
  assert.equal(response.status, 200);
  const body = plain(await response.json());
  assert.equal(body.product.name.length, 200);
  assert.equal(body.product.sam_phrase.length, 120);
  assert.deepEqual(body.product.colors, ['yellow']);
  assert.equal(body.shots[0].aspect, '1:1');
  assert.equal(body.shots[0].scene.length, 1200);
  assert.equal(body.shots[0].headline.length, 80);
  assert.ok(body.shots[0].id.length > 0);
});

test('a missing sam_phrase falls back to the product name', async () => {
  const { plan } = handlers(async () => ({
    question: '',
    product: { name: 'Calamansi Juice', category: '', colors: [], label_text: '' },
    shots: [{ id: 'main', kind: 'main', title: '', platform: 'shopee', aspect: '1:1', scene: '', backdrop: '', headline: '', caption: '' }],
    listing: { title: '', description: '', hashtags: [] },
  }));
  const response = await plan(request({ photo, brief: 'Juice.' }));
  assert.equal(response.status, 200);
  assert.equal(plain(await response.json()).product.sam_phrase, 'Calamansi Juice');
});

test('a plan without shots fails fast with a retryable error', async () => {
  const { plan } = handlers(async () => ({ question: '', product: {}, shots: [], listing: {} }));
  assert.equal(await plan(request({ photo, brief: 'Juice.' })).then((r) => r.status), 502);
});

test('a loose verdict is coerced to safe types and lengths', async () => {
  const { check } = handlers(async () => ({ pass: 'yes', problems: ['P'.repeat(500), 42], seller_note: 7 }));
  const response = await check(request({
    photo, image: photo, product: { name: 'Fan', label_text: 'F' }, language: 'Fan.',
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(plain(await response.json()), { pass: false, problems: ['P'.repeat(300)], seller_note: '' });
});
