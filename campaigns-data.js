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

  var chipsByKey = {};
  chips.forEach(function (chip) {
    chipsByKey[chipKey(chip)] = chip;
  });

  function applySlotToChip(chip, slot) {
    var seatsEl = chip.querySelector('.session-seats');
    var subEl = chip.querySelector('.session-sub');
    var ctaEl = chip.querySelector('.session-chip-cta');

    chip.disabled = false;
    chip.classList.remove('is-full');
    if (ctaEl) ctaEl.textContent = 'Ask to Join';

    if (slot.enabled === false) {
      chip.disabled = true;
      chip.classList.add('is-full');
      if (subEl) subEl.textContent = 'Not currently running';
      if (ctaEl) ctaEl.textContent = 'Paused';
      if (seatsEl) seatsEl.textContent = '';
      return;
    }

    if (typeof slot.max === 'number') {
      var filled = slot.filled || 0;
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
      }
    }
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
      applyData(snapshot.val());
    }, function (err) {
      console.error('Could not load live campaign data:', err);
    });
  } catch (e) {
    console.error('Firebase not configured yet:', e);
  }
});
