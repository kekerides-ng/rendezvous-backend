# Learning log

One short section per build step: what we built, why, and the one thing most likely to break.

<!-- Claude: append "## Step X.Y — <name>" at the end of each step. -->

---

## 0.1 — the scaffold, and the config that refuses to boot

NestJS 12 on Bun with a Node 22 runtime, Drizzle, docker-compose
(Postgres+PostGIS, Redis, MinIO), zod config, pino with request ids and
redaction, a global exception filter, a zod validation pipe, health probes,
Swagger at `/docs`, 47 Vitest tests.

**The config is the part worth understanding.** `loadEnv` validates the whole
environment once, at boot, and the app never reads `process.env` again. A bad
`DATABASE_URL` kills the process at startup with a readable message instead of
failing inside a request handler hours later.

Three decisions inside it:

- **`DATABASE_URL` is checked for scheme, not parsed as a URL.** A password
  containing an unescaped `@` or `#` makes `new URL()` succeed on the *wrong
  host* — a confusing way to discover you have been querying the wrong database.
- **Unknown variables are stripped, not rejected** — the environment always
  has `PATH` and friends. But a variable within two edits of a declared key
  comes back as a **warning**, because a typo is otherwise invisible: the real
  key reads as "missing" while the value you set sits there unused.
- **The operator key is optional in config, and required by the module that
  needs it.** Jaco's call: `requireOperatorKey(env)` throws, and the escrow
  module calls it at construction rather than `loadEnv` enforcing it at boot.
  The reasoning is in `docs/DECISIONS.md` I11/I12, and it comes down to §3 —
  modules are meant to be splittable into services, and a boot-time check would
  make a future profile service refuse to start in production over an escrow
  key it never uses.

  It costs almost nothing in practice: Nest builds the whole module graph at
  startup, so a deployment that *includes* escrow still dies at boot. The
  error names what breaks rather than what is missing — "without it a cancelled
  booking cannot be refunded" rather than "OPERATOR_PRIVATE_KEY is not set" —
  because the second tells an operator nothing about the cost of ignoring it.

**The thing most likely to break:** `unplugin-swc` in `vitest.config.mts`.
esbuild does not emit `emitDecoratorMetadata`, so without it **Nest dependency
injection fails in tests** — and it fails with errors that look like missing
providers rather than a build problem, which sends you looking in the wrong
place entirely.

**Also worth remembering:** `dotenv` must be the *first side-effect import* in
`main.ts`. ES imports are hoisted, so `dotenv.config()` in the function body
runs after every imported module has already read `process.env`.

**Ports are offset** — Postgres 5433, Redis 6380, MinIO 9002/9003 — because the
superseded project holds the standard ones. Connecting to 5432 silently gets
you the wrong database.

---

## 0.2 — the common pieces every module will stand on

Column helpers, the event bus, BullMQ queues, a rate limiter and the Socket.io
gateway. Nothing user-facing; everything after this depends on it.

**The column helpers are the part that would have been expensive to get wrong**,
because eleven modules inherit them at once.

- **`usdc` is a `bigint` with a driver mapping.** Postgres returns `bigint` as a
  **string**, deliberately, so the driver does not lose precision — and without
  `fromDriver` a repo gets `"31500000"` and the first `+` in any fee
  calculation **concatenates instead of adding**. The test proves the round
  trip and shows a value a JS number corrupts.
- **`geographyPoint` is `geography`, not `geometry`.** Geometry does planar
  maths, so a distance query would be in degrees and wrong by a factor that
  grows with latitude. Geography returns metres, which is what discovery needs.
  It stores **longitude first**, PostGIS's order and the reverse of how people
  say it — backwards puts Lagos in the Indian Ocean, so the type names its
  fields rather than taking a tuple.
- **`id` is a v7 UUID.** Time-ordered, so inserts stay at the right edge of the
  index instead of scattering across every page like v4.
- **No cross-module foreign keys.** §3 wants modules splittable into services,
  and a key from `booking.bookings` to `auth.users` is a database-level
  coupling that cannot survive that.

