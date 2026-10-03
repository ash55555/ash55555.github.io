// One place that decides which color belongs to which campaign.
//
// The five original campaigns use the accent of their blog page's theme (blog.css), which was
// picked from their banner picture. Any campaign added later (by Ash or by another DM) gets its
// color worked out automatically from its own banner picture, so it is treated exactly the same:
// the admin calendar uses it, and its blog page is tinted with it. Nothing needs to be edited
// by hand when a new campaign is created.
(function () {
  // Accent color of each hand-built theme in blog.css (the colorful one on each page).
  var KNOWN = {
    'curse-of-strahd': '#d9384f',          // theme-strahd: blood red
    'ravenloft-undead-survival': '#e0a83f', // theme-ravenloft: candle amber
    'crooked-moon': '#4fd1c5',             // theme-crooked-moon: moon teal
    'witchlight': '#b45cf0',               // theme-witchlight: fey purple
    'flying-city': '#7fd8e8'               // theme-flying-city: sky cyan
  };
  var SPARE = ['#f2b84f', '#7fd99a', '#ff9db0', '#9fb6ff', '#e6a8ff'];
  var CACHE = 'ash-campaign-colors-v1';

  function readCache() { try { return JSON.parse(localStorage.getItem(CACHE) || '{}'); } catch (e) { return {}; } }
  function writeCache(c) { try { localStorage.setItem(CACHE, JSON.stringify(c)); } catch (e) { /* private mode */ } }

  function hsl(h, s, l) { return 'hsl(' + Math.round(h) + ' ' + Math.round(s) + '% ' + Math.round(l) + '%)'; }
  function hashColor(slug) {
    var h = 0;
    for (var i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
    return SPARE[h % SPARE.length];
  }

  // The color a campaign should use right now (known, learned from its picture, or a stable fallback).
  function accent(slug) {
    if (KNOWN[slug]) return KNOWN[slug];
    var c = readCache()[slug];
    return c && c.color ? c.color : hashColor(slug);
  }

  // Looks at the banner and finds its most colorful, most common hue.
  function fromImage(url, done) {
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      try {
        var size = 48, cv = document.createElement('canvas');
        cv.width = cv.height = size;
        var ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0, size, size);
        var px = ctx.getImageData(0, 0, size, size).data;
        var buckets = [];
        for (var b = 0; b < 36; b++) buckets.push({ w: 0, s: 0, n: 0 });
        for (var i = 0; i < px.length; i += 4) {
          if (px[i + 3] < 200) continue;
          var r = px[i] / 255, g = px[i + 1] / 255, bl = px[i + 2] / 255;
          var mx = Math.max(r, g, bl), mn = Math.min(r, g, bl), l = (mx + mn) / 2, d = mx - mn;
          if (d < 0.12 || l < 0.12 || l > 0.9) continue; // skip grays, near-black and near-white
          var s = d / (1 - Math.abs(2 * l - 1));
          var h = mx === r ? ((g - bl) / d) % 6 : mx === g ? (bl - r) / d + 2 : (r - g) / d + 4;
          h = (h * 60 + 360) % 360;
          var weight = s * (1 - Math.abs(2 * l - 1));
          var k = Math.floor(h / 10) % 36;
          buckets[k].w += weight; buckets[k].s += s * weight; buckets[k].n++;
        }
        var best = 0;
        for (var j = 1; j < 36; j++) if (buckets[j].w > buckets[best].w) best = j;
        if (buckets[best].w <= 0) { done(null); return; }
        var hue = best * 10 + 5;
        done({ hue: hue, color: hsl(hue, 72, 62) });
      } catch (e) { done(null); } // the picture could not be read; keep the fallback color
    };
    img.onerror = function () { done(null); };
    img.src = url;
  }

  // Works out (and remembers) the color of a campaign that has no hand-made theme.
  function learn(slug, imageUrl, onReady) {
    if (KNOWN[slug] || !imageUrl) return;
    var cache = readCache();
    if (cache[slug] && cache[slug].url === imageUrl) { if (onReady) onReady(cache[slug].color, cache[slug].hue); return; }
    fromImage(imageUrl, function (res) {
      if (!res) return;
      cache[slug] = { url: imageUrl, color: res.color, hue: res.hue };
      writeCache(cache);
      if (onReady) onReady(res.color, res.hue);
    });
  }

  // A full dark page theme in the same shape as the hand-made ones in blog.css.
  function applyPageTheme(hue) {
    var s = document.body.style;
    s.setProperty('--bg', hsl(hue, 45, 5));
    s.setProperty('--bg-panel', hsl(hue, 40, 9));
    s.setProperty('--bg-panel-2', hsl(hue, 38, 12));
    s.setProperty('--purple', hsl(hue, 55, 46));
    s.setProperty('--purple-deep', hsl(hue, 55, 30));
    s.setProperty('--blue-accent', hsl(hue, 65, 68));
    s.setProperty('--text-muted', hsl(hue, 20, 70));
  }

  window.AshCampaignColors = { accent: accent, learn: learn, applyPageTheme: applyPageTheme, known: KNOWN };
})();
