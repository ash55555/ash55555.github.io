// The public home page: every open game with its next session, the Game Masters who run them and a few
// real numbers. No sign-in needed and nothing private goes out (no names of players, no account ids).
// It works for every Game Master automatically: a published campaign shows up here with its owner.

import { cfg, loadGames, upcoming, sessionsBetween } from './pay.js';

// Ash's own written reviews on her page (3 of them, 5 stars each) count towards her rating.
const ASH_WRITTEN = { count: 3, sum: 15 };
// "Sessions played" starts at the figure Ash gave on this day and grows by one for every session that runs after it.
const SESSIONS_BASE = 1490;
const SESSIONS_SINCE = '2026-10-07T18:00:00.000Z';

function json(data, corsHeaders) {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60', ...corsHeaders } });
}

export async function handleHome(request, env, corsHeaders) {
  const origin = new URL(request.url).origin;
  const mode = cfg(env).mode;
  const now = new Date();
  const games = await loadGames(env);
  const owners = {};
  const rows = (await env.DB.prepare('SELECT slug, title, eyebrow, hook, banner_id, owner_uid FROM campaign_content WHERE published=1 ORDER BY created_at ASC').all()).results;
  rows.forEach((r) => { owners[r.slug] = r.owner_uid || null; });

  const online = {};
  (await env.DB.prepare("SELECT game, COUNT(*) AS n FROM players WHERE mode=? AND status='active' GROUP BY game").bind(mode).all()).results.forEach((r) => { online[r.game] = r.n; });
  const openOf = (g) => Math.max(0, g.max - g.legacyFilled - (online[g.key] || 0));

  const list = [];
  let seatsOpen = 0;
  for (const r of rows) {
    const slots = Object.values(games).filter((g) => g.key === r.slug || g.key.startsWith(r.slug + '::')).filter((g) => g.enabled);
    if (!slots.length) continue;
    const soon = !!r.owner_uid; // another Game Master's table cannot be booked yet
    const withSeats = soon ? slots : slots.filter((g) => openOf(g) > 0);
    if (!withSeats.length) continue; // a full table is not shown
    let best = null;
    for (const g of withSeats) {
      const n = upcoming(g, now, 1)[0];
      if (n && (!best || n < best.when)) best = { g, when: n };
    }
    if (!best) continue;
    if (!soon) seatsOpen += withSeats.reduce((n, g) => n + openOf(g), 0);
    list.push({
      slug: r.slug, title: r.title, eyebrow: r.eyebrow || '', hook: r.hook || '',
      bannerUrl: r.banner_id ? `${origin}/content/banner/${r.banner_id}` : null,
      gm: r.owner_uid ? null : 'ash', owner: r.owner_uid || null,
      next: best.when.toISOString(), price: best.g.price, seatsOpen: soon ? null : openOf(best.g), max: best.g.max, soon,
    });
  }

  // The Game Masters who have a table listed, with their rating from their players.
  const gmByUid = {};
  const gms = [];
  const addRating = async (table, col, val) => {
    const r = await env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(rating),0) AS s FROM ${table} WHERE ${col}=? AND mode=?`).bind(val, mode).first();
    return { n: r ? r.n : 0, s: r ? r.s : 0 };
  };
  const ashRows = await env.DB.prepare('SELECT data FROM gm_profiles WHERE slug=?').bind('ash').first();
  let ashData = {};
  try { ashData = JSON.parse((ashRows && ashRows.data) || '{}') || {}; } catch { ashData = {}; }
  const ashLive = (await env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(rating),0) AS s FROM reviews WHERE mode=?').bind(mode).first()) || { n: 0, s: 0 };
  const ashCount = ASH_WRITTEN.count + ashLive.n;
  gms.push({ slug: 'ash', name: ashData.name || 'Ash', pronouns: ashData.pronouns || 'he/they', avatar: null, you: true,
    rating: ashCount ? Math.round(((ASH_WRITTEN.sum + ashLive.s) / ashCount) * 10) / 10 : null, reviews: ashCount });
  gmByUid.ash = gms[0];

  const otherUids = Array.from(new Set(list.filter((g) => g.owner).map((g) => g.owner)));
  for (const uid of otherUids) {
    const p = await env.DB.prepare('SELECT slug, data FROM gm_profiles WHERE uid=?').bind(uid).first();
    if (!p) continue;
    let data = {};
    try { data = JSON.parse(p.data || '{}') || {}; } catch { data = {}; }
    const rt = await addRating('gm_reviews', 'gm_uid', uid);
    const gm = { slug: p.slug, name: data.name || 'Game Master', pronouns: data.pronouns || '', avatar: data.avatar ? `${origin}/gm/avatar?slug=${encodeURIComponent(p.slug)}` : null, you: false,
      rating: rt.n ? Math.round((rt.s / rt.n) * 10) / 10 : null, reviews: rt.n };
    gmByUid[uid] = gm;
    gms.push(gm);
  }
  list.forEach((g) => { g.gm = g.owner ? (gmByUid[g.owner] ? gmByUid[g.owner].slug : null) : 'ash'; delete g.owner; });

  // Sessions played: the starting figure plus every session that has run since.
  let ran = 0;
  const from = new Date(SESSIONS_SINCE);
  for (const g of Object.values(games)) {
    if (g.owner || !g.enabled) continue;
    if (g.legacyFilled + (online[g.key] || 0) <= 0) continue; // nobody at the table
    ran += sessionsBetween(g, from, now).length;
  }

  return json({
    games: list.filter((g) => g.gm),
    gms,
    stats: { gms: gms.length, openGames: list.filter((g) => !g.soon).length, seatsOpen, sessionsPlayed: SESSIONS_BASE + ran },
  }, corsHeaders);
}
