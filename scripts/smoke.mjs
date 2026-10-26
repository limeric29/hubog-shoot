// Checks that the Meta Model API key works for every model Hubog Shoot needs.
// Costs about $0.02 per run: one Muse Image generation ($0.01), one SAM 3.1
// segmentation ($0.0025) and a few hundred Muse Spark tokens.
//
//   MODEL_API_KEY=... npm run smoke
//
// Writes the generated image to .smoke/ (gitignored).
import { mkdir, writeFile } from 'node:fs/promises';
import OpenAI from 'openai';
import { parseImageStream, recordsOfKind } from '@meta-sam/parser';

const apiKey = process.env.MODEL_API_KEY;
if (!apiKey) {
  console.error('MODEL_API_KEY is not set (put it in .env.local and run with --env-file, or export it)');
  process.exit(1);
}

const client = new OpenAI({ baseURL: 'https://api.meta.ai/v1', apiKey });
const SPARK = process.env.MUSE_SPARK_MODEL ?? 'muse-spark-1.3';
// Standard-mode list prices, USD: https://dev.meta.ai/docs/pricing-rate-limits
const PRICE = { sparkIn: 1.25 / 1e6, sparkOut: 4.25 / 1e6, image: 0.01, sam: 2.5 / 1000 };
let spent = 0;

async function step(name, fn) {
  const t = Date.now();
  try {
    const note = await fn();
    console.log(`ok    ${name} (${Date.now() - t} ms)${note ? `: ${note}` : ''}`);
    return true;
  } catch (err) {
    console.log(`FAIL  ${name}: ${err?.status ?? ''} ${err?.message ?? err}`);
    return false;
  }
}

const results = [];

results.push(await step('models enabled for this team', async () => {
  const list = await client.models.list();
  const ids = list.data.map((m) => m.id);
  const missing = [SPARK, 'muse-image-1.0', 'sam-3.1', 'muse-voice-transcribe-1.0'].filter((id) => !ids.includes(id));
  if (missing.length) throw new Error(`missing: ${missing.join(', ')}`);
  return `${ids.length} models`;
}));

results.push(await step(`${SPARK} replies in Taglish`, async () => {
  const res = await client.chat.completions.create({
    model: SPARK,
    messages: [
      { role: 'developer', content: 'Reply in one short sentence, in the language the user writes in.' },
      { role: 'user', content: 'Nagbebenta ako ng homemade calamansi juice sa Davao. Anong magandang product photo?' },
    ],
    max_completion_tokens: 400,
  });
  const u = res.usage ?? {};
  spent += (u.prompt_tokens ?? 0) * PRICE.sparkIn + (u.completion_tokens ?? 0) * PRICE.sparkOut;
  return JSON.stringify(res.choices[0]?.message?.content ?? '');
}));

let imageDataUrl;
results.push(await step('muse-image-1.0 generates a product shot', async () => {
  const res = await client.images.generate({
    model: 'muse-image-1.0',
    prompt: 'Product photo: a glass bottle of homemade calamansi juice on a light wooden table, soft daylight, plain background',
    n: 1,
    size: '1024x1024',
    output_format: 'png',
  });
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error('no b64_json in the response');
  spent += PRICE.image;
  await mkdir('.smoke', { recursive: true });
  await writeFile('.smoke/muse-image.png', Buffer.from(b64, 'base64'));
  imageDataUrl = `data:image/png;base64,${b64}`;
  return 'saved .smoke/muse-image.png';
}));

if (imageDataUrl) {
  results.push(await step('sam-3.1 finds the bottle', async () => {
    const events = await client.responses.create({
      model: 'sam-3.1',
      input: [{
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: 'bottle' },
          { type: 'input_image', image_url: imageDataUrl },
        ],
      }],
      stream: true,
    });
    const result = await parseImageStream(events).finalResult;
    const boxes = [...recordsOfKind(result.records, 'box')];
    spent += PRICE.sam;
    if (!boxes.length) throw new Error('no matches');
    const b = boxes[0];
    return `${boxes.length} match(es), first box ${b.left},${b.top} → ${b.right},${b.bottom}`;
  }));
}

console.log(`\nestimated spend this run: $${spent.toFixed(4)}`);
process.exit(results.every(Boolean) ? 0 : 1);
