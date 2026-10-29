// Player reviews of the DM. After a player has been charged for REVIEW_AFTER
// session with Ash (a session they were charged for is a session that ran with
// them in it), they get a "how was your game?" notice and email, and a review
// box under Ash's profile on the player page. One review per player; they can
// edit it later. Ash is told about every new or updated review.

import { verifyUser, cfg, escapeHtml, notify, notifyPlayer } from './pay.js';
import { gmStatus } from './gm.js';

export const REVIEW_AFTER = 1;
// A review can name at most this many qualities, so a long list of ticks never decides the picture.
export const MAX_TAGS = 3;

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

// Every other Game Master this player has been charged for at least one session with, and how many.
async function gmsPlayedWith(env, mode, uid) {
  return (await env.DB.prepare(
    `SELECT cc.owner_uid AS gm_uid, COUNT(*) AS n FROM charges c
     JOIN campaign_content cc ON (c.game = cc.slug OR c.game LIKE cc.slug || '::%')
     WHERE c.mode=? AND c.uid=? AND c.status='paid' AND c.refunded_amount < c.amount AND cc.owner_uid IS NOT NULL
     GROUP BY cc.owner_uid`).bind(mode, uid).all()).results;
}

// A Game Master's picture as a plain image address, the same way pay.js and home.js serve it.
function gmAvatarUrl(self, slug, prof) {
  return String((prof && prof.avatar) || '').startsWith('data:image/') ? `${self}/gm/avatar?slug=${encodeURIComponent(slug)}` : null;
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
  // A Game Master's own share link (gathered from their Reviews tab) lets anyone signed in
  // post a review of them, without needing to have played a session together first.
  const viaLink = body.viaLink === true;
  try {
    // Every Game Master a player has been charged for at least one session with, Ash included,
    // so the player's own profile page can list them all and open a review box for each.
    if (action === 'mine') {
      const list = [];
      const ashSessions = await sessionsPlayed(env, mode, user.sub);
      const ashTest = user.sub === env.ADMIN_UID;
      if (ashSessions >= 1 || ashTest) {
        const d = await env.DB.prepare('SELECT name, token, avatar_id, pronouns FROM profiles WHERE uid=?').bind(env.ADMIN_UID).first();
        const row = await env.DB.prepare('SELECT rating, tags, comment, updated_at, show_public FROM reviews WHERE uid=?').bind(user.sub).first();
        const mine = row ? { rating: row.rating, tags: parseTags(row.tags), comment: row.comment || '', show: row.show_public !== 0, updatedAt: row.updated_at } : null;
        list.push({
          key: 'ash', name: (d && d.name) || 'Ash', token: (d && d.token) || 'dragon',
          avatar: d && d.avatar_id ? `${self}/profile/avatar/${d.avatar_id}` : null, pronouns: (d && d.pronouns) || '',
          sessions: ashSessions, needed: REVIEW_AFTER, eligible: ashTest || ashSessions >= REVIEW_AFTER, testMode: ashTest, tags: REVIEW_TAGS, maxTags: MAX_TAGS, review: mine,
        });
      }
      const gmRows = await gmsPlayedWith(env, mode, user.sub);
      for (const row of gmRows) {
        if (!row.gm_uid || row.gm_uid === user.sub) continue;
        const g = await env.DB.prepare('SELECT slug, data FROM gm_profiles WHERE uid=?').bind(row.gm_uid).first();
        if (!g) continue;
        let prof = {}; try { prof = JSON.parse(g.data || '{}') || {}; } catch { prof = {}; }
        const mineRow = await env.DB.prepare('SELECT rating, tags, comment, updated_at, show_public FROM gm_reviews WHERE gm_uid=? AND uid=?').bind(row.gm_uid, user.sub).first();
        const mine = mineRow ? { rating: mineRow.rating, tags: parseTags(mineRow.tags), comment: mineRow.comment || '', show: mineRow.show_public !== 0, updatedAt: mineRow.updated_at } : null;
        list.push({
          key: g.slug, name: prof.name || 'Your Game Master', token: 'dragon', avatar: gmAvatarUrl(self, g.slug, prof), pronouns: prof.pronouns || '',
          sessions: row.n, needed: REVIEW_AFTER, eligible: row.n >= REVIEW_AFTER, tags: REVIEW_TAGS, maxTags: MAX_TAGS, review: mine,
        });
      }
      return json({ dms: list }, 200, corsHeaders);
    }

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
      const can = viaLink || played >= REVIEW_AFTER;
      const mineRow = await env.DB.prepare('SELECT rating, tags, comment, updated_at, show_public FROM gm_reviews WHERE gm_uid=? AND uid=?').bind(gm.uid, user.sub).first();
      const mineGm = mineRow ? { rating: mineRow.rating, tags: parseTags(mineRow.tags), comment: mineRow.comment || '', show: mineRow.show_public !== 0, updatedAt: mineRow.updated_at } : null;
      let prof = {};
      try { prof = JSON.parse(gm.data || '{}') || {}; } catch { prof = {}; }
      if (action === 'status') {
        return json({ sessions: played, needed: REVIEW_AFTER, eligible: can, testMode: false, viaLink, tags: REVIEW_TAGS, maxTags: MAX_TAGS, review: mineGm, dm: { name: prof.name || 'Your Game Master', token: 'dragon', avatar: gmAvatarUrl(self, gm.slug, prof), pronouns: prof.pronouns || '' } }, 200, corsHeaders);
      }
      if (action === 'delete') {
        await env.DB.prepare('DELETE FROM gm_reviews WHERE gm_uid=? AND uid=?').bind(gm.uid, user.sub).run();
        return json({ ok: true }, 200, corsHeaders);
      }
      if (action === 'submit') {
        if (!can) return json({ error: `You can review this Game Master after ${REVIEW_AFTER} session together. You are at ${played}.` }, 403, corsHeaders);
        const rating = parseInt(body.rating, 10);
        if (!(rating >= 1 && rating <= 5)) return json({ error: 'Please pick a star rating from 1 to 5.' }, 400, corsHeaders);
        const tags = Array.from(new Set(Array.isArray(body.tags) ? body.tags.filter((t) => REVIEW_TAGS.includes(t)) : []));
        if (tags.length > MAX_TAGS) return json({ error: `Please pick at most ${MAX_TAGS} qualities.` }, 400, corsHeaders);
        const comment = clean(body.comment, 600);
        if (!comment) return json({ error: 'Please add a few words about your experience.' }, 400, corsHeaders);
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
          `${name} rated you ${rating} out of 5` + (played > 0 ? ` after ${played} session${played === 1 ? '' : 's'} together.` : '.') + (tags.length ? ` What stood out: ${tags.join(', ')}.` : '') + (comment ? ` "${comment}"` : '') + (show ? ' It is shown on your page.' : ' They chose to keep it private.'));
        return json({ ok: true, review: { rating, tags, comment, show: !!show, updatedAt: now } }, 200, corsHeaders);
      }
      return json({ error: 'Unknown action' }, 404, corsHeaders);
    }

    const sessions = await sessionsPlayed(env, mode, user.sub);
    // Ash's own account can always open the box, so the whole thing can be tried out for real.
    const testMode = user.sub === env.ADMIN_UID;
    const eligible = testMode || viaLink || sessions >= REVIEW_AFTER;
    const row = await env.DB.prepare('SELECT rating, tags, comment, updated_at, show_public FROM reviews WHERE uid=?').bind(user.sub).first();
    const mine = row ? { rating: row.rating, tags: parseTags(row.tags), comment: row.comment || '', show: row.show_public !== 0, updatedAt: row.updated_at } : null;

    if (action === 'status') {
      // Ash's public card (same name, picture and pronouns anyone sees at the table).
      const d = await env.DB.prepare('SELECT name, token, avatar_id, pronouns FROM profiles WHERE uid=?').bind(env.ADMIN_UID).first();
      const dm = { name: (d && d.name) || 'Ash', token: (d && d.token) || 'dragon', avatar: d && d.avatar_id ? `${self}/profile/avatar/${d.avatar_id}` : null, pronouns: (d && d.pronouns) || '' };
      return json({ sessions, needed: REVIEW_AFTER, eligible, testMode, viaLink, tags: REVIEW_TAGS, maxTags: MAX_TAGS, review: mine, dm }, 200, corsHeaders);
    }

    // A player can always take their own review back down (only their own, keyed by who they are signed in as).
    if (action === 'delete') {
      await env.DB.prepare('DELETE FROM reviews WHERE uid=?').bind(user.sub).run();
      return json({ ok: true }, 200, corsHeaders);
    }

    if (action === 'submit') {
      if (!eligible) return json({ error: `You can review Ash after ${REVIEW_AFTER} session together. You are at ${sessions}.` }, 403, corsHeaders);
      const rating = parseInt(body.rating, 10);
      if (!(rating >= 1 && rating <= 5)) return json({ error: 'Please pick a star rating from 1 to 5.' }, 400, corsHeaders);
      const picked = Array.isArray(body.tags) ? body.tags.filter((t) => REVIEW_TAGS.includes(t)) : [];
      const tags = Array.from(new Set(picked));
      if (tags.length > MAX_TAGS) return json({ error: `Please pick at most ${MAX_TAGS} qualities.` }, 400, corsHeaders);
      const comment = clean(body.comment, 600);
      if (!comment) return json({ error: 'Please add a few words about your experience.' }, 400, corsHeaders);
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
      `SELECT r.uid AS uid, r.name, r.rating, r.tags, r.comment, pr.token AS token, pr.avatar_id AS avatar_id
       FROM gm_reviews r LEFT JOIN profiles pr ON pr.uid = r.uid
       WHERE r.gm_uid=? AND r.mode=? AND r.show_public=1 ORDER BY r.updated_at DESC LIMIT 30`).bind(gm.uid, mode).all()).results
    : (await env.DB.prepare(
      `SELECT r.uid AS uid, r.name, r.rating, r.tags, r.comment, pr.token AS token, pr.avatar_id AS avatar_id
       FROM reviews r LEFT JOIN profiles pr ON pr.uid = r.uid
       WHERE r.mode=? AND r.show_public=1 ORDER BY r.updated_at DESC LIMIT 30`).bind(mode).all()).results;
  // How many sessions each reviewer has played at this table (never their account id).
  const reviews = [];
  for (const r of rows) {
    let sessions = 0;
    try { sessions = gm ? await sessionsWithGm(env, mode, r.uid, gm.uid) : await sessionsPlayed(env, mode, r.uid); } catch { sessions = 0; }
    reviews.push({
      name: r.name, rating: r.rating, tags: parseTags(r.tags), comment: r.comment || '', token: r.token || '', sessions,
      avatar: r.avatar_id ? `${self}/profile/avatar/${r.avatar_id}` : null,
    });
  }
  return new Response(JSON.stringify({ reviews }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60', ...corsHeaders },
  });
}

