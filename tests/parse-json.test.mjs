import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));

// Load the real model client with network-capable imports stubbed, so these
// regressions make no network calls.
function loadMeta() {
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
  runInNewContext(code, {
    exports: loadedModule.exports, module: loadedModule, require,
    Response, Error,
    fetch: () => { throw new Error('no network in tests'); },
    process: { env: { NODE_ENV: 'test' } },
    console: { error() {}, log() {} },
  }, { filename: file });
  return loadedModule.exports;
}

const { parseJsonLoose } = loadMeta();
// Results come from another VM context, so compare plain JSON values.
const plain = (value) => JSON.parse(JSON.stringify(value));

test('parses a bare JSON object', () => {
  assert.deepEqual(plain(parseJsonLoose('{"a":1}')), { ok: true, value: { a: 1 } });
});

test('parses a fenced JSON block', () => {
  assert.deepEqual(plain(parseJsonLoose('```json\n{"a":1}\n```')), { ok: true, value: { a: 1 } });
});

test('parses JSON wrapped in reasoning prose', () => {
  assert.deepEqual(
    plain(parseJsonLoose('Here is the shot plan:\n{"a":1}\nLet me know if you want changes.')),
    { ok: true, value: { a: 1 } },
  );
});

test('reports unparsable output instead of throwing', () => {
  assert.deepEqual(plain(parseJsonLoose('no braces here')), { ok: false });
});
