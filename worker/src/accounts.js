// Tells Ash the first time a brand-new account shows up on the site.
//
// Accounts are created in a few places (the sign-up window on the home page,
// Google sign-in from a game page...), so rather than trusting each of them to
// say "I just made an account", the Worker checks the first time it ever sees
// someone: it asks Firebase when the account was created, and if that was
// minutes ago, Ash gets a notification (and an email). Anyone who already had an
// account before this existed is quietly marked as seen and never announced.

import { cfg, notify } from './pay.js';

const NEW_WINDOW_MS = 30 * 60 * 1000;

async function lookupAccount(env, idToken) {
  if (!env.FIREBASE_API_KEY || !idToken) return null;
  try {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    if (!res.ok) return null;
    const d = await res.json().catch(() => null);
    return d && d.users && d.users[0] ? d.users[0] : null;
  } catch { return null; }
}

// Never throws and never slows anything down after the first time it sees an account.
export async function noteAccount(env, sendEmail, user, idToken) {
  try {
    if (!user || !user.sub || user.sub === env.ADMIN_UID) return;
    const seen = await env.DB.prepare('SELECT 1 AS x FROM accounts_seen WHERE uid=?').bind(user.sub).first();
    if (seen) return;

    // If Firebase cannot be reached right now, leave the account unseen so the next visit tries again.
    const u = await lookupAccount(env, idToken);
    if (!u) return;

    const email = String(u.email || user.email || '').toLowerCase();
    const claim = await env.DB.prepare('INSERT OR IGNORE INTO accounts_seen (uid, email, seen_at) VALUES (?,?,?)')
      .bind(user.sub, email, new Date().toISOString()).run();
    // Only the first of several near-simultaneous requests gets to announce it.
    if (!claim.meta || claim.meta.changes !== 1) return;

    const created = u.createdAt ? parseInt(u.createdAt, 10) : 0;
    if (!created || Date.now() - created > NEW_WINDOW_MS) return;

    const providers = (u.providerUserInfo || []).map((p) => p.providerId);
    const how = providers.includes('google.com') ? 'Google' : providers.includes('password') ? 'an email and password' : 'their email';
    const name = String(u.displayName || user.name || '').trim();
    await notify(env, sendEmail, cfg(env).mode, 'new_account', null, `New account: ${email}`,
      `${name ? name + ' ' : ''}(${email}) just created an account on your website with ${how}.`);
  } catch (err) { console.error('new account check failed', err && err.message); }
}
