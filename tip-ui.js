// "Tip" button on a Game Master's profile page. A player picks an amount (and can write a short note), pays on
// Whop's own secure form, and the Game Master gets the money and a notice. Shown only when that Game Master can take tips.
(function () {
  var WORKER = 'https://ash-tabletop-announcements.ash-tabletop.workers.dev';
  var slug = (document.body.getAttribute('data-gm-slug') || '').toLowerCase();
  var actions = document.querySelector('.profile-main .hero-actions');
  if (!slug || !actions) return;
  var AMOUNTS = [3, 5, 10, 20];
  var DOLLAR = String.fromCharCode(36);
  var info = null, modal = null, amount = 5;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function api(action, body) {
    var user = window.firebase && firebase.auth && firebase.auth().currentUser;
    if (!user) return Promise.reject(new Error('Please log in first.'));
    return user.getIdToken().then(function (idToken) {
      return fetch(WORKER + '/tip/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ idToken: idToken }, body || {})) });
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

  function close() { if (modal) { modal.remove(); modal = null; document.body.classList.remove('modal-open'); } }

  function open() {
    var user = window.firebase && firebase.auth && firebase.auth().currentUser;
    if (!user) { var login = document.querySelector('.nav-login'); if (login) login.click(); else window.alert('Please log in to leave a tip.'); return; }
    close();
    modal = el('div', 'tip-modal');
    modal.innerHTML = '<div class="tip-dialog" role="dialog" aria-modal="true"><button type="button" class="tip-x" aria-label="Close">&times;</button><div class="tip-body"></div></div>';
    document.body.appendChild(modal);
    document.body.classList.add('modal-open');
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
    modal.querySelector('.tip-x').addEventListener('click', close);
    stepAmount();
  }
  function body() { return modal.querySelector('.tip-body'); }

  function stepAmount() {
    var b = body();
    b.className = 'tip-body';
    b.innerHTML = '';
    b.appendChild(el('h3', null, 'Tip ' + info.name));
    b.appendChild(el('p', 'tip-sub', 'A thank you for the games.'));
    var chips = el('div', 'tip-chips');
    var custom = el('input', 'tip-custom');
    custom.type = 'number'; custom.min = String(info.min); custom.max = String(info.max); custom.step = '1'; custom.placeholder = 'Other';
    AMOUNTS.forEach(function (n) {
      var c = el('button', 'tip-chip' + (n === amount ? ' on' : ''), DOLLAR + n);
      c.type = 'button';
      c.addEventListener('click', function () { amount = n; custom.value = ''; Array.prototype.forEach.call(chips.querySelectorAll('.tip-chip'), function (x) { x.classList.toggle('on', x === c); }); });
      chips.appendChild(c);
    });
    custom.addEventListener('input', function () { var v = parseFloat(custom.value); if (v > 0) { amount = v; Array.prototype.forEach.call(chips.querySelectorAll('.tip-chip'), function (x) { x.classList.remove('on'); }); } });
    var other = el('label', 'tip-other');
    other.append(el('span', null, DOLLAR), custom);
    chips.appendChild(other);
    b.appendChild(chips);
    var msg = el('textarea', 'tip-msg');
    msg.rows = 3; msg.maxLength = 200; msg.placeholder = 'Add a short note (optional)';
    b.appendChild(msg);
    var status = el('p', 'tip-status');
    var go = el('button', 'btn btn-primary tip-go', 'Continue');
    go.type = 'button';
    go.addEventListener('click', function () {
      if (!(amount >= info.min && amount <= info.max)) { status.textContent = 'A tip can be from ' + DOLLAR + info.min + ' to ' + DOLLAR + info.max + '.'; return; }
      go.disabled = true; status.textContent = 'Getting the secure payment form...';
      api('start', { slug: slug, amount: amount, message: msg.value }).then(function (d) { stepPay(d); })
        .catch(function (err) { status.textContent = err.message; go.disabled = false; });
    });
    b.append(status, go, el('p', 'tip-fine', 'You pay on the secure Whop form, so your card details never touch this website. Tips are not refundable through the site.'));
  }

  function stepPay(d) {
    var b = body();
    b.innerHTML = '';
    b.appendChild(el('h3', null, DOLLAR + d.amount + ' for ' + d.name));
    var note = el('p', 'tip-sub', 'Enter your card below.');
    var host = el('div', 'tip-embed');
    b.append(note, host);
    var done = false;
    function confirm(tries) {
      api('confirm', { tipId: d.tipId }).then(function (r) {
        if (r.ok) { done = true; stepThanks(d.amount); return; }
        if (tries > 0) setTimeout(function () { confirm(tries - 1); }, 2500);
        else note.textContent = 'We are still waiting for Whop to confirm your payment. If you were charged, it will be counted shortly.';
      }).catch(function () { if (tries > 0) setTimeout(function () { confirm(tries - 1); }, 2500); });
    }
    loadElements().then(function () {
      var elements = window.WhopElements(d.environment === 'sandbox' ? { environment: 'sandbox' } : {});
      var session = elements.checkout.create({ checkoutConfiguration: d.configId, onComplete: function () { confirm(8); } });
      var element = session.create('checkout', { buyerEmail: d.email, lockBuyerEmail: true, onComplete: function () { confirm(8); } });
      element.mount(host);
      // if the form stays on screen after paying, keep quietly checking for a while
      var started = Date.now();
      var iv = setInterval(function () {
        if (done || !modal || Date.now() - started > 15 * 60 * 1000) { clearInterval(iv); return; }
        api('confirm', { tipId: d.tipId }).then(function (r) { if (r.ok && !done) { done = true; clearInterval(iv); stepThanks(d.amount); } }).catch(function () {});
      }, 6000);
    }).catch(function (err) { note.textContent = err.message; });
  }

  // Whop sometimes sends the whole page through a redirect to finish a payment instead of completing
  // inside the embedded form (see stepPay's onComplete). That lands here with ?tip=thanks&tip_id=...,
  // and the payment still needs to be confirmed with the Worker — it is not safe to just say thanks.
  function confirmAfterRedirect(tipId) {
    function run() {
      modal = null; open();
      if (!modal) return;
      var b = body();
      b.innerHTML = '';
      b.appendChild(el('h3', null, 'Confirming your tip...'));
      var note = el('p', 'tip-sub', 'Just a moment while we check with Whop.');
      b.appendChild(note);
      function poll(tries) {
        api('confirm', { tipId: tipId }).then(function (r) {
          if (r.ok) { stepThanks(r.amount || 0); return; }
          if (tries > 0) setTimeout(function () { poll(tries - 1); }, 2500);
          else note.textContent = 'We are still waiting for Whop to confirm your payment. If you were charged, it will be counted within a few minutes — no need to try again.';
        }).catch(function () {
          if (tries > 0) setTimeout(function () { poll(tries - 1); }, 2500);
          else note.textContent = 'We could not confirm your payment right now. If you were charged, it will be counted within a few minutes.';
        });
      }
      poll(8);
    }
    if (window.firebase && firebase.auth && firebase.auth().currentUser) run();
    else if (window.firebase && firebase.auth) { var off = firebase.auth().onAuthStateChanged(function (user) { off(); if (user) run(); }); }
  }

  function stepThanks(paid) {
    var b = body();
    b.innerHTML = '';
    b.className = 'tip-body tip-thanks';
    b.append(el('div', 'tip-party', String.fromCodePoint(127881)), el('h3', null, 'Thank you!'),
      el('p', 'tip-sub', info.name + ' has your ' + (paid ? DOLLAR + paid + ' ' : '') + 'tip and will be told it came from you.'));
    var ok = el('button', 'btn btn-primary tip-go', 'Close');
    ok.type = 'button';
    ok.addEventListener('click', close);
    b.appendChild(ok);
  }

  fetch(WORKER + '/tip/status?slug=' + encodeURIComponent(slug)).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
    if (!d || !d.ok) return;
    info = d;
    var btn = el('button', 'btn js-tip');
    btn.type = 'button';
    btn.innerHTML = '<span class="tip-heart">' + String.fromCodePoint(10084, 65039) + '</span> <span></span>';
    btn.lastChild.textContent = 'Tip ' + d.name;
    btn.addEventListener('click', open);
    actions.appendChild(btn);
    var tipParams = new URLSearchParams(window.location.search);
    if (tipParams.get('tip') === 'thanks') {
      var tipId = tipParams.get('tip_id');
      if (tipId) confirmAfterRedirect(tipId);
      else { modal = null; open(); if (modal) stepThanks(0); } // an older link with no tip_id: nothing left to confirm
    }
  }).catch(function () {});
})();
