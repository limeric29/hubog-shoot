// Small helpers for the route handlers.
import { MetaError } from './meta';

const MAX_IMAGE_CHARS = 6_000_000;

export async function handle(fn: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await fn());
  } catch (err) {
    const status = err instanceof MetaError && err.status >= 400 && err.status < 600 ? err.status : 500;
    console.error(err);
    return Response.json({ error: err instanceof Error ? err.message : 'Something went wrong.' }, { status });
  }
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
