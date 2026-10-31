import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));

// Load the real model client with a scripted fetch stub, so these regressions
// make no network calls.
function loadMeta(responses, env = {}) {
  const file = path.join(root, 'src/lib/server/meta.ts');
  const loadedModule = { exports: {} };
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const require = (specifier) => {
    if (specifier === 'openai') return { default: class {} };
    if (specifier === '@meta-sam/parser') return {};
    if (specifier === '../types') return {};
    throw new Error(`unexpected require ${specifier}`);
  };
  let calls = 0;
  const urls = [];
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  runInNewContext(code, {
    exports: loadedModule.exports, module: loadedModule, require,
    Response, Error,
    fetch: async (url) => {
      calls += 1;
      urls.push(url);
      const next = responses[Math.min(calls - 1, responses.length - 1)];
      return ok(next);
    },
    process: { env: { NODE_ENV: 'test', MODEL_API_KEY: 'test-key', ...env } },
    console: { error() {}, log() {} },
  }, { filename: file });
  return { api: loadedModule.exports, calls: () => calls, urls };
}

// Results come from another VM context, so compare plain JSON values.
const plain = (value) => JSON.parse(JSON.stringify(value));
const reply = (content) => ({ choices: [{ message: { content } }], usage: {} });
const schema = { type: 'object', properties: { a: { type: 'number' } } };

test('an empty first reply is retried once', async () => {
  const { api, calls } = loadMeta([reply(''), reply('{"a":1}')]);
  const out = await api.sparkJson({ system: 's', text: 't', name: 'n', schema });
  assert.deepEqual(plain(out), { a: 1 });
  assert.equal(calls(), 2);
});

test('two empty replies in a row fail the call', async () => {
  const { api, calls } = loadMeta([reply(''), reply('')]);
  await assert.rejects(
    api.sparkJson({ system: 's', text: 't', name: 'n', schema }),
    /returned no content/,
  );
  assert.equal(calls(), 2);
});

test('open calls hit the open endpoint, plain calls stay on Meta', async () => {
  const openEnv = { MUSE_SPARK_OPEN_BASE_URL: 'https://open.example/v1', MUSE_SPARK_API_KEY: 'open-key' };
  const open = loadMeta([reply('{"a":1}')], openEnv);
  assert.equal(open.api.sparkOpenConfigured(), true);
  await open.api.sparkJson({ system: 's', text: 't', name: 'n', schema, open: true });
  assert.equal(open.urls.length, 1);
  assert.ok(open.urls[0].startsWith('https://open.example/v1/'), `routed open, got ${open.urls[0]}`);
  const plain = loadMeta([reply('{"a":1}')], openEnv);
  await plain.api.sparkJson({ system: 's', text: 't', name: 'n', schema });
  assert.ok(plain.urls[0].startsWith('https://api.meta.ai/v1/'), `stayed on Meta, got ${plain.urls[0]}`);
  const unset = loadMeta([reply('{"a":1}')]);
  assert.equal(unset.api.sparkOpenConfigured(), false);
  await unset.api.sparkJson({ system: 's', text: 't', name: 'n', schema, open: true });
  assert.ok(unset.urls[0].startsWith('https://api.meta.ai/v1/'), `fell back to Meta, got ${unset.urls[0]}`);
});
