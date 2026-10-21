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

  function openDateLong(ymd) {
    var p = ymd.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  }
  function freqLabel(freq) {
    if (freq === 'biweekly') return 'Every other week, shown in your time zone';
    if (freq === 'once') return 'One-shot, shown in your time zone';
    return 'Weekly session, shown in your time zone';
  }

  function wireChip(chip) {
    chip.addEventListener('click', function () {
      var params = new URLSearchParams({
        campaign: chip.dataset.campaign, slot: chip.dataset.slot || '', group: chip.dataset.group || '',
        day: chip.dataset.day, hour: chip.dataset.hour, minute: chip.dataset.minute, offset: chip.dataset.offset,
        freq: chip.dataset.freq || 'weekly', anchor: chip.dataset.anchor || '',
        embed: '1',
      });
      if (typeof openJoinPopup === 'function') openJoinPopup('player.html?' + params.toString());
    });
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

    var price = c.price > 0 ? c.price : 10;
    var footer = el('div', 'campaign-footer');
    footer.innerHTML =
      '<span class="price-tag">$' + (price % 1 === 0 ? price : price.toFixed(2)) + ' USD / session</span>' +
      (c.openMode === 'date' && c.openAt && new Date(c.openAt + 'T00:00:00Z').getTime() > Date.now()
        ? '<span class="price-tag cd-opens-note">Opens ' + openDateLong(c.openAt) + '</span>' : '');
    body.appendChild(footer);

    art.appendChild(body);

    // This card was inserted after script.js's own click-wiring already ran,
    // so it wires its own handlers instead of relying on setupClickableCards()
    // / setupSessionButtons() to find it.
    art.addEventListener('click', function (event) {
      if (event.target.closest('a, button')) return;
      window.location.href = href;
    });
    wireChip(chip);

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

  // Follows every group of one campaign: its time, its seats, and a chip of its own for each group
  // the Game Master opens in the admin (a full or paused group is handled the same way as before).
  function watchLiveTime(slug, baseChip) {
    if (typeof firebase === 'undefined' || typeof FIREBASE_CONFIG === 'undefined' || !FIREBASE_CONFIG.apiKey || FIREBASE_CONFIG.apiKey.indexOf('REPLACE_WITH') === 0) return;
    var chipsBySlot = { 'default': baseChip };
    var lastChip = baseChip;
    var lastSlots = null;
    var onlineSeats = {};

    function setGroup(chip, group) {
      chip.dataset.group = group || '';
      var text = chip.querySelector('.session-text');
      var label = chip.querySelector('.session-group');
      if (!group) { if (label) label.remove(); return; }
      if (!label && text) { label = document.createElement('span'); label.className = 'session-group'; text.insertBefore(label, text.firstChild); }
      if (label) label.textContent = group;
    }
    function chipFor(id, slot) {
      if (chipsBySlot[id]) return chipsBySlot[id];
      if (slot.enabled === false) return null; // a group that is not open yet gets no chip
      var chip = baseChip.cloneNode(true);
      chip.className = 'session-chip';
      chip.disabled = false;
      chip.dataset.slot = id;
      lastChip.insertAdjacentElement('afterend', chip);
      lastChip = chip;
      wireChip(chip);
      chipsBySlot[id] = chip;
      return chip;
    }
    function applyOne(id, slot, chip) {
      var seatKey = id === 'default' ? slug : slug + '::' + id;
      var offset = slot.offset != null ? slot.offset : 1;
      chip.dataset.campaign = slug;
      chip.dataset.day = slot.day; chip.dataset.hour = slot.hour; chip.dataset.minute = slot.minute || 0; chip.dataset.offset = offset;
      chip.dataset.freq = slot.freq || 'weekly'; chip.dataset.anchor = slot.anchor || '';
      if (slot.source) chip.dataset.source = slot.source;
      setGroup(chip, slot.group);
      var mainEl = chip.querySelector('.session-main');
      var next = typeof nextOccurrenceUTC === 'function' ? nextOccurrenceUTC(slot.day, slot.hour, slot.minute || 0, offset, slot.freq, slot.anchor) : null;
      if (next && mainEl && typeof formatLocal === 'function') mainEl.textContent = formatLocal(next);
      var subEl = chip.querySelector('.session-sub');
      var ctaEl = chip.querySelector('.session-chip-cta');
      var seatsEl = chip.querySelector('.session-seats');
      chip.classList.remove('is-full', 'is-full-hidden');
      chip.disabled = false;
      if (ctaEl) ctaEl.textContent = 'Join';
      // A one-shot with no next occurrence has already happened; there is nothing left to join.
      if (slot.freq === 'once' && !next) {
        if (subEl) subEl.textContent = 'This one-shot has already run';
        if (ctaEl) ctaEl.textContent = 'Ended';
        chip.disabled = true;
        chip.classList.add('is-full', 'is-full-hidden');
        return;
      }
      if (slot.enabled === false) {
        if (subEl) subEl.textContent = 'Not currently running';
        if (ctaEl) ctaEl.textContent = 'Paused';
        if (seatsEl) seatsEl.textContent = '';
        chip.disabled = true;
        chip.classList.add('is-full');
        return;
      }
      if (subEl) subEl.textContent = freqLabel(slot.freq);
      if (typeof slot.max === 'number' && seatsEl) {
        var filled = (slot.filled || 0) + (onlineSeats[seatKey] || 0);
        var remaining = slot.max - filled;
        seatsEl.textContent = remaining > 0
          ? remaining + ' seat' + (remaining === 1 ? '' : 's') + ' left (' + filled + '/' + slot.max + ')'
          : 'Full (' + filled + '/' + slot.max + ')';
        if (remaining <= 0) {
          chip.classList.add('is-full'); chip.disabled = true;
          if (ctaEl) ctaEl.textContent = 'Full';
          chip.classList.add('is-full-hidden'); // a full group is not shown to visitors at all
        }
      }
      if (window.AshJoined) window.AshJoined.mark(chip);
    }
    function applyAll() {
      if (!lastSlots) return;
      Object.keys(lastSlots).forEach(function (id) {
        var slot = lastSlots[id];
        if (!slot) return;
        var chip = chipFor(id, slot);
        if (chip) applyOne(id, slot, chip);
      });
      // the starting placeholder chip stands for the default group; if that group does not exist, it goes
      if (!lastSlots['default']) baseChip.classList.add('is-full-hidden');
    }
    onlineSeatsPromise.then(function (seats) { onlineSeats = seats || {}; applyAll(); });
    try {
      firebase.database().ref('campaigns/' + slug + '/slots').on('value', function (snap) {
        var slots = snap.val();
        if (!slots) return; // no live schedule yet; the placeholder stays as-is
        lastSlots = slots;
        applyAll();
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
          // A play-by-post game has no schedule at all, so this card (built entirely
          // around a session-time chip) doesn't fit it. It still shows on its own page;
          // skipped here until the homepage has a card shape that doesn't assume one.
          if (RESERVED[c.slug] || c.type === 'pbp') return;
          var built = buildCard(c);
          grid.appendChild(built.art);
          watchLiveTime(c.slug, built.chip);
        });
      })
      .catch(function () { /* the homepage just keeps showing the original 5 */ });
  });
})();
