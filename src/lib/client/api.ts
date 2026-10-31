// Calls to this app's own API routes.
export class ApiError extends Error {
  code?: string;
  status: number;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function apiCode(err: unknown): string | undefined {
  return err instanceof ApiError ? err.code : undefined;
}

export async function api<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(json.error ?? `Request failed (${res.status}).`, res.status, json.code);
  return json as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status}).`);
  return json as T;
}

export async function transcribe(wav: ArrayBuffer): Promise<string> {
  const res = await fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status}).`);
  return json.transcript as string;
}
