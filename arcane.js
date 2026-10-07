// The glow behind the top of the home page and the game masters page: two slowly turning magic circles
// and embers drifting upwards, like a spell being cast over the table.
(function () {
  var hero = document.querySelector('.hx-hero');
  if (!hero) return;

  var seed = 20261008;
  function rnd() { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }
  function pt(r, deg) { var a = deg * Math.PI / 180; return [(r * Math.cos(a)).toFixed(2), (r * Math.sin(a)).toFixed(2)]; }
  function poly(r, n, start) { var out = []; for (var i = 0; i < n; i++) { var p = pt(r, start + i * 360 / n); out.push(p[0] + ',' + p[1]); } return out.join(' '); }

  // One magic circle, drawn in three layers that turn at different speeds.
  function circle(id) {
    var ticks = '';
    for (var i = 0; i < 72; i++) { var a = pt(89, i * 5), b = pt(i % 6 === 0 ? 96 : 93, i * 5); ticks += '<line x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] + '"/>'; }
    var marks = '';
    for (var k = 0; k < 16; k++) {
      var c = pt(81, k * 22.5), t = pt(76, k * 22.5), u = pt(86, k * 22.5);
      marks += (k % 2 === 0
        ? '<polygon points="' + pt(84, k * 22.5 - 3).join(',') + ' ' + pt(78, k * 22.5).join(',') + ' ' + pt(84, k * 22.5 + 3).join(',') + '"/>'
        : '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="1.3"/>') + '<line x1="' + t[0] + '" y1="' + t[1] + '" x2="' + u[0] + '" y2="' + u[1] + '" class="hx-faint"/>';
    }
    return '<svg viewBox="-100 -100 200 200" aria-hidden="true"><defs><linearGradient id="hxg' + id + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd98a"/><stop offset=".55" stop-color="#ff9db0"/><stop offset="1" stop-color="#9b8cff"/></linearGradient></defs>' +
      '<g class="hx-spin hx-s1" stroke="url(#hxg' + id + ')"><circle r="97"/><circle r="88" class="hx-dash"/>' + ticks + '</g>' +
      '<g class="hx-spin hx-s2" stroke="url(#hxg' + id + ')"><circle r="74"/>' + marks + '</g>' +
      '<g class="hx-spin hx-s3" stroke="url(#hxg' + id + ')"><circle r="62"/><polygon points="' + poly(62, 3, -90) + '"/><polygon points="' + poly(62, 3, 90) + '"/><circle r="34"/><polygon points="' + poly(34, 6, 0) + '"/><circle r="10" class="hx-core"/></g></svg>';
  }

  var glow = document.createElement('div');
  glow.className = 'hx-arcane';
  glow.setAttribute('aria-hidden', 'true');

  var embers = '';
  for (var i = 0; i < 38; i++) {
    var size = (2 + rnd() * 3.5).toFixed(1);
    embers += '<i class="hx-ember" style="left:' + (rnd() * 100).toFixed(1) + '%;width:' + size + 'px;height:' + size + 'px;--t:' + (9 + rnd() * 10).toFixed(1) + 's;--w:-' + (rnd() * 18).toFixed(1) + 's;--x:' + ((rnd() - 0.5) * 120).toFixed(0) + 'px"></i>';
  }

  glow.innerHTML = '<div class="hx-circle hx-c-left">' + circle('a') + '</div><div class="hx-circle hx-c-right">' + circle('b') + '</div><div class="hx-embers">' + embers + '</div>';
  hero.insertBefore(glow, hero.firstChild);
})();
