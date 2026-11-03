import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));

// Load the real client zip helpers with a scripted fetch.
function helpers(fetchImpl) {
  const file = path.join(root, 'src/lib/client/zip.ts');
  const loadedModule = { exports: {} };
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  runInNewContext(code, {
    exports: loadedModule.exports, module: loadedModule,
    TextEncoder, Blob, Uint8Array, atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    fetch: fetchImpl,
  }, { filename: file });
  return loadedModule.exports;
}

/** File names from a store-only zip's central directory. */
async function zipNames(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const endOffset = bytes.length - 22;
  assert.equal(view.getUint32(endOffset, true), 0x06054b50);
  const count = view.getUint16(endOffset + 10, true);
  let offset = view.getUint32(endOffset + 16, true);
  const names = [];
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(offset, true), 0x02014b50);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    names.push(Buffer.from(bytes.subarray(offset + 46, offset + 46 + nameLength)).toString('utf8'));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

test('urlBytes decodes data URLs byte for byte', async () => {
  const { urlBytes } = helpers(() => { throw new Error('must not fetch'); });
  const data = await urlBytes('data:video/mp4;base64,AAECAw==');
  assert.deepEqual([...data], [0, 1, 2, 3]);
});

test('urlBytes fetches remote URLs and nulls failures', async () => {
  const { urlBytes } = helpers(async (url) => (
    url === 'https://shoot.example/v.mp4'
      ? { ok: true, arrayBuffer: async () => new Uint8Array([9, 8]).buffer }
      : { ok: false }
  ));
  assert.deepEqual([...(await urlBytes('https://shoot.example/v.mp4'))], [9, 8]);
  assert.equal(await urlBytes('https://shoot.example/missing.mp4'), null);
});

test('zip stores images, videos and listing under platform names', async () => {
  const { zip } = helpers(() => { throw new Error('must not fetch'); });
  const blob = zip([
    { name: '1-shopee-main.jpg', data: new Uint8Array([1, 2]) },
    { name: '2-tiktok-scene.mp4', data: new Uint8Array([3, 4, 5]) },
    { name: 'listing.txt', data: new TextEncoder().encode('hello') },
  ]);
  assert.deepEqual(await zipNames(blob), ['1-shopee-main.jpg', '2-tiktok-scene.mp4', 'listing.txt']);
});
