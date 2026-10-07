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
  // keepAlpha keeps transparent parts transparent (round artwork stays round, no black corners).
  function pictureFromFile(file, w, h, quality, keepAlpha) {
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
        var alpha = keepAlpha ? canvas.toDataURL('image/webp', quality) : '';
        resolve(alpha.indexOf('data:image/webp') === 0 ? alpha : canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That picture could not be opened.')); };
      img.src = url;
    });
  }
  function paintPictures() {
    var av = $('gm-avatar-preview');
    var emoji = av.querySelector('.gm-emoji');
    if (/^(data:image\/|medie\/)/.test(p.avatar || '')) { av.style.backgroundImage = 'url("' + p.avatar + '")'; if (emoji) emoji.hidden = true; }
    else { av.style.backgroundImage = ''; if (emoji) emoji.hidden = false; }
    var bn = $('gm-banner-preview');
    var has = /^data:image\//.test(p.banner || '');
    bn.classList.toggle('has-img', has);
    bn.style.backgroundImage = has ? 'url("' + p.banner + '")' : '';
    $('gm-banner-remove').hidden = !has;
  }

  // ------------------------------------------------------------------ hover to change + the adjust window
  var CAMERA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H8l1.2-2h5.6L16 6h1.5A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="12.6" r="3.3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';

  function makeClickable(box, label, fileInput) {
    var hover = el('span', 'gm-hover');
    hover.innerHTML = CAMERA;
    hover.appendChild(el('b', null, label));
    box.appendChild(hover);
    box.setAttribute('role', 'button');
    box.tabIndex = 0;
    box.setAttribute('aria-label', label);
    box.addEventListener('click', function () { fileInput.click(); });
    box.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  }

  // Lets the GM move and zoom a picture inside a frame that shows exactly what will be kept.
  // kind: 'avatar' (round frame) or 'banner' (wide frame). Resolves to the saved picture, or null if cancelled.
  function adjustPicture(file, kind) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type)) { reject(new Error('Please choose a picture file.')); return; }
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That picture could not be opened.')); };
      img.onload = function () {
        var round = kind === 'avatar';
        var OUT = round ? { w: 320, h: 320 } : { w: 1400, h: 400 };
        var FRAME = round ? { w: 280, h: 280 } : { w: 560, h: 160 };
        var STAGE = round ? { w: 380, h: 380 } : { w: 660, h: 270 };
        var cover = Math.max(FRAME.w / img.width, FRAME.h / img.height);
        var minScale = cover * 0.3, maxScale = cover * 5;
        var scale = cover, ox = 0, oy = 0; // ox, oy: picture centre, measured from the frame centre

        var back = el('div', 'gm-modal');
        var box = el('div', 'gm-modal-box');
        box.appendChild(el('h3', null, round ? 'Adjust your profile picture' : 'Adjust your banner'));
        box.appendChild(el('p', 'gm-modal-help', 'Drag the picture to move it. Use the slider or your mouse wheel to zoom. The bright area is what people will see.'));
        var stage = el('div', 'gm-stage');
        stage.style.width = STAGE.w + 'px'; stage.style.height = STAGE.h + 'px';
        var pic = document.createElement('img');
        pic.src = url; pic.alt = ''; pic.draggable = false;
        var frame = el('div', 'gm-frame' + (round ? ' round' : ''));
        frame.style.width = FRAME.w + 'px'; frame.style.height = FRAME.h + 'px';
        stage.append(pic, frame);
        box.appendChild(stage);

        var ctl = el('div', 'gm-zoom');
        var minus = el('button', 'gm-pill', '\u2212'); minus.type = 'button';
        var plus = el('button', 'gm-pill', '+'); plus.type = 'button';
        var range = el('input'); range.type = 'range'; range.min = 0; range.max = 100; range.step = 0.5;
        ctl.append(minus, range, plus);
        box.appendChild(ctl);

        var row = el('div', 'gm-modal-btns');
        var reset = el('button', 'gm-pill gm-pill-quiet', 'Reset'); reset.type = 'button';
        var cancel = el('button', 'gm-pill', 'Cancel'); cancel.type = 'button';
        var ok = el('button', 'btn btn-primary', 'Use this picture'); ok.type = 'button';
        row.append(reset, cancel, ok);
        box.appendChild(row);
        back.appendChild(box);
        document.body.appendChild(back);
        document.body.classList.add('gm-modal-open');

        function toSlider() { return 100 * Math.log(scale / minScale) / Math.log(maxScale / minScale); }
        function fromSlider(v) { return minScale * Math.pow(maxScale / minScale, v / 100); }
        function draw() {
          range.value = toSlider();
          pic.style.width = img.width * scale + 'px';
          pic.style.height = img.height * scale + 'px';
          pic.style.left = (STAGE.w / 2 + ox - img.width * scale / 2) + 'px';
          pic.style.top = (STAGE.h / 2 + oy - img.height * scale / 2) + 'px';
        }
        function zoom(next) {
          next = Math.min(maxScale, Math.max(minScale, next));
          var k = next / scale; // zoom around the frame centre
          ox *= k; oy *= k; scale = next; draw();
        }
        function close(result) {
          document.removeEventListener('keydown', onKey);
          document.body.classList.remove('gm-modal-open');
          back.remove(); URL.revokeObjectURL(url); resolve(result);
        }
        function onKey(e) { if (e.key === 'Escape') close(null); }
        document.addEventListener('keydown', onKey);

        var drag = null;
        stage.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, y: e.clientY, ox: ox, oy: oy }; stage.setPointerCapture(e.pointerId); stage.classList.add('dragging'); });
        stage.addEventListener('pointermove', function (e) { if (!drag) return; ox = drag.ox + e.clientX - drag.x; oy = drag.oy + e.clientY - drag.y; draw(); });
        function endDrag() { drag = null; stage.classList.remove('dragging'); }
        stage.addEventListener('pointerup', endDrag);
        stage.addEventListener('pointercancel', endDrag);
        stage.addEventListener('wheel', function (e) { e.preventDefault(); zoom(scale * (e.deltaY < 0 ? 1.08 : 1 / 1.08)); }, { passive: false });
        range.addEventListener('input', function () { zoom(fromSlider(parseFloat(range.value))); });
        minus.addEventListener('click', function () { zoom(scale / 1.15); });
        plus.addEventListener('click', function () { zoom(scale * 1.15); });
        reset.addEventListener('click', function () { scale = cover; ox = 0; oy = 0; draw(); });
        cancel.addEventListener('click', function () { close(null); });
        back.addEventListener('mousedown', function (e) { if (e.target === back) close(null); });
        ok.addEventListener('click', function () {
          // draw exactly what the frame shows, at the saved size
          var canvas = document.createElement('canvas');
          canvas.width = OUT.w; canvas.height = OUT.h;
          var ctx = canvas.getContext('2d');
          if (!round) { ctx.fillStyle = '#170e2b'; ctx.fillRect(0, 0, OUT.w, OUT.h); }
          var k = OUT.w / FRAME.w;
          ctx.drawImage(img, (FRAME.w / 2 + ox - img.width * scale / 2) * k, (FRAME.h / 2 + oy - img.height * scale / 2) * k, img.width * scale * k, img.height * scale * k);
          var data = round ? canvas.toDataURL('image/webp', 0.9) : canvas.toDataURL('image/jpeg', 0.82);
          if (round && data.indexOf('data:image/webp') !== 0) data = canvas.toDataURL('image/jpeg', 0.9);
          close(data);
        });
        draw();
      };
      img.src = url;
    });
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

  // Systems and languages work just like tools: click to switch on, or add your own.
  function renderPicks(key, boxId, catalog) {
    var box = $(boxId);
    box.innerHTML = '';
    var all = catalog.slice();
    (p[key] || []).forEach(function (t) { if (all.indexOf(t) === -1) all.push(t); });
    all.forEach(function (t) {
      var b = el('button', 'gm-chip' + (p[key].indexOf(t) !== -1 ? ' on' : ''), t);
      b.type = 'button';
      b.addEventListener('click', function () {
        var i = p[key].indexOf(t);
        if (i === -1) p[key].push(t); else p[key].splice(i, 1);
        renderPicks(key, boxId, catalog);
      });
      box.appendChild(b);
    });
  }
  function renderSystems() { renderPicks('systems', 'gm-systems', C.SYSTEMS); }
  function renderLanguages() { renderPicks('languages', 'gm-languages', C.LANGUAGES); }

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

  // ------------------------------------------------------------------ theme (colors and fonts)
  var GT = window.GmTheme;
  function th() { if (!p.theme) p.theme = GT.clean(null); return p.theme; }

  function paintThemePreview() {
    var t = th(), pv = $('gmt-preview');
    GT.applyTo(pv, t);
    $('gmt-pv-name').textContent = $('gm-name').value.trim() || p.name || 'Your name';
    $('gmt-pv-tag').textContent = $('gm-tagline').value.trim() || p.tagline || 'Your tagline goes here';
    var pic = function (v) { return /^(data:image|medie)/.test(v || '') ? 'url("' + v + '")' : ''; };
    pv.querySelector('.gmt-pv-avatar').style.backgroundImage = pic(p.avatar);
    pv.querySelector('.gmt-pv-cover').style.backgroundImage = pic(p.banner);
    ['bg', 'glowA', 'glowB', 'accent'].forEach(function (k) { $('gmt-' + k).value = t[k]; $('gmt-' + k + '-hex').textContent = t[k]; });
  }

  function setTheme(patch, keepPreset) {
    var t = th();
    Object.keys(patch).forEach(function (k) { t[k] = patch[k]; });
    if (!keepPreset) t.preset = 'custom';
    renderThemeControls();
    paintThemePreview();
  }

  function renderThemeControls() {
    var t = th();
    var box = $('gmt-presets');
    box.innerHTML = '';
    GT.PRESETS.forEach(function (pr) {
      var b = el('button', 'gmt-preset' + (t.preset === pr.id ? ' on' : ''));
      b.type = 'button';
      b.style.background = 'linear-gradient(135deg, ' + pr.bg + ' 0%, ' + pr.bg + ' 100%)';
      var sw = el('span', 'gmt-sw');
      [pr.glowA, pr.glowB, pr.accent].forEach(function (c) { var i = document.createElement('i'); i.style.background = c; sw.appendChild(i); });
      var label = el('span', 'gmt-pl', pr.label);
      label.style.color = GT.lum(pr.bg) > 0.45 ? '#231a33' : '#f3eefc';
      b.append(sw, label);
      b.addEventListener('click', function () { setTheme({ bg: pr.bg, glowA: pr.glowA, glowB: pr.glowB, accent: pr.accent, preset: pr.id }, true); });
      box.appendChild(b);
    });

    var fonts = $('gmt-name-fonts');
    fonts.innerHTML = '';
    var shown = $('gm-name').value.trim() || p.name || 'Your name';
    GT.FONTS.forEach(function (f) {
      var b = el('button', 'gmt-font' + (t.nameFont === f.id ? ' on' : ''));
      b.type = 'button';
      var sample = el('span', 'gmt-font-sample', shown);
      sample.style.fontFamily = f.family;
      b.append(sample, el('span', 'gmt-font-label', f.label));
      b.addEventListener('click', function () { setTheme({ nameFont: f.id }, true); });
      fonts.appendChild(b);
    });

    var sel = $('gmt-tag-font');
    sel.innerHTML = '';
    GT.FONTS.forEach(function (f) {
      var o = el('option', null, f.label);
      o.value = f.id;
      o.style.fontFamily = f.family;
      if (t.tagFont === f.id) o.selected = true;
      sel.appendChild(o);
    });
    GT.loadFonts(GT.FONTS.map(function (f) { return f.id; }));
  }

  function bindTheme() {
    [['bg', 'bg'], ['glowA', 'glowA'], ['glowB', 'glowB'], ['accent', 'accent']].forEach(function (x) {
      $('gmt-' + x[0]).addEventListener('input', function (e) { var patch = {}; patch[x[1]] = e.target.value.toLowerCase(); setTheme(patch, false); });
    });
    $('gmt-tag-font').addEventListener('change', function (e) { setTheme({ tagFont: e.target.value }, true); });
    $('gmt-reset').addEventListener('click', function () { var d = GT.clean(null); d.preset = 'classic'; p.theme = d; renderThemeControls(); paintThemePreview(); });
    ['gm-name', 'gm-tagline'].forEach(function (id) { $(id).addEventListener('input', function () { renderThemeControls(); paintThemePreview(); }); });
  }

  // ------------------------------------------------------------------ the whole form
  function fill() {
    p.tools = p.tools || []; p.systems = p.systems || []; p.languages = p.languages || []; p.qualities = p.qualities || []; p.questions = p.questions || []; p.socials = p.socials || {};
    $('gm-name').value = p.name || '';
    $('gm-pronouns').value = p.pronouns || '';
    $('gm-tagline').value = p.tagline || '';
    $('gm-bio').value = p.bio || '';
    $('gm-bio-count').textContent = (p.bio || '').length + ' / 900';
    var av0 = $('gm-avatar-preview');
    if (!av0.querySelector('.gm-emoji')) av0.insertBefore(el('span', 'gm-emoji', '\uD83E\uDDD9'), av0.firstChild);
    paintPictures();
    renderTools();
    renderSystems();
    renderLanguages();
    renderQualities();
    renderQuestions();
    renderSocials();
    th();
    renderThemeControls();
    paintThemePreview();
  }

  function collect() {
    p.name = $('gm-name').value.trim();
    p.pronouns = $('gm-pronouns').value.trim();
    p.tagline = $('gm-tagline').value.trim();
    p.bio = $('gm-bio').value.trim();
    var out = clone(p);
    out.questions = out.questions.filter(function (q) { return q.id && String(q.answer || '').trim(); }).map(function (q) { return { id: q.id, answer: String(q.answer).trim() }; });
    Object.keys(out.socials).forEach(function (k) { if (!window.GmRender.safeUrl(out.socials[k])) delete out.socials[k]; });
    return out;
  }

  function bind() {
    bindTheme();
    $('gm-bio').addEventListener('input', function () { $('gm-bio-count').textContent = $('gm-bio').value.length + ' / 900'; });
    makeClickable($('gm-avatar-preview'), 'Change picture', $('gm-avatar-file'));
    makeClickable($('gm-banner-preview'), 'Change banner', $('gm-banner-file'));
    var avBtn = $('gm-avatar-btn'); if (avBtn) avBtn.hidden = true;
    var bnBtn = $('gm-banner-btn'); if (bnBtn) bnBtn.hidden = true;
    $('gm-banner-remove').addEventListener('click', function () { p.banner = ''; paintPictures(); });
    $('gm-avatar-file').addEventListener('change', function (e) {
      adjustPicture(e.target.files[0], 'avatar').then(function (d) { if (d) { p.avatar = d; paintPictures(); status('', ''); } })
        .catch(function (err) { status(err.message, 'err'); });
      e.target.value = '';
    });
    $('gm-banner-file').addEventListener('change', function (e) {
      adjustPicture(e.target.files[0], 'banner').then(function (d) { if (d) { p.banner = d; paintPictures(); status('', ''); } })
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
    [['system', 'systems', 40, renderSystems], ['language', 'languages', 30, renderLanguages]].forEach(function (x) {
      $('gm-' + x[0] + '-add').addEventListener('click', function () {
        var v = $('gm-' + x[0] + '-custom').value.trim().slice(0, x[2]);
        if (v && p[x[1]].indexOf(v) === -1) p[x[1]].push(v);
        $('gm-' + x[0] + '-custom').value = '';
        x[3]();
      });
      $('gm-' + x[0] + '-custom').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('gm-' + x[0] + '-add').click(); } });
    });
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

  // A picture that is still just a file on the site (the default token) is turned into a saved picture,
  // so it is stored with the profile like any other upload.
  function embedAvatar(profile) {
    var src = profile.avatar || '';
    if (!src || /^data:/.test(src)) return Promise.resolve(profile);
    return fetch(src).then(function (r) { return r.blob(); }).then(function (blob) {
      return pictureFromFile(blob, 320, 320, 0.9, true);
    }).then(function (d) { profile.avatar = d; return profile; }).catch(function () { profile.avatar = ''; return profile; });
  }

  function open(profile, slug) {
    p = clone(profile);
    $('gm-gate').hidden = true;
    $('gm-editor').hidden = false;
    $('gm-preview-note').hidden = !Store.preview;
    $('gm-view').href = (Store.preview || !slug || slug === 'ash') ? 'ash.html' + (Store.preview ? '?preview=1' : '') : 'gm.html?slug=' + encodeURIComponent(slug);
    fill();
  }
  function gate(text) {
    $('gm-editor').hidden = true;
    $('gm-gate').hidden = false;
    $('gm-gate-text').textContent = text;
  }

  bind();
  if (Store.preview) {
    Store.loadMine().then(function (r) { return embedAvatar(clone(r.profile)); }).then(open);
    return;
  }
  if (typeof firebase === 'undefined' || !firebase.auth) { gate('Please sign in to edit your GM profile.'); return; }
  firebase.auth().onAuthStateChanged(function (user) {
    if (!user) { gate('Please sign in to edit your GM profile.'); return; }
    getToken = function () { return user.getIdToken(); };
    Store.loadMine(getToken).then(function (r) {
      if (!r.isGm) { gate('GM profiles are for Game Masters. If you would like to host games here, message Ash.'); return; }
      // A new GM starts from the name, pronouns and picture already on their ordinary site profile.
      var acct = r.account || {};
      var prof = clone(r.profile || (r.isAdmin ? C.ASH_DEFAULT : { name: acct.name || r.name || '', pronouns: acct.pronouns || '', tagline: '', tools: [], bio: '', qualities: [], questions: [], socials: {}, discord: '', avatar: '', banner: '' }));
      // Ash's own profile starts with the picture visitors already see on her page.
      if (!prof.avatar && r.isAdmin) prof.avatar = C.ASH_DEFAULT.avatar;
      else if (!prof.avatar && acct.avatar) prof.avatar = acct.avatar;
      return embedAvatar(prof).then(function (pp) { open(pp, r.slug); });
    }).catch(function (err) { gate(err.message); });
  });
})();