**The rate limiter is hand-written rather than `@nestjs/throttler`.** Throttler
applies one policy per route; this product needs per-action budgets with
different windows and different *keys* — six OTP sends per phone number per
hour is not the same shape as thirty messages per conversation per minute. It
is a **sliding** window, because a fixed one lets someone spend the whole
budget at 11:59:59 and again at 12:00:00. The whole check is one Lua script so
it is atomic; read-then-write from the app is a race both requests win. And
the subject is the phone number, **not the IP** — rate limiting OTP by IP
punishes everyone behind one Nigerian carrier NAT while costing an attacker
with proxies nothing.

**The thing most likely to break — and it did, twice, in one bug.**

`ioredis`'s `duplicate()` **inherits the parent's options**, and the Socket.io
Redis adapter duplicates the shared client. Booting with Redis down killed the
process in two layers:

1. `enableOfflineQueue: false` → `createAdapter` issues a SUBSCRIBE
   immediately, which throws **synchronously**.
2. With the queue turned on, `maxRetriesPerRequest: 2` flushes the queued
   commands as **unhandled rejections** after two attempts. Same crash, one
   step later.

Both are settings `common/redis` chose deliberately *for the shared client*,
reintroduced by the duplicate. The general rule that came out of it:

> **A long-lived connection retries forever. A request-path connection fails
> fast.**

The shared client must fail fast so a readiness probe reports unready rather
than hanging. The adapter's pub/sub and BullMQ's connection must not, because
dropping a broadcast or a job because Redis blinked is worse than buffering it.

**None of this was visible in tests or in `tsc`.** It only appeared by running
`node dist/main.js` with the infrastructure down — which is also the state a
container is in for the first few seconds of every deploy. The app now answers
liveness `200`, readiness `503`, and stays alive.

**Deliberately not done.** Docker was not running, so the migrations and the
PostGIS types have **not** been exercised against a real Postgres. The column
helpers are tested at the driver-mapping level only. First thing to check when
`docker compose up -d` is available.

---

## 1.1 — admin auth, and what a login endpoint gives away

The admin module: `admin_users`, `admin_sessions`, `audit_log`, `settings`,
`AdminGuard`, and a two-step login. The first feature module, built first
because the guard and the audit log are infrastructure every later module
writes to.

**Login is two steps and the first one never issues a session.** Password, then
TOTP. The intermediate state is a two-minute challenge token rather than a
server-side "half-logged-in" session, because a half-session is a thing other
code can mistake for a real one.

**The part worth remembering: a login endpoint leaks whether an account
exists, unless you make it not.** If an unknown email returns early, "no such
admin" is *faster* than "wrong password", and anyone can enumerate your admin
list with a stopwatch. The fix is to verify the password even when there is no
account, against a dummy hash.

That dummy hash has to be a **real** argon2id hash. Measured:

| | |
|---|---|
| `verify` against a real hash | **10ms** |
| `verify` against a malformed string | **1ms** |

A malformed placeholder throws immediately, which *is* the timing signal it
was meant to remove. Verified end to end against the running API: **16.1ms for
a known email, 15.8ms for an unknown one.**

**Other decisions inside it:**

- **The session token is stored as a SHA-256, never itself** — same reasoning
  as a password hash, so a leaked backup yields nothing presentable. Plain
  SHA-256 rather than argon2, deliberately: argon2 is slow to make *guessing* a
  low-entropy secret expensive, and a 256-bit random token has nothing to
  guess. The cost would be paid on every authenticated request for no gain.
- **`totpConfirmedAt` exists** so a secret is provisional until the admin
  proves they can produce a code. Without it, someone who scans the QR and
  then loses the phone is locked out of a secret the system thinks is live.
- **TOTP accepts ±1 step** for clock drift, which opens a replay window — so
  the matched step number is remembered and a reused code is refused. The audit
  log distinguishes a *replayed* code from a *wrong* one, because a replay
  means somebody saw a code they should not have.
- **Deny by default**: the guard is on the controller class and routes opt
  *out* with `@AdminPublic()`. Opting in means an endpoint added in a hurry is
  unprotected and nothing says so.
