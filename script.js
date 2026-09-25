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

// Same Cloudflare Worker that sends announcements (see worker/src/index.js)
// also verifies the reCAPTCHA token on sign-up, since the secret key it
// needs to do that can never live in this file.
const RECAPTCHA_VERIFY_URL = 'https://ash-tabletop-announcements.ash-tabletop.workers.dev/verify-recaptcha';
const WELCOME_EMAIL_URL = 'https://ash-tabletop-announcements.ash-tabletop.workers.dev/welcome-email';

// Fire-and-forget: a new subscriber should never see an error over an
// optional welcome email, so failures here are silent.
function sendWelcomeEmail(user) {
  user.getIdToken()
    .then((idToken) => fetch(WELCOME_EMAIL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: idToken }),
    }))
    .catch(() => {});
}

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
  'curse-of-strahd::-P22OPz1OxBjVAbzihu4': { filled: 4, max: 5 },
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

// Opens the join page inside a popup on the current page, so visitors never
// leave the campaign they were reading.
let joinModal = null;
function openJoinPopup(src) {
  if (!joinModal) {
    joinModal = document.createElement("div");
    joinModal.className = "modal join-modal";
    joinModal.hidden = true;
    joinModal.innerHTML =
      '<div class="modal-dialog join-dialog" role="dialog" aria-modal="true" aria-label="Join this game">' +
      '<button type="button" class="modal-close" aria-label="Close"><svg class="icon" viewBox="0 0 24 24"><path d="M5 5l14 14M19 5L5 19"/></svg></button>' +
      '<iframe title="Join this game" src="about:blank"></iframe></div>';
    document.body.appendChild(joinModal);
    const close = () => {
      joinModal.hidden = true;
      joinModal.querySelector("iframe").src = "about:blank";
      document.body.classList.remove("modal-open");
    };
    joinModal.querySelector(".modal-close").addEventListener("click", close);
    joinModal.addEventListener("click", (event) => { if (event.target === joinModal) close(); });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !joinModal.hidden) close(); });
  }
  joinModal.querySelector("iframe").src = src;
  joinModal.hidden = false;
  document.body.classList.add("modal-open");
}

function setupSessionButtons() {
  document.querySelectorAll(".session-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const params = new URLSearchParams({
        campaign: chip.dataset.campaign || "",
        slot: chip.dataset.slot || "",
        group: chip.dataset.group || "",
        day: chip.dataset.day || "0",
        hour: chip.dataset.hour || "0",
        minute: chip.dataset.minute || "0",
        offset: chip.dataset.offset || "1",
        embed: "1",
      });
      const seatsText = (chip.querySelector(".session-seats") || {}).textContent || "";
      const seatsMatch = seatsText.match(/\((\d+)\/(\d+)\)/);
      if (seatsMatch) {
        params.set("filled", seatsMatch[1]);
        params.set("max", seatsMatch[2]);
      }
      const base = window.location.pathname.includes("/blog/") ? "../player.html" : "player.html";
      openJoinPopup(base + "?" + params.toString());
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

