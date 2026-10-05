// Game Master profiles: the page a GM fills in about themselves (name, picture, banner,
// tools, bio, how their tables feel, answers to a few questions, social links and the
// chat button). Visitors read a profile with no sign-in. Only a GM can change their OWN
// profile. For now the only GM is the account whose id is ADMIN_UID (Ash); more GMs are
// added later by adding their ids to GM_UIDS.

import { verifyUser } from './pay.js';

const QUALITY_IDS = ['welcoming', 'rulecool', 'prepped', 'lowpressure', 'beginner', 'story', 'roleplay', 'combat', 'humor', 'dark', 'cozy', 'puzzles', 'sandbox', 'safety', 'lgbtq', 'voices'];
const QUESTION_IDS = ['became', 'comfort', 'newplayer', 'style', 'expect', 'session0', 'why', 'prep'];
const SOCIAL_IDS = ['youtube', 'instagram', 'x', 'bluesky', 'patreon', 'twitch', 'tiktok', 'website'];
const MAX_AVATAR_CHARS = 90000;
const MAX_BANNER_CHARS = 330000;

function json(data, status, corsHeaders, extra) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...(extra || {}), ...corsHeaders } });
}

// Plain text only: no tags, no control characters.
const text = (v, max) => String(v == null ? '' : v).replace(/<[^>]*>/g, ' ').replace(/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').replace(/[ \t]+/g, ' ').trim().slice(0, max);
const longText = (v, max) => String(v == null ? '' : v).replace(/<[^>]*>/g, ' ').replace(/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim().slice(0, max);

function webUrl(v) {
  try {
    const u = new URL(String(v || '').trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href.slice(0, 300) : '';
  } catch { return ''; }
}
function picture(v, max) {
  const s = String(v || '');
  return /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s) && s.length <= max ? s : '';
}

export function isGm(env, user) {
  if (user.sub === env.ADMIN_UID) return true;
  return String(env.GM_UIDS || '').split(',').map((x) => x.trim()).filter(Boolean).includes(user.sub);
}

// Turns whatever the browser sent into a clean, size-limited profile.
export function cleanProfile(input) {
  const p = input && typeof input === 'object' ? input : {};
  const tools = [];
  (Array.isArray(p.tools) ? p.tools : []).forEach((t) => { const v = text(t, 30); if (v && !tools.includes(v) && tools.length < 24) tools.push(v); });
  const qualities = [];
  (Array.isArray(p.qualities) ? p.qualities : []).forEach((q) => { if (QUALITY_IDS.includes(q) && !qualities.includes(q) && qualities.length < 4) qualities.push(q); });
  const questions = [];
  (Array.isArray(p.questions) ? p.questions : []).forEach((q) => {
    const answer = q && longText(q.answer, 700);
    if (q && QUESTION_IDS.includes(q.id) && answer && !questions.some((x) => x.id === q.id) && questions.length < 3) questions.push({ id: q.id, answer });
  });
  const socials = {};
  SOCIAL_IDS.forEach((k) => { const u = webUrl(p.socials && p.socials[k]); if (u) socials[k] = u; });
  return {
    name: text(p.name, 40),
    pronouns: text(p.pronouns, 30),
    tagline: text(p.tagline, 90),
    tools,
    bio: longText(p.bio, 900),
    qualities,
    questions,
    socials,
    discord: webUrl(p.discord),
    avatar: picture(p.avatar, MAX_AVATAR_CHARS),
    banner: picture(p.banner, MAX_BANNER_CHARS),
  };
}

function slugFor(env, user) {
  return user.sub === env.ADMIN_UID ? 'ash' : 'gm-' + String(user.sub).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10);
}

export async function handleGm(request, env, corsHeaders, origin, action, verify = verifyUser) {
  // Anyone can read a published profile.
  if (action === 'public' && request.method === 'GET') {
    const slug = new URL(request.url).searchParams.get('slug') || '';
    if (!/^[a-z0-9-]{1,40}$/.test(slug)) return json({ error: 'Not found' }, 404, corsHeaders);
    const row = await env.DB.prepare('SELECT data FROM gm_profiles WHERE slug=?').bind(slug).first();
    if (!row) return json({ profile: null }, 200, corsHeaders, { 'Cache-Control': 'public, max-age=30' });
    let profile = null;
    try { profile = JSON.parse(row.data); } catch { profile = null; }
    return json({ profile }, 200, corsHeaders, { 'Cache-Control': 'public, max-age=30' });
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, corsHeaders);
  if (!origin) return json({ error: 'Origin not allowed' }, 403, corsHeaders);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400, corsHeaders); }
  if (!body || !body.idToken) return json({ error: 'Please sign in again.' }, 401, corsHeaders);
  let user;
  try { user = await verify(env, body.idToken); } catch { return json({ error: 'Please sign in again.' }, 401, corsHeaders); }

  const gm = isGm(env, user);
  if (action === 'get') {
    if (!gm) return json({ isGm: false }, 200, corsHeaders);
    const row = await env.DB.prepare('SELECT slug, data FROM gm_profiles WHERE uid=?').bind(user.sub).first();
    let profile = null;
    try { profile = row ? JSON.parse(row.data) : null; } catch { profile = null; }
    return json({ isGm: true, isAdmin: user.sub === env.ADMIN_UID, name: text(user.name || (user.email || '').split('@')[0], 40), slug: row ? row.slug : slugFor(env, user), profile }, 200, corsHeaders);
  }

  if (action === 'save') {
    if (!gm) return json({ error: 'GM profiles are for Game Masters.' }, 403, corsHeaders);
    const profile = cleanProfile(body.profile);
    if (!profile.name) return json({ error: 'Please add your name first.' }, 400, corsHeaders);
    const slug = slugFor(env, user);
    await env.DB.prepare(
      `INSERT INTO gm_profiles (uid, slug, data, updated_at) VALUES (?,?,?,?)
       ON CONFLICT(uid) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at`)
      .bind(user.sub, slug, JSON.stringify(profile), new Date().toISOString()).run();
    return json({ ok: true, slug }, 200, corsHeaders);
  }

  return json({ error: 'Not found' }, 404, corsHeaders);
}
