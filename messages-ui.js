// In-site messages, version 2: a search-and-filter conversation list, a chat that keeps what you are
// typing when new messages arrive, and the small "Chat with <name>" window.
// On your own computer (localhost with ?preview=1 in the address) it runs on made-up people and
// keeps everything in this browser only, so nothing on the live site is touched.
(function () {
  var WORKER = 'https://ash-tabletop-announcements.ash-tabletop.workers.dev';
  var local = ['localhost', '127.0.0.1'].indexOf(window.location.hostname) !== -1;
  var pv = new URLSearchParams(window.location.search).get('preview');
  var preview = local && (pv === '1' || pv === 'games');
  var EMOJI = { dragon: '🐉', wizard: '🧙', dagger: '🗡️', elf: '🧝', bat: '🦇', dice: '🎲' };
  var MAX_IMAGE_CHARS = 300000; // keep in step with MAX_IMAGE_CHARS in worker/src/messages.js
  var MAX_IMAGE_SIDE = 1400;

  // Shrinks a picture to a small JPEG data URI before it ever leaves the browser, so chat
  // stays fast and nobody can post a multi-megabyte photo straight into the database.
  function resizeImage(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Could not read that picture.')); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('That does not look like a picture.')); };
        img.onload = function () {
          var w = img.naturalWidth, h = img.naturalHeight;
          if (w > MAX_IMAGE_SIDE || h > MAX_IMAGE_SIDE) {
            if (w >= h) { h = Math.round(h * MAX_IMAGE_SIDE / w); w = MAX_IMAGE_SIDE; }
            else { w = Math.round(w * MAX_IMAGE_SIDE / h); h = MAX_IMAGE_SIDE; }
          }
          var canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); // JPEG has no transparency; flatten onto white, not black
          ctx.drawImage(img, 0, 0, w, h);
          var quality = 0.85, uri = canvas.toDataURL('image/jpeg', quality);
          while (uri.length > MAX_IMAGE_CHARS && quality > 0.3) { quality -= 0.1; uri = canvas.toDataURL('image/jpeg', quality); }
          if (uri.length > MAX_IMAGE_CHARS) { reject(new Error('That picture is too large, even resized. Please try a smaller one.')); return; }
          resolve(uri);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // ------------------------------------------------------------------ made-up data for the local preview
  var KEY = 'msgPreviewV2';
  function previewData() {
    var d = null;
    try { d = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { d = null; }
    if (d) return d;
    var now = Date.now(), m = 60000, h = 3600000, day = 86400000;
    d = {
      people: {
        mira: { uid: 'mira', name: 'Mira Stonefield', token: 'elf', avatarUrl: null, isGm: false, slug: null, context: 'Curse of Strahd, Group A' },
        tobias: { uid: 'tobias', name: 'Tobias Reed', token: 'dragon', avatarUrl: null, isGm: false, slug: null, context: 'The Prophecy of the Flying City' },
        june: { uid: 'june', name: 'June Calloway', token: 'bat', avatarUrl: null, isGm: false, slug: null, context: 'New player, asking about Crooked Moon' },
        priya: { uid: 'priya', name: 'Priya Nandakumar', token: 'wizard', avatarUrl: null, isGm: false, slug: null, context: 'The Crooked Moon, Group B' },
        vex: { uid: 'vex', name: 'Captain Vex', token: 'dagger', avatarUrl: null, isGm: true, slug: 'vex', context: '' },
        dax: { uid: 'dax', name: 'Dax Orrin', token: 'dice', avatarUrl: null, isGm: false, slug: null, context: 'Ravenloft: Undead Survival' }
      },
      msgs: [
        { id: 1, other: 'mira', mine: false, text: "Hi Ash! I just joined Curse of Strahd and I'm a little nervous because I have never played D&D.", at: now - day - 3 * h, read: true },
        { id: 2, other: 'mira', mine: false, text: 'Is there anything I should prepare before Session Zero?', at: now - day - 3 * h + m, read: true },
        { id: 3, other: 'mira', mine: true, text: "Welcome Mira! Nothing to prepare, I'll help you build your character in Session Zero.", at: now - day - 2 * h, read: true },
        { id: 4, other: 'mira', mine: true, text: 'Just bring yourself and a few ideas for who you would like to be.', at: now - day - 2 * h + m, read: true },
        { id: 5, other: 'mira', mine: false, text: 'That makes me feel so much better, thank you!! See you Friday.', at: now - 14 * m, read: false },
        { id: 6, other: 'mira', mine: false, text: 'One more thing: do I need to have a Discord account already?', at: now - 12 * m, read: false },
        { id: 7, other: 'tobias', mine: false, text: 'Can I skip this week and come back next Monday? Something came up at work.', at: now - 5 * h, read: false },
        { id: 8, other: 'june', mine: false, text: 'Hello, do you have any open seats in the Crooked Moon group on Saturdays?', at: now - 26 * h, read: true },
        { id: 9, other: 'june', mine: true, text: 'Hi June! Yes, Group C has room. You can join from the campaign page.', at: now - 25 * h, read: true },
        { id: 10, other: 'priya', mine: true, text: 'Thanks for joining my game! Do you have Discord? Here is mine: ash_gm', at: now - 2 * day, read: true },
        { id: 11, other: 'priya', mine: false, text: 'Yep! Added you. See you Saturday.', at: now - 2 * day + 4 * m, read: true },
        { id: 12, other: 'vex', mine: false, text: 'Welcome to the platform! Let me know if you need anything for your first game.', at: now - 4 * day, read: true },
        { id: 13, other: 'dax', mine: false, text: 'Running ten minutes late tonight, start without me.', at: now - 9 * day, read: true },
        { id: 14, other: 'dax', mine: true, text: 'No problem, we will wait for you.', at: now - 9 * day + 2 * m, read: true }
      ],
      next: 15
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
        var preview = last.text ? last.text.slice(0, 120) : (last.image ? 'Photo' : '');
        return { with: d.people[o], preview: preview, mine: last.mine, at: new Date(last.at).toISOString(), unread: arr.filter(function (m) { return !m.mine && !m.read; }).length };
      }).sort(function (a, b) { return new Date(b.at) - new Date(a.at); });
      return { unread: convs.reduce(function (n, c) { return n + c.unread; }, 0), conversations: convs };
    },
    thread: function (x) {
      var d = previewData();
      d.msgs.forEach(function (m) { if (m.other === x.with && !m.mine) m.read = true; });
      savePreview(d);
      return { with: d.people[x.with], messages: d.msgs.filter(function (m) { return m.other === x.with; }).map(function (m) { return { id: m.id, mine: m.mine, text: m.text, image: m.image || null, read: m.mine ? !!m.read : true, at: new Date(m.at).toISOString() }; }) };
    },
    send: function (x) {
      var d = previewData(), to = x.toUid || 'vex';
      if (x.toSlug) to = 'vex';
      d.msgs.push({ id: d.next++, other: to, mine: true, text: String(x.text || '').slice(0, 1000), image: x.image || null, at: Date.now(), read: true });
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

  // ------------------------------------------------------------------ how times are written
  function sameDay(a, b) { return a.toDateString() === b.toDateString(); }
  function clock(d) { return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
  // In the list: a time today, "Yesterday", a weekday this week, otherwise a date.
  function rowTime(iso) {
    var d = new Date(iso), now = new Date();
    if (sameDay(d, now)) return clock(d);
    var y = new Date(now); y.setDate(now.getDate() - 1);
    if (sameDay(d, y)) return 'Yesterday';
    if (now - d < 6 * 86400000) return d.toLocaleDateString(undefined, { weekday: 'long' });
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function dayLabel(d) {
    var now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
    if (sameDay(d, now)) return 'Today';
    if (sameDay(d, y)) return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }
  function fullStamp(iso) { var d = new Date(iso); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + clock(d); }

  function avatar(person, cls) {
    var a = el('span', 'msg-avatar ' + (cls || ''));
    if (person && person.avatarUrl) { var img = document.createElement('img'); img.src = person.avatarUrl; img.alt = ''; a.appendChild(img); }
    else a.textContent = EMOJI[person && person.token] || EMOJI.wizard;
    return a;
  }

  // Full-size picture on top of everything, closed by clicking out or pressing Escape.
  function openImage(uri) {
    var back = el('div', 'msg-modal msg-img-modal');
    var img = document.createElement('img'); img.src = uri; img.alt = 'Picture';
    back.appendChild(img);
    document.body.appendChild(back);
    document.body.classList.add('msg-modal-open');
    function esc(e) { if (e.key === 'Escape') close(); }
    function close() { document.body.classList.remove('msg-modal-open'); back.remove(); document.removeEventListener('keydown', esc); }
    back.addEventListener('mousedown', function () { close(); });
    document.addEventListener('keydown', esc);
  }

  // ------------------------------------------------------------------ the Messages section
  function mount(container, opts) {
    opts = opts || {};
    var getToken = opts.getToken;
    var openWith = null, convs = [], timer = null, query = '', onlyUnread = false;
    var shownCount = -1, shownLastRead = null, shell = null;   // shell = the parts of the open chat that stay put while messages refresh

    container.innerHTML = '';
    container.classList.add('msg-root');
    var wrap = el('div', 'msg-wrap');
    var listCol = el('div', 'msg-list-col');

    var head = el('div', 'msg-list-head');
    var titleRow = el('div', 'msg-list-title');
    var unreadNote = el('span', 'msg-unread-note');
    titleRow.append(el('h2', null, 'Messages'), unreadNote);
    var search = el('input', 'msg-search'); search.type = 'search'; search.placeholder = 'Search people'; search.setAttribute('aria-label', 'Search people');
    var filters = el('div', 'msg-filters');
    var allBtn = el('button', 'msg-filter', 'All'), unreadBtn = el('button', 'msg-filter', 'Unread');
    allBtn.type = unreadBtn.type = 'button';
    filters.append(allBtn, unreadBtn);
    head.append(titleRow, search, filters);
    listCol.appendChild(head);
    var list = el('div', 'msg-list');
    listCol.appendChild(list);
    var threadCol = el('div', 'msg-thread-col');
    wrap.append(listCol, threadCol);
    container.appendChild(wrap);

    function setUnread(n) { unreadNote.textContent = n ? n + ' unread' : ''; if (opts.onUnread) opts.onUnread(n); }
    function syncFilters() { allBtn.setAttribute('aria-pressed', String(!onlyUnread)); unreadBtn.setAttribute('aria-pressed', String(onlyUnread)); }
    syncFilters();
    allBtn.addEventListener('click', function () { onlyUnread = false; syncFilters(); renderList(); });
    unreadBtn.addEventListener('click', function () { onlyUnread = true; syncFilters(); renderList(); });
    search.addEventListener('input', function () { query = search.value.trim().toLowerCase(); renderList(); });

    function message(strong, more) {
      var e = el('div', 'msg-empty');
      e.appendChild(el('strong', null, strong));
      if (more) e.appendChild(el('span', null, more));
      return e;
    }

    function renderList() {
      list.innerHTML = '';
      if (!convs.length) { list.appendChild(message('No messages yet', 'When someone writes to you, their message shows up here.')); return; }
      var shown = convs.filter(function (c) {
        return (!onlyUnread || c.unread) && (!query || c.with.name.toLowerCase().indexOf(query) !== -1);
      });
      if (!shown.length) { list.appendChild(message(onlyUnread && !query ? 'Nothing unread' : 'No one matches that', onlyUnread && !query ? 'You are all caught up.' : 'Try a different name.')); return; }
      shown.forEach(function (c) {
        var row = el('button', 'msg-row' + (openWith === c.with.uid ? ' active' : '') + (c.unread ? ' unread' : ''));
        row.type = 'button';
        if (openWith === c.with.uid) row.setAttribute('aria-current', 'true');
        row.appendChild(avatar(c.with));
        var mid = el('span', 'msg-row-mid');
        var top = el('span', 'msg-row-top');
        top.appendChild(el('b', null, c.with.name));
        if (c.with.isGm) top.appendChild(el('i', 'msg-gm', 'GM'));
        top.appendChild(el('span', 'msg-time', rowTime(c.at)));
        var bot = el('span', 'msg-row-bot');
        bot.appendChild(el('span', 'msg-snippet', (c.mine ? 'You: ' : '') + c.preview));
        if (c.unread) bot.appendChild(el('span', 'msg-badge', String(c.unread)));
        mid.append(top, bot);
        row.appendChild(mid);
        row.addEventListener('click', function () { openThread(c.with.uid); });
        list.appendChild(row);
      });
    }

    function loadList() {
      return api('list', {}, getToken).then(function (d) {
        convs = d.conversations || [];
        setUnread(d.unread || 0);
        renderList();
      }).catch(function (err) { list.innerHTML = ''; list.appendChild(message('Could not load messages', err.message)); });
    }

    function showEmptyThread() {
      threadCol.innerHTML = '';
      shell = null; shownCount = -1; shownLastRead = null;
      wrap.classList.remove('thread-open');
      var e = el('div', 'msg-thread-empty');
      e.appendChild(el('strong', null, 'Select a conversation'));
      e.appendChild(el('span', null, 'Pick someone from the list to read and reply.'));
      threadCol.appendChild(e);
    }

    // Builds the chat frame once per person: header, empty log, and the typing box.
    function buildShell(person) {
      threadCol.innerHTML = '';
      wrap.classList.add('thread-open');
      var headEl = el('div', 'msg-thread-head');
      var back = el('button', 'msg-back', '‹ Messages'); back.type = 'button';
      back.addEventListener('click', function () { openWith = null; renderList(); showEmptyThread(); });
      headEl.append(back, avatar(person, 'lg'));
      var who = el('div', 'msg-who');
      who.appendChild(el('b', null, person.name));
      var sub = (person.isGm ? 'Game Master' : 'Player') + (person.context ? ' · ' + person.context : '');
      who.appendChild(el('span', null, sub));
      headEl.appendChild(who);
      if (person.slug === 'ash') { var pl = el('a', 'msg-link', 'View profile'); pl.href = 'ash.html'; headEl.appendChild(pl); }
      var rep = el('button', 'msg-report', 'Report'); rep.type = 'button';
      rep.title = 'Send this conversation to Ash if something is wrong';
      rep.addEventListener('click', function () {
        if (!window.confirm('Report this conversation to Ash? The last few messages will be sent to her.')) return;
        api('report', { with: person.uid }, getToken).then(function () { window.alert('Thank you. Ash has been told.'); }).catch(function (e) { window.alert(e.message); });
      });
      headEl.appendChild(rep);

      var log = el('div', 'msg-log');
      var col = el('div', 'msg-col');
      log.appendChild(col);

      var pendingImage = null;
      var form = el('form', 'msg-compose');
      var imgPreview = el('div', 'msg-img-preview'); imgPreview.hidden = true;
      var imgPreviewThumb = document.createElement('img'); imgPreviewThumb.alt = '';
      var imgRemove = el('button', 'msg-img-remove', '✕'); imgRemove.type = 'button'; imgRemove.title = 'Remove picture';
      imgPreview.append(imgPreviewThumb, imgRemove);
      form.appendChild(imgPreview);
      var inner = el('div', 'msg-compose-in');
      var fileInput = el('input'); fileInput.type = 'file'; fileInput.accept = 'image/*'; fileInput.hidden = true;
      var imgBtn = el('button', 'msg-img-btn', '📷'); imgBtn.type = 'button'; imgBtn.title = 'Attach a picture';
      var ta = el('textarea'); ta.rows = 1; ta.maxLength = 1000; ta.placeholder = 'Write to ' + person.name.split(' ')[0] + '...';
      var send = el('button', 'msg-send', 'Send'); send.type = 'submit'; send.disabled = true;
      var note = el('div', 'msg-compose-note');
      var hint = el('span', null, 'Enter to send, Shift+Enter for a new line');
      var count = el('span', 'msg-count');
      note.append(hint, count);
      inner.append(imgBtn, fileInput, ta, send, note);
      form.appendChild(inner);
      function sync() {
        send.disabled = !ta.value.trim() && !pendingImage;
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 150) + 'px';
        count.textContent = ta.value.length > 800 ? ta.value.length + ' / 1000' : '';
      }
      function clearImage() { pendingImage = null; imgPreviewThumb.src = ''; imgPreview.hidden = true; sync(); }
      imgRemove.addEventListener('click', clearImage);
      imgBtn.addEventListener('click', function () { fileInput.click(); });
      fileInput.addEventListener('change', function () {
        var file = fileInput.files && fileInput.files[0];
        fileInput.value = '';
        if (!file) return;
        if (file.type.indexOf('image/') !== 0) { window.alert('Please choose a picture file.'); return; }
        imgBtn.disabled = true;
        resizeImage(file).then(function (uri) {
          pendingImage = uri;
          imgPreviewThumb.src = uri;
          imgPreview.hidden = false;
          sync();
        }).catch(function (err) { window.alert(err.message); }).then(function () { imgBtn.disabled = false; });
      });
      ta.addEventListener('input', sync);
      ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var text = ta.value.trim();
        if (!text && !pendingImage) return;
        send.disabled = true;
        var payload = { toUid: person.uid, text: text };
        if (pendingImage) payload.image = pendingImage;
        api('send', payload, getToken).then(function () {
          ta.value = ''; clearImage();
          return openThread(person.uid, true);
        }).catch(function (err) { window.alert(err.message); send.disabled = !ta.value.trim() && !pendingImage; });
      });

      threadCol.append(headEl, log, form);
      shell = { uid: person.uid, log: log, col: col, ta: ta };
    }

    // Fills the log: day labels, and runs of messages from the same person within a few minutes of each other.
    function paintLog(d) {
      var log = shell.log, col = shell.col;
      var nearBottom = shownCount < 0 || log.scrollHeight - log.scrollTop - log.clientHeight < 80;
      col.innerHTML = '';
      var run = null, runMine = null, runLast = null, prevDay = null;
      function endRun() { if (run) run.appendChild(el('time', 'msg-t', clock(runLast))); run = null; }
      d.messages.forEach(function (m) {
        var at = new Date(m.at);
        if (!prevDay || !sameDay(at, prevDay)) { endRun(); col.appendChild(el('div', 'msg-day', dayLabel(at))); }
        if (!run || runMine !== m.mine || at - runLast > 5 * 60000 || !sameDay(at, prevDay)) {
          endRun();
          run = el('div', 'msg-run ' + (m.mine ? 'mine' : 'theirs')); runMine = m.mine;
          col.appendChild(run);
        }
        var b = el('div', 'msg-b'); b.title = fullStamp(m.at);
        if (m.image) {
          b.classList.add('has-image');
          var img = document.createElement('img'); img.className = 'msg-img'; img.src = m.image; img.alt = 'Picture';
          img.addEventListener('click', function () { openImage(m.image); });
          b.appendChild(img);
          if (m.text) b.appendChild(el('div', 'msg-b-text', m.text));
        } else {
          b.textContent = m.text;
        }
        run.appendChild(b);
        runLast = at; prevDay = at;
      });
      endRun();
      var lastMsg = d.messages.length ? d.messages[d.messages.length - 1] : null;
      if (lastMsg && lastMsg.mine) col.appendChild(el('div', 'msg-seen', lastMsg.read ? 'Seen' : 'Sent'));
      shownCount = d.messages.length;
      shownLastRead = lastMsg ? !!lastMsg.read : null;
      if (nearBottom) log.scrollTop = log.scrollHeight;
    }

    function openThread(uid, keepFocus) {
      openWith = uid;
      return api('thread', { with: uid }, getToken).then(function (d) {
        if (!shell || shell.uid !== uid) buildShell(d.with);
        paintLog(d);
        if (keepFocus || !('ontouchstart' in window)) shell.ta.focus();
        return loadList();
      }).catch(function (err) { threadCol.innerHTML = ''; shell = null; threadCol.appendChild(el('div', 'msg-thread-empty', err.message)); });
    }

    function tick() {
      if (!container.offsetParent) return; // not on screen
      loadList();
      if (openWith && shell) {
        api('thread', { with: openWith }, getToken).then(function (d) {
          if (!shell || shell.uid !== openWith) return;
          var lastRead = d.messages.length ? !!d.messages[d.messages.length - 1].read : null;
          if (d.messages.length !== shownCount || lastRead !== shownLastRead) paintLog(d);
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

  // ------------------------------------------------------------------ "Chat with <name>": a GM's profile page
  // (toSlug) for a player writing to them, or a GM's own player roster (toUid) for the reverse.
  function openCompose(o) {
    var back = el('div', 'msg-modal');
    var box = el('form', 'msg-modal-box');
    box.appendChild(el('h3', null, 'Chat with ' + o.name));
    box.appendChild(el('p', 'msg-modal-help', 'Your message goes straight to ' + o.name + '. Their reply will show up in your Messages, and we will email you too.'));
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
    document.addEventListener('keydown', function esc(e) { if (!back.isConnected) { document.removeEventListener('keydown', esc); return; } if (e.key === 'Escape') close(); });
    box.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = ta.value.trim();
      if (!text) { status.textContent = 'Write a message first.'; return; }
      send.disabled = true; status.textContent = 'Sending...';
      var payload = o.toUid ? { toUid: o.toUid, text: text } : { toSlug: o.toSlug, text: text };
      api('send', payload, o.getToken).then(function () {
        box.innerHTML = '';
        box.appendChild(el('h3', null, 'Sent'));
        box.appendChild(el('p', 'msg-modal-help', 'Your message is on its way to ' + o.name + '.'));
        var go = el('a', 'btn btn-primary', o.backLabel || 'Open my messages'); go.href = o.backHref || 'profile.html#me-messages';
        // A link back to the page you are already on only changes the address bar, so the button looks dead and the
        // box stays open. When the page can open Messages itself, close this box and do that instead.
        if (o.onOpen) go.addEventListener('click', function (e) { e.preventDefault(); close(); o.onOpen(); });
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
