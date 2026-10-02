// Card-on-file payments for game groups.
//
// How it works, in plain words:
//   1. A player saves a card once (Whop's secure form, no charge, no trial).
//   2. This Worker remembers who is in which game (Cloudflare D1 database).
//   3. Every 5 minutes a timer looks for sessions that have just started and
//      charges each player who is in that game and did not skip it. One charge
//      per player per session, ever (the database enforces that).
//   4. Skips are just rows in the database, so any future session can be skipped.
//
// PAY_MODE (sandbox|live) picks pretend money or real money.
// CHARGING_MODE (off|dry|on) is the kill switch for the timer.

import { createRemoteJWKSet, jwtVerify } from 'jose';

const FIREBASE_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const SKIP_CUTOFF_MS = 24 * HOUR_MS;
const MAX_ATTEMPTS = 3;
const RETRY_GAP_MS = 6 * HOUR_MS;
const CATCH_UP_MS = 3 * DAY_MS; // the timer looks back this far for uncharged sessions
const SESSIONS_SHOWN = 8;

// Every game slot on the site is a bookable game. The schedule, seat limit and
// paused/running state come from the same Firebase list the admin page edits, so
// a time changed in the admin page changes the charge time too, and a new slot
// becomes bookable with no code change.
//
// The PRICE and the MINIMUM players are deliberately NOT read from Firebase.
// They are fixed here, so nothing in that database can change what anyone pays.
const FIREBASE_DB = 'https://ash-ttrpg-default-rtdb.firebaseio.com';
const SESSION_PRICE = 10;
// Shown everywhere as "how many seats a table needs" (seat counts, the admin
// roster's "X of Y needed" text) — informational only, not itself a gate on
// charging. Ash clicking "Start game" for a specific game IS her judgment
// call that it has enough players, however many that actually is; see
// MIN_PLAYERS_TO_CHARGE below for the one real floor on top of that.
const MIN_PLAYERS = 3;
// The only real requirement for runCharges() to actually charge a session:
// somebody is really in it. Once a game is started, this is intentionally
// NOT tied to MIN_PLAYERS, so a manually-started game with 1 real player
// (e.g. a one-off test) charges normally instead of silently doing nothing.
const MIN_PLAYERS_TO_CHARGE = 1;
const CAMPAIGN_TITLES = {
  'flying-city': 'The Prophecy of the Flying City',
  'curse-of-strahd': 'Curse of Strahd',
  'ravenloft-undead-survival': 'Ravenloft: Undead Survival',
  'crooked-moon': 'The Crooked Moon',
  'witchlight': 'The Wild Beyond the Witchlight',
};

// "legacyFilled" = seats taken by players who are NOT booked through this system
// (the ones still on PayPal). It is the "filled" number in the admin page.
let gamesCache = { at: 0, games: null };

export async function loadGames(env, fresh = false) {
  if (!fresh && gamesCache.games && Date.now() - gamesCache.at < 60 * 1000) return gamesCache.games;
  const res = await fetch(`${FIREBASE_DB}/campaigns.json`);
  if (!res.ok) throw new Error('Could not load the game schedule.');
  const data = await res.json();

  // CAMPAIGN_TITLES only knows the site's 5 original campaigns. Anything made
  // later through the admin Campaigns tab isn't in it, and without this,
  // every email and notification about that campaign (join, leave, skip,
  // declined card, session reminders) would show the raw slug instead of its
  // real title. Looks up the real title from the content database for any
  // slug CAMPAIGN_TITLES doesn't recognize.
  const unknownSlugs = Object.keys(data || {}).filter((slug) => !CAMPAIGN_TITLES[slug]);
  const titleOverrides = {};
  if (unknownSlugs.length && env.DB) {
    for (const slug of unknownSlugs) {
      try {
        const row = await env.DB.prepare('SELECT title FROM campaign_content WHERE slug=?').bind(slug).first();
        if (row && row.title) titleOverrides[slug] = row.title;
      } catch { /* falls back to the raw slug below */ }
    }
  }

  const games = {};
  for (const [slug, campaign] of Object.entries(data || {})) {
    for (const [slotId, s] of Object.entries((campaign && campaign.slots) || {})) {
      if (!s || !Number.isInteger(s.day) || !Number.isInteger(s.hour) || s.day < 0 || s.day > 6 || s.hour < 0 || s.hour > 23) continue;
      const key = slotId === 'default' ? slug : `${slug}::${slotId}`;
      games[key] = {
        key,
        title: (CAMPAIGN_TITLES[slug] || titleOverrides[slug] || slug) + (s.group ? `, ${s.group}` : ''),
        day: s.day,
        hour: s.hour,
        minute: Number.isInteger(s.minute) ? s.minute : 0,
        offset: typeof s.offset === 'number' ? s.offset : 1,
        price: SESSION_PRICE,
        max: Number.isInteger(s.max) && s.max > 0 ? s.max : 5,
        min: MIN_PLAYERS,
        legacyFilled: Number.isInteger(s.filled) && s.filled > 0 ? s.filled : 0,
        enabled: s.enabled !== false,
      };
    }
  }
  gamesCache = { at: Date.now(), games };
  return games;
}

// ---------------------------------------------------------------- utilities

function json(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

export function cfg(env) {
  const live = env.PAY_MODE === 'live';
  return {
    mode: live ? 'live' : 'sandbox',
    api: live ? 'https://api.whop.com/api/v1' : 'https://sandbox-api.whop.com/api/v1',
    key: live ? env.WHOP_API_KEY : env.WHOP_SANDBOX_API_KEY,
    company: live ? env.WHOP_COMPANY_ID : env.WHOP_SANDBOX_COMPANY_ID,
  };
}

async function whop(env, path, init = {}) {
  const c = cfg(env);
  const res = await fetch(c.api + path, {
    ...init,
    headers: { Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json' },
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// Whop's own error responses sometimes nest the real message inside an object
// (e.g. { error: { message: '...' } }) instead of a plain string. Passing that
// object straight into `new Error(...)` turns it into the literal text
// "[object Object]" for whoever reads it, so this always digs out real text.
function whopErrorText(data) {
  const e = data && data.error;
  if (typeof e === 'string' && e) return e;
  if (e && typeof e === 'object') return e.message || e.error || JSON.stringify(e);
  if (data && typeof data.message === 'string' && data.message) return data.message;
  return null;
}

export async function verifyUser(env, idToken) {
  const jwks = createRemoteJWKSet(new URL(FIREBASE_JWKS_URL));
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
    audience: env.FIREBASE_PROJECT_ID,
  });
  return payload;
}

function isAllowed(env, user) {
  if (user.sub === env.ADMIN_UID) return true;
  if (env.PAY_OPEN === 'yes') return true;
  const allowed = (env.TEST_PLAYER_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return allowed.includes((user.email || '').toLowerCase());
}

// First session start strictly after `after`.
function nextStart(game, after) {
  const utcHour = game.hour - game.offset;
  const targetDay = (game.day + (utcHour < 0 ? -1 : 0) + 7) % 7;
  for (let i = -1; i < 9; i++) {
    const d = new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), after.getUTCDate() + i, utcHour, game.minute));
    if (d.getUTCDay() === targetDay && d.getTime() > after.getTime()) return d;
  }
  return null;
}

export function upcoming(game, from, count) {
  const out = [];
  let d = nextStart(game, from);
  for (let i = 0; i < count && d; i++) {
    out.push(d);
    d = new Date(d.getTime() + 7 * DAY_MS);
  }
  return out;
}

// Sessions with start in (from, to].
function sessionsBetween(game, from, to) {
  const out = [];
  let d = nextStart(game, from);
  while (d && d.getTime() <= to.getTime()) {
    out.push(d);
    d = new Date(d.getTime() + 7 * DAY_MS);
  }
  return out;
}

export const iso = (d) => d.toISOString();
const chargeKey = (mode, game, uid, ts) => `${mode}|${game}|${uid}|${ts}`;

async function activeCount(env, mode, gameKey) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM players WHERE mode=? AND game=? AND status='active'").bind(mode, gameKey).first();
  return r ? r.n : 0;
}

