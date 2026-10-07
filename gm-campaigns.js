// The "Current Campaigns" section of a Game Master's profile page (gm.html): one card for every
// campaign that Game Master has published, with its sessions shown on the visitor's own clock.
// The section stays hidden until there is at least one. Booking a seat is not open yet, so each
// session shows "Opening soon" and the card points people to the chat.
(function () {
  var WORKER = 'https://ash-tabletop-announcements.ash-tabletop.workers.dev';
  var slug = (document.body.getAttribute('data-gm-slug') || '').toLowerCase();
  var section = document.getElementById('campaigns');
  var grid = document.getElementById('gm-campaign-grid');
  if (!slug || !section || !grid) return;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function sessionChip(s) {
    var chip = el('button', 'session-chip');
    chip.type = 'button';
    chip.disabled = true;
    chip.innerHTML = '<svg class="icon icon-sm"><use href="#icon-clock"/></svg><span class="session-text"><span class="session-main"></span><span class="session-sub"></span><span class="session-seats"></span></span><span class="session-chip-cta">Opening soon</span>';
    var main = typeof nextOccurrenceUTC === 'function' && typeof formatLocal === 'function'
      ? formatLocal(nextOccurrenceUTC(s.day, s.hour, s.minute || 0, 0)) : 'Weekly session';
    chip.querySelector('.session-main').textContent = main;
    chip.querySelector('.session-sub').textContent = (s.group ? s.group + ' · ' : '') + (s.enabled === false ? 'Not running right now' : 'Weekly, shown in your time zone');
    chip.querySelector('.session-seats').textContent = 'Up to ' + s.max + ' players';
    return chip;
  }

  function card(c) {
    var href = 'blog/campaign.html?slug=' + encodeURIComponent(c.slug);
    var art = el('article', 'campaign-card');
    art.dataset.href = href;
    if (c.bannerUrl) {
      var img = el('img', 'campaign-banner');
      img.loading = 'lazy';
      img.alt = c.title + ' banner art';
      img.src = c.bannerUrl;
      art.appendChild(img);
    }
    var body = el('div', 'campaign-body');
    body.appendChild(el('h3', null, c.title));
    if (c.eyebrow) body.appendChild(el('p', 'campaign-tone', c.eyebrow));
    if (c.hook) body.appendChild(el('p', 'campaign-hook', c.hook));
    var list = el('div', 'session-list');
    Object.keys(c.slots || {}).forEach(function (id) { list.appendChild(sessionChip(c.slots[id])); });
    body.appendChild(list);
    var more = el('a', 'story-link', 'Read the Full Story');
    more.href = href;
    body.appendChild(more);
    var note = el('p', 'campaign-note', 'Seats at this table open soon. Chat with the Game Master below to ask about availability.');
    body.appendChild(note);
    art.appendChild(body);
    art.addEventListener('click', function (e) {
      if (e.target.closest('a, button')) return;
      window.location.href = href;
    });
    return art;
  }

  fetch(WORKER + '/content/public-list?gm=' + encodeURIComponent(slug))
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      var list = (d && d.campaigns) || [];
      if (!list.length) return;
      list.forEach(function (c) { grid.appendChild(card(c)); });
      section.hidden = false;
    })
    .catch(function () { /* the page simply has no campaigns section */ });
})();
