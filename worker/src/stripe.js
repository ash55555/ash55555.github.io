// Getting a Game Master paid, the Stripe way: each GM has their own Stripe "connected account"
// under the Ash Tabletop platform. The GM verifies who they are and adds their bank details on
// Stripe's own pages (we never see them). Once Stripe approves, players' payments for that GM's
// games go straight to the GM's account (a "direct charge"), and the platform's 5% is taken
// automatically on each payment (the "application fee") -- same shape as the Whop side in
// connect.js/pay.js, just a second, parallel provider for brand-new campaigns only. Every
// existing campaign and already-booked player stays on Whop, untouched, forever.
//
// This file only handles: the GM's connect/onboarding side (mirrors connect.js), and the raw
// Stripe API calls a charge/refund/balance need (mirrors the Whop-specific pieces of pay.js).
// No npm `stripe` package -- plain fetch against Stripe's REST API, same hand-rolled convention
// the Whop integration already uses. Stripe's API is form-encoded, not JSON.

import { verifyUser } from './pay.js';
import { gmStatus } from './gm.js';

function json(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
}
// Stripe wants application/x-www-form-urlencoded, including Stripe's own bracket syntax for
// nested fields (metadata[uid]=..., payment_method_types[0]=card) -- callers pass that shape
// directly as flat keys, this just URL-encodes it.
function form(obj) {
  const p = new URLSearchParams();
  Object.entries(obj || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, String(v)); });
  return p.toString();
}
const niceStripe = (data) => (data && data.error && (data.error.message || data.error.type)) || 'Stripe could not do that right now.';
// v2's bare error shape has no nested .error the way v1 does (message/code sit at the top level).
const niceStripeV2 = (data) => (data && (data.message || data.code)) || 'Stripe could not do that right now.';

export function cfgStripe(env) {
  const live = env.STRIPE_MODE === 'live';
  return {
    mode: live ? 'live' : 'test',
    key: live ? env.STRIPE_SECRET_KEY : env.STRIPE_TEST_SECRET_KEY,
    publishableKey: live ? env.STRIPE_PUBLISHABLE_KEY : env.STRIPE_TEST_PUBLISHABLE_KEY,
  };
}

