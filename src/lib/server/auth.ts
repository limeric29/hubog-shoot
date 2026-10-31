// Accounts and quotas. Anonymous visitors get a small lifetime free trial per
// IP; registered users get a fresh daily quota. Quotas live in D1 so clearing
// cookies or restarting an instance never resets them.
import { MetaError } from './meta';
import { getDb } from './db';

export const AUTH_COOKIE = 'hubog_auth';
const SESSION_DAYS = 30;
export const ANON_FREE = 3;
export const DAILY_FREE = 3;
export const GLOBAL_ANIMS_PER_DAY = 100;
export const MAX_REGISTRATIONS_PER_IP_PER_DAY = 3;

// Well-known throwaway domains. A speed bump, not a wall: determined abusers
// can still use fresh domains, but the daily caps bound what any account gets.
const DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com', 'yopmail.com',
  'trashmail.com', 'temp-mail.org', 'getnada.com', 'mohmal.com', 'emailondeck.com',
  'fakeinbox.com', 'mintemail.com', 'mytemp.email', 'tempail.com', 'dispostable.com',
  'sharklasers.com', 'maildrop.cc', 'harakirimail.com', 'wegwerfmail.de', 'trash-mail.com',
]);

export const todayUTC = () => new Date().toISOString().slice(0, 10);

export function clientIp(req: Request): string {
  const direct = req.headers.get('cf-connecting-ip')?.trim();
  if (direct) return direct.slice(0, 80);
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return (forwarded || 'unknown').slice(0, 80);
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  // Workers caps PBKDF2 at 100k iterations; the count rides in the hash so it can rise later.
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt as BufferSource, iterations: 100_000, hash: 'SHA-256' }, key, 256));
  return `pbkdf2$100000$${b64(salt)}$${b64(bits)}`;
}

function slowEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations < 10_000 || iterations > 1_000_000) return false;
  try {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: unb64(parts[2]) as BufferSource, iterations, hash: 'SHA-256' }, key, 256));
    return slowEqual(bits, unb64(parts[3]));
  } catch {
    return false;
  }
}

const alnum = (bytes: number) => {
  let out = '';
  while (out.length < bytes) out += b64(crypto.getRandomValues(new Uint8Array(24))).replace(/[^a-zA-Z0-9]/g, '');
  return out.slice(0, bytes);
};

export const randomToken = () => alnum(43);
export const randomId = () => `u_${alnum(24)}`;

const secure = () => (process.env.NODE_ENV === 'production' ? '; Secure' : '');

export const sessionCookie = (token: string) =>
  `${AUTH_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure()}`;
export const clearSessionCookie = () => `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure()}`;

export function readToken(req: Request): string | null {
  const header = req.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === AUTH_COOKIE && rest.length) return rest.join('=').slice(0, 128);
  }
  return null;
}

export interface AuthUser {
  id: string;
  email: string;
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/;

export async function register(email: string, password: string, ip: string): Promise<AuthUser> {
  const clean = email.trim().toLowerCase();
  if (!EMAIL_RE.test(clean)) throw new MetaError(400, 'That email address is not valid.');
  if (password.length < 8 || password.length > 128) throw new MetaError(400, 'Use a password between 8 and 128 characters.');
  const domain = clean.split('@')[1] ?? '';
  if (DISPOSABLE.has(domain)) throw new MetaError(400, 'Throwaway email addresses cannot register. Please use a real one.');
  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);
  if (await db.findUserByEmail(clean)) throw new MetaError(409, 'That email is already registered. Try logging in instead.');
  if ((await db.countRecentRegistrations(ip, now - 86400)) >= MAX_REGISTRATIONS_PER_IP_PER_DAY) {
    throw new MetaError(429, 'Too many accounts from this network today. Please try again tomorrow.');
  }
  const user = { id: randomId(), email: clean };
  await db.createUser(user.id, user.email, await hashPassword(password), ip, now);
  return user;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const clean = email.trim().toLowerCase();
  const db = await getDb();
  const found = await db.findUserByEmail(clean);
  const ok = found ? await verifyPassword(password, found.pass_hash) : false;
  if (!ok || !found) {
    // Fixed delay so a wrong email costs the same as a wrong password.
    await new Promise((r) => setTimeout(r, 400));
    throw new MetaError(401, 'Email or password is wrong.');
  }
  return { id: found.id, email: found.email };
}

