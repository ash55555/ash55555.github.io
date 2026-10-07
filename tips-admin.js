// The Tips box in the Finance tab: what players have tipped this Game Master (or Ash).
(function () {
  var box = document.getElementById('tips-list');
  var status = document.getElementById('tips-status');
  if (!box) return;
  var DOLLAR = String.fromCharCode(36);
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function money(n) { return DOLLAR + (Math.round(n * 100) % 100 === 0 ? String(Math.round(n)) : n.toFixed(2)); }

  function draw(d) {
    box.innerHTML = '';
    status.textContent = '';
    if (!d.tips.length) { box.appendChild(el('p', 'pay-muted', 'No tips yet. A "Tip" button shows on your profile page once your payouts are approved.')); return; }
    var total = el('div', 'tips-total');
    total.append(el('b', null, money(d.total)), el('span', null, 'in tips so far'));
    box.appendChild(total);
    d.tips.forEach(function (t) {
      var row = el('div', 'tips-row');
      var main = el('div', 'tips-main');
      main.append(el('strong', null, t.from), el('span', 'pay-muted', new Date(t.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })));
      if (t.message) main.appendChild(el('p', 'tips-msg', t.message));
      row.append(main, el('b', 'tips-amt', money(t.amount)));
      box.appendChild(row);
    });
  }

  // Ash keeps all of her own tips; a Game Master keeps 95 percent of theirs.
  (window.AshRoleReady || Promise.resolve({})).then(function (role) {
    var note = document.querySelector('#tips-box .note');
    if (note) note.textContent = role && role.isAdmin ? 'What players leave you as a thank you. All of it is yours.' : 'What players leave you as a thank you. Ash Tabletop keeps 5% of each tip, and the rest is yours.';
  });

  function load() {
    var user = firebase.auth().currentUser;
    if (!user) return;
    status.textContent = 'Loading...';
    user.getIdToken().then(function (idToken) {
      return fetch('https://ash-tabletop-announcements.ash-tabletop.workers.dev/tip/mine', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: idToken }) });
    }).then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'Could not load tips.'); return d; }); })
      .then(draw).catch(function (err) { status.textContent = err.message; status.className = 'slot-status error'; });
  }

  var st = document.createElement('style');
  st.textContent = '.tips-total { display: flex; align-items: baseline; gap: .6em; margin: .4em 0 .8em; } .tips-total b { font-size: 2rem; color: var(--gold); } .tips-row { display: flex; justify-content: space-between; gap: 1em; padding: .8em 1em; margin-bottom: .5em; border-radius: 14px; border: 1px solid rgba(255,255,255,.18); background: rgba(255,255,255,.05); } .tips-main { display: grid; gap: .1em; } .tips-main strong { font-size: 1rem; } .tips-msg { margin: .3em 0 0; font-style: italic; } .tips-amt { font-size: 1.3rem; color: #7be0a3; white-space: nowrap; }';
  document.head.appendChild(st);

  firebase.auth().onAuthStateChanged(function (user) { if (user) load(); });
  var rail = document.querySelector('.me-rail-btn[data-tab="finance"]');
  if (rail) rail.addEventListener('click', load);
})();