// The generic authenticated call, for everything EXCEPT the Account/AccountLink resource itself
// (PaymentIntents, Customers, SetupIntents, PaymentMethods, Refunds, Balance all stay on v1 --
// confirmed directly against Stripe's test API that a v2-created connected account's acct_... id
// works unchanged in the Stripe-Account header on these). Passing acctId scopes the call to a
// GM's connected account via that header -- this is what makes a charge a "direct charge" (the
// connected account is the merchant of record, not the platform).
export async function stripeFetch(env, path, init = {}, acctId) {
  const c = cfgStripe(env);
  const headers = { Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/x-www-form-urlencoded' };
  if (acctId) headers['Stripe-Account'] = acctId;
  const res = await fetch('https://api.stripe.com/v1' + path, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// Stripe's newer "Accounts v2" API (JSON, not form-encoded; a Stripe-Version header is required).
// The platform account this integration runs under has Accounts v1 creation disabled -- creating
// or reading the connected-account resource itself (not charging it) has to go through v2.
const STRIPE_V2_VERSION = '2026-11-18.preview';
async function stripeV2Fetch(env, path, init = {}) {
  const c = cfgStripe(env);
  const headers = { Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json', 'Stripe-Version': STRIPE_V2_VERSION };
  const res = await fetch('https://api.stripe.com' + path, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// Where is this GM in the setup? Same vocabulary as Whop's stateFrom() in connect.js
// (verify -> review -> ready), so the admin.html state-card UI needs no new states. Accounts v2
// has no single charges_enabled/payouts_enabled/details_submitted boolean the way v1 did -- the
// readiness signal is each capability's own status ('active' | 'restricted' | 'pending').
export function stateFromStripe(account) {
  const caps = (account && account.configuration && account.configuration.merchant && account.configuration.merchant.capabilities) || {};
  const cardStatus = caps.card_payments && caps.card_payments.status;
  const payoutStatus = caps.stripe_balance && caps.stripe_balance.payouts && caps.stripe_balance.payouts.status;
  if (cardStatus === 'active' && payoutStatus === 'active') return 'ready';
  if (cardStatus === 'pending' || payoutStatus === 'pending') return 'review';
  const entries = (account && account.requirements && account.requirements.entries) || [];
  const pastDue = entries.some((e) => e.minimum_deadline && e.minimum_deadline.status === 'past_due');
  return pastDue ? 'review' : 'verify';
}

export async function handleConnectStripe(request, env, corsHeaders, origin, action, verify = verifyUser) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, corsHeaders);
  if (!origin) return json({ error: 'Origin not allowed' }, 403, corsHeaders);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400, corsHeaders); }
  if (!body || !body.idToken) return json({ error: 'Please sign in again.' }, 401, corsHeaders);
  let user;
  try { user = await verify(env, body.idToken); } catch { return json({ error: 'Please sign in again.' }, 401, corsHeaders); }
  const st = await gmStatus(env, user.sub);
  if (!st.isGm) return json({ error: 'This is for Game Masters.' }, 403, corsHeaders);

  // Unlike Whop, Ash is NOT special-cased here -- on the Stripe side, her own future campaigns
  // route through her own connected account like any other GM (the platform account belongs to
  // the collaborator setting this up, not to her).
  const row = await env.DB.prepare('SELECT account_id FROM gm_stripe_accounts WHERE uid=?').bind(user.sub).first();

  if (action === 'balance') {
    if (!row) return json({ error: 'Set up your payouts first.' }, 400, corsHeaders);
    const b = await readStripeBalance(env, row.account_id);
    if (b.error) return json({ error: b.error }, b.status, corsHeaders);
    return json({ mode: 'live', ...b }, 200, corsHeaders);
  }

  if (action === 'status') {
    if (!row) return json({ state: 'none' }, 200, corsHeaders);
    const r = await stripeV2Fetch(env, `/v2/core/accounts/${encodeURIComponent(row.account_id)}?include[0]=configuration.merchant&include[1]=requirements`);
    if (!r.ok) return json({ state: 'unknown' }, 200, corsHeaders);
    const state = stateFromStripe(r.data);
    if (state === 'ready') forgetStripePayoutAccount(user.sub); // so booking opens right away, not a minute later
    return json({ state }, 200, corsHeaders);
  }

  if (action === 'start') {
    let accountId = row && row.account_id;
    if (!accountId) {
      const email = String(user.email || '').toLowerCase();
      const prof = await env.DB.prepare('SELECT data FROM gm_profiles WHERE uid=?').bind(user.sub).first();
      let name = '';
      try { name = prof ? JSON.parse(prof.data).name : ''; } catch { name = ''; }
      name = name || user.name || email.split('@')[0] || 'Game Master';
      // "Full" dashboard, not Express: the platform this runs under requires Stripe (not the
      // platform) to collect each connected account's processing fees and absorb its losses, and
      // that combination isn't offered with an Express dashboard (Stripe's own rule). The GM pays
      // Stripe's standard processing fee out of their own payments either way -- just via
      // fees_collector:'stripe' instead of being billed by the platform -- and Ash Tabletop's cut
      // still comes from application_fee_amount on each charge, unchanged.
      const r = await stripeV2Fetch(env, '/v2/core/accounts', {
        method: 'POST',
        body: JSON.stringify({
          contact_email: email,
          display_name: (name + ' (Ash Tabletop GM)').slice(0, 80),
          dashboard: 'full',
          identity: { country: 'us' },
          configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
          defaults: { responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' } },
          metadata: { uid: user.sub, role: 'gm' },
        }),
      });
      if (!r.ok || !r.data.id) return json({ error: niceStripeV2(r.data) }, 502, corsHeaders);
      accountId = r.data.id;
      await env.DB.prepare('INSERT INTO gm_stripe_accounts (uid, account_id, email, created_at) VALUES (?,?,?,?)').bind(user.sub, accountId, email, new Date().toISOString()).run();
    }
    const site = 'https://ashtabletop.com/admin.html#tab=gmfinance';
    const l = await stripeV2Fetch(env, '/v2/core/account_links', {
      method: 'POST',
      body: JSON.stringify({ account: accountId, use_case: { type: 'account_onboarding', account_onboarding: { collection_options: { fields: 'eventually_due' }, return_url: site, refresh_url: site } } }),
    });
    if (!l.ok || !l.data.url) return json({ error: niceStripeV2(l.data) }, 502, corsHeaders);
    return json({ url: l.data.url }, 200, corsHeaders);
  }

  if (action === 'portal') {
    // A "full" dashboard connected account (see 'start' above) is managed by signing in at
    // Stripe's own regular dashboard, not a generated one-click Express link (login_links only
    // exists for Express-dashboard accounts) -- the account owner's own Stripe login, set up
    // during onboarding, gets them there.
    if (!row) return json({ error: 'Set up your payouts first.' }, 400, corsHeaders);
    return json({ url: 'https://dashboard.stripe.com/' }, 200, corsHeaders);
  }

  return json({ error: 'Not found' }, 404, corsHeaders);
}

// Global Payouts: a second way for a GM to get paid on Stripe, for GMs whose own country isn't
// eligible for a "full" connected account above (that type requires card_payments, which Stripe
// only allows in a short list of countries). A "recipient" account never processes a charge or
// requests card_payments -- it only receives money the platform sends it -- so Stripe allows it
// in a much longer list of countries. Players for these GMs are charged on the platform's own
// Stripe balance instead; actually paying the GM their share is a separate, later step not built
// yet -- this covers identity + bank-detail onboarding only.
//
// Its own restricted API key (STRIPE_GP_KEY): Stripe requires a key scoped specifically to Money
// Management for this API family and refuses the main full-access STRIPE_SECRET_KEY outright.
const STRIPE_GP_VERSION = '2026-10-28.endive';
async function stripeGPFetch(env, path, init = {}, acctId) {
  const headers = { Authorization: `Bearer ${env.STRIPE_GP_KEY}`, 'Content-Type': 'application/json', 'Stripe-Version': STRIPE_GP_VERSION };
  if (acctId) headers['Stripe-Context'] = acctId;
  const res = await fetch('https://api.stripe.com' + path, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function stateFromRecipient(account) {
  const bank = account && account.configuration && account.configuration.recipient && account.configuration.recipient.capabilities
    && account.configuration.recipient.capabilities.bank_accounts && account.configuration.recipient.capabilities.bank_accounts.local;
  const status = bank && bank.status;
  if (status === 'active') return 'ready';
  // A freshly-requested capability sits at 'pending' from the moment it's requested, long before
  // Stripe actually has anything to review -- that only means something until every outstanding
  // requirement (name, address, bank details, ...) has actually been submitted through the hosted
  // form. So "review" (nothing to do, just wait) only applies once requirements is empty; any
  // entries still listed mean she needs to go finish the hosted form, same as a brand-new account.
  const entries = (account && account.requirements && account.requirements.entries) || [];
  if (entries.length === 0 && status === 'pending') return 'review';
  return 'verify';
}

export async function handleConnectStripeRecipient(request, env, corsHeaders, origin, action, verify = verifyUser) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, corsHeaders);
  if (!origin) return json({ error: 'Origin not allowed' }, 403, corsHeaders);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400, corsHeaders); }
  if (!body || !body.idToken) return json({ error: 'Please sign in again.' }, 401, corsHeaders);
  let user;
  try { user = await verify(env, body.idToken); } catch { return json({ error: 'Please sign in again.' }, 401, corsHeaders); }
  const st = await gmStatus(env, user.sub);
  if (!st.isGm) return json({ error: 'This is for Game Masters.' }, 403, corsHeaders);

  const row = await env.DB.prepare('SELECT account_id FROM gm_stripe_recipients WHERE uid=?').bind(user.sub).first();

  if (action === 'status') {
    if (!row) return json({ state: 'none' }, 200, corsHeaders);
    const r = await stripeGPFetch(env, `/v2/core/accounts/${encodeURIComponent(row.account_id)}?include[0]=configuration.recipient&include[1]=requirements`);
    if (!r.ok) return json({ state: 'unknown' }, 200, corsHeaders);
    return json({ state: stateFromRecipient(r.data) }, 200, corsHeaders);
  }

  if (action === 'start') {
    let accountId = row && row.account_id;
    if (!accountId) {
      const country = String(body.country || '').trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(country)) return json({ error: 'Pick your country first.' }, 400, corsHeaders);
      const email = String(user.email || '').toLowerCase();
      const prof = await env.DB.prepare('SELECT data FROM gm_profiles WHERE uid=?').bind(user.sub).first();
      let name = '';
      try { name = prof ? JSON.parse(prof.data).name : ''; } catch { name = ''; }
      name = name || user.name || email.split('@')[0] || 'Game Master';
      const r = await stripeGPFetch(env, '/v2/core/accounts', {
        method: 'POST',
        body: JSON.stringify({
          contact_email: email,
          display_name: (name + ' (Ash Tabletop GM)').slice(0, 80),
          identity: { country, entity_type: 'individual' },
          configuration: { recipient: { capabilities: { bank_accounts: { local: { requested: true } } } } },
          metadata: { uid: user.sub, role: 'gm-recipient' },
        }),
      });
      if (!r.ok || !r.data.id) return json({ error: niceStripeV2(r.data) }, 502, corsHeaders);
      accountId = r.data.id;
      await env.DB.prepare('INSERT INTO gm_stripe_recipients (uid, account_id, country, email, created_at) VALUES (?,?,?,?,?)').bind(user.sub, accountId, country, email, new Date().toISOString()).run();
    }
    const site = 'https://ashtabletop.com/admin.html#tab=gmfinance';
    const l = await stripeGPFetch(env, '/v2/core/account_links', {
      method: 'POST',
      body: JSON.stringify({ account: accountId, use_case: { type: 'account_onboarding', account_onboarding: { collection_options: { fields: 'eventually_due' }, return_url: site, refresh_url: site } } }),
    });
    if (!l.ok || !l.data.url) return json({ error: niceStripeV2(l.data) }, 502, corsHeaders);
    return json({ url: l.data.url }, 200, corsHeaders);
  }

  return json({ error: 'Not found' }, 404, corsHeaders);
}