- **`sameSite: 'strict'`**, not `lax`: nothing should ever navigate into the
  admin console from another site, so there is no flow it breaks.

**The thing most likely to break — and it did.** `app.setGlobalPrefix('v1')`
was swallowing the admin routes, so every one of them 404'd. `architecture.md`
§4 and the CLAUDE.md layout both say admin lives at `/admin/*`, unversioned:
it is a separate surface with a separate origin, a separate cookie and a
separate consumer, and tying an internal console's URLs to the public API's
versioning buys nothing. `main.ts` now excludes `admin/(.*)`.

**Invisible to every unit test.** 80 of them passed while the entire module was
unreachable. Only `curl` against the built output found it.

**Verified against real infrastructure:** migration applied, `uuid v7` default
firing, the full flow walked — wrong password, unknown email, enrolment, wrong
code, correct code, `/me`, replay refused, logout, `/me` 401. Eight audit rows,
and **zero** credentials in the logs or the audit table.

### Using it

There is **no admin UI** — that is build-plan 0.4, and `DECISIONS.md` P11 says
screens lag the endpoints. Everything below is `curl` against a running API.

**Creating the first admin is a bootstrapping problem**, and I left a hole in
it on the first pass: admin creation sits behind `AdminGuard`, so there is
nobody to authenticate as until an admin exists. I tested with a hand-seeded
row and deleted it, which left the database with zero admins and no path to
one.

`bun run admin:create <email> <password> [admin|moderator]` closes it. The
alternative — a seed route that "only works when the table is empty" — is an
unauthenticated account-creation endpoint living in production forever, one
truncated table away from being usable. A CLI needs shell access to the
server, which is a far better fence. It goes through `AdminService`, not
straight to SQL, so the password rules and the audit row apply exactly as they
would through the console later.

Then signing in is **two requests**: `POST /admin/auth/login` returns a
challenge and, first time, an `otpauth://` URI to scan; `POST /admin/auth/totp`
exchanges the challenge and a 6-digit code for the session cookie. `GET
/admin/auth/me` confirms it. Full commands are in `docs/STATUS.md`.

**Deliberately not done.** No admin screens. No admin-user management
endpoints — `createAdmin` is reachable only from the CLI until 7.1.

---

## 1.2 (backend + web) — real sign-in, and a seam worth keeping

The `auth` module — `users`, `wallets`, `sessions` — plus `SessionGuard` and
three endpoints at `/v1/auth/*`. On the web side the stand-in verifier is gone:
Privy texts a real code and the backend issues a real cookie.

**Privy never owns our session.** `architecture.md` §4 already said the backend
verifies the provider's token *once* and then issues its own cookie, and that
is the most valuable line in the whole module. It puts the provider behind
`IdentityProvider.verify(token)` — one interface, bound to Privy in exactly one
factory.

That matters because the economics are genuinely unsettled. Privy bills per
monthly active user; doing our own OTP costs ~₦6–9 per SMS plus an abuse
surface to defend. Which is cheaper depends on how many people browse without
ever booking — a ratio nobody will know for a year. The seam means changing
that answer later is replacing one file, not rewriting sessions, screens, rate
limits and audit rows.

**A deprecation warning turned into a modelling fix.** Privy's `chainId` on a
wallet is deprecated in favour of `chainType`, and chasing that exposed
something I had wrong: I was storing a **chain id per wallet**. An EVM address
is not chain-specific — the same address holds funds on Base, Ethereum and
Polygon alike. What is a property of the wallet is the **family**
(`ethereum`/`solana`), because a Solana address cannot hold our USDC at all.
The column is `chain_type` now, and the Privy SDK config scopes embedded
wallets to Ethereum for the same reason.

**Session cookies differ from admin's on purpose.** `sameSite: 'lax'`, not
`strict`: a user can legitimately arrive from a shared link or a push
notification, and `strict` drops the session on that first navigation and looks
exactly like being logged out. The admin console has no such flow, so it stays
strict. The TTL is 30 days rather than 12 hours — this is a consumer app.

**The rate limit is keyed on IP here**, not a user id, because at sign-in we do
not know who this is yet and the thing being limited is someone grinding tokens
at the endpoint.