function seatInfo(game, online) {
  const filled = game.legacyFilled + online;
  return { filled, max: game.max, min: game.min, open: Math.max(0, game.max - filled) };
}

// Billing for a game only begins when Ash clicks "Start game" in the admin page.
export async function gameState(env, mode, gameKey) {
  const row = await env.DB.prepare('SELECT running, started_at, stopped_at FROM games WHERE mode=? AND game=?').bind(mode, gameKey).first();
  return { running: !!(row && row.running), startedAt: row ? row.started_at : null, stoppedAt: row ? row.stopped_at : null };
}

// Players playing one session: everyone still on PayPal, plus online players who
// had joined before it and have not skipped it.
export async function playingCount(env, mode, gameKey, game, ts) {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM players p WHERE p.mode=? AND p.game=? AND p.status='active' AND p.joined_at < ?
     AND NOT EXISTS (SELECT 1 FROM skips s WHERE s.mode=p.mode AND s.game=p.game AND s.uid=p.uid AND s.session_ts=?)`)
    .bind(mode, gameKey, ts, ts).first();
  return game.legacyFilled + (r ? r.n : 0);
}

function cleanName(name, email) {
  const n = String(name || '').replace(/[<>]/g, '').trim().slice(0, 30);
  return n || (email || 'Player').split('@')[0].slice(0, 30);
}

// ------------------------------------------------------------------ routing

export async function handlePay(request, env, corsHeaders, origin, action, sendEmail, verify = verifyUser) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, corsHeaders);
  if (!origin) return json({ error: 'Origin not allowed' }, 403, corsHeaders);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400, corsHeaders); }
  if (!body || !body.idToken) return json({ error: 'Please sign in again.' }, 401, corsHeaders);

  let user;
  try { user = await verify(env, body.idToken); } catch { return json({ error: 'Please sign in again.' }, 401, corsHeaders); }

  const isAdminRoute = action.startsWith('admin/');
  if (isAdminRoute) {
    if (user.sub !== env.ADMIN_UID) return json({ error: 'Not authorized' }, 403, corsHeaders);
  } else if (!isAllowed(env, user)) {
    return json({ error: 'Joining online is not open to everyone yet. Please message Ash.' }, 403, corsHeaders);
  }

  if (action === 'admin/games') return await adminGames(env, cfg(env).mode, corsHeaders);
  if (action === 'admin/balance') return await adminBalance(env, corsHeaders);
  if (action === 'admin/charges') return await adminAllCharges(env, corsHeaders);
  if (action === 'admin/notifications') {
    const mode = cfg(env).mode;
    // One shared list for Ash: the DM notifications plus any addressed to Ash's own player account.
    // Never anyone else's: other players' notifications stay theirs.
    const items = (await env.DB.prepare('SELECT id, created_at, kind, game, title, body, read FROM notifications WHERE mode=? AND (uid IS NULL OR uid=?) ORDER BY id DESC LIMIT 40').bind(mode, env.ADMIN_UID).all()).results;
    const unread = await env.DB.prepare('SELECT COUNT(*) AS n FROM notifications WHERE mode=? AND (uid IS NULL OR uid=?) AND read=0').bind(mode, env.ADMIN_UID).first();
    return json({ items, unread: unread ? unread.n : 0, emailOn: !!env.ADMIN_NOTIFY_EMAIL }, 200, corsHeaders);
  }
  if (action === 'admin/notifications/test') {
    await notify(env, sendEmail, 'live', 'reminder', null, 'Test notification', 'If you can read this in your inbox and in your admin page, notifications are working. Nothing is wrong.');
    return json({ ok: true }, 200, corsHeaders);
  }
  if (action === 'admin/notifications/read') {
    await env.DB.prepare('UPDATE notifications SET read=1 WHERE mode=? AND (uid IS NULL OR uid=?) AND read=0').bind(cfg(env).mode, env.ADMIN_UID).run();
    return json({ ok: true }, 200, corsHeaders);
  }
  if (action === 'admin/notifications/read-one') {
    const id = parseInt(body.id, 10);
    if (!id) return json({ error: 'Missing notification id.' }, 400, corsHeaders);
    await env.DB.prepare('UPDATE notifications SET read=1 WHERE mode=? AND (uid IS NULL OR uid=?) AND id=?').bind(cfg(env).mode, env.ADMIN_UID, id).run();
    return json({ ok: true }, 200, corsHeaders);
  }

  const gameKey = body.game;
  let game;
  try { game = (await loadGames(env))[gameKey]; } catch (err) { return json({ error: err.message }, 502, corsHeaders); }
  if (!game) return json({ error: 'Unknown game' }, 400, corsHeaders);

  const ctx = { env, user, body, gameKey, game, origin, mode: cfg(env).mode, corsHeaders, sendEmail, request };
  try {
    switch (action) {
      case 'setup': return await doSetup(ctx);
      case 'complete': return await doComplete(ctx);
      case 'status': return await doStatus(ctx);
      case 'skip': return await doSkip(ctx, true);
      case 'unskip': return await doSkip(ctx, false);
      case 'leave': return await doLeave(ctx);
      case 'admin/roster': return await adminRoster(ctx);
      case 'admin/skip': return await adminSkip(ctx);
      case 'admin/refund': return await adminRefund(ctx);
      case 'admin/retry': return await adminRetry(ctx);
      case 'admin/remove': return await adminRemove(ctx);
      case 'admin/start': return await adminGameRunning(ctx, true);
      case 'admin/stop': return await adminGameRunning(ctx, false);
      default: return json({ error: 'Unknown action' }, 404, corsHeaders);
    }
  } catch (err) {
    return json({ error: err.message || 'Something went wrong.' }, 502, corsHeaders);
  }
}

async function getPlayer(ctx, uid = ctx.user.sub) {
  return ctx.env.DB.prepare('SELECT * FROM players WHERE mode=? AND game=? AND uid=?').bind(ctx.mode, ctx.gameKey, uid).first();
}

// ------------------------------------------------------------ player: join

async function doSetup(ctx) {
  const { env, user, gameKey, game, corsHeaders } = ctx;
  const existing = await getPlayer(ctx);
  const updating = !!(existing && existing.status === 'active');
  if (!updating && !game.enabled) return json({ error: 'This group is not taking new players right now. Message Ash to be added to the waitlist.' }, 409, corsHeaders);
  if (!updating) {
    const seats = seatInfo(game, await activeCount(env, ctx.mode, gameKey));
    if (seats.open <= 0) return json({ error: 'This game is full right now. Talk to Ash about a spot.' }, 409, corsHeaders);
  }
  const c = cfg(env);
  // After the card is saved Whop sends the player back to their table page.
  // Only a plain query string is accepted, on the site the request came from.
  const rq = typeof ctx.body.returnQuery === 'string' && /^\?[A-Za-z0-9=&%_.:~+-]{0,600}$/.test(ctx.body.returnQuery) ? ctx.body.returnQuery : '';
  const returnUrl = `${ctx.origin}/player.html${rq}${rq ? '&' : '?'}saved=1`;
  const r = await whop(env, '/checkout_configurations', {
    method: 'POST',
    body: JSON.stringify({
      mode: 'setup',
      redirect_url: returnUrl,
      account_id: c.company,
      currency: 'usd',
      payment_method_configuration: { enabled: ['card'], disabled: [], include_platform_defaults: false },
      three_ds_level: 'mandate_challenge',
      metadata: { uid: user.sub, email: (user.email || '').toLowerCase(), game: gameKey },
    }),
  });
  if (!r.ok) return json({ error: 'Could not start card setup.', detail: r.data }, 502, corsHeaders);
  return json({ configId: r.data.id, environment: c.mode, updating }, 200, corsHeaders);
}

// Called by the browser after Whop says the card was saved. We do not trust the
// browser: we ask Whop directly which card was saved for this checkout.
async function doComplete(ctx) {
  const { env, user, body, gameKey, game, corsHeaders } = ctx;
  if (body.consent !== true || body.adult !== true) {
    return json({ error: 'Please tick both boxes to continue.' }, 400, corsHeaders);
  }
  if (!body.configId && !body.setupIntentId) return json({ error: 'Missing checkout.' }, 400, corsHeaders);

  const c = cfg(env);
  let intent = null;
  if (body.setupIntentId) {
    const one = await whop(env, `/setup_intents/${encodeURIComponent(body.setupIntentId)}`);
    if (!one.ok) return json({ error: 'Could not confirm your card yet.', detail: one.data }, 502, corsHeaders);
    intent = one.data;
  } else {
    const r = await whop(env, `/setup_intents?account_id=${c.company}&first=50&direction=desc`);
    if (!r.ok) return json({ error: 'Could not confirm your card yet.', detail: r.data }, 502, corsHeaders);
    intent = (r.data.data || []).find((i) => i.checkout_configuration_id === body.configId);
  }
  // The saved card must belong to THIS signed-in player and THIS game.
  if (intent && !(intent.metadata && intent.metadata.uid === user.sub && intent.metadata.game === gameKey)) intent = null;
  if (!intent || intent.status === 'processing') return json({ pending: true }, 202, corsHeaders);
  if (intent.status !== 'succeeded' || !intent.member_id || !intent.payment_method_id) {
    return json({ error: 'Your card was not saved. Please try again.' }, 409, corsHeaders);
  }

  const memberId = intent.member_id;
  const pm = { id: intent.payment_method_id };
  const card = (intent.payment_instrument && intent.payment_instrument.card) || {};
  const now = iso(new Date());
  const existing = await getPlayer(ctx);
  if (!existing || existing.status !== 'active') {
    const seats = seatInfo(game, await activeCount(env, ctx.mode, gameKey));
    if (seats.open <= 0) return json({ error: 'This game just filled up. Talk to Ash about a spot.' }, 409, corsHeaders);
  }
  const email = (user.email || '').toLowerCase();
  const name = cleanName(body.name, email);
  const token = String(body.token || '').replace(/[^a-z]/g, '').slice(0, 12);

  if (existing && existing.status === 'active') {
    await env.DB.prepare('UPDATE players SET member_id=?, payment_method_id=?, card_brand=?, card_last4=? WHERE mode=? AND game=? AND uid=?')
      .bind(memberId, pm.id, card.brand || null, card.last4 || null, ctx.mode, gameKey, user.sub).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO players (mode, game, uid, email, name, token, member_id, payment_method_id, card_brand, card_last4, status, consent_at, joined_at)
       VALUES (?,?,?,?,?,?,?,?,?,?, 'active', ?, ?)
       ON CONFLICT(mode, game, uid) DO UPDATE SET email=excluded.email, name=excluded.name, token=excluded.token,
         member_id=excluded.member_id, payment_method_id=excluded.payment_method_id, card_brand=excluded.card_brand,
         card_last4=excluded.card_last4, status='active', consent_at=excluded.consent_at, joined_at=excluded.joined_at, left_at=NULL`)
      .bind(ctx.mode, gameKey, user.sub, email, name, token, memberId, pm.id, card.brand || null, card.last4 || null, now, now).run();
    // A fresh join starts with a clean slate of skips.
    await env.DB.prepare('DELETE FROM skips WHERE mode=? AND game=? AND uid=?').bind(ctx.mode, gameKey, user.sub).run();
    await notify(env, ctx.sendEmail, ctx.mode, 'joined', gameKey, `${name} joined ${game.title}`, `${email} booked a seat.\nCard on file: ${card.brand || 'card'} ${card.last4 || ''}.`);
  }
  return doStatus(ctx);
}

