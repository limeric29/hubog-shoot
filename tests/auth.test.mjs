import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { TextEncoder } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));

// Load the real auth, db, and route modules with stubbed model errors and
// Turnstile. The db falls back to its in-memory twin (NODE_ENV=test), so each
// ctx() gets a fresh isolated store and no test touches D1 or the network.
function ctx() {
  const cache = new Map();
  const metaStub = {
    MetaError: class extends Error {
      constructor(status, message, code) {
        super(message);
        this.status = status;
        this.code = code;
      }
    },
  };
  const turnstileStub = { verifyTurnstile: async () => 'stub-session', verifyShootSession: async () => {} };
  function load(file) {
    if (file === path.join(root, 'src/lib/server/meta.ts')) return metaStub;
    if (file === path.join(root, 'src/lib/server/turnstile.ts')) return turnstileStub;
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
      Response, Request, Error, URL, Buffer, TextEncoder,
      crypto: webcrypto, setTimeout,
      process: { env: { NODE_ENV: 'test' } },
      console: { error() {} },
    }, { filename: file });
    return loadedModule.exports;
  }
  return {
    auth: load(path.join(root, 'src/lib/server/auth.ts')),
    register: load(path.join(root, 'src/app/api/auth/register/route.ts')).POST,
    login: load(path.join(root, 'src/app/api/auth/login/route.ts')).POST,
    me: load(path.join(root, 'src/app/api/auth/me/route.ts')).GET,
    logout: load(path.join(root, 'src/app/api/auth/logout/route.ts')).POST,
  };
}

const post = (url, body, headers = {}) => new Request(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});
const get = (url, headers = {}) => new Request(url, { headers });
const cookieOf = (res) => {
  const set = res.headers.get('set-cookie') ?? '';
  const pair = set.split(';')[0];
  assert.match(pair, /^hubog_auth=[A-Za-z0-9]+$/);
  return pair;
};

test('register creates a session and returns a full daily quota', async () => {
  const t = ctx();
  const res = await t.register(post('https://shoot.example/api/auth/register', { email: 'ana@example.com', password: 'sampaguita-1' }, { 'cf-connecting-ip': '203.0.113.7' }));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.email, 'ana@example.com');
  assert.deepEqual(json.quota, { registered: true, shootsLeft: 3, animsLeft: 3, shootsLimit: 3, animsLimit: 3, window: 'day' });
  const cookie = cookieOf(res);
  const me = await t.me(get('https://shoot.example/api/auth/me', { cookie }));
  assert.equal((await me.json()).email, 'ana@example.com');
});

test('register rejects bad emails, short passwords, throwaways, and duplicates', async () => {
  const t = ctx();
  const url = 'https://shoot.example/api/auth/register';
  const attempt = (body) => t.register(post(url, body, { 'cf-connecting-ip': '203.0.113.8' }));
  assert.equal((await attempt({ email: 'not-an-email', password: 'sampaguita-1' })).status, 400);
  assert.equal((await attempt({ email: 'ana@example.com', password: 'short' })).status, 400);
  assert.equal((await attempt({ email: 'ana@mailinator.com', password: 'sampaguita-1' })).status, 400);
  assert.equal((await attempt({ email: 'ana@example.com', password: 'sampaguita-1' })).status, 200);
  const dup = await attempt({ email: 'ANA@example.com', password: 'sampaguita-1' });
  assert.equal(dup.status, 409);
  assert.match((await dup.json()).error, /already registered/);
});

test('login accepts the password and rejects a wrong one', async () => {
  const t = ctx();
  await t.register(post('https://shoot.example/api/auth/register', { email: 'ben@example.com', password: 'sampaguita-1' }));
  const ok = await t.login(post('https://shoot.example/api/auth/login', { email: 'ben@example.com', password: 'sampaguita-1' }));
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).email, 'ben@example.com');
  cookieOf(ok);
  const bad = await t.login(post('https://shoot.example/api/auth/login', { email: 'ben@example.com', password: 'wrong-password' }));
  assert.equal(bad.status, 401);
  const missing = await t.login(post('https://shoot.example/api/auth/login', { email: 'nobody@example.com', password: 'sampaguita-1' }));
  assert.equal(missing.status, 401);
});

test('me reports the trial quota anonymously', async () => {
  const t = ctx();
  const res = await t.me(get('https://shoot.example/api/auth/me', { 'cf-connecting-ip': '203.0.113.9' }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    email: null,
    quota: { registered: false, shootsLeft: 3, animsLeft: 3, shootsLimit: 3, animsLimit: 3, window: 'trial' },
  });
});

test('logout clears the session cookie and the session', async () => {
  const t = ctx();
  const reg = await t.register(post('https://shoot.example/api/auth/register', { email: 'cy@example.com', password: 'sampaguita-1' }));
  const cookie = cookieOf(reg);
  const out = await t.logout(post('https://shoot.example/api/auth/logout', {}, { cookie }));
  assert.equal(out.status, 200);
  assert.match(out.headers.get('set-cookie') ?? '', /Max-Age=0/);
  const me = await t.me(get('https://shoot.example/api/auth/me', { cookie }));
  assert.equal((await me.json()).email, null);
});

test('anonymous quota allows three, then asks for registration', async () => {
  const t = ctx();
  const ip = '203.0.113.10';
  await t.auth.consumeShoot(null, ip);
  await t.auth.consumeShoot(null, ip);
  await t.auth.consumeShoot(null, ip);
  await assert.rejects(() => t.auth.consumeShoot(null, ip), (err) => {
    assert.equal(err.code, 'NEED_REGISTER');
    assert.match(err.message, /used up/);
    return true;
  });
  // Shoots and animations are separate counters.
  await t.auth.consumeAnim(null, ip);
  const quota = await t.auth.quotaFor(null, ip);
  // JSON-normalized: the quota object comes from the vm realm.
  assert.deepEqual(JSON.parse(JSON.stringify(quota)), { registered: false, shootsLeft: 0, animsLeft: 2, shootsLimit: 3, animsLimit: 3, window: 'trial' });
});

test('registered quota is daily and separate from the anonymous trial', async () => {
  const t = ctx();
  const ip = '203.0.113.11';
  await t.auth.consumeShoot(null, ip);
  const user = await t.auth.register('dee@example.com', 'sampaguita-1', ip);
  await t.auth.consumeShoot(user, ip);
  await t.auth.consumeShoot(user, ip);
  await t.auth.consumeShoot(user, ip);
  await assert.rejects(() => t.auth.consumeShoot(user, ip), (err) => {
    assert.equal(err.code, 'DAILY_LIMIT');
    return true;
  });
  const quota = await t.auth.quotaFor(user, ip);
  assert.equal(quota.shootsLeft, 0);
  assert.equal(quota.animsLeft, 3);
  // The trial counter is untouched by registered use.
  assert.equal((await t.auth.quotaFor(null, ip)).shootsLeft, 2);
});

test('registrations are capped per network per day', async () => {
  const t = ctx();
  const ip = '203.0.113.12';
  await t.auth.register('u1@example.com', 'sampaguita-1', ip);
  await t.auth.register('u2@example.com', 'sampaguita-1', ip);
  await t.auth.register('u3@example.com', 'sampaguita-1', ip);
  await assert.rejects(() => t.auth.register('u4@example.com', 'sampaguita-1', ip), /Too many accounts/);
});

test('the global animation cap bounds GPU spend', async () => {
  const t = ctx();
  for (let i = 0; i < 100; i++) await t.auth.consumeGlobalAnims();
  await assert.rejects(() => t.auth.consumeGlobalAnims(), /fully booked/);
});
