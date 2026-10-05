// Player profiles: display name, pronouns, bio, picture, token, the games a player
// wants to play, and the weekly hours they can play. Any signed-in player can read
// and change their OWN profile. Only the admin can read everyone's (to plan games).
//
// Availability is stored as 336 characters, one per half hour of the player's OWN
// local week (index 0 = Sunday 00:00 local), together with their time zone name.
// Storing local hours means a daylight saving change never moves what they marked.
// The admin page converts each player's week to the admin's own clock when it draws
// the heat map. Saves made before this change were in UTC (slots_fmt not "local").

import { verifyUser, cfg } from './pay.js';
import { noteAccount } from './accounts.js';
import { gmStatus } from './gm.js';

const SLOT_COUNT = 336;
const TOKEN_IDS = ['dragon', 'wizard', 'dagger', 'elf', 'bat', 'dice'];
const MAX_AVATAR_CHARS = 70000; // base64 text of a ~256px picture is about 20 to 40 KB

function json(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

const clean = (v, max) => String(v == null ? '' : v).replace(/<[^>]*>/g, ' ').replace(/[<>\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanBio = (v) => String(v == null ? '' : v).replace(/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, 500);

function avatarUrl(origin, row) {
  return row && row.avatar_id ? `${origin}/profile/avatar/${row.avatar_id}` : null;
}

function view(row, origin) {
  if (!row) return { name: '', pronouns: '', token: 'wizard', bio: '', avatarUrl: null, interests: [], other: '', slots: '0'.repeat(SLOT_COUNT), tz: '' };
  let interests = [];
  try { interests = JSON.parse(row.interests || '[]'); } catch { interests = []; }
  return {
    name: row.name || '',
    pronouns: row.pronouns || '',
    token: row.token || 'wizard',
    bio: row.bio || '',
    avatarUrl: avatarUrl(origin, row),
    interests,
    other: row.other || '',
    slots: row.slots && row.slots.length === SLOT_COUNT ? row.slots : '0'.repeat(SLOT_COUNT),
    tz: row.tz || '',
    fmt: row.slots_fmt === 'local' ? 'local' : 'utc',
  };
}

// Public picture endpoint. The id is random and changes with every new upload, so
// pictures can be cached for a long time.
export async function handleAvatar(request, env, corsHeaders, id) {
  if (!/^[a-f0-9]{16,64}$/.test(id)) return new Response('Not found', { status: 404, headers: corsHeaders });
  const row = await env.DB.prepare('SELECT avatar_data FROM profiles WHERE avatar_id=?').bind(id).first();
  const m = row && /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(row.avatar_data || '');
  if (!m) return new Response('Not found', { status: 404, headers: corsHeaders });
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  return new Response(bytes, {
    status: 200,
    headers: { 'Content-Type': m[1], 'Cache-Control': 'public, max-age=86400', ...corsHeaders },
  });
}

export async function handleProfile(request, env, corsHeaders, origin, action, sendEmail, verify = verifyUser) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, corsHeaders);
  if (!origin) return json({ error: 'Origin not allowed' }, 403, corsHeaders);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400, corsHeaders); }
  if (!body || !body.idToken) return json({ error: 'Please sign in again.' }, 401, corsHeaders);

  let user;
  try { user = await verify(env, body.idToken); } catch { return json({ error: 'Please sign in again.' }, 401, corsHeaders); }

  // First time we see a brand-new account, tell Ash.
  await noteAccount(env, sendEmail, user, body.idToken);

  const self = new URL(request.url).origin;
  try {
    if (action === 'get') {
      const row = await env.DB.prepare('SELECT * FROM profiles WHERE uid=?').bind(user.sub).first();
      const v = view(row, self);
      if (!v.name) v.name = clean(user.name || (user.email || '').split('@')[0], 30);
      v.isAdmin = user.sub === env.ADMIN_UID;
      v.isGm = (await gmStatus(env, user.sub, user)).isGm;
      return json(v, 200, corsHeaders);
    }

    if (action === 'save') return await saveProfile(env, user, body, corsHeaders, self);
    if (action === 'availability') return await saveAvailability(env, user, body, corsHeaders);

    // Players see only their own notifications. Ash's player side shows the same single list as the
    // DM Notifications tab (the DM ones plus Ash's own), so reading one reads both. Only for Ash's account.
    const isAsh = user.sub === env.ADMIN_UID;
    if (action === 'notifications') {
      const mode = cfg(env).mode;
      const items = isAsh
        ? (await env.DB.prepare('SELECT id, created_at, kind, game, title, body, read FROM notifications WHERE mode=? AND (uid IS NULL OR uid=?) ORDER BY id DESC LIMIT 40').bind(mode, user.sub).all()).results
        : (await env.DB.prepare('SELECT id, created_at, kind, game, title, body, read FROM notifications WHERE mode=? AND uid=? ORDER BY id DESC LIMIT 20').bind(mode, user.sub).all()).results;
      const unread = isAsh
        ? await env.DB.prepare('SELECT COUNT(*) AS n FROM notifications WHERE mode=? AND (uid IS NULL OR uid=?) AND read=0').bind(mode, user.sub).first()
        : await env.DB.prepare('SELECT COUNT(*) AS n FROM notifications WHERE mode=? AND uid=? AND read=0').bind(mode, user.sub).first();
      return json({ items, unread: unread ? unread.n : 0 }, 200, corsHeaders);
    }
    if (action === 'notifications/read') {
      if (isAsh) await env.DB.prepare('UPDATE notifications SET read=1 WHERE mode=? AND (uid IS NULL OR uid=?) AND read=0').bind(cfg(env).mode, user.sub).run();
      else await env.DB.prepare('UPDATE notifications SET read=1 WHERE mode=? AND uid=? AND read=0').bind(cfg(env).mode, user.sub).run();
      return json({ ok: true }, 200, corsHeaders);
    }

    if (action === 'admin/summary') {
      const who = await gmStatus(env, user.sub);
      if (!who.isGm) return json({ error: 'Not authorized' }, 403, corsHeaders);
      // A Game Master sees the demand (when players are free, what they want to play) but never who the players are.
      const anonymous = !who.isAdmin;
      const rows = (await env.DB.prepare('SELECT uid, email, name, pronouns, token, avatar_id, interests, other, slots, tz, slots_fmt, updated_at FROM profiles').all()).results;
      return json({
        players: rows.map((r) => {
          let interests = [];
          try { interests = JSON.parse(r.interests || '[]'); } catch { interests = []; }
          return {
            uid: anonymous ? '' : r.uid, email: anonymous ? '' : r.email, name: anonymous ? 'Player' : (r.name || (r.email || '').split('@')[0]), pronouns: anonymous ? '' : (r.pronouns || ''),
            avatarUrl: anonymous ? null : avatarUrl(self, r), interests, other: r.other || '',
            slots: r.slots && r.slots.length === SLOT_COUNT ? r.slots : null, tz: r.tz || '', fmt: r.slots_fmt === 'local' ? 'local' : 'utc', updatedAt: r.updated_at,
          };
        }),
      }, 200, corsHeaders);
    }
    return json({ error: 'Unknown action' }, 404, corsHeaders);
  } catch (err) {
    return json({ error: err.message || 'Something went wrong.' }, 502, corsHeaders);
  }
}