// ---------------------------------------------------------- player: status

async function doStatus(ctx) {
  const { env, user, gameKey, game, corsHeaders } = ctx;
  const now = new Date();
  const online = await activeCount(env, ctx.mode, gameKey);
  const seats = seatInfo(game, online);
  const { roster, dm } = await tableFor(env, ctx.mode, gameKey, new URL(ctx.request.url).origin, user.sub);
  const me = await getPlayer(ctx);
  const gs = await gameState(env, ctx.mode, gameKey);
  const base = { seats, roster, dm, price: game.price, mode: ctx.mode, running: gs.running };
  if (!me || me.status !== 'active') return json({ ...base, joined: false, left: !!(me && me.status === 'left') }, 200, corsHeaders);

  const sessions = upcoming(game, now, SESSIONS_SHOWN);
  const skips = (await env.DB.prepare('SELECT session_ts, by FROM skips WHERE mode=? AND game=? AND uid=?').bind(ctx.mode, gameKey, user.sub).all()).results;
  const skipMap = new Map(skips.map((s) => [s.session_ts, s.by]));
  const list = sessions.map((d) => {
    const ts = iso(d);
    const by = skipMap.get(ts) || null;
    return { ts, skipped: !!by, skippedBy: by, canChange: d.getTime() - now.getTime() >= SKIP_CUTOFF_MS && by !== 'admin' };
  });
  const recent = (await env.DB.prepare('SELECT session_ts, status, amount, refunded_amount FROM charges WHERE mode=? AND game=? AND uid=? ORDER BY session_ts DESC LIMIT 6').bind(ctx.mode, gameKey, user.sub).all()).results;
  return json({
    ...base,
    joined: true,
    card: { brand: me.card_brand, last4: me.card_last4 },
    sessions: list,
    charges: recent,
  }, 200, corsHeaders);
}

