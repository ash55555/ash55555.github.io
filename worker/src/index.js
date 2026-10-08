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
import { handlePay, handleSeats, handleRoster, runCharges } from './pay.js';
import { handleProfile, handleAvatar } from './profile.js';
import { handleGm } from './gm.js';
import { handleHome } from './home.js';
import { handleTip, handleTipStatus, runPendingTips } from './tip.js';
import { handleMessages } from './messages.js';
import { handleDmAgreement, runAgreementReminders } from './dm-agreement.js';
import { handleConnect } from './connect.js';
import { runReminders } from './reminders.js';
import { handleReview, handleReviewsPublic, runReviewInvites } from './reviews.js';
import { noteAccount } from './accounts.js';
import { handleContentAdmin, handleContentPublic, handleContentPublicList, handleContentBanner } from './content.js';

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
      return handleVerifyRecaptcha(request, env, corsHeaders, originOk);
    }
    if (url.pathname === '/welcome-email') {
      return handleWelcomeEmail(request, env, corsHeaders, originOk);
    }
    if (url.pathname.startsWith('/profile/avatar/') && request.method === 'GET') {
      return handleAvatar(request, env, corsHeaders, url.pathname.slice('/profile/avatar/'.length));
    }
    if (url.pathname.startsWith('/profile/')) {
      return handleProfile(request, env, corsHeaders, originOk ? requestOrigin : null, url.pathname.slice('/profile/'.length), sendEmail);
    }
    if (url.pathname.startsWith('/connect/')) {
      return handleConnect(request, env, corsHeaders, originOk ? requestOrigin : null, url.pathname.slice('/connect/'.length));
    }
    if (url.pathname.startsWith('/dmagree/')) {
      return handleDmAgreement(request, env, corsHeaders, originOk ? requestOrigin : null, url.pathname.slice('/dmagree/'.length), sendEmail);
    }
    if (url.pathname.startsWith('/msg/')) {
      return handleMessages(request, env, corsHeaders, originOk ? requestOrigin : null, url.pathname.slice('/msg/'.length), sendEmail);
    }
    if (url.pathname === '/tip/status' && request.method === 'GET') {
      return handleTipStatus(request, env, corsHeaders);
    }
    if (url.pathname.startsWith('/tip/')) {
      return handleTip(request, env, corsHeaders, originOk ? requestOrigin : null, url.pathname.slice('/tip/'.length), sendEmail);
    }
    if (url.pathname === '/home/public' && request.method === 'GET') {
      return handleHome(request, env, corsHeaders);
    }
    if (url.pathname.startsWith('/gm/')) {
      return handleGm(request, env, corsHeaders, originOk ? requestOrigin : null, url.pathname.slice('/gm/'.length));
    }
    if (url.pathname === '/review/public' && request.method === 'GET') {
      return handleReviewsPublic(request, env, corsHeaders);
    }
    if (url.pathname.startsWith('/review/')) {
      return handleReview(request, env, corsHeaders, originOk ? requestOrigin : null, url.pathname.slice('/review/'.length), sendEmail);
    }
    if (url.pathname.startsWith('/content/banner/') && request.method === 'GET') {
      return handleContentBanner(request, env, corsHeaders, url.pathname.slice('/content/banner/'.length));
    }
    if (url.pathname === '/content/public-list' && request.method === 'GET') {
      return handleContentPublicList(request, env, corsHeaders);
    }
    if (url.pathname === '/content/public' && request.method === 'GET') {
      return handleContentPublic(request, env, corsHeaders);
    }
    if (url.pathname.startsWith('/content/admin/')) {
      return handleContentAdmin(request, env, corsHeaders, originOk ? requestOrigin : null, url.pathname.slice('/content/admin/'.length));
    }
    if (url.pathname === '/pay/roster' && request.method === 'GET') {
      return handleRoster(request, env, corsHeaders);
    }
    if (url.pathname === '/pay/seats' && request.method === 'GET') {
      return handleSeats(request, env, corsHeaders);
    }
    if (url.pathname.startsWith('/pay/')) {
      return handlePay(request, env, corsHeaders, originOk ? requestOrigin : null, url.pathname.slice(5), sendEmail);
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

  // Runs every 5 minutes (see wrangler.toml). Charges players for sessions that
  // have just started. CHARGING_MODE is the kill switch.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runCharges(env, sendEmail)
        .then((r) => console.log('charge run', JSON.stringify(r)))
        .catch((err) => console.error('charge run failed', err && err.message))
        .then(() => runReminders(env, sendEmail))
        .then((r) => console.log('reminder run', JSON.stringify(r)))
        .catch((err) => console.error('reminder run failed', err && err.message))
        .then(() => runReviewInvites(env, sendEmail))
        .then((r) => console.log('review invite run', JSON.stringify(r)))
        .catch((err) => console.error('review invite run failed', err && err.message))
        .then(() => runAgreementReminders(env, sendEmail))
        .then((r) => console.log('agreement reminder run', JSON.stringify(r)))
        .catch((err) => console.error('agreement reminder run failed', err && err.message))
        .then(() => runPendingTips(env, sendEmail))
        .then((r) => console.log('pending tips run', JSON.stringify(r)))
        .catch((err) => console.error('pending tips run failed', err && err.message))
    );
  },
};

// Checks a reCAPTCHA v2 ("I'm not a robot") response token against Google.
// RECAPTCHA_SECRET_KEY must never reach the browser, so this check has to
// happen here rather than client-side — same reasoning as the ID token
// verification above.
async function handleVerifyRecaptcha(request, env, corsHeaders, originOk) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, corsHeaders);
  }
  if (!originOk) {
    return json({ error: 'Origin not allowed' }, 403, corsHeaders);
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

async function sendEmail(env, to, subject, html, extra) {
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
      ...(extra || {}), // for example { attachments: [...] }
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
async function handleWelcomeEmail(request, env, corsHeaders, originOk) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, corsHeaders);
  }
  if (!originOk) {
    return json({ error: 'Origin not allowed' }, 403, corsHeaders);
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
  let claims;
  try {
    const jwks = createRemoteJWKSet(new URL(FIREBASE_JWKS_URL));
    const { payload } = await jwtVerify(idToken, jwks, {
      issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
      audience: env.FIREBASE_PROJECT_ID,
    });
    email = payload.email;
    claims = payload;
  } catch {
    return json({ error: 'Invalid or expired sign-in' }, 401, corsHeaders);
  }

  if (!email) {
    return json({ error: 'No email on this account' }, 400, corsHeaders);
  }

  // A sign-up from the home page lands here first, so tell Ash right away.
  await noteAccount(env, sendEmail, { sub: claims.sub, email, name: claims.name }, idToken);

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

