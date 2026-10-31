-- Accounts, sessions, and durable quotas for shoots and animations.
-- Anonymous visitors are tracked by IP with a lifetime quota (day = '');
-- registered users get a fresh quota every UTC day.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE TABLE quotas (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  day TEXT NOT NULL DEFAULT '',
  shoots INTEGER NOT NULL DEFAULT 0,
  anims INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (scope, key, day)
);
CREATE TABLE globals (
  day TEXT PRIMARY KEY,
  anims INTEGER NOT NULL DEFAULT 0
);
