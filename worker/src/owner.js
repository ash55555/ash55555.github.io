// Who owns what. Ash's own campaigns have no owner (owner_uid is empty). A campaign made by another
// Game Master carries that GM's account id, and so does every game, charge and review that comes from it.
// Every Game Master route asks this file "is this yours?" on the server, so nothing the browser sends
// can make one GM see or change another GM's campaigns, players or money.

import { gmStatus } from './gm.js';

export const MAX_GM_CAMPAIGNS = 12;
export const MAX_GM_SLOTS = 8;

// The signed-in person's role: { uid, isGm, isAdmin }.
export async function actorFor(env, user) {
  const s = await gmStatus(env, user.sub, user);
  return { uid: user.sub, isGm: !!s.isGm, isAdmin: !!s.isAdmin };
}

// { campaignSlug: ownerUid } for every campaign a Game Master made (Ash's are not listed).
export async function loadOwners(env) {
  const rows = (await env.DB.prepare('SELECT slug, owner_uid FROM campaign_content WHERE owner_uid IS NOT NULL').all()).results;
  const out = {};
  rows.forEach((r) => { out[r.slug] = r.owner_uid; });
  return out;
}

export const slugOfKey = (key) => String(key || '').split('::')[0];

// Does this person see (and may they manage) things under this campaign or game key?
// Ash sees her own (no owner); a Game Master sees only theirs.
export function inScope(actor, owners, key) {
  const owner = owners[slugOfKey(key)] || null;
  return actor.isAdmin ? !owner : owner === actor.uid;
}

// ---- weekly times
// A GM types a day and time on their own clock and we remember their time zone with it. When the
// schedule is read, the time is turned into UTC for the zone's offset right now, so it follows
// daylight saving by itself and the rest of the system only ever sees plain UTC.

export function tzOffsetMinutes(tz, date) {
  try {
    const parts = {};
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(date).forEach((p) => { parts[p.type] = p.value; });
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  } catch { return null; }
}

export function validTz(tz) {
  return typeof tz === 'string' && tz.length <= 64 && tzOffsetMinutes(tz, new Date(0)) !== null;
}

// "YYYY-MM-DD" shifted by a number of days (may be negative), still "YYYY-MM-DD".
function shiftYmd(ymd, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  if (!m || !days) return ymd;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// { day, hour, minute } on the GM's clock + zone  ->  the same moment each week, in UTC.
// When the shift to UTC crosses midnight, the weekday changes — a biweekly slot's anchor date
// (also authored on the GM's clock) has to shift by that same number of days, or it would name
// a calendar date that no longer matches the UTC weekday everything else here now uses.
export function slotToUtc(slot, now = new Date()) {
  const off = validTz(slot.tz) ? tzOffsetMinutes(slot.tz, now) : 0;
  const local = slot.hour * 60 + (slot.minute || 0);
  const utc = local - off;
  const shift = Math.floor(utc / 1440);
  const inDay = ((utc % 1440) + 1440) % 1440;
  const out = { day: (((slot.day + shift) % 7) + 7) % 7, hour: Math.floor(inDay / 60), minute: inDay % 60, offset: 0 };
  if ((slot.freq === 'biweekly' || slot.freq === 'once') && slot.anchor) out.anchor = shiftYmd(slot.anchor, shift);
  return out;
}

// Check one slot from the browser and return only the fields we keep, or { error }.
// freq is "weekly" (the default, and the only option before this field existed),
// "biweekly" or "once". A biweekly slot carries anchor, the "YYYY-MM-DD" date of its
// first session — a real date instead of an ambiguous "which week do we start on" rule.
// A one-shot slot carries the same anchor field, but as its one and only session; once
// that date has passed, it simply has no more upcoming sessions, the same as any other
// campaign that stops recurring. Either way, the day that date falls on (UTC) must match
// the weekday already picked for the slot.
export function cleanSlot(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const day = Number(s.day), hour = Number(s.hour), minute = Number(s.minute || 0), max = Number(s.max);
  if (!Number.isInteger(day) || day < 0 || day > 6) return { error: 'Please pick a day of the week.' };
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return { error: 'Please pick a start time.' };
  if (!Number.isInteger(max) || max < 1 || max > 12) return { error: 'Max players must be between 1 and 12.' };
  if (!validTz(s.tz)) return { error: 'Your time zone could not be read. Please reload the page and try again.' };
  const freq = s.freq === 'biweekly' ? 'biweekly' : s.freq === 'once' ? 'once' : 'weekly';
  let anchor = null;
  if (freq === 'biweekly' || freq === 'once') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s.anchor || ''))) return { error: freq === 'once' ? 'Please pick the session date.' : 'Please pick the date of the first session.' };
    const d = new Date(`${s.anchor}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.getUTCDay() !== day) return { error: 'The session date does not fall on the day you picked.' };
    anchor = String(s.anchor);
  }
  const group = String(s.group == null ? '' : s.group).replace(/<[^>]*>/g, ' ').replace(/[<>\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30);
  return { slot: { day, hour, minute, tz: s.tz, max, enabled: s.enabled !== false, group, freq, anchor } };
}
