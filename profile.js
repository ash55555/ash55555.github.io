// The player's own profile page: picture, name, pronouns, bio, the games they want
// to play, and the weekly hours they can play. Everything is saved through the
// Worker (see worker/src/profile.js), keyed to the signed-in Firebase account.

const WORKER = 'https://ash-tabletop-announcements.ash-tabletop.workers.dev';
const $ = (id) => document.getElementById(id);

const TOKENS = [
  { id: 'dragon', emoji: '\u{1F409}', color: '#6b46c1' },
  { id: 'wizard', emoji: '\u{1F9D9}', color: '#2f5fa8' },
  { id: 'dagger', emoji: '\u{1F5E1}️', color: '#8a3b3b' },
  { id: 'elf', emoji: '\u{1F9DD}', color: '#2f7a5a' },
  { id: 'bat', emoji: '\u{1F987}', color: '#4a3a6b' },
  { id: 'dice', emoji: '\u{1F3B2}', color: '#a8702f' },
];
const tokenById = (id) => TOKENS.find((t) => t.id === id) || TOKENS[1];

let me = null;
let profile = null;
let pendingAvatar = null; // a new picture chosen but not saved yet (data URL)
let removeAvatar = false;
let chosenToken = 'wizard';

async function call(action, extra) {
  if (PREVIEW) return previewCall(action, extra);
  const idToken = await me.getIdToken();
  const res = await fetch(`${WORKER}/profile/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...(extra || {}), idToken }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

const timers = {};
function later(key, ms, fn) { clearTimeout(timers[key]); timers[key] = setTimeout(fn, ms); }
function flash(id, text, kind) {
  const el = $(id);
  el.textContent = text;
  el.className = 'me-status' + (kind ? ' ' + kind : '');
  if (kind === 'ok') later(id, 2500, () => { el.textContent = ''; el.className = 'me-status'; });
}

/* ---------------------------------------------------------------- picture */

function renderAvatar() {
  const box = $('me-avatar');
  box.innerHTML = '';
  const src = removeAvatar ? null : (pendingAvatar || profile.avatarUrl);
  if (src) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    box.appendChild(img);
    box.style.removeProperty('--tk');
  } else {
    const t = tokenById(chosenToken);
    box.style.setProperty('--tk', t.color);
    box.textContent = t.emoji;
  }
  $('me-avatar-remove').hidden = !src;
}

// Crops the middle square of any photo and shrinks it, so uploads stay small.
function fileToAvatar(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) { reject(new Error('Please choose an image file.')); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      let size = 256;
      let quality = 0.86;
      let out = '';
      for (let i = 0; i < 6; i++) {
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        canvas.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, size, size);
        out = canvas.toDataURL('image/jpeg', quality);
        if (out.length <= 60000) break;
        quality -= 0.1;
        if (quality < 0.5) { size = Math.round(size * 0.8); quality = 0.8; }
      }
      URL.revokeObjectURL(url);
      out.length <= 65000 ? resolve(out) : reject(new Error('That picture is too detailed. Try a different one.'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be read as a picture.')); };
    img.src = url;
  });
}

$('me-bio').addEventListener('input', () => { $('me-bio-count').textContent = $('me-bio').value.length + ' / 500'; });
$('me-avatar-btn').addEventListener('click', () => $('me-file').click());
$('me-file').addEventListener('change', async () => {
  const file = $('me-file').files[0];
  $('me-file').value = '';
  if (!file) return;
  try {
    pendingAvatar = await fileToAvatar(file);
    removeAvatar = false;
    renderAvatar();
    flash('me-save-status', 'New picture ready. Click Save profile.', '');
  } catch (err) { flash('me-save-status', err.message, 'err'); }
});
$('me-avatar-remove').addEventListener('click', () => {
  pendingAvatar = null;
  removeAvatar = true;
  renderAvatar();
  flash('me-save-status', 'Picture removed. Click Save profile.', '');
});

$('me-save').addEventListener('click', async () => {
  const btn = $('me-save');
  btn.disabled = true;
  flash('me-save-status', 'Saving...', '');
  try {
    const body = { name: $('me-name').value, pronouns: $('me-pronouns').value, bio: $('me-bio').value, token: chosenToken };
    if (pendingAvatar) body.avatar = pendingAvatar;
    else if (removeAvatar) body.removeAvatar = true;
    profile = await call('save', body);
    pendingAvatar = null;
    removeAvatar = false;
    chosenToken = profile.token || chosenToken;
    renderAvatar();
    setPill();
    flash('me-save-status', 'Saved!', 'ok');
  } catch (err) { flash('me-save-status', err.message, 'err'); }
  btn.disabled = false;
});

function setPill() {
  if (typeof AshNav !== 'undefined') AshNav.mount($('me-pill'), me);
}

/* ------------------------------------------------------- games they want */

const picked = new Set();
function saveGames() {
  later('games', 700, async () => {
    flash('me-games-status', 'Saving...', '');
    try {
      await call('save', { interests: [...picked], other: $('me-other').value });
      flash('me-games-status', 'Saved', 'ok');
    } catch (err) { flash('me-games-status', err.message, 'err'); }
  });
}

function renderPicked() {
  const box = $('me-picked');
  box.innerHTML = '';
  if (!picked.size) {
    const p = document.createElement('p');
    p.className = 'me-muted me-picked-empty';
    p.textContent = 'Nothing picked yet. Tap any adventure below.';
    box.appendChild(p);
    return;
  }
  const label = document.createElement('span');
  label.className = 'me-picked-label';
  label.textContent = 'You picked ' + picked.size + ':';
  box.appendChild(label);
  picked.forEach((name) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'me-pill-picked';
    b.textContent = name + '  ×';
    b.setAttribute('aria-label', 'Remove ' + name);
    b.addEventListener('click', () => { picked.delete(name); renderPicked(); renderModules(); saveGames(); });
    box.appendChild(b);
  });
}

// GAME_MODULES's "Ash runs these" group (modules.js) is a fixed list of just
// the 5 original campaigns. A campaign made later through the admin
// Campaigns tab isn't in it, so a player could never pick it here as a
// structured interest, only type it into "something else" free text, which
// then doesn't group with everyone else who wants the same game. Fills in
// any campaign the content database knows about that this list doesn't.
function mergeCampaignModules() {
  return fetch(`${WORKER}/content/public-list`).then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (!d || !d.campaigns) return;
    const ashGroup = GAME_MODULES[0];
    if (!ashGroup) return;
    d.campaigns.forEach((c) => {
      if (c.title && !ashGroup.items.includes(c.title)) ashGroup.items.push(c.title);
    });
    renderModules();
  }).catch(() => { /* the picker just shows the original 5, same as before */ });
}

function renderModules() {
  const q = $('me-search').value.trim().toLowerCase();
  const root = $('me-modules');
  root.innerHTML = '';
  let shown = 0;
  GAME_MODULES.forEach((g) => {
    const items = g.items.filter((n) => !q || n.toLowerCase().includes(q));
    if (!items.length) return;
    shown += items.length;
    const section = document.createElement('div');
    section.className = 'me-group';
    const h = document.createElement('h3');
    h.textContent = g.group;
    section.appendChild(h);
    const wrap = document.createElement('div');
    wrap.className = 'me-chips';
    items.forEach((name) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'me-chip' + (picked.has(name) ? ' on' : '');
      b.textContent = name;
      b.setAttribute('aria-pressed', String(picked.has(name)));
      b.addEventListener('click', () => {
        if (picked.has(name)) picked.delete(name); else picked.add(name);
        b.classList.toggle('on', picked.has(name));
        b.setAttribute('aria-pressed', String(picked.has(name)));
        renderPicked();
        saveGames();
      });
      wrap.appendChild(b);
    });
    section.appendChild(wrap);
    root.appendChild(section);
  });
  if (!shown) {
    const p = document.createElement('p');
    p.className = 'me-muted';
    p.textContent = 'No match. Use "Something else" below to tell Ash what you have in mind.';
    root.appendChild(p);
  }
}
$('me-search').addEventListener('input', renderModules);
$('me-other').addEventListener('input', saveGames);

/* -------------------------------------------------------------- calendar */

// Display order Monday..Sunday. JS days: Sunday = 0.
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const jsDay = (i) => (i + 1) % 7;
const on = DAY_NAMES.map(() => new Array(24).fill(false));
const cells = DAY_NAMES.map(() => new Array(24));
const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';

// The calendar is saved as the player's own local week: 336 half hours, index 0 =
// Sunday 00:00 local. Because it is local, daylight saving never moves what they marked.
const localIndex = (dJS, hour, half) => dJS * 48 + hour * 2 + half;

// How far ahead of UTC a time zone is on a given date, in minutes.
function tzOffsetMin(tz, date) {
  try {
    const parts = {};
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(date).forEach((p) => { parts[p.type] = p.value; });
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
    return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  } catch (err) { return -date.getTimezoneOffset(); }
}

// Moves a week of half-hour slots forward by some minutes (wrapping around the week).
function shiftSlots(str, minutes) {
  const k = Math.round(minutes / 30);
  if (!k) return str;
  const out = new Array(336).fill('0');
  for (let i = 0; i < 336; i++) out[(((i + k) % 336) + 336) % 336] = str[i];
  return out.join('');
}

// Turns whatever is saved into a local week in THIS browser's time zone.
function toLocalWeek(p) {
  const now = new Date();
  const here = tzOffsetMin(browserTz || 'UTC', now);
  if (p.fmt !== 'local') return shiftSlots(p.slots, here);                 // old saves were UTC
  if (p.tz && browserTz && p.tz !== browserTz) return shiftSlots(p.slots, here - tzOffsetMin(p.tz, now)); // moved time zone
  return p.slots;
}

function loadSlots(str) {
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      on[d][h] = str[localIndex(jsDay(d), h, 0)] === '1' && str[localIndex(jsDay(d), h, 1)] === '1';
    }
  }
}

function buildSlots() {
  const arr = new Array(336).fill('0');
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      if (on[d][h]) { arr[localIndex(jsDay(d), h, 0)] = '1'; arr[localIndex(jsDay(d), h, 1)] = '1'; }
    }
  }
  return arr.join('');
}

const hourLabel = (h) => new Date(2026, 0, 4, h).toLocaleTimeString([], { hour: 'numeric' });

function paintCell(d, h) { cells[d][h].classList.toggle('on', on[d][h]); cells[d][h].setAttribute('aria-selected', String(on[d][h])); }
function refreshTotal() {
  let n = 0;
  on.forEach((day) => day.forEach((v) => { if (v) n++; }));
  $('me-cal-total').textContent = n
    ? 'You are free about ' + n + ' hour' + (n === 1 ? '' : 's') + ' a week.'
    : 'Nothing marked yet. Click or drag over the hours you can play.';
}
function saveCalendar() {
  refreshTotal();
  refreshPresetButtons();
  later('cal', 800, async () => {
    flash('me-cal-status', 'Saving...', '');
    try {
      await call('availability', { slots: buildSlots(), tz: browserTz });
      flash('me-cal-status', 'Saved', 'ok');
    } catch (err) { flash('me-cal-status', err.message, 'err'); }
  });
}

function buildCalendar() {
  const grid = $('me-cal');
  grid.innerHTML = '';
  grid.appendChild(document.createElement('div'));
  DAY_NAMES.forEach((name, d) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'me-day';
    b.textContent = name;
    b.title = 'Toggle every evening hour (5 PM to midnight) on ' + name;
    b.addEventListener('click', () => {
      const all = [17, 18, 19, 20, 21, 22, 23].every((h) => on[d][h]);
      [17, 18, 19, 20, 21, 22, 23].forEach((h) => { on[d][h] = !all; paintCell(d, h); });
      saveCalendar();
    });
    grid.appendChild(b);
  });
  for (let h = 0; h < 24; h++) {
    const lab = document.createElement('button');
    lab.type = 'button';
    lab.className = 'me-hour';
    lab.textContent = hourLabel(h);
    lab.title = 'Toggle ' + hourLabel(h) + ' on every day';
    lab.addEventListener('click', () => {
      const all = DAY_NAMES.every((_, d) => on[d][h]);
      DAY_NAMES.forEach((_, d) => { on[d][h] = !all; paintCell(d, h); });
      saveCalendar();
    });
    grid.appendChild(lab);
    for (let d = 0; d < 7; d++) {
      const c = document.createElement('div');
      c.className = 'me-cell' + (h % 2 ? ' odd' : '');
      c.dataset.d = d;
      c.dataset.h = h;
      c.setAttribute('role', 'gridcell');
      c.setAttribute('aria-label', DAY_NAMES[d] + ' ' + hourLabel(h));
      cells[d][h] = c;
      grid.appendChild(c);
    }
  }

  // Click or drag to paint. The first cell you touch decides whether you are
  // switching hours on or off for the rest of the drag.
  let painting = false;
  let value = true;
  const cellAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    return el && el.classList && el.classList.contains('me-cell') ? el : null;
  };
  const apply = (el) => {
    if (!el) return;
    const d = +el.dataset.d;
    const h = +el.dataset.h;
    if (on[d][h] !== value) { on[d][h] = value; paintCell(d, h); }
  };
  grid.addEventListener('pointerdown', (e) => {
    const el = cellAt(e.clientX, e.clientY);
    if (!el) return;
    painting = true;
    value = !on[+el.dataset.d][+el.dataset.h];
    apply(el);
    e.preventDefault();
  });
  grid.addEventListener('pointermove', (e) => { if (painting) apply(cellAt(e.clientX, e.clientY)); });
  const stop = () => { if (painting) { painting = false; saveCalendar(); } };
  window.addEventListener('pointerup', stop);
  window.addEventListener('pointercancel', stop);
}

// Each quick-pick button covers a fixed set of day+hour cells. The button shows
// that range in plain words, lights up purple whenever every one of its cells is
// already marked (however that happened — the button or a manual drag), and a
// click toggles: fills them in if any are still off, clears them if all are on.
const PRESET_DEF = {
  evenings: { days: [0, 1, 2, 3, 4], hours: [18, 19, 20, 21, 22], dayLabel: 'Mon–Fri' },
  weekends: { days: [5, 6], hours: [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22], dayLabel: 'Sat–Sun' },
  late: { days: [0, 1, 2, 3, 4, 5, 6], hours: [22, 23, 0, 1], dayLabel: 'every night' },
};
function presetCells(key) {
  const { days, hours } = PRESET_DEF[key];
  const cells = [];
  days.forEach((d) => hours.forEach((h) => cells.push([d, h])));
  return cells;
}
function presetLabel(key) {
  const { hours, dayLabel } = PRESET_DEF[key];
  const start = hours[0];
  const end = (hours[hours.length - 1] + 1) % 24;
  return hourLabel(start) + '–' + hourLabel(end) + ' · ' + dayLabel;
}
function isPresetActive(key) {
  return presetCells(key).every(([d, h]) => on[d][h]);
}
function refreshPresetButtons() {
  document.querySelectorAll('[data-preset]').forEach((b) => {
    const key = b.dataset.preset;
    if (!PRESET_DEF[key]) return; // "Clear all" has no on/off state of its own
    const active = isPresetActive(key);
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
  });
}
document.querySelectorAll('[data-preset]').forEach((b) => {
  const def = PRESET_DEF[b.dataset.preset];
  if (def) { const r = b.querySelector('.mp-range'); if (r) r.textContent = presetLabel(b.dataset.preset); }
  b.addEventListener('click', () => {
    const key = b.dataset.preset;
    if (key === 'clear') {
      on.forEach((day) => day.fill(false));
    } else {
      const cells = presetCells(key);
      const turnOff = cells.every(([d, h]) => on[d][h]);
      cells.forEach(([d, h]) => { on[d][h] = !turnOff; });
    }
    for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) paintCell(d, h);
    saveCalendar();
  });
});

/* ------------------------------------------------------------ start up */

let started = false;
async function start(user) {
  if (started) return;
  started = true;
  me = user;
  $('me-login').hidden = true;
  $('me-app').hidden = false;
  $('me-tz').textContent = (typeof friendlyTimeZone === 'function' ? friendlyTimeZone(new Date()) : '') || 'your time';
  buildCalendar();
  renderModules();
  mergeCampaignModules();
  renderPicked();
  refreshTotal();
  try {
    profile = await call('get');
  } catch (err) {
    flash('me-save-status', err.message, 'err');
    profile = { name: '', pronouns: '', token: 'wizard', bio: '', avatarUrl: null, interests: [], other: '', slots: '0'.repeat(336), fmt: 'local', tz: browserTz };
  }
  chosenToken = profile.token || 'wizard';
  $('me-name').value = profile.name || '';
  $('me-pronouns').value = profile.pronouns || '';
  $('me-bio').value = profile.bio || '';
  $('me-bio-count').textContent = $('me-bio').value.length + ' / 500';
  $('me-other').value = profile.other || '';
  (profile.interests || []).forEach((n) => picked.add(n));
  loadSlots(toLocalWeek(profile));
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) paintCell(d, h);
  renderAvatar();
  renderModules();
  renderPicked();
  refreshTotal();
  refreshPresetButtons();
  setPill();
  loadNotifBadge();
  showTab(window.location.hash === '#me-schedule' ? 'schedule' : 'profile');
  // Runs after the page is up, so a slow or failed review check never holds the profile back.
  loadReviewTab().then(() => { if (window.location.hash === '#me-review' && reviewState && reviewState.eligible) showTab('review'); });
}

/* ---------------------------------------------------------- sidebar tabs */

function showTab(name) {
  document.querySelectorAll('.me-panel').forEach((p) => { p.hidden = p.dataset.panel !== name; });
  document.querySelectorAll('.me-rail-btn').forEach((b) => {
    const on = b.dataset.tab === name;
    b.classList.toggle('active', on);
    b.setAttribute('aria-current', String(on));
  });
  if (name === 'notifications') loadNotifications();
  if (name === 'review') renderReviewPanel();
  if (name === 'schedule') loadMyGames();
}
document.querySelectorAll('.me-rail-btn').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
// Coming from "My schedule" in the nav dropdown, on this page or from another one.
window.addEventListener('hashchange', () => {
  if (window.location.hash === '#me-schedule') showTab('schedule');
  if (window.location.hash === '#me-review' && reviewState && reviewState.eligible) showTab('review');
});

/* ------------------------------------------------------------- My games */

// The games this player has joined, with their next sessions and a Skip / Undo button on each.
// Skipping is the same thing the game page does (and sends the same emails); this just puts every
// game in one place instead of making players dig for each one.
let myGames = null;

async function payCall(action, extra) {
  const idToken = await me.getIdToken();
  const res = await fetch(`${WORKER}/pay/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...(extra || {}), idToken }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

function mgEl(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function mgWhen(ts) {
  const d = new Date(ts);
  const day = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return day + ' \u00B7 ' + time;
}
function mgGameUrl(key) {
  const [slug, slot] = String(key).split('::');
  return 'player.html?stay=1&campaign=' + encodeURIComponent(slug) + (slot ? '&slot=' + encodeURIComponent(slot) : '');
}

async function loadMyGames() {
  if (PREVIEW) { myGames = myGames || previewGames(); renderMyGames(); return; }
  flash('me-mygames-status', 'Loading...', '');
  try {
    myGames = (await payCall('my-games')).games || [];
    flash('me-mygames-status', '', '');
    renderMyGames();
  } catch (err) { flash('me-mygames-status', err.message, 'err'); }
}

async function setSkip(game, session, skip, btn) {
  btn.disabled = true;
  try {
    if (PREVIEW) {
      session.skipped = skip;
      session.skippedBy = skip ? 'player' : null;
    } else {
      const r = await payCall(skip ? 'skip' : 'unskip', { game: game.key, ts: session.ts });
      if (r.sessions) game.sessions = r.sessions.slice(0, 4);
    }
    renderMyGames();
    flash('me-mygames-status', skip ? 'Skipped. You will not be charged for that session.' : 'You are back in for that session.', 'ok');
  } catch (err) {
    flash('me-mygames-status', err.message, 'err');
    btn.disabled = false;
  }
}

// The art for each campaign: the five on the home page are fixed files, anything Ash adds
// later comes from the same public list the home page uses.
const MG_ART = {
  'flying-city': 'medie/2139d310-c69b-4c0e-b8a0-2eded9ce8094%20%281%29.webp',
  'curse-of-strahd': 'medie/1466afad-bf88-4950-9f9b-a82a40f44147.webp',
  'ravenloft-undead-survival': 'medie/37528c55-aa34-4bfa-9f9c-2f9152faf651.webp',
  'crooked-moon': 'medie/daaeef05-e995-40b5-84d6-4d6f5670fa47.webp',
  'witchlight': 'medie/d4e2868e-d17f-4a04-aeb1-ba6ce7fd3ea3.webp',
};
let mgArtLoaded = false;
function loadMyGamesArt() {
  if (mgArtLoaded) return;
  mgArtLoaded = true;
  fetch(WORKER + '/content/public-list')
    .then((r) => r.json())
    .then((d) => {
      (d.campaigns || []).forEach((c) => { if (c.bannerUrl && !MG_ART[c.slug]) MG_ART[c.slug] = c.bannerUrl; });
      renderMyGames();
    })
    .catch(() => {});
}

function mgIn(ts) {
  const ms = new Date(ts).getTime() - Date.now();
  const h = Math.round(ms / 3600000);
  if (h < 1) return 'starting soon';
  if (h < 24) return 'in ' + h + (h === 1 ? ' hour' : ' hours');
  const d = Math.round(h / 24);
  return d === 1 ? 'tomorrow' : 'in ' + d + ' days';
}

function renderMyGames() {
  const list = $('me-mygames-list');
  list.innerHTML = '';
  if (!myGames || !myGames.length) {
    const p = mgEl('p', 'mg-empty', "You haven't joined a game yet. ");
    const a = mgEl('a', null, 'Browse the campaigns');
    a.href = 'index.html#campaigns';
    p.appendChild(a);
    list.appendChild(p);
    return;
  }
  loadMyGamesArt();
  myGames.forEach((g) => {
    const slug = String(g.key).split('::')[0];
    const [campaign, group] = String(g.title).split(' \u00B7 ');
    const card = mgEl('div', 'mg-card');

    const cover = mgEl('a', 'mg-cover');
    cover.href = mgGameUrl(g.key);
    cover.setAttribute('aria-label', 'Open ' + g.title);
    if (MG_ART[slug]) cover.style.backgroundImage = 'url("' + MG_ART[slug] + '")';
    const info = mgEl('div', 'mg-info');
    if (group) info.appendChild(mgEl('span', 'mg-group', group));
    info.appendChild(mgEl('div', 'mg-title', campaign));
    const nextOne = g.sessions.find((s) => !s.skipped);
    info.appendChild(mgEl('div', 'mg-next', nextOne ? 'Next: ' + mgWhen(nextOne.ts) : 'You are skipping every upcoming session'));
    cover.appendChild(info);
    if (nextOne) cover.appendChild(mgEl('span', 'mg-countdown', mgIn(nextOne.ts)));
    card.appendChild(cover);

    const sessions = mgEl('div', 'mg-sessions');
    g.sessions.forEach((s) => {
      const kind = s.skipped ? (s.skippedBy === 'admin' ? 'by-ash' : 'skipped') : 'playing';
      const box = mgEl('div', 'mg-session ' + kind);
      box.appendChild(mgEl('div', 'mg-when', mgWhen(s.ts)));
      box.appendChild(mgEl('div', 'mg-state', s.skipped ? (s.skippedBy === 'admin' ? 'Skipped by Ash' : 'You skipped this one') : 'You are playing'));
      if (s.canChange) {
        const btn = mgEl('button', 'mg-btn', s.skipped ? 'Undo skip' : 'Skip this session');
        btn.type = 'button';
        btn.addEventListener('click', () => setSkip(g, s, !s.skipped, btn));
        box.appendChild(btn);
      } else if (s.skippedBy === 'admin') {
        box.appendChild(mgEl('div', 'mg-note', 'Message Ash to change this.'));
      } else {
        box.appendChild(mgEl('div', 'mg-note', 'Under 24 hours away. Message Ash to change it.'));
      }
      sessions.appendChild(box);
    });
    card.appendChild(sessions);
    list.appendChild(card);
  });
}

/* ------------------------------------------------- local-only test profile */

// Open profile.html?preview=games on this computer (localhost only, never on the live site) to get a
// sample player who has joined every one of Ash's games. Nothing there is real or saved.
const PREVIEW = ['localhost', '127.0.0.1'].includes(window.location.hostname) && new URLSearchParams(window.location.search).get('preview') === 'games';

function previewGames() {
  // [game key, title, weekday (0=Sunday), hour, offset from UTC]
  const defs = [
    ['crooked-moon::A', 'The Crooked Moon \u00B7 Group A', 4, 20, 1],
    ['crooked-moon::B', 'The Crooked Moon \u00B7 Group B', 6, 0, 1],
    ['crooked-moon::C', 'The Crooked Moon \u00B7 Group C', 6, 18, 1],
    ['curse-of-strahd::A', 'Curse of Strahd \u00B7 Group A', 5, 20, 1],
    ['curse-of-strahd::B', 'Curse of Strahd \u00B7 Group B', 1, 21, 1],
    ['curse-of-strahd::C', 'Curse of Strahd \u00B7 Group C', 4, 0, 1],
    ['curse-of-strahd::D', 'Curse of Strahd \u00B7 Group D', 5, 11, 1],
    ['flying-city', 'The Prophecy of the Flying City', 3, 18, 1],
    ['ravenloft-undead-survival', 'Ravenloft: Undead Survival', 6, 21, 1],
    ['the-vampiric-dynasty', 'The Vampiric Dynasty', 3, 18, 1],
    ['witchlight', 'The Wild Beyond the Witchlight', 0, 0, 1],
  ];
  const now = new Date();
  const games = defs.map(([key, title, day, hour, offset]) => {
    const utcHour = hour - offset;
    const targetDay = (day + (utcHour < 0 ? -1 : 0) + 7) % 7;
    const sessions = [];
    for (let i = 0; i < 40 && sessions.length < 4; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i, (utcHour + 24) % 24, 0));
      if (d.getUTCDay() === targetDay && d.getTime() > now.getTime()) sessions.push(d);
    }
    return { key, title, sessions: sessions.map((d) => ({ ts: d.toISOString(), skipped: false, skippedBy: null, canChange: d.getTime() - now.getTime() >= 24 * 3600 * 1000 })) };
  });
  // A few sample states so every look is on screen: one skipped by the player, one skipped by Ash, one too close to change.
  const by = (k) => games.find((g) => g.key === k);
  by('crooked-moon::A').sessions[1].skipped = true; by('crooked-moon::A').sessions[1].skippedBy = 'player';
  by('curse-of-strahd::B').sessions[0].skipped = true; by('curse-of-strahd::B').sessions[0].skippedBy = 'admin'; by('curse-of-strahd::B').sessions[0].canChange = false;
  const soon = new Date(now.getTime() + 10 * 3600 * 1000).toISOString();
  by('ravenloft-undead-survival').sessions[0] = { ts: soon, skipped: false, skippedBy: null, canChange: false };
  return games;
}

