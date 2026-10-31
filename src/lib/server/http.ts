// Small helpers for the route handlers.
import { MetaError } from './meta';

const MAX_IMAGE_CHARS = 6_000_000;

export async function handle(fn: () => Promise<unknown>): Promise<Response> {
  try {
    const result = await fn();
    return result instanceof Response ? result : Response.json(result);
  } catch (err) {
    const status = err instanceof MetaError && err.status >= 400 && err.status < 600 ? err.status : 500;
    console.error(err);
    const code = err instanceof MetaError ? err.code : undefined;
    return Response.json({ error: err instanceof Error ? err.message : 'Something went wrong.', ...(code ? { code } : {}) }, { status });
  }
}

// Per-visitor daily limits on the paid routes. The counts live in this instance's memory, so they reset
// when it restarts and are not shared between instances: they stop a casual loop, not a determined one.
// The spend cap in meta.ts is the backstop.
const hits = new Map<string, { n: number; day: string }>();

export function rateLimit(req: Request, bucket: string, max: number, message = "You have used today's free shoots on this demo. Please come back tomorrow.") {
  if (process.env.NODE_ENV !== 'production') return;
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const day = new Date().toISOString().slice(0, 10);
  const key = `${bucket}:${ip}`;
  const seen = hits.get(key);
  const n = seen && seen.day === day ? seen.n + 1 : 1;
  if (hits.size > 5000) hits.clear();
  hits.set(key, { n, day });
  if (n > max) throw new MetaError(429, message);
}

export function imageUrl(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(value) || value.length > MAX_IMAGE_CHARS) {
    throw new MetaError(400, `${name} must be a JPEG, PNG or WebP data URL under 4 MB.`);
  }
  return value;
}

export function text(value: unknown, name: string, max: number): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > max) throw new MetaError(400, `${name} must be text under ${max} characters.`);
  return value;
}

export function int(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new MetaError(400, `${name} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}
