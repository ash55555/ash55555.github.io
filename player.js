// PREVIEW ONLY: this page runs on sample data so Ash can see what a player
// sees. Nothing here talks to Firebase, Whop, or any real account yet.

const CAMPAIGN_NAMES = {
  "flying-city": "The Prophecy of the Flying City",
  "curse-of-strahd": "Curse of Strahd",
  "ravenloft-undead-survival": "Ravenloft: Undead Survival",
  "crooked-moon": "The Crooked Moon",
  "witchlight": "The Wild Beyond the Witchlight",
};
const query = new URLSearchParams(window.location.search);
const hasGame = query.has("campaign");
const num = (key, fallback) => { const n = parseInt(query.get(key), 10); return Number.isNaN(n) ? fallback : n; };
const campaignName = CAMPAIGN_NAMES[query.get("campaign")] || "The Test Table";
const groupName = query.get("group") || "";
const TEST_GAME = {
  title: hasGame ? campaignName + (groupName ? " · " + groupName : "") : "The Test Table",
  eyebrow: hasGame ? "Campaign" : "Test Table",
  day: num("day", 3), hour: num("hour", 18), minute: num("minute", 0), offset: num("offset", 1),
  seatsMax: num("max", 5), price: 10,
};
// Games that use real Whop checkout (through the Worker). Others still use the pretend checkout.
const WORKER_URL = "https://ash-tabletop-announcements.ash-tabletop.workers.dev";
const REAL_GAMES = new Set(["crooked-moon::B"]);
const gameKey = query.get("campaign") + (query.get("slot") ? "::" + query.get("slot") : "");
const realGame = hasGame && REAL_GAMES.has(gameKey);
const planLink = null;
let me = null;
// Demo mode (this computer only): pretend to be logged in so the payment page can be previewed.
const demo = query.get("demo") === "1" && ["localhost", "127.0.0.1"].includes(window.location.hostname);
const DEMO_CONFIG_ID = "ch_i1dSnRGjUTub4Jb";
if (demo) me = { email: "demo.player@example.com", uid: "demo", displayName: "Demo Player", getIdToken: async () => "demo" };
if (query.get("embed") === "1") document.body.classList.add("pp-embed");
const OTHER_TOKENS = ["dagger", "elf", "bat", "dice", "wizard"];
const SAMPLE_OTHERS = Array.from({ length: hasGame ? num("filled", 0) : 0 }, (_, i) => ({ name: "Player", token: OTHER_TOKENS[i % OTHER_TOKENS.length] }));
const TOKENS = [
  { id: 'dragon', emoji: '🐉', color: '#6b46c1' },
  { id: 'wizard', emoji: '🧙', color: '#2f5fa8' },
  { id: 'dagger', emoji: '🗡️', color: '#8a3b3b' },
  { id: 'elf', emoji: '🧝', color: '#2f7a5a' },
  { id: 'bat', emoji: '🦇', color: '#4a3a6b' },
  { id: 'dice', emoji: '🎲', color: '#a8702f' },
];

const $ = (id) => document.getElementById(id);
const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* preview only */ }
  },
};

let profile = store.get('pp-profile', { name: 'Bianca', token: 'wizard', about: '' });
let view = query.get("paid") === "1" ? "joined" : "notjoined";
let skippedIdx = new Set();
let onConfirm = null;

function tokenById(id) { return TOKENS.find((t) => t.id === id) || TOKENS[0]; }

function upcomingSessions(count) {
  const utcHour = TEST_GAME.hour - TEST_GAME.offset;
  const out = [];
  const now = new Date();
  for (let i = 0; i < 40 && out.length < count; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i, utcHour, TEST_GAME.minute));
    const targetDay = (TEST_GAME.day + (utcHour < 0 ? -1 : 0) + 7) % 7;
    if (d.getUTCDay() === targetDay && d.getTime() > now.getTime()) out.push(d);
  }
  return out;
}

