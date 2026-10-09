// The public home page: every open game with its next session, the Game Masters who run them and a few
// real numbers. No sign-in needed and nothing private goes out (no names of players, no account ids).
// It works for every Game Master automatically: a published campaign shows up here with its owner.

import { cfg, loadGames, upcoming, sessionsBetween } from './pay.js';
import { gmStatus } from './gm.js';
import { gmPayoutAccount } from './connect.js';

// Names that are game systems, so a system listed under "tools" still counts when people search by system.
const SYSTEM_NAMES = ['D&D 5e', 'D&D 5.5 (2024)', 'Pathfinder 2e', 'Call of Cthulhu', 'Vampire: The Masquerade', 'Blades in the Dark', 'Starfinder', 'Shadowrun', 'Savage Worlds', 'Dungeon Crawl Classics'];

// Ash's own written reviews on her page (6 of them, 5 stars each) count towards her rating.
const ASH_WRITTEN = { count: 6, sum: 30 };
// "Sessions played" starts at the figure Ash gave on this day and grows by one for every session that runs after it.
const SESSIONS_BASE = 1490;
const SESSIONS_SINCE = '2026-10-07T00:00:00.000Z';

function json(data, corsHeaders) {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60', ...corsHeaders } });
}

export async function handleHome(request, env, corsHeaders) {
  const origin = new URL(request.url).origin;
  const mode = cfg(env).mode;
  const now = new Date();
  const games = await loadGames(env);
  const owners = {};
  const rows = (await env.DB.prepare('SELECT slug, title, eyebrow, hook, tag, banner_id, owner_uid FROM campaign_content WHERE published=1 ORDER BY created_at ASC').all()).results;
  rows.forEach((r) => { owners[r.slug] = r.owner_uid || null; });

  const online = {};
  (await env.DB.prepare("SELECT game, COUNT(*) AS n FROM players WHERE mode=? AND status='active' GROUP BY game").bind(mode).all()).results.forEach((r) => { online[r.game] = r.n; });
  const openOf = (g) => Math.max(0, g.max - g.legacyFilled - (online[g.key] || 0));

  const list = [];
  let seatsOpen = 0;
  for (const r of rows) {
    const slots = Object.values(games).filter((g) => g.key === r.slug || g.key.startsWith(r.slug + '::')).filter((g) => g.enabled);
    if (!slots.length) continue;
    // a Game Master's table can be booked once Whop has approved their payout account; until then it only shows as opening soon
    const soon = !!r.owner_uid && !(await gmPayoutAccount(env, r.owner_uid));
    const opensAt = slots[0].openMode === 'date' && slots[0].openAt && new Date(`${slots[0].openAt}T00:00:00Z`).getTime() > now.getTime() ? slots[0].openAt : null;
    const gated = soon || !!opensAt;
    const withSeats = gated ? slots : slots.filter((g) => openOf(g) > 0);
    if (!withSeats.length) continue; // a full table is not shown
    let best = null;
    for (const g of withSeats) {
      const n = upcoming(g, now, 1)[0];
      if (n && (!best || n < best.when)) best = { g, when: n };
    }
    if (!best) continue;
    if (!gated) seatsOpen += withSeats.reduce((n, g) => n + openOf(g), 0);
    list.push({
      slug: r.slug, title: r.title, eyebrow: r.eyebrow || '', hook: r.hook || '', tag: r.tag || 'Adventure',
      bannerUrl: r.banner_id ? `${origin}/content/banner/${r.banner_id}` : null,
      gm: r.owner_uid ? null : 'ash', owner: r.owner_uid || null,
      next: best.when.toISOString(), price: best.g.price, seatsOpen: gated ? null : openOf(best.g), max: best.g.max, soon, opensAt,
    });
  }

  // Every Game Master who is allowed to host here and has a page people can look at (Ash first), with what
  // visitors can search by: pronouns, languages, systems, tools, the days they play and what a session costs.
  const gmList = [];
  const gmByUid = {};
  const parse = (raw) => { try { return JSON.parse(raw || '{}') || {}; } catch { return {}; } };
  const ratingOf = async (table, col, val) => {
    const r = await env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(rating),0) AS s FROM ${table} WHERE ${col}=? AND mode=?`).bind(val, mode).first();
    return { n: r ? r.n : 0, s: r ? r.s : 0 };
  };
  const slotsOf = (uid) => {
    const slugs = rows.filter((r) => (r.owner_uid || null) === uid).map((r) => r.slug);
    return Object.values(games).filter((g) => g.enabled && slugs.some((sl) => g.key === sl || g.key.startsWith(sl + '::')));
  };
  const extras = (uid, data, defaults) => {
    const tools = Array.isArray(data.tools) ? data.tools.slice(0, 24) : [];
    const sys = (Array.isArray(data.systems) ? data.systems : []).slice();
    tools.forEach((t) => { if (SYSTEM_NAMES.includes(t) && !sys.includes(t)) sys.push(t); });
    const slots = slotsOf(uid);
    const prices = slots.map((g) => g.price);
    return {
      tagline: data.tagline || '',
      tools,
      systems: sys.length ? sys : (defaults ? defaults.systems : []),
      languages: (Array.isArray(data.languages) && data.languages.length ? data.languages : (defaults ? defaults.languages : [])).slice(0, 12),
      sessions: slots.map((g) => { const n = upcoming(g, now, 1)[0]; return n ? n.toISOString() : null; }).filter(Boolean),
      priceMin: prices.length ? Math.min(...prices) : null,
      priceMax: prices.length ? Math.max(...prices) : null,
    };
  };

  const ashRow = await env.DB.prepare('SELECT data FROM gm_profiles WHERE slug=?').bind('ash').first();
  const ashData = parse(ashRow && ashRow.data);
  const ashLive = (await env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(rating),0) AS s FROM reviews WHERE mode=?').bind(mode).first()) || { n: 0, s: 0 };
  const ashCount = ASH_WRITTEN.count + ashLive.n;
  const ash = {
    slug: 'ash', name: ashData.name || 'Ash', pronouns: ashData.pronouns || 'he/they', avatar: null, you: true,
    rating: ashCount ? Math.round(((ASH_WRITTEN.sum + ashLive.s) / ashCount) * 10) / 10 : null, reviews: ashCount,
    ...extras(null, ashData, { systems: ['D&D 5e'], languages: ['English'] }),
  };
  gmList.push(ash);
  gmByUid.ash = ash;

  const hasGames = new Set(list.filter((g) => g.owner).map((g) => g.owner));
  const others = (await env.DB.prepare("SELECT uid, slug, data FROM gm_profiles WHERE slug != 'ash' ORDER BY updated_at ASC").all()).results;
  for (const p of others) {
    const data = parse(p.data);
    const complete = !!data.name && !!(data.tagline || data.bio);
    if (!complete && !hasGames.has(p.uid)) continue;           // nothing for visitors to look at yet
    if (!(await gmStatus(env, p.uid)).isGm) continue;           // their agreement ended or was never linked
    const rt = await ratingOf('gm_reviews', 'gm_uid', p.uid);
    const gm = {
      slug: p.slug, name: data.name || 'Game Master', pronouns: data.pronouns || '',
      avatar: data.avatar ? `${origin}/gm/avatar?slug=${encodeURIComponent(p.slug)}` : null, you: false,
      rating: rt.n ? Math.round((rt.s / rt.n) * 10) / 10 : null, reviews: rt.n,
      ...extras(p.uid, data, null),
    };
    gmByUid[p.uid] = gm;
    gmList.push(gm);
  }
  list.forEach((g) => { g.gm = g.owner ? (gmByUid[g.owner] ? gmByUid[g.owner].slug : null) : 'ash'; delete g.owner; });
  gmList.forEach((m) => { m.games = list.filter((g) => g.gm === m.slug).length; });
  const gms = gmList;

  // Sessions played: the starting figure plus every session that has run since.
  // A session counts once, whether we know it ran from the schedule (someone is at the table) or from a player
  // having been charged for it.
  const ran = new Set();
  const from = new Date(SESSIONS_SINCE);
  for (const g of Object.values(games)) {
    if (!g.enabled) continue;
    if (g.legacyFilled + (online[g.key] || 0) <= 0) continue; // nobody at the table
    sessionsBetween(g, from, now).forEach((d) => ran.add(g.key + '|' + d.toISOString()));
  }
  const charged = (await env.DB.prepare("SELECT DISTINCT game, session_ts FROM charges WHERE mode=? AND status IN ('paid','refunded') AND session_ts > ? AND session_ts <= ?")
    .bind(mode, from.toISOString(), now.toISOString()).all()).results;
  charged.forEach((c) => { ran.add(c.game + '|' + c.session_ts); });

  return json({
    games: list.filter((g) => g.gm),
    gms,
    stats: { gms: gms.length, openGames: list.filter((g) => !g.soon).length, seatsOpen, sessionsPlayed: SESSIONS_BASE + ran.size },
  }, corsHeaders);
}
