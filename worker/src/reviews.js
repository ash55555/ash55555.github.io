// Player reviews of the DM. After a player has been charged for REVIEW_AFTER
// sessions with Ash (a session they were charged for is a session that ran with
// them in it), they get a "how was your game?" notice and email, and a review
// box under Ash's profile on the player page. One review per player; they can
// edit it later. Ash is told about every new or updated review.

import { verifyUser, cfg, escapeHtml, notify, notifyPlayer } from './pay.js';
import { gmStatus } from './gm.js';

export const REVIEW_AFTER = 5;

// Sessions at another Game Master's tables never count towards a review of Ash (or an invite to write one).
const NOT_A_GM_GAME = "NOT EXISTS (SELECT 1 FROM campaign_content cc WHERE cc.owner_uid IS NOT NULL AND (charges.game = cc.slug OR charges.game LIKE cc.slug || '::%'))";

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
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM charges WHERE mode=? AND uid=? AND status='paid' AND refunded_amount < amount AND " + NOT_A_GM_GAME).bind(mode, uid).first();
  return r ? r.n : 0;
}

// Sessions this player was charged for at one Game Master's tables (their own campaigns only).
async function sessionsWithGm(env, mode, uid, gmUid) {
  const slugs = (await env.DB.prepare('SELECT slug FROM campaign_content WHERE owner_uid=?').bind(gmUid).all()).results;
  let n = 0;
  for (const c of slugs) {
    const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM charges WHERE mode=? AND uid=? AND status='paid' AND refunded_amount < amount AND (game=? OR game LIKE ?)").bind(mode, uid, c.slug, c.slug + '::%').first();
    n += r ? r.n : 0;
  }
  return n;
}

