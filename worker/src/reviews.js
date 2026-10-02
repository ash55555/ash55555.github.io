// Player reviews of the DM. After a player has been charged for REVIEW_AFTER
// sessions with Ash (a session they were charged for is a session that ran with
// them in it), they get a "how was your game?" notice and email, and a review
// box under Ash's profile on the player page. One review per player; they can
// edit it later. Ash is told about every new or updated review.

import { verifyUser, cfg, escapeHtml, notify, notifyPlayer } from './pay.js';

export const REVIEW_AFTER = 5;

export const REVIEW_TAGS = [
  'Sets the mood',
  'Always prepared',
  'Great storyteller',
  'Welcoming to everyone',
  'Brings NPCs to life',
  'Keeps the pace moving',
  'Explains rules clearly',
  'Fair and flexible',
  'Makes me feel safe',
  'Rule of cool',
];

function json(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
}

function clean(s, max) {
  return String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
}

// Sessions this player has been charged for, across every game, that were not refunded.
export async function sessionsPlayed(env, mode, uid) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM charges WHERE mode=? AND uid=? AND status='paid' AND refunded_amount < amount").bind(mode, uid).first();
  return r ? r.n : 0;
}

function parseTags(raw) {
  try { const t = JSON.parse(raw || '[]'); return Array.isArray(t) ? t.filter((x) => REVIEW_TAGS.includes(x)) : []; } catch { return []; }
}

export async function handleReview(request, env, corsHeaders, origin, action, sendEmail, verify = verifyUser) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, corsHeaders);
  if (!origin) return json({ error: 'Origin not allowed' }, 403, corsHeaders);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400, corsHeaders); }
  if (!body || !body.idToken) return json({ error: 'Please sign in again.' }, 401, corsHeaders);

  let user;
  try { user = await verify(env, body.idToken); } catch { return json({ error: 'Please sign in again.' }, 401, corsHeaders); }

  const mode = cfg(env).mode;
  try {
    const sessions = await sessionsPlayed(env, mode, user.sub);
    const row = await env.DB.prepare('SELECT rating, tags, comment, updated_at FROM reviews WHERE uid=?').bind(user.sub).first();
    const mine = row ? { rating: row.rating, tags: parseTags(row.tags), comment: row.comment || '', updatedAt: row.updated_at } : null;

    if (action === 'status') {
      return json({ sessions, needed: REVIEW_AFTER, eligible: sessions >= REVIEW_AFTER, tags: REVIEW_TAGS, review: mine }, 200, corsHeaders);
    }

    if (action === 'submit') {
      if (sessions < REVIEW_AFTER) return json({ error: `You can review Ash after ${REVIEW_AFTER} sessions together. You are at ${sessions}.` }, 403, corsHeaders);
      const rating = parseInt(body.rating, 10);
      if (!(rating >= 1 && rating <= 5)) return json({ error: 'Please pick a star rating from 1 to 5.' }, 400, corsHeaders);
      const picked = Array.isArray(body.tags) ? body.tags.filter((t) => REVIEW_TAGS.includes(t)) : [];
      const tags = Array.from(new Set(picked));
      const comment = clean(body.comment, 600);

      const prof = await env.DB.prepare('SELECT name FROM profiles WHERE uid=?').bind(user.sub).first();
      const name = clean((prof && prof.name) || user.name || (user.email || '').split('@')[0] || 'A player', 40);
      const now = new Date().toISOString();
      await env.DB.prepare(
        `INSERT INTO reviews (uid, mode, name, rating, tags, comment, sessions, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(uid) DO UPDATE SET mode=excluded.mode, name=excluded.name, rating=excluded.rating, tags=excluded.tags,
           comment=excluded.comment, sessions=excluded.sessions, updated_at=excluded.updated_at`)
        .bind(user.sub, mode, name, rating, JSON.stringify(tags), comment, sessions, now, now).run();

      await notify(env, sendEmail, mode, 'review', null,
        `${mine ? 'Updated review' : 'New review'}: ${rating}/5 from ${name}`,
        `${name} rated you ${rating} out of 5 after ${sessions} sessions together.\n` +
        `What stood out: ${tags.length ? tags.join(', ') : 'nothing picked'}.` +
        (comment ? `\n"${comment}"` : ''));
      return json({ ok: true, review: { rating, tags, comment, updatedAt: now } }, 200, corsHeaders);
    }
    return json({ error: 'Unknown action' }, 404, corsHeaders);
  } catch (err) {
    return json({ error: err.message || 'Something went wrong.' }, 502, corsHeaders);
  }
}

