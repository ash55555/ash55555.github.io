// All campaign session times in the HTML are authored in a fixed GMT+1 (UTC+1)
// reference. This finds each session's next real-world occurrence in UTC, then
// lets the browser render it in the visitor's own local timezone automatically.

function nextOccurrenceUTC(sourceDay, sourceHour, minute, offsetHours) {
  let utcHour = sourceHour - offsetHours;
  let dayShift = 0;
  if (utcHour < 0) {
    utcHour += 24;
    dayShift = -1;
  } else if (utcHour >= 24) {
    utcHour -= 24;
    dayShift = 1;
  }
  const utcDay = (sourceDay + dayShift + 7) % 7;
  const now = new Date();

  for (let i = 0; i < 8; i++) {
    const candidate = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + i,
      utcHour,
      minute,
      0,
      0
    ));
    if (candidate.getUTCDay() === utcDay && candidate.getTime() > now.getTime()) {
      return candidate;
    }
  }
  return null;
}

function formatLocal(date) {
  const weekday = date.toLocaleDateString(undefined, { weekday: 'long' });
  const monthDay = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  let tzName = '';
  try {
    const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(date);
    const tzPart = parts.find((p) => p.type === 'timeZoneName');
    if (tzPart) tzName = tzPart.value;
  } catch (err) {
    /* Intl.timeZoneName unsupported — fall back to no suffix */
  }

  return `Next: ${weekday}, ${monthDay} · ${time}${tzName ? ' ' + tzName : ''}`;
}

function renderSessionChips() {
  document.querySelectorAll('.session-chip').forEach((chip) => {
    const day = parseInt(chip.dataset.day, 10);
    const hour = parseInt(chip.dataset.hour, 10);
    const minute = parseInt(chip.dataset.minute, 10);
    const offset = parseFloat(chip.dataset.offset || '1');
    const source = chip.dataset.source || '';

    const next = nextOccurrenceUTC(day, hour, minute, offset);
    const mainEl = chip.querySelector('.session-main');
    const subEl = chip.querySelector('.session-sub');

    if (next && mainEl) {
      mainEl.textContent = formatLocal(next);
    }
    if (subEl) {
      subEl.textContent = source ? `Weekly session · originally ${source}` : 'Weekly session';
    }
  });
}

function setupNavToggle() {
  const toggle = document.querySelector('.nav-toggle');
  const links = document.querySelector('.nav-links');
  if (!toggle || !links) return;

  toggle.addEventListener('click', () => {
    const isOpen = links.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(isOpen));
  });

  links.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      links.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    });
  });
}

function setupReserveButtons() {
  document.querySelectorAll('.js-reserve').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      if (window.Tawk_API && typeof window.Tawk_API.maximize === 'function') {
        event.preventDefault();
        window.Tawk_API.maximize();
      }
      // If the widget hasn't finished loading yet, let the link fall through
      // to #contact instead of doing nothing.
    });
  });
}

// Contact form endpoint (Formspree or similar). The destination inbox lives
// entirely in that service's own dashboard — never in this file or the HTML —
// so Ash's address is never present in the site's source.
// TODO: replace with the real endpoint once Ash creates a Formspree form.
const CONTACT_FORM_ENDPOINT = 'https://formspree.io/f/REPLACE_WITH_YOUR_FORM_ID';

// PayPal links per campaign slug. Filled in once Ash sends the real
// subscription links — until then, "Pay with PayPal" buttons fall back to chat.
const PAYPAL_LINKS = {
  'flying-city': null,
  'curse-of-strahd': null,
  'ravenloft-undead-survival': null,
  'crooked-moon': null,
  'witchlight': null,
};

// Subscribe links per individual session slot (campaign + group, where a
// campaign runs more than one weekly slot). Filled in once Ash has a
// subscription link per slot — until then, clicking a time slot falls back
// to chat so players can still ask about that specific slot.
const SESSION_SUBSCRIBE_LINKS = {
  'flying-city': null,
  'curse-of-strahd::A': null,
  'curse-of-strahd::B': null,
  'ravenloft-undead-survival': null,
  'crooked-moon::A': null,
  'crooked-moon::B': null,
  'crooked-moon::C': null,
  'witchlight': null,
};

function openChatFallback() {
  if (window.Tawk_API && typeof window.Tawk_API.maximize === 'function') {
    window.Tawk_API.maximize();
  }
}

function sessionKey(campaign, slot) {
  return slot ? `${campaign}::${slot}` : campaign;
}

function setupSessionButtons() {
  document.querySelectorAll('.session-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const key = sessionKey(chip.dataset.campaign, chip.dataset.slot);
      const link = SESSION_SUBSCRIBE_LINKS[key];
      if (link) {
        window.open(link, '_blank', 'noopener');
        return;
      }
      openChatFallback();
    });
  });
}

function setupClickableCards() {
  document.querySelectorAll('[data-href]').forEach((card) => {
    card.addEventListener('click', (event) => {
      if (event.target.closest('a, button')) return;
      window.location.href = card.dataset.href;
    });
  });
}

function setupPaypalButtons() {
  document.querySelectorAll('.js-paypal').forEach((btn) => {
    const slug = btn.dataset.campaign;
    const link = PAYPAL_LINKS[slug];

    if (link) {
      btn.href = link;
      btn.target = '_blank';
      btn.rel = 'noopener';
      return;
    }

    btn.addEventListener('click', (event) => {
      event.preventDefault();
      const note = btn.parentElement.querySelector('.paypal-note');
      if (note) note.textContent = 'Payment link coming soon — opening chat so you can reserve your seat directly.';
      openChatFallback();
    });
  });
}

function setupEmailModal() {
  const trigger = document.querySelector('.js-email-trigger');
  const modal = document.getElementById('email-modal');
  if (!trigger || !modal) return;

  const form = modal.querySelector('#email-form');
  const status = modal.querySelector('.modal-status');
  const closeEls = modal.querySelectorAll('.js-modal-close');
  let lastFocused = null;

  function openModal() {
    lastFocused = document.activeElement;
    modal.hidden = false;
    document.body.classList.add('modal-open');
    const firstField = form.querySelector('input, textarea');
    if (firstField) firstField.focus();
  }

  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove('modal-open');
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  }

  trigger.addEventListener('click', openModal);
  closeEls.forEach((el) => el.addEventListener('click', closeModal));
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) closeModal();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');

    if (CONTACT_FORM_ENDPOINT.includes('REPLACE_WITH')) {
      status.textContent = "The message form isn't fully connected yet — opening live chat instead.";
      status.className = 'modal-status modal-status-info';
      setTimeout(() => {
        closeModal();
        openChatFallback();
      }, 1500);
      return;
    }

    submitBtn.disabled = true;
    status.textContent = 'Sending…';
    status.className = 'modal-status';

    try {
      const response = await fetch(CONTACT_FORM_ENDPOINT, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: new FormData(form),
      });

      if (response.ok) {
        status.textContent = 'Message sent — Ash will get back to you soon.';
        status.className = 'modal-status modal-status-success';
        form.reset();
        setTimeout(closeModal, 1800);
      } else {
        throw new Error('Request failed');
      }
    } catch (err) {
      status.textContent = 'Something went wrong sending that — try live chat instead.';
      status.className = 'modal-status modal-status-error';
    } finally {
      submitBtn.disabled = false;
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  renderSessionChips();
  setupNavToggle();
  setupReserveButtons();
  setupPaypalButtons();
  setupSessionButtons();
  setupClickableCards();
  setupEmailModal();
});