async function doSkip(ctx, skip) {
  const { env, user, body, gameKey, game, corsHeaders } = ctx;
  const me = await getPlayer(ctx);
  if (!me || me.status !== 'active') return json({ error: 'You are not in this game right now.' }, 409, corsHeaders);
  const now = new Date();
  const ts = String(body.ts || '');
  const valid = upcoming(game, now, 26).some((d) => iso(d) === ts);
  if (!valid) return json({ error: 'That session is not available to change.' }, 400, corsHeaders);
  if (new Date(ts).getTime() - now.getTime() < SKIP_CUTOFF_MS) {
    return json({ error: 'It is less than 24 hours before this session, so it is too late to change it here. Please message Ash.' }, 409, corsHeaders);
  }
  if (skip) {
    const ins = await env.DB.prepare('INSERT OR IGNORE INTO skips (mode, game, uid, session_ts, by, created_at) VALUES (?,?,?,?,?,?)')
      .bind(ctx.mode, gameKey, user.sub, ts, 'player', iso(now)).run();
    // Only announce a skip that is actually new, so a double click or a repeat
    // does not email anyone twice.
    if (ins.meta && ins.meta.changes === 1) {
      const tz = await playerTz(env, user.sub);
      const w = when(ts, tz);
      const who = me.name || me.email;
      await notifyPlayer(env, ctx.mode, user.sub, 'skipped_self', gameKey, 'You skipped a session',
        `You skipped your ${w.day} session of ${game.title}. You will not be charged for it.`);
      await emailSkip(ctx, me, ts, tz, 'player');
      const playing = await playingCount(env, ctx.mode, gameKey, game, ts);
      const utc = when(ts, '');
      await notify(env, ctx.sendEmail, ctx.mode, 'skipped_player', gameKey, `${who} skipped ${game.title}`,
        `${who} (${me.email}) skipped the session on ${utc.day} at ${utc.time}. They will not be charged for it.\nPlaying that night: ${playing} (${game.min} needed to start).`);
    }
  } else {
    const row = await env.DB.prepare('SELECT by FROM skips WHERE mode=? AND game=? AND uid=? AND session_ts=?').bind(ctx.mode, gameKey, user.sub, ts).first();
    if (row && row.by === 'admin') return json({ error: 'Ash skipped this one for you. Please message Ash to change it.' }, 409, corsHeaders);
    await env.DB.prepare('DELETE FROM skips WHERE mode=? AND game=? AND uid=? AND session_ts=?').bind(ctx.mode, gameKey, user.sub, ts).run();
  }
  return doStatus(ctx);
}

async function doLeave(ctx) {
  const { env, user, gameKey, game, corsHeaders } = ctx;
  const me = await getPlayer(ctx);
  if (!me || me.status !== 'active') return json({ error: 'You are not in this game right now.' }, 409, corsHeaders);
  const now = new Date();
  const next = nextStart(game, now);
  const nextSkipped = next && await env.DB.prepare('SELECT 1 AS x FROM skips WHERE mode=? AND game=? AND uid=? AND session_ts=?').bind(ctx.mode, gameKey, user.sub, iso(next)).first();
  if (next && !nextSkipped && next.getTime() - now.getTime() < SKIP_CUTOFF_MS) {
    return json({ error: 'It is less than 24 hours before the next session, so it is too late to leave before it. Please message Ash.' }, 409, corsHeaders);
  }
  await env.DB.prepare("UPDATE players SET status='left', left_at=? WHERE mode=? AND game=? AND uid=?").bind(iso(now), ctx.mode, gameKey, user.sub).run();
  await notify(env, ctx.sendEmail, ctx.mode, 'left', gameKey, `${me.name || me.email} left ${game.title}`, `${me.email} left the game and will not be charged again.`);
  return json({ joined: false, left: true }, 200, corsHeaders);
}

// ------------------------------------------------------------------- admin

async function adminRoster(ctx) {
  const { env, gameKey, game, corsHeaders } = ctx;
  const now = new Date();
  const players = (await env.DB.prepare('SELECT p.*, pr.token AS pr_token, pr.avatar_id AS avatar_id FROM players p LEFT JOIN profiles pr ON pr.uid = p.uid WHERE p.mode=? AND p.game=? ORDER BY p.status, p.joined_at').bind(ctx.mode, gameKey).all()).results;
  const skips = (await env.DB.prepare('SELECT uid, session_ts, by FROM skips WHERE mode=? AND game=?').bind(ctx.mode, gameKey).all()).results;
  const charges = (await env.DB.prepare('SELECT * FROM charges WHERE mode=? AND game=? ORDER BY session_ts DESC LIMIT 200').bind(ctx.mode, gameKey).all()).results;
  const sessions = upcoming(game, now, SESSIONS_SHOWN).map(iso);
  const pastSessions = sessionsBetween(game, new Date(now.getTime() - 28 * DAY_MS), now).map(iso).reverse();
  const gs = await gameState(env, ctx.mode, gameKey);
  const playing = {};
  for (const ts of sessions) playing[ts] = await playingCount(env, ctx.mode, gameKey, game, ts);
  return json({
    mode: ctx.mode,
    running: gs.running,
    startedAt: gs.startedAt,
    stoppedAt: gs.stoppedAt,
    playing,
    charging: env.CHARGING_MODE || 'off',
    game: { key: gameKey, title: game.title, price: game.price, max: game.max, min: game.min, legacyFilled: game.legacyFilled },
    seats: seatInfo(game, players.filter((p) => p.status === 'active').length),
    sessions,
    pastSessions,
    players: players.map((p) => ({
      uid: p.uid, email: p.email, name: p.name, status: p.status, joinedAt: p.joined_at,
      token: p.pr_token || p.token || '', avatarId: p.avatar_id || null,
      card: p.card_last4 ? `${p.card_brand || 'card'} ${p.card_last4}` : '',
    })),
    skips,
    charges: charges.map((c) => ({
      uid: c.uid, ts: c.session_ts, status: c.status, amount: c.amount, refunded: c.refunded_amount,
      attempts: c.attempts, error: c.last_error, paymentId: c.payment_id,
    })),
  }, 200, corsHeaders);
}

async function adminSkip(ctx) {
  const { env, body, gameKey, game, corsHeaders } = ctx;
  const uid = String(body.uid || '');
  const ts = String(body.ts || '');
  const now = new Date();
  const player = await getPlayer(ctx, uid);
  if (!player) return json({ error: 'Player not found.' }, 404, corsHeaders);
  const ok = upcoming(game, now, 26).some((d) => iso(d) === ts);
  if (!ok) return json({ error: 'That session is not in the future.' }, 400, corsHeaders);
  if (body.skipped) {
    const prev = await env.DB.prepare('SELECT by FROM skips WHERE mode=? AND game=? AND uid=? AND session_ts=?').bind(ctx.mode, gameKey, uid, ts).first();
    await env.DB.prepare('INSERT INTO skips (mode, game, uid, session_ts, by, created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(mode, game, uid, session_ts) DO UPDATE SET by=excluded.by')
      .bind(ctx.mode, gameKey, uid, ts, 'admin', iso(now)).run();
    // Already skipped by you earlier? Then the player was already told.
    if (!prev || prev.by !== 'admin') {
      const tz = await playerTz(env, uid);
      const w = when(ts, tz);
      await notifyPlayer(env, ctx.mode, uid, 'skipped_admin', gameKey, 'Your DM skipped a session',
        `Your DM skipped your ${w.day} session of ${game.title}. You will not be charged for it.`);
      await emailSkip(ctx, player, ts, tz, 'admin');
    }
  } else {
    await env.DB.prepare('DELETE FROM skips WHERE mode=? AND game=? AND uid=? AND session_ts=?').bind(ctx.mode, gameKey, uid, ts).run();
  }
  return json({ ok: true }, 200, corsHeaders);
}


