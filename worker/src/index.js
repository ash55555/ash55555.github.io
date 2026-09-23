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
    const corsHeaders = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
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

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, corsHeaders);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400, corsHeaders);
    }

    const { idToken, subject, message, emails } = body || {};
    if (!idToken || !subject || !message || !Array.isArray(emails) || emails.length === 0) {
      return json({ error: 'Missing idToken, subject, message, or emails' }, 400, corsHeaders);
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
      uniqueEmails.map((to) => sendEmail(env, to, subject, message))
    );
    const sent = results.filter((r) => r.status === 'fulfilled').length;

    return json({ sent, failed: results.length - sent, total: uniqueEmails.length }, 200, corsHeaders);
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
// FROM_ADDRESS uses Resend's shared sandbox domain, which only delivers to
// the Resend account's own verified email — real subscribers won't receive
// anything until a real domain is verified in the Resend dashboard and
// FROM_ADDRESS below is updated to use it.
const FROM_ADDRESS = 'Ash Tabletop <onboarding@resend.dev>';

async function sendEmail(env, to, subject, message) {
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
      text: message,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Resend send failed (${response.status}): ${detail}`);
  }
}
