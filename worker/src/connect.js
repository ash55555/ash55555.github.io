// Getting a Game Master paid: each GM has their own Whop "connected account" under Ash Tabletop.
// The GM verifies who they are and adds their bank details on Whop's own pages (we never see
// them). Once Whop approves, players' payments for that GM's games go to the GM's account, and
// Ash Tabletop's 5% is taken automatically on each payment (the "application fee").
//
// This file only handles the GM's side of setting that up: create the account, send them to
// Whop's verification page, show where they are, and open their payouts portal.

import { verifyUser, whop } from './pay.js';
import { gmStatus } from './gm.js';

const SITE = 'https://ashtabletop.com';

function json(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
}
const nice = (data) => {
  const e = data && data.error;
  if (typeof e === 'string' && e) return e;
  if (e && typeof e === 'object') return e.message || JSON.stringify(e);
  return (data && data.message) || 'Whop could not do that right now.';
};

// Where is this GM in the setup? none -> verify -> review -> ready
export function stateFrom(account) {
  const v = (account && account.verification) || {};
  const cap = (account && account.capabilities) || {};
  const ind = v.individual, biz = v.business;
  const approved = ind === 'approved' || biz === 'approved';
  const rejected = ind === 'rejected' || biz === 'rejected';
  const reviewing = ['pending', 'manual_review'].includes(ind) || ['pending', 'manual_review'].includes(biz);
  const payoutsOk = ['active', 'pending'].includes(cap.standard_payout);
  const cardsOk = cap.accept_card_payments === 'active';
  if (approved && cardsOk && payoutsOk) return 'ready';
  if (approved) return 'review';
  if (rejected) return 'rejected';
  if (reviewing) return 'review';
  return 'verify';
}

export async function handleConnect(request, env, corsHeaders, origin, action, verify = verifyUser) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, corsHeaders);
  if (!origin) return json({ error: 'Origin not allowed' }, 403, corsHeaders);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400, corsHeaders); }
  if (!body || !body.idToken) return json({ error: 'Please sign in again.' }, 401, corsHeaders);
  let user;
  try { user = await verify(env, body.idToken); } catch { return json({ error: 'Please sign in again.' }, 401, corsHeaders); }
  const st = await gmStatus(env, user.sub);
  if (!st.isGm) return json({ error: 'This is for Game Masters.' }, 403, corsHeaders);
  // Ash's own money already works through her own Whop account.
  if (st.isAdmin) return json({ state: 'owner' }, 200, corsHeaders);

  const row = await env.DB.prepare('SELECT account_id FROM gm_accounts WHERE uid=?').bind(user.sub).first();

  if (action === 'status') {
    if (!row) return json({ state: 'none' }, 200, corsHeaders);
    // Reading an account's verification and payout capabilities needs the "read balance" permission, which
    // lives on its own read-only key (the key that moves money is never used for this).
    const key = env.WHOP_CONNECT_API_KEY || env.WHOP_BALANCE_API_KEY;
    let r = null;
    if (key) {
      const res = await fetch(`https://api.whop.com/api/v1/accounts/${encodeURIComponent(row.account_id)}`, { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } });
      r = { ok: res.ok, data: await res.json().catch(() => ({})) };
    }
    // If Whop will not tell us (a missing permission or a hiccup), the GM is not blocked: they can still
    // continue on Whop or open their payouts, and we say plainly that we could not check.
    if (!r || !r.ok) return json({ state: 'unknown' }, 200, corsHeaders);
    return json({ state: stateFrom(r.data), verification: r.data.verification || null }, 200, corsHeaders);
  }

  // Whop asks for the "read balance" permission on the key that opens a GM's verification or payouts page.
  // That permission lives on the read-only key, so it is the one used here (it cannot move money).
  const link = async (accountId, useCase) => {
    const payload = JSON.stringify({ account_id: accountId, use_case: useCase, refresh_url: `${SITE}/admin.html#tab=gmfinance`, return_url: `${SITE}/admin.html#tab=gmfinance` });
    const tryWith = async (key) => {
      const res = await fetch('https://api.whop.com/api/v1/account_links', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: payload });
      return { ok: res.ok, data: await res.json().catch(() => ({})) };
    };
    // The dedicated GM-setup key comes first; the older read-only key is only a fallback.
    let r = env.WHOP_CONNECT_API_KEY ? await tryWith(env.WHOP_CONNECT_API_KEY) : (env.WHOP_BALANCE_API_KEY ? await tryWith(env.WHOP_BALANCE_API_KEY) : null);
    if (!r || !r.ok || !r.data.url) {
      const first = r;
      r = await whop(env, '/account_links', { method: 'POST', body: payload });
      if ((!r.ok || !r.data.url) && first) return { error: nice(first.data) + ' / ' + nice(r.data) };
    }
    if (!r.ok || !r.data.url) return { error: nice(r.data) };
    return { url: r.data.url };
  };

  if (action === 'start') {
    let accountId = row && row.account_id;
    if (!accountId) {
      const email = String(user.email || '').toLowerCase();
      const prof = await env.DB.prepare('SELECT data FROM gm_profiles WHERE uid=?').bind(user.sub).first();
      let title = '';
      try { title = prof ? JSON.parse(prof.data).name : ''; } catch { title = ''; }
      title = (title || (user.name || email.split('@')[0] || 'Game Master')) + ' (Ash Tabletop GM)';
      const r = await whop(env, '/accounts', { method: 'POST', body: JSON.stringify({ email, title: title.slice(0, 80), metadata: { uid: user.sub, role: 'gm' } }) });
      if (!r.ok || !r.data.id) return json({ error: nice(r.data) }, 502, corsHeaders);
      accountId = r.data.id;
      await env.DB.prepare('INSERT INTO gm_accounts (uid, account_id, email, created_at) VALUES (?,?,?,?)').bind(user.sub, accountId, email, new Date().toISOString()).run();
    }
    const l = await link(accountId, 'account_onboarding');
    if (l.error) return json({ error: l.error }, 502, corsHeaders);
    return json({ url: l.url }, 200, corsHeaders);
  }

  if (action === 'portal') {
    if (!row) return json({ error: 'Set up your payouts first.' }, 400, corsHeaders);
    const l = await link(row.account_id, 'payouts_portal');
    if (l.error) return json({ error: l.error }, 502, corsHeaders);
    return json({ url: l.url }, 200, corsHeaders);
  }

  return json({ error: 'Not found' }, 404, corsHeaders);
}
