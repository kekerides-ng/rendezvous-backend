# Third-party services and credentials

**Master copy lives in `companion-backend/docs/SERVICES.md`** and is byte-identical in all
four repos. Updated whenever a build step turns out to need something external.

Every account Rendezvous depends on, what it is for, when it is first needed, and exactly
which values to copy back. Nothing here is urgent until its build step comes up — the
point is that when you sit down to create accounts, you create all the ones you need in
one go instead of discovering them one at a time.

**Status key:** ⬜ not needed yet · 🟡 needed for the next step · ✅ obtained and
configured

---

## What to get next

| | Service | Needed for | Why it blocks |
|---|---|---|---|
| ✅ | **Privy** | 1.2 user auth | **Done** — credentials in place, sign-in works |
| ⬜ | **Mapbox** | already built | The rendezvous map falls back to a placeholder until a token exists |
| ⬜ | **Youverify** | 1.3 KYC | The 18+ gate before anyone can make an offer |
| ⬜ | Everything else | Phase 2+ | — |

Mapbox is listed second because the code is already written and waiting — it is the
cheapest one to tick off, and the only one where you would see an immediate difference.

---

## 1 · Privy — sign-in and embedded wallets ✅

**What it does:** signs the user in by email or Google and creates an embedded Base wallet
in the same step (`architecture.md` §4). The backend verifies Privy's token and issues its
own httpOnly session cookie.

**First needed:** build-plan **1.2**. **Fallback:** Dynamic, if Privy's Nigeria coverage
or pricing turns out wrong — the backend only verifies a token, so the swap is contained.

**Create:** a Privy app at `dashboard.privy.io`. Under **User management → Authentication**,
enable **email** and, under **Socials**, **Google**; leave **SMS off** (I41). Enable
**embedded wallets** on **Base Sepolia** to start. A method the web app offers but the
dashboard does not allow fails with `disallowed_login_method`.

Privy's default Google credentials are fine locally. Before launch, add your own Google
OAuth client (Google Cloud Console → Credentials) with authorized redirect URI
`https://auth.privy.io/api/v1/oauth/callback`, so the consent screen says Rendezvous.

**Copy back:**

| Value | Goes in | Repo |
|---|---|---|
| App ID | `PRIVY_APP_ID` | backend |
| App secret | `PRIVY_APP_SECRET` | backend |
| App ID (again) | `NEXT_PUBLIC_PRIVY_APP_ID` | web |

**Also required — allowlist the origins.** The app ID alone is not enough. Privy serves
its embedded-wallet iframe with a `frame-ancestors` CSP built from a dashboard allowlist,
so an origin that is not listed fails at provider mount with `Privy iframe failed to
load: Error: Frame ancestor is not allowed`, and the embedded wallet is never created —
sign-in dies after the code step. In **Configuration → App settings → Domains → Allowed
origins → Web & mobile web**, add every origin the web app is served from:

| Origin | When |
|---|---|
| `http://localhost:3000` | local development — **the port is required**, bare `localhost` does not match |
| `http://<LAN IP>:3000` | testing on a phone over Wi-Fi; a different origin to Privy |
| the deployed web origin | staging and production (`https`, no trailing path, list `www` and non-`www`) |

Remove localhost before production. The admin console does not need an entry: it
authenticates with email, password and TOTP, not Privy.

**Note:** Privy emails the login code, so **no email or SMS provider is needed for
sign-in**. Termii (§9) is only for SOS messages to trusted contacts.

---

## 2 · Mapbox — the rendezvous map ⬜

**What it does:** the map on the journey and live-session screens. Static Images API, not
GL JS (`DECISIONS.md` P4).

**First needed:** already built and waiting. Without a token the map renders a drawn
placeholder rather than breaking.

**Create:** an account at `mapbox.com`, then a **public** token (`pk.…`). The free tier is
generous for static images; restrict the token by URL before production.

**Copy back:** `NEXT_PUBLIC_MAPBOX_TOKEN` → `web/.env`

---

## 3 · Youverify — identity and the 18+ check ⬜

**What it does:** verifies an ID and its document date of birth before offers.
The backend checks a successful identity result and selfie match; a form that
merely says `cleared` is not sufficient.

**First needed:** build-plan **1.3**. The sandbox server API key and sandbox URL
are configured in ignored `backend/.env`; neither belongs in web or admin.
`YOUVERIFY_BASE_URL` defaults to `https://api.sandbox.youverify.co` if unset.
Production (`https://api.youverify.co`) must be chosen explicitly.

**Configured locally:** Jaco supplied a staging API key, stored in ignored
`backend/.env`. `KYC_PROVIDER=off` is now set there and is also the default.
It skips KYC table reads so sign-in, profile, discovery and the admin console
can run before KYC migrations. Change it to `youverify` only when the deferred
provider-neutral capture/result flow has been built; changing the variable
alone does not initiate checks. The old direct NIN form and endpoint were
removed. The public merchant key is not used by the current code. Keep the
server API key out of Git and client code.

---

## 4 · Cloudflare R2 — photo storage ⬜

**What it does:** profile photos with pre-signed uploads, available after upload confirmation
(`architecture.md` §3, media module).

**First needed:** build-plan **2.1**. **MinIO stands in locally**, so this is only needed
for a deployed environment.

**Create:** an R2 bucket plus an API token with object read/write.

