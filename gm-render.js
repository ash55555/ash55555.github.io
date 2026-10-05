// Where a GM's profile is saved and loaded, and how it is drawn on the profile page.
// While you are testing on your own computer (localhost with ?preview=1 in the address) the
// profile is kept in this browser only, so nothing on the live site changes.
(function () {
  var WORKER = 'https://ash-tabletop-announcements.ash-tabletop.workers.dev';
  var KEY = 'gmProfilePreview';
  var local = ['localhost', '127.0.0.1'].indexOf(window.location.hostname) !== -1;
  var preview = local && new URLSearchParams(window.location.search).get('preview') === '1';

  function readPreview() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }

  var Store = {
    preview: preview,
    // What visitors see. Resolves to a profile, or null when none has been saved yet.
    loadPublic: function (slug) {
      if (preview) return Promise.resolve(readPreview() || window.GmCatalog.ASH_DEFAULT);
      return fetch(WORKER + '/gm/public?slug=' + encodeURIComponent(slug))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { return d && d.profile ? d.profile : null; })
        .catch(function () { return null; });
    },
    // The signed-in GM's own profile, for the editor.
    loadMine: function (getToken) {
      if (preview) return Promise.resolve({ ok: true, profile: readPreview() || window.GmCatalog.ASH_DEFAULT, isGm: true });
      return getToken().then(function (idToken) {
        return fetch(WORKER + '/gm/get', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: idToken }) });
      }).then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'Could not load your profile.'); return d; }); });
    },
    save: function (profile, getToken) {
      if (preview) { localStorage.setItem(KEY, JSON.stringify(profile)); return Promise.resolve({ ok: true }); }
      return getToken().then(function (idToken) {
        return fetch(WORKER + '/gm/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: idToken, profile: profile }) });
      }).then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'Could not save your profile.'); return d; }); });
    },
    reset: function () { try { localStorage.removeItem(KEY); } catch (e) { /* nothing to reset */ } }
  };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function safeUrl(u) {
    try {
      var x = new URL(String(u || '').trim());
      return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : '';
    } catch (e) { return ''; }
  }
  function setText(sel, text) { var n = document.querySelector(sel); if (n) n.textContent = text; }

  // Draws a profile onto the profile page (ash.html and any other GM's page built the same way).
  function apply(p) {
    var C = window.GmCatalog;
    var name = p.name || 'GM';
    document.title = name + ' | Game Master | Ash Tabletop';
    setText('[data-field="name"]', name);
    var pr = document.querySelector('[data-field="pronouns"]');
    if (pr) { pr.textContent = p.pronouns || ''; pr.hidden = !p.pronouns; }
    setText('[data-field="tagline"]', p.tagline || '');
    var tg = document.querySelector('[data-field="tagline"]'); if (tg) tg.hidden = !p.tagline;
    var pl = document.querySelector('[data-field="platforms"]');
    if (pl) { pl.textContent = (p.tools || []).join('  ·  '); pl.hidden = !(p.tools || []).length; }
    setText('[data-field="bio"]', p.bio || '');

    // My tables are...
    var ul = document.querySelector('[data-field="tables"]');
    if (ul) {
      ul.innerHTML = '';
      (p.qualities || []).forEach(function (id) {
        var q = C.quality(id);
        if (q) ul.appendChild(el('li', null, q.emoji + ' ' + q.label));
      });
      var block = ul.closest('.hero-tables-block');
      if (block) block.hidden = !ul.children.length;
    }

    // Chat button: opens the chat on this site
    var chat = document.querySelector('.js-message-gm');
    if (chat) {
      chat.dataset.name = name;
      var lbl = chat.querySelector('.chat-label'); if (lbl) lbl.textContent = 'Chat with ' + name;
    }

    // Picture and banner
    var img = document.querySelector('.profile-avatar .hero-token');
    if (img && /^data:image\//.test(p.avatar || '')) img.src = p.avatar;
    var cover = document.querySelector('.profile-cover');
    if (cover) {
      if (/^data:image\//.test(p.banner || '')) { cover.style.setProperty('--cover-img', 'url("' + p.banner + '")'); cover.setAttribute('data-has-img', ''); }
      else { cover.style.removeProperty('--cover-img'); cover.removeAttribute('data-has-img'); }
    }

    // The boxes under the card
    var strip = document.querySelector('.info-strip');
    if (strip) {
      strip.innerHTML = '';
      (p.questions || []).forEach(function (qa) {
        var q = C.question(qa.id);
        if (!q || !String(qa.answer || '').trim()) return;
        var tile = el('div', 'info-tile');
        var title = el('p', 'info-title', q.title);
        tile.appendChild(title);
        tile.appendChild(el('p', 'info-sub', qa.answer));
        strip.appendChild(tile);
      });
      strip.hidden = !strip.children.length;
    }

    // Social links: only the ones that have a real address
    var old = document.querySelector('.profile-socials');
    if (old) old.remove();
    var links = C.SOCIALS.filter(function (s) { return safeUrl((p.socials || {})[s.id]); });
    var actions = document.querySelector('.profile-main .hero-actions');
    if (links.length && actions) {
      var box = el('div', 'profile-socials');
      box.appendChild(el('p', 'profile-socials-title', 'Find me online'));
      var row = el('div', 'profile-socials-row');
      links.forEach(function (s) {
        var a = el('a', 'social-btn social-' + s.id);
        a.href = safeUrl(p.socials[s.id]);
        a.target = '_blank';
        a.rel = 'noopener me';
        a.title = s.label;
        a.setAttribute('aria-label', s.label);
        a.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + C.ICONS[s.id] + '</svg>';
        a.appendChild(el('span', null, s.label));
        row.appendChild(a);
      });
      box.appendChild(row);
      actions.insertAdjacentElement('afterend', box);
    }
  }

  window.GmStore = Store;
  window.GmRender = { apply: apply, safeUrl: safeUrl };

  // A profile page loads whatever its GM has saved. If nothing is saved yet, the page keeps its own text.
  document.addEventListener('DOMContentLoaded', function () {
    var slug = document.body.getAttribute('data-gm-slug');
    if (!slug || !window.GmCatalog) return;
    Store.loadPublic(slug).then(function (p) {
      if (p) { apply(p); return; }
      // A Game Master who has not filled in their profile yet
      if (document.body.hasAttribute('data-gm-generic')) {
        apply({ name: 'Game Master', bio: 'This Game Master is still setting up their profile. Check back soon.', tools: [], qualities: [], questions: [], socials: {} });
      }
    });
  });
})();
