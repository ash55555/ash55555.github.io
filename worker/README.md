# Ash Tabletop — announcement sender

Small Cloudflare Worker that sends game-announcement emails to everyone
signed up on the site. It exists here instead of in Firebase because
Firebase's Cloud Functions require the paid Blaze billing plan, and
Google's billing system would not let Ash's account onto it (see project
memory for the full story). Cloudflare's free tier needs no card and no
billing approval, so this sidesteps that entirely.

## How it fits together

1. A visitor signs up on the site (Firebase Auth) — this already works.
2. Ash writes an announcement in `admin.html`.
3. `admin.html` reads the full subscriber list from Firebase (she's allowed
   to, per the database rules) and gets her own Firebase ID token.
4. It POSTs `{ idToken, subject, message, emails }` to this Worker.
5. This Worker verifies the ID token really belongs to Ash (checks the
   signature against Firebase's public keys and that the signed-in user is
   her specific account, nobody else's), then sends the email to each
   subscriber via whichever email API is configured.

## One-time setup (only needs doing once)

1. Create a free Cloudflare account at https://dash.cloudflare.com/sign-up
   — email + password, no card required.
2. From this `worker/` folder, run `npx wrangler login` and approve in the
   browser tab it opens.
3. Store the email API key as a secret (never put it in a file):
   `npx wrangler secret put EMAIL_API_KEY`
4. Deploy: `npx wrangler deploy`
5. Copy the `*.workers.dev` URL wrangler prints out — that's the endpoint
   `admin.html` needs to call.

## Still to do

`sendEmail()` in `src/index.js` is a placeholder until we know which email
service (Resend or Brevo) and have its API key.
