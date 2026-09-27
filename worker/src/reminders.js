// Reminder emails. About a day (25 hours) before each session, every player who is playing
// it gets an email with the time in their own time zone, whether they will be
// charged, and how long they have to skip. Ash gets one summary email per session.
//
// 25 hours (not exactly 24) on purpose: players can only skip up to 24 hours before a
// session, so a reminder at exactly 24 hours would arrive as the window closes. At 25
// hours it still reads as "a day before" and leaves an hour to skip.

import { loadGames, cfg, upcoming, iso, gameState, playingCount, escapeHtml, notify } from './pay.js';

const HOUR_MS = 60 * 60 * 1000;
const LEAD_MS = 25 * HOUR_MS;
const SKIP_CUTOFF_MS = 24 * HOUR_MS;
const SITE = 'https://ashtabletop.com';

// Time zone abbreviation people recognize (AEST, EDT...) or "" when there is none.
function abbreviation(date, tz) {
  const raw = /^(GMT|UTC)[+\-−]/;
  for (const loc of ['en-US', 'en-GB', 'en-AU', 'en-NZ', 'en-CA', 'en-IN', 'en-ZA']) {
    try {
      const part = new Intl.DateTimeFormat(loc, { timeZone: tz, timeZoneName: 'short' }).formatToParts(date).find((p) => p.type === 'timeZoneName');
      if (part && !raw.test(part.value)) return part.value;
    } catch { /* try the next */ }
  }
  return '';
}

// "Saturday, October 3" and "9:00 PM AEST" for one person's own time zone.
function when(ts, tz) {
  const d = new Date(ts);
  try {
    if (!tz) throw new Error('no zone');
    const day = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' }).format(d);
    const time = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(d);
    const abbr = abbreviation(d, tz);
    return { day, time: time + (abbr ? ' ' + abbr : ' your local time'), known: true };
  } catch {
    const day = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }).format(d);
    const time = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' }).format(d);
    return { day, time: time + ' UTC', known: false };
  }
}

function gameLink(key, game) {
  const [slug, slot] = key.includes('::') ? key.split('::') : [key, ''];
  const group = game.title.includes(', ') ? game.title.split(', ').slice(-1)[0] : '';
  const q = new URLSearchParams({ campaign: slug, slot, group, day: game.day, hour: game.hour, minute: game.minute, offset: game.offset, max: game.max });
  return `${SITE}/player.html?${q.toString()}`;
}

function untilText(ms) {
  const h = Math.max(0, Math.round(ms / HOUR_MS));
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'}`;
  const d = Math.floor(h / 24);
  const r = h % 24;
  return `${d} day${d === 1 ? '' : 's'}${r ? ` ${r} hour${r === 1 ? '' : 's'}` : ''}`;
}

function playerEmail({ name, game, key, ts, tz, msLeft, chargeLine, canSkip, deadline }) {
  const w = when(ts, tz);
  const dl = deadline ? when(deadline, tz) : null;
  const link = gameLink(key, game);
  const skipLine = canSkip
    ? `Can't make it? You can skip this session until <strong>${escapeHtml(dl.day)} at ${escapeHtml(dl.time)}</strong>, and you won't be charged for it.`
    : `The skip window for this session has closed. If something has come up, message Ash on Discord.`;
  return `<!doctype html><html><body style="margin:0;background:#120b1c;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
   <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#1c1230;border-radius:20px;overflow:hidden;border:1px solid #3a2a5c">
    <tr><td style="padding:28px 32px 8px;background:linear-gradient(135deg,#3b2a6d,#1c1230)">
      <p style="margin:0;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#f2b84f;font-weight:700">Ash Tabletop</p>
      <h1 style="margin:8px 0 0;font-size:26px;line-height:1.2;color:#ffffff">Your game is coming up</h1>
    </td></tr>
    <tr><td style="padding:20px 32px 0;color:#d9cdf2;font-size:16px;line-height:1.55">
      <p style="margin:0 0 16px">Hi ${escapeHtml(name || 'there')}, a quick heads-up about your next session.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#2a1d47;border-radius:14px;border:1px solid #4a3877"><tr><td style="padding:18px 20px">
        <p style="margin:0;font-size:13px;color:#b9a9d9;text-transform:uppercase;letter-spacing:.08em;font-weight:700">${escapeHtml(game.title)}</p>
        <p style="margin:6px 0 2px;font-size:22px;color:#ffffff;font-weight:700">${escapeHtml(w.day)}</p>
        <p style="margin:0;font-size:20px;color:#f2b84f;font-weight:700">${escapeHtml(w.time)}</p>
        <p style="margin:8px 0 0;font-size:14px;color:#b9a9d9">Starts in about ${escapeHtml(untilText(msLeft))}</p>
      </td></tr></table>
      ${w.known ? '' : '<p style="margin:10px 0 0;font-size:13px;color:#b9a9d9">Your player page shows this in your own time zone.</p>'}
      <p style="margin:18px 0 8px">${escapeHtml(chargeLine)}</p>
      <p style="margin:0 0 20px">${skipLine}</p>
      <p style="margin:0 0 28px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#f2b84f;color:#241407;padding:13px 24px;border-radius:12px;text-decoration:none;font-weight:700;font-size:16px">${canSkip ? 'Open my table (skip here)' : 'Open my table'}</a></p>
    </td></tr>
    <tr><td style="padding:16px 32px 24px;border-top:1px solid #3a2a5c;color:#8f7fb3;font-size:12px;line-height:1.5">
      You're getting this because you're booked into this game at ashtabletop.com. Roll well!
    </td></tr>
   </table>
  </td></tr></table></body></html>`;
}