// Lets a visitor create a Firebase Auth account (or log into an existing one)
// and marks them as subscribed to game announcements. Subscribing is just
// "having an account" — signing up writes subscribers/{uid} automatically,
// no separate opt-in step, matching what Ash asked for.
function setupSignupModal() {
  const triggers = document.querySelectorAll('.js-signup-trigger');
  const loginTrigger = document.querySelector('.nav-login');
  const signupTrigger = document.querySelector('.nav-cta.js-signup-trigger');
  const modal = document.getElementById('signup-modal');
  if (!triggers.length || !modal) return;

  const form = modal.querySelector('#signup-form');
  const emailInput = modal.querySelector('#signup-email');
  const passwordInput = modal.querySelector('#signup-password');
  const confirmInput = modal.querySelector('#signup-password-confirm');
  const confirmLabel = modal.querySelector('#signup-confirm-label');
  const recaptchaWrap = modal.querySelector('#signup-recaptcha');
  const submitBtn = form.querySelector('button[type="submit"]');
  const googleBtn = modal.querySelector('#signup-google-btn');
  const status = modal.querySelector('.modal-status');
  const title = modal.querySelector('#signup-modal-title');
  const sub = modal.querySelector('#signup-modal-sub');
  const modeToggle = modal.querySelector('#signup-mode-toggle');
  const closeEls = modal.querySelectorAll('.js-modal-close');
  const guestView = modal.querySelector('#signup-guest-view');
  const memberView = modal.querySelector('#signup-member-view');
  const memberEmail = modal.querySelector('#signup-member-email');
  const logoutBtn = modal.querySelector('#signup-logout-btn');
  let lastFocused = null;
  let mode = 'signup';
  let currentUser = null;

  // Reflects sign-in state both in the nav (so it's visible without opening
  // anything) and inside the modal itself (so opening it confirms clearly
  // they're already on the list, instead of showing the sign-up form again).
  function applyAuthState(user) {
    currentUser = user;
    if (user) {
      signupTrigger.textContent = '✓ Member';
      if (loginTrigger) loginTrigger.hidden = true;
      guestView.hidden = true;
      memberView.hidden = false;
      memberEmail.textContent = user.email;
      title.textContent = "You're In!";
      sub.textContent = "You're all set to hear about new games.";
    } else {
      signupTrigger.textContent = 'Sign Up';
      if (loginTrigger) loginTrigger.hidden = false;
      guestView.hidden = false;
      memberView.hidden = true;
      applyMode();
    }
  }

  function applyMode() {
    const isSignup = mode === 'signup';
    confirmInput.hidden = !isSignup;
    confirmLabel.hidden = !isSignup;
    confirmInput.required = isSignup;
    recaptchaWrap.hidden = !isSignup;

    if (isSignup) {
      title.textContent = 'Get Notified About New Games';
      sub.textContent = 'Create a free account and get an email every time Ash opens a new game or session.';
      submitBtn.textContent = 'Sign Up';
      modeToggle.textContent = 'Already have an account? Log in';
    } else {
      title.textContent = 'Log In';
      sub.textContent = 'Log back in to keep getting game alerts.';
      submitBtn.textContent = 'Log In';
      modeToggle.textContent = "Don't have an account? Sign up";
    }
    status.textContent = '';
  }

  // Ensures a subscriber record exists without ever stomping subscribedAt on
  // a repeat sign-in (Google can be used to log in again, not just sign up).
  async function ensureSubscribed(uid, email) {
    const ref = firebase.database().ref('subscribers/' + uid);
    const existing = await ref.once('value');
    if (!existing.exists()) {
      await ref.set({ email: email, subscribedAt: firebase.database.ServerValue.TIMESTAMP });
      return true;
    }
    return false;
  }

  googleBtn.addEventListener('click', async () => {
    if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) {
      status.textContent = "Sign-up isn't available right now. Try messaging Ash on Discord instead.";
      status.className = 'modal-status modal-status-error';
      return;
    }
    googleBtn.disabled = true;
    status.textContent = 'Opening Google sign-in…';
    status.className = 'modal-status';
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      const cred = await firebase.auth().signInWithPopup(provider);
      const isNew = await ensureSubscribed(cred.user.uid, cred.user.email);
      if (isNew) sendWelcomeEmail(cred.user);
      status.textContent = "You're signed up! You'll get an email whenever a new game or session opens.";
      status.className = 'modal-status modal-status-success';
      setTimeout(closeModal, 1800);
    } catch (err) {
      status.textContent = err.message;
      status.className = 'modal-status modal-status-error';
    } finally {
      googleBtn.disabled = false;
    }
  });

  applyMode();

  logoutBtn.addEventListener('click', () => {
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
      firebase.auth().signOut();
    }
  });

  if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
    firebase.auth().onAuthStateChanged(applyAuthState);
  }

  function openModal() {
    lastFocused = document.activeElement;
    modal.hidden = false;
    document.body.classList.add('modal-open');
    if (!currentUser) emailInput.focus();
  }

  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove('modal-open');
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  }

  triggers.forEach((el) => el.addEventListener('click', () => {
    const wanted = el.dataset.mode;
    if (wanted && wanted !== mode && !currentUser) {
      mode = wanted;
      applyMode();
    }
    openModal();
  }));
  closeEls.forEach((el) => el.addEventListener('click', closeModal));
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) closeModal();
  });

  modeToggle.addEventListener('click', () => {
    mode = mode === 'signup' ? 'login' : 'signup';
    applyMode();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) {
      status.textContent = "Sign-up isn't available right now. Try messaging Ash on Discord instead.";
      status.className = 'modal-status modal-status-error';
      return;
    }

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (mode === 'signup' && password !== confirmInput.value) {
      status.textContent = "Those passwords don't match.";
      status.className = 'modal-status modal-status-error';
      return;
    }

    let recaptchaToken = null;
    if (mode === 'signup') {
      recaptchaToken = typeof grecaptcha !== 'undefined' ? grecaptcha.getResponse() : '';
      if (!recaptchaToken) {
        status.textContent = "Please check the box to confirm you're not a robot.";
        status.className = 'modal-status modal-status-error';
        return;
      }
    }

    submitBtn.disabled = true;
    status.textContent = 'Working…';
    status.className = 'modal-status';

    try {
      if (mode === 'signup') {
        const verifyResponse = await fetch(RECAPTCHA_VERIFY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: recaptchaToken }),
        });
        const verifyData = await verifyResponse.json();
        if (!verifyData.success) {
          throw new Error("That robot check didn't go through. Please try again.");
        }

        const cred = await firebase.auth().createUserWithEmailAndPassword(email, password);
        await firebase.database().ref('subscribers/' + cred.user.uid).set({
          email: email,
          subscribedAt: firebase.database.ServerValue.TIMESTAMP,
        });
        sendWelcomeEmail(cred.user);
        status.textContent = "You're signed up! You'll get an email whenever a new game or session opens.";
        status.className = 'modal-status modal-status-success';
      } else {
        await firebase.auth().signInWithEmailAndPassword(email, password);
        status.textContent = "Welcome back! You're all set to get game alerts.";
        status.className = 'modal-status modal-status-success';
      }
      form.reset();
      setTimeout(closeModal, 1800);
    } catch (err) {
      status.textContent = err.message;
      status.className = 'modal-status modal-status-error';
    } finally {
      submitBtn.disabled = false;
      // The token is single-use either way, so the widget needs a fresh one
      // before the next attempt regardless of whether this one succeeded.
      if (mode === 'signup' && typeof grecaptcha !== 'undefined') grecaptcha.reset();
    }
  });
}

