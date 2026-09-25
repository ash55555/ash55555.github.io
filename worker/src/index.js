// Sends game-announcement emails to everyone in Firebase's "subscribers"
// list. Lives outside Firebase entirely (see worker/README.md for why:
// Firebase Cloud Functions needs the paid Blaze plan, and Google's billing
// system would not let Ash's account onto it).
//
// admin.html is the only caller. It already knows the full subscriber list
// (it's allowed to read all of "subscribers" per the database rules) and
// Ash's own Firebase ID token, so this Worker never touches Firebase itself
// — it just verifies that ID token really belongs to Ash before sending
// anything, then hands each email to the email API.

import { createRemoteJWKSet, jwtVerify } from 'jose';

const FIREBASE_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

export default {
  async fetch(request, env) {
    const allowedOrigins = env.ALLOWED_ORIGIN.split(',').map((o) => o.trim());
    const requestOrigin = request.headers.get('Origin');
    const originOk = allowedOrigins.includes(requestOrigin);
    const corsHeaders = {
      'Access-Control-Allow-Origin': originOk ? requestOrigin : allowedOrigins[0],
      'Vary': 'Origin',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    if (url.pathname === '/verify-recaptcha') {
      return handleVerifyRecaptcha(request, env, corsHeaders);
    }
    if (url.pathname === '/welcome-email') {
      return handleWelcomeEmail(request, env, corsHeaders);
    }
    if (url.pathname === '/whop/checkout') {
      return handleWhopCheckout(request, env, corsHeaders, originOk ? requestOrigin : null);
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, corsHeaders);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400, corsHeaders);
    }

    const { idToken, subject, html, emails } = body || {};
    if (!idToken || !subject || !html || !Array.isArray(emails) || emails.length === 0) {
      return json({ error: 'Missing idToken, subject, html, or emails' }, 400, corsHeaders);
    }

    try {
      const jwks = createRemoteJWKSet(new URL(FIREBASE_JWKS_URL));
      const { payload } = await jwtVerify(idToken, jwks, {
        issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
        audience: env.FIREBASE_PROJECT_ID,
      });

      if (payload.sub !== env.ADMIN_UID) {
        return json({ error: 'Not authorized' }, 403, corsHeaders);
      }
    } catch {
      return json({ error: 'Invalid or expired sign-in. Log out and back into admin.html, then try again.' }, 401, corsHeaders);
    }

    const uniqueEmails = Array.from(
      new Set(emails.filter((e) => typeof e === 'string' && e.includes('@')))
    );
    if (uniqueEmails.length === 0) {
      return json({ error: 'No valid recipient emails' }, 400, corsHeaders);
    }

    const results = await Promise.allSettled(
      uniqueEmails.map((to) => sendEmail(env, to, subject, html))
    );
    const sent = results.filter((r) => r.status === 'fulfilled').length;
    // Surfaced back to admin.html so a failure shows *why*, not just a count
    // — otherwise every failure looks identical and there's no way to tell
    // "bad address" from "sandbox domain restriction" from "API key expired".
    const errors = results
      .map((r, i) => (r.status === 'rejected' ? `${uniqueEmails[i]}: ${r.reason.message}` : null))
      .filter(Boolean);

    return json({ sent, failed: results.length - sent, total: uniqueEmails.length, errors }, 200, corsHeaders);
  },
};

// Checks a reCAPTCHA v2 ("I'm not a robot") response token against Google.
// RECAPTCHA_SECRET_KEY must never reach the browser, so this check has to
// happen here rather than client-side — same reasoning as the ID token
// verification above.
async function handleVerifyRecaptcha(request, env, corsHeaders) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, corsHeaders);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, corsHeaders);
  }

  const token = body && body.token;
  if (!token) {
    return json({ error: 'Missing token' }, 400, corsHeaders);
  }

  const verifyResponse = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `secret=${encodeURIComponent(env.RECAPTCHA_SECRET_KEY)}&response=${encodeURIComponent(token)}`,
  });
  const result = await verifyResponse.json();

  return json({ success: !!result.success }, 200, corsHeaders);
}