const fmtDay = (d) => d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
const fmtTime = (d) => {
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  let tz = '';
  try {
    const part = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(d).find((p) => p.type === 'timeZoneName');
    if (part) tz = ' ' + part.value;
  } catch { /* no tz suffix */ }
  return time + tz;
};
const weekdayName = (d) => d.toLocaleDateString(undefined, { weekday: 'long' });

function tokenEl(id, size) {
  const t = tokenById(id);
  const el = document.createElement('div');
  el.className = 'pp-token ' + size;
  el.style.setProperty('--tk', t.color);
  el.textContent = t.emoji;
  el.setAttribute('aria-hidden', 'true');
  return el;
}

function renderProfile() {
  const grid = $('pp-token-grid');
  grid.innerHTML = '';
  TOKENS.forEach((t) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pp-token-choice';
    b.style.setProperty('--tk', t.color);
    b.textContent = t.emoji;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', t.id + ' token');
    b.setAttribute('aria-checked', String(profile.token === t.id));
    b.addEventListener('click', () => { profile.token = t.id; renderProfile(); renderHeader(); renderRoster(); });
    grid.appendChild(b);
  });
  $('pp-name').value = profile.name;
  $('pp-about').value = profile.about;
}

function renderHeader() {
  const name = profile.name.trim() || 'Player';
  $('pp-welcome-title').textContent = 'Welcome, ' + name + '!';
  $('pp-nav-name').textContent = name;
  const holder = $('pp-welcome-token');
  const t = tokenById(profile.token);
  holder.style.setProperty('--tk', t.color);
  holder.textContent = t.emoji;
  const sub = {
    notjoined: 'Pick a game below to grab your seat.',
    joined: "You're in! Here's everything about your table.",
    skipped: "You're skipping next week. See you the week after!",
    left: 'You left the game. You can join again any time.',
  };
  $('pp-welcome-sub').textContent = sub[view];
}

function renderRoster() {
  const list = $('pp-roster');
  list.innerHTML = '';
  const add = (name, tokenId, role) => {
    const li = document.createElement('li');
    li.appendChild(tokenEl(tokenId, 'pp-token-sm'));
    const span = document.createElement('span');
    span.textContent = name;
    li.appendChild(span);
    if (role) {
      const r = document.createElement('span');
      r.className = 'pp-role';
      r.textContent = role;
      li.appendChild(r);
    }
    list.appendChild(li);
  };
  add('Ash', 'dragon', 'DM');
  SAMPLE_OTHERS.forEach((p) => add(p.name, p.token));
  const mine = view === 'joined' || view === 'skipped';
  if (mine) add((profile.name.trim() || 'Player') + ' (you)', profile.token);
  const filled = SAMPLE_OTHERS.length + (mine ? 1 : 0);
  const open = TEST_GAME.seatsMax - filled;
  for (let i = 0; i < Math.min(open, 2); i++) {
    const li = document.createElement('li');
    li.className = 'pp-open';
    li.textContent = 'Open seat';
    list.appendChild(li);
  }
  if (open > 2) {
    const li = document.createElement('li');
    li.className = 'pp-open';
    li.textContent = '+' + (open - 2) + ' more open';
    list.appendChild(li);
  }
  $('pp-seats').textContent = filled + ' of ' + TEST_GAME.seatsMax + ' filled';
  $('pp-seatbar-fill').style.width = (filled / TEST_GAME.seatsMax) * 100 + '%';
}

function billingHtml(next) {
  return '<strong>$' + TEST_GAME.price + ' per session, charged every ' + weekdayName(next) + ' at ' + fmtTime(next) + '</strong>' +
    '<span>First charge: ' + fmtDay(next) + ' at ' + fmtTime(next) + '. Shown in your own time zone.</span>' +
    '<span>Skip a week and you are not charged for it. Leave any time and billing stops.</span>';
}

