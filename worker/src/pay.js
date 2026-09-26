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

// Schedule, price and seat limit live HERE, never in the browser.
// legacyFilled = players who are already in this group through the old
// PayPal system (not in this database), so seats are not oversold.
export const PAY_GAMES = {
  'crooked-moon::B': {
    title: 'The Crooked Moon, Group B',
    day: 6, hour: 0, minute: 0, offset: 1,
    price: 10,
    max: 5,
    legacyFilled: 3,
  },
};

// ---------------------------------------------------------------- utilities

function json(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function cfg(env) {
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

async function verifyUser(env, idToken) {
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

function upcoming(game, from, count) {
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

const iso = (d) => d.toISOString();
const chargeKey = (mode, game, uid, ts) => `${mode}|${game}|${uid}|${ts}`;

async function activeCount(env, mode, gameKey) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM players WHERE mode=? AND game=? AND status='active'").bind(mode, gameKey).first();
  return r ? r.n : 0;
}

function seatInfo(game, online) {
  const filled = game.legacyFilled + online;
  return { filled, max: game.max, open: Math.max(0, game.max - filled) };
}

function cleanName(name, email) {
  const n = String(name || '').replace(/[<>]/g, '').trim().slice(0, 30);
  return n || (email || 'Player').split('@')[0].slice(0, 30);
}

// ------------------------------------------------------------------ routing

export async function handlePay(request, env, corsHeaders, origin, action, sendEmail) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, corsHeaders);
  if (!origin) return json({ error: 'Origin not allowed' }, 403, corsHeaders);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400, corsHeaders); }
  if (!body || !body.idToken) return json({ error: 'Please sign in again.' }, 401, corsHeaders);

  let user;
  try { user = await verifyUser(env, body.idToken); } catch { return json({ error: 'Please sign in again.' }, 401, corsHeaders); }

  const isAdminRoute = action.startsWith('admin/');
  if (isAdminRoute) {
    if (user.sub !== env.ADMIN_UID) return json({ error: 'Not authorized' }, 403, corsHeaders);
  } else if (!isAllowed(env, user)) {
    return json({ error: 'Joining online is not open to everyone yet. Please message Ash.' }, 403, corsHeaders);
  }

  const gameKey = body.game;
  const game = PAY_GAMES[gameKey];
  if (!game) return json({ error: 'Unknown game' }, 400, corsHeaders);

  const ctx = { env, user, body, gameKey, game, origin, mode: cfg(env).mode, corsHeaders, sendEmail };
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
  }
  return doStatus(ctx);
}

// ---------------------------------------------------------- player: status

async function doStatus(ctx) {
  const { env, user, gameKey, game, corsHeaders } = ctx;
  const now = new Date();
  const online = await activeCount(env, ctx.mode, gameKey);
  const seats = seatInfo(game, online);
  const roster = (await env.DB.prepare("SELECT name, token, uid FROM players WHERE mode=? AND game=? AND status='active' ORDER BY joined_at").bind(ctx.mode, gameKey).all()).results
    .map((p) => ({ name: p.name, token: p.token || '', you: p.uid === user.sub }));
  const me = await getPlayer(ctx);
  const base = { seats, roster, price: game.price, mode: ctx.mode };
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
    await env.DB.prepare('INSERT OR IGNORE INTO skips (mode, game, uid, session_ts, by, created_at) VALUES (?,?,?,?,?,?)')
      .bind(ctx.mode, gameKey, user.sub, ts, 'player', iso(now)).run();
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
  return json({ joined: false, left: true }, 200, corsHeaders);
}

// ------------------------------------------------------------------- admin

async function adminRoster(ctx) {
  const { env, gameKey, game, corsHeaders } = ctx;
  const now = new Date();
  const players = (await env.DB.prepare('SELECT * FROM players WHERE mode=? AND game=? ORDER BY status, joined_at').bind(ctx.mode, gameKey).all()).results;
  const skips = (await env.DB.prepare('SELECT uid, session_ts, by FROM skips WHERE mode=? AND game=?').bind(ctx.mode, gameKey).all()).results;
  const charges = (await env.DB.prepare('SELECT * FROM charges WHERE mode=? AND game=? ORDER BY session_ts DESC LIMIT 200').bind(ctx.mode, gameKey).all()).results;
  const sessions = upcoming(game, now, SESSIONS_SHOWN).map(iso);
  const pastSessions = sessionsBetween(game, new Date(now.getTime() - 28 * DAY_MS), now).map(iso).reverse();
  return json({
    mode: ctx.mode,
    charging: env.CHARGING_MODE || 'off',
    game: { key: gameKey, title: game.title, price: game.price, max: game.max, legacyFilled: game.legacyFilled },
    seats: seatInfo(game, players.filter((p) => p.status === 'active').length),
    sessions,
    pastSessions,
    players: players.map((p) => ({
      uid: p.uid, email: p.email, name: p.name, status: p.status, joinedAt: p.joined_at,
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
    await env.DB.prepare('INSERT INTO skips (mode, game, uid, session_ts, by, created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(mode, game, uid, session_ts) DO UPDATE SET by=excluded.by')
      .bind(ctx.mode, gameKey, uid, ts, 'admin', iso(now)).run();
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

async function adminRemove(ctx) {
  const { env, body, gameKey, corsHeaders } = ctx;
  const uid = String(body.uid || '');
  await env.DB.prepare("UPDATE players SET status='left', left_at=? WHERE mode=? AND game=? AND uid=?").bind(iso(new Date()), ctx.mode, gameKey, uid).run();
  return json({ ok: true }, 200, corsHeaders);
}

// -------------------------------------------------------- the charging timer

export async function runCharges(env, sendEmail) {
  const mode = env.CHARGING_MODE || 'off';
  if (mode === 'off') return { skipped: 'charging is off' };
  const c = cfg(env);
  const now = new Date();
  const report = { charged: 0, failed: 0, wouldCharge: 0, checked: 0 };

  for (const [gameKey, game] of Object.entries(PAY_GAMES)) {
    const players = (await env.DB.prepare("SELECT * FROM players WHERE mode=? AND game=? AND status='active'").bind(c.mode, gameKey).all()).results;
    const sessions = sessionsBetween(game, new Date(now.getTime() - CATCH_UP_MS), now).map(iso);

    for (const p of players) {
      for (const ts of sessions) {
        // Never charge for a session that started before the player joined.
        if (ts <= p.joined_at) continue;
        const skipped = await env.DB.prepare('SELECT 1 AS x FROM skips WHERE mode=? AND game=? AND uid=? AND session_ts=?').bind(c.mode, gameKey, p.uid, ts).first();
        if (skipped) continue;
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
        if (r.ok && classify(r.data) === 'paid') report.charged++; else report.failed++;
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
  if (cardDeclined) await emailDeclined(env, sendEmail, p, game);
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
        return;
      }
    }
    return;
  }
  // No payment id was ever recorded: we cannot be sure whether money moved.
  // Flag it for Ash rather than risk a double charge.
  await env.DB.prepare("UPDATE charges SET status='unknown', last_error='Charge started but the result was not recorded. Check Whop before retrying.', updated_at=? WHERE mode=? AND game=? AND uid=? AND session_ts=?")
    .bind(iso(now), c.mode, row.game, row.uid, row.session_ts).run();
}

function classify(d) {
  if (d && d.status === 'paid' && d.substatus !== 'failed') return 'paid';
  if (d && (d.substatus === 'failed' || d.failure_message)) return 'failed';
  return 'pending';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
