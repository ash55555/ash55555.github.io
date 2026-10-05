// Game Master Agreement: signing, the signed PDF copy, the emails to both sides, the record the
// site keeps, the 30-day renewal reminder, and the list Ash sees in her GM Dashboard.
//
// Anyone with the signing link can sign (that is the point: Ash sends the link to a GM). To keep it
// from being abused: a name and a real-looking email are required, the person must tick the box, there
// is a hidden trap field for bots, and each internet address can only sign a few times an hour.

import { AGREEMENT, agreementParagraphs } from '../../dm-agreement-text.js';
import { verifyUser, notify, cfg, escapeHtml } from './pay.js';

const SITE = 'https://ashtabletop.com';
const REMIND_DAYS = 30;

function json(data, status, corsHeaders, extra) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...(extra || {}), ...corsHeaders } });
}
const clean = (v, max) => String(v == null ? '' : v).replace(/<[^>]*>/g, ' ').replace(/[<>\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function randomHex(bytes) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// One year from the signing day. 29 February signers get 28 February the next year (set* would roll over).
export function expiryFrom(signed) {
  const d = new Date(signed.getTime());
  const y = d.getUTCFullYear() + AGREEMENT.termMonths / 12;
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const out = new Date(Date.UTC(y, m, day, 23, 59, 59));
  if (out.getUTCMonth() !== m) return new Date(Date.UTC(y, m + 1, 0, 23, 59, 59));
  return out;
}
export function longDate(d) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// ---------------------------------------------------------------- the PDF (a small, plain, one-font document)
const WIDTH = { narrow: 278, wide: 833, upper: 667, normal: 540 };
function charW(ch) {
  if ('il.,;:\'|!tfjI()[]'.includes(ch) || ch === ' ') return WIDTH.narrow;
  if ('mwMW'.includes(ch)) return WIDTH.wide;
  if (ch >= 'A' && ch <= 'Z') return WIDTH.upper;
  return WIDTH.normal;
}
function textWidth(s, size, bold) {
  let w = 0;
  for (const ch of s) w += charW(ch);
  return (w / 1000) * size * (bold ? 1.06 : 1);
}
function wrap(text, size, maxW, bold) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const trial = line ? line + ' ' + w : w;
    if (textWidth(trial, size, bold) <= maxW) line = trial;
    else { if (line) lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}
function pdfSafe(s) {
  return String(s)
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...')
    .replace(/[^\x20-\x7e]/g, '?')
    .replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

// items: [{ kind: 'title'|'h'|'p'|'small'|'gap', text }]
export function buildPdf(items) {
  const PW = 595, PH = 842, M = 58, TOP = PH - 64, BOTTOM = 64;
  const maxW = PW - 2 * M;
  const pages = [];
  let ops = [];
  let y = TOP;
  function newPage() { if (ops.length) pages.push(ops.join('\n')); ops = []; y = TOP; }
  function put(text, size, bold, indent) {
    ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${M + (indent || 0)} ${y.toFixed(1)} Td (${pdfSafe(text)}) Tj ET`);
  }
  for (const it of items) {
    if (it.kind === 'gap') { y -= it.size || 8; continue; }
    const style = it.kind === 'title' ? { size: 20, bold: true, lead: 26 } : it.kind === 'h' ? { size: 12.5, bold: true, lead: 17 } : it.kind === 'small' ? { size: 9, bold: false, lead: 12.5 } : { size: 10.5, bold: false, lead: 14.5 };
    const lines = wrap(it.text, style.size, maxW, style.bold);
    if (it.kind === 'h') { y -= 8; if (y - style.lead * 3 < BOTTOM) newPage(); }
    for (const l of lines) {
      if (y - style.lead < BOTTOM) newPage();
      put(l, style.size, style.bold);
      y -= style.lead;
    }
    if (it.kind === 'p') y -= 5;
    if (it.kind === 'title') y -= 4;
  }
  newPage();

  // number the pages
  const total = pages.length;
  const streams = pages.map((p, i) => `${p}\nBT /F1 9 Tf ${PW / 2 - 30} 36 Td (Page ${i + 1} of ${total}) Tj ET`);

  const objs = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  const kids = streams.map((_, i) => `${5 + i * 2} 0 R`).join(' ');
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${total} >>`;
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  streams.forEach((s, i) => {
    const contentNo = 6 + i * 2;
    objs[5 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNo} 0 R >>`;
    objs[contentNo] = `<< /Length ${s.length} >>\nstream\n${s}\nendstream`;
  });
  let out = '%PDF-1.4\n';
  const offsets = [];
  for (let n = 1; n < objs.length; n++) {
    offsets[n] = out.length;
    out += `${n} 0 obj\n${objs[n]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let n = 1; n < objs.length; n++) out += String(offsets[n]).padStart(10, '0') + ' 00000 n \n';
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return out; // ASCII only, so string length equals byte length
}

function toBase64(str) {
  let bin = '';
  for (let i = 0; i < str.length; i++) bin += String.fromCharCode(str.charCodeAt(i) & 0xff);
  return btoa(bin);
}

export function signedItems(rec) {
  const items = [
    { kind: 'title', text: AGREEMENT.title },
    { kind: 'small', text: `${AGREEMENT.platform}   |   Version ${rec.version}   |   Agreement number ${rec.id.slice(0, 12).toUpperCase()}` },
    { kind: 'gap', size: 8 },
  ];
  agreementParagraphs().forEach((p) => items.push(p));
  items.push({ kind: 'gap', size: 10 });
  items.push({ kind: 'h', text: 'Signed' });
  items.push({ kind: 'p', text: `Signed electronically by ${rec.name} (${rec.email}) on ${longDate(rec.signed_at)}, at ${new Date(rec.signed_at).toISOString().slice(11, 16)} UTC.` });
  items.push({ kind: 'p', text: `This agreement starts on ${longDate(rec.signed_at)} and runs until ${longDate(rec.expires_at)}. It can be renewed by signing again.` });
  items.push({ kind: 'small', text: `Fingerprint of the signed text: ${rec.text_hash}` });
  return items;
}

// ---------------------------------------------------------------- emails
function copyEmailHtml(rec, forAsh, pdfLink) {
  const who = forAsh ? `${escapeHtml(rec.name)} (${escapeHtml(rec.email)}) signed the Game Master Agreement.` : `Thank you, ${escapeHtml(rec.name)}. You signed the Game Master Agreement.`;
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#241a3d">
    <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#9b6dff;font-weight:700">Signed agreement</p>
    <h2 style="margin:0 0 12px">${who}</h2>
    <table style="border-collapse:collapse;margin:12px 0;font-size:14px">
      <tr><td style="padding:4px 14px 4px 0;color:#7a6c99">Signed on</td><td><b>${longDate(rec.signed_at)}</b></td></tr>
      <tr><td style="padding:4px 14px 4px 0;color:#7a6c99">Runs until</td><td><b>${longDate(rec.expires_at)}</b></td></tr>
      <tr><td style="padding:4px 14px 4px 0;color:#7a6c99">Version</td><td>${escapeHtml(rec.version)}</td></tr>
      <tr><td style="padding:4px 14px 4px 0;color:#7a6c99">Agreement number</td><td>${escapeHtml(rec.id.slice(0, 12).toUpperCase())}</td></tr>
    </table>
    <p style="line-height:1.55">The full agreement is attached to this email as a PDF. Keep it somewhere safe. You can print it.</p>
    <p><a href="${pdfLink}" style="display:inline-block;background:#f2b84f;color:#241407;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:700">Download the PDF again</a></p>
    <p style="font-size:12px;color:#7a6c99">We will remind you about 30 days before it expires. To renew, sign again with the same link.</p>
  </div>`;
}

async function sendCopies(env, sendEmail, rec) {
  if (!sendEmail) return false;
  const pdf = toBase64(buildPdf(signedItems(rec)));
  const link = `${SITE}/dm-agreement.html?doc=${rec.id}&k=${rec.access_key}`;
  const attachments = [{ filename: `Game-Master-Agreement-${rec.id.slice(0, 8)}.pdf`, content: pdf }];
  let ok = false;
  try { await sendEmail(env, rec.email, 'Your signed Game Master Agreement', copyEmailHtml(rec, false, `${SITE}/dm-agreement.html?doc=${rec.id}&k=${rec.access_key}`), { attachments }); ok = true; } catch (err) { console.error('agreement email to GM failed', err && err.message); }
  const ash = env.ADMIN_NOTIFY_EMAIL;
  if (ash) {
    try { await sendEmail(env, ash, `${rec.name} signed the Game Master Agreement`, copyEmailHtml(rec, true, link), { attachments }); } catch (err) { console.error('agreement email to Ash failed', err && err.message); }
  }
  return ok;
}

// Once a day is plenty: the cron runs every 5 minutes, the 30-day mark is only crossed once.
export async function runAgreementReminders(env, sendEmail) {
  const now = new Date();
  const horizon = new Date(now.getTime() + REMIND_DAYS * 86400000).toISOString();
  const rows = (await env.DB.prepare('SELECT id, name, email, expires_at FROM dm_agreements WHERE reminded_at IS NULL AND expires_at > ? AND expires_at <= ?').bind(now.toISOString(), horizon).all()).results;
  let sent = 0;
  for (const r of rows) {
    // a newer agreement from the same person means they already renewed
    const newer = await env.DB.prepare('SELECT 1 AS x FROM dm_agreements WHERE email=? AND expires_at > ? LIMIT 1').bind(r.email, r.expires_at).first();
    await env.DB.prepare('UPDATE dm_agreements SET reminded_at=? WHERE id=?').bind(now.toISOString(), r.id).run();
    if (newer || !sendEmail) continue;
    const html = (forAsh) => `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#241a3d">
      <h2 style="margin:0 0 12px">${forAsh ? escapeHtml(r.name) + "'s" : 'Your'} Game Master Agreement expires on ${longDate(r.expires_at)}</h2>
      <p style="line-height:1.55">${forAsh ? 'Ask them to sign again if they are staying.' : 'To keep running games on Ash Tabletop, please sign again. It takes a minute.'}</p>
      <p><a href="${SITE}/dm-agreement.html" style="display:inline-block;background:#f2b84f;color:#241407;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:700">Open the agreement</a></p></div>`;
    try { await sendEmail(env, r.email, `Your Game Master Agreement expires on ${longDate(r.expires_at)}`, html(false)); sent++; } catch (err) { console.error('renewal reminder failed', err && err.message); }
    if (env.ADMIN_NOTIFY_EMAIL) { try { await sendEmail(env, env.ADMIN_NOTIFY_EMAIL, `${r.name}'s agreement expires on ${longDate(r.expires_at)}`, html(true)); } catch { /* quiet */ } }
  }
  return { reminded: sent };
}

// ---------------------------------------------------------------- the routes
export async function handleDmAgreement(request, env, corsHeaders, origin, action, sendEmail, verify = verifyUser) {
  // The text itself is part of the page, but the version and term are useful to read from here.
  if (action === 'info' && request.method === 'GET') {
    const now = new Date();
    return json({ version: AGREEMENT.version, termMonths: AGREEMENT.termMonths, expiresIfSignedToday: expiryFrom(now).toISOString() }, 200, corsHeaders, { 'Cache-Control': 'no-store' });
  }

  // The signed copy as a PDF: needs the agreement number and its private key (both are in the emailed link).
  if (action === 'pdf' && request.method === 'GET') {
    const u = new URL(request.url);
    const id = u.searchParams.get('id') || '', k = u.searchParams.get('k') || '';
    if (!/^[a-f0-9]{16,64}$/.test(id) || !/^[a-f0-9]{16,64}$/.test(k)) return new Response('Not found', { status: 404, headers: corsHeaders });
    const rec = await env.DB.prepare('SELECT * FROM dm_agreements WHERE id=? AND access_key=?').bind(id, k).first();
    if (!rec) return new Response('Not found', { status: 404, headers: corsHeaders });
    const bytes = Uint8Array.from(buildPdf(signedItems(rec)), (c) => c.charCodeAt(0));
    return new Response(bytes, { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="Game-Master-Agreement-${rec.id.slice(0, 8)}.pdf"`, 'Cache-Control': 'private, no-store', ...corsHeaders } });
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, corsHeaders);
  if (!origin) return json({ error: 'Origin not allowed' }, 403, corsHeaders);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400, corsHeaders); }

  if (action === 'sign') {
    if (body.website) return json({ ok: true }, 200, corsHeaders); // a hidden field only bots fill in
    const name = clean(body.name, 80);
    const email = clean(body.email, 120).toLowerCase();
    if (name.length < 3 || !/\s|^\S{4,}$/.test(name)) return json({ error: 'Please type your full name.' }, 400, corsHeaders);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ error: 'Please enter a valid email address.' }, 400, corsHeaders);
    if (body.agree !== true) return json({ error: 'Please tick the box to say you agree.' }, 400, corsHeaders);

    const ip = request.headers.get('CF-Connecting-IP') || '';
    const ipHash = await sha256('ip:' + ip + ':' + (env.ADMIN_UID || ''));
    const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM dm_agreements WHERE ip_hash=? AND signed_at > ?').bind(ipHash, new Date(Date.now() - 3600000).toISOString()).first();
    if (recent && recent.n >= 5) return json({ error: 'Too many signatures from this connection. Please try again later.' }, 429, corsHeaders);

    const text = agreementParagraphs().map((p) => p.text).join('\n');
    const now = new Date();
    const rec = {
      id: randomHex(16), access_key: randomHex(16), version: AGREEMENT.version, name, email,
      signed_at: now.toISOString(), expires_at: expiryFrom(now).toISOString(),
      text_hash: await sha256(AGREEMENT.version + '\n' + text), ip_hash: ipHash,
      user_agent: clean(request.headers.get('User-Agent'), 200),
    };
    const renewal = await env.DB.prepare('SELECT 1 AS x FROM dm_agreements WHERE email=? LIMIT 1').bind(email).first();
    await env.DB.prepare(
      'INSERT INTO dm_agreements (id, access_key, version, name, email, signed_at, expires_at, text_hash, ip_hash, user_agent, text) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(rec.id, rec.access_key, rec.version, rec.name, rec.email, rec.signed_at, rec.expires_at, rec.text_hash, rec.ip_hash, rec.user_agent, text).run();
    const emailed = await sendCopies(env, sendEmail, rec);
    await notify(env, null, cfg(env).mode, 'agreement', null, `${renewal ? 'Renewed' : 'New'} agreement: ${rec.name}`, `${rec.name} (${rec.email}) signed the Game Master Agreement. It runs until ${longDate(rec.expires_at)}.`);
    if (emailed) await env.DB.prepare('UPDATE dm_agreements SET emailed_at=? WHERE id=?').bind(new Date().toISOString(), rec.id).run();
    return json({ ok: true, id: rec.id, key: rec.access_key, signedAt: rec.signed_at, expiresAt: rec.expires_at, emailed, renewal: !!renewal }, 200, corsHeaders);
  }

  // A new GM links their account to the agreement they signed. Having the private key (it was in the
  // email and on the page after signing) is the proof, so a stranger who only knows the email cannot do it.
  if (action === 'claim') {
    if (!body.idToken) return json({ error: 'Please sign in again.' }, 401, corsHeaders);
    let user;
    try { user = await verify(env, body.idToken); } catch { return json({ error: 'Please sign in again.' }, 401, corsHeaders); }
    const id = String(body.id || ''), k = String(body.key || '');
    if (!/^[a-f0-9]{16,64}$/.test(id) || !/^[a-f0-9]{16,64}$/.test(k)) return json({ error: 'That agreement link is not valid.' }, 400, corsHeaders);
    const rec = await env.DB.prepare('SELECT id, uid, expires_at FROM dm_agreements WHERE id=? AND access_key=?').bind(id, k).first();
    if (!rec) return json({ error: 'That agreement could not be found.' }, 404, corsHeaders);
    if (new Date(rec.expires_at).getTime() < Date.now()) return json({ error: 'That agreement has expired. Please sign a new one.' }, 410, corsHeaders);
    if (rec.uid && rec.uid !== user.sub) return json({ error: 'That agreement is already linked to another account.' }, 409, corsHeaders);
    await env.DB.prepare('UPDATE dm_agreements SET uid=? WHERE id=?').bind(user.sub, id).run();
    return json({ ok: true }, 200, corsHeaders);
  }

  if (action === 'admin/list') {
    if (!body.idToken) return json({ error: 'Please sign in again.' }, 401, corsHeaders);
    let user;
    try { user = await verify(env, body.idToken); } catch { return json({ error: 'Please sign in again.' }, 401, corsHeaders); }
    if (user.sub !== env.ADMIN_UID) return json({ error: 'Not authorized' }, 403, corsHeaders);
    const rows = (await env.DB.prepare('SELECT id, access_key, version, name, email, signed_at, expires_at, emailed_at, uid FROM dm_agreements ORDER BY signed_at DESC LIMIT 200').all()).results;
    const now = Date.now();
    return json({
      agreements: rows.map((r) => {
        const left = (new Date(r.expires_at).getTime() - now) / 86400000;
        return { id: r.id, name: r.name, email: r.email, version: r.version, signedAt: r.signed_at, expiresAt: r.expires_at, emailed: !!r.emailed_at, claimed: !!r.uid,
          status: left < 0 ? 'expired' : left <= REMIND_DAYS ? 'soon' : 'active', daysLeft: Math.ceil(left),
          pdf: `${new URL(request.url).origin}/dmagree/pdf?id=${r.id}&k=${r.access_key}` };
      }),
    }, 200, corsHeaders);
  }
  return json({ error: 'Not found' }, 404, corsHeaders);
}
