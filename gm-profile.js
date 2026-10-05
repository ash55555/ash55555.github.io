// The GM profile editor. Everything on the profile page can be changed here.
(function () {
  var C = window.GmCatalog;
  var Store = window.GmStore;
  var MAX_QUALITIES = 4;
  var MAX_QUESTIONS = 3;
  var p = null;       // the profile being edited
  var getToken = function () { return Promise.reject(new Error('Please sign in again.')); };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function status(msg, kind) { var s = $('gm-status'); s.textContent = msg || ''; s.className = 'gm-status' + (kind ? ' ' + kind : ''); }

  // ------------------------------------------------------------------ pictures
  function pictureFromFile(file, w, h, quality) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type)) { reject(new Error('Please choose a picture file.')); return; }
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext('2d');
        // "cover": fill the frame and trim the edges that do not fit
        var scale = Math.max(w / img.width, h / img.height);
        var sw = w / scale, sh = h / scale;
        ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That picture could not be opened.')); };
      img.src = url;
    });
  }
  function paintPictures() {
    var av = $('gm-avatar-preview');
    if (/^data:image\//.test(p.avatar || '')) { av.style.backgroundImage = 'url("' + p.avatar + '")'; av.textContent = ''; }
    else { av.style.backgroundImage = ''; av.textContent = '🧙'; }
    var bn = $('gm-banner-preview');
    var has = /^data:image\//.test(p.banner || '');
    bn.classList.toggle('has-img', has);
    bn.style.backgroundImage = has ? 'url("' + p.banner + '")' : '';
    $('gm-banner-remove').hidden = !has;
    $('gm-banner-btn').textContent = has ? 'Change banner' : 'Add a banner';
  }

  // ------------------------------------------------------------------ tools
  function renderTools() {
    var box = $('gm-tools');
    box.innerHTML = '';
    var all = C.TOOLS.slice();
    (p.tools || []).forEach(function (t) { if (all.indexOf(t) === -1) all.push(t); });
    all.forEach(function (t) {
      var b = el('button', 'gm-chip' + (p.tools.indexOf(t) !== -1 ? ' on' : ''), t);
      b.type = 'button';
      b.addEventListener('click', function () {
        var i = p.tools.indexOf(t);
        if (i === -1) p.tools.push(t); else p.tools.splice(i, 1);
        renderTools();
      });
      box.appendChild(b);
    });
  }

  // ------------------------------------------------------------------ qualities
  function renderQualities() {
    var sel = $('gm-quality-select');
    sel.innerHTML = '';
    var first = el('option', null, p.qualities.length >= MAX_QUALITIES ? 'You have picked four' : 'Choose a quality...');
    first.value = '';
    sel.appendChild(first);
    C.QUALITIES.forEach(function (q) {
      if (p.qualities.indexOf(q.id) !== -1) return;
      var o = el('option', null, q.emoji + '  ' + q.label);
      o.value = q.id;
      sel.appendChild(o);
    });
    var full = p.qualities.length >= MAX_QUALITIES;
    sel.disabled = full;
    $('gm-quality-add').disabled = full;
    $('gm-quality-count').textContent = p.qualities.length + ' / ' + MAX_QUALITIES;
    var ul = $('gm-quality-list');
    ul.innerHTML = '';
    if (!p.qualities.length) ul.appendChild(el('li', 'gm-empty', 'Nothing picked yet.'));
    p.qualities.forEach(function (id) {
      var q = C.quality(id);
      if (!q) return;
      var li = el('li', null, q.emoji + ' ' + q.label);
      var x = el('button', null, '×');
      x.type = 'button';
      x.setAttribute('aria-label', 'Remove ' + q.label);
      x.addEventListener('click', function () { p.qualities = p.qualities.filter(function (k) { return k !== id; }); renderQualities(); });
      li.appendChild(x);
      ul.appendChild(li);
    });
  }

  // ------------------------------------------------------------------ questions
  function renderQuestions() {
    var box = $('gm-questions');
    box.innerHTML = '';
    var slots = [];
    for (var i = 0; i < MAX_QUESTIONS; i++) slots.push(p.questions[i] || { id: '', answer: '' });
    p.questions = slots;
    slots.forEach(function (slot, i) {
      var taken = slots.map(function (s, j) { return j !== i ? s.id : ''; });
      var wrap = el('div', 'gm-q');
      wrap.appendChild(el('span', 'gm-q-label', 'Question ' + (i + 1)));
      var sel = el('select');
      var none = el('option', null, 'Choose a question...');
      none.value = '';
      sel.appendChild(none);
      C.QUESTIONS.forEach(function (q) {
        if (taken.indexOf(q.id) !== -1) return;
        var o = el('option', null, q.title);
        o.value = q.id;
        if (q.id === slot.id) o.selected = true;
        sel.appendChild(o);
      });
      wrap.appendChild(sel);
      var q = C.question(slot.id);
      if (q) {
        wrap.appendChild(el('p', 'gm-q-hint', '(' + q.hint + ')'));
        var ta = el('textarea');
        ta.rows = 4; ta.maxLength = 700; ta.placeholder = q.placeholder; ta.value = slot.answer || '';
        ta.addEventListener('input', function () { slot.answer = ta.value; });
        wrap.appendChild(ta);
      }
      sel.addEventListener('change', function () { slot.id = sel.value; if (!sel.value) slot.answer = ''; renderQuestions(); });
      box.appendChild(wrap);
    });
  }

  // ------------------------------------------------------------------ social links
  function renderSocials() {
    var box = $('gm-socials');
    box.innerHTML = '';
    C.SOCIALS.forEach(function (s) {
      var row = el('label', 'gm-social');
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.innerHTML = C.ICONS[s.id];
      var input = el('input');
      input.type = 'url'; input.placeholder = s.label + ': ' + s.placeholder;
      input.value = (p.socials && p.socials[s.id]) || '';
      input.addEventListener('input', function () { p.socials[s.id] = input.value.trim(); });
      row.append(svg, input);
      box.appendChild(row);
    });
  }

  // ------------------------------------------------------------------ the whole form
  function fill() {
    p.tools = p.tools || []; p.qualities = p.qualities || []; p.questions = p.questions || []; p.socials = p.socials || {};
    $('gm-name').value = p.name || '';
    $('gm-pronouns').value = p.pronouns || '';
    $('gm-tagline').value = p.tagline || '';
    $('gm-bio').value = p.bio || '';
    $('gm-bio-count').textContent = (p.bio || '').length + ' / 900';
    $('gm-discord').value = p.discord || '';
    paintPictures();
    renderTools();
    renderQualities();
    renderQuestions();
    renderSocials();
  }

  function collect() {
    p.name = $('gm-name').value.trim();
    p.pronouns = $('gm-pronouns').value.trim();
    p.tagline = $('gm-tagline').value.trim();
    p.bio = $('gm-bio').value.trim();
    p.discord = $('gm-discord').value.trim();
    var out = clone(p);
    out.questions = out.questions.filter(function (q) { return q.id && String(q.answer || '').trim(); }).map(function (q) { return { id: q.id, answer: String(q.answer).trim() }; });
    Object.keys(out.socials).forEach(function (k) { if (!window.GmRender.safeUrl(out.socials[k])) delete out.socials[k]; });
    return out;
  }

  function bind() {
    $('gm-bio').addEventListener('input', function () { $('gm-bio-count').textContent = $('gm-bio').value.length + ' / 900'; });
    $('gm-avatar-btn').addEventListener('click', function () { $('gm-avatar-file').click(); });
    $('gm-banner-btn').addEventListener('click', function () { $('gm-banner-file').click(); });
    $('gm-banner-remove').addEventListener('click', function () { p.banner = ''; paintPictures(); });
    $('gm-avatar-file').addEventListener('change', function (e) {
      pictureFromFile(e.target.files[0], 320, 320, 0.85).then(function (d) { p.avatar = d; paintPictures(); status('', ''); })
        .catch(function (err) { status(err.message, 'err'); });
      e.target.value = '';
    });
    $('gm-banner-file').addEventListener('change', function (e) {
      pictureFromFile(e.target.files[0], 1400, 400, 0.8).then(function (d) { p.banner = d; paintPictures(); status('', ''); })
        .catch(function (err) { status(err.message, 'err'); });
      e.target.value = '';
    });
    $('gm-tool-add').addEventListener('click', function () {
      var v = $('gm-tool-custom').value.trim().slice(0, 30);
      if (v && p.tools.indexOf(v) === -1) p.tools.push(v);
      $('gm-tool-custom').value = '';
      renderTools();
    });
    $('gm-tool-custom').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('gm-tool-add').click(); } });
    $('gm-quality-add').addEventListener('click', function () {
      var v = $('gm-quality-select').value;
      if (v && p.qualities.length < MAX_QUALITIES && p.qualities.indexOf(v) === -1) p.qualities.push(v);
      renderQualities();
    });
    $('gm-save').addEventListener('click', function () {
      var out = collect();
      if (!out.name) { status('Please add your name first.', 'err'); $('gm-name').focus(); return; }
      var btn = $('gm-save');
      btn.disabled = true;
      status('Saving...', '');
      Store.save(out, getToken).then(function () {
        status("Saved! That's it. Your page is up to date.", 'ok');
      }).catch(function (err) { status(err.message, 'err'); }).then(function () { btn.disabled = false; });
    });
  }

  function open(profile) {
    p = clone(profile);
    $('gm-gate').hidden = true;
    $('gm-editor').hidden = false;
    $('gm-preview-note').hidden = !Store.preview;
    $('gm-view').href = 'ash.html' + (Store.preview ? '?preview=1' : '');
    fill();
  }
  function gate(text) {
    $('gm-editor').hidden = true;
    $('gm-gate').hidden = false;
    $('gm-gate-text').textContent = text;
  }

  bind();
  if (Store.preview) {
    Store.loadMine().then(function (r) { open(r.profile); });
    return;
  }
  if (typeof firebase === 'undefined' || !firebase.auth) { gate('Please sign in to edit your GM profile.'); return; }
  firebase.auth().onAuthStateChanged(function (user) {
    if (!user) { gate('Please sign in to edit your GM profile.'); return; }
    getToken = function () { return user.getIdToken(); };
    Store.loadMine(getToken).then(function (r) {
      if (!r.isGm) { gate('GM profiles are for Game Masters. If you would like to host games here, message Ash.'); return; }
      open(r.profile || (r.isAdmin ? C.ASH_DEFAULT : { name: r.name || '', pronouns: '', tagline: '', tools: [], bio: '', qualities: [], questions: [], socials: {}, discord: '', avatar: '', banner: '' }));
    }).catch(function (err) { gate(err.message); });
  });
})();