function json(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

// Resend (https://resend.com). EMAIL_API_KEY is set via
// `wrangler secret put EMAIL_API_KEY`, never stored in this file.
//
const FROM_ADDRESS = 'Ash Tabletop <announcements@mail.ashtabletop.com>';

async function sendEmail(env, to, subject, html) {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.EMAIL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [to],
      subject,
      html,
      text,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Resend send failed (${response.status}): ${detail}`);
  }
}

// Sends a one-time welcome email right after someone signs up, so they get
// proof it worked. Only ever sends to the email address baked into the
// caller's own verified Firebase ID token (payload.email) — never an
// address passed in the request body — so this can't be abused to spam
// arbitrary addresses. Any signed-in user can call this for themselves,
// unlike the announcement endpoint above which is admin-only.
async function handleWelcomeEmail(request, env, corsHeaders) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, corsHeaders);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, corsHeaders);
  }

  const { idToken } = body || {};
  if (!idToken) {
    return json({ error: 'Missing idToken' }, 400, corsHeaders);
  }

  let email;
  try {
    const jwks = createRemoteJWKSet(new URL(FIREBASE_JWKS_URL));
    const { payload } = await jwtVerify(idToken, jwks, {
      issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
      audience: env.FIREBASE_PROJECT_ID,
    });
    email = payload.email;
  } catch {
    return json({ error: 'Invalid or expired sign-in' }, 401, corsHeaders);
  }

  if (!email) {
    return json({ error: 'No email on this account' }, 400, corsHeaders);
  }

  try {
    await sendEmail(
      env,
      email,
      "You're on the list!",
      `<h2>Welcome to Ash Tabletop 🎲</h2><p>You're officially signed up for game alerts. You'll get an email the moment Ash opens a new campaign or session.</p><p>See you at the table!</p>`
    );
  } catch (err) {
    return json({ sent: false, error: err.message }, 200, corsHeaders);
  }

  return json({ sent: true }, 200, corsHeaders);
}

// ---------------------------------------------------------------------------
// Whop checkout for a game group. The schedule and price live HERE, not in the
// browser, so a visitor can never change what they get charged. Each player
// gets a personal checkout with a free trial that runs until the group's next
// game, after which Whop charges weekly (7 days) from then on.
// ---------------------------------------------------------------------------
const GAMES = {
  'crooked-moon::B': {
    title: 'The Crooked Moon - Group B (Saturdays 12:00 AM GMT+1)',
    day: 6, hour: 0, minute: 0, offset: 1,
    price: 10,
  },
};

const DAY_MS = 24 * 60 * 60 * 1000;

function nextGameStart(game, now) {
  const utcHour = game.hour - game.offset;
  const targetDay = (game.day + (utcHour < 0 ? -1 : 0) + 7) % 7;
  for (let i = 0; i < 9; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i, utcHour, game.minute));
    if (d.getUTCDay() === targetDay && d.getTime() > now.getTime()) return d;
  }
  return null;
}

async function handleWhopCheckout(request, env, corsHeaders, origin) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, corsHeaders);
  if (!origin) return json({ error: 'Origin not allowed' }, 403, corsHeaders);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400, corsHeaders); }
  const { idToken, game: gameKey } = body || {};
  const game = GAMES[gameKey];
  if (!idToken || !game) return json({ error: 'Missing sign-in or unknown game' }, 400, corsHeaders);

  let user;
  try {
    const jwks = createRemoteJWKSet(new URL(FIREBASE_JWKS_URL));
    const { payload } = await jwtVerify(idToken, jwks, {
      issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
      audience: env.FIREBASE_PROJECT_ID,
    });
    user = payload;
  } catch {
    return json({ error: 'Please sign in again.' }, 401, corsHeaders);
  }

  // Test phase: only listed players (plus the admin) can start a checkout.
  const allowed = (env.TEST_PLAYER_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  const email = (user.email || '').toLowerCase();
  if (user.sub !== env.ADMIN_UID && !allowed.includes(email)) {
    return json({ error: 'Joining online is not open to everyone yet. Please message Ash.' }, 403, corsHeaders);
  }

  const now = new Date();
  const start = nextGameStart(game, now);
  const trialDays = Math.max(1, Math.round((start.getTime() - now.getTime()) / DAY_MS));

  const response = await fetch('https://api.whop.com/api/v1/checkout_configurations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.WHOP_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      plan: {
        company_id: env.WHOP_COMPANY_ID,
        product_id: env.WHOP_PRODUCT_ID,
        currency: 'usd',
        plan_type: 'renewal',
        release_method: 'buy_now',
        billing_period: 7,
        initial_price: 0,
        renewal_price: game.price,
        trial_period_days: trialDays,
        visibility: 'hidden',
      },
      metadata: { uid: user.sub, email, game: gameKey },
      redirect_url: `${origin}/player.html${body.returnQuery || ''}`,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return json({ error: 'Could not start checkout.', detail: data }, 502, corsHeaders);
  }
  const url = data.purchase_url && data.purchase_url.startsWith('http') ? data.purchase_url : `https://whop.com${data.purchase_url}`;
  return json({ url, firstChargeAt: new Date(now.getTime() + trialDays * DAY_MS).toISOString(), gameStart: start.toISOString(), trialDays }, 200, corsHeaders);
}