**Copy back:** into the `S3_*` variables the config schema **already declares** —
`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`
(`auto` for R2).

For browser uploads, set an R2 bucket CORS rule allowing the deployed web
origin, `PUT`, and the `Content-Type` request header. Local Compose sets MinIO
CORS from `WEB_ORIGIN` and creates the local bucket on first upload reservation.

---

## 5 · Base RPC — reading and writing the chain ⬜

**What it does:** the escrow watcher and the operator's transactions
(`architecture.md` §5).

**First needed:** build-plan **4.2**. The public endpoint `https://sepolia.base.org` works
for development; a paid provider (Alchemy, QuickNode) is for staging onward, because
public endpoints rate-limit a watcher that backfills.

**Copy back:** `CHAIN_RPC_URL` → backend (already declared, defaults to the public one)

---

## 6 · Basescan — contract verification ⬜

**What it does:** publishes the verified source of `Escrow.sol`, so anyone can read the
contract holding their money. For a product asking people to trust an escrow, that is not
optional.

**First needed:** build-plan **4.1**. Free.

**Copy back:** `BASESCAN_API_KEY` → contracts

---

## 7 · The operator wallet — self-generated ⬜

**Not a service.** A keypair we create, whose address holds a small amount of Base ETH for
gas. It signs refunds and keeper releases, and has deliberately minimal power
(`architecture.md` §5).

**First needed:** build-plan **4.2**.

**Create:** generate with `cast wallet new` in the contracts repo. **Fund with Base ETH**
— a few dollars covers a long time at Base gas prices. Testnet ETH is free from a faucet.

**Copy back:** `OPERATOR_PRIVATE_KEY` → backend (already declared; required by the escrow
module at construction, per `DECISIONS.md` I12)

**⚠ This is a hot key.** It is never logged (`common/logging/redact.ts` covers it), never
committed, and never goes in the admin app.

---

## 8 · A Safe multisig — OWNER and ARBITER ⬜

**What it does:** holds the two powerful contract roles. OWNER can pause and set the fee;
ARBITER settles disputes. Both are a **multisig, never a single key**
(`architecture.md` §5) — one compromised laptop should not be able to drain an escrow.

**First needed:** build-plan **4.1**, before deploy.

**Create:** a Safe at `app.safe.global` on Base Sepolia. Decide the signers and the
threshold — 2-of-3 is the usual starting point, and **you need a second signer**, so this
is the one to think about early.

**Copy back:** the Safe address → `contracts/deployments/`

---

## 9 · Termii — SOS messages ⬜

**What it does:** SMS to trusted contacts when someone triggers SOS
(`architecture.md` §7). Nigerian provider with local sender IDs.

**First needed:** build-plan **5.3**. **Not** for login OTP — Privy does that.

**Copy back:** `TERMII_API_KEY`, `TERMII_SENDER_ID` → backend

**Note:** a registered sender ID takes approval time in Nigeria. Start it before 5.3.

---

## 10 · A USDC → Naira rate feed ⬜

**What it does:** the `≈₦` figure shown beside every USDC amount
(`DECISIONS.md` P1). **Display only** — nothing is ever charged in Naira.

**First needed:** whenever the web app stops using the hard-coded rate in
`web/src/lib/mock/rate.ts`. Provider undecided: a Nigerian exchange's public ticker is
closer to the rate people actually see than a global average.

**Copy back:** TBD

---

## 11 · Web Push — self-generated ⬜

**Not a service.** A VAPID keypair, generated once with `web-push generate-vapid-keys`.

**First needed:** build-plan **6.2**.

**Copy back:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` → backend;
public key also to web.

**Note:** iOS only delivers Web Push to a PWA **installed to the home screen**, which is
why the install prompt is a feature rather than polish.

---

## 12 · Email ⬜

**What it does:** receipts and account email. Provider undecided — Resend and Postmark are
both fine; whichever, a verified sending domain is needed.

**First needed:** build-plan **6.2**.

---

## 13 · Hosting ⬜

**First needed:** build-plan **7.3**, though a staging deploy earlier would be worth it.

| What | Where | Why |
|---|---|---|
| backend | Railway or Fly.io | Long-running process — Socket.io and BullMQ workers rule out serverless |
| web, admin | Vercel | Next.js, and admin behind Cloudflare Access later |
| Postgres | Neon | PostGIS support needed |
| Redis | Upstash | |

---

## 14 · Monitoring ⬜

**First needed:** build-plan **7.2**. Sentry or similar, plus uptime checks on `/health`.

---

## Local development needs none of this

`docker compose up -d` gives Postgres+PostGIS, Redis and MinIO. Ports are **offset** —
Postgres **5433**, Redis **6380**, MinIO **9002/9003** — because a superseded project holds
the standard ones.

`backend/.env.example` and `web/.env.example` list every variable with safe local defaults.
Copy to `.env` and fill in only what the step you are on needs.


## GitHub Actions — app CI (0.6)

Each app repo includes `.github/workflows/ci.yml`. To run it remotely, host that
repo on GitHub and enable Actions according to the repository/organisation policy.
No app secrets or provider credentials need copying into Actions. Test database
credentials are disposable job-local values. No remote has been configured or
pushed by the agent; the first hosted run is pending the user's push. Local checks
continue to work without a GitHub account. Branch protection, if desired, must be
configured in GitHub after the first successful run; workflows alone do not block
merges.
