// Server-side client for the Meta Model API. Never import this from client code:
// it reads MODEL_API_KEY.
import OpenAI from 'openai';
import { buildObjectPrompt, decodeMaskToRaster, parseImageStream, recordsOfKind } from '@meta-sam/parser';
import type { Aspect, Mask } from '../types';

const BASE_URL = 'https://api.meta.ai/v1';

// Standard-mode list prices, USD: https://dev.meta.ai/docs/pricing-rate-limits
const PRICE = { sparkIn: 1.25 / 1e6, sparkOut: 4.25 / 1e6, image: 0.01, sam: 2.5 / 1000, asrHour: 0.18 };

// Muse Image accepts only 1:1, 2:3 and 3:2 sizes (anything else is a 400), so 4:5 and 9:16 shots are
// generated at 2:3 and cropped to shape in the browser.
const SIZE: Record<Aspect, string> = { '1:1': '1024x1024', '4:5': '1024x1536', '9:16': '1024x1536' };

export class MetaError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// Spend journal. One JSON line per call on stdout, plus a running total for this instance.
// The total resets when the instance restarts, so it is a brake, not the ledger: quote spend from the lines.
const spent = { usd: 0, calls: 0 };

export function spendSoFar() {
  return { usd: Number(spent.usd.toFixed(4)), calls: spent.calls };
}

function book(model: string, usd: number, units: string) {
  spent.usd += usd;
  spent.calls += 1;
  console.log(JSON.stringify({ t: 'spend', model, units, usd: Number(usd.toFixed(5)), total: Number(spent.usd.toFixed(4)) }));
}

/** Throws when the kill switch is on or the daily cap is used up. Call before every paid request. */
export function guard() {
  if (process.env.HUBOG_KILL === '1') throw new MetaError(503, 'Hubog Shoot is paused right now.');
  const cap = Number(process.env.SPEND_CAP_USD ?? '');
  if (cap > 0 && spent.usd >= cap) throw new MetaError(503, 'The demo has reached its spending limit for now.');
}

function apiKey() {
  const key = process.env.MODEL_API_KEY;
  if (!key) throw new MetaError(500, 'MODEL_API_KEY is not set.');
  return key;
}

function client() {
  return new OpenAI({ baseURL: BASE_URL, apiKey: apiKey(), maxRetries: 2 });
}

