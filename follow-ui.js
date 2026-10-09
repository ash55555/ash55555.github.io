// The "Follow" button on a Game Master's profile page: lets a signed-in player ask to be
// told the moment this GM publishes a new campaign. Builds its own button + follower count
// into a mount point (#follow-mount), the same way the Messages compose window works, so
// gm.html only needs one empty element and no page-specific wiring.
(function () {
  var WORKER = 'https://ash-tabletop-announcements.ash-tabletop.workers.dev';

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function api(path, extra, getToken) {
    var body = Object.assign({}, extra || {});
    return (getToken ? getToken() : Promise.resolve(null)).then(function (idToken) {
      if (idToken) body.idToken = idToken;
      return fetch(WORKER + '/follow/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error(d.error || 'Something went wrong. Please try again.');
        return d;
      });
    });
  }

  function countText(n) {
    return n === 1 ? '1 follower' : n + ' followers';
  }

  document.addEventListener('DOMContentLoaded', function () {
    var mount = document.getElementById('follow-mount');
    var slug = document.body.getAttribute('data-gm-slug') || '';
    if (!mount || !slug) return;

    var btn = el('button', 'btn btn-ghost follow-btn');
    btn.type = 'button';
    var label = el('span', null, 'Follow');
    btn.appendChild(label);
    var count = el('span', 'follow-count');
    mount.appendChild(btn);
    mount.appendChild(count);

    var following = false;
    var busy = false;

    function paint(n) {
      btn.classList.toggle('on', following);
      label.textContent = following ? 'Following' : 'Follow';
      btn.title = following ? 'Click to stop following' : 'Get a notice when this Game Master posts a new game';
      if (typeof n === 'number') count.textContent = countText(n);
    }

    fetch(WORKER + '/follow/count?slug=' + encodeURIComponent(slug))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d) paint(d.count); })
      .catch(function () { /* the count just stays blank */ });

    function currentUser() {
      return window.firebase && firebase.auth && firebase.auth().currentUser;
    }

    function refreshStatus() {
      var user = currentUser();
      if (!user) return;
      api('status', { gmSlug: slug }, function () { return user.getIdToken(); })
        .then(function (d) { following = !!d.following; paint(d.count); })
        .catch(function () { /* stays whatever it last showed */ });
    }
    refreshStatus();
    if (window.firebase && firebase.auth) firebase.auth().onAuthStateChanged(refreshStatus);

    btn.addEventListener('click', function () {
      var user = currentUser();
      if (!user) {
        var login = document.querySelector('.nav-login');
        if (login) login.click(); else window.alert('Please log in to follow this Game Master.');
        return;
      }
      if (busy) return;
      busy = true;
      btn.disabled = true;
      api('toggle', { gmSlug: slug }, function () { return user.getIdToken(); })
        .then(function (d) { following = !!d.following; paint(d.count); })
        .catch(function (err) { window.alert(err.message); })
        .then(function () { busy = false; btn.disabled = false; });
    });
  });
})();
