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

CREATE TABLE IF NOT EXISTS games (
  mode TEXT NOT NULL,
  game TEXT NOT NULL,
  running INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  stopped_at TEXT,
  PRIMARY KEY (mode, game)
);

CREATE TABLE IF NOT EXISTS profiles (
  uid TEXT PRIMARY KEY,
  email TEXT,
  name TEXT,
  pronouns TEXT,
  token TEXT,
  bio TEXT,
  avatar_id TEXT,
  avatar_data TEXT,
  interests TEXT NOT NULL DEFAULT '[]',
  other TEXT NOT NULL DEFAULT '',
  slots TEXT,
  tz TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS profiles_avatar ON profiles (avatar_id);

ALTER TABLE profiles ADD COLUMN slots_fmt TEXT;

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  mode TEXT NOT NULL,
  kind TEXT NOT NULL,
  game TEXT,
  title TEXT NOT NULL,
  body TEXT,
  read INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS reminders (
  mode TEXT NOT NULL,
  game TEXT NOT NULL,
  session_ts TEXT NOT NULL,
  uid TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (mode, game, session_ts, uid)
);

ALTER TABLE notifications ADD COLUMN uid TEXT;
CREATE INDEX IF NOT EXISTS notifications_uid ON notifications (uid, read);

CREATE TABLE IF NOT EXISTS campaign_content (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  eyebrow TEXT NOT NULL DEFAULT '',
  hook TEXT NOT NULL DEFAULT '',
  intro TEXT NOT NULL DEFAULT '',
  world TEXT NOT NULL DEFAULT '',
  stakes TEXT NOT NULL DEFAULT '',
  audience TEXT NOT NULL DEFAULT '',
  banner_id TEXT,
  banner_data TEXT,
  published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS campaign_content_banner ON campaign_content (banner_id);
