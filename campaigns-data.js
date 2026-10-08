// Optional live layer on top of the hardcoded session-chip buttons already
// in the page. If Ash hasn't set up Firebase yet (firebase-init.js still has
// placeholder config), this file does nothing and the hardcoded buttons on
// the page are exactly what visitors see, same as always.
//
// Once Firebase is configured and Ash has saved data from admin.html, this
// quietly updates the EXISTING chips in place (seat counts, full/paused
// state) instead of rebuilding them, so a slow network or a Firebase hiccup
// can never leave a campaign with zero visible buttons. Click behavior is
// untouched: every chip already opens Discord via setupSessionButtons() in
// script.js, and this file never attaches its own click handlers.
//
// New slots added from admin.html appear on the site the next time this
// page's markup is updated to include a matching button; deleting a slot in
// admin.html hides its chip here (see hideChip below) so removed slots never
// keep showing on the live pages between content updates.

document.addEventListener('DOMContentLoaded', function () {
  if (typeof firebase === 'undefined') return;
  if (typeof FIREBASE_CONFIG === 'undefined' || !FIREBASE_CONFIG.apiKey || FIREBASE_CONFIG.apiKey.indexOf('REPLACE_WITH') === 0) {
    return;
  }

  var chips = document.querySelectorAll('.session-chip[data-campaign]');
  if (!chips.length) return;

  function chipKey(chip) {
    return chip.dataset.campaign + '::' + (chip.dataset.slot || 'default');
  }
  function freqLabel(freq) {
    if (freq === 'biweekly') return 'Every other week, shown in your time zone';
    if (freq === 'once') return 'One-shot, shown in your time zone';
    return 'Weekly session, shown in your time zone';
  }

  // Players booked online through the new card system. The admin page's "filled"
  // number counts only players who are NOT booked online (the PayPal ones), so the
  // two are added together for the seat count visitors see.
  var WORKER_SEATS_URL = 'https://ash-tabletop-announcements.ash-tabletop.workers.dev/pay/seats';
  var onlineSeats = {};
  var lastData = null;

  var chipsByKey = {};
  chips.forEach(function (chip) {
    chipsByKey[chipKey(chip)] = chip;
  });

  function applySlotToChip(chip, slot) {
    var seatsEl = chip.querySelector('.session-seats');
    var subEl = chip.querySelector('.session-sub');
    var ctaEl = chip.querySelector('.session-chip-cta');
    var mainEl = chip.querySelector('.session-main');
    var groupEl = chip.querySelector('.session-group');

    // Admin.html can change the day/time, not just seats/paused state.
    // Keep the chip's own data-* in sync and recompute the displayed local
    // time the same way script.js's renderSessionChips() does, without
    // calling that function itself (it also re-reads the old hardcoded
    // SESSION_SEATS object, which would stomp the live seat text below).
    var offset = slot.offset != null ? slot.offset : 1;
    chip.dataset.day = slot.day;
    chip.dataset.hour = slot.hour;
    chip.dataset.minute = slot.minute || 0;
    chip.dataset.offset = offset;
    if (slot.source) chip.dataset.source = slot.source;
    if (groupEl && slot.group) groupEl.textContent = slot.group;

    var next = typeof nextOccurrenceUTC === 'function' ? nextOccurrenceUTC(slot.day, slot.hour, slot.minute || 0, offset, slot.freq, slot.anchor) : null;
    if (mainEl && next && typeof formatLocal === 'function') mainEl.textContent = formatLocal(next);

    chip.disabled = false;
    chip.classList.remove('is-full');
    chip.classList.remove('is-full-hidden');
    if (ctaEl) ctaEl.textContent = 'Join';

    if (slot.freq === 'once' && !next) {
      chip.disabled = true;
      chip.classList.add('is-full', 'is-full-hidden');
      if (subEl) subEl.textContent = 'This one-shot has already run';
      if (ctaEl) ctaEl.textContent = 'Ended';
      if (seatsEl) seatsEl.textContent = '';
      return;
    }

    if (slot.enabled === false) {
      chip.disabled = true;
      chip.classList.add('is-full');
      if (subEl) subEl.textContent = 'Not currently running';
      if (ctaEl) ctaEl.textContent = 'Paused';
      if (seatsEl) seatsEl.textContent = '';
      return;
    }

    if (subEl) {
      subEl.textContent = freqLabel(slot.freq);
    }

    if (typeof slot.max === 'number') {
      var seatKey = chip.dataset.campaign + (chip.dataset.slot ? '::' + chip.dataset.slot : '');
      var filled = (slot.filled || 0) + (onlineSeats[seatKey] || 0);
      var remaining = slot.max - filled;
      if (seatsEl) {
        seatsEl.textContent = remaining > 0
          ? remaining + ' seat' + (remaining === 1 ? '' : 's') + ' left (' + filled + '/' + slot.max + ')'
          : 'Full (' + filled + '/' + slot.max + ')';
      }
      if (remaining <= 0) {
        chip.classList.add('is-full');
        chip.disabled = true;
        if (ctaEl) ctaEl.textContent = 'Full';
        // A full group is not shown to visitors at all (it stays in the admin as usual).
        chip.classList.add('is-full-hidden');
      }
    }
    if (window.AshJoined) window.AshJoined.mark(chip);
  }

  function hideChip(chip) {
    chip.disabled = true;
    chip.classList.add('is-full');
    var seatsEl = chip.querySelector('.session-seats');
    var subEl = chip.querySelector('.session-sub');
    var ctaEl = chip.querySelector('.session-chip-cta');
    if (subEl) subEl.textContent = 'Not currently running';
    if (ctaEl) ctaEl.textContent = 'Paused';
    if (seatsEl) seatsEl.textContent = '';
  }

  function applyData(data) {
    if (!data) return;
    Object.keys(data).forEach(function (campaign) {
      var slots = data[campaign] && data[campaign].slots;
      if (!slots) return;

      var seenChips = [];
      Object.keys(slots).forEach(function (slotId) {
        var chip = chipsByKey[campaign + '::' + slotId];
        if (chip) {
          applySlotToChip(chip, slots[slotId]);
          seenChips.push(chip);
        }
      });

      // A slot deleted in admin.html has no matching Firebase entry anymore.
      // Hide its chip so removed sessions stop showing on the live page.
      chips.forEach(function (chip) {
        if (chip.dataset.campaign === campaign && seenChips.indexOf(chip) === -1) {
          hideChip(chip);
        }
      });
    });
  }

  try {
    firebase.database().ref('campaigns').on('value', function (snapshot) {
      lastData = snapshot.val();
      applyData(lastData);
    }, function (err) {
      console.error('Could not load live campaign data:', err);
    });
  } catch (e) {
    console.error('Firebase not configured yet:', e);
  }

  fetch(WORKER_SEATS_URL).then(function (r) { return r.json(); }).then(function (d) {
    onlineSeats = (d && d.seats) || {};
    if (lastData) applyData(lastData);
  }).catch(function () { /* the site still shows the manual seat counts */ });

  // Each campaign's own price and opening date (ash.html's price-tag on its card, or
  // a blog page's single blog-payment-price) are never in Firebase, only in the content
  // database, so they are fetched separately here rather than through applySlotToChip.
  var WORKER_CONTENT_URL = 'https://ash-tabletop-announcements.ash-tabletop.workers.dev/content/public?slug=';
  function openDateLong(ymd) {
    var p = ymd.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  }
  var seenSlugs = {};
  chips.forEach(function (chip) {
    var slug = chip.dataset.campaign;
    if (!slug || seenSlugs[slug]) return;
    seenSlugs[slug] = true;
    var card = chip.closest('.campaign-card');
    var priceEl = card ? card.querySelector('.price-tag') : document.querySelector('.blog-payment-price');
    if (!priceEl) return;
    fetch(WORKER_CONTENT_URL + encodeURIComponent(slug)).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || !(d.price > 0)) return;
      var money = '$' + (d.price % 1 === 0 ? d.price : d.price.toFixed(2)) + ' USD';
      priceEl.textContent = card ? money + ' / session' : money + ' per session · Session Zero is free';
      var opensLater = d.openMode === 'date' && d.openAt && new Date(d.openAt + 'T00:00:00Z').getTime() > Date.now();
      if (opensLater) {
        var note = priceEl.parentElement.querySelector('.cd-opens-note') || document.createElement(card ? 'span' : 'p');
        note.className = (card ? 'price-tag cd-opens-note' : 'blog-payment-opens cd-opens-note');
        note.textContent = 'Opens ' + openDateLong(d.openAt);
        if (!note.parentElement) priceEl.insertAdjacentElement('afterend', note);
      }
    }).catch(function () { /* the page keeps its original price text */ });
  });
});
