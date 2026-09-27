// Reminder emails. 24 hours before each session, every player who is playing it gets
// a short, friendly reminder with the game and the time in their own time zone.
// Ash gets one summary email per session (who is playing, who skipped, billing).

import { loadGames, cfg, upcoming, iso, gameState, playingCount, escapeHtml, notify } from './pay.js';

const HOUR_MS = 60 * 60 * 1000;
const LEAD_MS = 24 * HOUR_MS;

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

function untilText(ms) {
  const h = Math.max(0, Math.round(ms / HOUR_MS));
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'}`;
  const d = Math.floor(h / 24);
  const r = h % 24;
  return `${d} day${d === 1 ? '' : 's'}${r ? ` ${r} hour${r === 1 ? '' : 's'}` : ''}`;
}

function playerEmail({ name, game, ts, tz, msLeft }) {
  const w = when(ts, tz);
  const hours = Math.max(1, Math.round(msLeft / HOUR_MS) >= 23 ? 24 : Math.round(msLeft / HOUR_MS));
  const inText = hours === 24 ? 'in 24 hours' : `in ${hours} hour${hours === 1 ? '' : 's'}`;
  return `<!doctype html><html><body style="margin:0;background:#120b1c;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
   <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#1c1230;border-radius:20px;overflow:hidden;border:1px solid #3a2a5c">
    <tr><td style="padding:28px 32px 10px;background:linear-gradient(135deg,#3b2a6d,#1c1230)">
      <p style="margin:0;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#f2b84f;font-weight:700">Ash Tabletop</p>
      <h1 style="margin:8px 0 0;font-size:26px;line-height:1.2;color:#ffffff">Game reminder</h1>
    </td></tr>
    <tr><td style="padding:20px 32px 30px;color:#d9cdf2;font-size:16px;line-height:1.55">
      <p style="margin:0 0 16px">Hi ${escapeHtml(name || 'there')}, your game is ${escapeHtml(inText)}.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#2a1d47;border-radius:14px;border:1px solid #4a3877"><tr><td style="padding:18px 20px">
        <p style="margin:0;font-size:13px;color:#b9a9d9;text-transform:uppercase;letter-spacing:.08em;font-weight:700">${escapeHtml(game.title)}</p>
        <p style="margin:6px 0 2px;font-size:22px;color:#ffffff;font-weight:700">${escapeHtml(w.day)}</p>
        <p style="margin:0;font-size:20px;color:#f2b84f;font-weight:700">${escapeHtml(w.time)}</p>
      </td></tr></table>
      ${w.known ? '' : '<p style="margin:10px 0 0;font-size:13px;color:#b9a9d9">Times are in UTC. Your player page shows the game in your own time zone.</p>'}
      <p style="margin:22px 0 0">See you at the table. Roll well!</p>
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
        await sendEmail(env, p.email, `Reminder: ${game.title} is in 24 hours`,
          playerEmail({ name: p.name || p.pname, game, ts, tz: p.tz, msLeft }));
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