// The Stripe connected account a game master's players pay into, but only once Stripe says it is
// fully ready (details submitted, charges + payouts enabled). Until then this is null: nobody can
// book or be charged for that table yet. Checked at most once a minute, same cache shape as
// gmPayoutAccount in connect.js.
const readyCache = new Map();
export function forgetStripePayoutAccount(uid) { readyCache.delete(uid); }
export async function gmStripePayoutAccount(env, uid) {
  const hit = readyCache.get(uid);
  if (hit && Date.now() - hit.at < 60000) return hit.id;
  const row = await env.DB.prepare('SELECT account_id FROM gm_stripe_accounts WHERE uid=?').bind(uid).first();
  let id = null;
  if (row) {
    try {
      const r = await stripeV2Fetch(env, `/v2/core/accounts/${encodeURIComponent(row.account_id)}?include[0]=configuration.merchant&include[1]=requirements`);
      if (r.ok && stateFromStripe(r.data) === 'ready') id = row.account_id;
    } catch { id = null; }
  }
  readyCache.set(uid, { id, at: Date.now() });
  return id;
}

// Read-only: what Stripe says is sitting in a connected account right now. Actually withdrawing
// still happens on Stripe's own Express dashboard (the 'portal' action above).
export async function readStripeBalance(env, accountId) {
  const r = await stripeFetch(env, '/balance', {}, accountId);
  if (!r.ok) return { error: niceStripe(r.data), status: r.status };
  const sum = (arr) => (arr || []).reduce((n, x) => n + (x.amount || 0), 0) / 100;
  const available = sum(r.data.available);
  const pending = sum(r.data.pending);
  return { currency: 'usd', balance: available, pending, reserve: 0, withdrawable: available, total: available + pending };
}