**The thing most likely to break:** `requirePrivy` throws at module
construction, and it caught the test environment the moment `AuthModule`
landed — `test/setup-env.ts` had no Privy vars, so the whole e2e suite failed
to boot. That is the module-enforcement pattern (DECISIONS I12) working rather
than being a nuisance, and the fix is obviously-fake credentials in the test
env. A test that needs a verified identity injects a fake `IdentityProvider`
instead.

**Verified against the real thing:** a bogus token is refused with
`UNAUTHENTICATED`, `/v1/auth/me` without a cookie is 401, the web proxy reaches
all of it at `/api/v1/auth/*`, and the Privy **secret appears in no client
bundle, no source file and no commit** — only the public app id reaches a
browser.

**Deliberately not done.** **1.2 is not ticked**: the build-plan line includes
an admin users list with suspend, and that screen does not exist yet. The
backend and web halves are complete and clickable.

---

## 1.2 (admin backend) — suspension is a transaction, not a flag

Added the admin users list, audited phone reveal, and admin-only suspension and
reinstatement. The list is paginated/filtered/sorted on the server and returns a
small masked projection. No migration was needed: `users.disabled_at` existed.

**The security gap was on sign-in.** Existing session resolution already rejected
a disabled user, but token exchange could still create a session for them. It
now rejects them before updating contacts, linking wallets or issuing a cookie.
Both suspension and reinstatement revoke sessions; otherwise reinstating someone
would also resurrect their old cookies.

**The thing most likely to break:** concurrent sign-in and suspension. Checking a
flag and later inserting a session are two operations unless protected together.
Both paths lock the same user row inside a transaction. A provider-key advisory
lock handles concurrent first logins, before a user row exists. The status
change, revocations and audit insert commit together; `AdminService.audit`
accepts the transaction while keeping admin-table access inside `AdminRepo`.

The backend now has 137 passing tests, including route/cookie/role validation,
SQL lock/transaction assertions and rollback when audit storage fails. The
HTTP harness uses the actual Nest/Express handler in-process without listening.
This is **not** proof of real database contention: Docker/TCP access was denied
in this workspace, so the live acceptance pass is recorded in STATUS and 1.2
stays unchecked. The backend build, typecheck and lint pass.

Questions to try while reviewing:

1. Why does reinstatement revoke sessions even though it enables the account?
2. What happens if the audit insert fails after the user row was updated?
3. If sign-in takes the row lock first, what happens to its session when the
   waiting suspension transaction runs next?


## Follow-up — database startup failures need their real error codes

Admin creation printed a Drizzle query wrapper, while drizzle-kit's migration
spinner exited without a reason. Neither distinguished an unavailable database
from rejected credentials or missing tables. Added a read-only `db:check` command
and a migration runner using Drizzle's runtime migrator, the same migration files
and default history table. CLI errors unwrap nested causes/aggregate errors and
print a driver code plus a fixed hint, never SQL parameters or credentials.

Typecheck, lint and 141 tests pass, including four diagnostic tests. Running the
new commands here produces a readable connection-refused error, but sandbox
network access still prevents diagnosing the user's database. The Compose name
edit belongs to the user and was left untouched. No volume was reset and no
applied migration was edited.


## Step 0.6 — app CI (2026-10-21)

The workflow installs frozen dependencies with Bun 1.4.0 on Node 22, then runs
typecheck, lint and tests as separate failure points. It runs for pull requests,
main pushes and manual dispatch, with read-only permissions and no app secrets.
Disposable Postgres/Redis services give the backend real dependency endpoints without touching local Docker data. Existing HTTP tests still permit readiness failure and repositories use fakes; CI does not claim live database transaction coverage.

All three apps pass local checks (141 backend, 393 web, 34 admin tests). YAML
validation passes; hosted Linux installation and services await the first push.
No deployment or branch protection is configured by this workflow.

Questions to review:

1. Why must CI install from the committed lockfile?
2. What can pass locally because of generated files but fail on a fresh clone?
3. Why does a passing test suite still leave live acceptance work to do?
