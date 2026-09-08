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

// Contact form endpoint (Formspree or similar). The destination inbox lives
// entirely in that service's own dashboard — never in this file or the HTML —
// so Ash's address is never present in the site's source.
// TODO: replace with the real endpoint once Ash creates a Formspree form.
const CONTACT_FORM_ENDPOINT = 'https://formspree.io/f/xkjnjoba';

// Ash's Discord DM link. As of the switch to a talk-first booking flow, every
// "join this game" entry point on the site (session time chips, the old PayPal
// button) opens this instead of taking payment directly — players message Ash,
// and once they've talked, she sends a personal link to actually sign up.
const ASH_DISCORD_URL = 'https://discord.com/users/1137869041495724094';

// The data below (PayPal links, subscription plan IDs, seat counts) is real
// and still valid — kept for reference and for whenever Ash wants to resume
// a direct-payment flow, or reuse a specific plan link when she personally
// sends someone their signup link after talking. Nothing on the site wires
// into PAYPAL_LINKS or SESSION_PLAN_IDS anymore; every click just opens Discord.
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
  'flying-city': 'P-7SU49717KD941740NNKJ5MUI',
  'curse-of-strahd::A': 'P-96854614WE5575828NKJ5S2A',
  'curse-of-strahd::B': 'P-3V025331GW1160035NKJ5DJA',
  'ravenloft-undead-survival': 'P-2AU9256410078093GNKJ5VPY',
  'crooked-moon::A': 'P-0WY84596LB169710DNKJ5QVI',
  'crooked-moon::B': 'P-06V49763KG2775057NKJ5TTY',
  'crooked-moon::C': 'P-2XX59202BM273011RNKJ5UJY',
  'witchlight': 'P-5TK70470Y7592312HNKJ5WPA',
};

// Seat counts per session slot, updated by hand as players join/leave (this
// is a static site — there's no backend to track signups automatically).
// A slot with no entry here shows no seat count and is never marked full.
const SESSION_SEATS = {
  'flying-city': { filled: 4, max: 5 },
  'curse-of-strahd::A': { filled: 3, max: 5 },
  'curse-of-strahd::B': { filled: 4, max: 5 },
  'ravenloft-undead-survival': { filled: 4, max: 5 },
  'crooked-moon::A': { filled: 4, max: 5 },
  'crooked-moon::B': { filled: 3, max: 5 },
  'crooked-moon::C': { filled: 3, max: 5 },
  'witchlight': { filled: 4, max: 5 },
};

function openChatFallback() {
  window.open(ASH_DISCORD_URL, '_blank', 'noopener');
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
          sub.textContent = "You're subscribed! See you at the table.";
          slot.innerHTML = '';
        },
      }).render('#paypal-button-slot');
    })
    .catch(() => {
      sub.textContent = "PayPal couldn't load. Try messaging on Discord instead.";
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
      // Talk-first flow: every time slot just opens a DM to Ash, regardless
      // of whether that slot has a PayPal plan configured. See ASH_DISCORD_URL.
      window.open(ASH_DISCORD_URL, '_blank', 'noopener');
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
      status.textContent = "The message form isn't fully connected yet, so opening Discord instead.";
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
        status.textContent = "Message sent! Ash will get back to you soon.";
        status.className = 'modal-status modal-status-success';
        form.reset();
        setTimeout(closeModal, 1800);
      } else {
        throw new Error('Request failed');
      }
    } catch (err) {
      status.textContent = 'Something went wrong sending that. Try messaging on Discord instead.';
      status.className = 'modal-status modal-status-error';
    } finally {
      submitBtn.disabled = false;
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  renderSessionChips();
  setupNavToggle();
  setupSessionButtons();
  setupClickableCards();
  setupEmailModal();
  setupPaypalModal();
});
