# PWC Contact Form — Cloudflare Worker

Handles POST submissions from the contact form on the static site (GitHub
Pages can't run server code, so this Worker does the validation + emailing).

## 1. Sign up for Resend and get an API key

1. Go to [resend.com](https://resend.com) and create a free account (100
   emails/day, 3,000/month on the free tier — plenty for a contact form).
2. Once logged in, go to **API Keys** → **Create API Key**. Give it a name
   like `pwc-contact-form`, leave permissions as "Full access" (or
   "Sending access" only, if offered — that's all this Worker needs), and
   copy the key. **You won't be able to see it again**, so save it
   somewhere safe for step 2 below.
3. (Optional but recommended before going live) Verify a sending domain:
   - In Resend, go to **Domains** → **Add Domain**, enter `petalumawc.com`.
   - Resend will give you a few DNS records (usually a couple of TXT/CNAME
     records for SPF/DKIM) to add wherever your domain's DNS is managed.
   - Until you do this, the Worker is already set up to send from Resend's
     shared test address (`onboarding@resend.dev`), which works with zero
     setup and is fine for getting the form working today. Verifying your
     own domain later just makes the "from" address look like it's really
     from `petalumawc.com` and improves deliverability.
   - Since you mentioned you'll be handling the custom domain DNS with me
     later, it makes sense to do this domain verification at the same time
     — just let me know when you're ready and I'll walk through it.

## 2. Create a Cloudflare Turnstile widget

This is what verifies a submission came from a real browser, not a script
POSTing straight to the Worker URL.

1. In the [Cloudflare dashboard](https://dash.cloudflare.com/), go to
   **Turnstile** (left sidebar) → **Add widget**.
2. Name it something like `pwc-contact-form`.
3. Under **Domains**, add `zachbabel.github.io` (add `petalumawc.com` too
   once the custom domain is live — you can list multiple domains on one
   widget, or add it later, either works).
4. Widget mode: **Managed** is the right default (it silently passes real
   visitors most of the time, only showing a challenge if it's suspicious).
5. Create it. You'll get two values:
   - **Site Key** — public, goes in the frontend JS (safe to commit).
   - **Secret Key** — private, goes in the Worker as a secret (step 5).

## 3. Install Wrangler and log in

From this `cloudflare-worker/` folder:

```bash
npm install
npx wrangler login
```

This opens a browser tab to authorize Wrangler against your Cloudflare
account (free account is fine — no credit card required for Workers'
free tier).

## 4. Deploy

```bash
npx wrangler deploy
```

Wrangler will print the Worker's URL, something like:

```
https://pwc-contact-form.<your-subdomain>.workers.dev
```

## 5. Set the Resend API key and Turnstile secret key as secrets

Never put either key in `wrangler.toml` or any file that gets committed.
Instead:

```bash
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put TURNSTILE_SECRET_KEY
```

Paste the Resend key from step 1 and the Turnstile **Secret Key** from
step 2 when prompted for each. Both get stored encrypted in your
Cloudflare account, accessible to the Worker as `env.RESEND_API_KEY` /
`env.TURNSTILE_SECRET_KEY` — neither ever touches git or your local
filesystem.

(This has to come *after* step 4 — Wrangler needs the Worker to already
exist before it can attach a secret to it. If you ever run this first and
it says there's no Worker by that name yet, confirming "yes, create it" is
fine too — it just makes a placeholder for the secret to attach to, and
the next `wrangler deploy` fills in the real code.)

## 6. Point the frontend at your deployed Worker + Turnstile site key

Open `/assets/contact-form.js` in the site repo and replace both
placeholders near the top:

```js
var WORKER_URL = "https://pwc-contact-form.pwc-contact-form.workers.dev";
var TURNSTILE_SITE_KEY = "0x4AAAAAAEHeIN4QaTsewefm";
```

- `WORKER_URL` → the real URL from step 4.
- `TURNSTILE_SITE_KEY` → the **Site Key** (not Secret Key) from step 2.

Then commit and push.

## 7. Test it

Submit the form on the live site (or via `wrangler dev` locally against
`http://localhost:8787`) and confirm the email arrives at the address set
in `TO_EMAIL` (`wrangler.toml`, defaults to `petalumawc@gmail.com`).

---

## Updating things later

- **Change where submissions go:** edit `TO_EMAIL` in `wrangler.toml`,
  then `npx wrangler deploy` again.
- **Switch to a verified sending domain:** once you've verified
  `petalumawc.com` on Resend (step 1 above), change `FROM_EMAIL` in
  `wrangler.toml` to e.g. `"PWC Website <contact@petalumawc.com>"`, then
  redeploy.
- **Custom domain goes live:** in `src/index.js`, uncomment the
  `https://petalumawc.com` (and `www` if used) lines in `ALLOWED_ORIGINS`,
  remove the `zachbabel.github.io` entry if you no longer need it, and
  redeploy. Also add `petalumawc.com` as a domain on the Turnstile widget
  (Cloudflare dashboard → Turnstile → your widget → Settings → Domains) if
  you didn't already list it in step 2. Nothing on the frontend needs to
  change for either of these.

## How spam/abuse protection works here

- **Turnstile:** the form won't submit without a token from Cloudflare's
  Turnstile challenge, and the Worker re-verifies that token server-side
  with Cloudflare before doing anything else. This is the layer that
  actually matters — someone finding the Worker URL and scripting direct
  POSTs to it (bypassing the browser entirely, which also bypasses CORS)
  can't produce a valid token without solving a real challenge in a real
  browser.
- **CORS allowlist:** only requests whose `Origin` header matches the
  configured site domain(s) get a usable *response* in a browser. On its
  own this doesn't stop a direct scripted request (Origin is just a header
  anyone can set), which is exactly why Turnstile is the layer doing the
  real work — but it does stop another website's client-side JS from
  quietly calling your Worker from a visitor's browser.
- **Honeypot:** the form includes a hidden `website` field real visitors
  never see or fill in. If it arrives non-empty, the Worker silently
  returns a fake "success" (so the bot doesn't learn to look elsewhere)
  without sending an email.
- **Server-side validation:** name/email/message are required and
  length-capped, and email must match a basic format — checked here, not
  just in the browser, so someone can't bypass it by calling the Worker
  directly.

Together these cover both casual bots and a deliberate person scripting
requests at the URL. Nothing stops a human manually filling out the form
over and over, but that's a much smaller, self-limiting problem — and
Cloudflare's free tier (100k requests/day) and Resend's free tier (100
emails/day) both put a hard ceiling on how bad that could get anyway.
