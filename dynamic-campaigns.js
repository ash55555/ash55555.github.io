// Adds a homepage card for every campaign published through the admin
// Campaigns tab that ISN'T one of the site's 5 original hand-built pages.
// Those 5 keep their existing hand-authored cards above untouched; this
// only appends cards for anything new, so publishing a campaign in admin
// makes it show up here automatically, with no HTML to hand-write.
(function () {
  var RESERVED = {
    'flying-city': 1, 'curse-of-strahd': 1, 'ravenloft-undead-survival': 1,
    'crooked-moon': 1, 'witchlight': 1,
  };
  var WORKER = 'https://ash-tabletop-announcements.ash-tabletop.workers.dev';

  function el(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  function buildCard(c) {
    var href = 'blog/campaign.html?slug=' + encodeURIComponent(c.slug);

    var art = el('article', 'campaign-card');
    art.dataset.href = href;

    var img = el('img', 'campaign-banner');
    img.loading = 'lazy';
    img.alt = c.title + ' banner art';
    img.src = c.bannerUrl || 'medie/ash-token.png';
    art.appendChild(img);

    var body = el('div', 'campaign-body');

    var h3 = document.createElement('h3');
    h3.textContent = c.title;
    body.appendChild(h3);

    var tone = el('p', 'campaign-tone');
    tone.innerHTML = '<svg class="icon icon-sm"><use href="#icon-dice"/></svg> ';
    tone.appendChild(document.createTextNode(c.eyebrow || ''));
    body.appendChild(tone);

    var sessionList = el('div', 'session-list');
    var chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'session-chip';
    chip.dataset.campaign = c.slug;
    // Placeholder until Firebase (see below) fills in the real day/time this
    // campaign's admin actually saved — same as how every other card starts
    // with whatever was last authored, then gets corrected live.
    chip.dataset.day = '6'; chip.dataset.hour = '18'; chip.dataset.minute = '0'; chip.dataset.offset = '1';
    chip.dataset.source = '6:00 PM GMT+1';
    chip.innerHTML =
      '<svg class="icon icon-sm"><use href="#icon-clock"/></svg>' +
      '<span class="session-text">' +
        '<span class="session-main">Weekly session</span>' +
        '<span class="session-sub">Calculating your local time…</span>' +
        '<span class="session-seats"></span>' +
      '</span>' +
      '<span class="session-chip-cta">Join</span>';
    sessionList.appendChild(chip);
    body.appendChild(sessionList);

    var link = document.createElement('a');
    link.className = 'story-link';
    link.href = href;
    link.innerHTML = 'Read the Full Story <svg class="icon icon-sm"><use href="#icon-book"/></svg>';
    body.appendChild(link);

    var footer = el('div', 'campaign-footer');
    footer.innerHTML =
      '<span class="price-tag">$10 / session</span>' +
      '<a href="https://discord.com/users/1137869041495724094" target="_blank" rel="noopener" class="btn btn-small">Reserve a Seat</a>';
    body.appendChild(footer);

    var note = el('p', 'campaign-note');
    note.textContent = 'Message Ash to check availability and get your personal booking link.';
    body.appendChild(note);

    art.appendChild(body);

    // This card was inserted after script.js's own click-wiring already ran,
    // so it wires its own handlers instead of relying on setupClickableCards()
    // / setupSessionButtons() to find it.
    art.addEventListener('click', function (event) {
      if (event.target.closest('a, button')) return;
      window.location.href = href;
    });
    chip.addEventListener('click', function () {
      var params = new URLSearchParams({
        campaign: chip.dataset.campaign, slot: '', group: '',
        day: chip.dataset.day, hour: chip.dataset.hour, minute: chip.dataset.minute, offset: chip.dataset.offset,
        embed: '1',
      });
      if (typeof openJoinPopup === 'function') openJoinPopup('player.html?' + params.toString());
    });

    return { art: art, chip: chip };
  }

  // A light, self-contained live-time-and-seats sync for just these new
  // cards' chips (the existing campaigns-data.js already built its own chip
  // list before these existed, so it never sees them — this covers the same
  // ground, day/time AND seat counts, for just this set).
  var onlineSeatsPromise = fetch(WORKER + '/pay/seats')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) { return (d && d.seats) || {}; })
    .catch(function () { return {}; });

  function watchLiveTime(slug, chip) {
    if (typeof firebase === 'undefined' || typeof FIREBASE_CONFIG === 'undefined' || !FIREBASE_CONFIG.apiKey || FIREBASE_CONFIG.apiKey.indexOf('REPLACE_WITH') === 0) return;
    var lastSlot = null;
    function applySeats(onlineSeats) {
      if (!lastSlot || typeof lastSlot.max !== 'number') return;
      var seatsEl = chip.querySelector('.session-seats');
      var ctaEl = chip.querySelector('.session-chip-cta');
      if (!seatsEl) return;
      var filled = (lastSlot.filled || 0) + (onlineSeats[slug] || 0);
      var remaining = lastSlot.max - filled;
      seatsEl.textContent = remaining > 0
        ? remaining + ' seat' + (remaining === 1 ? '' : 's') + ' left (' + filled + '/' + lastSlot.max + ')'
        : 'Full (' + filled + '/' + lastSlot.max + ')';
      if (remaining <= 0) {
        chip.classList.add('is-full'); chip.disabled = true;
        if (ctaEl) ctaEl.textContent = 'Full';
      }
    }
    try {
      firebase.database().ref('campaigns/' + slug + '/slots/default').on('value', function (snap) {
        var slot = snap.val();
        if (!slot) return;
        lastSlot = slot;
        var offset = slot.offset != null ? slot.offset : 1;
        chip.dataset.day = slot.day; chip.dataset.hour = slot.hour; chip.dataset.minute = slot.minute || 0; chip.dataset.offset = offset;
        if (slot.source) chip.dataset.source = slot.source;
        var mainEl = chip.querySelector('.session-main');
        if (mainEl && typeof nextOccurrenceUTC === 'function' && typeof formatLocal === 'function') {
          var next = nextOccurrenceUTC(slot.day, slot.hour, slot.minute || 0, offset);
          if (next) mainEl.textContent = formatLocal(next);
        }
        var subEl = chip.querySelector('.session-sub');
        var ctaEl = chip.querySelector('.session-chip-cta');
        if (slot.enabled === false) {
          if (subEl) subEl.textContent = 'Not currently running';
          if (ctaEl) ctaEl.textContent = 'Paused';
          chip.disabled = true;
          chip.classList.add('is-full');
          return;
        }
        if (subEl) subEl.textContent = 'Weekly session, shown in your time zone';
        chip.disabled = false;
        chip.classList.remove('is-full');
        onlineSeatsPromise.then(applySeats);
      }, function () { /* no live time yet; the placeholder stays as-is */ });
    } catch (e) { /* Firebase not configured yet */ }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var grid = document.querySelector('.campaign-grid');
    if (!grid) return;
    fetch(WORKER + '/content/public-list')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.campaigns) return;
        d.campaigns.forEach(function (c) {
          if (RESERVED[c.slug]) return;
          var built = buildCard(c);
          grid.appendChild(built.art);
          watchLiveTime(c.slug, built.chip);
        });
      })
      .catch(function () { /* the homepage just keeps showing the original 5 */ });
  });
})();
