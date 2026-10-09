// Campaign page content: title, hook, story, and the banner image, all editable
// from the admin "Campaigns" tab. Public blog pages fetch the published version
// with no sign-in needed. Ash writes her own campaigns; every other Game Master writes only
// their own (each campaign row remembers its owner, and every route below checks it).

import { verifyUser, cfg, notifyPlayer } from './pay.js';
import { gmPayoutAccount } from './connect.js';
import { actorFor, MAX_GM_CAMPAIGNS, MAX_GM_SLOTS, cleanSlot, slotToUtc } from './owner.js';
import { followersOf } from './follow.js';

const MAX_BANNER_CHARS = 260000; // a landscape banner, base64 text (~190KB of image)
const FIELDS = ['title', 'eyebrow', 'hook', 'intro', 'world', 'stakes', 'audience', 'tag'];
const FIELD_MAX = { title: 80, eyebrow: 70, hook: 220, intro: 2500, world: 2500, stakes: 2500, audience: 2500, tag: 24 };
const DEFAULT_TAG = 'Adventure'; // a Game Master picks their own; this is just the fallback for one that hasn't yet

// The 5 campaigns that already have their own hand-built page and URL. New
// campaigns created from the admin get a shared template page instead (see
// blog/campaign.html), so these slugs can never be reassigned to something else.
const RESERVED_SLUGS = new Set(['flying-city', 'curse-of-strahd', 'ravenloft-undead-survival', 'crooked-moon', 'witchlight']);

function json(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
}

function clean(v, max) {
  return String(v == null ? '' : v).replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, max);
}

function slugify(s) {
  return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'campaign';
}

async function uniqueSlug(env, base) {
  let slug = base;
  let n = 2;
  while (true) {
    if (!RESERVED_SLUGS.has(slug)) {
      const row = await env.DB.prepare('SELECT 1 AS x FROM campaign_content WHERE slug=?').bind(slug).first();
      if (!row) return slug;
    }
    slug = `${base}-${n++}`;
  }
}

// A null/0 price or min_players means "use the site default" — see pay.js's SESSION_PRICE/MIN_PLAYERS.
const DEFAULT_PRICE = 10;
const DEFAULT_MIN_PLAYERS = 3;

function view(row, origin) {
  const out = {
    slug: row.slug, updatedAt: row.updated_at, bannerUrl: row.banner_id ? `${origin}/content/banner/${row.banner_id}` : null,
    price: row.price > 0 ? row.price : DEFAULT_PRICE,
    minPlayers: row.min_players > 0 ? row.min_players : DEFAULT_MIN_PLAYERS,
    openMode: row.open_mode === 'date' ? 'date' : 'now',
    openAt: row.open_mode === 'date' ? row.open_at : null,
  };
  FIELDS.forEach((f) => { out[f] = row[f] || ''; });
  out.tag = row.tag || DEFAULT_TAG;
  return out;
}

