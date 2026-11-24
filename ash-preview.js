// Local-only sample mode, shared by every page: start at ANY page with ?preview=gm&as=rin or
// ?preview=player&as=alice ONCE, and it sticks (saved on this computer only) across every other
// page you click to from there -- browsing games, your profile, a campaign page, all of it --
// until you tap "Exit demo". It only wakes up on localhost; nothing here is ever sent or saved
// anywhere real.
(function () {
  var local = ['localhost', '127.0.0.1'].indexOf(window.location.hostname) !== -1;
  if (!local) return;
  var q = new URLSearchParams(window.location.search);
  var qMode = q.get('preview');
  var KEY = 'ashPreview';
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { saved = null; }

  if (qMode === 'off') {
    try { localStorage.removeItem(KEY); } catch (e) {}
    saved = null;
  } else if (qMode === 'gm' || qMode === 'player') {
    saved = { mode: qMode, as: q.get('as') || (qMode === 'gm' ? 'mira' : 'alice') };
    try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) {}
  }
  if (!saved) return;
  if (typeof firebase === 'undefined') return;

  var GM_UIDS = { mira: 'demo-gm-mira', theo: 'demo-gm-theo', rin: 'demo-gm-rin' };
  var PLAYERS = { alice: ['p-alice', 'Alice Marsh'], guil: ['p-guil', 'Guilbi'], dolphin: ['p-dolphin', 'Boneless Dolphin'], silver: ['p-silver', 'Silverbeam Creations'], rue: ['p-rue', 'Rue'], kit: ['p-kit', 'Kit'] };

  var uid, label;
  if (saved.mode === 'gm') { uid = GM_UIDS[saved.as] || GM_UIDS.mira; label = (saved.as || 'mira'); label = label.charAt(0).toUpperCase() + label.slice(1) + ' (Game Master)'; }
  else { var p = PLAYERS[saved.as] || PLAYERS.alice; uid = p[0]; label = p[1] + ' (Player)'; }

  window.AshAdminPreview = saved.mode === 'gm'; // admin.html's own script checks this flag

  var user = { uid: uid, email: uid + '@example.com', displayName: saved.mode === 'player' ? label.replace(' (Player)', '') : '', getIdToken: function () { return Promise.resolve('demo:' + uid); } };
  var realAuth = firebase.auth;
  var fakeAuth = {
    currentUser: user,
    onAuthStateChanged: function (cb) { setTimeout(function () { cb(user); }, 0); return function () {}; },
    signOut: function () { try { localStorage.removeItem(KEY); } catch (e) {} return Promise.resolve(); },
    signInWithEmailAndPassword: function () { return Promise.resolve({ user: user }); },
    getRedirectResult: function () { return Promise.resolve({}); },
  };
  firebase.auth = function () { return fakeAuth; };
  Object.keys(realAuth).forEach(function (k) { firebase.auth[k] = realAuth[k]; });

  // A small always-visible badge, so it's never a mystery which demo persona is active, with a
  // one-tap way to switch or leave the demo entirely (back to your own real account).
  function addBadge() {
    var bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;left:50%;bottom:10px;transform:translateX(-50%);z-index:999999;padding:.5em 1em;border-radius:999px;background:#1c1230;border:1px solid #4a3877;color:#f2b84f;font:700 13px Nunito,Arial,sans-serif;display:flex;gap:10px;align-items:center;box-shadow:0 4px 20px rgba(0,0,0,.5)';
    bar.innerHTML = 'DEMO &middot; signed in as <strong style="color:#fff">' + label + '</strong>' +
      ' <button type="button" id="ash-preview-exit" style="background:#9b6dff;color:#fff;border:0;border-radius:999px;padding:.3em .8em;font:700 12px Nunito,Arial,sans-serif;cursor:pointer">Exit demo</button>';
    document.body.appendChild(bar);
    document.getElementById('ash-preview-exit').addEventListener('click', function () {
      try { localStorage.removeItem(KEY); } catch (e) {}
      location.href = location.pathname;
    });
  }
  if (document.body) addBadge(); else document.addEventListener('DOMContentLoaded', addBadge);
})();
