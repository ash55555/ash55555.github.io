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

/* ------------------------------------------------------------- tokens etc. */

function renderTokens() {
  const grid = $('me-tokens');
  grid.innerHTML = '';
  TOKENS.forEach((t) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'me-token';
    b.style.setProperty('--tk', t.color);
    b.textContent = t.emoji;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', t.id + ' token');
    b.setAttribute('aria-checked', String(chosenToken === t.id));
    b.addEventListener('click', () => { chosenToken = t.id; renderTokens(); renderAvatar(); });
    grid.appendChild(b);
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
  const pill = $('me-pill');
  pill.textContent = profile.name || 'Player';
  pill.hidden = false;
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
const offsetMin = -new Date().getTimezoneOffset(); // minutes ahead of UTC right now
const on = DAY_NAMES.map(() => new Array(24).fill(false));
const cells = DAY_NAMES.map(() => new Array(24));

// 30-minute slot index in the shared UTC week (0 = Sunday 00:00 UTC).
function slotIndex(dJS, hour, half) {
  let m = dJS * 1440 + hour * 60 + half * 30 - offsetMin;
  m = ((m % 10080) + 10080) % 10080;
  return Math.floor(m / 30);
}

function loadSlots(str) {
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      on[d][h] = str[slotIndex(jsDay(d), h, 0)] === '1' && str[slotIndex(jsDay(d), h, 1)] === '1';
    }
  }
}

function buildSlots() {
  const arr = new Array(336).fill('0');
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      if (on[d][h]) { arr[slotIndex(jsDay(d), h, 0)] = '1'; arr[slotIndex(jsDay(d), h, 1)] = '1'; }
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
  later('cal', 800, async () => {
    flash('me-cal-status', 'Saving...', '');
    try {
      await call('availability', { slots: buildSlots(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '' });
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

const PRESETS = {
  evenings: () => { for (let d = 0; d < 5; d++) for (let h = 18; h < 23; h++) on[d][h] = true; },
  weekends: () => { for (let d = 5; d < 7; d++) for (let h = 12; h < 23; h++) on[d][h] = true; },
  late: () => { for (let d = 0; d < 7; d++) for (const h of [22, 23, 0, 1]) on[d][h] = true; },
  clear: () => { on.forEach((day) => day.fill(false)); },
};
document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
  PRESETS[b.dataset.preset]();
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) paintCell(d, h);
  saveCalendar();
}));

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
  renderTokens();
  renderModules();
  renderPicked();
  refreshTotal();
  try {
    profile = await call('get');
  } catch (err) {
    flash('me-save-status', err.message, 'err');
    profile = { name: '', pronouns: '', token: 'wizard', bio: '', avatarUrl: null, interests: [], other: '', slots: '0'.repeat(336) };
  }
  chosenToken = profile.token || 'wizard';
  $('me-name').value = profile.name || '';
  $('me-pronouns').value = profile.pronouns || '';
  $('me-bio').value = profile.bio || '';
  $('me-bio-count').textContent = $('me-bio').value.length + ' / 500';
  $('me-other').value = profile.other || '';
  (profile.interests || []).forEach((n) => picked.add(n));
  loadSlots(profile.slots);
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) paintCell(d, h);
  renderTokens();
  renderAvatar();
  renderModules();
  renderPicked();
  refreshTotal();
  setPill();
}

if (typeof firebase !== 'undefined' && firebase.apps.length) {
  firebase.auth().onAuthStateChanged((user) => {
    if (user) start(user);
    else { started = false; $('me-login').hidden = false; $('me-app').hidden = true; $('me-pill').hidden = true; }
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
