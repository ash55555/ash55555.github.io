// Local-only sample mode for the admin page: open admin.html?preview=glass on this computer to see
// every tab filled with made-up games, players and money, without logging in. It does nothing on the
// live site (it only wakes up on localhost), and nothing you click here is sent or saved anywhere.
(function () {
  var local = ['localhost', '127.0.0.1'].indexOf(window.location.hostname) !== -1;
  if (!local || new URLSearchParams(window.location.search).get('preview') !== 'glass') return;
  if (typeof firebase === 'undefined') return;
  window.AshAdminPreview = true;

  // ---- pretend to be signed in as the DM
  var user = { uid: 'preview', email: 'dm@example.com', getIdToken: function () { return Promise.resolve('preview-token'); } };
  var realAuth = firebase.auth;
  var fakeAuth = {
    currentUser: user,
    onAuthStateChanged: function (cb) { setTimeout(function () { cb(user); }, 0); return function () {}; },
    signOut: function () { return Promise.resolve(); },
    signInWithEmailAndPassword: function () { return Promise.resolve({ user: user }); }
  };
  firebase.auth = function () { return fakeAuth; };
  Object.keys(realAuth).forEach(function (k) { firebase.auth[k] = realAuth[k]; });

  // ---- the database can be read but never written
  var realDb = firebase.database;
  firebase.database = function () {
    var db = realDb.apply(firebase, arguments);
    return new Proxy(db, {
      get: function (t, p) {
        if (p !== 'ref') { var v = t[p]; return typeof v === 'function' ? v.bind(t) : v; }
        return function () {
          var ref = t.ref.apply(t, arguments);
          return new Proxy(ref, {
            get: function (rt, rp) {
              if (['set', 'update', 'remove', 'push', 'transaction'].indexOf(rp) !== -1) return function () { return Promise.resolve(); };
              var rv = rt[rp];
              return typeof rv === 'function' ? rv.bind(rt) : rv;
            }
          });
        };
      }
    });
  };
  Object.keys(realDb).forEach(function (k) { firebase.database[k] = realDb[k]; });

  // ---- sample data
  var DAY = 86400000;
  var GAMES = [
    { key: 'crooked-moon::A', title: 'The Crooked Moon, Group A', day: 4, hour: 20, running: false, online: 2, enabled: true },
    { key: 'crooked-moon::B', title: 'The Crooked Moon, Group B', day: 6, hour: 0, running: false, online: 4, enabled: true },
    { key: 'crooked-moon::C', title: 'The Crooked Moon, Group C', day: 6, hour: 18, running: false, online: 1, enabled: true },
    { key: 'curse-of-strahd::A', title: 'Curse of Strahd, Group A', day: 5, hour: 20, running: false, online: 2, enabled: true },
    { key: 'curse-of-strahd::B', title: 'Curse of Strahd, Group B', day: 1, hour: 21, running: true, online: 4, enabled: true },
    { key: 'curse-of-strahd::-P2wqpCkiDmAAzOsTG0u', title: 'Curse of Strahd, Group C', day: 4, hour: 0, running: false, online: 3, enabled: true },
    { key: 'flying-city', title: 'The Prophecy of the Flying City', day: 3, hour: 18, running: false, online: 3, enabled: true },
    { key: 'ravenloft-undead-survival', title: 'Ravenloft: Undead Survival', day: 6, hour: 21, running: false, online: 0, enabled: false },
    { key: 'the-vampiric-dynasty', title: 'The Vampiric Dynasty', day: 3, hour: 19, running: true, online: 3, enabled: true },
    { key: 'witchlight', title: 'The Wild Beyond the Witchlight', day: 0, hour: 0, running: false, online: 1, enabled: false }
  ].map(function (g) { g.minute = 0; g.offset = 1; return g; });

  var PEOPLE = [
    { uid: 'u1', name: 'Guilbi', email: 'guilbi@example.com', token: 'wizard', card: 'mastercard 3608' },
    { uid: 'u2', name: 'Alice Marsh', email: 'alice@example.com', token: 'elf', card: 'visa 4242' },
    { uid: 'u3', name: 'Boneless Dolphin', email: 'dolphin@example.com', token: 'dragon', card: 'visa 1881' },
    { uid: 'u4', name: 'Silverbeam Creations', email: 'silver@example.com', token: 'bat', card: 'mastercard 5100' }
  ];

  function upcoming(g, n) {
    var out = [], now = Date.now();
    for (var i = 0; i < 40 && out.length < n; i++) {
      var d = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + i, g.hour - g.offset, 0));
      if (new Date(d.getTime() + g.offset * 3600000).getUTCDay() === g.day && d.getTime() > now) out.push(d.toISOString());
    }
    return out;
  }

  function roster(key) {
    var g = GAMES.filter(function (x) { return x.key === key; })[0] || GAMES[0];
    var people = PEOPLE.slice(0, Math.max(1, Math.min(g.online || 1, 4)));
    var sessions = upcoming(g, 6);
    var playing = {};
    sessions.forEach(function (s) { playing[s] = people.length; });
    var past = [new Date(Date.parse(sessions[0]) - 7 * DAY).toISOString(), new Date(Date.parse(sessions[0]) - 14 * DAY).toISOString()];
    return {
      mode: 'live', running: g.running, startedAt: g.running ? new Date(Date.now() - 20 * DAY).toISOString() : null, stoppedAt: null,
      playing: playing, charging: 'on',
      game: { key: g.key, title: g.title, price: 10, max: 5, min: 3, legacyFilled: 0 },
      seats: { filled: people.length, max: 5, min: 3, open: 5 - people.length },
      sessions: sessions, pastSessions: past,
      players: people.map(function (p) { return { uid: p.uid, email: p.email, name: p.name, status: 'active', joinedAt: new Date(Date.now() - 25 * DAY).toISOString(), token: p.token, avatarId: null, card: p.card }; }),
      skips: people.length > 1 ? [{ uid: people[1].uid, session_ts: sessions[0], by: 'player' }] : [],
      charges: people.map(function (p, i) { return { uid: p.uid, ts: past[0], status: g.running ? 'paid' : 'new', amount: 10, refunded: 0, attempts: 1, error: null, paymentId: 'pay_' + i }; })
    };
  }

  function stats() {
    var players = [], charges = [], i;
    for (i = 0; i < 14; i++) players.push({ uid: 'p' + i, game: GAMES[i % GAMES.length].key, joined: new Date(Date.now() - (90 - i * 6) * DAY).toISOString(), left: i % 6 === 5 ? new Date(Date.now() - (30 - i) * DAY).toISOString() : null });
    for (var d = 60; d >= 1; d--) { var n = d % 7 === 3 ? 4 : d % 7 === 5 ? 3 : 0; for (var k = 0; k < n; k++) charges.push({ game: 'curse-of-strahd::B', ts: new Date(Date.now() - d * DAY).toISOString(), net: 10 }); }
    return { mode: 'live', players: players, charges: charges };
  }

  var NOTES = [
    { id: 6, kind: 'joined', game: 'crooked-moon::C', title: 'New player: Guilbi', body: 'Guilbi joined The Crooked Moon, Group C.', mins: 12, read: 0 },
    { id: 5, kind: 'new_account', game: null, title: 'New account', body: 'Alice Marsh made an account.', mins: 90, read: 0 },
    { id: 4, kind: 'skipped_player', game: 'curse-of-strahd::B', title: 'Skipped a session', body: 'Boneless Dolphin skipped Monday.', mins: 600, read: 1 },
    { id: 3, kind: 'review', game: null, title: 'New review', body: 'Silverbeam left you 5 stars.', mins: 1500, read: 1 },
    { id: 2, kind: 'reminder', game: null, title: 'Reminders sent', body: '9 players were reminded about tomorrow.', mins: 2800, read: 1 }
  ].map(function (n) { n.created_at = new Date(Date.now() - n.mins * 60000).toISOString(); return n; });

  function answer(url, body) {
    var path = url.replace(/^https?:\/\/[^/]+/, '');
    var data = {};
    if (/\/pay\/admin\/games$/.test(path)) data = { games: GAMES };
    else if (/\/pay\/admin\/roster$/.test(path)) data = roster(body.game);
    else if (/\/pay\/admin\/balance$/.test(path)) data = { mode: 'live', total: 42.5, withdrawable: 31.2 };
    else if (/\/pay\/admin\/stats$/.test(path)) data = stats();
    else if (/\/pay\/admin\/charges$/.test(path)) {
      data = { mode: 'live', charges: PEOPLE.map(function (p, i) { return { game: 'curse-of-strahd::B', gameTitle: 'Curse of Strahd, Group B', uid: p.uid, name: p.name, email: p.email, ts: new Date(Date.now() - (i + 1) * DAY).toISOString(), status: i === 3 ? 'failed' : 'paid', amount: 10, refunded: 0, paymentId: 'pay_' + i, error: i === 3 ? 'Card declined' : null }; }) };
    }
    else if (/\/pay\/admin\/notifications$/.test(path)) data = { items: NOTES, unread: 2, emailOn: true };
    else if (/\/(pay|profile)\/admin\/summary$/.test(path)) {
      var slots = '';
      for (var i = 0; i < 336; i++) slots += ((i % 48) >= 36 + (i % 3) && (i % 48) < 46) ? '1' : '0';
      data = { players: PEOPLE.map(function (p, n) { return { uid: p.uid, name: p.name, interests: n % 2 ? ['Curse of Strahd'] : ['Curse of Strahd', 'The Crooked Moon'], other: n === 2 ? 'Dragon Heist' : '', slots: slots, tz: 'Europe/Paris', fmt: 'local' }; }) };
    }
    else if (/\/review\/admin\/list$/.test(path)) {
      data = { reviews: [
        { uid: 'u2', name: 'Alice Marsh', token: 'elf', rating: 5, tags: ['Great storyteller', 'Welcoming'], comment: 'Best table I have played at.', sessions: 12, shown: true, updatedAt: new Date(Date.now() - 6 * DAY).toISOString() },
        { uid: 'u4', name: 'Silverbeam Creations', token: 'bat', rating: 4, tags: ['Well prepared'], comment: '', sessions: 7, shown: false, updatedAt: new Date(Date.now() - 20 * DAY).toISOString() }
      ] };
    }
    else if (/\/content\/admin\/list$/.test(path)) {
      data = { campaigns: [
        { slug: 'curse-of-strahd', title: 'Curse of Strahd', eyebrow: 'Gothic Horror', published: true, bannerUrl: 'medie/1466afad-bf88-4950-9f9b-a82a40f44147.webp' },
        { slug: 'crooked-moon', title: 'The Crooked Moon', eyebrow: 'Folk Horror', published: true, bannerUrl: 'medie/daaeef05-e995-40b5-84d6-4d6f5670fa47.webp' },
        { slug: 'witchlight', title: 'The Wild Beyond the Witchlight', eyebrow: 'Whimsical Fey Tale', published: true, bannerUrl: 'medie/d4e2868e-d17f-4a04-aeb1-ba6ce7fd3ea3.webp' }
      ] };
    }
    else data = { ok: true };
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : input.url;
    var method = ((init && init.method) || 'GET').toUpperCase();
    if (/ash-tabletop-announcements/.test(url) && method === 'POST') {
      var body = {};
      try { body = JSON.parse(init.body || '{}'); } catch (e) { /* no body */ }
      return Promise.resolve(answer(url, body));
    }
    return realFetch(input, init);
  };

  var note = document.createElement('div');
  note.textContent = 'PREVIEW: sample games, players and money. This computer only. Nothing you click here is saved or sent.';
  note.style.cssText = 'position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:9999;padding:.45em 1em;border-radius:999px;background:rgba(14,9,32,.85);border:1px solid rgba(255,255,255,.25);color:#ffcf6b;font:700 .78rem Nunito,sans-serif;pointer-events:none;';
  document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(note); });
})();
