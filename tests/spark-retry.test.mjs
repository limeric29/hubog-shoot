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
function loadMeta(responses) {
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
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  runInNewContext(code, {
    exports: loadedModule.exports, module: loadedModule, require,
    Response, Error,
    fetch: async () => {
      calls += 1;
      const next = responses[Math.min(calls - 1, responses.length - 1)];
      return ok(next);
    },
    process: { env: { NODE_ENV: 'test', MODEL_API_KEY: 'test-key' } },
    console: { error() {}, log() {} },
  }, { filename: file });
  return { api: loadedModule.exports, calls: () => calls };
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
