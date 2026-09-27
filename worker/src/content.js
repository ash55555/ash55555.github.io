// Campaign page content: title, hook, story, and the banner image, all editable
// from the admin "Campaigns" tab. Public blog pages fetch the published version
// with no sign-in needed; only the admin (Ash) can write.

import { verifyUser } from './pay.js';

const MAX_BANNER_CHARS = 260000; // a landscape banner, base64 text (~190KB of image)
const FIELDS = ['title', 'eyebrow', 'hook', 'intro', 'world', 'stakes', 'audience'];
const FIELD_MAX = { title: 80, eyebrow: 70, hook: 220, intro: 2500, world: 2500, stakes: 2500, audience: 2500 };

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

function view(row, origin) {
  const out = { slug: row.slug, updatedAt: row.updated_at, bannerUrl: row.banner_id ? `${origin}/content/banner/${row.banner_id}` : null };
  FIELDS.forEach((f) => { out[f] = row[f] || ''; });
  return out;
}

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
  return json(view(row, url.origin), 200, { 'Cache-Control': 'public, max-age=30', ...corsHeaders });
}

export async function handleContentAdmin(request, env, corsHeaders, origin, action, verify = verifyUser) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, corsHeaders);
  if (!origin) return json({ error: 'Origin not allowed' }, 403, corsHeaders);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400, corsHeaders); }
  if (!body || !body.idToken) return json({ error: 'Please sign in again.' }, 401, corsHeaders);
  let user;
  try { user = await verify(env, body.idToken); } catch { return json({ error: 'Please sign in again.' }, 401, corsHeaders); }
  if (user.sub !== env.ADMIN_UID) return json({ error: 'Not authorized' }, 403, corsHeaders);

  const self = new URL(request.url).origin;
  try {
    if (action === 'list') {
      const rows = (await env.DB.prepare('SELECT slug, title, eyebrow, banner_id, published, updated_at FROM campaign_content ORDER BY updated_at DESC').all()).results;
      return json({ campaigns: rows.map((r) => ({ slug: r.slug, title: r.title, eyebrow: r.eyebrow, published: !!r.published, updatedAt: r.updated_at, bannerUrl: r.banner_id ? `${self}/content/banner/${r.banner_id}` : null, reserved: RESERVED_SLUGS.has(r.slug) })) }, 200, corsHeaders);
    }
    if (action === 'get') {
      const slug = String(body.slug || '');
      const row = await env.DB.prepare('SELECT * FROM campaign_content WHERE slug=?').bind(slug).first();
      if (!row) return json({ error: 'Not found' }, 404, corsHeaders);
      return json({ ...view(row, self), published: !!row.published, reserved: RESERVED_SLUGS.has(row.slug) }, 200, corsHeaders);
    }
    if (action === 'save') return await saveCampaign(env, body, self, corsHeaders);
    return json({ error: 'Unknown action' }, 404, corsHeaders);
  } catch (err) {
    return json({ error: err.message || 'Something went wrong.' }, 502, corsHeaders);
  }
}

async function saveCampaign(env, body, self, corsHeaders) {
  const isNew = !body.slug;
  let slug = String(body.slug || '');
  const now = new Date().toISOString();

  let existing = null;
  if (!isNew) {
    existing = await env.DB.prepare('SELECT * FROM campaign_content WHERE slug=?').bind(slug).first();
    if (!existing) return json({ error: 'That campaign no longer exists.' }, 404, corsHeaders);
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

  if (isNew) {
    await env.DB.prepare(
      `INSERT INTO campaign_content (slug, title, eyebrow, hook, intro, world, stakes, audience, banner_id, banner_data, published, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(slug, title, fields.eyebrow || '', fields.hook || '', fields.intro || '', fields.world || '', fields.stakes || '', fields.audience || '', bannerId, bannerData, published, now, now)
      .run();
  } else {
    await env.DB.prepare(
      `UPDATE campaign_content SET title=?, eyebrow=?, hook=?, intro=?, world=?, stakes=?, audience=?, banner_id=?, banner_data=?, published=?, updated_at=? WHERE slug=?`)
      .bind(title, fields.eyebrow ?? existing.eyebrow, fields.hook ?? existing.hook, fields.intro ?? existing.intro, fields.world ?? existing.world, fields.stakes ?? existing.stakes, fields.audience ?? existing.audience, bannerId, bannerData, published, now, slug)
      .run();
  }
  const row = await env.DB.prepare('SELECT * FROM campaign_content WHERE slug=?').bind(slug).first();
  return json({ ...view(row, self), published: !!row.published, reserved: RESERVED_SLUGS.has(row.slug) }, 200, corsHeaders);
}
