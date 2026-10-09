// The home page. Everything on it (games, game masters and numbers) comes from the Worker's
// /home/public, so a new Game Master's published campaign shows up here by itself.
(function () {
  var WORKER = 'https://ash-tabletop-announcements.ash-tabletop.workers.dev';
  var RESERVED = { 'flying-city': 1, 'curse-of-strahd': 1, 'ravenloft-undead-survival': 1, 'crooked-moon': 1, 'witchlight': 1 };
  // The five original campaigns keep their own pictures until a new one is uploaded.
  var ART = {
    'flying-city': 'medie/2139d310-c69b-4c0e-b8a0-2eded9ce8094%20%281%29.webp',
    'curse-of-strahd': 'medie/1466afad-bf88-4950-9f9b-a82a40f44147.webp?v=20260929c',
    'ravenloft-undead-survival': 'medie/37528c55-aa34-4bfa-9f9c-2f9152faf651.webp',
    'crooked-moon': 'medie/daaeef05-e995-40b5-84d6-4d6f5670fa47.webp',
    'witchlight': 'medie/d4e2868e-d17f-4a04-aeb1-ba6ce7fd3ea3.webp'
  };
  // A color and an emoji for each genre tag a Game Master can pick in their campaign editor.
  // A custom, hand-typed tag (anything not in this list) just gets the plain fallback below,
  // nothing here guesses a game's genre from its own words anymore.
  var ACCENT = { Horror: '#ff6b81', Mystery: '#7ecbff', Political: '#f2b84f', Fey: '#d98bff', Survival: '#7be0a3', Adventure: '#ffd479', Comedy: '#ffb199' };
  var GLYPH = { Horror: '🧛', Mystery: '🕵️', Political: '🏛️', Fey: '🧚', Survival: '🏕️', Adventure: '🗺️', Comedy: '🎭' };
  var FALLBACK_ACCENT = '#9b6dff', FALLBACK_GLYPH = '🎲';
  var CHIP_ICON = { All: '✨', 'Seats open': '🪑' };
  var CAT_ORDER = ['Horror', 'Mystery', 'Political', 'Fey', 'Survival', 'Adventure', 'Comedy'];

  var games = [], gms = {}, cat = 'All', q = '';

  function $(id) { return document.getElementById(id); }
  function esc(t) { var d = document.createElement('div'); d.textContent = t == null ? '' : t; return d.innerHTML; }
  function gameUrl(g) { return RESERVED[g.slug] ? 'blog/' + g.slug + '.html' : 'blog/campaign.html?slug=' + encodeURIComponent(g.slug); }
  function gmUrl(m) { return m.slug === 'ash' ? 'ash.html' : 'gm.html?slug=' + encodeURIComponent(m.slug); }
  function art(g) { return g.bannerUrl || ART[g.slug] || ''; }
  function when(g) {
    var d = new Date(g.next);
    return d.toLocaleDateString(undefined, { weekday: 'short' }) + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  function countdown(g) {
    var m = Math.max(0, Math.round((new Date(g.next) - Date.now()) / 60000)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
    return d ? d + 'd ' + h + 'h' : h ? h + 'h ' + mm + 'm' : mm + ' min';
  }
  function openDateLong(ymd) {
    var p = ymd.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  }
  function badgeText(g) { return g.opensAt ? 'Opens ' + openDateLong(g.opensAt) : (g.soon ? 'Opening soon' : 'Seats open'); }
  function stars(r) { var n = Math.round(r); return '★'.repeat(n) + '☆'.repeat(5 - n); }
  function avatar(m, cls) {
    var inner = m.avatar ? '<img src="' + esc(m.avatar) + '" alt="">' : (m.slug === 'ash' ? '<img src="medie/ash-token.png" alt="">' : '🎲');
    return '<span class="' + cls + '">' + inner + '</span>';
  }
  function ratingText(m) {
    return m.reviews ? '<span class="hx-r">' + stars(m.rating) + '</span> ' + m.rating.toFixed(1) + ' (' + m.reviews + ')' : 'New game master';
  }

  function seatDots(g) {
    var h = '';
    for (var i = 0; i < g.max; i++) h += '<i class="' + (i < g.max - g.seatsOpen ? '' : 'hx-free') + '"></i>';
    return '<div class="hx-seats">' + h + '<span>' + g.seatsOpen + ' left</span></div>';
  }

  function card(g) {
    var m = gms[g.gm] || { slug: g.gm, name: 'Game Master', pronouns: '', reviews: 0 };
    var a = ACCENT[g.cat] || FALLBACK_ACCENT, img = art(g);
    var artStyle = img ? 'background-image:url(\'' + img.replace(/'/g, '%27') + '\')' : 'background-image:linear-gradient(135deg,#2b1a4d,#6b2a4a)';
    return '<article class="hx-card" style="--accent:' + a + '"><a class="hx-stretch" href="' + gameUrl(g) + '" aria-label="Open ' + esc(g.title) + '"></a>' +
      '<div class="hx-art" style="' + artStyle + '">' + (img ? '' : '<span class="hx-em">' + (GLYPH[g.cat] || FALLBACK_GLYPH) + '</span>') +
      '<span class="hx-badge' + ((g.soon || g.opensAt) ? '' : ' hx-open') + '">' + badgeText(g) + '</span><span class="hx-cat">' + esc(g.cat) + '</span></div>' +
      '<div class="hx-body"><h3>' + esc(g.title) + '</h3><p class="hx-tags">' + esc(g.eyebrow || g.hook) + '</p>' +
      '<div class="hx-meta"><span class="hx-when">⏱ Next <b>' + esc(when(g)) + '</b></span><span class="hx-price">$' + g.price + ' <small>USD / session</small></span></div>' +
      ((g.soon || g.opensAt) ? '' : seatDots(g)) +
      '<a class="hx-dmrow" href="' + gmUrl(m) + '" title="See ' + esc(m.name) + '\'s page">' + avatar(m, 'hx-av') +
        '<span class="hx-who"><b>' + esc(m.name) + (m.you ? '<i>HOST</i>' : '') + '</b><small>' + (m.pronouns ? esc(m.pronouns) + ' · ' : '') + ratingText(m) + '</small></span>' +
        '<span class="hx-go">Profile ›</span></a></div></article>';
  }

  function soonCard(g, i) {
    var m = gms[g.gm] || { name: 'Game Master' }, a = ACCENT[g.cat] || FALLBACK_ACCENT, img = art(g);
    var bg = img ? 'background-image:url(\'' + img.replace(/'/g, '%27') + '\')' : 'background-image:linear-gradient(135deg,#2b1a4d,#6b2a4a)';
    return '<a class="hx-big" href="' + gameUrl(g) + '" style="--accent:' + a + ';' + bg + '">' +
      (img ? '' : '<div class="hx-emoji-art">' + (GLYPH[g.cat] || FALLBACK_GLYPH) + '</div>') +
      '<span class="hx-tag">' + (i === 0 ? 'Next up' : esc(g.cat)) + '</span>' +
      '<h3>' + esc(g.title) + '</h3><div class="hx-who"><small>with ' + esc(m.name) + ' · ' + g.seatsOpen + (g.seatsOpen === 1 ? ' seat' : ' seats') + ' open</small></div>' +
      '<div class="hx-count"><b>' + countdown(g) + '</b><span>until the next session</span></div></a>';
  }

  function drawSoon() {
    var list = games.filter(function (g) { return !g.soon && g.seatsOpen > 0; }).sort(function (a, b) { return new Date(a.next) - new Date(b.next); }).slice(0, 3);
    $('hx-soon-sec').hidden = !list.length;
    var box = $('hx-soon');
    box.style.setProperty('--n', Math.max(1, list.length));
    box.innerHTML = list.map(soonCard).join('');
  }

  function drawGrid() {
    var list = games.filter(function (g) {
      if (cat === 'Seats open' && (g.soon || g.seatsOpen <= 0)) return false;
      if (cat !== 'All' && cat !== 'Seats open' && g.cat !== cat) return false;
      if (!q) return true;
      var m = gms[g.gm] || {};
      return (g.title + ' ' + g.eyebrow + ' ' + g.hook + ' ' + (m.name || '') + ' ' + g.cat).toLowerCase().indexOf(q) !== -1;
    });
    $('hx-grid').innerHTML = list.length ? list.map(card).join('') : '<div class="hx-empty"><b>No games match that yet.</b><br>Try a different word, or clear the filter.</div>';
    var who = {}; list.forEach(function (g) { who[g.gm] = 1; });
    var k = Object.keys(who).length;
    $('hx-count').textContent = list.length + (list.length === 1 ? ' game' : ' games') + ' from ' + k + (k === 1 ? ' game master' : ' game masters') + ', soonest first';
    $('hx-tables-h').textContent = cat === 'All' && !q ? 'All games' : (cat === 'All' ? 'Search results' : cat);
  }

  function drawChips() {
    var cats = ['All'], seen = {};
    CAT_ORDER.forEach(function (c) { if (games.some(function (g) { return g.cat === c; })) { cats.push(c); seen[c] = 1; } });
    // Any hand-typed tag that isn't one of the common ones above still gets its own chip.
    games.forEach(function (g) { if (!seen[g.cat]) { seen[g.cat] = 1; cats.push(g.cat); } });
    cats.push('Seats open');
    var box = $('hx-chips');
    box.innerHTML = '';
    cats.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'hx-chip' + (c === cat ? ' hx-on' : '');
      b.innerHTML = '<span>' + (CHIP_ICON[c] || GLYPH[c] || FALLBACK_GLYPH) + '</span>' + c;
      b.addEventListener('click', function () {
        cat = c;
        Array.prototype.forEach.call(box.children, function (x) { x.classList.toggle('hx-on', x === b); });
        drawGrid();
        $('tables').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      box.appendChild(b);
    });
  }

  function drawGms() {
    var list = Object.keys(gms).map(function (k) { return gms[k]; });
    $('hx-gm-row').innerHTML = list.map(function (m) {
      var n = m.games || 0;
      return '<a class="hx-gm" href="' + gmUrl(m) + '"><div class="hx-ring">' + avatar(m, 'hx-a') + '</div><b>' + esc(m.name) + '</b><small>' + esc(m.pronouns) + '</small>' +
        '<div class="hx-st">' + (m.reviews ? stars(m.rating) + ' ' + m.rating.toFixed(1) + ' <i>(' + m.reviews + ')</i>' : 'New') + '</div><small>' + (n ? n + (n === 1 ? ' open game' : ' open games') : 'No open games yet') + '</small></a>';
    }).join('');
  }

  function drawStats(s) {
    var box = $('hx-stats');
    box.innerHTML = [[s.gms, 'Game masters'], [s.openGames, 'Open games'], [s.seatsOpen, 'Seats open now'], [s.sessionsPlayed.toLocaleString(), 'Sessions played']]
      .map(function (x) { return '<div class="hx-stat"><b>' + x[0] + '</b><span>' + x[1] + '</span></div>'; }).join('');
    box.hidden = false;
  }

  $('hx-q').addEventListener('input', function (e) { q = e.target.value.trim().toLowerCase(); drawGrid(); });
  $('hx-go').addEventListener('click', function () { drawGrid(); $('tables').scrollIntoView({ behavior: 'smooth' }); });

  fetch(WORKER + '/home/public')
    .then(function (r) { if (!r.ok) throw new Error('no'); return r.json(); })
    .then(function (d) {
      d.gms.forEach(function (m) { gms[m.slug] = m; });
      games = d.games.map(function (g) { g.cat = g.tag || 'Adventure'; return g; }).sort(function (a, b) { return new Date(a.next) - new Date(b.next); });
      drawStats(d.stats);
      drawChips();
      drawSoon();
      drawGms();
      drawGrid();
      setInterval(drawSoon, 60000);
    })
    .catch(function () {
      $('hx-grid').innerHTML = '<div class="hx-empty"><b>The open tables could not be loaded right now.</b><br>Please refresh the page in a moment.</div>';
      $('hx-count').textContent = '';
    });
})();