function renderGame() {
  $("pp-game-title").textContent = TEST_GAME.title;
  $("pp-game-eyebrow").textContent = TEST_GAME.eyebrow;
  document.title = TEST_GAME.title + " | Ash Tabletop";
  $("pp-left-title").textContent = "You left " + TEST_GAME.title + ".";
  const openSeats = TEST_GAME.seatsMax - SAMPLE_OTHERS.length - (view === "joined" || view === "skipped" ? 1 : 0);
  $("pp-open-seats").textContent = openSeats > 0 ? openSeats + " open seat" + (openSeats === 1 ? "" : "s") + " left. Add a payment method below to grab yours." : "This game is full right now. Talk to Ash about a spot.";
  const full = SAMPLE_OTHERS.length >= TEST_GAME.seatsMax;
  ["pp-join-btn", "pp-rejoin-btn"].forEach((id) => { $(id).disabled = full; });
  const sessions = upcomingSessions(4);
  const next = sessions[0];
  $('pp-when').textContent = weekdayName(next) + 's at ' + fmtTime(next);
  $('pp-when-sub').textContent = 'Next: ' + fmtDay(next);

  const badge = $('pp-status-badge');
  const states = {
    notjoined: ['Not joined', ''],
    joined: ["You're in", 'in'],
    skipped: ['Skipping next week', 'warn'],
    left: ['You left', ''],
  };
  badge.textContent = states[view][0];
  badge.className = 'pp-badge ' + states[view][1];

  $('pp-join-panel').hidden = view !== 'notjoined';
  $('pp-joined-panel').hidden = !(view === 'joined' || view === 'skipped');
  $('pp-left-panel').hidden = view !== 'left';

  const billing = billingHtml(next);
  $('pp-billing-preview').innerHTML = billing;
  $('pp-billing-modal').innerHTML = billing;
  $('pp-billing-active').innerHTML = '<strong>Next charge: ' + fmtDay(view === 'skipped' ? sessions[1] : next) + ' at ' + fmtTime(next) + '</strong>' +
    '<span>$' + TEST_GAME.price + ' per session. Billed only for the weeks you play.</span>';

  const list = $('pp-sessions');
  list.innerHTML = '';
  sessions.forEach((d, i) => {
    const skipped = skippedIdx.has(i);
    const li = document.createElement('li');
    li.className = 'pp-session' + (skipped ? ' skipped' : '');
    const info = document.createElement('div');
    info.innerHTML = '<span class="pp-session-when">' + fmtDay(d) + ' · ' + fmtTime(d) + '</span>' +
      '<span class="pp-session-note">' + (skipped ? "Skipped. You won't be charged this week." : 'You are playing. $' + TEST_GAME.price + ' will be charged.') + '</span>';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-ghost btn-small';
    btn.textContent = skipped ? 'Undo skip' : 'Skip this session';
    btn.addEventListener('click', () => {
      if (skipped) { skippedIdx.delete(i); syncView(); return; }
      ask('Skip ' + fmtDay(d) + '?', "Your seat stays yours and you won't be charged for this session.", () => { skippedIdx.add(i); syncView(); });
    });
    li.append(info, btn);
    list.appendChild(li);
  });
}

function syncView() {
  if (view === 'joined' || view === 'skipped') view = skippedIdx.has(0) ? 'skipped' : 'joined';
  renderAll();
}

function renderAll() {
  renderHeader();
  renderRoster();
  renderGame();
  document.querySelectorAll('.pp-previewbar [data-state]').forEach((b) => b.classList.toggle('active', b.dataset.state === view));
}