// The Game Master a review is about, from the name on their profile page. Ash is the default.
async function gmByName(env, name) {
  if (!name || name === 'ash') return null;
  return (await env.DB.prepare('SELECT uid, slug, data FROM gm_profiles WHERE slug=?').bind(name).first()) || null;
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
  const self = new URL(request.url).origin;
  try {
    // Ash sees every review of hers, and another Game Master sees only the reviews of them.
    if (action === 'admin/list' || action === 'admin/delete') {
      const who = await gmStatus(env, user.sub, user);
      if (!who.isGm) return json({ error: 'Not authorized' }, 403, corsHeaders);
      if (!who.isAdmin) {
        if (action === 'admin/list') {
          const rows = (await env.DB.prepare(
            `SELECT r.uid, r.name, r.rating, r.tags, r.comment, r.sessions, r.show_public, r.created_at, r.updated_at, pr.token AS token, pr.avatar_id AS avatar_id
             FROM gm_reviews r LEFT JOIN profiles pr ON pr.uid = r.uid WHERE r.gm_uid=? ORDER BY r.updated_at DESC LIMIT 200`).bind(user.sub).all()).results;
          return json({
            reviews: rows.map((r) => ({
              uid: r.uid, name: r.name, rating: r.rating, tags: parseTags(r.tags), comment: r.comment || '', sessions: r.sessions,
              shown: r.show_public !== 0, createdAt: r.created_at, updatedAt: r.updated_at, token: r.token || '',
              avatar: r.avatar_id ? `${self}/profile/avatar/${r.avatar_id}` : null,
            })),
          }, 200, corsHeaders);
        }
        const target = String(body.uid || '');
        if (!target) return json({ error: 'Missing review.' }, 400, corsHeaders);
        await env.DB.prepare('DELETE FROM gm_reviews WHERE gm_uid=? AND uid=?').bind(user.sub, target).run();
        return json({ ok: true }, 200, corsHeaders);
      }
      if (action === 'admin/list') {
        const rows = (await env.DB.prepare(
          `SELECT r.uid, r.name, r.rating, r.tags, r.comment, r.sessions, r.show_public, r.created_at, r.updated_at, pr.token AS token, pr.avatar_id AS avatar_id
           FROM reviews r LEFT JOIN profiles pr ON pr.uid = r.uid ORDER BY r.updated_at DESC LIMIT 200`).all()).results;
        return json({
          reviews: rows.map((r) => ({
            uid: r.uid, name: r.name, rating: r.rating, tags: parseTags(r.tags), comment: r.comment || '', sessions: r.sessions,
            shown: r.show_public !== 0, createdAt: r.created_at, updatedAt: r.updated_at, token: r.token || '',
            avatar: r.avatar_id ? `${self}/profile/avatar/${r.avatar_id}` : null,
          })),
        }, 200, corsHeaders);
      }
      const target = String(body.uid || '');
      if (!target) return json({ error: 'Missing review.' }, 400, corsHeaders);
      await env.DB.prepare('DELETE FROM reviews WHERE uid=?').bind(target).run();
      return json({ ok: true }, 200, corsHeaders);
    }

    // A review of another Game Master (the page says which one by their profile name).
    const gm = await gmByName(env, String(body.gm || ''));
    if (String(body.gm || '') && String(body.gm) !== 'ash' && !gm) return json({ error: 'That Game Master was not found.' }, 404, corsHeaders);
    if (gm) {
      if (gm.uid === user.sub) return json({ error: 'You cannot review yourself.' }, 400, corsHeaders);
      const played = await sessionsWithGm(env, mode, user.sub, gm.uid);
      const can = played >= REVIEW_AFTER;
      const mineRow = await env.DB.prepare('SELECT rating, tags, comment, updated_at, show_public FROM gm_reviews WHERE gm_uid=? AND uid=?').bind(gm.uid, user.sub).first();
      const mineGm = mineRow ? { rating: mineRow.rating, tags: parseTags(mineRow.tags), comment: mineRow.comment || '', show: mineRow.show_public !== 0, updatedAt: mineRow.updated_at } : null;
      let prof = {};
      try { prof = JSON.parse(gm.data || '{}') || {}; } catch { prof = {}; }
      if (action === 'status') {
        return json({ sessions: played, needed: REVIEW_AFTER, eligible: can, testMode: false, tags: REVIEW_TAGS, review: mineGm, dm: { name: prof.name || 'Your Game Master', token: 'dragon', avatar: null, pronouns: prof.pronouns || '' } }, 200, corsHeaders);
      }
      if (action === 'delete') {
        await env.DB.prepare('DELETE FROM gm_reviews WHERE gm_uid=? AND uid=?').bind(gm.uid, user.sub).run();
        return json({ ok: true }, 200, corsHeaders);
      }
      if (action === 'submit') {
        if (!can) return json({ error: `You can review this Game Master after ${REVIEW_AFTER} sessions together. You are at ${played}.` }, 403, corsHeaders);
        const rating = parseInt(body.rating, 10);
        if (!(rating >= 1 && rating <= 5)) return json({ error: 'Please pick a star rating from 1 to 5.' }, 400, corsHeaders);
        const tags = Array.from(new Set(Array.isArray(body.tags) ? body.tags.filter((t) => REVIEW_TAGS.includes(t)) : []));
        const comment = clean(body.comment, 600);
        const show = body.show === false ? 0 : 1;
        const pr = await env.DB.prepare('SELECT name FROM profiles WHERE uid=?').bind(user.sub).first();
        const name = clean((pr && pr.name) || user.name || (user.email || '').split('@')[0] || 'A player', 40);
        const now = new Date().toISOString();
        await env.DB.prepare(
          `INSERT INTO gm_reviews (gm_uid, uid, mode, name, rating, tags, comment, sessions, show_public, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(gm_uid, uid) DO UPDATE SET mode=excluded.mode, name=excluded.name, rating=excluded.rating, tags=excluded.tags,
             comment=excluded.comment, sessions=excluded.sessions, show_public=excluded.show_public, updated_at=excluded.updated_at`)
          .bind(gm.uid, user.sub, mode, name, rating, JSON.stringify(tags), comment, played, show, now, now).run();
        // Tell that Game Master (not Ash) on their own dashboard.
        await notifyPlayer(env, mode, gm.uid, 'review', null,
          `${mineGm ? 'Updated review' : 'New review'}: ${rating}/5 from ${name}`,
          `${name} rated you ${rating} out of 5 after ${played} sessions together.` + (tags.length ? ` What stood out: ${tags.join(', ')}.` : '') + (comment ? ` "${comment}"` : '') + (show ? ' It is shown on your page.' : ' They chose to keep it private.'));
        return json({ ok: true, review: { rating, tags, comment, show: !!show, updatedAt: now } }, 200, corsHeaders);
      }
      return json({ error: 'Unknown action' }, 404, corsHeaders);
    }

    const sessions = await sessionsPlayed(env, mode, user.sub);
    // Ash's own account can always open the box, so the whole thing can be tried out for real.
    const testMode = user.sub === env.ADMIN_UID;
    const eligible = testMode || sessions >= REVIEW_AFTER;
    const row = await env.DB.prepare('SELECT rating, tags, comment, updated_at, show_public FROM reviews WHERE uid=?').bind(user.sub).first();
    const mine = row ? { rating: row.rating, tags: parseTags(row.tags), comment: row.comment || '', show: row.show_public !== 0, updatedAt: row.updated_at } : null;

    if (action === 'status') {
      // Ash's public card (same name, picture and pronouns anyone sees at the table).
      const d = await env.DB.prepare('SELECT name, token, avatar_id, pronouns FROM profiles WHERE uid=?').bind(env.ADMIN_UID).first();
      const dm = { name: (d && d.name) || 'Ash', token: (d && d.token) || 'dragon', avatar: d && d.avatar_id ? `${self}/profile/avatar/${d.avatar_id}` : null, pronouns: (d && d.pronouns) || '' };
      return json({ sessions, needed: REVIEW_AFTER, eligible, testMode, tags: REVIEW_TAGS, review: mine, dm }, 200, corsHeaders);
    }

    // A player can always take their own review back down (only their own, keyed by who they are signed in as).
    if (action === 'delete') {
      await env.DB.prepare('DELETE FROM reviews WHERE uid=?').bind(user.sub).run();
      return json({ ok: true }, 200, corsHeaders);
    }

    if (action === 'submit') {
      if (!eligible) return json({ error: `You can review Ash after ${REVIEW_AFTER} sessions together. You are at ${sessions}.` }, 403, corsHeaders);
      const rating = parseInt(body.rating, 10);
      if (!(rating >= 1 && rating <= 5)) return json({ error: 'Please pick a star rating from 1 to 5.' }, 400, corsHeaders);
      const picked = Array.isArray(body.tags) ? body.tags.filter((t) => REVIEW_TAGS.includes(t)) : [];
      const tags = Array.from(new Set(picked));
      const comment = clean(body.comment, 600);
      // Shown on the website unless the player unticks the box.
      const show = body.show === false ? 0 : 1;

      const prof = await env.DB.prepare('SELECT name FROM profiles WHERE uid=?').bind(user.sub).first();
      const name = clean((prof && prof.name) || user.name || (user.email || '').split('@')[0] || 'A player', 40);
      const now = new Date().toISOString();
      await env.DB.prepare(
        `INSERT INTO reviews (uid, mode, name, rating, tags, comment, sessions, show_public, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(uid) DO UPDATE SET mode=excluded.mode, name=excluded.name, rating=excluded.rating, tags=excluded.tags,
           comment=excluded.comment, sessions=excluded.sessions, show_public=excluded.show_public, updated_at=excluded.updated_at`)
        .bind(user.sub, mode, name, rating, JSON.stringify(tags), comment, sessions, show, now, now).run();

      await notify(env, sendEmail, mode, 'review', null,
        `${mine ? 'Updated review' : 'New review'}: ${rating}/5 from ${name}`,
        `${name} rated you ${rating} out of 5 after ${sessions} sessions together.\n` +
        `What stood out: ${tags.length ? tags.join(', ') : 'nothing picked'}.` +
        (comment ? `\n"${comment}"` : '') +
        (show ? '\nIt is shown on your website.' : '\nThey chose to keep it private, so it is not on your website.'));
      return json({ ok: true, review: { rating, tags, comment, show: !!show, updatedAt: now } }, 200, corsHeaders);
    }
    return json({ error: 'Unknown action' }, 404, corsHeaders);
  } catch (err) {
    return json({ error: err.message || 'Something went wrong.' }, 502, corsHeaders);
  }
}

