// Game Master profiles: the page a GM fills in about themselves (name, picture, banner,
// tools, bio, how their tables feel, answers to a few questions, social links and the
// chat button). Visitors read a profile with no sign-in. Only a GM can change their OWN
// profile. For now the only GM is the account whose id is ADMIN_UID (Ash); more GMs are
// added later by adding their ids to GM_UIDS.

import { verifyUser } from './pay.js';

const QUALITY_IDS = ['welcoming', 'rulecool', 'prepped', 'lowpressure', 'beginner', 'story', 'roleplay', 'combat', 'humor', 'dark', 'cozy', 'puzzles', 'sandbox', 'safety', 'lgbtq', 'voices'];
const QUESTION_IDS = ['became', 'comfort', 'newplayer', 'style', 'expect', 'session0', 'why', 'prep'];
const SOCIAL_IDS = ['youtube', 'instagram', 'x', 'bluesky', 'patreon', 'twitch', 'tiktok', 'website'];
const MAX_AVATAR_CHARS = 140000;
// The look a Game Master gives their own page: four colors and two fonts (the font names are the ones the editor offers).
const THEME_FONTS = ['poppins', 'cinzel', 'playfair', 'medieval', 'uncial', 'creepster', 'pacifico', 'lobster', 'caveat', 'bungee', 'orbitron', 'pixel', 'righteous', 'fredoka'];
const THEME_PRESETS = ['classic', 'ember', 'ocean', 'forest', 'rose', 'violet', 'gold', 'blood', 'parchment', 'mono', 'custom'];
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
function cleanTheme(t) {
  const x = t && typeof t === 'object' ? t : {};
  const col = (v, d) => (HEX_COLOR.test(String(v || '')) ? String(v).toLowerCase() : d);
  return {
    preset: THEME_PRESETS.includes(x.preset) ? x.preset : 'custom',
    bg: col(x.bg, '#120b1c'), glowA: col(x.glowA, '#7b4dff'), glowB: col(x.glowB, '#2cc6ff'), accent: col(x.accent, '#f2b84f'),
    nameFont: THEME_FONTS.includes(x.nameFont) ? x.nameFont : 'poppins',
    tagFont: THEME_FONTS.includes(x.tagFont) ? x.tagFont : 'poppins',
  };
}
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

// Who is a Game Master: Ash herself, anyone listed in GM_UIDS, and anyone who signed the Game Master
// Agreement and linked their account to it, for as long as that agreement has not expired.
//
// Pass the signed-in user's token details as the third argument and an account whose email is VERIFIED
// (for example a Google sign-in) is linked automatically to an unlinked agreement signed with that same email.
// Accounts whose email is not verified have to link with the private key from the agreement page.
export async function gmStatus(env, uid, user) {
  if (!uid) return { isGm: false, isAdmin: false };
  if (uid === env.ADMIN_UID) return { isGm: true, isAdmin: true };
  if (String(env.GM_UIDS || '').split(',').map((x) => x.trim()).filter(Boolean).includes(uid)) return { isGm: true, isAdmin: false };
  const nowIso = new Date().toISOString();
  let row = await env.DB.prepare('SELECT 1 AS x FROM dm_agreements WHERE uid=? AND expires_at > ? LIMIT 1').bind(uid, nowIso).first();
  if (!row && user && user.email_verified === true && user.email) {
    const email = String(user.email).toLowerCase();
    const res = await env.DB.prepare('UPDATE dm_agreements SET uid=? WHERE email=? AND uid IS NULL AND expires_at > ?').bind(uid, email, nowIso).run();
    if (res.meta && res.meta.changes > 0) row = { x: 1 };
  }
  return { isGm: !!row, isAdmin: false };
}

// Turns whatever the browser sent into a clean, size-limited profile.
export function cleanProfile(input) {
  const p = input && typeof input === 'object' ? input : {};
  const tools = [];
  (Array.isArray(p.tools) ? p.tools : []).forEach((t) => { const v = text(t, 30); if (v && !tools.includes(v) && tools.length < 24) tools.push(v); });
  const systems = [];
  (Array.isArray(p.systems) ? p.systems : []).forEach((t) => { const v = text(t, 40); if (v && !systems.includes(v) && systems.length < 16) systems.push(v); });
  const languages = [];
  (Array.isArray(p.languages) ? p.languages : []).forEach((t) => { const v = text(t, 30); if (v && !languages.includes(v) && languages.length < 12) languages.push(v); });
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
    systems,
    languages,
    theme: cleanTheme(p.theme),
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

  // A Game Master's picture, as an ordinary image address (the home page uses it).
  if (action === 'avatar' && request.method === 'GET') {
    const slug = new URL(request.url).searchParams.get('slug') || '';
    if (!/^[a-z0-9-]{1,40}$/.test(slug)) return new Response('Not found', { status: 404, headers: corsHeaders });
    const row = await env.DB.prepare('SELECT data FROM gm_profiles WHERE slug=?').bind(slug).first();
    let p = {};
    try { p = JSON.parse((row && row.data) || '{}') || {}; } catch { p = {}; }
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(p.avatar || '');
    if (!m) return new Response('Not found', { status: 404, headers: corsHeaders });
    const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
    return new Response(bytes, { status: 200, headers: { 'Content-Type': m[1], 'Cache-Control': 'public, max-age=300', ...corsHeaders } });
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, corsHeaders);
  if (!origin) return json({ error: 'Origin not allowed' }, 403, corsHeaders);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400, corsHeaders); }
  if (!body || !body.idToken) return json({ error: 'Please sign in again.' }, 401, corsHeaders);
  let user;
  try { user = await verify(env, body.idToken); } catch { return json({ error: 'Please sign in again.' }, 401, corsHeaders); }

  const status = await gmStatus(env, user.sub, user);
  const gm = status.isGm;
  if (action === 'get') {
    if (!gm) return json({ isGm: false }, 200, corsHeaders);
    const row = await env.DB.prepare('SELECT slug, data FROM gm_profiles WHERE uid=?').bind(user.sub).first();
    let profile = null;
    try { profile = row ? JSON.parse(row.data) : null; } catch { profile = null; }
    // The person's ordinary site profile (name, pronouns, picture) is where a new GM profile starts from.
    const acct = await env.DB.prepare('SELECT name, pronouns, avatar_id FROM profiles WHERE uid=?').bind(user.sub).first();
    const account = acct ? {
      name: text(acct.name, 40), pronouns: text(acct.pronouns, 40),
      avatar: acct.avatar_id ? `${new URL(request.url).origin}/profile/avatar/${acct.avatar_id}` : '',
    } : null;
    return json({ isGm: true, isAdmin: status.isAdmin, name: text(user.name || (user.email || '').split('@')[0], 40), account, slug: row ? row.slug : slugFor(env, user), profile }, 200, corsHeaders);
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