function openModal(id) { $(id).hidden = false; document.body.classList.add('modal-open'); }
function closeModals() {
  document.querySelectorAll('.modal').forEach((m) => { m.hidden = true; });
  document.body.classList.remove('modal-open');
}
function ask(title, text, yes) {
  $('pp-confirm-title').textContent = title;
  $('pp-confirm-text').textContent = text;
  onConfirm = yes;
  openModal('pp-confirm');
}
function toast(message) {
  const el = document.createElement('div');
  el.className = 'pp-toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

document.querySelectorAll('.pp-previewbar [data-state]').forEach((b) => {
  b.addEventListener('click', () => {
    view = b.dataset.state;
    skippedIdx = view === 'skipped' ? new Set([0]) : new Set();
    renderAll();
  });
});
document.querySelectorAll('.js-close').forEach((el) => el.addEventListener('click', closeModals));
document.querySelectorAll('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) closeModals(); }));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModals(); });

$('pp-save').addEventListener('click', () => {
  profile.name = $('pp-name').value.trim() || 'Player';
  profile.about = $('pp-about').value.trim();
  store.set('pp-profile', profile);
  store.set('pp-profile-set', true);
  $('pp-saved').textContent = 'Saved!';
  setTimeout(() => { $('pp-saved').textContent = ''; }, 2000);
  renderAll();
});
$('pp-name').addEventListener('input', (e) => { profile.name = e.target.value; renderHeader(); renderRoster(); });

// Resolves once Firebase has told us whether someone is signed in, so we never
// ask a signed-in player to log in just because the check hadn't finished.
let resolveAuthReady;
const authReady = new Promise((resolve) => { resolveAuthReady = resolve; });
const joinedKey = (uid) => 'pp-joined::' + gameKey + '::' + uid;

async function startJoin() {
  fillBooking();
  if (!realGame) { openModal('pp-checkout'); return; }
  await authReady;
  openModal('pp-checkout');
  syncCheckoutAuth();
}

function syncCheckoutAuth() {
  const loggedIn = !!me;
  $('pp-inline-auth').hidden = loggedIn;
  $('pp-seat-info').hidden = !loggedIn;
  $('pp-checkout-go').hidden = true;
  $('pp-billing-modal').hidden = true;
  $('pp-embed').innerHTML = '';
  const note = $('pp-checkout-note');
  if (loggedIn) {
    fillBooking();
    openRealCheckout();
  } else {
    note.hidden = false;
    note.textContent = 'Log in in step 1 and your card form will appear here.';
  }
}
$('pp-join-btn').addEventListener('click', startJoin);
$('pp-rejoin-btn').addEventListener('click', startJoin);

if (typeof firebase !== 'undefined' && firebase.apps.length) {
  firebase.auth().onAuthStateChanged((user) => {
    if (!demo) me = user;
    if (user && realGame) {
      if (!store.get('pp-profile-set', false)) {
        profile.name = user.displayName || (user.email || 'Player').split('@')[0];
      }
      if (store.get(joinedKey(user.uid), false) && view === 'notjoined') view = 'joined';
      renderProfile(); renderAll();
    }
    resolveAuthReady();
    if (realGame && !$('pp-checkout').hidden) syncCheckoutAuth();
  });
  $('pp-auth-google').addEventListener('click', () => {
    firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider()).catch((e) => { $('pp-auth-status').textContent = e.message; });
  });
  $('pp-auth-form').addEventListener('submit', (e) => {
    e.preventDefault();
    $('pp-auth-status').textContent = 'Working...';
    firebase.auth().signInWithEmailAndPassword($('pp-auth-email').value.trim(), $('pp-auth-pass').value)
      .catch((err) => { $('pp-auth-status').textContent = err.message; });
  });
} else {
  resolveAuthReady();
}

function fillBooking() {
  const sessions = upcomingSessions(2);
  const next = sessions[0];
  const name = profile.name.trim() || "Player";
  const t = tokenById(profile.token);
  const tk = $("cb-token");
  tk.style.setProperty("--tk", t.color);
  tk.textContent = t.emoji;
  $("cb-name").textContent = name;
  $("cb-email").textContent = me && me.email ? me.email : "";
  $("cb-game-inline").textContent = TEST_GAME.title;
  $("cb-game").textContent = TEST_GAME.title;
  $("cb-when").textContent = weekdayName(next) + "s at " + fmtTime(next);
  const filled = SAMPLE_OTHERS.length;
  $("cb-seats").textContent = (filled + 1) + " of " + TEST_GAME.seatsMax + " filled with you";
  $("cb-price-line").textContent = "$" + TEST_GAME.price + ".00 x 1 player";
  $("cb-price-amount").textContent = "$" + TEST_GAME.price + ".00";
  $("cb-total").textContent = "$" + TEST_GAME.price + ".00 / session";
  $("cb-first").textContent = "Nothing is charged today. Your first charge is on game night, " + fmtDay(next) + ".";
}

function markJoined() { closeModals(); view = 'joined'; skippedIdx = new Set(); renderAll(); toast("You're in! Welcome to the table."); }

let whopElementsPromise = null;
function loadWhopElements() {
  if (window.WhopElements) return Promise.resolve();
  if (!whopElementsPromise) {
    whopElementsPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.whop.com/elements/amber/elements.js';
      s.setAttribute('data-whop-elements', '');
      s.onload = resolve;
      s.onerror = () => reject(new Error('The payment form could not load. Please try again.'));
      document.head.appendChild(s);
    });
  }
  return whopElementsPromise;
}