function previewCall(action) {
  if (action === 'get') return Promise.resolve({ name: 'Test Player', pronouns: 'they/them', token: 'wizard', bio: '', avatarUrl: null, interests: [], other: '', slots: '0'.repeat(336), fmt: 'local', tz: browserTz });
  if (action === 'notifications') return Promise.resolve({ items: [], unread: 0 });
  return Promise.resolve({ ok: true });
}

function startPreview() {
  const bar = document.createElement('div');
  bar.className = 'me-preview-bar';
  bar.textContent = 'PREVIEW: a sample test player who has joined every game. This computer only. Nothing here is real or saved.';
  document.body.insertBefore(bar, document.body.firstChild);
  start({ getIdToken: async () => 'preview', email: 'test.player@example.com', displayName: 'Test Player' }).then(() => showTab('schedule'));
}

/* ------------------------------------------------------------ review Ash */

// The "Review Ash" tab only appears once the Worker says this player has played
// enough sessions with Ash. Ash's own account always sees it, so it can be tried out.
let reviewState = null;
async function reviewCall(action, extra) {
  const idToken = await me.getIdToken();
  const res = await fetch(`${WORKER}/review/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...(extra || {}), idToken }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}
function paintReviewTab() {
  const open = !!(reviewState && reviewState.eligible);
  $('me-review-btn').hidden = !open;
  // A gold dot while they have not reviewed yet.
  $('me-review-dot').hidden = !(open && !reviewState.review);
}
async function loadReviewTab() {
  try { reviewState = await reviewCall('status'); } catch (err) { reviewState = null; }
  paintReviewTab();
}
function renderReviewPanel() {
  if (!reviewState || typeof AshReviews === 'undefined') return;
  const dm = reviewState.dm || {};
  AshReviews.renderDmProfile($('me-review-body'), {
    dm, name: dm.name || 'Ash', pronouns: dm.pronouns,
    state: { signedIn: true, ...reviewState },
    onDelete: async () => {
      await reviewCall('delete');
      reviewState.review = null;
      paintReviewTab();
    },
    onSubmit: async (payload) => {
      const saved = (await reviewCall('submit', payload)).review;
      reviewState.review = saved;
      paintReviewTab();
      return saved;
    },
  });
}

/* ----------------------------------------------------------- notifications */

const KIND_LABEL = { declined: 'Card declined', skipped_admin: 'Session skipped', skipped_self: 'Session skipped', review_invite: 'How was your game?', removed: 'Removed from a game',
  joined: 'New player', left: 'Left', skipped_player: 'Skipped', review: 'Review', new_account: 'New account', charge_failed: 'Charge failed', gave_up: 'Gave up', unknown: 'Check Whop', reminder: 'Reminder' };
// The DM-side ones only ever show up for Ash's own account; clicking one opens the admin page.
function adminLink(n) {
  if (n.game) return 'admin.html#game=' + encodeURIComponent(n.game);
  return 'admin.html#tab=' + (n.kind === 'review' ? 'reviews' : 'notifications');
}
const DM_KINDS = { joined: 1, left: 1, skipped_player: 1, review: 1, new_account: 1, charge_failed: 1, gave_up: 1, unknown: 1, reminder: 1 };
function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function renderNotifBadge(unread) {
  const dot = $('me-rail-dot');
  if (dot) dot.hidden = !unread;
}
async function loadNotifBadge() {
  try { renderNotifBadge((await call('notifications')).unread); } catch (err) { /* leave the badge as-is */ }
}
async function loadNotifications() {
  const list = $('me-notif-list');
  flash('me-notif-status', 'Loading...', '');
  try {
    const data = await call('notifications');
    renderNotifBadge(data.unread);
    list.innerHTML = '';
    if (!data.items.length) {
      list.innerHTML = '<p class="me-notif-empty">Nothing yet. You will see it here the moment something needs your attention.</p>';
    } else {
      data.items.forEach((n) => {
        const item = document.createElement('div');
        item.className = 'me-notif-item' + (n.read ? '' : ' unread');
        item.innerHTML = `<span class="ni-kind"></span><span class="ni-body"></span><span class="ni-time"></span>`;
        item.querySelector('.ni-kind').textContent = KIND_LABEL[n.kind] || n.title;
        item.querySelector('.ni-body').textContent = n.body || '';
        item.querySelector('.ni-time').textContent = timeAgo(n.created_at);
        if (DM_KINDS[n.kind]) {
          item.style.cursor = 'pointer';
          item.addEventListener('click', () => { window.location.href = adminLink(n); });
        }
        list.appendChild(item);
      });
    }
    flash('me-notif-status', '', '');
  } catch (err) { flash('me-notif-status', err.message, 'err'); }
}
$('me-notif-read').addEventListener('click', async () => {
  flash('me-notif-status', 'Marking as read...', '');
  try { await call('notifications/read'); await loadNotifications(); } catch (err) { flash('me-notif-status', err.message, 'err'); }
});

if (PREVIEW) {
  startPreview();
} else if (typeof firebase !== 'undefined' && firebase.apps.length) {
  firebase.auth().onAuthStateChanged((user) => {
    if (user) start(user);
    else {
      started = false;
      $('me-login').hidden = false;
      $('me-app').hidden = true;
      if (typeof AshNav !== 'undefined') AshNav.unmount($('me-pill'));
    }
  });
  $('me-google').addEventListener('click', () => {
    firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider()).catch((e) => { $('me-login-status').textContent = e.message; });
  });
  $('me-login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    $('me-login-status').textContent = 'Working...';
    firebase.auth().signInWithEmailAndPassword($('me-login-email').value.trim(), $('me-login-pass').value)
      .catch((err) => { $('me-login-status').textContent = err.message; });
  });
  $('me-forgot').addEventListener('click', async () => {
    const email = $('me-login-email').value.trim();
    if (!email) { $('me-login-status').textContent = 'Type your email above first, then tap "Forgot your password?" again.'; return; }
    try { await firebase.auth().sendPasswordResetEmail(email); } catch (err) {
      if (err.code !== 'auth/user-not-found' && err.code !== 'auth/invalid-email') { $('me-login-status').textContent = err.message; return; }
    }
    $('me-login-status').textContent = 'If ' + email + ' has an account, a link to choose a new password is on its way. Check Spam too.';
  });
} else {
  $('me-login').hidden = false;
  $('me-login-status').textContent = 'Sign-in is not available right now.';
}