const WORKER_ORIGIN = 'https://ash-tabletop-announcements.ash-tabletop.workers.dev';

// Sends the "how was your game?" notice and email after every session a player has
// played with a Game Master (Ash or anyone else), until they review that Game Master.
// Each notice records how many sessions it was sent for, so the same session never
// triggers a second email. Runs on the same 5 minute timer as charges and reminders.
// Real-money games only.
export async function runReviewInvites(env, sendEmail) {
  if (env.REVIEW_INVITES === 'off') return { skipped: 'review invites are off' };
  const mode = cfg(env).mode;
  if (mode !== 'live') return { skipped: 'review invites only go out in real-money mode' };

  const testers = String(env.TEST_PLAYER_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  const report = { invited: 0 };
  const playerContact = (uid) => env.DB.prepare(
    `SELECT p.email AS email, p.name AS pname, p.game AS game, pr.name AS name
     FROM players p LEFT JOIN profiles pr ON pr.uid = p.uid
     WHERE p.mode=? AND p.uid=? ORDER BY (p.status='active') DESC, p.joined_at DESC LIMIT 1`).bind(mode, uid).first();
  const sessionsSaid = (row) => { const m = row && /played (\d+) session/.exec(row.body || ''); return row ? (m ? parseInt(m[1], 10) : 0) : 0; };

  // ---- Ash
  const counts = (await env.DB.prepare(
    `SELECT c.uid AS uid, COUNT(*) AS n FROM charges c
     WHERE c.mode=? AND c.status='paid' AND c.refunded_amount < c.amount
       AND NOT EXISTS (SELECT 1 FROM campaign_content cc WHERE cc.owner_uid IS NOT NULL AND (c.game = cc.slug OR c.game LIKE cc.slug || '::%'))
       AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.uid=c.uid)
     GROUP BY c.uid HAVING COUNT(*) >= ?`).bind(mode, REVIEW_AFTER).all()).results;
  for (const d of counts) {
    const last = await env.DB.prepare("SELECT body FROM notifications WHERE uid=? AND kind='review_invite' ORDER BY id DESC LIMIT 1").bind(d.uid).first();
    if (d.n <= sessionsSaid(last)) continue;
    const p = await playerContact(d.uid);
    if (!p || !p.email || testers.includes(String(p.email).toLowerCase())) continue;
    const name = p.name || p.pname || '';
    // The notice goes in first: it is also the "already invited for this many" marker, so a
    // failed email can never turn into the same email every 5 minutes.
    await notifyPlayer(env, mode, d.uid, 'review_invite', p.game, 'How was your game?',
      `You have played ${d.n} ${d.n === 1 ? 'session' : 'sessions'} with Ash. Would you like to leave a review?`);
    try {
      await sendEmail(env, p.email, `How was your game with Ash${name ? ', ' + name.split(' ')[0] : ''}?`,
        reviewInviteEmailHtml({ name, sessions: d.n, url: reviewUrl() }));
      report.invited++;
    } catch (err) { console.error('review invite email failed', p.email, err && err.message); }
  }

  // ---- every other Game Master: one invite per player per Game Master
  const gmCounts = (await env.DB.prepare(
    `SELECT c.uid AS uid, cc.owner_uid AS gm_uid, COUNT(*) AS n FROM charges c
     JOIN campaign_content cc ON (c.game = cc.slug OR c.game LIKE cc.slug || '::%')
     WHERE c.mode=? AND c.status='paid' AND c.refunded_amount < c.amount AND cc.owner_uid IS NOT NULL AND cc.owner_uid != c.uid
       AND NOT EXISTS (SELECT 1 FROM gm_reviews r WHERE r.gm_uid = cc.owner_uid AND r.uid = c.uid)
     GROUP BY c.uid, cc.owner_uid HAVING COUNT(*) >= ?`).bind(mode, REVIEW_AFTER).all()).results;
  for (const d of gmCounts) {
    const g = await env.DB.prepare('SELECT slug, data FROM gm_profiles WHERE uid=?').bind(d.gm_uid).first();
    if (!g) continue;
    let prof = {}; try { prof = JSON.parse(g.data || '{}') || {}; } catch { prof = {}; }
    const dmName = clean(prof.name, 40) || 'your Game Master';
    // One marker per Game Master: the title carries their name.
    const title = `How was your game with ${dmName}?`;
    const last = await env.DB.prepare("SELECT body FROM notifications WHERE uid=? AND kind='review_invite_gm' AND title=? ORDER BY id DESC LIMIT 1").bind(d.uid, title).first();
    if (d.n <= sessionsSaid(last)) continue;
    const p = await playerContact(d.uid);
    if (!p || !p.email || testers.includes(String(p.email).toLowerCase())) continue;
    const name = p.name || p.pname || '';
    const picture = gmAvatarUrl(WORKER_ORIGIN, g.slug, prof) || 'https://ashtabletop.com/medie/d20-icon.png';
    await notifyPlayer(env, mode, d.uid, 'review_invite_gm', null, title,
      `You have played ${d.n} ${d.n === 1 ? 'session' : 'sessions'} with ${dmName}. Would you like to leave a review?`);
    try {
      await sendEmail(env, p.email, `How was your game with ${dmName}${name ? ', ' + name.split(' ')[0] : ''}?`,
        reviewInviteEmailHtml({ name, sessions: d.n, url: reviewUrl(), dm: { name: dmName, picture } }));
      report.invited++;
    } catch (err) { console.error('review invite email failed', p.email, err && err.message); }
  }
  return report;
}

// Where the email and the notice send the player: the Review Ash tab on their profile page.
export function reviewUrl() {
  return 'https://ashtabletop.com/profile.html#me-review';
}

// dm = { name, picture } for the Game Master being reviewed. With none given it is Ash.
export function reviewInviteEmailHtml({ name, sessions, url, dm }) {
  const n = Number(sessions) || 1;
  const dmName = String((dm && dm.name) || 'Ash');
  const dmPicture = (dm && dm.picture) || 'https://ashtabletop.com/medie/ash-token.png';
  const played = n === 1 ? `session played with ${escapeHtml(dmName)}` : `sessions played with ${escapeHtml(dmName)}`;
  const sentence = n === 1 ? `You have played 1 session with ${dmName}.` : `You have played ${n} sessions with ${dmName}.`;
  const step = (num, title, text) => `<tr>
        <td width="34" valign="top" style="padding:0 0 14px"><div style="width:26px;height:26px;border-radius:13px;background:#f3eefb;border:1px solid #d9cdf0;color:#b9770e;font-size:13px;font-weight:700;line-height:26px;text-align:center">${num}</div></td>
        <td valign="top" style="padding:2px 0 14px;font-size:15px;line-height:1.45;color:#5b5273"><strong style="color:#241a3d">${title}</strong><br>${text}</td>
      </tr>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>How was your game with ${escapeHtml(dmName)}?</title></head>
<body style="margin:0;padding:0;background:#f4f0fa;font-family:Arial,Helvetica,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden;color:#f4f0fa">${escapeHtml(sentence)} Would you like to leave a review? It takes about a minute.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f4f0fa" style="background:#f4f0fa"><tr><td align="center" style="padding:28px 12px">
   <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;border:1px solid #e4dcf3;border-radius:14px;overflow:hidden;background:#ffffff">
    <tr><td align="center" height="180" bgcolor="#ffffff" background="https://ashtabletop.com/medie/review-email-banner.jpg" style="background:#ffffff url(https://ashtabletop.com/medie/review-email-banner.jpg) center center no-repeat;background-size:cover;height:180px;padding:0 120px">
      <img src="${escapeHtml(dmPicture)}" width="44" height="44" alt="${escapeHtml(dmName)}" style="display:block;margin:0 auto 10px;border-radius:22px;border:2px solid #d9cdf0">
      <p style="margin:0;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#b9770e;font-weight:700">Your feedback</p>
      <h1 style="margin:6px 0 0;font-size:24px;line-height:1.2;color:#241a3d;font-weight:700">How was your game with ${escapeHtml(dmName)}?</h1>
    </td></tr>
    <tr><td style="padding:28px 30px 26px">
      <p style="margin:0 0 6px;font-size:16px;line-height:1.55;color:#241a3d">Hi ${escapeHtml(name || 'there')},</p>
      <p style="margin:0 0 20px;font-size:16px;line-height:1.55;color:#5b5273">${escapeHtml(sentence)} Would you like to leave a review? Your honest words help other players find the right game and help ${escapeHtml(dmName)} keep getting better.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf7ff;border:1px solid #e4dcf3;border-radius:12px"><tr><td align="center" style="padding:18px 16px">
        <div style="font-size:40px;line-height:1;font-weight:700;color:#b9770e">${escapeHtml(String(n))}</div>
        <div style="margin-top:6px;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#5b5273;font-weight:700">${played}</div>
      </td></tr></table>
      <p style="margin:24px 0 12px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#8a8199;font-weight:700">It takes about a minute</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        ${step(1, 'Give a star rating', 'From one to five stars.')}
        ${step(2, 'Pick up to three qualities', `Choose what ${escapeHtml(dmName)} does best, like setting the mood or telling a great story.`)}
        ${step(3, 'Add a few words', 'Tell us what the game was like for you.')}
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:10px 0 4px">
        <a href="${escapeHtml(url)}" style="display:inline-block;background:#f2b84f;color:#1a1230;padding:14px 32px;border-radius:9px;text-decoration:none;font-weight:700;font-size:16px">Leave a review</a>
      </td></tr></table>
      <p style="margin:18px 0 0;font-size:14px;line-height:1.5;color:#8a8199;text-align:center">You choose whether your review also appears on the website.</p>
    </td></tr>
    <tr><td align="center" style="padding:16px 24px 20px;border-top:1px solid #e4dcf3;font-size:12px;line-height:1.6;color:#8a8199">
      We will check in after each session you play until you leave a review.<br>
      <a href="https://ashtabletop.com" style="color:#5b5273;text-decoration:underline">ashtabletop.com</a>
    </td></tr>
   </table>
  </td></tr></table></body></html>`;
}
