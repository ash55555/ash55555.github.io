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

CREATE TABLE IF NOT EXISTS reviews (
  uid TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  name TEXT,
  rating INTEGER NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  comment TEXT NOT NULL DEFAULT '',
  sessions INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE reviews ADD COLUMN show_public INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS accounts_seen (
  uid TEXT PRIMARY KEY,
  email TEXT,
  seen_at TEXT NOT NULL
);

-- Game Master profiles (the page a GM fills in about themselves). One row per GM.
CREATE TABLE IF NOT EXISTS gm_profiles (
  uid TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- In-site messages between people (a player and a Game Master).
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conv TEXT NOT NULL,
  from_uid TEXT NOT NULL,
  to_uid TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS messages_conv ON messages (conv, id);
CREATE INDEX IF NOT EXISTS messages_to ON messages (to_uid, read_at);
CREATE TABLE IF NOT EXISTS message_emails (
  conv TEXT NOT NULL,
  to_uid TEXT NOT NULL,
  last_at TEXT NOT NULL,
  PRIMARY KEY (conv, to_uid)
);

-- Signed Game Master Agreements (one row per signature; renewing adds a new row).
CREATE TABLE IF NOT EXISTS dm_agreements (
  id TEXT PRIMARY KEY,
  access_key TEXT NOT NULL,
  version TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  signed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  ip_hash TEXT,
  user_agent TEXT,
  text TEXT NOT NULL,
  emailed_at TEXT,
  reminded_at TEXT
);
CREATE INDEX IF NOT EXISTS dm_agreements_email ON dm_agreements (email);

-- A signed agreement can be linked to the GM account that claimed it.
ALTER TABLE dm_agreements ADD COLUMN uid TEXT;

-- Each GM's connected Whop account (where their players' payments go).
CREATE TABLE IF NOT EXISTS gm_accounts (
  uid TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  email TEXT,
  created_at TEXT NOT NULL
);

-- Campaigns made by another Game Master: who owns them and their weekly sessions.
-- owner_uid is empty for Ash's own campaigns (their sessions stay in Firebase as before).
-- slots_json holds a GM's sessions: { "<slotId>": { day, hour, minute, tz, max, enabled, group } }.
ALTER TABLE campaign_content ADD COLUMN owner_uid TEXT;
ALTER TABLE campaign_content ADD COLUMN slots_json TEXT;
CREATE INDEX IF NOT EXISTS campaign_content_owner ON campaign_content (owner_uid);

-- What players say about another Game Master (Ash's reviews stay in the reviews table).
-- One review per player per Game Master.
CREATE TABLE IF NOT EXISTS gm_reviews (
  gm_uid TEXT NOT NULL,
  uid TEXT NOT NULL,
  mode TEXT NOT NULL,
  name TEXT,
  rating INTEGER NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  comment TEXT NOT NULL DEFAULT '',
  sessions INTEGER NOT NULL DEFAULT 0,
  show_public INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (gm_uid, uid)
);

-- Sessions added by hand, outside the weekly schedule of a game (a one-off or a run of weekly sessions).
CREATE TABLE IF NOT EXISTS extra_sessions (
  mode TEXT NOT NULL,
  game TEXT NOT NULL,
  session_ts TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT,
  PRIMARY KEY (mode, game, session_ts)
);

-- Tips players leave a Game Master (or Ash). A tip counts only once Whop confirms the payment.
CREATE TABLE IF NOT EXISTS tips (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  gm_slug TEXT NOT NULL,
  gm_uid TEXT NOT NULL,
  from_uid TEXT NOT NULL,
  from_name TEXT,
  amount REAL NOT NULL,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  config_id TEXT,
  payment_id TEXT,
  created_at TEXT NOT NULL,
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS tips_gm ON tips (gm_uid, status);
