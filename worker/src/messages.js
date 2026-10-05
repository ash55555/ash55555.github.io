// In-site messages between people on the site (a player writing to a Game Master, and the
// GM answering back). Every signed-in person has a Messages section. Nothing here shows up
// in the Notifications tab: a new message is an unread count in Messages, plus an email.
//
// Safety rules:
//  - Only signed-in people can send.
//  - A new conversation can only be started with a Game Master (a GM profile page has the button).
//    After that, either side can answer.
//  - Plain text only, 1000 characters, 20 messages an hour per person.
//  - Either side can report a conversation; the report goes straight to Ash.

import { verifyUser, cfg, notify, escapeHtml } from './pay.js';
import { gmStatus } from './gm.js';

const MAX_TEXT = 1000;
const PER_HOUR = 20;
const EMAIL_GAP_MS = 10 * 60 * 1000; // at most one email per conversation every 10 minutes
const SITE = 'https://ashtabletop.com';

function json(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
}
const clean = (v, max) => String(v == null ? '' : v).replace(/<[^>]*>/g, ' ').replace(/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const convKey = (a, b) => [a, b].sort().join('|');

async function isGmUid(env, uid) {
  if ((await gmStatus(env, uid)).isGm) return true;
  const row = await env.DB.prepare('SELECT 1 AS x FROM gm_profiles WHERE uid=?').bind(uid).first();
  return !!row;
}

// Name, picture and (for GMs) profile page of each person, for the lists and thread headers.
async function people(env, origin, uids) {
  const out = {};
  for (const uid of uids) {
    const prof = await env.DB.prepare('SELECT name, token, avatar_id, email FROM profiles WHERE uid=?').bind(uid).first();
    const gm = await env.DB.prepare('SELECT slug, data FROM gm_profiles WHERE uid=?').bind(uid).first();
    let gmName = '';
    if (gm) { try { gmName = JSON.parse(gm.data).name || ''; } catch { gmName = ''; } }
    const emailName = prof && prof.email ? String(prof.email).split('@')[0] : '';
    out[uid] = {
      uid,
      name: gmName || (prof && prof.name) || emailName || 'Player',
      token: (prof && prof.token) || 'wizard',
      avatarUrl: prof && prof.avatar_id ? `${origin}/profile/avatar/${prof.avatar_id}` : null,
      isGm: uid === env.ADMIN_UID || !!gm || (await gmStatus(env, uid)).isGm,
      slug: uid === env.ADMIN_UID ? 'ash' : (gm ? gm.slug : null),
    };
  }
  return out;
}

async function emailFor(env, uid) {
  if (uid === env.ADMIN_UID && env.ADMIN_NOTIFY_EMAIL) return env.ADMIN_NOTIFY_EMAIL;
  const p = await env.DB.prepare('SELECT email FROM profiles WHERE uid=?').bind(uid).first();
  if (p && p.email) return p.email;
  const a = await env.DB.prepare('SELECT email FROM accounts_seen WHERE uid=?').bind(uid).first();
  return a && a.email ? a.email : '';
}

function emailHtml(fromName, text, link) {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#241a3d">
        <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#9b6dff;font-weight:700">New message</p>
        <h2 style="margin:0 0 12px">${escapeHtml(fromName)} sent you a message</h2>
        <p style="line-height:1.55;background:#f6f1ff;border-radius:12px;padding:12px 14px">${escapeHtml(text.length > 280 ? text.slice(0, 280) + '...' : text).replace(/\n/g, '<br>')}</p>
        <p><a href="${link}" style="display:inline-block;background:#f2b84f;color:#241407;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:700">Open your messages</a></p>
        <p style="font-size:12px;color:#7a6c99">You can answer from the Messages section on Ash Tabletop. Please do not reply to this email.</p>
      </div>`;
}

export async function handleMessages(request, env, corsHeaders, origin, action, sendEmail, verify = verifyUser) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, corsHeaders);
  if (!origin) return json({ error: 'Origin not allowed' }, 403, corsHeaders);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400, corsHeaders); }
  if (!body || !body.idToken) return json({ error: 'Please sign in again.' }, 401, corsHeaders);
  let user;
  try { user = await verify(env, body.idToken); } catch { return json({ error: 'Please sign in again.' }, 401, corsHeaders); }
  const self = new URL(request.url).origin;
  const me = user.sub;

  try {
    if (action === 'unread') {
      const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM messages WHERE to_uid=? AND read_at IS NULL').bind(me).first();
      return json({ unread: row ? row.n : 0 }, 200, corsHeaders);
    }

    if (action === 'list') {
      const rows = (await env.DB.prepare(
        `SELECT conv, MAX(id) AS last_id, SUM(CASE WHEN to_uid=? AND read_at IS NULL THEN 1 ELSE 0 END) AS unread
         FROM messages WHERE from_uid=? OR to_uid=? GROUP BY conv ORDER BY last_id DESC LIMIT 60`).bind(me, me, me).all()).results;
      const lastRows = {};
      for (const r of rows) lastRows[r.conv] = await env.DB.prepare('SELECT from_uid, to_uid, body, created_at FROM messages WHERE id=?').bind(r.last_id).first();
      const others = [...new Set(rows.map((r) => { const m = lastRows[r.conv]; return m.from_uid === me ? m.to_uid : m.from_uid; }))];
      const who = await people(env, self, others);
      const total = rows.reduce((n, r) => n + (r.unread || 0), 0);
      return json({
        unread: total,
        conversations: rows.map((r) => {
          const m = lastRows[r.conv];
          const other = m.from_uid === me ? m.to_uid : m.from_uid;
          return { with: who[other], preview: m.body.slice(0, 120), mine: m.from_uid === me, at: m.created_at, unread: r.unread || 0 };
        }),
      }, 200, corsHeaders);
    }

    if (action === 'thread') {
      const other = String(body.with || '');
      if (!other) return json({ error: 'Missing person.' }, 400, corsHeaders);
      const conv = convKey(me, other);
      const rows = (await env.DB.prepare('SELECT id, from_uid, body, created_at FROM messages WHERE conv=? ORDER BY id DESC LIMIT 200').bind(conv).all()).results.reverse();
      await env.DB.prepare('UPDATE messages SET read_at=? WHERE conv=? AND to_uid=? AND read_at IS NULL').bind(new Date().toISOString(), conv, me).run();
      const who = await people(env, self, [other]);
      return json({ with: who[other], messages: rows.map((m) => ({ id: m.id, mine: m.from_uid === me, text: m.body, at: m.created_at })) }, 200, corsHeaders);
    }

    if (action === 'send') {
      const text = clean(body.text, MAX_TEXT);
      if (!text) return json({ error: 'Please write a message first.' }, 400, corsHeaders);

      // who is it for?
      let to = '';
      if (body.toSlug) {
        const slug = String(body.toSlug).toLowerCase();
        if (slug === 'ash') to = env.ADMIN_UID;
        else {
          const row = await env.DB.prepare('SELECT uid FROM gm_profiles WHERE slug=?').bind(slug).first();
          to = row ? row.uid : '';
        }
        if (!to) return json({ error: 'That Game Master could not be found.' }, 404, corsHeaders);
      } else if (body.toUid) {
        to = String(body.toUid);
      }
      if (!to || to === me) return json({ error: 'Please choose who to write to.' }, 400, corsHeaders);

      const conv = convKey(me, to);
      const existing = await env.DB.prepare('SELECT 1 AS x FROM messages WHERE conv=? LIMIT 1').bind(conv).first();
      if (!existing && !(await isGmUid(env, to))) {
        return json({ error: 'You can start a conversation with a Game Master from their profile page.' }, 403, corsHeaders);
      }
      const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM messages WHERE from_uid=? AND created_at > ?').bind(me, new Date(Date.now() - 3600000).toISOString()).first();
      if (recent && recent.n >= PER_HOUR) return json({ error: 'You are sending messages very fast. Please wait a little and try again.' }, 429, corsHeaders);

      const now = new Date().toISOString();
      await env.DB.prepare('INSERT INTO messages (conv, from_uid, to_uid, body, created_at) VALUES (?,?,?,?,?)').bind(conv, me, to, text, now).run();

      // email the other person (not more than once every 10 minutes per conversation)
      if (sendEmail) {
        try {
          const gap = await env.DB.prepare('SELECT last_at FROM message_emails WHERE conv=? AND to_uid=?').bind(conv, to).first();
          if (!gap || Date.now() - new Date(gap.last_at).getTime() > EMAIL_GAP_MS) {
            const addr = await emailFor(env, to);
            if (addr) {
              const who = await people(env, self, [me, to]);
              const link = who[to].isGm ? `${SITE}/admin.html#tab=messages` : `${SITE}/profile.html#me-messages`;
              await sendEmail(env, addr, `New message from ${who[me].name}`, emailHtml(who[me].name, text, link));
              await env.DB.prepare('INSERT INTO message_emails (conv, to_uid, last_at) VALUES (?,?,?) ON CONFLICT(conv, to_uid) DO UPDATE SET last_at=excluded.last_at').bind(conv, to, now).run();
            }
          }
        } catch (err) { console.error('message email failed', err && err.message); }
      }
      return json({ ok: true, with: to }, 200, corsHeaders);
    }

    if (action === 'report') {
      const other = String(body.with || '');
      if (!other) return json({ error: 'Missing person.' }, 400, corsHeaders);
      const conv = convKey(me, other);
      const last = (await env.DB.prepare('SELECT from_uid, body, created_at FROM messages WHERE conv=? ORDER BY id DESC LIMIT 5').bind(conv).all()).results.reverse();
      if (!last.length) return json({ error: 'There is nothing to report yet.' }, 400, corsHeaders);
      const who = await people(env, self, [me, other]);
      const lines = last.map((m) => `${who[m.from_uid] ? who[m.from_uid].name : 'Someone'}: ${m.body}`).join('\n');
      await notify(env, sendEmail, cfg(env).mode, 'report', null, `Message report from ${who[me].name}`,
        `${who[me].name} reported their conversation with ${who[other].name}.\n\nLast messages:\n${lines}`);
      return json({ ok: true }, 200, corsHeaders);
    }
  } catch (err) {
    console.error('messages error', err && err.message);
    return json({ error: 'Something went wrong. Please try again.' }, 500, corsHeaders);
  }
  return json({ error: 'Not found' }, 404, corsHeaders);
}
