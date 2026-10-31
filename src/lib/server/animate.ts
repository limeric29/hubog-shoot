// Client for the hubog-shoot-animate Modal app (LTX-2.5 on a B300), which turns
// a chosen scene photo into a short video. Async by design: start returns a
// call id, status polls it, video fetches the finished MP4.
import { MetaError } from './meta';

const base = () => (process.env.ANIMATE_URL ?? '').replace(/\/+$/, '');
const key = () => process.env.ANIMATE_KEY ?? '';

function guard() {
  if (!base() || !key()) throw new MetaError(501, 'Video animation is not set up on this demo yet.');
}

function cleanCallId(callId: unknown): string {
  if (typeof callId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(callId)) {
    throw new MetaError(400, 'That animation id is not valid.');
  }
  return callId;
}

async function modal(path: string, init?: RequestInit): Promise<Response> {
  guard();
  const res = await fetch(`${base()}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json', ...init?.headers },
  });
  if (res.status === 401 || res.status === 403) throw new MetaError(502, 'The animation service rejected this demo.');
  return res;
}

export async function animateStart(imageB64: string, prompt: string, aspect: string): Promise<string> {
  const res = await modal('/start', {
    method: 'POST',
    body: JSON.stringify({ image_b64: imageB64, prompt, aspect, duration_sec: 5, camera: 'slow_push_in' }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || typeof json.call_id !== 'string') {
    throw new MetaError(502, typeof json.error === 'string' ? json.error : 'The animation could not start. Please try again.');
  }
  return json.call_id;
}

export interface AnimateStatus {
  status: 'running' | 'done' | 'error';
  message?: string;
  width?: number;
  height?: number;
  bytes?: number;
}

export async function animateStatus(callId: unknown): Promise<AnimateStatus> {
  const res = await modal(`/status/${cleanCallId(callId)}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json.status !== 'running' && json.status !== 'done' && json.status !== 'error')) {
    throw new MetaError(502, 'The animation status could not be read. Please try again.');
  }
  return json as AnimateStatus;
}

export async function animateVideo(callId: unknown): Promise<Response> {
  const res = await modal(`/result/${cleanCallId(callId)}`);
  if (res.status === 425) throw new MetaError(425, 'The animation is still running.');
  if (!res.ok) throw new MetaError(502, 'The finished video could not be read. Please try again.');
  const bytes = await res.arrayBuffer();
  return new Response(bytes, {
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Disposition': 'attachment; filename="animated-scene.mp4"',
      // A finished call never changes, so browsers and the CDN can keep it.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