// Translates Stripe's PaymentIntent status vocabulary into the exact {status, failure_message,
// id} shape classify()/settle() in pay.js already understand (from the Whop side), so neither of
// those functions has to know Stripe exists.
function normalizeIntent(r) {
  // A synchronous decline comes back as an error envelope whose own payment_intent field carries
  // the same object a successful call would -- either way, normalize to one shape.
  const pi = (r.data && r.data.payment_intent) || r.data || {};
  const id = pi.id || null;
  if (r.ok && pi.status === 'succeeded') return { ok: true, status: r.status, data: { status: 'paid', id } };
  if (r.ok && (pi.status === 'processing' || pi.status === 'requires_action')) return { ok: true, status: r.status, data: { status: 'pending', id } };
  const err = r.data.error || {};
  return { ok: true, status: r.status, data: { status: 'failed', id, failure_message: err.message || (pi.last_payment_error && pi.last_payment_error.message) || 'Card declined' } };
}

// A direct charge: the connected account is the merchant of record, the platform takes feeUsd as
// an application fee.
export async function chargeStripe(env, account, customerId, pmId, amountUsd, feeUsd, metadata) {
  const body = { amount: Math.round(amountUsd * 100), currency: 'usd', customer: customerId, payment_method: pmId, off_session: 'true', confirm: 'true' };
  if (feeUsd) body['application_fee_amount'] = Math.round(feeUsd * 100);
  Object.entries(metadata || {}).forEach(([k, v]) => { body[`metadata[${k}]`] = v; });
  const r = await stripeFetch(env, '/payment_intents', { method: 'POST', body: form(body) }, account);
  return normalizeIntent(r);
}

// Re-checks a PaymentIntent that was left "pending" (e.g. the Worker stopped mid-way) --
// the Stripe-side mirror of reconcile()'s `whop(env, '/payments/${id}')` GET in pay.js.
export async function getStripeIntent(env, account, paymentIntentId) {
  const r = await stripeFetch(env, `/payment_intents/${encodeURIComponent(paymentIntentId)}`, {}, account);
  return normalizeIntent(r);
}

export async function refundStripe(env, account, paymentIntentId, amountCents) {
  const body = { payment_intent: paymentIntentId };
  if (amountCents) body.amount = amountCents;
  const r = await stripeFetch(env, '/refunds', { method: 'POST', body: form(body) }, account);
  return r;
}