async function saveProfile(env, user, body, corsHeaders, self) {
  const existing = await env.DB.prepare('SELECT * FROM profiles WHERE uid=?').bind(user.sub).first();
  const next = {
    name: existing ? existing.name : '',
    pronouns: existing ? existing.pronouns : '',
    token: existing ? existing.token : 'wizard',
    bio: existing ? existing.bio : '',
    avatar_id: existing ? existing.avatar_id : null,
    avatar_data: existing ? existing.avatar_data : null,
    interests: existing ? existing.interests : '[]',
    other: existing ? existing.other : '',
  };

  if (body.name !== undefined) {
    const n = clean(body.name, 30);
    if (!n) return json({ error: 'Please enter a display name.' }, 400, corsHeaders);
    next.name = n;
  }
  if (body.pronouns !== undefined) next.pronouns = clean(body.pronouns, 30);
  if (body.bio !== undefined) next.bio = cleanBio(body.bio);
  if (body.token !== undefined) {
    if (!TOKEN_IDS.includes(body.token)) return json({ error: 'That token does not exist.' }, 400, corsHeaders);
    next.token = body.token;
  }
  if (body.other !== undefined) next.other = clean(body.other, 120);
  if (body.interests !== undefined) {
    if (!Array.isArray(body.interests)) return json({ error: 'Invalid list of games.' }, 400, corsHeaders);
    const list = [...new Set(body.interests.map((s) => clean(s, 90)).filter(Boolean))].slice(0, 80);
    next.interests = JSON.stringify(list);
  }
  if (body.removeAvatar === true) { next.avatar_id = null; next.avatar_data = null; }
  if (typeof body.avatar === 'string' && body.avatar) {
    if (body.avatar.length > MAX_AVATAR_CHARS || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(body.avatar)) {
      return json({ error: 'That picture is too big or not a supported image. Try a smaller JPEG or PNG.' }, 400, corsHeaders);
    }
    next.avatar_data = body.avatar;
    const rnd = crypto.getRandomValues(new Uint8Array(12));
    next.avatar_id = Array.from(rnd, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO profiles (uid, email, name, pronouns, token, bio, avatar_id, avatar_data, interests, other, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(uid) DO UPDATE SET email=excluded.email, name=excluded.name, pronouns=excluded.pronouns, token=excluded.token,
       bio=excluded.bio, avatar_id=excluded.avatar_id, avatar_data=excluded.avatar_data, interests=excluded.interests,
       other=excluded.other, updated_at=excluded.updated_at`)
    .bind(user.sub, (user.email || '').toLowerCase(), next.name, next.pronouns, next.token, next.bio, next.avatar_id, next.avatar_data, next.interests, next.other, now).run();

  const row = await env.DB.prepare('SELECT * FROM profiles WHERE uid=?').bind(user.sub).first();
  return json(view(row, self), 200, corsHeaders);
}

async function saveAvailability(env, user, body, corsHeaders) {
  const slots = String(body.slots || '');
  if (!new RegExp(`^[01]{${SLOT_COUNT}}$`).test(slots)) return json({ error: 'Invalid calendar.' }, 400, corsHeaders);
  const tz = clean(body.tz, 64);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO profiles (uid, email, name, slots, tz, slots_fmt, updated_at) VALUES (?,?,?,?,?,'local',?)
     ON CONFLICT(uid) DO UPDATE SET slots=excluded.slots, tz=excluded.tz, slots_fmt='local', updated_at=excluded.updated_at`)
    .bind(user.sub, (user.email || '').toLowerCase(), clean(user.name || (user.email || '').split('@')[0], 30), slots, tz, now).run();
  return json({ ok: true }, 200, corsHeaders);
}