export async function runReminders(env, sendEmail) {
  if (env.REMINDERS === 'off') return { skipped: 'reminders are off' };
  const mode = cfg(env).mode;
  if (mode !== 'live') return { skipped: 'reminders only go out in real-money mode' };
  let games;
  try { games = await loadGames(env, true); } catch (err) { return { skipped: 'could not read the schedule' }; }

  const now = new Date();
  const report = { players: 0, admin: 0 };
  const adminProfile = await env.DB.prepare('SELECT tz FROM profiles WHERE uid=?').bind(env.ADMIN_UID).first();
  const adminTz = (adminProfile && adminProfile.tz) || '';

  for (const [key, game] of Object.entries(games)) {
    if (!game.enabled) continue;
    const next = upcoming(game, now, 1)[0];
    if (!next) continue;
    const msLeft = next.getTime() - now.getTime();
    if (msLeft > LEAD_MS || msLeft < 30 * 60 * 1000) continue;
    const ts = iso(next);

    const players = (await env.DB.prepare(
      `SELECT p.uid, p.email, p.name AS pname, p.joined_at, pr.name, pr.tz
       FROM players p LEFT JOIN profiles pr ON pr.uid = p.uid
       WHERE p.mode=? AND p.game=? AND p.status='active'`).bind(mode, key).all()).results;
    const skips = new Set((await env.DB.prepare('SELECT uid FROM skips WHERE mode=? AND game=? AND session_ts=?').bind(mode, key, ts).all()).results.map((r) => r.uid));
    const gs = await gameState(env, mode, key);
    const playing = await playingCount(env, mode, key, game, ts);
    const billed = gs.running && gs.startedAt && ts > gs.startedAt;
    const enough = playing >= game.min;
    const chargeLine = !billed
      ? "Billing hasn't started for this game yet, so you won't be charged for this session."
      : enough
        ? `You will be charged $${game.price} when the session starts, as long as you have not skipped it.`
        : `Not enough players are booked for this session yet, so nobody will be charged for it unless more join.`;
    const canSkip = msLeft >= SKIP_CUTOFF_MS;
    const deadline = canSkip ? new Date(next.getTime() - SKIP_CUTOFF_MS).toISOString() : null;

    const playingNames = [];
    const skippedNames = [];
    for (const p of players) {
      const name = p.name || p.pname || p.email;
      if (skips.has(p.uid)) { skippedNames.push(name); continue; }
      playingNames.push(name);
      if (p.joined_at && new Date(p.joined_at).getTime() > now.getTime() - 2 * HOUR_MS) continue; // just joined, they know
      const claim = await env.DB.prepare('INSERT OR IGNORE INTO reminders (mode, game, session_ts, uid, sent_at) VALUES (?,?,?,?,?)').bind(mode, key, ts, p.uid, iso(now)).run();
      if (!claim.meta || claim.meta.changes !== 1) continue;
      try {
        await sendEmail(env, p.email, `Coming up: ${game.title}, ${when(ts, p.tz).day}`,
          playerEmail({ name: p.name || p.pname, game, key, ts, tz: p.tz, msLeft, chargeLine, canSkip, deadline }));
        report.players++;
      } catch (err) { console.error('reminder email failed', p.email, err && err.message); }
    }

    // One summary for Ash per session.
    const adminClaim = await env.DB.prepare('INSERT OR IGNORE INTO reminders (mode, game, session_ts, uid, sent_at) VALUES (?,?,?,?,?)').bind(mode, key, ts, '__admin__', iso(now)).run();
    if (adminClaim.meta && adminClaim.meta.changes === 1 && (players.length || game.legacyFilled)) {
      const w = when(ts, adminTz);
      await notify(env, sendEmail, mode, 'reminder', key, `${game.title}: session in about ${untilText(msLeft)}`,
        `${w.day} at ${w.time}.\n` +
        `Playing (${playingNames.length} booked online${game.legacyFilled ? ` + ${game.legacyFilled} on PayPal` : ''}): ${playingNames.join(', ') || 'nobody booked online'}.\n` +
        (skippedNames.length ? `Skipping: ${skippedNames.join(', ')}.\n` : '') +
        (billed ? (enough ? `Billing is on: $${game.price} each at the start.` : `Billing is on, but only ${playing} are playing and ${game.min} are needed, so nobody will be charged.`) : `Billing has not been started for this game.`));
      report.admin++;
    }
  }
  return report;
}
