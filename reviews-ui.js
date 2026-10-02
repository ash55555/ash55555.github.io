// Ash's profile card on the player page, with the review box underneath.
// Used by player.js. AshReviews.renderDmProfile(container, options) draws the
// whole card and redraws itself as the player picks stars and submits.
//
// options:
//   dm         { token, avatar } for Ash's token or picture
//   name, pronouns
//   state      { loading } | { error } | { signedIn:false, needed }
//              | { signedIn:true, sessions, needed, eligible, tags, review }
//   onSubmit   function({ rating, tags, comment }) returning a Promise of the saved review

var AshReviews = (function () {
  var DEFAULT_TAGS = [
    'Sets the mood', 'Always prepared', 'Great storyteller', 'Welcoming to everyone', 'Brings NPCs to life',
    'Keeps the pace moving', 'Explains rules clearly', 'Fair and flexible', 'Makes me feel safe', 'Rule of cool'
  ];
  var TOKENS = {
    dragon: { emoji: '🐉', color: '#6b46c1' },
    wizard: { emoji: '🧙', color: '#2f5fa8' },
    dagger: { emoji: '🗡️', color: '#8a3b3b' },
    elf: { emoji: '🧝', color: '#2f7a5a' },
    bat: { emoji: '🦇', color: '#4a3a6b' },
    dice: { emoji: '🎲', color: '#a8702f' }
  };
  var STAR_WORDS = ['', 'Not for me', 'It was okay', 'Good', 'Great', 'Amazing'];
  var MAX_COMMENT = 600;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function makeToken(dm) {
    var t = el('div', 'rv-token');
    t.setAttribute('aria-hidden', 'true');
    if (dm && dm.avatar) {
      var img = document.createElement('img');
      img.src = dm.avatar;
      img.alt = '';
      t.appendChild(img);
    } else {
      var tk = TOKENS[dm && dm.token] || TOKENS.dragon;
      t.style.background = tk.color;
      t.textContent = tk.emoji;
    }
    return t;
  }

  function starRow(rating) {
    var row = el('span', 'rv-stars-static');
    row.setAttribute('aria-label', rating + ' out of 5 stars');
    for (var i = 1; i <= 5; i++) row.appendChild(el('span', 'rv-star' + (i <= rating ? ' on' : ''), '★'));
    return row;
  }

  function renderDmProfile(container, opts) {
    var local = { editing: false, thanks: false, review: null, deleted: false, confirmingDelete: false, notice: '' };
    var form = { rating: 0, tags: [], comment: '', show: true };

    function draw() {
      container.innerHTML = '';
      var state = opts.state || {};

      var head = el('div', 'rv-head');
      head.appendChild(makeToken(opts.dm));
      var who = el('div', 'rv-who');
      var title = el('h3', null, opts.name || 'Ash');
      title.id = 'pp-dm-title';
      who.appendChild(title);
      var sub = el('div', 'rv-sub');
      if (opts.pronouns) sub.appendChild(el('span', 'pp-pronouns', opts.pronouns));
      sub.appendChild(el('span', 'rv-role', 'Dungeon Master'));
      who.appendChild(sub);
      head.appendChild(who);
      container.appendChild(head);

      var section = el('div', 'rv-section');
      container.appendChild(section);
      section.appendChild(el('h4', null, 'Reviews'));

      if (state.loading) { section.appendChild(el('p', 'rv-muted', 'Loading...')); return; }
      if (state.error) { section.appendChild(el('p', 'rv-muted', 'We could not load the review box right now. Please try again in a moment.')); return; }

      var needed = state.needed || 5;
      if (!state.signedIn) {
        section.appendChild(el('p', 'rv-muted', 'Log in and play ' + needed + ' sessions with ' + 'Ash' + ' to leave a review.'));
        return;
      }

      var review = local.deleted ? null : (local.review || state.review);
      var sessions = state.sessions || 0;

      if (!state.eligible) {
        section.appendChild(el('p', 'rv-muted', 'You have played ' + sessions + ' of ' + needed + ' sessions with ' + 'Ash' + '. After ' + needed + ' sessions you can leave a review here.'));
        var bar = el('div', 'rv-progress');
        var fill = el('div', 'rv-progress-fill');
        fill.style.width = Math.min(100, (sessions / needed) * 100) + '%';
        bar.appendChild(fill);
        section.appendChild(bar);
        return;
      }

      if (review && !local.editing) {
        if (local.thanks) section.appendChild(el('p', 'rv-thanks', 'Thank you! Your review was sent to ' + 'Ash' + '.'));
        else section.appendChild(el('p', 'rv-muted', 'Your review. Thank you for sharing it!'));
        var card = el('div', 'rv-mine');
        card.appendChild(starRow(review.rating));
        if (review.tags && review.tags.length) {
          var tl = el('div', 'rv-tags rv-tags-static');
          review.tags.forEach(function (t) { tl.appendChild(el('span', 'rv-tag on', t)); });
          card.appendChild(tl);
        }
        if (review.comment) card.appendChild(el('p', 'rv-comment', '“' + review.comment + '”'));
        card.appendChild(el('p', 'rv-visibility', review.show === false ? 'Only Ash can see this.' : 'Shown on Ash’s website.'));
        section.appendChild(card);
        var edit = el('button', 'btn btn-ghost rv-edit', 'Edit your review');
        edit.type = 'button';
        edit.addEventListener('click', function () {
          local.editing = true; local.thanks = false;
          form = { rating: review.rating, tags: (review.tags || []).slice(), comment: review.comment || '', show: review.show !== false };
          draw();
        });
        var actions = el('div', 'rv-actions');
        actions.appendChild(edit);
        if (opts.onDelete && !local.confirmingDelete) {
          var del = el('button', 'btn btn-ghost rv-delete', 'Delete my review');
          del.type = 'button';
          del.addEventListener('click', function () { local.confirmingDelete = true; draw(); });
          actions.appendChild(del);
        }
        section.appendChild(actions);

        if (opts.onDelete && local.confirmingDelete) {
          var box = el('div', 'rv-confirm');
          box.appendChild(el('p', null, 'Delete your review? It will also come off Ash\u2019s website. This cannot be undone.'));
          var yes = el('button', 'btn rv-danger', 'Yes, delete it');
          yes.type = 'button';
          var no = el('button', 'btn btn-ghost', 'Keep it');
          no.type = 'button';
          var st = el('span', 'rv-status');
          no.addEventListener('click', function () { local.confirmingDelete = false; draw(); });
          yes.addEventListener('click', function () {
            yes.disabled = true; no.disabled = true;
            st.textContent = 'Deleting...';
            st.className = 'rv-status';
            Promise.resolve(opts.onDelete())
              .then(function () {
                local.deleted = true; local.review = null; local.confirmingDelete = false;
                local.editing = false; local.thanks = false; local.notice = 'Your review was deleted.';
                form = { rating: 0, tags: [], comment: '', show: true };
                draw();
              })
              .catch(function (err) {
                st.textContent = (err && err.message) || 'Something went wrong. Please try again.';
                st.className = 'rv-status error';
                yes.disabled = false; no.disabled = false;
              });
          });
          box.appendChild(yes);
          box.appendChild(no);
          box.appendChild(st);
          section.appendChild(box);
        }
        return;
      }

      // The form (new review, or editing an existing one)
      if (local.notice) section.appendChild(el('p', 'rv-thanks', local.notice));
      section.appendChild(el('p', 'rv-lead', 'How was your game?'));
      section.appendChild(el('p', 'rv-muted', state.testMode
        ? 'You are Ash, so this box is open to you for testing. Everyone else sees it after ' + needed + ' sessions.'
        : 'You have played ' + sessions + ' sessions with Ash. Tell us how it has been.'));

      var starsWrap = el('div', 'rv-stars');
      starsWrap.setAttribute('role', 'radiogroup');
      starsWrap.setAttribute('aria-label', 'Star rating');
      var word = el('div', 'rv-star-word', form.rating ? STAR_WORDS[form.rating] : 'Pick a rating');
      var starBtns = [];
      function paint(upTo) {
        starBtns.forEach(function (b, i) { b.classList.toggle('on', i < upTo); });
      }
      for (var i = 1; i <= 5; i++) {
        (function (n) {
          var b = el('button', 'rv-star-btn', '★');
          b.type = 'button';
          b.setAttribute('role', 'radio');
          b.setAttribute('aria-checked', String(form.rating === n));
          b.setAttribute('aria-label', n + ' star' + (n === 1 ? '' : 's') + ', ' + STAR_WORDS[n]);
          b.addEventListener('mouseenter', function () { paint(n); word.textContent = STAR_WORDS[n]; });
          b.addEventListener('mouseleave', function () { paint(form.rating); word.textContent = form.rating ? STAR_WORDS[form.rating] : 'Pick a rating'; });
          b.addEventListener('click', function () {
            form.rating = n; paint(n); word.textContent = STAR_WORDS[n];
            starBtns.forEach(function (x, idx) { x.setAttribute('aria-checked', String(idx + 1 === n)); });
            sync();
          });
          starBtns.push(b);
          starsWrap.appendChild(b);
        })(i);
      }
      paint(form.rating);
      section.appendChild(starsWrap);
      section.appendChild(word);

      var tagsHead = el('p', 'rv-lead rv-lead-sm');
      tagsHead.appendChild(document.createTextNode('What does ' + 'Ash' + ' do best? '));
      tagsHead.appendChild(el('span', 'rv-muted', 'Pick any that fit'));
      section.appendChild(tagsHead);
      var tagWrap = el('div', 'rv-tags');
      (state.tags && state.tags.length ? state.tags : DEFAULT_TAGS).forEach(function (t) {
        var b = el('button', 'rv-tag' + (form.tags.indexOf(t) !== -1 ? ' on' : ''), t);
        b.type = 'button';
        b.setAttribute('aria-pressed', String(form.tags.indexOf(t) !== -1));
        b.addEventListener('click', function () {
          var at = form.tags.indexOf(t);
          if (at === -1) form.tags.push(t); else form.tags.splice(at, 1);
          b.classList.toggle('on', at === -1);
          b.setAttribute('aria-pressed', String(at === -1));
        });
        tagWrap.appendChild(b);
      });
      section.appendChild(tagWrap);

      var label = el('label', 'rv-lead rv-lead-sm', 'Anything else you would like to say? ');
      label.appendChild(el('span', 'rv-muted', '(optional)'));
      label.setAttribute('for', 'rv-comment');
      section.appendChild(label);
      var ta = document.createElement('textarea');
      ta.id = 'rv-comment';
      ta.rows = 3;
      ta.maxLength = MAX_COMMENT;
      ta.placeholder = 'A favorite moment, what you like about the table, anything at all.';
      ta.value = form.comment;
      var count = el('div', 'rv-count', form.comment.length + ' / ' + MAX_COMMENT);
      ta.addEventListener('input', function () { form.comment = ta.value; count.textContent = ta.value.length + ' / ' + MAX_COMMENT; });
      section.appendChild(ta);
      section.appendChild(count);

      var showRow = el('label', 'rv-show');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = form.show;
      cb.addEventListener('change', function () { form.show = cb.checked; });
      showRow.appendChild(cb);
      showRow.appendChild(el('span', null, 'Show my review on Ash’s website, with my name and picture'));
      section.appendChild(showRow);

      var foot = el('div', 'rv-foot');
      var send = el('button', 'btn btn-primary', local.editing ? 'Save changes' : 'Send review');
      send.type = 'button';
      var status = el('span', 'rv-status');
      foot.appendChild(send);
      if (local.editing) {
        var cancel = el('button', 'btn btn-ghost', 'Cancel');
        cancel.type = 'button';
        cancel.addEventListener('click', function () { local.editing = false; draw(); });
        foot.appendChild(cancel);
      }
      foot.appendChild(status);
      section.appendChild(foot);
      section.appendChild(el('p', 'rv-note', 'Your review always goes to Ash. If the box above is ticked, it also appears on Ash’s website. Untick it to keep it private.'));

      function sync() { send.disabled = !form.rating; }
      sync();

      send.addEventListener('click', function () {
        if (!form.rating) return;
        send.disabled = true;
        status.textContent = 'Sending...';
        status.className = 'rv-status';
        Promise.resolve(opts.onSubmit({ rating: form.rating, tags: form.tags.slice(), comment: form.comment.trim(), show: form.show }))
          .then(function (saved) {
            local.review = saved || { rating: form.rating, tags: form.tags.slice(), comment: form.comment.trim(), show: form.show };
            local.editing = false; local.thanks = true; local.deleted = false; local.notice = '';
            draw();
          })
          .catch(function (err) {
            status.textContent = (err && err.message) || 'Something went wrong. Please try again.';
            status.className = 'rv-status error';
            sync();
          });
      });
    }

    draw();
  }

  return { renderDmProfile: renderDmProfile, DEFAULT_TAGS: DEFAULT_TAGS };
})();
