import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));

// Load the real heygen module with a scripted fetch. No network calls.
function load({ tts, wav, env }) {
  const seen = [];
  const file = path.join(root, 'src/lib/server/heygen.ts');
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const loadedModule = { exports: {} };
  runInNewContext(code, {
    exports: loadedModule.exports, module: loadedModule,
    require: () => { throw new Error('no imports expected'); },
    fetch: async (url, init) => {
      seen.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
      if (String(url).includes('/v3/models/audio/tts')) return tts;
      return wav;
    },
    Buffer, AbortSignal, Error, URL,
    process: { env: { HEYGEN_API_KEY: 'test-key', HEYGEN_VOICE_ID: 'voice-1', ...env } },
    console: { error() {} },
  }, { filename: file });
  return { speak: loadedModule.exports.speak, seen };
}

const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const bytes = (n) => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(n) });

test('speak returns base64 audio on success', async () => {
  const { speak, seen } = load({
    tts: json({ data: { audio_url: 'https://cdn.example/w.wav', duration: 2.5 } }),
    wav: bytes(1000),
    env: {},
  });
  const voice = await speak('Freshly Squeezed Daily');
  assert.ok(voice);
  assert.equal(voice.duration, 2.5);
  assert.equal(Buffer.from(voice.b64, 'base64').length, 1000);
  assert.equal(seen[0].url, 'https://api.heygen.com/v3/models/audio/tts');
  assert.deepEqual(seen[0].body, { text: 'Freshly Squeezed Daily', voice_id: 'voice-1', model: 'heygen-voice-1-turbo-free', language: 'en' });
  assert.equal(seen[1].url, 'https://cdn.example/w.wav');
});

test('speak returns null when unconfigured, rate-limited, or broken', async () => {
  const fail = json({ error: { code: 'rate_limit_exceeded' } }, 429);
  assert.equal(await load({ tts: fail, wav: bytes(10), env: { HEYGEN_API_KEY: '' } }).speak('hi'), null);
  assert.equal(await load({ tts: fail, wav: bytes(10), env: {} }).speak('hi'), null);
  assert.equal(await load({ tts: json({ data: {} }), wav: bytes(10), env: {} }).speak('hi'), null);
  assert.equal(await load({ tts: json({ data: { audio_url: 'https://cdn.example/w.wav' } }), wav: bytes(0), env: {} }).speak('hi'), null);
  assert.equal(await load({ tts: json({ data: { audio_url: 'https://cdn.example/w.wav' } }), wav: bytes(10), env: {} }).speak('   '), null);
});
