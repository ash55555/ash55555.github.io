// The signed-in nav widget shared by index.html, player.html and profile.html:
// a notification bell and an avatar circle (picture or token) that opens a small
// dropdown. Call AshNav.mount(container, user) once Firebase says who is signed in,
// and AshNav.unmount(container) when they sign out.

var AshNav = (function () {
  var WORKER = 'https://ash-tabletop-announcements.ash-tabletop.workers.dev';
  var TOKENS = {
    dragon: { emoji: '\u{1F409}', color: '#6b46c1' },
    wizard: { emoji: '\u{1F9D9}', color: '#2f5fa8' },
    dagger: { emoji: '\u{1F5E1}️', color: '#8a3b3b' },
    elf: { emoji: '\u{1F9DD}', color: '#2f7a5a' },
    bat: { emoji: '\u{1F987}', color: '#4a3a6b' },
    dice: { emoji: '\u{1F3B2}', color: '#a8702f' },
  };
  var KIND_LABEL = { declined: 'Card declined', skipped_admin: 'Session skipped', skipped_self: 'Session skipped', review_invite: 'How was your game?', removed: 'Removed from a game',
    joined: 'New player', left: 'Left', skipped_player: 'Skipped', review: 'Review', new_account: 'New account', charge_failed: 'Charge failed', gave_up: 'Gave up', unknown: 'Check Whop', reminder: 'Reminder' };
  // Notifications that are about running the games. Only Ash's account ever gets these, and
  // clicking one goes to the admin page.
  function adminLink(n) {
    if (n.game) return 'admin.html#game=' + encodeURIComponent(n.game);
    return 'admin.html#tab=' + (n.kind === 'review' ? 'reviews' : 'notifications');
  }
  var DM_KINDS = { joined: 1, left: 1, skipped_player: 1, review: 1, new_account: 1, charge_failed: 1, gave_up: 1, unknown: 1, reminder: 1 };
  var ICON = {
    profile: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="8" r="3.4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4.5 19.5c1.5-3.6 4.3-5.4 7.5-5.4s6 1.8 7.5 5.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    schedule: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="4" y="5.5" width="16" height="14.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4 9.5h16M8 3.5v3M16 3.5v3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M8 13h2.4M8 16.3h2.4M13.6 13H16M13.6 16.3H16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    logout: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M9 4.5H6a1.5 1.5 0 0 0-1.5 1.5v12A1.5 1.5 0 0 0 6 19.5h3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M11 12h9m0 0-3-3m3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    admin: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3.5l7 3v5.5c0 4.5-3 7.5-7 8.5-4-1-7-4-7-8.5V6.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 12l2.2 2.2L15.5 9.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4.5 12.5l5 5 10-10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function ago(iso) {
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 90) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function call(user, action) {
    return user.getIdToken().then(function (idToken) {
      return fetch(WORKER + '/profile/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: idToken }) });
    }).then(function (res) { return res.json().then(function (data) { if (!res.ok) throw new Error(data.error || 'Something went wrong.'); return data; }); });
  }

  var state = new WeakMap();

  function closeAll(root) {
    root.querySelectorAll('.nu-panel').forEach(function (p) { p.hidden = true; });
  }

  function mount(container, user) {
    if (!container || !user) return;
    unmount(container);
    container.hidden = false;
    container.innerHTML =
      '<div class="nu-wrap">' +
      '<button type="button" class="nu-bell" aria-label="Notifications" aria-haspopup="true" aria-expanded="false">' +
      '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 10a6 6 0 1 1 12 0c0 3.2 1 5 2 6.5H4c1-1.5 2-3.3 2-6.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9.5 19a2.6 2.6 0 0 0 5 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' +
      '<span class="nu-dot" hidden></span>' +
      '</button>' +
      '<div class="nu-panel nu-bell-panel" hidden>' +
      '<div class="nu-panel-head"><strong>Notifications</strong><button type="button" class="nu-mark-read">' + ICON.check + '<span>Mark all read</span></button></div>' +
      '<div class="nu-list"></div>' +
      '</div>' +
      '<button type="button" class="nu-avatar" aria-label="Your account" aria-haspopup="true" aria-expanded="false"><span class="nu-avatar-img"></span></button>' +
      '<div class="nu-panel nu-menu" hidden>' +
      '<div class="nu-menu-head"><span class="nu-avatar-img nu-avatar-img-lg"></span><div><strong class="nu-menu-name"></strong><span class="nu-menu-email"></span></div></div>' +
      '<a class="nu-menu-item" href="profile.html">' + ICON.profile + '<span>My profile</span></a>' +
      '<a class="nu-menu-item" href="profile.html#me-schedule">' + ICON.schedule + '<span>My schedule</span></a>' +
      '<button type="button" class="nu-menu-item nu-logout">' + ICON.logout + '<span>Log out</span></button>' +
      '</div>' +
      '</div>';

    var wrap = container.querySelector('.nu-wrap');
    var bellBtn = container.querySelector('.nu-bell');
    var bellPanel = container.querySelector('.nu-bell-panel');
    var avatarBtn = container.querySelector('.nu-avatar');
    var menuPanel = container.querySelector('.nu-menu');
    var dot = container.querySelector('.nu-dot');
    var list = container.querySelector('.nu-list');

    function paintAvatar(profile) {
      var slots = container.querySelectorAll('.nu-avatar-img');
      var t = TOKENS[profile.token] || TOKENS.wizard;
      slots.forEach(function (s) {
        s.innerHTML = '';
        s.style.setProperty('--tk', t.color);
        if (profile.avatarUrl) {
          var img = document.createElement('img');
          img.src = profile.avatarUrl;
          img.alt = '';
          s.appendChild(img);
        } else {
          s.textContent = t.emoji;
        }
      });
      container.querySelector('.nu-menu-name').textContent = profile.name || (user.email || '').split('@')[0] || 'Player';
      container.querySelector('.nu-menu-email').textContent = user.email || '';

      // Only the signed-in DM (whoever the worker's ADMIN_UID is) ever sees this —
      // everyone else's profile/get response comes back with isAdmin left false.
      var menu = container.querySelector('.nu-menu');
      var adminLink = menu.querySelector('.nu-menu-admin');
      if (profile.isAdmin && !adminLink) {
        adminLink = document.createElement('a');
        adminLink.className = 'nu-menu-item nu-menu-admin';
        adminLink.href = 'admin.html';
        adminLink.innerHTML = ICON.admin + '<span>GM Dashboard</span>';
        menu.insertBefore(adminLink, menu.querySelector('.nu-logout'));
      } else if (!profile.isAdmin && adminLink) {
        adminLink.remove();
      }
    }

    function renderNotifications(data) {
      list.innerHTML = '';
      dot.hidden = !data.unread;
      if (!data.items.length) { list.appendChild(el('p', 'nu-empty', "Nothing yet. We'll let you know if anything needs your attention.")); return; }
      data.items.forEach(function (n) {
        var item = el('div', 'nu-item' + (n.read ? '' : ' unread'));
        item.appendChild(el('span', 'nu-item-kind', KIND_LABEL[n.kind] || n.title));
        if (n.body) item.appendChild(el('span', 'nu-item-body', n.body));
        item.appendChild(el('span', 'nu-item-time', ago(n.created_at)));
        if (DM_KINDS[n.kind]) {
          item.classList.add('nu-item-link');
          item.addEventListener('click', function () { window.location.href = adminLink(n); });
        }
        if (n.kind === 'review_invite') {
          item.classList.add('nu-item-link');
          item.addEventListener('click', function () { window.location.href = 'profile.html#me-review'; });
        }
        list.appendChild(item);
      });
    }

    var poll = null;
    function refresh() { call(user, 'notifications').then(renderNotifications).catch(function () { /* leave the bell as-is */ }); }

    call(user, 'get').then(paintAvatar).catch(function () { paintAvatar({ token: 'wizard', name: '', avatarUrl: null }); });
    refresh();
    poll = setInterval(refresh, 60000);
    state.set(container, { poll: poll });

    bellBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = bellPanel.hidden;
      closeAll(container);
      bellPanel.hidden = !open;
      bellBtn.setAttribute('aria-expanded', String(open));
      if (open) refresh();
    });
    avatarBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = menuPanel.hidden;
      closeAll(container);
      menuPanel.hidden = !open;
      avatarBtn.setAttribute('aria-expanded', String(open));
    });
    container.querySelector('.nu-mark-read').addEventListener('click', function (e) {
      e.stopPropagation();
      call(user, 'notifications/read').then(refresh).catch(function () {});
    });
    container.querySelector('.nu-logout').addEventListener('click', function () {
      if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) firebase.auth().signOut();
    });
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) closeAll(container); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAll(container); });
  }

  function unmount(container) {
    if (!container) return;
    var s = state.get(container);
    if (s && s.poll) clearInterval(s.poll);
    state.delete(container);
    container.hidden = true;
    container.innerHTML = '';
  }

  return { mount: mount, unmount: unmount };
})();
