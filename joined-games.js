// Marks the games a signed-in player is already in, so the main page says "You're in"
// instead of asking them to join again. Looks the player's games up with the same call the
// profile page uses; nothing is shown to anyone who is signed out or has no games.
(function () {
  var WORKER = 'https://ash-tabletop-announcements.ash-tabletop.workers.dev';
  var keys = null;

  // On this computer only: index.html?preview=joined pretends to be a player who is in a few games.
  var local = ['localhost', '127.0.0.1'].indexOf(window.location.hostname) !== -1;
  var preview = local && new URLSearchParams(window.location.search).get('preview') === 'joined';

  function chipKey(chip) {
    return chip.dataset.campaign + (chip.dataset.slot ? '::' + chip.dataset.slot : '');
  }

  function mark(chip) {
    if (!keys || !chip) return;
    if (!keys[chipKey(chip)]) return;
    chip.classList.add('is-joined');
    chip.classList.remove('is-full', 'is-full-hidden');
    chip.disabled = false;
    var cta = chip.querySelector('.session-chip-cta');
    var sub = chip.querySelector('.session-sub');
    if (cta) cta.textContent = "You're in";
    if (sub) sub.textContent = 'You have a seat at this table. Tap to manage your sessions.';
  }

  function markAll() {
    document.querySelectorAll('.session-chip').forEach(mark);
  }

  window.AshJoined = { mark: mark };

  // A joined chip takes the player to their schedule instead of opening the join window.
  document.addEventListener('click', function (e) {
    var chip = e.target.closest && e.target.closest('.session-chip.is-joined');
    if (!chip) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    window.location.href = (window.location.pathname.indexOf('/blog/') !== -1 ? '../' : '') + 'profile.html#me-schedule';
  }, true);

  function setKeys(list) {
    keys = {};
    list.forEach(function (k) { keys[k] = true; });
    markAll();
  }

  if (preview) {
    document.addEventListener('DOMContentLoaded', function () {
      setKeys(['crooked-moon::C', 'curse-of-strahd::B', 'flying-city', 'the-vampiric-dynasty']);
      setTimeout(markAll, 2500);
    });
    return;
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (typeof firebase === 'undefined' || !firebase.auth) return;
    firebase.auth().onAuthStateChanged(function (user) {
      if (!user) return;
      user.getIdToken().then(function (idToken) {
        return fetch(WORKER + '/pay/my-games', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: idToken }),
        });
      }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
        if (d && d.games) setKeys(d.games.map(function (g) { return g.key; }));
      }).catch(function () { /* the page just shows the normal Join buttons */ });
    });
  });
})();
