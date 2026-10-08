// Fills a campaign blog page with its live, editable content (title, hook, story
// sections, banner picture) from the Worker. If the fetch fails for any reason
// (offline, a hiccup), the page just keeps showing the text already baked into
// its HTML, so a visitor never sees a blank or broken page.
(function () {
  var slug = document.body.getAttribute('data-campaign-slug');
  if (!slug) return;
  var WORKER = 'https://ash-tabletop-announcements.ash-tabletop.workers.dev';

  function freqLabel(freq) {
    if (freq === 'biweekly') return 'Every other week, shown in your time zone';
    if (freq === 'once') return 'One-shot, shown in your time zone';
    return 'Weekly, shown in your time zone';
  }

  // ledeFirst: bold-and-larger opening line (the intro section's style).
  // italicLast: the closing flourish line at the end (the "why this table"
  // section always signs off with one), matching how these pages have always read.
  function paragraphs(container, text, ledeFirst, italicLast) {
    if (!container || !text) return;
    container.innerHTML = '';
    var paras = text.split(/\n\s*\n/);
    paras.forEach(function (para, i) {
      var p = document.createElement('p');
      if (ledeFirst && i === 0) p.className = 'lede';
      if (italicLast && i === paras.length - 1 && paras.length > 1) {
        var em = document.createElement('em');
        em.textContent = para.trim();
        p.appendChild(em);
      } else {
        p.textContent = para.trim();
      }
      container.appendChild(p);
    });
  }
  function setMeta(selector, value) {
    if (!value) return;
    var el = document.querySelector(selector);
    if (el) el.setAttribute('content', value);
  }

  // A campaign without a hand-made theme (anything added after the first five) gets its page colors
  // from its own banner picture, the same way the original themes were chosen.
  var needsTheme = document.body.className.indexOf('theme-') === -1 && !!window.AshCampaignColors;
  if (needsTheme) {
    try {
      var cached = JSON.parse(localStorage.getItem('ash-campaign-colors-v1') || '{}')[slug];
      if (cached && typeof cached.hue === 'number') window.AshCampaignColors.applyPageTheme(cached.hue);
    } catch (e) { /* no cached color yet */ }
  }

  // A campaign made by another Game Master: Ash's Discord, email form and join button are not theirs, so this page
  // shows their own sessions and sends people to that Game Master's page to read about them and message them.
  function gmMode(d) {
    var profile = '../gm.html?slug=' + encodeURIComponent(d.gm);
    var back = document.querySelector('.back-link');
    if (back) {
      back.href = profile;
      var last = back.lastChild;
      if (last && last.nodeType === 3) last.textContent = '\n  Back to the Game Master\n';
    }
    var nav = document.querySelector('.nav-links');
    if (nav) nav.innerHTML = '<a class="nav-cta" href="' + profile + '">Meet the Game Master</a>';
    var soon = 'Check back soon, or message the Game Master directly.';
    [['cc-world', d.world], ['cc-stakes', d.stakes], ['cc-audience', d.audience]].forEach(function (x) {
      var box = document.getElementById(x[0]);
      if (box && !x[1]) { box.innerHTML = ''; var p = document.createElement('p'); p.textContent = soon; box.appendChild(p); }
    });
    var hk = document.getElementById('cc-hook');
    if (hk && !d.hook) hk.textContent = 'Details are on their way. Message the Game Master to hear more.';

    // the sessions, on the visitor's own clock
    var list = document.querySelector('.article-schedule .session-list');
    if (list) {
      list.innerHTML = '';
      var ids = Object.keys(d.slots || {});
      if (!ids.length) { var none = document.createElement('p'); none.textContent = 'The schedule is not set yet.'; list.appendChild(none); }
      ids.forEach(function (id) {
        var s = d.slots[id];
        var next = typeof nextOccurrenceUTC === 'function' ? nextOccurrenceUTC(s.day, s.hour, s.minute || 0, 0, s.freq, s.anchor) : null;
        if (s.freq === 'once' && !next) return; // this one-shot has already happened; nothing to show
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'session-chip';
        chip.disabled = true;
        chip.dataset.id = id;
        var when = (next && typeof formatLocal === 'function') ? formatLocal(next) : 'Weekly session';
        chip.innerHTML = '<svg class="icon icon-sm"><use href="#icon-clock"/></svg><span class="session-text"><span class="session-main"></span><span class="session-sub"></span><span class="session-seats"></span></span><span class="session-chip-cta">Opening soon</span>';
        chip.querySelector('.session-main').textContent = when;
        chip.querySelector('.session-sub').textContent = (s.group ? s.group + ' \u00B7 ' : '') + (s.enabled === false ? 'Not running right now' : freqLabel(s.freq));
        chip.querySelector('.session-seats').textContent = 'Up to ' + s.max + ' players';
        list.appendChild(chip);
      });
      if (!list.children.length) { var ended = document.createElement('p'); ended.textContent = 'This table has no upcoming sessions right now.'; list.appendChild(ended); }
    }

    var price = '$' + (d.price % 1 === 0 ? d.price : d.price.toFixed(2)) + ' USD per session';
    var opensLater = d.openMode === 'date' && d.openAt && new Date(d.openAt + 'T00:00:00Z').getTime() > Date.now();
    var pay = document.querySelector('.blog-payment');
    if (pay) {
      pay.innerHTML = '<h2>Interested in this table?</h2><p class="blog-payment-price">' + price + '</p>' +
        (opensLater ? '<p class="blog-payment-opens">Opens ' + openDateLong(d.openAt) + '</p>' : '') +
        '<p>Meet the Game Master, read about how they run their tables, and send them a message.</p>' +
        '<div class="blog-payment-actions"><a class="btn btn-primary" href="' + profile + '">Meet the Game Master</a></div>';
    }
    document.querySelectorAll('.js-email-trigger').forEach(function (b) { b.remove(); });
    if (d.bookable && !opensLater) openSeats(d);
  }

  function openDateLong(ymd) {
    var p = ymd.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  }

  // Once the Game Master's payout account is approved their sessions can be joined like any other.
  function openSeats(d) {
    fetch(WORKER + '/pay/seats').then(function (r) { return r.ok ? r.json() : null; }).then(function (res) {
      var online = (res && res.seats) || {};
      document.querySelectorAll('.article-schedule .session-chip').forEach(function (chip) {
        var id = chip.dataset.id, s = d.slots && d.slots[id];
        if (!s) return;
        var key = id === 'default' ? d.slug : d.slug + '::' + id;
        var left = Math.max(0, (s.max || 0) - (online[key] || 0));
        var canJoin = s.enabled !== false && left > 0;
        chip.disabled = !canJoin;
        chip.querySelector('.session-seats').textContent = left > 0 ? left + (left === 1 ? ' seat left' : ' seats left') + ' (' + (s.max - left) + '/' + s.max + ')' : 'Full';
        chip.querySelector('.session-chip-cta').textContent = s.enabled === false ? 'Paused' : left > 0 ? 'Join' : 'Full';
        if (canJoin) chip.addEventListener('click', function () {
          var params = new URLSearchParams({ campaign: d.slug, slot: id === 'default' ? '' : id, group: s.group || '', day: s.day, hour: s.hour, minute: s.minute || 0, offset: 0, freq: s.freq || 'weekly', anchor: s.anchor || '', embed: '1' });
          if (typeof openJoinPopup === 'function') openJoinPopup('../player.html?' + params.toString());
          else window.location.href = '../player.html?' + params.toString();
        });
      });
    }).catch(function () { /* the sessions stay as they were */ });
  }

  fetch(WORKER + '/content/public?slug=' + encodeURIComponent(slug))
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d) return;
      if (d.gm) gmMode(d);
      if (d.title) {
        document.title = d.title + ' | Ash Tabletop';
        var t = document.getElementById('cc-title');
        if (t) t.textContent = d.title;
      }
      var eb = document.getElementById('cc-eyebrow'); if (eb && d.eyebrow) eb.textContent = d.eyebrow;
      var hk = document.getElementById('cc-hook'); if (hk && d.hook) hk.textContent = d.hook;
      var im = document.getElementById('cc-banner');
      if (im && d.bannerUrl) {
        im.src = d.bannerUrl;
        im.alt = d.title || im.alt;
        im.hidden = false;
        var ph = document.getElementById('cc-banner-placeholder');
        if (ph) ph.hidden = true;
        if (needsTheme) window.AshCampaignColors.learn(slug, d.bannerUrl, function (color, hue) { window.AshCampaignColors.applyPageTheme(hue); });
      }
      paragraphs(document.getElementById('cc-intro'), d.intro, true);
      paragraphs(document.getElementById('cc-world'), d.world, false);
      paragraphs(document.getElementById('cc-stakes'), d.stakes, false);
      paragraphs(document.getElementById('cc-audience'), d.audience, false, true);

      setMeta('meta[name="description"]', d.hook);
      setMeta('meta[property="og:description"]', d.hook);
      setMeta('meta[name="twitter:description"]', d.hook);
      if (d.title) {
        setMeta('meta[property="og:title"]', d.title + ' | Ash Tabletop');
        setMeta('meta[name="twitter:title"]', d.title + ' | Ash Tabletop');
      }
      if (d.bannerUrl) {
        setMeta('meta[property="og:image"]', d.bannerUrl);
        setMeta('meta[name="twitter:image"]', d.bannerUrl);
      }
    })
    .catch(function () { /* the page's own static text stays exactly as it was */ });
})();