// Public (no sign-in): the reviews players chose to show on the website, newest first.
// Only the name, picture, stars, qualities and comment go out, nothing else.
export async function handleReviewsPublic(request, env, corsHeaders) {
  const mode = cfg(env).mode;
  const self = new URL(request.url).origin;
  // ?gm=their-profile-name gives that Game Master's reviews; with no name it is Ash's.
  const gmName = String(new URL(request.url).searchParams.get('gm') || '');
  const gm = await gmByName(env, gmName);
  if (gmName && gmName !== 'ash' && !gm) return new Response(JSON.stringify({ reviews: [] }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60', ...corsHeaders } });
  const rows = gm
    ? (await env.DB.prepare(
      `SELECT r.name, r.rating, r.tags, r.comment, pr.token AS token, pr.avatar_id AS avatar_id
       FROM gm_reviews r LEFT JOIN profiles pr ON pr.uid = r.uid
       WHERE r.gm_uid=? AND r.mode=? AND r.show_public=1 ORDER BY r.updated_at DESC LIMIT 30`).bind(gm.uid, mode).all()).results
    : (await env.DB.prepare(
      `SELECT r.name, r.rating, r.tags, r.comment, pr.token AS token, pr.avatar_id AS avatar_id
       FROM reviews r LEFT JOIN profiles pr ON pr.uid = r.uid
       WHERE r.mode=? AND r.show_public=1 ORDER BY r.updated_at DESC LIMIT 30`).bind(mode).all()).results;
  const reviews = rows.map((r) => ({
    name: r.name, rating: r.rating, tags: parseTags(r.tags), comment: r.comment || '', token: r.token || '',
    avatar: r.avatar_id ? `${self}/profile/avatar/${r.avatar_id}` : null,
  }));
  return new Response(JSON.stringify({ reviews }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60', ...corsHeaders },
  });
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
       AND NOT EXISTS (SELECT 1 FROM campaign_content cc WHERE cc.owner_uid IS NOT NULL AND (c.game = cc.slug OR c.game LIKE cc.slug || '::%'))
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
        reviewInviteEmailHtml({ name, sessions: d.n, url: reviewUrl() }));
      report.invited++;
    } catch (err) { console.error('review invite email failed', p.email, err && err.message); }
  }
  return report;
}

// Where the email and the notice send the player: the Review Ash tab on their profile page.
export function reviewUrl() {
  return 'https://ashtabletop.com/profile.html#me-review';
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
      <p style="margin:18px 0 0;font-size:15px">Leave a star rating and tell us what Ash does best, like setting the mood or always coming prepared. Your review goes to Ash, and you choose whether it also appears on the website.</p>
      <p style="margin:22px 0 0;text-align:center"><a href="${escapeHtml(url)}" style="display:inline-block;background:#f2b84f;color:#241407;padding:13px 26px;border-radius:12px;text-decoration:none;font-weight:700;font-size:16px">Rate your experience</a></p>
      <p style="margin:20px 0 0;font-size:14px;color:#b9a9d9;text-align:center">It takes less than a minute, and it is completely optional.</p>
      <p style="margin:14px 0 0">See you at the table. Roll well!</p>
    </td></tr>
   </table>
  </td></tr></table></body></html>`;
}
