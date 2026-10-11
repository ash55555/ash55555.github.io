// Joining a play-by-post game: one flat payment, once, paid on Whop's own secure form,
// the same way a tip works. No card is kept on file and nothing is ever charged again,
// since there are no sessions to bill for. Used by campaign-content.js (a pbp campaign's
// own page) and gm-campaigns.js (a Game Master's "Current Campaigns" card).
(function () {
  var WORKER = 'https://ash-tabletop-announcements.ash-tabletop.workers.dev';
  var DOLLAR = String.fromCharCode(36);

  function api(action, body) {
    var user = window.firebase && firebase.auth && firebase.auth().currentUser;
    if (!user) return Promise.reject(new Error('Please log in first.'));
    return user.getIdToken().then(function (idToken) {
      return fetch(WORKER + '/pbp/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ idToken: idToken }, body || {})) });
    }).then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'Something went wrong.'); return d; }); });
  }

  var elementsPromise = null;
  function loadElements() {
    if (window.WhopElements) return Promise.resolve();
    if (!elementsPromise) elementsPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdn.whop.com/elements/amber/elements.js';
      s.setAttribute('data-whop-elements', '');
      s.onload = resolve;
      s.onerror = function () { reject(new Error('The payment form could not load. Please try again.')); };
      document.head.appendChild(s);
    });
    return elementsPromise;
  }

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function close(modal) { if (modal) { modal.remove(); document.body.classList.remove('modal-open'); } }

  function openPayModal(slug, onJoined) {
    var modal = el('div', 'tip-modal');
    modal.innerHTML = '<div class="tip-dialog" role="dialog" aria-modal="true"><button type="button" class="tip-x" aria-label="Close">&times;</button><div class="tip-body"></div></div>';
    document.body.appendChild(modal);
    document.body.classList.add('modal-open');
    modal.addEventListener('click', function (e) { if (e.target === modal) close(modal); });
    modal.querySelector('.tip-x').addEventListener('click', function () { close(modal); });
    var body = modal.querySelector('.tip-body');
    body.innerHTML = '';
    body.appendChild(el('h3', null, 'Getting the payment form ready...'));

    api('start', { slug: slug }).then(function (d) {
      body.innerHTML = '';
      body.appendChild(el('h3', null, 'Join ' + d.title + ' — ' + DOLLAR + d.amount));
      var note = el('p', 'tip-sub', 'Enter your card below. Paid once, nothing is kept on file.');
      var host = el('div', 'tip-embed');
      body.append(note, host);
      var done = false;
      function confirm(tries) {
        api('confirm', { pbpId: d.pbpId }).then(function (r) {
          if (r.ok) { done = true; stepThanks(body, d.title); if (onJoined) onJoined(); return; }
          if (tries > 0) setTimeout(function () { confirm(tries - 1); }, 2500);
          else note.textContent = 'We are still waiting for Whop to confirm your payment. If you were charged, it will be counted shortly.';
        }).catch(function () { if (tries > 0) setTimeout(function () { confirm(tries - 1); }, 2500); });
      }
      loadElements().then(function () {
        var elements = window.WhopElements(d.environment === 'sandbox' ? { environment: 'sandbox' } : {});
        var session = elements.checkout.create({ checkoutConfiguration: d.configId, onComplete: function () { confirm(8); } });
        var element = session.create('checkout', { buyerEmail: d.email, lockBuyerEmail: true, onComplete: function () { confirm(8); } });
        element.mount(host);
        var started = Date.now();
        var iv = setInterval(function () {
          if (done || !modal.isConnected || Date.now() - started > 15 * 60 * 1000) { clearInterval(iv); return; }
          api('confirm', { pbpId: d.pbpId }).then(function (r) { if (r.ok && !done) { done = true; clearInterval(iv); stepThanks(body, d.title); if (onJoined) onJoined(); } }).catch(function () {});
        }, 6000);
      }).catch(function (err) { note.textContent = err.message; });
    }).catch(function (err) {
      body.innerHTML = '';
      body.appendChild(el('h3', null, 'Could not start'));
      body.appendChild(el('p', 'tip-sub', err.message));
      var ok = el('button', 'btn btn-primary tip-go', 'Close');
      ok.type = 'button';
      ok.addEventListener('click', function () { close(modal); });
      body.appendChild(ok);
    });

    function stepThanks(body, title) {
      body.innerHTML = '';
      body.className = 'tip-body tip-thanks';
      body.append(el('div', 'tip-party', String.fromCodePoint(127881)), el('h3', null, "You're in!"),
        el('p', 'tip-sub', 'Welcome to ' + title + '. The Game Master will be in touch.'));
      var ok = el('button', 'btn btn-primary tip-go', 'Close');
      ok.type = 'button';
      ok.addEventListener('click', function () { close(modal); });
      body.appendChild(ok);
    }
  }

  // Wires a "Join" button (and an optional status line) to the join flow for one pbp
  // campaign. Safe to call more than once on the same page (a GM card per campaign).
  // btnRef/statusRef can be an element id (looked up now, for a page that already has
  // the element live in the document) or the element itself (for a card still being
  // built in memory, before it's attached — document.getElementById would find nothing).
  function wireJoin(slug, btnRef, statusRef) {
    var btn = typeof btnRef === 'string' ? document.getElementById(btnRef) : btnRef;
    if (!btn) return;
    var status = typeof statusRef === 'string' ? document.getElementById(statusRef) : statusRef;
    function go() {
      openPayModal(slug, function () { btn.disabled = true; btn.textContent = "You're in!"; if (status) status.textContent = ''; });
    }
    btn.addEventListener('click', function () {
      var user = window.firebase && firebase.auth && firebase.auth().currentUser;
      if (user) { go(); return; }
      // A page with its own sign-in modal (gm.html, ash.html) uses that; this campaign
      // template has no sign-in UI of its own (joining a session normally happens inside
      // player.html's own iframe instead), so Google sign-in is triggered directly here.
      var login = document.querySelector('.nav-login');
      if (login) { login.click(); return; }
      if (!window.firebase || !firebase.auth) { window.alert('Please log in to join.'); return; }
      var original = btn.textContent;
      btn.disabled = true; btn.textContent = 'Signing in…';
      firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider()).then(function () {
        btn.disabled = false; btn.textContent = original;
        go();
      }).catch(function (err) {
        btn.disabled = false; btn.textContent = original;
        if (err && err.code !== 'auth/popup-closed-by-user') window.alert(err.message || 'Could not sign in.');
      });
    });
  }

  window.AshPbp = { wireJoin: wireJoin };
})();