async function metaFetch(path: string, init: RequestInit, tries = 3): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${apiKey()}`, ...init.headers },
    });
    if (res.ok) return res;
    if ((res.status === 429 || res.status >= 500) && attempt < tries) {
      await new Promise((r) => setTimeout(r, 800 * attempt ** 2));
      continue;
    }
    const text = await res.text().catch(() => '');
    let message = text.slice(0, 300);
    try {
      message = JSON.parse(text)?.error?.message ?? message;
    } catch {}
    throw new MetaError(res.status, `Meta API ${path} ${res.status}: ${message}`);
  }
}

/** Muse Spark with optional images, answering as JSON that matches `schema`. */
export async function sparkJson<T>(opts: {
  system: string;
  text: string;
  images?: string[];
  name: string;
  schema: object;
  maxTokens?: number;
}): Promise<T> {
  guard();
  const model = process.env.MUSE_SPARK_MODEL ?? 'muse-spark-1.3';
  const res = await metaFetch('/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'developer', content: opts.system },
        {
          role: 'user',
          content: [
            { type: 'text', text: opts.text },
            ...(opts.images ?? []).map((url) => ({ type: 'image_url', image_url: { url } })),
          ],
        },
      ],
      response_format: { type: 'json_schema', json_schema: { name: opts.name, strict: true, schema: opts.schema } },
      // Reasoning tokens count against this, so leave room for them.
      max_completion_tokens: opts.maxTokens ?? 6000,
    }),
  });
  const json = await res.json();
  const u = json.usage ?? {};
  book(model, (u.prompt_tokens ?? 0) * PRICE.sparkIn + (u.completion_tokens ?? 0) * PRICE.sparkOut, `${u.prompt_tokens ?? 0} in / ${u.completion_tokens ?? 0} out`);
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new MetaError(502, 'Muse Spark returned no content.');
  try {
    return JSON.parse(content) as T;
  } catch {
    throw new MetaError(502, 'Muse Spark returned JSON that does not parse.');
  }
}

/** Muse Image through the Responses API, with the seller's photo as the reference. Returns a data URL. */
export async function museImage(opts: { prompt: string; photo: string; aspect: Aspect; quality?: 'low' | 'high' }): Promise<string> {
  guard();
  const res = await metaFetch('/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'muse-image-1.0',
      // Seller photos are not kept on Meta's side.
      store: false,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: opts.prompt },
            { type: 'input_image', image_url: opts.photo },
          ],
        },
      ],
      tools: [
        {
          type: 'image_generation',
          // Search is on by default and can pull other brands' imagery into a product shot.
          enable_image_search: false,
          enable_web_search: false,
          enable_shell: false,
          reasoning_strength: opts.quality ?? 'low',
          size: SIZE[opts.aspect],
          output_format: 'jpeg',
        },
      ],
    }),
  });
  const json = await res.json();
  const call = json.output?.find((o: { type: string }) => o.type === 'image_generation_call');
  if (!call?.result) throw new MetaError(502, 'Muse Image returned no image.');
  book('muse-image-1.0', PRICE.image, '1 image');
  return `data:image/jpeg;base64,${call.result}`;
}

/**
 * SAM 3.1 segmentation from a noun phrase or from taps. Coordinates are in `image` pixels.
 * A positive tap marks part of the product and a negative tap marks something that is not.
 * One tap picks only the part under it, so a fix usually takes a few.
 */
export async function segment(opts: {
  image: string;
  width: number;
  height: number;
  phrase?: string;
  points?: { x: number; y: number; negative?: boolean }[];
}): Promise<Mask> {
  guard();
  const text = opts.points?.length
    ? buildObjectPrompt({
        size: { width: opts.width, height: opts.height },
        objects: [
          {
            id: 1,
            prompts: [{ points: opts.points.map((p) => ({ x: p.x, y: p.y, ...(p.negative ? { label: 'negative' as const } : {}) })) }],
          },
        ],
      })
    : (opts.phrase ?? 'product');
  const events = await client().responses.create({
    model: 'sam-3.1',
    input: [
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text },
          { type: 'input_image', image_url: opts.image, detail: 'auto' },
        ],
      },
    ],
    stream: true,
  });
  const result = await parseImageStream(events as never).finalResult;
  book('sam-3.1', PRICE.sam, '1 image');

  let best: Mask | undefined;
  for (const rec of recordsOfKind(result.records, 'mask')) {
    const raster = decodeMaskToRaster(rec.mask);
    let area = 0;
    const bits = new Uint8Array(Math.ceil(raster.length / 8));
    for (let i = 0; i < raster.length; i++) {
      if (raster[i]) {
        area++;
        bits[i >> 3] |= 0x80 >> (i & 7);
      }
    }
    if (!best || area > best.area) {
      best = {
        left: rec.bounds.left,
        top: rec.bounds.top,
        width: rec.mask.width,
        height: rec.mask.height,
        bits: Buffer.from(bits).toString('base64'),
        area,
      };
    }
  }
  if (!best || best.area === 0) throw new MetaError(422, 'SAM found nothing to cut out.');
  return best;
}

/** Muse Voice Transcribe on one complete WAV recording. */
export async function transcribeWav(wav: ArrayBuffer): Promise<string> {
  guard();
  const form = new FormData();
  form.append(
    'request',
    new Blob([JSON.stringify({ model: 'muse-voice-transcribe-1.0', audioEncoding: 'WAV', mode: 'PUSH_TO_TALK' })], { type: 'application/json' }),
  );
  form.append('audio', new Blob([wav], { type: 'audio/wav' }), 'brief.wav');
  const res = await metaFetch('/asr/transcribe', { method: 'POST', headers: { Accept: 'application/json' }, body: form });
  const json = await res.json();
  book('muse-voice-transcribe-1.0', ((json.audioDurationMs ?? 0) / 3_600_000) * PRICE.asrHour, `${json.audioDurationMs ?? 0} ms`);
  return String(json.transcript ?? '').trim();
}
