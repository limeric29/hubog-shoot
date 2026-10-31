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

const MODELS = {
  spark: process.env.MUSE_SPARK_MODEL ?? 'muse-spark-1.3',
  image: process.env.MUSE_IMAGE_MODEL ?? 'muse-image-1.0',
  sam: process.env.SAM_MODEL ?? 'sam-3.1',
  voice: process.env.MUSE_VOICE_TRANSCRIBE_MODEL ?? 'muse-voice-transcribe-1.0',
};
const client = new OpenAI({ baseURL: (process.env.META_API_BASE_URL ?? 'https://api.meta.ai/v1').replace(/\/+$/, ''), apiKey });
// Standard-mode list prices, USD: https://dev.meta.ai/docs/pricing-rate-limits
const configuredPrice = (key, fallback) => {
  const value = Number(process.env[key] ?? fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};
const PRICE = {
  sparkIn: configuredPrice('MUSE_SPARK_INPUT_USD_PER_MILLION', 1.25) / 1e6,
  sparkOut: configuredPrice('MUSE_SPARK_OUTPUT_USD_PER_MILLION', 4.25) / 1e6,
  image: configuredPrice('MUSE_IMAGE_USD_PER_IMAGE', 0.01),
  sam: configuredPrice('SAM_USD_PER_IMAGE', 0.0025),
};
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
  const missing = Object.values(MODELS).filter((id) => !ids.includes(id));
  if (missing.length) throw new Error(`missing: ${missing.join(', ')}`);
  return `${ids.length} models`;
}));

results.push(await step(`${MODELS.spark} replies in Taglish`, async () => {
  const res = await client.chat.completions.create({
    model: MODELS.spark,
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
results.push(await step(`${MODELS.image} generates a product shot`, async () => {
  const res = await client.images.generate({
    model: MODELS.image,
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
  results.push(await step(`${MODELS.sam} finds the bottle`, async () => {
    const events = await client.responses.create({
      model: MODELS.sam,
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
