import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';

// Load the actual animate handlers with a scripted Modal endpoint, so these
// regressions make no network calls.
function handlers(modal, env, turnstileStub, sparkResult = { motion: 'Steam curls upward while leaves tremble at the frame edges.', camera: 'drift' }, openConfigured = true) {
  const seen = [];
  const sparkCalls = [];
  const cache = new Map();
  const testEnv = { NODE_ENV: 'test', ANIMATE_URL: 'https://modal.example/animate', ANIMATE_KEY: 'test-key', ...env };
  const metaStub = {
    MetaError: class extends Error {
      constructor(status, message) { super(message); this.status = status; }
    },
    sparkJson: async (options) => {
      const attempt = sparkCalls.length;
      sparkCalls.push(options);
      const r = Array.isArray(sparkResult) ? sparkResult[attempt] : sparkResult;
      if (r instanceof Error) throw r;
      return r;
    },
    sparkOpenConfigured: () => openConfigured,
  };
  function load(file) {
    if (file === path.join(root, 'src/lib/server/meta.ts')) return metaStub;
    if (turnstileStub && file === path.join(root, 'src/lib/server/turnstile.ts')) return turnstileStub;
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
      exports: loadedModule.exports, module: loadedModule, require,
      Response, Error, URL,
      fetch: async (url, init) => {
        seen.push({ url, auth: init?.headers?.Authorization, body: init?.body ? JSON.parse(init.body) : undefined });
        return modal(url);
      },
      process: { env: testEnv },
      console: { error() {} },
    }, { filename: file });
    return loadedModule.exports;
  }
  return {
    start: load(path.join(root, 'src/app/api/animate/route.ts')).POST,
    status: load(path.join(root, 'src/app/api/animate/[callId]/route.ts')).GET,
    video: load(path.join(root, 'src/app/api/animate/[callId]/video/route.ts')).GET,
    seen,
    sparkCalls,
  };
}

const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const post = (body) => new Request('https://shoot.example/api/animate', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const get = (id) => [{}, { params: Promise.resolve({ callId: id }) }];
const body = {
  image: photo,
  product: { name: 'Calamansi Juice', label_text: 'HOMEMADE' },
  shot: { aspect: '4:5', scene: 'bottle on a sunny table', backdrop: '' },
};

test('starting an animation forwards the photo and prompt to Modal', async () => {
  const { start, seen, sparkCalls } = handlers(() => json({ call_id: 'fc-abc123' }), {});
  const res = await start(post(body));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { call_id: 'fc-abc123' });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://modal.example/animate/start');
  assert.equal(seen[0].auth, 'Bearer test-key');
  assert.equal(seen[0].body.aspect, '4:5');
  assert.equal(seen[0].body.duration_sec, 5);
  assert.ok(!seen[0].body.image_b64.startsWith('data:'), 'data URL prefix is stripped');
  assert.equal(sparkCalls.length, 1);
  assert.equal(sparkCalls[0].name, 'animate_motion');
  assert.deepEqual(JSON.parse(JSON.stringify(sparkCalls[0].images)), [photo]);
});

test('spark-directed motion and camera reach Modal', async () => {
  const { start, seen } = handlers(() => json({ call_id: 'fc-x' }), {});
  const res = await start(post(body));
  assert.equal(res.status, 200);
  assert.equal(seen[0].body.prompt, 'Steam curls upward while leaves tremble at the frame edges.');
  assert.equal(seen[0].body.camera, 'drift');
});

test('a failed direction falls back to the template prompt', async () => {
  const { start, seen } = handlers(() => json({ call_id: 'fc-x' }), {}, undefined, new Error('spark down'));
  const res = await start(post(body));
  assert.equal(res.status, 200);
  assert.match(seen[0].body.prompt, /Move the surroundings gently/);
  assert.match(seen[0].body.prompt, /Calamansi Juice/);
  assert.equal(seen[0].body.camera, 'slow_push_in');
});

test('direction tries open weights first, then 1.3', async () => {
  const { start, seen, sparkCalls } = handlers(() => json({ call_id: 'fc-x' }), {}, undefined,
    [new Error('open down'), { motion: 'Fallback motion here.', camera: 'static' }]);
  const res = await start(post(body));
  assert.equal(res.status, 200);
  assert.deepEqual(sparkCalls.map((c) => c.open), [true, false]);
  assert.equal(seen[0].body.prompt, 'Fallback motion here.');
  assert.equal(seen[0].body.camera, 'static');
});

test('direction skips open weights when unconfigured', async () => {
  const { start, sparkCalls } = handlers(() => json({ call_id: 'fc-x' }), {}, undefined,
    { motion: 'Direct motion.', camera: 'drift' }, false);
  const res = await start(post(body));
  assert.equal(res.status, 200);
  assert.deepEqual(sparkCalls.map((c) => c.open), [false]);
});

test('an unsupported aspect is rejected before any Modal call', async () => {
  const { start, seen } = handlers(() => json({ call_id: 'fc-x' }), {});
  const res = await start(post({ ...body, shot: { ...body.shot, aspect: '3:4' } }));
  assert.equal(res.status, 500);
  assert.equal(seen.length, 0);
});

test('a missing animation key reports the feature is not set up', async () => {
  const { start, seen } = handlers(() => json({ call_id: 'fc-x' }), { ANIMATE_KEY: '' });
  const res = await start(post(body));
  assert.equal(res.status, 501);
  assert.match((await res.json()).error, /not set up/);
  assert.equal(seen.length, 0);
});

test('an invalid call id never reaches Modal', async () => {
  const { status, seen } = handlers(() => json({ status: 'running' }), {});
  const res = await status(...get('../../etc'));
  assert.equal(res.status, 400);
  assert.equal(seen.length, 0);
});

test('a finished video is proxied as an mp4 download', async () => {
  const bytes = new Uint8Array([0, 0, 0, 1]);
  const { video } = handlers(() => ({
    ok: true, status: 200, arrayBuffer: async () => bytes.buffer,
  }), {});
  const res = await video(...get('fc-abc123'));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'video/mp4');
  assert.match(res.headers.get('Content-Disposition'), /attachment/);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), bytes);
});

test('a still-running video reports 425 instead of failing', async () => {
  const { video } = handlers(() => ({ ok: false, status: 425 }), {});
  const res = await video(...get('fc-abc123'));
  assert.equal(res.status, 425);
});

test('the start token is verified as an animate action and refreshes the session', async () => {
  const checked = [];
  const { start } = handlers(() => json({ call_id: 'fc-x' }), {}, {
    verifyShootSession: async () => {},
    verifyTurnstile: async (_req, token, action) => {
      checked.push([token, action]);
      return 'hubog_shoot_verified=new; Path=/api';
    },
  });
  const res = await start(post({ ...body, turnstileToken: 'fresh-token' }));
  assert.equal(res.status, 200);
  assert.deepEqual(checked, [['fresh-token', 'animate']]);
  assert.equal(res.headers.get('Set-Cookie'), 'hubog_shoot_verified=new; Path=/api');
});
