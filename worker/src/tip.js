// Tips: a player can leave a Game Master (or Ash) a tip, paid once on Whop's own secure form. The money goes straight
// to that Game Master's account (Ash's own account for Ash). A tip is only recorded as paid after the Worker has asked
// Whop and seen that the payment really succeeded.

import { verifyUser, whop, cfg, notify, notifyPlayer } from './pay.js';
import { gmPayoutAccount } from './connect.js';

const MIN_TIP = 1;
const MAX_TIP = 200;
// Ash Tabletop takes no share of tips: all of it goes to the Game Master (Whop's own payment fee still applies).
const TIP_FEE_RATE = 0;
const DOLLAR = String.fromCharCode(36);
const money = (n) => DOLLAR + (Math.round(n * 100) % 100 === 0 ? String(Math.round(n)) : n.toFixed(2));

function json(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
}
const clean = (v, max) => String(v == null ? '' : v).replace(/<[^>]*>/g, ' ').replace(/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').replace(/[ \t]+/g, ' ').trim().slice(0, max);

// Who is being tipped, and which Whop account the money goes to (null when they cannot take tips yet).
async function target(env, slug) {
  if (slug === 'ash') {
    const d = await env.DB.prepare('SELECT data FROM gm_profiles WHERE slug=?').bind('ash').first();
    let name = 'Ash';
    try { name = JSON.parse((d && d.data) || '{}').name || 'Ash'; } catch { name = 'Ash'; }
    return { slug: 'ash', uid: env.ADMIN_UID, name, account: cfg(env).company, own: true };
  }
  if (!/^[a-z0-9-]{1,40}$/.test(slug)) return null;
  const row = await env.DB.prepare('SELECT uid, data FROM gm_profiles WHERE slug=?').bind(slug).first();
  if (!row) return null;
  let name = 'Game Master';
  try { name = JSON.parse(row.data).name || name; } catch { /* keep the default */ }
  return { slug, uid: row.uid, name, account: await gmPayoutAccount(env, row.uid), own: false };
}

// Public: can this Game Master take tips right now?
export async function handleTipStatus(request, env, corsHeaders) {
  const slug = String(new URL(request.url).searchParams.get('slug') || '').toLowerCase();
  const t = await target(env, slug);
  return new Response(JSON.stringify({ ok: !!(t && t.account), name: t ? t.name : '', min: MIN_TIP, max: MAX_TIP }), {
    status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30', ...corsHeaders },
  });
}

export async function handleTip(request, env, corsHeaders, origin, action, sendEmail, verify = verifyUser) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, corsHeaders);
  if (!origin) return json({ error: 'Origin not allowed' }, 403, corsHeaders);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400, corsHeaders); }
  if (!body || !body.idToken) return json({ error: 'Please sign in again.' }, 401, corsHeaders);
  let user;
  try { user = await verify(env, body.idToken); } catch { return json({ error: 'Please sign in again.' }, 401, corsHeaders); }
  const c = cfg(env);

  // A Game Master (or Ash) sees the tips they received.
  if (action === 'mine') {
    const rows = (await env.DB.prepare("SELECT from_name, amount, message, paid_at FROM tips WHERE mode=? AND gm_uid=? AND status='paid' ORDER BY paid_at DESC LIMIT 60").bind(c.mode, user.sub).all()).results;
    const total = rows.reduce((n, r) => n + r.amount, 0);
    return json({ tips: rows.map((r) => ({ from: r.from_name, amount: r.amount, message: r.message || '', at: r.paid_at })), total: Math.round(total * 100) / 100 }, 200, corsHeaders);
  }

  if (action === 'start') {
    const t = await target(env, String(body.slug || '').toLowerCase());
    if (!t) return json({ error: 'That Game Master was not found.' }, 404, corsHeaders);
    if (t.uid === user.sub) return json({ error: 'You cannot tip yourself.' }, 400, corsHeaders);
    if (!t.account) return json({ error: t.name + ' cannot take tips yet.' }, 409, corsHeaders);
    const amount = Math.round(Number(body.amount) * 100) / 100;
    if (!(amount >= MIN_TIP && amount <= MAX_TIP)) return json({ error: 'A tip can be from ' + money(MIN_TIP) + ' to ' + money(MAX_TIP) + '.' }, 400, corsHeaders);
    // a handful of unfinished tips an hour is plenty for one person
    const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM tips WHERE mode=? AND from_uid=? AND created_at > ?').bind(c.mode, user.sub, new Date(Date.now() - 3600000).toISOString()).first();
    if (recent && recent.n >= 10) return json({ error: 'Please wait a little before starting another tip.' }, 429, corsHeaders);
    const prof = await env.DB.prepare('SELECT name FROM profiles WHERE uid=?').bind(user.sub).first();
    const fromName = clean((prof && prof.name) || user.name || (user.email || '').split('@')[0] || 'A player', 40);
    const message = clean(body.message, 200);
    const id = 'tip_' + Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(16).padStart(2, '0')).join('');
    const fee = Math.round(amount * TIP_FEE_RATE * 100) / 100;
    const plan = {
      currency: 'usd', plan_type: 'one_time', initial_price: amount, title: 'Tip for ' + t.name,
      ...(fee > 0 && fee < amount ? { application_fee_amount: fee } : {}),
      ...(t.own ? {} : { product: { external_identifier: 'ash-tabletop-tip', title: 'Tip' } }),
    };
    const back = t.slug === 'ash' ? 'https://ashtabletop.com/ash.html?tip=thanks' : 'https://ashtabletop.com/gm.html?slug=' + encodeURIComponent(t.slug) + '&tip=thanks';
    const r = await whop(env, '/checkout_configurations', {
      method: 'POST',
      body: JSON.stringify({ account_id: t.account, redirect_url: back, plan, metadata: { kind: 'tip', tip_id: id, from_uid: user.sub, gm_slug: t.slug } }),
    });
    if (!r.ok || !r.data.id) return json({ error: 'Could not start the tip form. Please try again.', detail: r.data }, 502, corsHeaders);
    await env.DB.prepare("INSERT INTO tips (id, mode, gm_slug, gm_uid, from_uid, from_name, amount, message, status, config_id, created_at) VALUES (?,?,?,?,?,?,?,?, 'pending', ?, ?)")
      .bind(id, c.mode, t.slug, t.uid, user.sub, fromName, amount, message, r.data.id, new Date().toISOString()).run();
    return json({ tipId: id, configId: r.data.id, environment: c.mode, amount, name: t.name, email: (user.email || '').toLowerCase() }, 200, corsHeaders);
  }

  if (action === 'confirm') {
    const tip = await env.DB.prepare('SELECT * FROM tips WHERE id=? AND from_uid=?').bind(String(body.tipId || ''), user.sub).first();
    if (!tip) return json({ error: 'Tip not found.' }, 404, corsHeaders);
    if (tip.status === 'paid') return json({ ok: true, status: 'paid' }, 200, corsHeaders);
    const t = await target(env, tip.gm_slug);
    if (!t || !t.account) return json({ ok: false, status: 'pending' }, 200, corsHeaders);
    const r = await whop(env, '/payments?account_id=' + encodeURIComponent(t.account) + '&first=30&direction=desc');
    if (!r.ok) return json({ ok: false, status: 'pending' }, 200, corsHeaders);
    const pay = (r.data.data || []).find((p) => p.checkout_configuration_id === tip.config_id || (p.metadata && p.metadata.tip_id === tip.id));
    if (!pay || pay.status !== 'paid' || pay.substatus === 'failed') return json({ ok: false, status: 'pending' }, 200, corsHeaders);
    // Only the first request to see the paid payment records it (and tells the Game Master).
    const claim = await env.DB.prepare("UPDATE tips SET status='paid', payment_id=?, paid_at=? WHERE id=? AND status='pending'").bind(pay.id || null, new Date().toISOString(), tip.id).run();
    if (claim.meta && claim.meta.changes === 1) {
      const title = 'Tip: ' + money(tip.amount) + ' from ' + tip.from_name;
      const text = tip.from_name + ' tipped you ' + money(tip.amount) + '.' + (tip.message ? ' They wrote: ' + tip.message : '');
      if (tip.gm_slug === 'ash') await notify(env, sendEmail, c.mode, 'tip', null, title, text);
      else await notifyPlayer(env, c.mode, tip.gm_uid, 'tip', null, title, text);
    }
    return json({ ok: true, status: 'paid' }, 200, corsHeaders);
  }

  return json({ error: 'Not found' }, 404, corsHeaders);
}