// Sends the "how was your game?" notice and email, once per player, the first
// time they have played REVIEW_AFTER sessions. Runs on the same 5 minute timer
// as charges and reminders. Real-money games only.
export async function runReviewInvites(env, sendEmail) {
  if (env.REVIEW_INVITES === 'off') return { skipped: 'review invites are off' };
  const mode = cfg(env).mode;
  if (mode !== 'live') return { skipped: 'review invites only go out in real-money mode' };

  const due = (await env.DB.prepare(
    `SELECT c.uid AS uid, COUNT(*) AS n FROM charges c
     WHERE c.mode=? AND c.status='paid' AND c.refunded_amount < c.amount
       AND NOT EXISTS (SELECT 1 FROM notifications nt WHERE nt.uid=c.uid AND nt.kind='review_invite')
       AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.uid=c.uid)
     GROUP BY c.uid HAVING COUNT(*) >= ?`).bind(mode, REVIEW_AFTER).all()).results;

  const testers = String(env.TEST_PLAYER_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  const report = { invited: 0 };
  for (const d of due) {
    const p = await env.DB.prepare(
      `SELECT p.email AS email, p.name AS pname, p.game AS game, pr.name AS name
       FROM players p LEFT JOIN profiles pr ON pr.uid = p.uid
       WHERE p.mode=? AND p.uid=? ORDER BY (p.status='active') DESC, p.joined_at DESC LIMIT 1`).bind(mode, d.uid).first();
    if (!p || !p.email || testers.includes(String(p.email).toLowerCase())) continue;
    const name = p.name || p.pname || '';
    // The notice goes in first: it is also the "already invited" marker, so a
    // failed email can never turn into the same email every 5 minutes.
    await notifyPlayer(env, mode, d.uid, 'review_invite', p.game, 'How was your game?',
      `You have played ${d.n} sessions with Ash. Would you like to rate your experience?`);
    try {
      await sendEmail(env, p.email, `You've played ${d.n} sessions with Ash. How was your game?`,
        reviewInviteEmailHtml({ name, sessions: d.n, url: reviewUrl(p.game) }));
      report.invited++;
    } catch (err) { console.error('review invite email failed', p.email, err && err.message); }
  }
  return report;
}

// Where the email and the notice send the player: their game's page, with the
// review box on Ash's profile already open.
export function reviewUrl(gameKey) {
  const [slug, slot] = String(gameKey || '').split('::');
  return 'https://ashtabletop.com/player.html?campaign=' + encodeURIComponent(slug || '') + (slot ? '&slot=' + encodeURIComponent(slot) : '') + '&review=1';
}

export function reviewInviteEmailHtml({ name, sessions, url }) {
  return `<!doctype html><html><body style="margin:0;background:#120b1c;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
   <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#1c1230;border-radius:20px;overflow:hidden;border:1px solid #3a2a5c">
    <tr><td style="padding:28px 32px 10px;background:linear-gradient(135deg,#3b2a6d,#1c1230)">
      <p style="margin:0;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#f2b84f;font-weight:700">Ash Tabletop</p>
      <h1 style="margin:8px 0 0;font-size:26px;line-height:1.2;color:#ffffff">How was your game?</h1>
    </td></tr>
    <tr><td style="padding:20px 32px 30px;color:#d9cdf2;font-size:16px;line-height:1.55">
      <p style="margin:0 0 16px">Hi ${escapeHtml(name || 'there')}, thank you for being at the table! You have now played with Ash for a while, and Ash would love to hear how it is going.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#2a1d47;border-radius:14px;border:1px solid #4a3877;border-left:4px solid #f2b84f"><tr><td align="center" style="padding:20px 20px 18px">
        <p style="margin:0;font-size:46px;line-height:1;color:#f2b84f;font-weight:700">${escapeHtml(String(sessions))}</p>
        <p style="margin:6px 0 0;font-size:13px;color:#b9a9d9;text-transform:uppercase;letter-spacing:.1em;font-weight:700">sessions played with Ash</p>
        <p style="margin:14px 0 0;font-size:30px;letter-spacing:6px;color:#f2b84f">&#9733;&#9733;&#9733;&#9733;&#9733;</p>
        <p style="margin:6px 0 0;font-size:15px;color:#ffffff;font-weight:700">Would you like to rate your experience?</p>
      </td></tr></table>
      <p style="margin:18px 0 0;font-size:15px">Leave a star rating and tell us what Ash does best, like setting the mood or always coming prepared. Your review goes straight to Ash.</p>
      <p style="margin:22px 0 0;text-align:center"><a href="${escapeHtml(url)}" style="display:inline-block;background:#f2b84f;color:#241407;padding:13px 26px;border-radius:12px;text-decoration:none;font-weight:700;font-size:16px">Rate your experience</a></p>
      <p style="margin:20px 0 0;font-size:14px;color:#b9a9d9;text-align:center">It takes less than a minute, and it is completely optional.</p>
      <p style="margin:14px 0 0">See you at the table. Roll well!</p>
    </td></tr>
   </table>
  </td></tr></table></body></html>`;
}
