CREATE TABLE IF NOT EXISTS players (
  mode TEXT NOT NULL,
  game TEXT NOT NULL,
  uid TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  token TEXT,
  member_id TEXT NOT NULL,
  payment_method_id TEXT NOT NULL,
  card_brand TEXT,
  card_last4 TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  consent_at TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  left_at TEXT,
  PRIMARY KEY (mode, game, uid)
);
CREATE TABLE IF NOT EXISTS skips (
  mode TEXT NOT NULL,
  game TEXT NOT NULL,
  uid TEXT NOT NULL,
  session_ts TEXT NOT NULL,
  by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (mode, game, uid, session_ts)
);
CREATE TABLE IF NOT EXISTS charges (
  mode TEXT NOT NULL,
  game TEXT NOT NULL,
  uid TEXT NOT NULL,
  session_ts TEXT NOT NULL,
  status TEXT NOT NULL,
  amount REAL NOT NULL,
  payment_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_attempt_at TEXT,
  refunded_amount REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (mode, game, uid, session_ts)
);
