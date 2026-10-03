// Fills a campaign blog page with its live, editable content (title, hook, story
// sections, banner picture) from the Worker. If the fetch fails for any reason
// (offline, a hiccup), the page just keeps showing the text already baked into
// its HTML, so a visitor never sees a blank or broken page.
(function () {
  var slug = document.body.getAttribute('data-campaign-slug');
  if (!slug) return;
  var WORKER = 'https://ash-tabletop-announcements.ash-tabletop.workers.dev';

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

  fetch(WORKER + '/content/public?slug=' + encodeURIComponent(slug))
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d) return;
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
