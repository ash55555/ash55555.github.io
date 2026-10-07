// The game masters directory: every game master on the site, with filters for name, pronouns, languages,
// game system, tools, the day they play and what a session costs. Everything comes from /home/public.
(function () {
  var WORKER = 'https://ash-tabletop-announcements.ash-tabletop.workers.dev';
  var SYSTEM_NAMES = ['D&D 5e', 'D&D 5.5 (2024)', 'Pathfinder 2e', 'Call of Cthulhu', 'Vampire: The Masquerade', 'Blades in the Dark', 'Starfinder', 'Shadowrun', 'Savage Worlds', 'Dungeon Crawl Classics'];
  var PRONOUN_CHIPS = [['she/her', ['she', 'her', 'hers']], ['he/him', ['he', 'him', 'his']], ['they/them', ['they', 'them', 'their']]];
  var DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  var all = [];
  var f = { q: '', pron: {}, lang: {}, sys: {}, tool: {}, day: {}, min: '', max: '' };

  function $(id) { return document.getElementById(id); }
  function esc(t) { var d = document.createElement('div'); d.textContent = t == null ? '' : t; return d.innerHTML; }
  function stars(r) { var n = Math.round(r); return '★'.repeat(n) + '☆'.repeat(5 - n); }
  function dayIndex(iso) { return (new Date(iso).getDay() + 6) % 7; } // Monday = 0, in the visitor's own time zone
  function words(p) { return String(p || '').toLowerCase().split(/[^a-z]+/).filter(Boolean); }
  function keyOf(s) { return String(s).trim().toLowerCase(); }
  function gmUrl(m) { return m.slug === 'ash' ? 'ash.html' : 'gm.html?slug=' + encodeURIComponent(m.slug); }

  function prepare(m) {
    m.dayset = {};
    (m.sessions || []).forEach(function (s) { m.dayset[dayIndex(s)] = 1; });
    m.toolsOnly = (m.tools || []).filter(function (t) { return SYSTEM_NAMES.indexOf(t) === -1; });
    return m;
  }

  function anyOn(group) { return Object.keys(group).some(function (k) { return group[k]; }); }
  function picked(group) { return Object.keys(group).filter(function (k) { return group[k]; }); }
  function hasAny(list, group) { var want = picked(group); if (!want.length) return true; var have = (list || []).map(keyOf); return want.some(function (w) { return have.indexOf(w) !== -1; }); }

  function matches(m) {
    if (f.q && (m.name + ' ' + (m.tagline || '')).toLowerCase().indexOf(f.q) === -1) return false;
    if (anyOn(f.pron)) {
      var w = words(m.pronouns);
      var ok = picked(f.pron).some(function (label) {
        if (label === 'other') return w.some(function (x) { return ['she', 'her', 'hers', 'he', 'him', 'his', 'they', 'them', 'their'].indexOf(x) === -1; });
        var chip = PRONOUN_CHIPS.filter(function (c) { return c[0] === label; })[0];
        return chip && chip[1].some(function (x) { return w.indexOf(x) !== -1; });
      });
      if (!ok) return false;
    }
    if (!hasAny(m.languages, f.lang)) return false;
    if (!hasAny(m.systems, f.sys)) return false;
    if (!hasAny(m.toolsOnly, f.tool)) return false;
    if (anyOn(f.day) && !picked(f.day).some(function (d) { return m.dayset[d]; })) return false;
    var lo = f.min === '' ? null : Number(f.min), hi = f.max === '' ? null : Number(f.max);
    if (lo !== null || hi !== null) {
      if (m.priceMin == null) return false; // no games, so no price to compare
      if (lo !== null && m.priceMax < lo) return false;
      if (hi !== null && m.priceMin > hi) return false;
    }
    return true;
  }

  function avatar(m) {
    var inner = m.avatar ? '<img src="' + esc(m.avatar) + '" alt="">' : (m.slug === 'ash' ? '<img src="medie/ash-token.png" alt="">' : '🎲');
    return '<div class="hx-ring"><span class="hx-a">' + inner + '</span></div>';
  }

  function dayText(m) {
    var d = Object.keys(m.dayset).map(Number).sort(function (a, b) { return a - b; });
    return d.length ? d.map(function (i) { return DAYS[i]; }).join(' · ') : 'No games scheduled yet';
  }
  function priceText(m) {
    if (m.priceMin == null) return '—';
    return m.priceMin === m.priceMax ? '$' + m.priceMin + ' / session' : '$' + m.priceMin + ' to $' + m.priceMax + ' / session';
  }

  function card(m) {
    var tiny = (m.systems || []).slice(0, 3).map(function (s) { return '<span>' + esc(s) + '</span>'; }).join('') +
      m.toolsOnly.slice(0, 3).map(function (t) { return '<span class="t">' + esc(t) + '</span>'; }).join('');
    return '<article class="gd-card"><a class="gd-stretch" href="' + gmUrl(m) + '" aria-label="Open ' + esc(m.name) + '\'s page"></a>' +
      '<div class="gd-head">' + avatar(m) + '<div class="gd-who"><h3>' + esc(m.name) + (m.you ? '<i>HOST</i>' : '') + '</h3>' +
        (m.pronouns ? '<div class="gd-pro">' + esc(m.pronouns) + '</div>' : '') +
        '<div class="gd-stars">' + (m.reviews ? stars(m.rating) + ' ' + m.rating.toFixed(1) + ' <i>(' + m.reviews + ')</i>' : '<i>New game master</i>') + '</div></div></div>' +
      '<p class="gd-tag">' + esc(m.tagline || 'Ready to tell a story with you.') + '</p>' +
      (tiny ? '<div class="gd-tiny">' + tiny + '</div>' : '') +
      '<div class="gd-facts">' +
        '<div><em>🗣</em><span>' + ((m.languages || []).length ? esc(m.languages.join(', ')) : 'Language not listed') + '</span></div>' +
        '<div><em>📅</em><span>' + esc(dayText(m)) + '</span></div>' +
        '<div><em>💲</em><span>' + esc(priceText(m)) + '</span></div>' +
        '<div><em>🎲</em><span><b>' + m.games + '</b> open ' + (m.games === 1 ? 'game' : 'games') + '</span></div>' +
      '</div><div class="gd-go">View page ›</div></article>';
  }

  function render() {
    var list = all.filter(matches);
    $('gd-grid').innerHTML = list.length ? list.map(card).join('') : '<div class="gd-empty"><b>No game master matches all of that.</b><br>Try removing a filter or two.</div>';
    $('gd-count').innerHTML = '<b>' + list.length + '</b> of ' + all.length + ' game ' + (all.length === 1 ? 'master' : 'masters');
  }

  function chipGroup(boxId, group, options, labelOf) {
    var box = $(boxId);
    if (!box) return;
    box.innerHTML = '';
    if (!options.length) { box.innerHTML = '<span class="gd-none">Nobody has listed any yet.</span>'; return; }
    options.forEach(function (o) {
      var key = o[0], label = o[1];
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'gd-chip' + (group[key] ? ' on' : '');
      b.textContent = label;
      b.addEventListener('click', function () { group[key] = !group[key]; b.classList.toggle('on', !!group[key]); render(); });
      box.appendChild(b);
    });
  }

  // The options are whatever the game masters on the site have really listed, most common first.
  function optionsFrom(getList) {
    var counts = {}, names = {};
    all.forEach(function (m) { getList(m).forEach(function (v) { var k = keyOf(v); if (!k) return; counts[k] = (counts[k] || 0) + 1; if (!names[k]) names[k] = v; }); });
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || names[a].localeCompare(names[b]); }).map(function (k) { return [k, names[k]]; });
  }

  function reset() {
    f = { q: '', pron: {}, lang: {}, sys: {}, tool: {}, day: {}, min: '', max: '' };
    $('gd-q').value = ''; $('gd-min').value = ''; $('gd-max').value = '';
    draw();
  }

  function draw() {
    chipGroup('gd-pron', f.pron, PRONOUN_CHIPS.map(function (c) { return [c[0], c[0]]; }).concat([['other', 'Other']]));
    chipGroup('gd-lang', f.lang, optionsFrom(function (m) { return m.languages || []; }));
    chipGroup('gd-sys', f.sys, optionsFrom(function (m) { return m.systems || []; }));
    chipGroup('gd-tool', f.tool, optionsFrom(function (m) { return m.toolsOnly; }));
    chipGroup('gd-day', f.day, DAYS.map(function (d, i) { return [i, d]; }));
    render();
  }

  $('gd-q').addEventListener('input', function (e) { f.q = e.target.value.trim().toLowerCase(); render(); });
  $('gd-min').addEventListener('input', function (e) { f.min = e.target.value; render(); });
  $('gd-max').addEventListener('input', function (e) { f.max = e.target.value; render(); });
  $('gd-reset').addEventListener('click', reset);
  var panel = $('gd-panel');
  if (panel && window.innerWidth > 700) panel.open = true;

  fetch(WORKER + '/home/public')
    .then(function (r) { if (!r.ok) throw new Error('no'); return r.json(); })
    .then(function (d) {
      all = d.gms.map(prepare);
      var start = new URLSearchParams(window.location.search).get('q');
      if (start) { f.q = start.toLowerCase(); $('gd-q').value = start; }
      draw();
    })
    .catch(function () {
      $('gd-grid').innerHTML = '<div class="gd-empty"><b>The game masters could not be loaded right now.</b><br>Please refresh the page in a moment.</div>';
    });
})();
