// The "Current Campaigns" section of a Game Master's profile page (gm.html): one card for every
// campaign that Game Master has published, with its sessions shown on the visitor's own clock.
// The section stays hidden until there is at least one. Once the Game Master's payout account is
// approved a session can be joined like any other; until then it shows "Opening soon".
(function () {
  var WORKER = 'https://ash-tabletop-announcements.ash-tabletop.workers.dev';
  var DOT = String.fromCharCode(183);
  var slug = (document.body.getAttribute('data-gm-slug') || '').toLowerCase();
  var section = document.getElementById('campaigns');
  var grid = document.getElementById('gm-campaign-grid');
  if (!slug || !section || !grid) return;
  var online = {};

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function sessionChip(s, c, id) {
    var key = id === 'default' ? c.slug : c.slug + '::' + id;
    var left = Math.max(0, (s.max || 0) - (online[key] || 0));
    var canJoin = !!c.bookable && s.enabled !== false && left > 0;
    var chip = el('button', 'session-chip');
    chip.type = 'button';
    chip.disabled = !canJoin;
    var cta = !c.bookable ? 'Opening soon' : s.enabled === false ? 'Paused' : left > 0 ? 'Join' : 'Full';
    chip.innerHTML = '<svg class="icon icon-sm"><use href="#icon-clock"/></svg><span class="session-text"><span class="session-main"></span><span class="session-sub"></span><span class="session-seats"></span></span><span class="session-chip-cta"></span>';
    var main = typeof nextOccurrenceUTC === 'function' && typeof formatLocal === 'function'
      ? formatLocal(nextOccurrenceUTC(s.day, s.hour, s.minute || 0, 0)) : 'Weekly session';
    chip.querySelector('.session-main').textContent = main;
    chip.querySelector('.session-sub').textContent = (s.group ? s.group + ' ' + DOT + ' ' : '') + (s.enabled === false ? 'Not running right now' : 'Weekly, shown in your time zone');
    chip.querySelector('.session-seats').textContent = c.bookable ? (left > 0 ? left + (left === 1 ? ' seat left' : ' seats left') + ' (' + (s.max - left) + '/' + s.max + ')' : 'Full') : 'Up to ' + s.max + ' players';
    chip.querySelector('.session-chip-cta').textContent = cta;
    if (canJoin) {
      chip.addEventListener('click', function () {
        var params = new URLSearchParams({ campaign: c.slug, slot: id === 'default' ? '' : id, group: s.group || '', day: s.day, hour: s.hour, minute: s.minute || 0, offset: 0, embed: '1' });
        if (typeof openJoinPopup === 'function') openJoinPopup('player.html?' + params.toString());
        else window.location.href = 'player.html?' + params.toString();
      });
    }
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
    Object.keys(c.slots || {}).forEach(function (id) { list.appendChild(sessionChip(c.slots[id], c, id)); });
    body.appendChild(list);
    var more = el('a', 'story-link', 'Read the Full Story');
    more.href = href;
    body.appendChild(more);
    body.appendChild(el('p', 'campaign-note', c.bookable ? 'Pick a session above to take a seat. $10 per session, and you can skip up to an hour before.' : 'Seats at this table open soon. Chat with the Game Master below to ask about availability.'));
    art.appendChild(body);
    art.addEventListener('click', function (e) {
      if (e.target.closest('a, button')) return;
      window.location.href = href;
    });
    return art;
  }

  var seats = fetch(WORKER + '/pay/seats').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { online = (d && d.seats) || {}; }).catch(function () {});
  var list = fetch(WORKER + '/content/public-list?gm=' + encodeURIComponent(slug)).then(function (r) { return r.ok ? r.json() : null; });
  Promise.all([list, seats]).then(function (res) {
    var cs = (res[0] && res[0].campaigns) || [];
    if (!cs.length) return;
    cs.forEach(function (c) { grid.appendChild(card(c)); });
    section.hidden = false;
  }).catch(function () { /* the page simply has no campaigns section */ });
})();
