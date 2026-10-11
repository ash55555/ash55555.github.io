// Play-by-post: an asynchronous, text-only game with no scheduled sessions at all, so none
// of the recurring per-session billing applies. Joining is one flat payment, once, paid on
// Whop's own secure form exactly like a tip, and a member is simply in or not after that —
// no card is kept on file, nothing is ever charged again.

import { verifyUser, whop, cfg, notify, notifyPlayer } from './pay.js';
import { gmPayoutAccount } from './connect.js';

const DEFAULT_PRICE = 10;
const DOLLAR = String.fromCharCode(36);
const money = (n) => DOLLAR + (Math.round(n * 100) % 100 === 0 ? String(Math.round(n)) : n.toFixed(2));

function json(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
}
const clean = (v, max) => String(v == null ? '' : v).replace(/<[^>]*>/g, ' ').replace(/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').replace(/[ \t]+/g, ' ').trim().slice(0, max);

// The campaign being joined: its price, its owner's payout account, and the Game Master's name.
async function target(env, slug) {
  if (!/^[a-z0-9-]{1,60}$/.test(slug)) return null;
  const row = await env.DB.prepare("SELECT slug, title, type, price, owner_uid, published FROM campaign_content WHERE slug=? AND published=1 AND type='pbp'").bind(slug).first();
  if (!row) return null;
  const account = row.owner_uid ? await gmPayoutAccount(env, row.owner_uid) : cfg(env).company;
  let gmName = 'Ash';
  if (row.owner_uid) {
    const prof = await env.DB.prepare('SELECT data FROM gm_profiles WHERE uid=?').bind(row.owner_uid).first();
    try { gmName = (prof && JSON.parse(prof.data).name) || 'the Game Master'; } catch { gmName = 'the Game Master'; }
  }
  return { slug: row.slug, title: row.title, ownerUid: row.owner_uid || null, price: row.price > 0 ? row.price : DEFAULT_PRICE, account, gmName };
}

async function tellGm(env, sendEmail, mode, m, gameTitle) {
  const title = 'New member: ' + m.from_name;
  const text = m.from_name + ' joined ' + gameTitle + ' for ' + money(m.amount) + '.';
  if (!m.owner_uid) await notify(env, sendEmail, mode, 'pbp_member', m.slug, title, text);
  else await notifyPlayer(env, mode, m.owner_uid, 'pbp_member', m.slug, title, text);
}

// Catches a join Whop confirmed but the browser never saw (the same page-redirect gap tip.js
// covers). Runs on the same 5-minute cron as tips and charges.
export async function runPendingPbp(env, sendEmail) {
  const mode = cfg(env).mode;
  const grace = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const giveUp = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const rows = (await env.DB.prepare("SELECT * FROM pbp_members WHERE mode=? AND status='pending' AND created_at < ? AND created_at > ?").bind(mode, grace, giveUp).all()).results;
  const report = { checked: rows.length, joined: 0 };
  for (const m of rows) {
    const t = await target(env, m.slug);
    if (!t || !t.account) continue;
    const r = await whop(env, '/payments?account_id=' + encodeURIComponent(t.account) + '&first=30&direction=desc');
    if (!r.ok) continue;
    const pay = (r.data.data || []).find((p) => p.checkout_configuration_id === m.config_id || (p.metadata && p.metadata.pbp_id === m.id));
    if (!pay || pay.status !== 'paid' || pay.substatus === 'failed') continue;
    const claim = await env.DB.prepare("UPDATE pbp_members SET status='joined', payment_id=?, joined_at=? WHERE id=? AND status='pending'").bind(pay.id || null, new Date().toISOString(), m.id).run();
    if (claim.meta && claim.meta.changes === 1) {
      report.joined++;
      await tellGm(env, sendEmail, mode, m, t.title);
    }
  }
  return report;
}

// Public: can this play-by-post game take members right now, and for how much?
export async function handlePbpStatus(request, env, corsHeaders) {
  const slug = String(new URL(request.url).searchParams.get('slug') || '').toLowerCase();
  const t = await target(env, slug);
  return new Response(JSON.stringify({ ok: !!(t && t.account), title: t ? t.title : '', price: t ? t.price : 0, gmName: t ? t.gmName : '' }), {
    status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30', ...corsHeaders },
  });
}

export async function handlePbp(request, env, corsHeaders, origin, action, sendEmail, verify = verifyUser) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, corsHeaders);
  if (!origin) return json({ error: 'Origin not allowed' }, 403, corsHeaders);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400, corsHeaders); }
  if (!body || !body.idToken) return json({ error: 'Please sign in again.' }, 401, corsHeaders);
  let user;
  try { user = await verify(env, body.idToken); } catch { return json({ error: 'Please sign in again.' }, 401, corsHeaders); }
  const c = cfg(env);

  // The Game Master sees who has joined their play-by-post game.
  if (action === 'mine') {
    const slug = String(body.slug || '');
    const row = await env.DB.prepare('SELECT owner_uid FROM campaign_content WHERE slug=? AND type=\'pbp\'').bind(slug).first();
    if (!row) return json({ error: 'Not found' }, 404, corsHeaders);
    const isOwner = row.owner_uid ? row.owner_uid === user.sub : user.sub === env.ADMIN_UID;
    if (!isOwner) return json({ error: 'Not authorized' }, 403, corsHeaders);
    const rows = (await env.DB.prepare("SELECT from_name, amount, joined_at FROM pbp_members WHERE mode=? AND slug=? AND status='joined' ORDER BY joined_at DESC").bind(c.mode, slug).all()).results;
    return json({ members: rows.map((r) => ({ name: r.from_name, amount: r.amount, at: r.joined_at })) }, 200, corsHeaders);
  }

  if (action === 'start') {
    const t = await target(env, String(body.slug || '').toLowerCase());
    if (!t) return json({ error: 'That game could not be found.' }, 404, corsHeaders);
    if (t.ownerUid === user.sub) return json({ error: 'You cannot join your own game.' }, 400, corsHeaders);
    if (!t.account) return json({ error: t.gmName + ' has not finished setting up payouts yet, so this game cannot take members yet.' }, 409, corsHeaders);
    const already = await env.DB.prepare("SELECT 1 AS x FROM pbp_members WHERE mode=? AND slug=? AND from_uid=? AND status='joined'").bind(c.mode, t.slug, user.sub).first();
    if (already) return json({ error: 'You have already joined this game.' }, 400, corsHeaders);
    const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM pbp_members WHERE mode=? AND from_uid=? AND created_at > ?').bind(c.mode, user.sub, new Date(Date.now() - 3600000).toISOString()).first();
    if (recent && recent.n >= 10) return json({ error: 'Please wait a little before trying again.' }, 429, corsHeaders);
    const prof = await env.DB.prepare('SELECT name FROM profiles WHERE uid=?').bind(user.sub).first();
    const fromName = clean((prof && prof.name) || user.name || (user.email || '').split('@')[0] || 'A player', 40);
    const id = 'pbp_' + Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(16).padStart(2, '0')).join('');
    const plan = { currency: 'usd', plan_type: 'one_time', initial_price: t.price, title: 'Join ' + t.title, product: { external_identifier: 'ash-tabletop-pbp', title: 'Play-by-post' } };
    const back = 'https://ashtabletop.com/blog/campaign.html?slug=' + encodeURIComponent(t.slug) + '&pbp=thanks&pbp_id=' + encodeURIComponent(id);
    const r = await whop(env, '/checkout_configurations', {
      method: 'POST',
      body: JSON.stringify({ account_id: t.account, redirect_url: back, plan, metadata: { kind: 'pbp', pbp_id: id, from_uid: user.sub, slug: t.slug } }),
    });
    if (!r.ok || !r.data.id) return json({ error: 'Could not start the payment form. Please try again.', detail: r.data }, 502, corsHeaders);
    await env.DB.prepare("INSERT INTO pbp_members (id, mode, slug, owner_uid, from_uid, from_name, amount, status, config_id, created_at) VALUES (?,?,?,?,?,?,?, 'pending', ?, ?)")
      .bind(id, c.mode, t.slug, t.ownerUid, user.sub, fromName, t.price, r.data.id, new Date().toISOString()).run();
    return json({ pbpId: id, configId: r.data.id, environment: c.mode, amount: t.price, title: t.title, email: (user.email || '').toLowerCase() }, 200, corsHeaders);
  }

  if (action === 'confirm') {
    const m = await env.DB.prepare('SELECT * FROM pbp_members WHERE id=? AND from_uid=?').bind(String(body.pbpId || ''), user.sub).first();
    if (!m) return json({ error: 'Not found.' }, 404, corsHeaders);
    if (m.status === 'joined') return json({ ok: true, status: 'joined', amount: m.amount }, 200, corsHeaders);
    const t = await target(env, m.slug);
    if (!t || !t.account) return json({ ok: false, status: 'pending' }, 200, corsHeaders);
    const r = await whop(env, '/payments?account_id=' + encodeURIComponent(t.account) + '&first=30&direction=desc');
    if (!r.ok) return json({ ok: false, status: 'pending' }, 200, corsHeaders);
    const pay = (r.data.data || []).find((p) => p.checkout_configuration_id === m.config_id || (p.metadata && p.metadata.pbp_id === m.id));
    if (!pay || pay.status !== 'paid' || pay.substatus === 'failed') return json({ ok: false, status: 'pending' }, 200, corsHeaders);
    const claim = await env.DB.prepare("UPDATE pbp_members SET status='joined', payment_id=?, joined_at=? WHERE id=? AND status='pending'").bind(pay.id || null, new Date().toISOString(), m.id).run();
    if (claim.meta && claim.meta.changes === 1) await tellGm(env, sendEmail, c.mode, m, t.title);
    return json({ ok: true, status: 'joined', amount: m.amount }, 200, corsHeaders);
  }

  return json({ error: 'Not found' }, 404, corsHeaders);
}
