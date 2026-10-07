// Game master themes: the colors and fonts a Game Master picks for their own page (like a blog theme).
// Used by the profile editor (live preview) and by every profile page (gm.html, ash.html).
(function () {
  var PRESETS = [
    { id: 'classic', label: 'Classic night', bg: '#120b1c', glowA: '#7b4dff', glowB: '#2cc6ff', accent: '#f2b84f' },
    { id: 'ember', label: 'Ember', bg: '#1a0b08', glowA: '#ff5a1f', glowB: '#ffb347', accent: '#ff8a3d' },
    { id: 'ocean', label: 'Deep ocean', bg: '#06141f', glowA: '#1f8fff', glowB: '#19d3c5', accent: '#5ee0ff' },
    { id: 'forest', label: 'Old forest', bg: '#0a1a10', glowA: '#2ea85a', glowB: '#b5d93d', accent: '#9be564' },
    { id: 'rose', label: 'Rose quartz', bg: '#1d0c18', glowA: '#ff4d94', glowB: '#ff9bd0', accent: '#ff7ab6' },
    { id: 'violet', label: 'Violet dream', bg: '#140b26', glowA: '#a259ff', glowB: '#ff6ad5', accent: '#d6a8ff' },
    { id: 'gold', label: 'Midnight gold', bg: '#0b0b14', glowA: '#3b3b8f', glowB: '#c9a227', accent: '#f2c14e' },
    { id: 'blood', label: 'Blood moon', bg: '#160508', glowA: '#c1121f', glowB: '#6a0f3b', accent: '#ff4d5e' },
    { id: 'parchment', label: 'Parchment', bg: '#f4ecd8', glowA: '#d9a441', glowB: '#b5651d', accent: '#8a3b1f' },
    { id: 'mono', label: 'Ink and paper', bg: '#0e0e0e', glowA: '#5c5c5c', glowB: '#a8a8a8', accent: '#ffffff' }
  ];
  // Fonts for names and taglines. google is the name Google Fonts knows it by (loaded only when someone uses it).
  var FONTS = [
    { id: 'poppins', label: 'Poppins (standard)', family: "'Poppins', 'Segoe UI', sans-serif", google: '' },
    { id: 'cinzel', label: 'Cinzel (fantasy serif)', family: "'Cinzel', serif", google: 'Cinzel:wght@600;800' },
    { id: 'playfair', label: 'Playfair (elegant)', family: "'Playfair Display', serif", google: 'Playfair+Display:wght@700;900' },
    { id: 'medieval', label: 'MedievalSharp', family: "'MedievalSharp', cursive", google: 'MedievalSharp' },
    { id: 'uncial', label: 'Uncial Antiqua', family: "'Uncial Antiqua', cursive", google: 'Uncial+Antiqua' },
    { id: 'creepster', label: 'Creepster (spooky)', family: "'Creepster', cursive", google: 'Creepster' },
    { id: 'pacifico', label: 'Pacifico (script)', family: "'Pacifico', cursive", google: 'Pacifico' },
    { id: 'lobster', label: 'Lobster', family: "'Lobster', cursive", google: 'Lobster' },
    { id: 'caveat', label: 'Caveat (handwritten)', family: "'Caveat', cursive", google: 'Caveat:wght@600;700' },
    { id: 'bungee', label: 'Bungee (bold signs)', family: "'Bungee', sans-serif", google: 'Bungee' },
    { id: 'orbitron', label: 'Orbitron (sci-fi)', family: "'Orbitron', sans-serif", google: 'Orbitron:wght@600;900' },
    { id: 'pixel', label: 'Press Start 2P (pixel)', family: "'Press Start 2P', monospace", google: 'Press+Start+2P' },
    { id: 'righteous', label: 'Righteous', family: "'Righteous', sans-serif", google: 'Righteous' },
    { id: 'fredoka', label: 'Fredoka (round, friendly)', family: "'Fredoka', sans-serif", google: 'Fredoka:wght@500;700' }
  ];
  var HEX = /^#[0-9a-fA-F]{6}$/;

  function byId(list, id) { return list.filter(function (x) { return x.id === id; })[0] || null; }
  function rgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  function hex(c) { return '#' + c.map(function (v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? '0' : '') + v.toString(16); }).join(''); }
  function mix(a, b, t) { var x = rgb(a), y = rgb(b); return hex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]); }
  function rgba(h, a) { var c = rgb(h); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function lum(h) { var c = rgb(h).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }

  // A clean theme from whatever is saved (anything missing falls back to the classic look).
  function clean(t) {
    t = t || {};
    var base = PRESETS[0];
    function col(v, d) { return HEX.test(v || '') ? String(v).toLowerCase() : d; }
    return {
      preset: byId(PRESETS, t.preset) ? t.preset : (t.bg ? 'custom' : 'classic'),
      bg: col(t.bg, base.bg), glowA: col(t.glowA, base.glowA), glowB: col(t.glowB, base.glowB), accent: col(t.accent, base.accent),
      nameFont: byId(FONTS, t.nameFont) ? t.nameFont : 'poppins', tagFont: byId(FONTS, t.tagFont) ? t.tagFont : 'poppins'
    };
  }
  function isDefault(t) { var c = clean(t), b = PRESETS[0]; return c.bg === b.bg && c.glowA === b.glowA && c.glowB === b.glowB && c.accent === b.accent && c.nameFont === 'poppins' && c.tagFont === 'poppins'; }

  // The CSS custom properties that carry a theme.
  function vars(theme) {
    var t = clean(theme), light = lum(t.bg) > 0.45;
    var text = light ? '#231a33' : '#f3eefc';
    var nameFont = byId(FONTS, t.nameFont), tagFont = byId(FONTS, t.tagFont);
    return {
      '--t-bg': t.bg,
      '--t-text': text,
      '--t-muted': mix(text, t.bg, 0.38),
      '--t-panel': light ? mix(t.bg, '#ffffff', 0.5) : mix(t.bg, '#ffffff', 0.06),
      '--t-panel2': light ? mix(t.bg, '#000000', 0.07) : mix(t.bg, '#ffffff', 0.12),
      '--t-top': mix(t.bg, t.glowA, light ? 0.3 : 0.38),
      '--t-header': rgba(t.bg, 0.88),
      '--t-glow-a': t.glowA,
      '--t-glow-a-deep': mix(t.glowA, '#000000', 0.3),
      '--t-glow-a-soft': rgba(t.glowA, 0.45),
      '--t-glow-b': t.glowB,
      '--t-glow-b-soft': rgba(t.glowB, 0.4),
      '--t-accent-soft': rgba(t.accent, 0.28),
      '--t-cover-end': mix(t.bg, light ? '#ffffff' : '#000000', 0.25),
      '--t-accent': t.accent,
      '--t-accent-deep': mix(t.accent, '#000000', 0.22),
      '--t-on-accent': lum(t.accent) > 0.45 ? '#1a1206' : '#ffffff',
      '--t-glass1': light ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.2)',
      '--t-glass2': light ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.06)',
      '--t-edge': light ? 'rgba(0,0,0,0.16)' : 'rgba(255,255,255,0.28)',
      '--t-name-font': nameFont.family,
      '--t-tag-font': tagFont.family
    };
  }

  // The rules that make a whole profile page wear the theme.
  var PAGE_CSS = [
    ':root { --bg: var(--t-bg); --bg-panel: var(--t-panel); --bg-panel-2: var(--t-panel2); --gold: var(--t-accent); --purple: var(--t-glow-a); --purple-deep: var(--t-glow-a-deep); --blue-accent: var(--t-glow-b); --text: var(--t-text); --text-muted: var(--t-muted); --border: var(--t-edge); }',
    'body { background: radial-gradient(ellipse 120% 60% at 50% -10%, var(--t-top) 0%, var(--t-bg) 55%) fixed; color: var(--t-text); }',
    '.site-header { background: var(--t-header); }',
    '.btn-primary, .nav-cta { background: linear-gradient(135deg, var(--t-accent), var(--t-accent-deep)); color: var(--t-on-accent); }',
    '.btn-discord { background: linear-gradient(135deg, var(--t-glow-a), var(--t-glow-a-deep)); color: #fff; }',
    '.profile-name { font-family: var(--t-name-font); }',
    '.profile-tagline { font-family: var(--t-tag-font); background: linear-gradient(90deg, var(--t-accent), var(--t-glow-b) 55%, var(--t-glow-a)); -webkit-background-clip: text; background-clip: text; color: transparent; }',
    '.profile-role { background: var(--t-accent); color: var(--t-on-accent); }',
    '.profile-cover:not([data-has-img]) { background: radial-gradient(60% 140% at 15% 0%, var(--t-glow-a-soft), transparent 62%), radial-gradient(50% 120% at 85% 10%, var(--t-glow-b-soft), transparent 60%), radial-gradient(40% 100% at 55% 100%, var(--t-accent-soft), transparent 70%), linear-gradient(135deg, var(--t-top), var(--t-cover-end)); }',
    '.profile-platforms, .profile-socials-title, .hero-tables-title { color: var(--t-accent); }',
    '.profile-avatar .hero-glow { background: radial-gradient(circle, var(--t-glow-a-soft), transparent 70%); }',
    '.info-strip::before { background: radial-gradient(34% 70% at 12% 30%, var(--t-glow-a), transparent 70%), radial-gradient(30% 70% at 42% 78%, var(--t-glow-b), transparent 70%), radial-gradient(32% 70% at 70% 25%, var(--t-glow-a), transparent 70%), radial-gradient(28% 65% at 92% 75%, var(--t-accent), transparent 70%); opacity: .7; }',
    '.info-tile { background: linear-gradient(135deg, var(--t-glass1) 0%, var(--t-glass2) 55%, var(--t-glass1) 100%); border-color: var(--t-edge); }',
    '.info-tile:nth-child(n) { --tc1: var(--t-accent); --tc2: var(--t-glow-b); }',
    '.contact-inner h2, .section-head h2, .campaign-card h3, .review-card .review-author { color: var(--t-text); }',
    '.eyebrow { color: var(--t-accent); }',
    '.campaign-card, .review-card { background: var(--t-panel); border-color: var(--t-edge); }',
    '.site-footer { background: var(--t-panel); }'
  ].join('\n');

  var loaded = {};
  function loadFonts(list) {
    list.forEach(function (id) {
      var f = byId(FONTS, id);
      if (!f || !f.google || loaded[id]) return;
      loaded[id] = true;
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=' + f.google + '&display=swap';
      document.head.appendChild(link);
    });
  }

  function setVars(el, theme) {
    var v = vars(theme);
    Object.keys(v).forEach(function (k) { el.style.setProperty(k, v[k]); });
  }

  // Dresses the whole page (a visitor looking at a Game Master's profile).
  function apply(theme) {
    var style = document.getElementById('gm-theme-style');
    if (!theme || isDefault(theme)) {
      if (style) style.remove();
      document.documentElement.removeAttribute('style');
      return;
    }
    var t = clean(theme);
    loadFonts([t.nameFont, t.tagFont]);
    setVars(document.documentElement, t);
    if (!style) { style = document.createElement('style'); style.id = 'gm-theme-style'; document.head.appendChild(style); }
    style.textContent = PAGE_CSS;
  }

  // Dresses one element only (the live preview in the editor).
  function applyTo(el, theme) {
    var t = clean(theme);
    loadFonts([t.nameFont, t.tagFont]);
    setVars(el, t);
  }

  window.GmTheme = { PRESETS: PRESETS, FONTS: FONTS, clean: clean, isDefault: isDefault, vars: vars, apply: apply, applyTo: applyTo, loadFonts: loadFonts, byId: byId, lum: lum };
})();
