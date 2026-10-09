// Following a Game Master: a player can ask to hear the moment that GM publishes a new
// campaign, instead of checking their page by hand. Anyone can see how many people follow
// a GM (no sign-in needed); following or unfollowing needs an account. The actual "someone
// published a new campaign" notification is sent from content.js's saveCampaign, using the
// same notifications list a player already has for everything else (skipped sessions,
// declined cards, and so on).

import { verifyUser } from './pay.js';

function json(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
}

async function gmUidFor(env, slug) {
  if (slug === 'ash') return env.ADMIN_UID;
  const row = await env.DB.prepare('SELECT uid FROM gm_profiles WHERE slug=?').bind(slug).first();
  return row ? row.uid : '';
}

async function followerCount(env, gmUid) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM gm_followers WHERE gm_uid=?').bind(gmUid).first();
  return row ? row.n : 0;
}

export async function handleFollow(request, env, corsHeaders, origin, action, verify = verifyUser) {
  // Anyone can see how many people follow a Game Master; no sign-in needed.
  if (action === 'count' && request.method === 'GET') {
    const slug = (new URL(request.url).searchParams.get('slug') || '').toLowerCase();
    const gmUid = await gmUidFor(env, slug);
    return json({ count: gmUid ? await followerCount(env, gmUid) : 0 }, 200, corsHeaders);
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, corsHeaders);
  if (!origin) return json({ error: 'Origin not allowed' }, 403, corsHeaders);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400, corsHeaders); }
  if (!body || !body.idToken) return json({ error: 'Please sign in again.' }, 401, corsHeaders);
  let user;
  try { user = await verify(env, body.idToken); } catch { return json({ error: 'Please sign in again.' }, 401, corsHeaders); }

  const slug = String(body.gmSlug || '').toLowerCase();
  const gmUid = await gmUidFor(env, slug);
  if (!gmUid) return json({ error: 'That Game Master could not be found.' }, 404, corsHeaders);
  if (gmUid === user.sub) return json({ error: 'You cannot follow your own page.' }, 400, corsHeaders);

  if (action === 'status') {
    const row = await env.DB.prepare('SELECT 1 AS x FROM gm_followers WHERE uid=? AND gm_uid=?').bind(user.sub, gmUid).first();
    return json({ following: !!row, count: await followerCount(env, gmUid) }, 200, corsHeaders);
  }

  if (action === 'toggle') {
    const existing = await env.DB.prepare('SELECT 1 AS x FROM gm_followers WHERE uid=? AND gm_uid=?').bind(user.sub, gmUid).first();
    if (existing) {
      await env.DB.prepare('DELETE FROM gm_followers WHERE uid=? AND gm_uid=?').bind(user.sub, gmUid).run();
    } else {
      await env.DB.prepare('INSERT INTO gm_followers (uid, gm_uid, created_at) VALUES (?,?,?)').bind(user.sub, gmUid, new Date().toISOString()).run();
    }
    return json({ following: !existing, count: await followerCount(env, gmUid) }, 200, corsHeaders);
  }

  return json({ error: 'Not found' }, 404, corsHeaders);
}

// Used by content.js when a campaign newly goes live, to find who to tell.
export async function followersOf(env, gmUid) {
  return (await env.DB.prepare('SELECT uid FROM gm_followers WHERE gm_uid=?').bind(gmUid).all()).results.map((r) => r.uid);
}