function parseSlots(row) {
  try { const o = JSON.parse(row.slots_json || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; }
}

// The sessions as visitors need them: the time already turned into UTC (offset 0), nothing private.
function publicSlots(row) {
  const out = {};
  const now = new Date();
  Object.entries(parseSlots(row)).forEach(([id, s]) => {
    if (!s || !Number.isInteger(s.day) || !Number.isInteger(s.hour)) return;
    const u = slotToUtc(s, now);
    const freq = s.freq === 'biweekly' ? 'biweekly' : s.freq === 'once' ? 'once' : 'weekly';
    out[id] = { day: u.day, hour: u.hour, minute: u.minute, offset: 0, max: s.max, filled: 0, enabled: s.enabled !== false, group: s.group || '', freq, anchor: freq !== 'weekly' ? (u.anchor || null) : null };
  });
  return out;
}

// Ash's campaigns have no owner. Another Game Master's campaign belongs to them.
const ownedBy = (row, actor) => (actor.isAdmin ? !row.owner_uid : row.owner_uid === actor.uid);

export async function handleContentBanner(request, env, corsHeaders, id) {
  if (!/^[a-f0-9]{16,64}$/.test(id)) return new Response('Not found', { status: 404, headers: corsHeaders });
  const row = await env.DB.prepare('SELECT banner_data FROM campaign_content WHERE banner_id=?').bind(id).first();
  const m = row && /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(row.banner_data || '');
  if (!m) return new Response('Not found', { status: 404, headers: corsHeaders });
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  return new Response(bytes, { status: 200, headers: { 'Content-Type': m[1], 'Cache-Control': 'public, max-age=86400', ...corsHeaders } });
}

// Public: one campaign's live content, for its blog page. No sign-in needed.
export async function handleContentPublic(request, env, corsHeaders) {
  const url = new URL(request.url);
  const slug = String(url.searchParams.get('slug') || '');
  if (!slug) return json({ error: 'Missing slug' }, 400, corsHeaders);
  const row = await env.DB.prepare('SELECT * FROM campaign_content WHERE slug=? AND published=1').bind(slug).first();
  if (!row) return json({ error: 'Not found' }, 404, corsHeaders);
  const out = view(row, url.origin);
  if (row.owner_uid) {
    const gm = await env.DB.prepare('SELECT slug FROM gm_profiles WHERE uid=?').bind(row.owner_uid).first();
    out.gm = gm ? gm.slug : '';
    out.slots = publicSlots(row);
    out.bookable = !!(await gmPayoutAccount(env, row.owner_uid)); // seats can be booked once their payout account is approved
  }
  return json(out, 200, { 'Cache-Control': 'public, max-age=30', ...corsHeaders });
}

// Public: every published campaign, for the homepage's campaign grid and
// anywhere else on the live site that needs to list them all. No sign-in
// needed, and never includes a draft (published=0) campaign.
export async function handleContentPublicList(request, env, corsHeaders) {
  const url = new URL(request.url);
  // Ash's own pages ask for no one in particular and get only her campaigns. A Game Master's page
  // asks for them by their profile name (?gm=their-slug) and gets only theirs, with their sessions.
  const gmSlug = String(url.searchParams.get('gm') || '');
  let rows;
  const META_COLS = 'price, min_players, open_mode, open_at';
  if (gmSlug && gmSlug !== 'ash') {
    const gm = await env.DB.prepare('SELECT uid FROM gm_profiles WHERE slug=?').bind(gmSlug).first();
    rows = gm ? (await env.DB.prepare(
      `SELECT slug, title, eyebrow, hook, tag, banner_id, slots_json, owner_uid, ${META_COLS} FROM campaign_content WHERE published=1 AND owner_uid=? ORDER BY created_at ASC`).bind(gm.uid).all()).results : [];
  } else {
    rows = (await env.DB.prepare(
      `SELECT slug, title, eyebrow, hook, tag, banner_id, slots_json, owner_uid, ${META_COLS} FROM campaign_content WHERE published=1 AND owner_uid IS NULL ORDER BY created_at ASC`).all()).results;
  }
  const ready = {};
  for (const r of rows) if (r.owner_uid && !(r.owner_uid in ready)) ready[r.owner_uid] = !!(await gmPayoutAccount(env, r.owner_uid));
  const campaigns = rows.map((r) => ({
    slug: r.slug, title: r.title, eyebrow: r.eyebrow, hook: r.hook, tag: r.tag || DEFAULT_TAG,
    price: r.price > 0 ? r.price : DEFAULT_PRICE,
    minPlayers: r.min_players > 0 ? r.min_players : DEFAULT_MIN_PLAYERS,
    openMode: r.open_mode === 'date' ? 'date' : 'now',
    openAt: r.open_mode === 'date' ? r.open_at : null,
    ...(r.owner_uid ? { bookable: ready[r.owner_uid] } : {}),
    bannerUrl: r.banner_id ? `${url.origin}/content/banner/${r.banner_id}` : null,
    ...(r.owner_uid ? { slots: publicSlots(r) } : {}),
  }));
  return json({ campaigns }, 200, { 'Cache-Control': 'public, max-age=30', ...corsHeaders });
}

export async function handleContentAdmin(request, env, corsHeaders, origin, action, verify = verifyUser) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, corsHeaders);
  if (!origin) return json({ error: 'Origin not allowed' }, 403, corsHeaders);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400, corsHeaders); }
  if (!body || !body.idToken) return json({ error: 'Please sign in again.' }, 401, corsHeaders);
  let user;
  try { user = await verify(env, body.idToken); } catch { return json({ error: 'Please sign in again.' }, 401, corsHeaders); }
  // Ash, or a Game Master. A Game Master only ever reaches the campaigns that are theirs.
  const actor = await actorFor(env, user);
  if (!actor.isGm) return json({ error: 'Not authorized' }, 403, corsHeaders);

  const self = new URL(request.url).origin;
  try {
    if (action === 'list') {
      const rows = actor.isAdmin
        ? (await env.DB.prepare('SELECT slug, title, eyebrow, banner_id, published, updated_at FROM campaign_content WHERE owner_uid IS NULL ORDER BY updated_at DESC').all()).results
        : (await env.DB.prepare('SELECT slug, title, eyebrow, banner_id, published, updated_at FROM campaign_content WHERE owner_uid=? ORDER BY updated_at DESC').bind(actor.uid).all()).results;
      return json({ campaigns: rows.map((r) => ({ slug: r.slug, title: r.title, eyebrow: r.eyebrow, published: !!r.published, updatedAt: r.updated_at, bannerUrl: r.banner_id ? `${self}/content/banner/${r.banner_id}` : null, reserved: RESERVED_SLUGS.has(r.slug) })) }, 200, corsHeaders);
    }
    if (action === 'get') {
      const slug = String(body.slug || '');
      const row = await env.DB.prepare('SELECT * FROM campaign_content WHERE slug=?').bind(slug).first();
      if (!row || !ownedBy(row, actor)) return json({ error: 'Not found' }, 404, corsHeaders);
      return json({ ...view(row, self), published: !!row.published, reserved: RESERVED_SLUGS.has(row.slug), ...(row.owner_uid ? { slots: parseSlots(row) } : {}) }, 200, corsHeaders);
    }
    if (action === 'save') return await saveCampaign(env, actor, body, self, corsHeaders);
    // Sessions for a Game Master's campaign. (Ash's own sessions stay in Firebase, edited as before.)
    if (action === 'slots/list' || action === 'slots/save' || action === 'slots/delete') return await slotAction(env, actor, action, body, corsHeaders);
    // Every session of every campaign the caller owns, for the calendar and the players tab.
    if (action === 'slots/all') {
      if (actor.isAdmin) return json({ campaigns: {} }, 200, corsHeaders);
      const rows = (await env.DB.prepare('SELECT slug, slots_json FROM campaign_content WHERE owner_uid=?').bind(actor.uid).all()).results;
      const out = {};
      rows.forEach((r) => { out[r.slug] = { slots: parseSlots(r) }; });
      return json({ campaigns: out }, 200, corsHeaders);
    }
    return json({ error: 'Unknown action' }, 404, corsHeaders);
  } catch (err) {
    return json({ error: err.message || 'Something went wrong.' }, 502, corsHeaders);
  }
}