async function adminRefund(ctx) {
  const { env, body, gameKey, corsHeaders } = ctx;
  const uid = String(body.uid || '');
  const ts = String(body.ts || '');
  const row = await env.DB.prepare('SELECT * FROM charges WHERE mode=? AND game=? AND uid=? AND session_ts=?').bind(ctx.mode, gameKey, uid, ts).first();
  if (!row || !row.payment_id || row.status !== 'paid') return json({ error: 'There is no paid charge to refund for that session.' }, 409, corsHeaders);
  const amount = body.amount ? Number(body.amount) : null;
  if (amount !== null && (!(amount > 0) || amount > row.amount - row.refunded_amount)) {
    return json({ error: 'That refund amount is not valid.' }, 400, corsHeaders);
  }
  const r = await whop(ctx.env, `/payments/${row.payment_id}/refund`, { method: 'POST', body: JSON.stringify(amount ? { partial_amount: amount } : {}) });
  if (!r.ok) return json({ error: 'Whop would not refund this payment.', detail: r.data }, 502, corsHeaders);
  const refunded = row.refunded_amount + (amount || (row.amount - row.refunded_amount));
  const full = refunded >= row.amount - 0.001;
  await env.DB.prepare('UPDATE charges SET refunded_amount=?, status=?, updated_at=? WHERE mode=? AND game=? AND uid=? AND session_ts=?')
    .bind(refunded, full ? 'refunded' : 'paid', iso(new Date()), ctx.mode, gameKey, uid, ts).run();
  return json({ ok: true, refunded, full }, 200, corsHeaders);
}

// Lets Ash reopen a charge that gave up after too many declines.
async function adminRetry(ctx) {
  const { env, body, gameKey, corsHeaders } = ctx;
  const uid = String(body.uid || '');
  const ts = String(body.ts || '');
  await env.DB.prepare("UPDATE charges SET status='failed', attempts=0, last_attempt_at=NULL, updated_at=? WHERE mode=? AND game=? AND uid=? AND session_ts=? AND status IN ('failed','failed_final')")
    .bind(iso(new Date()), ctx.mode, gameKey, uid, ts).run();
  return json({ ok: true }, 200, corsHeaders);
}

async function adminGames(env, mode, corsHeaders) {
  const games = await loadGames(env, true);
  const players = (await env.DB.prepare("SELECT game, COUNT(*) AS n FROM players WHERE mode=? AND status='active' GROUP BY game").bind(mode).all()).results;
  const online = Object.fromEntries(players.map((r) => [r.game, r.n]));
  const states = (await env.DB.prepare('SELECT game, running FROM games WHERE mode=?').bind(mode).all()).results;
  const running = Object.fromEntries(states.map((r) => [r.game, !!r.running]));
  return json({
    games: Object.values(games).map((g) => ({
      key: g.key, title: g.title, enabled: g.enabled, online: online[g.key] || 0, running: !!running[g.key],
    })),
  }, 200, corsHeaders);
}

// Read-only: what Whop says is sitting in the account right now. Nothing here
// moves money — actually withdrawing still happens on Whop's own dashboard,
// which already has that built (and already knows Ash's real payout details).
//
// Uses its own dedicated API key (WHOP_BALANCE_API_KEY, "Read company balance"
// permission only) instead of the shared charging/refund key, so a mistake here
// can never touch the key that actually moves real money. Always reads the
// live company's real balance, regardless of PAY_MODE — a "sandbox balance"
// isn't a real number Ash would ever need to see.
async function adminBalance(env, corsHeaders) {
  const company = env.WHOP_COMPANY_ID;
  const key = env.WHOP_BALANCE_API_KEY;
  if (!company || !key) return json({ error: 'Balance reading is not set up yet (missing WHOP_BALANCE_API_KEY).' }, 500, corsHeaders);
  const res = await fetch(`https://api.whop.com/api/v1/ledger_accounts/${company}`, {
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  });
  const data = await res.json().catch(() => ({}));
  const r = { ok: res.ok, data };
  const c = { mode: 'live' };
  if (!r.ok) return json({ error: whopErrorText(r.data) || 'Could not read the Whop balance.' }, 502, corsHeaders);
  const d = r.data || {};
  const usd = (d.balances || []).find((b) => b.currency === 'usd') || (d.balances && d.balances[0]) || null;
  const tb = d.treasury_balance || null;
  const balance = usd ? (usd.balance || 0) : 0;
  const pending = usd ? (usd.pending_balance || 0) : 0;
  const reserve = usd ? (usd.reserve_balance || 0) : 0;
  const withdrawable = tb ? (tb.total_withdrawable_balance || 0) : balance;
  // Whop sometimes settles part of what she's owed into a second ledger
  // entry in "usdt" (a dollar-pegged stablecoin) instead of "usd" — same
  // real dollar value, just a different bucket. The "usd" entry alone
  // silently dropped that money from the total. Sum every currency entry
  // Whop lists (they're each already dollar-equivalent here) instead of
  // only the one literally labeled "usd", so nothing she's owed goes missing.
  const total = (d.balances || []).reduce((sum, b) => sum + (b.balance || 0) + (b.pending_balance || 0) + (b.reserve_balance || 0), 0);
  return json({
    mode: c.mode,
    currency: (usd && usd.currency) || 'usd',
    balance, pending, reserve, withdrawable,
    total,
  }, 200, corsHeaders);
}

// Every charge across every game in one list, for the admin Finance tab —
// the per-game "Players & payments" tab already shows this one game at a time.
async function adminAllCharges(env, corsHeaders) {
  const mode = cfg(env).mode;
  let games;
  try { games = await loadGames(env); } catch (err) { return json({ error: err.message }, 502, corsHeaders); }
  const rows = (await env.DB.prepare('SELECT * FROM charges WHERE mode=? ORDER BY session_ts DESC LIMIT 300').bind(mode).all()).results;
  const players = rows.length
    ? (await env.DB.prepare('SELECT game, uid, name, email FROM players WHERE mode=?').bind(mode).all()).results
    : [];
  const byKey = {};
  players.forEach((p) => { byKey[`${p.game}|${p.uid}`] = p; });
  const charges = rows.map((c) => {
    const p = byKey[`${c.game}|${c.uid}`];
    const g = games[c.game];
    return {
      game: c.game,
      gameTitle: g ? g.title : c.game,
      uid: c.uid,
      name: (p && p.name) || (p && p.email) || c.uid,
      email: p ? p.email : '',
      ts: c.session_ts,
      status: c.status,
      amount: c.amount,
      refunded: c.refunded_amount,
      paymentId: c.payment_id,
      error: c.last_error,
    };
  });
  return json({ mode, charges }, 200, corsHeaders);
}

// Who sits at a table: the DM (Ash's own profile) and every active player, with
// the name, picture and pronouns each person chose on their profile page.
async function tableFor(env, mode, gameKey, selfOrigin, viewerUid) {
  const pic = (id) => (id ? `${selfOrigin}/profile/avatar/${id}` : null);
  const roster = (await env.DB.prepare(
    `SELECT p.name AS pname, p.token AS ptoken, p.uid, pr.name AS name, pr.token AS token, pr.avatar_id, pr.pronouns
     FROM players p LEFT JOIN profiles pr ON pr.uid = p.uid
     WHERE p.mode=? AND p.game=? AND p.status='active' ORDER BY p.joined_at`).bind(mode, gameKey).all()).results
    .map((p) => ({
      name: p.name || p.pname, token: p.token || p.ptoken || '', you: !!viewerUid && p.uid === viewerUid,
      pronouns: p.pronouns || '', avatar: pic(p.avatar_id),
    }));
  const d = await env.DB.prepare('SELECT name, token, avatar_id, pronouns FROM profiles WHERE uid=?').bind(env.ADMIN_UID).first();
  const dm = { name: (d && d.name) || 'Ash', token: (d && d.token) || 'dragon', avatar: pic(d && d.avatar_id), pronouns: (d && d.pronouns) || '' };
  return { roster, dm };
}

