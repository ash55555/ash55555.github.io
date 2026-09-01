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

    const key = sessionKey(chip.dataset.campaign, chip.dataset.slot);
    const seats = SESSION_SEATS[key];
    const seatsEl = chip.querySelector('.session-seats');
    const ctaEl = chip.querySelector('.session-chip-cta');

    if (seats) {
      const remaining = seats.max - seats.filled;
      if (seatsEl) {
        seatsEl.textContent = remaining > 0
          ? `${remaining} seat${remaining === 1 ? '' : 's'} left (${seats.filled}/${seats.max})`
          : `Full (${seats.filled}/${seats.max})`;
      }
      if (remaining <= 0) {
        chip.classList.add('is-full');
        chip.disabled = true;
        if (ctaEl) ctaEl.textContent = 'Full';
      }
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
const CONTACT_FORM_ENDPOINT = 'https://formspree.io/f/xkjnjoba';

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

// Real PayPal subscription plan IDs per session slot, rendered as an actual
// embedded PayPal button (via PayPal's own JS SDK) in a popup — not just a
// link out. Filled in as Ash creates each plan; null slots fall back to
// SESSION_SUBSCRIBE_LINKS, then to chat.
const PAYPAL_CLIENT_ID = 'BAA-5rNCwRVkvFFVtHEDpW7dAuu2dLQiT52yPcgZp58AznxEI6Ww7e1zpYCLH8Ea332hoW2R3SUCuIcVnM';

const SESSION_PLAN_IDS = {
  'flying-city': null,
  'curse-of-strahd::A': null,
  'curse-of-strahd::B': 'P-3V025331GW1160035NKJ5DJA',
  'ravenloft-undead-survival': null,
  'crooked-moon::A': null,
  'crooked-moon::B': null,
  'crooked-moon::C': null,
  'witchlight': null,
};

// Seat counts per session slot, updated by hand as players join/leave (this
// is a static site — there's no backend to track signups automatically).
// A slot with no entry here shows no seat count and is never marked full.
const SESSION_SEATS = {
  'curse-of-strahd::B': { filled: 4, max: 5 },
};

function openChatFallback() {
  if (window.Tawk_API && typeof window.Tawk_API.maximize === 'function') {
    window.Tawk_API.maximize();
  }
}

function sessionKey(campaign, slot) {
  return slot ? `${campaign}::${slot}` : campaign;
}

let paypalSdkPromise = null;

function loadPaypalSdk() {
  if (paypalSdkPromise) return paypalSdkPromise;
  paypalSdkPromise = new Promise((resolve, reject) => {
    if (window.paypal) {
      resolve(window.paypal);
      return;
    }
    const script = document.createElement('script');
    script.src = `https://www.paypal.com/sdk/js?client-id=${PAYPAL_CLIENT_ID}&vault=true&intent=subscription`;
    script.setAttribute('data-sdk-integration-source', 'button-factory');
    script.onload = () => resolve(window.paypal);
    script.onerror = () => reject(new Error('PayPal SDK failed to load'));
    document.head.appendChild(script);
  });
  return paypalSdkPromise;
}

function openPaypalModal(planId, label) {
  const modal = document.getElementById('paypal-modal');
  if (!modal) return;
  const sub = modal.querySelector('#paypal-modal-sub');
  const slot = modal.querySelector('#paypal-button-slot');

  slot.innerHTML = '';
  sub.textContent = label ? `Subscribing to: ${label}` : '';
  modal.hidden = false;
  document.body.classList.add('modal-open');

  loadPaypalSdk()
    .then((paypal) => {
      if (!paypal || modal.hidden) return;
      paypal.Buttons({
        style: { shape: 'rect', color: 'gold', layout: 'vertical', label: 'subscribe' },
        createSubscription: (data, actions) => actions.subscription.create({ plan_id: planId }),
        onApprove: (data) => {
          sub.textContent = "You're subscribed — see you at the table!";
          slot.innerHTML = '';
        },
      }).render('#paypal-button-slot');
    })
    .catch(() => {
      sub.textContent = "PayPal couldn't load — try live chat instead.";
    });
}

function setupPaypalModal() {
  const modal = document.getElementById('paypal-modal');
  if (!modal) return;
  const closeModal = () => {
    modal.hidden = true;
    document.body.classList.remove('modal-open');
  };
  modal.querySelectorAll('.js-modal-close').forEach((el) => el.addEventListener('click', closeModal));
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) closeModal();
  });
}

function setupSessionButtons() {
  document.querySelectorAll('.session-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const key = sessionKey(chip.dataset.campaign, chip.dataset.slot);
      const planId = SESSION_PLAN_IDS[key];
      if (planId) {
        openPaypalModal(planId, chip.querySelector('.session-main')?.textContent || '');
        return;
      }
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
  setupPaypalModal();
});
