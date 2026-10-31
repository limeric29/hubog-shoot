import { MetaError } from './meta';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const SESSION_COOKIE = 'hubog_shoot_verified';
const SESSION_MAX_AGE_SECONDS = 60 * 60;

/** Turnstile protects production requests and stays off in local development. */
export function turnstileEnabled() {
  return process.env.NODE_ENV === 'production' && process.env.TURNSTILE_ENABLED !== 'false';
}

function base64url(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64url(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

async function signingKey(secret: string, usage: 'sign' | 'verify') {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

async function sessionCookie(hostname: string, secret: string) {
  const payload = base64url(new TextEncoder().encode(JSON.stringify({ hostname, expires: Date.now() + SESSION_MAX_AGE_SECONDS * 1000 })));
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await signingKey(secret, 'sign'), new TextEncoder().encode(payload)));
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${payload}.${base64url(signature)}; Path=/api; Max-Age=${SESSION_MAX_AGE_SECONDS}; HttpOnly; SameSite=Strict${secure}`;
}

function expectedHostnames() {
  return new Set(
    (process.env.TURNSTILE_HOSTNAMES ?? '')
      .split(',')
      .map((hostname) => hostname.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Verify a one-use Turnstile token before starting the paid photo plan. */
export async function verifyTurnstile(req: Request, token: unknown, expectedAction: string) {
  if (!turnstileEnabled()) return null;
  const secret = process.env.TURNSTILE_SECRET;
  const hostnames = expectedHostnames();

  if (!secret || hostnames.size === 0) throw new MetaError(503, 'Photo verification is not configured yet.');
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) {
    throw new MetaError(403, 'Complete the quick verification before making your photos.');
  }

  let result: { success?: boolean; action?: string; hostname?: string };
  try {
    const remoteip = req.headers.get('cf-connecting-ip');
    const response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret,
        response: token,
        ...(remoteip ? { remoteip } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('Siteverify request failed.');
    result = await response.json();
  } catch {
    throw new MetaError(503, 'Photo verification is temporarily unavailable. Please try again.');
  }

  if (
    result.success !== true ||
    result.action !== expectedAction ||
    typeof result.hostname !== 'string' ||
    !hostnames.has(result.hostname.toLowerCase())
  ) {
    throw new MetaError(403, 'Verification expired or did not pass. Complete it again to continue.');
  }

  return sessionCookie(result.hostname, secret);
}

/** Require the short-lived, signed browser session issued after successful Siteverify. */
export async function verifyShootSession(req: Request) {
  if (!turnstileEnabled()) return;
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) throw new MetaError(503, 'Photo verification is not configured yet.');
  const value = req.headers.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  const [payload, signature, extra] = value?.split('.') ?? [];
  if (!payload || !signature || extra) throw new MetaError(403, 'Complete the quick verification before making your photos.');

  try {
    const valid = await crypto.subtle.verify('HMAC', await signingKey(secret, 'verify'), fromBase64url(signature), new TextEncoder().encode(payload));
    if (!valid) throw new Error('invalid signature');
    const session = JSON.parse(new TextDecoder().decode(fromBase64url(payload))) as { hostname?: unknown; expires?: unknown };
    const requestHost = req.headers.get('host')?.split(':')[0]?.toLowerCase();
    if (
      typeof session.hostname !== 'string' ||
      session.hostname !== requestHost ||
      !expectedHostnames().has(session.hostname) ||
      typeof session.expires !== 'number' ||
      session.expires <= Date.now()
    ) {
      throw new Error('expired session');
    }
  } catch {
    throw new MetaError(403, 'Your verification has expired. Complete it again to make photos.');
  }
}