async function openRealCheckout() {
  fillBooking();
  const note = $('pp-checkout-note');
  $('pp-checkout-sub').textContent = "You'll pay on Whop's own secure form, so your card details never touch this website.";
  $('pp-billing-modal').hidden = true;
  $('pp-checkout-go').hidden = true;
  $('pp-paid-done').hidden = true;
  $('pp-embed').innerHTML = '';
  note.hidden = false;
  note.textContent = 'Getting your secure checkout ready...';
  openModal('pp-checkout');
  try {
    let data;
    if (demo) {
      data = { configId: DEMO_CONFIG_ID, planId: 'demo' };
    } else {
      const idToken = await me.getIdToken();
      const res = await fetch(WORKER_URL + '/whop/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, game: gameKey }),
      });
      data = await res.json();
      if (!res.ok || !data.planId) throw new Error(data.error || 'Something went wrong. Please try again.');
    }
    await loadWhopElements();
    const onComplete = () => {
      store.set(joinedKey(me.uid), true);
      view = 'joined';
      skippedIdx = new Set();
      renderAll();
      $('pp-checkout-title').textContent = "You're in!";
      $('pp-paid-done').textContent = 'See my table';
      $('pp-paid-done').hidden = false;
    };
    const session = window.WhopElements().checkout.create({ checkoutConfiguration: data.configId, onComplete });
    const element = session.create('checkout', demo ? { onComplete } : { buyerEmail: me.email, lockBuyerEmail: true, onComplete });
    element.mount($('pp-embed'));
    note.hidden = true;
  } catch (err) {
    note.textContent = err.message;
  }
}

$('pp-checkout-go').addEventListener('click', () => { markJoined(); });
$('pp-paid-done').addEventListener('click', closeModals);
$('pp-leave-btn').addEventListener('click', () => ask('Leave ' + TEST_GAME.title + '?', "You won't be charged again and your seat opens up for someone else.", () => { view = 'left'; skippedIdx = new Set(); renderAll(); }));
$('pp-confirm-yes').addEventListener('click', () => { const fn = onConfirm; onConfirm = null; closeModals(); if (fn) fn(); });

if (hasGame && query.get("back")) {
  const back = query.get("back");
  const backLink = $("pp-back");
  backLink.href = back.endsWith("/") || back.endsWith("index.html") ? back + "#campaigns" : back;
  backLink.textContent = back.includes("/blog/") ? "← Back to the campaign" : "← Back to campaigns";
}
if (demo) $("pp-demo-banner").hidden = false;
renderProfile();
renderAll();