async function slotAction(env, actor, action, body, corsHeaders) {
  if (actor.isAdmin) return json({ error: 'Your own sessions are edited in the schedule form, not here.' }, 400, corsHeaders);
  const slug = String(body.slug || '');
  const row = await env.DB.prepare('SELECT slug, owner_uid, slots_json FROM campaign_content WHERE slug=?').bind(slug).first();
  if (!row || row.owner_uid !== actor.uid) return json({ error: 'Not found' }, 404, corsHeaders);
  const slots = parseSlots(row);
  if (action === 'slots/list') return json({ slots }, 200, corsHeaders);

  const slotId = String(body.slotId || '');
  if (action === 'slots/delete') {
    if (!Object.prototype.hasOwnProperty.call(slots, slotId)) return json({ error: 'That session no longer exists.' }, 404, corsHeaders);
    delete slots[slotId];
  } else {
    const c = cleanSlot(body.slot);
    if (c.error) return json({ error: c.error }, 400, corsHeaders);
    let id = slotId;
    if (id) {
      // 'default' is the one session of a campaign made in the campaign editor; it may be created on first save.
      const known = Object.prototype.hasOwnProperty.call(slots, id);
      if (!known && id !== 'default') return json({ error: 'That session no longer exists.' }, 404, corsHeaders);
      if (!known && Object.keys(slots).length >= MAX_GM_SLOTS) return json({ error: `A campaign can have up to ${MAX_GM_SLOTS} sessions.` }, 400, corsHeaders);
    } else {
      if (Object.keys(slots).length >= MAX_GM_SLOTS) return json({ error: `A campaign can have up to ${MAX_GM_SLOTS} sessions.` }, 400, corsHeaders);
      id = 's' + Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('');
    }
    slots[id] = c.slot;
    body.__id = id;
  }
  await env.DB.prepare('UPDATE campaign_content SET slots_json=?, updated_at=? WHERE slug=? AND owner_uid=?')
    .bind(JSON.stringify(slots), new Date().toISOString(), slug, actor.uid).run();
  return json({ ok: true, slotId: body.__id || slotId, slots }, 200, corsHeaders);
}