export async function startSession(userId: string): Promise<{ token: string; cookie: string }> {
  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);
  const token = randomToken();
  await db.createSession(token, userId, now, now + SESSION_DAYS * 86400);
  return { token, cookie: sessionCookie(token) };
}

/** The logged-in user, or null for anonymous visitors. Never throws. */
export async function getAuthUser(req: Request): Promise<AuthUser | null> {
  try {
    const token = readToken(req);
    if (!token) return null;
    return await (await getDb()).findSessionUser(token, Math.floor(Date.now() / 1000));
  } catch {
    return null;
  }
}

export async function endSession(req: Request): Promise<string> {
  try {
    const token = readToken(req);
    if (token) await (await getDb()).deleteSession(token);
  } catch {
    // Logging out always succeeds from the visitor's side.
  }
  return clearSessionCookie();
}

export interface QuotaView {
  registered: boolean;
  shootsLeft: number;
  animsLeft: number;
  shootsLimit: number;
  animsLimit: number;
  window: 'trial' | 'day';
}

/** Remaining quota without consuming anything, for the quota display. */
export async function quotaFor(user: AuthUser | null, ip: string): Promise<QuotaView> {
  const db = await getDb();
  if (user) {
    const used = await db.readQuota('user', user.id, todayUTC());
    return { registered: true, shootsLeft: Math.max(0, DAILY_FREE - used.shoots), animsLeft: Math.max(0, DAILY_FREE - used.anims), shootsLimit: DAILY_FREE, animsLimit: DAILY_FREE, window: 'day' };
  }
  const used = await db.readQuota('ip', ip, '');
  return { registered: false, shootsLeft: Math.max(0, ANON_FREE - used.shoots), animsLeft: Math.max(0, ANON_FREE - used.anims), shootsLimit: ANON_FREE, animsLimit: ANON_FREE, window: 'trial' };
}

async function consume(user: AuthUser | null, ip: string, kind: 'shoots' | 'anims'): Promise<void> {
  const db = await getDb();
  if (user) {
    const q = await db.consumeQuota('user', user.id, todayUTC(), kind, DAILY_FREE, Math.floor(Date.now() / 1000));
    if (!q.allowed) {
      throw new MetaError(403, `You have used today's ${DAILY_FREE} free ${kind === 'shoots' ? 'shoots' : 'animations'}. Please come back tomorrow.`, 'DAILY_LIMIT');
    }
    return;
  }
  const q = await db.consumeQuota('ip', ip, '', kind, ANON_FREE, Math.floor(Date.now() / 1000));
  if (!q.allowed) {
    throw new MetaError(403, `Your ${ANON_FREE} free ${kind === 'shoots' ? 'shoots' : 'animations'} are used up. Register for ${DAILY_FREE} free ones every day.`, 'NEED_REGISTER');
  }
}

export const consumeShoot = (user: AuthUser | null, ip: string) => consume(user, ip, 'shoots');
export const consumeAnim = (user: AuthUser | null, ip: string) => consume(user, ip, 'anims');

/** Bounds total GPU exposure no matter how many accounts exist. */
export async function consumeGlobalAnims(): Promise<void> {
  const ok = await (await getDb()).consumeGlobalAnims(todayUTC(), GLOBAL_ANIMS_PER_DAY);
  if (!ok) throw new MetaError(503, 'Animation is fully booked today. Please try again tomorrow.');
}
