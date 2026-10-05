// In-site messages: the Messages section (a list of conversations and the chat itself), and the
// small "Message <name>" window used on a Game Master's profile page.
// On your own computer (localhost with ?preview=1 in the address) it runs on made-up people and
// keeps everything in this browser only, so nothing on the live site is touched.
(function () {
  var WORKER = 'https://ash-tabletop-announcements.ash-tabletop.workers.dev';
  var local = ['localhost', '127.0.0.1'].indexOf(window.location.hostname) !== -1;
  var pv = new URLSearchParams(window.location.search).get('preview');
  var preview = local && (pv === '1' || pv === 'games');
  var EMOJI = { dragon: '🐉', wizard: '🧙', dagger: '🗡️', elf: '🧝', bat: '🦇', dice: '🎲' };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // ------------------------------------------------------------------ made-up data for the local preview
  var KEY = 'msgPreviewData';
  function previewData() {
    var d = null;
    try { d = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { d = null; }
    if (d) return d;
    var now = Date.now(), m = 60000;
    d = {
      people: {
        mira: { uid: 'mira', name: 'Mira Stonefield', token: 'elf', avatarUrl: null, isGm: false, slug: null },
        tobias: { uid: 'tobias', name: 'Tobias Reed', token: 'dragon', avatarUrl: null, isGm: false, slug: null },
        june: { uid: 'june', name: 'June (new player)', token: 'bat', avatarUrl: null, isGm: false, slug: null },
        gm2: { uid: 'gm2', name: 'Captain Vex', token: 'dagger', avatarUrl: null, isGm: true, slug: 'vex' }
      },
      msgs: [
        { id: 1, other: 'mira', mine: false, text: "Hi Ash! I just joined Curse of Strahd and I'm a little nervous because I have never played D&D. Is there anything I should prepare before Session Zero?", at: now - 95 * m, read: true },
        { id: 2, other: 'mira', mine: true, text: "Welcome Mira! Nothing to prepare, I'll help you build your character in Session Zero. Just bring yourself and a few ideas for who you'd like to be.", at: now - 80 * m, read: true },
        { id: 3, other: 'mira', mine: false, text: 'That makes me feel so much better, thank you!! See you Friday.', at: now - 14 * m, read: false },
        { id: 4, other: 'tobias', mine: false, text: 'Can I skip this week and come back next Monday? Something came up at work.', at: now - 5 * 3600000, read: false },
        { id: 5, other: 'june', mine: false, text: 'Hello, do you have any open seats in the Crooked Moon group on Saturdays?', at: now - 26 * 3600000, read: true },
        { id: 6, other: 'june', mine: true, text: 'Hi June! Yes, Group C has room. You can join from the campaign page.', at: now - 25 * 3600000, read: true },
        { id: 7, other: 'gm2', mine: false, text: 'Welcome to the platform! Let me know if you need anything for your first game.', at: now - 3 * 86400000, read: true }
      ],
      next: 8
    };
    localStorage.setItem(KEY, JSON.stringify(d));
    return d;
  }
  function savePreview(d) { localStorage.setItem(KEY, JSON.stringify(d)); }
  var previewApi = {
    list: function () {
      var d = previewData(), by = {};
      d.msgs.forEach(function (m) { (by[m.other] = by[m.other] || []).push(m); });
      var convs = Object.keys(by).map(function (o) {
        var arr = by[o], last = arr[arr.length - 1];
        return { with: d.people[o], preview: last.text.slice(0, 120), mine: last.mine, at: new Date(last.at).toISOString(), unread: arr.filter(function (m) { return !m.mine && !m.read; }).length };
      }).sort(function (a, b) { return new Date(b.at) - new Date(a.at); });
      return { unread: convs.reduce(function (n, c) { return n + c.unread; }, 0), conversations: convs };
    },
    thread: function (x) {
      var d = previewData();
      d.msgs.forEach(function (m) { if (m.other === x.with && !m.mine) m.read = true; });
      savePreview(d);
      return { with: d.people[x.with], messages: d.msgs.filter(function (m) { return m.other === x.with; }).map(function (m) { return { id: m.id, mine: m.mine, text: m.text, at: new Date(m.at).toISOString() }; }) };
    },
    send: function (x) {
      var d = previewData(), to = x.toUid || 'gm2';
      if (x.toSlug) to = 'gm2';
      d.msgs.push({ id: d.next++, other: to, mine: true, text: String(x.text || '').slice(0, 1000), at: Date.now(), read: true });
      savePreview(d);
      return { ok: true, with: to };
    },
    report: function () { return { ok: true }; },
    unread: function () { return { unread: previewApi.list().unread }; }
  };

  // ------------------------------------------------------------------ talking to the Worker
  function api(action, extra, getToken) {
    if (preview) return Promise.resolve(previewApi[action](extra || {}));
    return getToken().then(function (idToken) {
      return fetch(WORKER + '/msg/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ idToken: idToken }, extra || {})) });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error(d.error || 'Something went wrong. Please try again.');
        return d;
      });
    });
  }

  function ago(iso) {
    var t = new Date(iso).getTime(), s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min';
    if (s < 86400) return Math.round(s / 3600) + ' h';
    if (s < 7 * 86400) return Math.round(s / 86400) + ' d';
    return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function stamp(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  function avatar(person, cls) {
    var a = el('span', 'msg-avatar ' + (cls || ''));
    if (person && person.avatarUrl) { var img = document.createElement('img'); img.src = person.avatarUrl; img.alt = ''; a.appendChild(img); }
    else a.textContent = EMOJI[person && person.token] || EMOJI.wizard;
    return a;
  }

  // ------------------------------------------------------------------ the Messages section
  function mount(container, opts) {
    opts = opts || {};
    var getToken = opts.getToken;
    var openWith = null;
    var convs = [];
    var timer = null;

    container.innerHTML = '';
    container.classList.add('msg-root');
    var wrap = el('div', 'msg-wrap');
    var listCol = el('div', 'msg-list-col');
    var listHead = el('div', 'msg-list-head');
    listHead.appendChild(el('h2', null, 'Messages'));
    listCol.appendChild(listHead);
    var list = el('div', 'msg-list');
    listCol.appendChild(list);
    var threadCol = el('div', 'msg-thread-col');
    wrap.append(listCol, threadCol);
    container.appendChild(wrap);

    function setUnread(n) { if (opts.onUnread) opts.onUnread(n); }

    function renderList() {
      list.innerHTML = '';
      if (!convs.length) {
        var empty = el('div', 'msg-empty');
        empty.appendChild(el('strong', null, 'No messages yet'));
        empty.appendChild(el('span', null, 'When someone writes to you, their message shows up here.'));
        list.appendChild(empty);
        return;
      }
      convs.forEach(function (c) {
        var row = el('button', 'msg-row' + (openWith === c.with.uid ? ' active' : '') + (c.unread ? ' unread' : ''));
        row.type = 'button';
        row.appendChild(avatar(c.with));
        var mid = el('span', 'msg-row-mid');
        var top = el('span', 'msg-row-top');
        top.appendChild(el('b', null, c.with.name));
        if (c.with.isGm) top.appendChild(el('i', 'msg-gm', 'GM'));
        mid.appendChild(top);
        mid.appendChild(el('span', 'msg-snippet', (c.mine ? 'You: ' : '') + c.preview));
        row.appendChild(mid);
        var side = el('span', 'msg-row-side');
        side.appendChild(el('span', 'msg-time', ago(c.at)));
        if (c.unread) side.appendChild(el('span', 'msg-badge', String(c.unread)));
        row.appendChild(side);
        row.addEventListener('click', function () { openThread(c.with.uid); });
        list.appendChild(row);
      });
    }

    function loadList() {
      return api('list', {}, getToken).then(function (d) {
        convs = d.conversations || [];
        setUnread(d.unread || 0);
        renderList();
      }).catch(function (err) { list.innerHTML = ''; list.appendChild(el('div', 'msg-empty', err.message)); });
    }

    function showEmptyThread() {
      threadCol.innerHTML = '';
      wrap.classList.remove('thread-open');
      var e = el('div', 'msg-thread-empty');
      e.appendChild(el('strong', null, 'Pick a conversation'));
      e.appendChild(el('span', null, 'Choose someone on the left to read and answer their messages.'));
      threadCol.appendChild(e);
    }

    function renderThread(d) {
      threadCol.innerHTML = '';
      wrap.classList.add('thread-open');
      var head = el('div', 'msg-thread-head');
      var back = el('button', 'msg-back', '‹ Back'); back.type = 'button';
      back.addEventListener('click', function () { openWith = null; renderList(); showEmptyThread(); });
      head.appendChild(back);
      head.appendChild(avatar(d.with, 'lg'));
      var who = el('div', 'msg-who');
      who.appendChild(el('b', null, d.with.name));
      who.appendChild(el('span', null, d.with.isGm ? 'Game Master' : 'Player'));
      head.appendChild(who);
      if (d.with.slug === 'ash') { var pl = el('a', 'msg-link', 'View profile'); pl.href = 'ash.html'; head.appendChild(pl); }
      var rep = el('button', 'msg-report', 'Report'); rep.type = 'button';
      rep.title = 'Send this conversation to Ash if something is wrong';
      rep.addEventListener('click', function () {
        if (!window.confirm('Report this conversation to Ash? The last few messages will be sent to her.')) return;
        api('report', { with: d.with.uid }, getToken).then(function () { window.alert('Thank you. Ash has been told.'); }).catch(function (e) { window.alert(e.message); });
      });
      head.appendChild(rep);
      threadCol.appendChild(head);

      var log = el('div', 'msg-log');
      d.messages.forEach(function (m) {
        var b = el('div', 'msg-bubble ' + (m.mine ? 'mine' : 'theirs'));
        b.appendChild(el('p', null, m.text));
        b.appendChild(el('time', null, stamp(m.at)));
        log.appendChild(b);
      });
      threadCol.appendChild(log);
      log.scrollTop = log.scrollHeight;

      var form = el('form', 'msg-compose');
      var ta = el('textarea'); ta.rows = 2; ta.maxLength = 1000; ta.placeholder = 'Write a message...';
      var send = el('button', 'btn btn-primary', 'Send'); send.type = 'submit';
      var count = el('small', 'msg-count', '0 / 1000');
      ta.addEventListener('input', function () { count.textContent = ta.value.length + ' / 1000'; });
      ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
      form.append(ta, send, count);
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var text = ta.value.trim();
        if (!text) return;
        send.disabled = true;
        api('send', { toUid: d.with.uid, text: text }, getToken).then(function () {
          ta.value = ''; count.textContent = '0 / 1000';
          return openThread(d.with.uid, true);
        }).catch(function (err) { window.alert(err.message); }).then(function () { send.disabled = false; });
      });
      threadCol.appendChild(form);
    }

    function openThread(uid, keepFocus) {
      openWith = uid;
      return api('thread', { with: uid }, getToken).then(function (d) {
        renderThread(d);
        if (keepFocus) { var t = threadCol.querySelector('textarea'); if (t) t.focus(); }
        return loadList();
      }).catch(function (err) { threadCol.innerHTML = ''; threadCol.appendChild(el('div', 'msg-thread-empty', err.message)); });
    }

    function tick() {
      if (!container.offsetParent) return; // not on screen
      loadList();
      if (openWith) {
        api('thread', { with: openWith }, getToken).then(function (d) {
          var log = threadCol.querySelector('.msg-log');
          if (log && log.children.length !== d.messages.length) renderThread(d);
        }).catch(function () { /* keep what is on screen */ });
      }
    }

    showEmptyThread();
    loadList();
    timer = setInterval(tick, 15000);
    return { refresh: loadList, open: openThread, stop: function () { clearInterval(timer); } };
  }

  // The little unread counter, for the buttons that open Messages.
  function pollUnread(getToken, cb) {
    function go() { api('unread', {}, getToken).then(function (d) { cb(d.unread || 0); }).catch(function () { /* quiet */ }); }
    go();
    return setInterval(go, 60000);
  }

  // ------------------------------------------------------------------ "Message <name>" on a GM's profile page
  function openCompose(o) {
    var back = el('div', 'msg-modal');
    var box = el('form', 'msg-modal-box');
    box.appendChild(el('h3', null, 'Message ' + o.name));
    box.appendChild(el('p', 'msg-modal-help', 'Your message goes straight to ' + o.name + '. Their reply will be waiting in Messages on your profile, and we will email you too.'));
    var ta = el('textarea'); ta.rows = 5; ta.maxLength = 1000; ta.placeholder = 'Hi ' + o.name + '! I would like to ask about...';
    box.appendChild(ta);
    var status = el('p', 'msg-modal-status');
    box.appendChild(status);
    var row = el('div', 'msg-modal-btns');
    var cancel = el('button', 'gm-pill', 'Cancel'); cancel.type = 'button';
    var send = el('button', 'btn btn-primary', 'Send message'); send.type = 'submit';
    row.append(cancel, send);
    box.appendChild(row);
    back.appendChild(box);
    document.body.appendChild(back);
    document.body.classList.add('msg-modal-open');
    ta.focus();
    function close() { document.body.classList.remove('msg-modal-open'); back.remove(); }
    cancel.addEventListener('click', close);
    back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
    box.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = ta.value.trim();
      if (!text) { status.textContent = 'Please write a message first.'; return; }
      send.disabled = true; status.textContent = 'Sending...';
      api('send', { toSlug: o.toSlug, text: text }, o.getToken).then(function () {
        box.innerHTML = '';
        box.appendChild(el('h3', null, 'Sent!'));
        box.appendChild(el('p', 'msg-modal-help', 'Your message is on its way to ' + o.name + '. You will find the conversation in Messages on your profile.'));
        var go = el('a', 'btn btn-primary', 'Open my messages'); go.href = 'profile.html#me-messages';
        var ok = el('button', 'gm-pill', 'Close'); ok.type = 'button'; ok.addEventListener('click', close);
        var r2 = el('div', 'msg-modal-btns'); r2.append(ok, go); box.appendChild(r2);
      }).catch(function (err) { status.textContent = err.message; send.disabled = false; });
    });
  }

  window.Messages = { mount: mount, pollUnread: pollUnread, openCompose: openCompose, preview: preview };

  // The "Message <name>" button on a Game Master's profile page.
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.js-message-gm');
    if (!btn) return;
    var user = window.firebase && firebase.auth && firebase.auth().currentUser;
    if (!user && !preview) {
      var login = document.querySelector('.nav-login');
      if (login) login.click(); else window.alert('Please log in to send a message.');
      return;
    }
    openCompose({ toSlug: btn.dataset.slug, name: btn.dataset.name || 'this GM', getToken: function () { return user.getIdToken(); } });
  });
})();