async function saveCampaign(env, actor, body, self, corsHeaders) {
  const isNew = !body.slug;
  let slug = String(body.slug || '');
  const now = new Date().toISOString();

  let existing = null;
  if (!isNew) {
    existing = await env.DB.prepare('SELECT * FROM campaign_content WHERE slug=?').bind(slug).first();
    if (!existing || !ownedBy(existing, actor)) return json({ error: 'That campaign no longer exists.' }, 404, corsHeaders);
  } else if (!actor.isAdmin) {
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM campaign_content WHERE owner_uid=?').bind(actor.uid).first();
    if (n && n.n >= MAX_GM_CAMPAIGNS) return json({ error: `You can have up to ${MAX_GM_CAMPAIGNS} campaigns.` }, 400, corsHeaders);
  }

  // A brand-new campaign needs a title (it's how the slug gets made). Updating
  // an existing one can touch just one field (like the banner) without resending
  // everything, so an empty/omitted title there just keeps what was there.
  const titleInput = body.title !== undefined ? clean(body.title, FIELD_MAX.title) : undefined;
  if (isNew && !titleInput) return json({ error: 'Please give the campaign a title.' }, 400, corsHeaders);
  const title = isNew ? titleInput : (titleInput || existing.title);

  if (isNew) {
    slug = await uniqueSlug(env, slugify(title));
  }

  const fields = { title };
  FIELDS.slice(1).forEach((f) => { if (body[f] !== undefined) fields[f] = clean(body[f], FIELD_MAX[f]); });

  let bannerId = existing ? existing.banner_id : null;
  let bannerData = existing ? existing.banner_data : null;
  if (body.removeBanner === true) { bannerId = null; bannerData = null; }
  if (typeof body.banner === 'string' && body.banner) {
    if (body.banner.length > MAX_BANNER_CHARS || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(body.banner)) {
      return json({ error: 'That image is too big or not a supported picture. Try a smaller JPEG, PNG or WebP.' }, 400, corsHeaders);
    }
    bannerData = body.banner;
    const rnd = crypto.getRandomValues(new Uint8Array(12));
    bannerId = Array.from(rnd, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  const published = body.published === false ? 0 : 1;

  // Price and the seat floor: $5 minimum, no ceiling. A blank field (sent as null)
  // means "use the site default"; field left out of the request entirely (undefined)
  // means "don't touch it", so a banner-only save can't accidentally wipe the price.
  let price = existing ? existing.price : null;
  if (body.price !== undefined) {
    if (body.price === null || body.price === '') {
      price = null;
    } else {
      const n = Math.round(Number(body.price) * 100) / 100;
      if (!(n >= 5)) return json({ error: 'Price must be at least $5.' }, 400, corsHeaders);
      price = n;
    }
  }
  let minPlayers = existing ? existing.min_players : null;
  if (body.minPlayers !== undefined) {
    if (body.minPlayers === null || body.minPlayers === '') {
      minPlayers = null;
    } else {
      const n = Math.round(Number(body.minPlayers));
      if (!(Number.isInteger(n) && n >= 1 && n <= 20)) return json({ error: 'Minimum players must be between 1 and 20.' }, 400, corsHeaders);
      minPlayers = n;
    }
  }
  let openMode = existing ? existing.open_mode : 'now';
  let openAt = existing ? existing.open_at : null;
  if (body.openMode !== undefined) {
    if (body.openMode === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.openAt || ''))) return json({ error: 'Please pick an opening date.' }, 400, corsHeaders);
      openMode = 'date';
      openAt = String(body.openAt);
    } else {
      openMode = 'now';
      openAt = null;
    }
  }

  if (isNew) {
    await env.DB.prepare(
      `INSERT INTO campaign_content (slug, title, eyebrow, hook, intro, world, stakes, audience, tag, banner_id, banner_data, published, created_at, updated_at, owner_uid, price, min_players, open_mode, open_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(slug, title, fields.eyebrow || '', fields.hook || '', fields.intro || '', fields.world || '', fields.stakes || '', fields.audience || '', fields.tag || DEFAULT_TAG, bannerId, bannerData, published, now, now, actor.isAdmin ? null : actor.uid, price, minPlayers, openMode, openAt)
      .run();
  } else {
    await env.DB.prepare(
      `UPDATE campaign_content SET title=?, eyebrow=?, hook=?, intro=?, world=?, stakes=?, audience=?, tag=?, banner_id=?, banner_data=?, published=?, updated_at=?, price=?, min_players=?, open_mode=?, open_at=? WHERE slug=?`)
      .bind(title, fields.eyebrow ?? existing.eyebrow, fields.hook ?? existing.hook, fields.intro ?? existing.intro, fields.world ?? existing.world, fields.stakes ?? existing.stakes, fields.audience ?? existing.audience, fields.tag || existing.tag || DEFAULT_TAG, bannerId, bannerData, published, now, price, minPlayers, openMode, openAt, slug)
      .run();
  }
  const row = await env.DB.prepare('SELECT * FROM campaign_content WHERE slug=?').bind(slug).first();

  // The moment a campaign first appears on a Game Master's public page (not on every
  // later edit of an already-published one), tell anyone who follows them.
  const wasPublished = existing ? !!existing.published : false;
  if (published && !wasPublished) {
    const followedUid = actor.isAdmin ? env.ADMIN_UID : actor.uid;
    const followers = await followersOf(env, followedUid);
    if (followers.length) {
      let gmName = 'Ash';
      if (!actor.isAdmin) {
        const prof = await env.DB.prepare('SELECT data FROM gm_profiles WHERE uid=?').bind(actor.uid).first();
        try { gmName = (prof && JSON.parse(prof.data).name) || 'Your Game Master'; } catch { gmName = 'Your Game Master'; }
      }
      const mode = cfg(env).mode;
      for (const uid of followers) {
        await notifyPlayer(env, mode, uid, 'new_campaign', slug, `${gmName} posted a new game`, `${title} just went up on ${gmName}'s page. Take a look and grab a seat.`);
      }
    }
  }

  return json({ ...view(row, self), published: !!row.published, reserved: RESERVED_SLUGS.has(row.slug), ...(row.owner_uid ? { slots: parseSlots(row) } : {}) }, 200, corsHeaders);
}