// Reviews strip: auto-scrolls slowly, pauses on hover, and can be dragged
// left/right by hand (mouse) or swiped natively (touch/trackpad already work
// for free via overflow-x). The track holds two identical copies of every
// review back to back, so looping is just "jump back by half the width".
function setupReviewsMarquee() {
  const marquee = document.querySelector('.reviews-marquee');
  const track = document.querySelector('.reviews-track');
  if (!marquee || !track) return;

  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion) return;

  let halfWidth = track.scrollWidth / 2;
  window.addEventListener('resize', () => {
    halfWidth = track.scrollWidth / 2;
  });

  let isHovering = false;
  let isDragging = false;
  let lastTimestamp = null;
  const pxPerSecond = halfWidth / 44; // matches the previous 44s-per-loop pace

  function wrapAround() {
    if (halfWidth <= 0) return;
    if (marquee.scrollLeft >= halfWidth) marquee.scrollLeft -= halfWidth;
    else if (marquee.scrollLeft <= 0) marquee.scrollLeft += halfWidth;
  }

  function tick(timestamp) {
    if (lastTimestamp === null) lastTimestamp = timestamp;
    const dt = timestamp - lastTimestamp;
    lastTimestamp = timestamp;

    if (!isHovering && !isDragging) {
      marquee.scrollLeft += (pxPerSecond * dt) / 1000;
      wrapAround();
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  marquee.addEventListener('mouseenter', () => { isHovering = true; });
  marquee.addEventListener('mouseleave', () => { isHovering = false; });

  // Mouse-only click-and-drag; touch devices already get native swipe
  // scrolling for free from overflow-x, which feels better than anything
  // built by hand here.
  let dragStartX = 0;
  let dragStartScrollLeft = 0;

  marquee.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse') return;
    isDragging = true;
    dragStartX = event.clientX;
    dragStartScrollLeft = marquee.scrollLeft;
    marquee.classList.add('is-dragging');
  });

  window.addEventListener('pointermove', (event) => {
    if (!isDragging || event.pointerType !== 'mouse') return;
    marquee.scrollLeft = dragStartScrollLeft - (event.clientX - dragStartX);
    wrapAround();
  });

  function endDrag(event) {
    if (event && event.pointerType && event.pointerType !== 'mouse') return;
    isDragging = false;
    marquee.classList.remove('is-dragging');
  }
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
}

document.addEventListener('DOMContentLoaded', () => {
  renderSessionChips();
  setupNavToggle();
  setupSessionButtons();
  setupClickableCards();
  setupEmailModal();
  setupPaypalModal();
  setupSignupModal();
  setupReviewsMarquee();
});