// Public (no sign-in): the table for one game, so anyone thinking of joining can
// see who is already there. Shows display names, pictures and pronouns only.
export async function handleRoster(request, env, corsHeaders) {
  const url = new URL(request.url);
  const gameKey = url.searchParams.get('game') || '';
  let game;
  try { game = (await loadGames(env))[gameKey]; } catch { return new Response(JSON.stringify({ error: 'Schedule unavailable' }), { status: 502, headers: { 'Content-Type': 'application/json', ...corsHeaders } }); }
  if (!game) return new Response(JSON.stringify({ error: 'Unknown game' }), { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
  const mode = cfg(env).mode;
  const { roster, dm } = await tableFor(env, mode, gameKey, url.origin, null);
  const seats = seatInfo(game, await activeCount(env, mode, gameKey));
  return new Response(JSON.stringify({ seats, roster, dm }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=20', ...corsHeaders },
  });
}

// Public: how many players are booked online per game, so the site's seat counts
// can add them to the manual "filled" number. Contains no names or emails.
export async function handleSeats(request, env, corsHeaders) {
  const mode = cfg(env).mode;
  const rows = (await env.DB.prepare("SELECT game, COUNT(*) AS n FROM players WHERE mode=? AND status='active' GROUP BY game").bind(mode).all()).results;
  return new Response(JSON.stringify({ seats: Object.fromEntries(rows.map((r) => [r.game, r.n])) }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=20', ...corsHeaders },
  });
}

async function adminGameRunning(ctx, running) {
  const { env, gameKey, corsHeaders } = ctx;
  const now = iso(new Date());
  if (running) {
    // Starting again while already running keeps the original start time.
    await env.DB.prepare(
      `INSERT INTO games (mode, game, running, started_at) VALUES (?,?,1,?)
       ON CONFLICT(mode, game) DO UPDATE SET
         started_at = CASE WHEN games.running = 1 THEN games.started_at ELSE excluded.started_at END,
         running = 1, stopped_at = NULL`).bind(ctx.mode, gameKey, now).run();
  } else {
    await env.DB.prepare('UPDATE games SET running=0, stopped_at=? WHERE mode=? AND game=?').bind(now, ctx.mode, gameKey).run();
  }
  return json({ ok: true, ...(await gameState(env, ctx.mode, gameKey)) }, 200, corsHeaders);
}

async function adminRemove(ctx) {
  const { env, body, gameKey, game, corsHeaders } = ctx;
  const uid = String(body.uid || '');
  await env.DB.prepare("UPDATE players SET status='left', left_at=? WHERE mode=? AND game=? AND uid=?").bind(iso(new Date()), ctx.mode, gameKey, uid).run();
  await notifyPlayer(env, ctx.mode, uid, 'removed', gameKey, 'You were removed from a game', `Ash removed you from ${game.title}. You will not be charged again. Message Ash if this was not expected.`);
  return json({ ok: true }, 200, corsHeaders);
}

// -------------------------------------------------------- the charging timer

export async function runCharges(env, sendEmail) {
  const mode = env.CHARGING_MODE || 'off';
  if (mode === 'off') return { skipped: 'charging is off' };
  const c = cfg(env);
  const now = new Date();
  const report = { charged: 0, pending: 0, failed: 0, wouldCharge: 0, checked: 0 };

  // If the schedule cannot be read, do nothing this round rather than guess.
  let allGames;
  try { allGames = await loadGames(env, true); } catch (err) { return { skipped: 'could not read the schedule: ' + err.message }; }

  for (const [gameKey, game] of Object.entries(allGames)) {
    const players = (await env.DB.prepare("SELECT * FROM players WHERE mode=? AND game=? AND status='active'").bind(c.mode, gameKey).all()).results;
    const sessions = sessionsBetween(game, new Date(now.getTime() - CATCH_UP_MS), now).map(iso);

    // A NEW charge needs both: Ash has started the game (and the session is after
    // that moment), and enough players are playing that session. Charges that
    // already exist (retries, pending checks) carry on regardless.
    const gs = await gameState(env, c.mode, gameKey);
    const canStart = new Map();
    for (const ts of sessions) {
      let ok = gs.running && ts > gs.startedAt;
      if (ok) {
        const playing = await playingCount(env, c.mode, gameKey, game, ts);
        ok = playing >= MIN_PLAYERS_TO_CHARGE;
        if (!ok) console.log(`${gameKey} ${ts}: only ${playing} playing, so nobody is charged`);
      }
      canStart.set(ts, ok);
    }

    for (const p of players) {
      for (const ts of sessions) {
        // Never charge for a session that started before the player joined.
        if (ts <= p.joined_at) continue;
        const skipped = await env.DB.prepare('SELECT 1 AS x FROM skips WHERE mode=? AND game=? AND uid=? AND session_ts=?').bind(c.mode, gameKey, p.uid, ts).first();
        if (skipped) continue;
        const existing = await env.DB.prepare('SELECT 1 AS x FROM charges WHERE mode=? AND game=? AND uid=? AND session_ts=?').bind(c.mode, gameKey, p.uid, ts).first();
        if (!existing && !canStart.get(ts)) continue;
        report.checked++;

        if (mode === 'dry') { report.wouldCharge++; console.log(`[dry] would charge ${p.email} $${game.price} for ${gameKey} ${ts}`); continue; }

        await env.DB.prepare("INSERT OR IGNORE INTO charges (mode, game, uid, session_ts, status, amount, updated_at) VALUES (?,?,?,?, 'new', ?, ?)")
          .bind(c.mode, gameKey, p.uid, ts, game.price, iso(now)).run();
        const row = await env.DB.prepare('SELECT * FROM charges WHERE mode=? AND game=? AND uid=? AND session_ts=?').bind(c.mode, gameKey, p.uid, ts).first();

        if (['paid', 'refunded', 'failed_final', 'unknown'].includes(row.status)) continue;
        if (row.status === 'pending') { await reconcile(env, c, row, sendEmail, p, game); continue; }
        if (row.status === 'failed') {
          if (row.attempts >= MAX_ATTEMPTS) {
            await env.DB.prepare("UPDATE charges SET status='failed_final', updated_at=? WHERE mode=? AND game=? AND uid=? AND session_ts=?").bind(iso(now), c.mode, gameKey, p.uid, ts).run();
            await notify(env, sendEmail, c.mode, 'gave_up', gameKey, `Charge gave up: ${p.name || p.email}`, `${p.name || ''} (${p.email}) could not be charged for ${game.title}, session ${fmtUtc(ts)}, after ${MAX_ATTEMPTS} tries. Use "Try again" on your admin page once they fix their card.`);
            continue;
          }
          if (row.last_attempt_at && now.getTime() - new Date(row.last_attempt_at).getTime() < RETRY_GAP_MS) continue;
        }

        // Claim the charge. Only one run can win this update, so a double-run
        // of the timer can never charge the same player twice.
        const claim = await env.DB.prepare(
          "UPDATE charges SET status='pending', attempts=attempts+1, last_attempt_at=?, updated_at=? WHERE mode=? AND game=? AND uid=? AND session_ts=? AND status=?")
          .bind(iso(now), iso(now), c.mode, gameKey, p.uid, ts, row.status).run();
        if (!claim.meta || claim.meta.changes !== 1) continue;

        const key = chargeKey(c.mode, gameKey, p.uid, ts);
        const r = await whop(env, '/payments', {
          method: 'POST',
          body: JSON.stringify({
            account_id: c.company,
            member_id: p.member_id,
            payment_method_id: p.payment_method_id,
            plan: {
              currency: 'usd',
              plan_type: 'one_time',
              initial_price: game.price,
              title: 'Ash Tabletop game session',
            },
            metadata: { charge_key: key, uid: p.uid, game: gameKey, session_ts: ts },
          }),
        });
        await settle(env, c, sendEmail, p, game, gameKey, ts, r);
        const outcome = r.ok ? classify(r.data) : 'failed';
        if (outcome === 'paid') report.charged++; else if (outcome === 'pending') report.pending++; else report.failed++;
      }
    }
  }
  return report;
}

async function settle(env, c, sendEmail, p, game, gameKey, ts, r) {
  const now = iso(new Date());
  const d = r.data || {};
  const kind = r.ok ? classify(d) : 'failed';
  if (kind === 'paid') {
    await env.DB.prepare("UPDATE charges SET status='paid', payment_id=?, last_error=NULL, updated_at=? WHERE mode=? AND game=? AND uid=? AND session_ts=?")
      .bind(d.id || null, now, c.mode, gameKey, p.uid, ts).run();
    return;
  }
  if (kind === 'pending' && d.id) {
    // Accepted but not settled yet. The timer will check on it next run.
    await env.DB.prepare("UPDATE charges SET payment_id=?, updated_at=? WHERE mode=? AND game=? AND uid=? AND session_ts=?")
      .bind(d.id, now, c.mode, gameKey, p.uid, ts).run();
    return;
  }
  const cardDeclined = !!(d.id && kind === 'failed');
  const why = String(d.failure_message || (d.error && (d.error.message || d.error.type)) || `HTTP ${r.status}`).slice(0, 300);
  await env.DB.prepare("UPDATE charges SET status='failed', payment_id=COALESCE(?, payment_id), last_error=?, updated_at=? WHERE mode=? AND game=? AND uid=? AND session_ts=?")
    .bind(d.id || null, (cardDeclined ? '' : 'System problem, not the card: ') + why, now, c.mode, gameKey, p.uid, ts).run();
  if (cardDeclined) {
    await emailDeclined(env, sendEmail, p, game);
    await notifyPlayer(env, c.mode, p.uid, 'declined', gameKey, 'Your card was declined', `We could not charge $${game.price} for ${game.title}. Please update your card on your player page.`);
  }
  await notify(env, sendEmail, c.mode, 'charge_failed', gameKey, `Charge failed: ${p.name || p.email}`,
    `${p.name || ''} (${p.email}) could not be charged $${game.price} for ${game.title}, session ${fmtUtc(ts)}.\nReason: ${why}\n${cardDeclined ? 'The player was emailed to update their card. It will retry automatically.' : 'This looks like a system problem, not the card. The player was NOT emailed.'}`);
}

async function emailDeclined(env, sendEmail, p, game) {
  if (!sendEmail) return;
  try {
    await sendEmail(env, p.email, 'Your card was declined for your Ash Tabletop game',
      `<p>Hi ${escapeHtml(p.name || 'there')},</p><p>We tried to charge $${game.price} for your session of <strong>${escapeHtml(game.title)}</strong> and your card was declined.</p><p>Please update your card on your <a href="https://ashtabletop.com/player.html">player page</a>. We'll try again automatically in a few hours. Questions? Message Ash on Discord.</p>`);
  } catch { /* the failure is already recorded; the admin page shows it */ }
}

// A charge left "pending" (e.g. the Worker stopped mid-way). Ask Whop what
// really happened instead of guessing, so nobody is charged twice.
async function reconcile(env, c, row, sendEmail, p, game) {
  const now = new Date();
  const last = row.last_attempt_at ? new Date(row.last_attempt_at).getTime() : 0;
  if (now.getTime() - last < (row.payment_id ? 60 * 1000 : 10 * 60 * 1000)) return;
  if (row.payment_id) {
    const r = await whop(env, `/payments/${row.payment_id}`);
    if (r.ok) {
      const d = r.data;
      const kind = classify(d);
      if (kind === 'paid') {
        await env.DB.prepare("UPDATE charges SET status='paid', last_error=NULL, updated_at=? WHERE mode=? AND game=? AND uid=? AND session_ts=?").bind(iso(now), c.mode, row.game, row.uid, row.session_ts).run();
        return;
      }
      if (kind === 'failed') {
        await env.DB.prepare("UPDATE charges SET status='failed', last_error=?, updated_at=? WHERE mode=? AND game=? AND uid=? AND session_ts=?").bind(String(d.failure_message || 'failed').slice(0, 300), iso(now), c.mode, row.game, row.uid, row.session_ts).run();
        await emailDeclined(env, sendEmail, p, game);
        await notifyPlayer(env, c.mode, p.uid, 'declined', row.game, 'Your card was declined', `We could not charge $${game.price} for ${game.title}. Please update your card on your player page.`);
        await notify(env, sendEmail, c.mode, 'charge_failed', row.game, `Charge failed: ${p.name || p.email}`,
          `${p.name || ''} (${p.email}) was declined for ${game.title}, session ${fmtUtc(row.session_ts)}.\nReason: ${String(d.failure_message || 'declined').slice(0, 200)}\nThe player was emailed to update their card. It will retry automatically.`);
        return;
      }
    }
    return;
  }
  // No payment id was ever recorded: we cannot be sure whether money moved.
  // Flag it for Ash rather than risk a double charge.
  await env.DB.prepare("UPDATE charges SET status='unknown', last_error='Charge started but the result was not recorded. Check Whop before retrying.', updated_at=? WHERE mode=? AND game=? AND uid=? AND session_ts=?")
    .bind(iso(now), c.mode, row.game, row.uid, row.session_ts).run();
  await notify(env, sendEmail, c.mode, 'unknown', row.game, `Check Whop: ${p.name || p.email}`, `A charge for ${game.title}, session ${fmtUtc(row.session_ts)}, started but its result was not recorded. Check Whop before retrying, so nobody is charged twice.`);
}

function classify(d) {
  if (d && d.status === 'paid' && d.substatus !== 'failed') return 'paid';
  if (d && (d.substatus === 'failed' || d.failure_message)) return 'failed';
  return 'pending';
}

const KIND_ICON = { joined: 'New player', left: 'Player left', skipped_player: 'Player skipped', review: 'New review', new_account: 'New account', charge_failed: 'Charge failed', gave_up: 'Charge gave up', unknown: 'Check Whop', reminder: 'Reminder sent' };

// Adds an entry to the notifications list in the admin page and, for real-money
// events, emails Ash at ADMIN_NOTIFY_EMAIL (a Worker secret, never in the site).
export async function notifyPlayer(env, mode, uid, kind, gameKey, title, body) {
  try {
    await env.DB.prepare('INSERT INTO notifications (created_at, mode, kind, game, title, body, read, uid) VALUES (?,?,?,?,?,?,0,?)')
      .bind(new Date().toISOString(), mode, kind, gameKey || null, String(title).slice(0, 200), String(body || '').slice(0, 1500), uid).run();
  } catch (err) { console.error('player notification not saved', err && err.message); }
}

export async function notify(env, sendEmail, mode, kind, gameKey, title, body) {
  try {
    await env.DB.prepare('INSERT INTO notifications (created_at, mode, kind, game, title, body, read) VALUES (?,?,?,?,?,?,0)')
      .bind(new Date().toISOString(), mode, kind, gameKey || null, String(title).slice(0, 200), String(body || '').slice(0, 1500)).run();
  } catch (err) { console.error('notification not saved', err && err.message); }
  const to = env.ADMIN_NOTIFY_EMAIL;
  if (mode !== 'live' || !to || !sendEmail) return;
  try {
    await sendEmail(env, to, title, adminEmailHtml(kind, title, body));
  } catch (err) { console.error('notification email failed', err && err.message); }
}

export function adminEmailHtml(kind, title, body) {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#241a3d">
        <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#9b6dff;font-weight:700">${escapeHtml(KIND_ICON[kind] || kind)}</p>
        <h2 style="margin:0 0 12px">${escapeHtml(title)}</h2>
        <p style="line-height:1.55">${escapeHtml(body || '').replace(/\n/g, '<br>')}</p>
        <p><a href="https://ashtabletop.com/admin.html" style="display:inline-block;background:#f2b84f;color:#241407;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:700">Open your admin page</a></p>
      </div>`;
}

function fmtUtc(ts) { return new Date(ts).toUTCString().replace(' GMT', ' UTC'); }

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// ------------------------------------------------- time zones and skip emails

// Time zone abbreviation people recognize (AEST, EDT...) or "" when there is none.
function abbreviation(date, tz) {
  const raw = /^(GMT|UTC)[+\-−]/;
  for (const loc of ['en-US', 'en-GB', 'en-AU', 'en-NZ', 'en-CA', 'en-IN', 'en-ZA']) {
    try {
      const part = new Intl.DateTimeFormat(loc, { timeZone: tz, timeZoneName: 'short' }).formatToParts(date).find((p) => p.type === 'timeZoneName');
      if (part && !raw.test(part.value)) return part.value;
    } catch { /* try the next */ }
  }
  return '';
}

// "Saturday, October 3" and "9:00 PM AEST" for one person's own time zone.
export function when(ts, tz) {
  const d = new Date(ts);
  try {
    if (!tz) throw new Error('no zone');
    const day = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' }).format(d);
    const time = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(d);
    const abbr = abbreviation(d, tz);
    return { day, time: time + (abbr ? ' ' + abbr : ' your local time'), known: true };
  } catch {
    const day = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }).format(d);
    const time = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' }).format(d);
    return { day, time: time + ' UTC', known: false };
  }
}

async function playerTz(env, uid) {
  try {
    const row = await env.DB.prepare('SELECT tz FROM profiles WHERE uid=?').bind(uid).first();
    return (row && row.tz) || '';
  } catch { return ''; }
}

// by = 'admin' (the DM skipped it for them) or 'player' (they skipped it themselves).
export function skipEmailHtml({ name, game, ts, tz, by }) {
  const w = when(ts, tz);
  const byDm = by === 'admin';
  const heading = byDm ? 'Your DM skipped a session' : 'Session skipped';
  const lead = byDm
    ? `Hi ${escapeHtml(name || 'there')}, your DM just skipped your session on <strong style="color:#ffffff">${escapeHtml(w.day)}</strong>.`
    : `Hi ${escapeHtml(name || 'there')}, you skipped your session on <strong style="color:#ffffff">${escapeHtml(w.day)}</strong>. Got it!`;
  const closing = byDm
    ? 'Think this is a mistake? Message Ash on Discord and it gets sorted out.'
    : 'Changed your mind? You can undo this on your player page up to 24 hours before the session.';
  return `<!doctype html><html><body style="margin:0;background:#120b1c;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
   <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#1c1230;border-radius:20px;overflow:hidden;border:1px solid #3a2a5c">
    <tr><td style="padding:28px 32px 10px;background:linear-gradient(135deg,#3b2a6d,#1c1230)">
      <p style="margin:0;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#f2b84f;font-weight:700">Ash Tabletop</p>
      <h1 style="margin:8px 0 0;font-size:26px;line-height:1.2;color:#ffffff">${escapeHtml(heading)}</h1>
    </td></tr>
    <tr><td style="padding:20px 32px 30px;color:#d9cdf2;font-size:16px;line-height:1.55">
      <p style="margin:0 0 16px">${lead}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#2a1d47;border-radius:14px;border:1px solid #4a3877;border-left:4px solid #f2b84f"><tr><td style="padding:18px 20px">
        <p style="margin:0 0 10px"><span style="display:inline-block;background:#3d2f10;border:1px solid #f2b84f;color:#f2b84f;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;padding:4px 10px;border-radius:999px">Skipped</span></p>
        <p style="margin:0;font-size:13px;color:#b9a9d9;text-transform:uppercase;letter-spacing:.08em;font-weight:700">${escapeHtml(game.title)}</p>
        <p style="margin:6px 0 2px;font-size:22px;color:#ffffff;font-weight:700">${escapeHtml(w.day)}</p>
        <p style="margin:0;font-size:20px;color:#f2b84f;font-weight:700">${escapeHtml(w.time)}</p>
      </td></tr></table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;background:#16301f;border-radius:14px;border:1px solid #2f6b4a"><tr><td style="padding:14px 18px">
        <p style="margin:0;font-size:15px;color:#8fe0b0;font-weight:700">You will not be charged for this session.</p>
        <p style="margin:4px 0 0;font-size:14px;color:#b7e8cb">Your seat is still yours for all your other sessions.</p>
      </td></tr></table>
      ${w.known ? '' : '<p style="margin:10px 0 0;font-size:13px;color:#b9a9d9">Times are in UTC. Your player page shows the game in your own time zone.</p>'}
      <p style="margin:22px 0 0;text-align:center"><a href="https://ashtabletop.com/player.html" style="display:inline-block;background:#f2b84f;color:#241407;padding:12px 22px;border-radius:12px;text-decoration:none;font-weight:700;font-size:15px">Open your player page</a></p>
      <p style="margin:20px 0 0;font-size:14px;color:#b9a9d9">${escapeHtml(closing)}</p>
      <p style="margin:14px 0 0">See you at the next one. Roll well!</p>
    </td></tr>
   </table>
  </td></tr></table></body></html>`;
}

// Emails the player about a skip. Real-money games only, like reminders, so
// practice/test players never get a real email.
async function emailSkip(ctx, player, ts, tz, by) {
  if (ctx.mode !== 'live' || !ctx.sendEmail || !player || !player.email) return;
  try {
    await ctx.sendEmail(ctx.env, player.email,
      by === 'admin' ? `Your DM skipped your ${ctx.game.title} session` : `You skipped your ${ctx.game.title} session`,
      skipEmailHtml({ name: player.name, game: ctx.game, ts, tz, by }));
  } catch (err) { console.error('skip email failed', player.email, err && err.message); }
}
