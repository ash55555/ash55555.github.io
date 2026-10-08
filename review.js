// A Game Master's own share link, gathered from the Reviews tab of their GM dashboard:
// ashtabletop.com/review.html?gm=<their-slug>. Anyone who already has an account on
// Ash Tabletop can open it and leave that GM a review, even before they have played
// at their table. See the viaLink flag in worker/src/reviews.js.

const WORKER = 'https://ash-tabletop-announcements.ash-tabletop.workers.dev';
const $ = (id) => document.getElementById(id);
const gmSlug = new URLSearchParams(window.location.search).get('gm') || '';

let me = null;

function showError(message) {
  $('rv-login').hidden = true;
  $('rv-app').hidden = true;
  $('rv-error').hidden = false;
  $('rv-error').textContent = message;
}

async function reviewCall(action, extra) {
  const idToken = await me.getIdToken();
  const res = await fetch(`${WORKER}/review/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...(extra || {}), idToken, gm: gmSlug, viaLink: true }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

function draw(state) {
  const dm = state.dm || {};
  AshReviews.renderDmProfile($('rv-body'), {
    dm, name: dm.name, pronouns: dm.pronouns,
    state: { signedIn: true, ...state },
    onDelete: async () => { await reviewCall('delete'); },
    onSubmit: async (payload) => (await reviewCall('submit', payload)).review,
  });
}

async function start(user) {
  me = user;
  $('rv-login').hidden = true;
  $('rv-app').hidden = false;
  $('rv-error').hidden = true;
  let state;
  try { state = await reviewCall('status'); } catch (err) {
    showError(err.message || "This review link isn't valid. Please check the link and try again.");
    return;
  }
  draw(state);
}

if (!gmSlug) {
  showError("This review link isn't valid. Please check the link and try again.");
} else {
  fetch(`${WORKER}/gm/public?slug=${encodeURIComponent(gmSlug)}`).then((r) => r.json()).then((d) => {
    const name = d && d.profile && d.profile.name;
    if (name) {
      $('rv-login-lead').textContent = `Log in to leave a review for ${name}.`;
      document.title = `Review ${name} | Ash Tabletop`;
    }
  }).catch(() => {});

  if (typeof firebase !== 'undefined' && firebase.apps.length) {
    firebase.auth().onAuthStateChanged((user) => {
      if (user) start(user);
      else { $('rv-login').hidden = false; $('rv-app').hidden = true; $('rv-error').hidden = true; }
    });
    $('rv-google').addEventListener('click', () => {
      firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider()).catch((e) => { $('rv-login-status').textContent = e.message; });
    });
    $('rv-login-form').addEventListener('submit', (e) => {
      e.preventDefault();
      $('rv-login-status').textContent = 'Working...';
      firebase.auth().signInWithEmailAndPassword($('rv-login-email').value.trim(), $('rv-login-pass').value)
        .catch((err) => { $('rv-login-status').textContent = err.message; });
    });
    $('rv-forgot').addEventListener('click', async () => {
      const email = $('rv-login-email').value.trim();
      if (!email) { $('rv-login-status').textContent = 'Type your email above first, then tap "Forgot your password?" again.'; return; }
      try { await firebase.auth().sendPasswordResetEmail(email); } catch (err) {
        if (err.code !== 'auth/user-not-found' && err.code !== 'auth/invalid-email') { $('rv-login-status').textContent = err.message; return; }
      }
      $('rv-login-status').textContent = 'If ' + email + ' has an account, a link to choose a new password is on its way. Check Spam too.';
    });
  }
}
