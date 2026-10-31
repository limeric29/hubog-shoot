// Durable storage for accounts, sessions, and quotas: D1 on Workers, with an
// in-memory twin behind the same interface for local dev and unit tests.
// Production fails closed when the binding is missing; dev never touches D1.
import { MetaError } from './meta';

export interface DbUser {
  id: string;
  email: string;
  pass_hash: string;
}

export interface Db {
  findUserByEmail(email: string): Promise<DbUser | null>;
  createUser(id: string, email: string, passHash: string, ip: string, now: number): Promise<void>;
  countRecentRegistrations(ip: string, since: number): Promise<number>;
  createSession(token: string, userId: string, now: number, expires: number): Promise<void>;
  findSessionUser(token: string, now: number): Promise<{ id: string; email: string } | null>;
  deleteSession(token: string): Promise<void>;
  consumeQuota(scope: string, key: string, day: string, kind: 'shoots' | 'anims', limit: number, now: number): Promise<{ allowed: boolean; used: number }>;
  readQuota(scope: string, key: string, day: string): Promise<{ shoots: number; anims: number }>;
  consumeGlobalAnims(day: string, limit: number): Promise<boolean>;
}

// The slice of D1Database this app uses, so no worker-types dependency.
interface D1 {
  prepare(sql: string): {
    bind(...params: unknown[]): {
      first<T>(): Promise<T | null>;
      run(): Promise<{ meta: { changes: number } }>;
    };
  };
}

function d1Db(d: D1): Db {
  return {
    findUserByEmail: (email) => d.prepare('SELECT id, email, pass_hash FROM users WHERE email = ?').bind(email).first<DbUser>(),
    createUser: async (id, email, passHash, ip, now) => {
      await d.prepare('INSERT INTO users(id, email, pass_hash, ip, created_at) VALUES(?,?,?,?,?)').bind(id, email, passHash, ip, now).run();
    },
    countRecentRegistrations: async (ip, since) => {
      const row = await d.prepare('SELECT COUNT(*) AS n FROM users WHERE ip = ? AND created_at > ?').bind(ip, since).first<{ n: number }>();
      return row?.n ?? 0;
    },
    createSession: async (token, userId, now, expires) => {
      await d.prepare('INSERT INTO sessions(token, user_id, created_at, expires_at) VALUES(?,?,?,?)').bind(token, userId, now, expires).run();
    },
    findSessionUser: (token, now) => d.prepare(
      'SELECT users.id AS id, users.email AS email FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token = ? AND sessions.expires_at > ?',
    ).bind(token, now).first<{ id: string; email: string }>(),
    deleteSession: async (token) => {
      await d.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    },
    consumeQuota: async (scope, key, day, kind, limit, now) => {
      await d.prepare('INSERT INTO quotas(scope, key, day, shoots, anims, updated_at) VALUES(?,?,?,0,0,?) ON CONFLICT(scope, key, day) DO NOTHING')
        .bind(scope, key, day, now).run();
      // Column names are a typed union, never user input.
      const r = await d.prepare(`UPDATE quotas SET ${kind} = ${kind} + 1, updated_at = ? WHERE scope = ? AND key = ? AND day = ? AND ${kind} < ?`)
        .bind(now, scope, key, day, limit).run();
      const row = await d.prepare('SELECT shoots, anims FROM quotas WHERE scope = ? AND key = ? AND day = ?')
        .bind(scope, key, day).first<{ shoots: number; anims: number }>();
      return { allowed: r.meta.changes > 0, used: row?.[kind] ?? 0 };
    },
    readQuota: async (scope, key, day) => {
      const row = await d.prepare('SELECT shoots, anims FROM quotas WHERE scope = ? AND key = ? AND day = ?')
        .bind(scope, key, day).first<{ shoots: number; anims: number }>();
      return { shoots: row?.shoots ?? 0, anims: row?.anims ?? 0 };
    },
    consumeGlobalAnims: async (day, limit) => {
      await d.prepare('INSERT INTO globals(day, anims) VALUES(?,0) ON CONFLICT(day) DO NOTHING').bind(day).run();
      const r = await d.prepare('UPDATE globals SET anims = anims + 1 WHERE day = ? AND anims < ?').bind(day, limit).run();
      return r.meta.changes > 0;
    },
  };
}

export function memoryDb(): Db {
  const users = new Map<string, DbUser & { ip: string; created_at: number }>();
  const sessions = new Map<string, { userId: string; expires: number }>();
  const quotas = new Map<string, { shoots: number; anims: number }>();
  const globals = new Map<string, number>();
  const cell = (scope: string, key: string, day: string) => {
    const k = `${scope}\n${key}\n${day}`;
    let c = quotas.get(k);
    if (!c) { c = { shoots: 0, anims: 0 }; quotas.set(k, c); }
    return c;
  };
  return {
    findUserByEmail: async (email) => {
      for (const u of users.values()) if (u.email === email) return { id: u.id, email: u.email, pass_hash: u.pass_hash };
      return null;
    },
    createUser: async (id, email, passHash, ip, now) => {
      users.set(id, { id, email, pass_hash: passHash, ip, created_at: now });
    },
    countRecentRegistrations: async (ip, since) => {
      let n = 0;
      for (const u of users.values()) if (u.ip === ip && u.created_at > since) n += 1;
      return n;
    },
    createSession: async (token, userId, _now, expires) => {
      sessions.set(token, { userId, expires });
    },
    findSessionUser: async (token, now) => {
      const s = sessions.get(token);
      if (!s || s.expires <= now) return null;
      const u = users.get(s.userId);
      return u ? { id: u.id, email: u.email } : null;
    },
    deleteSession: async (token) => {
      sessions.delete(token);
    },
    consumeQuota: async (scope, key, day, kind, limit) => {
      const c = cell(scope, key, day);
      if (c[kind] >= limit) return { allowed: false, used: c[kind] };
      c[kind] += 1;
      return { allowed: true, used: c[kind] };
    },
    readQuota: async (scope, key, day) => ({ ...cell(scope, key, day) }),
    consumeGlobalAnims: async (day, limit) => {
      const used = globals.get(day) ?? 0;
      if (used >= limit) return false;
      globals.set(day, used + 1);
      return true;
    },
  };
}

async function cloudflareDb(): Promise<D1 | null> {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const { env } = await getCloudflareContext({ async: true });
    const db = (env as unknown as Record<string, unknown>).DB;
    return db && typeof db === 'object' && 'prepare' in db ? (db as D1) : null;
  } catch {
    return null;
  }
}

let mem: Db | null = null;

/** The account store: D1 in production, an in-memory twin in dev and tests. */
export async function getDb(): Promise<Db> {
  const d1 = await cloudflareDb();
  if (d1) return d1Db(d1);
  if (process.env.NODE_ENV === 'production') {
    throw new MetaError(503, 'Accounts are unavailable right now. Please try again later.');
  }
  if (!mem) mem = memoryDb();
  return mem;
}
