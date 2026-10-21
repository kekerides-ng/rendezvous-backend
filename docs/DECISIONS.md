# Decisions — Rendezvous

**Master copy lives in `companion-backend/docs/DECISIONS.md`** and is byte-identical in
all four repos. **Append-only.** When a decision is reversed, add a new entry saying so
rather than editing the old one — the reversal is itself a decision.

`architecture.md` records the design **as it stands**. This file records **why**, and what
each call ruled out. A decision without its reason gets quietly undone by the next person.

Each entry: what, when, why, and what it rules out. Everything here traces to a commit, a
doc section, or a file.

---

## Working agreements

These were only ever in Claude Code's private memory, which no other tool can read. They
are written down here so they survive a change of assistant.

### W1 · Commit each change as it lands
**2026-10-16.** One conventional commit per coherent change, once `typecheck`, `lint` and
`test` pass. Not one commit per session.
**Why:** two sessions of work sat in folders that were not even git repos — `web/` was not
initialised and `backend/` had zero commits. One bad command would have ended it, and
there was no readable history to learn the codebase from.
**Rules out:** batching a session into one commit. **Never add a remote or push** without
being asked; committing locally is what was authorised.
*(web `05ad0ec`, backend `208b21e`)*

### W2 · One build-plan step per session
Each step: plan → build → explain it with three questions → Jaco breaks it himself →
append to that repo's `docs/learning-log.md` → tick the step in **all four**
`build-plan.md` copies.
**Why:** Jaco is learning the codebase as it is built. The write-up is a deliverable, not
an afterthought, and the learning log records "the one thing most likely to break" per
step, which is what gets referred back to.

### W3 · `architecture.md` and `build-plan.md` are byte-identical across four repos
Edit `companion-backend/docs/`, then copy to `web/`, `admin/` and `contracts/`.
**Why:** four repos with no shared code still need one shared design.
**Consequence:** **Prettier must never format Markdown.** It reflows tables and rewrites
`*x*` to `_x_`, which silently breaks the sync. `*.md` is in every `.prettierignore`.
This already happened once and had to be undone by hand.

### W4 · `TODO(human)` is Jaco's homework
A marker left in the code for a decision Jaco should make. **Exactly one open at a time**,
and an assistant should not answer it.

### W5 · UI first, wired later
Screens are built against `src/lib/mock/` until the API exists, then swapped.
**Why:** Jaco reviews by screenshot, so screens that look finished are the fastest way to
get feedback. The mock folder is the seam the generated client replaces.
**How you know a slice is done:** its `lib/mock/<x>.ts` file is **deleted**, not unused.

---

## Infrastructure

### I1 · Bun for install and scripts, Node 22 as the runtime
**Why:** fast installs, one lockfile (`bun.lock`, committed). Node 22 runs the built
output, because Nest's ecosystem assumes it.
**Rules out:** npm, pnpm, yarn — mixing them produces a second lockfile and divergent
trees.

### I2 · TypeScript pinned to exactly 5.9.3
**2026-10-16.** Not a caret range.
**Why:** TypeScript 7 is incompatible with the installed `typescript-eslint`. A floating
range would break lint on an unrelated install.

### I3 · Docker ports offset — Postgres 5433, Redis 6380, MinIO 9002/9003
**Why:** the superseded project at `~/Documents/rendezvous old` holds 5432/6379/9000, and
an attempt to stop its containers was blocked by the sandbox. Connecting to 5432 gets you
the wrong database, silently.
**Rules out:** assuming default ports in any connection string or doc.

### I4 · `unplugin-swc` in `vitest.config.mts` (backend)
**Why:** esbuild does not emit `emitDecoratorMetadata`, so **Nest dependency injection
fails in tests** with errors that look like missing providers rather than a build problem.

### I5 · `dotenv` is the first side-effect import in `main.ts`
**Why:** ES imports are hoisted, so calling `dotenv.config()` in the function body runs
*after* every imported module has already read `process.env`.

### I6 · `rootDir: "./src"` pinned in `tsconfig.build.json`
**Why:** `drizzle.config.ts` at the repo root widened the inferred root, so the build
emitted `dist/src/main.js` and `bun run start` could not find its entry point.

### I7 · `baseUrl` dropped; `"module": "node20"` with `moduleResolution` omitted
**Why:** both options are deprecated and were showing as editor errors. `paths` resolves
relative to the tsconfig since TS 4.1, so `baseUrl` buys nothing. Verified the output is
still CommonJS and the `@/` alias still resolves in tsc, Vitest and the compiled output.

### I8 · `agentRules: false` in `next.config.ts`
**Why:** Next 16 generates its own `AGENTS.md`. `CLAUDE.md` is this repo's single source
of instructions, and a second generated one drifts from it silently.

### I9 · The service worker is hand-written, not Serwist
**2026-10-17.** `web/public/sw.js`, about forty lines. `CLAUDE.md` rule 7 records this.
**Why:** Serwist's Next plugin injects a webpack config and **Next 16 refuses to build
with one under Turbopack** ([serwist#54](https://github.com/serwist/serwist/issues/54)).
The alternative was forcing the entire build back to webpack for one file.
**Three choices inside it:** the API is never cached (a stale booking state is wrong *and*
looks right); pages are network-first while `/_next/static` is cache-first (content-hashed,
so a hit is always correct); precaching uses `allSettled`, because one 404 with `all`
fails the install and leaves the app with **no worker at all**.
**Revisit when:** that issue closes.

### I10 · `src/lib/api/schema.d.ts` is excluded from ESLint and the design-system test
**Why:** it is generated by `bun run api:gen`. Linting a generated file produces errors
nobody is allowed to fix.

---

## Design system

### D1 · Tokens are the only source of colour, radius, type and shadow
One `@theme` block in `web/src/app/globals.css`.
**Why:** Jaco reviews by screenshot and asks for changes. A colour written in forty places
costs forty edits per round and one gets missed.
**Enforced twice, deliberately:** ESLint fails the build on a raw hex or arbitrary
Tailwind value, **and** `test/design-system.test.ts` reads the files from disk — so it
still holds if someone disables the lint rule, which is the realistic way a convention
dies.

### D2 · `cn()` must register every token with `extendTailwindMerge`
**Why:** tailwind-merge only knows Tailwind's own scale. `rounded-button` and
`rounded-pill` looked like two unrelated unknown classes and **both survived a merge**,
leaving stylesheet order to decide the radius. Found by a test written expecting it to
pass.

### D3 · Shadows are derived with `color-mix`, never a literal brand colour
**Why:** `--shadow-cta: 0 8px 20px rgb(176 30 85 / .28)` is a second copy of the brand
magenta. Changing `--color-primary` would move the button and leave its shadow behind.

### D4 · The splash is a CSS keyframe, not React state
**Why:** as state, a user with JavaScript disabled or still downloading sat on the splash
forever with the real content never mounting. As a keyframe it always completes, which
also made `Welcome` a server component and got reduced-motion handling for free.

### D5 · `--radius-button` is full; `--radius-field` is 14px
**2026-10-17.** Split, not edited.
**Why:** one token was doing two jobs — buttons *and* text fields, code boxes, date boxes,
the switch row. Setting it to `9999px` would have turned every input into a pill.
**The general rule:** a token named after a component must mean only that component. The
test is whether you can change it without checking who else uses it.

### D6 · The brand mark is artwork, not a token
**2026-10-16.** Authority is the files in `web/public/brand/`. `lib/spark.ts` is a
**measured trace**, fitted by rendering candidates and diffing them against the PNGs until
the difference was antialiasing only — 0.42% on the mark, 1.00% on the icon.
`test/mark.test.ts` re-runs that diff every test run.
**Why:** a logo is not a design token. A rebrand does not recolour a logo, it replaces it.
So authority runs **art → tokens → code**: every brand colour is sampled from the artwork,
and the CTA gradient is literally the app icon's gradient.
**Rules out:** redrawing the mark by eye. Re-export the art and run `bun run brand:icons`.
*(This also fixed a latent bug: the manifest referenced five icon files that did not exist.)*

### D7 · When a variant is a variant, and when it is two components
**The test: if it would change the ARIA role or the keyboard contract, it is two
components wearing one name.**
- `StepBar` is **not** a `ProgressDots` variant — one is `aria-hidden`, the other is a real
  `progressbar`.
- `ChipGroup` is **not** a `ChoiceGroup` variant — radio group versus independent toggles.
- `Sheet` **placement** (`bottom` / `centre`) **is** a variant — same role, same focus
  contract, only the position differs.

### D8 · Prefer the native control
`<input type="range">` for sliders, `<dialog>` for sheets, numeric `inputMode` instead of
a custom keypad.
**Why:** the native range input already has arrows, Page Up/Down, Home/End and announces
itself; `showModal()` gives focus entry, focus trapping, focus **return** and Esc. A div
with pointer handlers looks identical and loses all of it.
**The one exception** is the full-screen photo viewer, which needs a black room that
`<dialog>` fights — so it re-implements Esc, scroll lock, focus in **and focus back out**
by hand.

### D9 · Write for Nigerians
**2026-10-17.** `web/CLAUDE.md` design rule 9.
Real neighbourhoods (Lekki Phase 1, Ikeja GRA, Maitama), Nigerian names in mock data,
`≈₦25k` not `NGN 25,000.00`, Afrobeats and Amapiano in interests because people say them.
**Pidgin is deliberately not used for flavour** — this product handles money and personal
safety, and a trust screen written in slang reads as talking down. Plain, warm Nigerian
English carries it.
**Caught on application:** the area list was invented, and "Lagos Island / Abuja Central"
is not how anyone here gives their location.

---

## Product and architecture

### P1 · Users pay in USDC; Naira is shown beside it
**2026-10-17.** Jaco's call. Resolves in favour of `architecture.md` §5, which was right
all along — the Naira-only design was a display question, not a different payment stack.
**`companion-contracts` lives.**

| Context | Primary | Secondary |
|---|---|---|
| Browsing — cards, "from" rates | `≈₦25k` | — |
| Committing — plan totals, checkout, wallet, receipts | `30.00 USDC` | `≈₦49,500` |

**A card or bank transfer is an on-ramp, not a payment method.** It buys USDC into the
wallet and the plan is funded from the balance. The wallet screen said "Saved methods",
which promised a card charge that never happens; it says "Top up with".
**Three formatter rules:** `30.00 USDC`, never `$30.00` — beside a `₦` figure a `$` reads
as a second fiat currency. The ₦ is always prefixed `≈`. An estimate over ₦10,000 rounds
to the nearest thousand, because `≈₦24.8k` claims precision the rate feed does not have.
**The rate is one constant** in `lib/mock/rate.ts`: two components holding two rates is how
a plan shows ≈₦50k in a chat and ≈₦52k at checkout, which reads as overcharging.
*(web `7a966dd`, backend `71a0952`)*

### P2 · `topUp(bookingId, amount)` on the escrow contract
**2026-10-20.** In the §5 function table before 4.1 is built.
**Why:** a rendezvous can be extended while running, but the contract holds a fixed amount
locked against the booking. **A contract cannot gain a function after deployment** — it
has to be replaced and the funds migrated.
**Rules out:** a second escrow for the extra hour, which turns one evening into two
payments to release, refund and dispute.

### P3 · Arrival is confirmed by both people
**2026-10-20.** §6 required one PIN check-in; it now holds both flags and only moves to
`IN_SESSION` when each has confirmed.
**Why evidentiary, not cosmetic:** a one-sided check-in is one person's claim, and "we
were both there" is the fact a dispute turns on.

### P4 · Mapbox Static Images, not GL JS
**2026-10-20.** Behind `NEXT_PUBLIC_MAPBOX_TOKEN`.
**Why:** 800KB of JavaScript is a bad trade on a screen opened while walking to a
restaurant on mobile data. The static API is one `<img>` the browser caches.
**Revisit when:** live position lands on that map (§7) — a moving dot needs a live canvas.
**Without a token it falls back to a drawn placeholder**, because a missing token is a
configuration problem and should look like an unstyled map, not a crash.
**Note:** the marker colour is `BRAND.primary` with the hash stripped — the fourth
consumer of the one permitted literal colour, and **the only one the design-system test
cannot see**, because it ends up in a URL rather than a class name.

### P5 · Fake what cannot mislead; never fake what can
Two calls that look contradictory and are not:
- **The map placeholder is drawn**, not fake tiles. Fake tiles look like a working map.
- **The QR is really generated.** A decorative QR looks scannable and is not, which on an
  arrival screen leaves two people pointing a camera at nothing.

### P6 · The voice call was removed
**2026-10-17.** Jaco's call, after it was built.
**Why:** "your number stays private" means a masked call through a telephony provider —
a vendor, a per-minute cost and a compliance surface that `architecture.md` does not
mention. A dead control in a shipped flow is a promise the product has not made.

### P7 · Safety actions sit two taps deep, behind `More`
**Why:** on the surface where you decide whether to message someone, a Block button beside
the CTA is a misfire waiting to happen. Two taps is still reachable from anywhere.
**Three related calls:** report reasons are a **fixed list**, because the admin queue
groups by them and free text means a moderator reads five hundred sentences to find the
three that say the same thing. **112 is a real `tel:` link**, because an in-app queue is
the wrong tool for someone in danger now. **The Block button is tinted, not a red slab** —
a UI that shouts at you for reaching for a safety tool makes people hesitate at exactly
the wrong moment.

### P8 · Safety toggles default ON
**Why:** a safety feature you have to find and switch on protects the people who already
knew to look for it, which is not who it is for. Each hint states how long it lasts, so
"share my live status" is not something you turn off once and never back on.

### P9 · Server events are mocked with timers, never a "simulate" button
Amara accepting a plan (4s), the other side confirming arrival (3.5s).
**Why:** the design says "usually replies within an hour". A simulate control is
scaffolding the real flow never has, and it hides the waiting-state design behind a dev
affordance. The screen behaves exactly as it will when a socket event replaces the
`setTimeout`.

### P10 · States are reachable by doing, not by a URL flag
Wrong code, locked out, no matches, location denied, unknown number, not enough USDC —
all reached by typing or tapping. Where a state needs different *data*, it gets a
different **record**, not a parameter: `/rendezvous/p-amara` has just started,
`/rendezvous/p-kemi` has nine minutes left.
**Why:** two plans in two states is what the real app looks like; `?remaining=600` is a
thing only the developer would ever type.

### P11 · Admin endpoints ship with each module; admin screens lag
**Why:** `/admin/*` endpoints are cheap alongside the module and retrofitting audit
logging is miserable. A moderation queue is worth building when there is content to
moderate.

---

## Bugs worth remembering

Each of these was invisible in a screenshot and found by a test or by reading.

| # | Symptom | Cause |
|---|---|---|
| B1 | Pasting a 6-digit code filled in one digit | `maxLength={1}` makes the browser clip pasted text **before** `change` fires. Needed an explicit `onPaste` reading `clipboardData`. Pasting from the SMS notification is the common path. |
| B2 | Pasting `+234 803 412 4521` produced garbage | `toNationalDigits` stripped the trunk `0` but not the dial code. Fixed to strip the prefix only when what remains still fits. |
| B3 | A correct OTP looked rejected | It was accepted — but routed to `/`, the welcome carousel, which is indistinguishable from being rejected. Three success paths dead-ended the same way. |
| B4 | The OTP screen was a dead end | The stand-in accepted one hard-coded code. **The default was backwards**: in an unwired build the happy path must be the default and the failure the thing you opt into. |
| B5 | Safari zoomed the page on input focus | Inputs were on the 14px label scale. Safari zooms any focused input under 16px, and the user cannot undo it without pinching. |
| B6 | `rounded-button` and `rounded-pill` both survived a merge | See **D2**. |
| B7 | Outgoing chat bubbles were the same white as incoming | `ChatBubble` was built as onboarding decoration where the colour never mattered. In a real thread nothing told you which messages were yours. |
| B8 | The hold menu opened on a row already released | The long-press timer was a local `let`, recreated every render, so an interrupted hold left an uncancellable timer. Now a ref, cleared on unmount. |
| B9 | `ME.verified ? badge : null` was a branch that could never be false | `as const` pinned it to the literal `true`. **Mock objects standing in for API responses get an explicit interface; `as const` is for genuinely fixed option lists.** |
| B10 | `resendIn` would have printed `0:75` | The minutes were a literal `0:` prefix — correct at 45 seconds, wrong the moment anyone raised it. Exposed by the ten-minute lockout; now `formatCountdown` in `lib/date.ts`. |

**The pattern:** a unit test of the function nearest the change would have passed through
B3 and B4 both times. The tests that caught them assert on **where the user ends up**, not
on the verdict of the function underneath.

---

### I11 · The operator key is required in production, optional elsewhere
**2026-10-20.** Jaco's call on the `chainEnvSchema` `TODO(human)`.
`appEnvSchema` is `appEnvObject.superRefine(...)`, checking `NODE_ENV` and
`OPERATOR_PRIVATE_KEY` together.
**Why on the merged schema:** the rule spans two blocks — `NODE_ENV` is infra,
the key is chain — so neither sees both alone, and `.optional()` cannot express
"optional, except when it isn't".
**Why at boot rather than in the escrow module:** a missing key in production is
not a feature being unavailable, it is **refunds silently failing**, found by a
user who did not get their money back. The alternative defers the error to the
first refund attempt, which could be weeks.
**Rules out:** `.optional()` alone; an enum of the two Base chain ids, since a
local Anvil fork is 31337 and the escrow integration tests need it.
**Wrinkle:** `superRefine` returns a `ZodEffects`, which has **no `.shape`**.
`loadEnv` reads `.shape` for its typo check, so the plain object is kept as
`appEnvObject` and exported as `APP_ENV_KEYS`.

### I12 · **Reverses I11** — the escrow module enforces the operator key, not `loadEnv`
**2026-10-20, same day.** Jaco switched to the second option after seeing the
first implemented. `OPERATOR_PRIVATE_KEY` stays `.optional()` in the schema;
`requireOperatorKey(env)` in `common/config/env.ts` throws, and the escrow
module calls it at construction (step 4.2).

**Why this is the better call, which neither of us said when choosing:**
`architecture.md` §3 says each module owns its own Postgres schema **so modules
can be split into services later**. A boot-time check in `loadEnv` would make a
future profile or messaging service refuse to start in production over an
escrow key it will never use. Config validating shape, and each module
enforcing its own requirements, is what keeps that split possible.

**And it gives up almost nothing.** Nest builds the entire module graph at
startup, so in any deployment that *does* include escrow the process still dies
at boot — exactly as under I11, just scoped to the deployments that care. The
"fails later" cost of option 2 is theoretical here.

**Bonus:** `appEnvSchema` is a plain `ZodObject` again, so the `.shape` wrinkle
from I11 disappears and `APP_ENV_KEYS` is gone.

**Rules out:** a cross-field rule in `loadEnv`; any module reading
`OPERATOR_PRIVATE_KEY` directly instead of through `requireOperatorKey`, which
is where the error message explaining *what breaks* lives.

### I13 · A long-lived Redis connection retries forever; a request-path one fails fast
**2026-10-20, build-plan 0.2.** Found by booting with Redis down.
`ioredis`'s `duplicate()` **inherits the parent's options**, and the Socket.io
Redis adapter duplicates the shared client — so it inherited
`enableOfflineQueue: false` and `maxRetriesPerRequest: 2`, which are exactly
the settings `common/redis` chose to keep a Redis blip from taking the API
down. It killed the process in two layers: `createAdapter` SUBSCRIBEs
immediately and threw synchronously; with the queue on, the queued commands
were flushed as unhandled rejections after two attempts.
**The rule:** the shared client fails fast so a readiness probe reports unready
rather than hanging. The adapter's pub/sub and BullMQ's connection override
both options, because dropping a broadcast or a job when Redis blinks is worse
than buffering it.
**Rules out:** sharing one Redis client across request-path and long-lived
uses, and `duplicate()` without an explicit options override.
**Note:** invisible to `tsc` and to every unit test. Only `node dist/main.js`
with the infrastructure down surfaced it — which is also the state a container
is in for the first seconds of every deploy.

### I14 · The rate limiter is hand-written, not `@nestjs/throttler`
**2026-10-20.** `common/rate-limit`, a sliding window in one Lua script.
**Why:** throttler applies one policy per route, and this product needs
per-action budgets with different windows and different **keys** — six OTP
sends per phone number per hour is not the same shape as thirty messages per
conversation per minute. Its Redis storage is also a third-party package on
the critical path of login.
**Sliding, not fixed:** a fixed window lets someone spend the whole budget at
11:59:59 and again at 12:00:00 — double the limit across two seconds, which on
OTP sends is a bill.
**Atomic:** read-then-write from the app is a race that two concurrent requests
both win.
**Keyed by subject, not IP:** rate limiting OTP by IP punishes everyone behind
one Nigerian carrier NAT while costing an attacker with proxies nothing.

### I15 · No cross-module foreign keys
**2026-10-20.** Within a module, real foreign keys. Across modules,
`reference()` and a call to the other module's service.
**Why:** architecture.md §3 wants modules splittable into services, and a key
from `booking.bookings` to `auth.users` is a database-level coupling that
cannot survive that split. It also enforces at the wrong layer — "this user
exists" is a question only the auth module can answer.

### I16 · A login endpoint must cost the same for a real account and a fake one
**2026-10-20, build-plan 1.1.** `AdminService.login` verifies the password even
when no account matched, against a **real** argon2id hash of a value nobody
knows.
**Why:** returning early on an unknown email makes "no such admin" measurably
faster than "wrong password", and anyone can enumerate the admin list with a
stopwatch.
**The dummy hash has to be genuine.** Measured: `verify` against a real hash
takes **10ms**, against a malformed string **1ms** — a placeholder throws
immediately, which *is* the signal it was meant to remove. Verified against the
running API at 16.1ms known / 15.8ms unknown.
**Rules out:** an early return on a missing account; a hand-written constant
that is not a valid argon2 encoding.

### I17 · Session tokens are stored as SHA-256, not argon2
**2026-10-20.** Password hashing is argon2id; session tokens are plain SHA-256.
**Why they differ:** argon2 is deliberately slow to make guessing a
**low-entropy** secret expensive. A 256-bit random token has nothing to guess,
so the slowness would be paid on every authenticated request and buy nothing.
The property that matters — a leaked table yields nothing presentable as a
session — is delivered by either.

### I18 · Admin routes are unversioned, at `/admin/*`
**2026-10-20.** `main.ts` excludes `admin/(.*)` from the `/v1` global prefix.
**Why:** admin is a separate surface with a separate origin, a separate session
cookie and a separate consumer. Versioning it alongside the public API ties an
internal console's URLs to the public contract's lifecycle for no benefit.
**Found the hard way:** the prefix was swallowing every admin route, so all of
them 404'd — while 80 unit tests passed. Only `curl` against the built output
caught it.

### I19 · The admin guard denies by default
**2026-10-20.** `@UseGuards(AdminGuard)` is on the controller class; routes opt
**out** with `@AdminPublic()`.
**Why:** opting *in* per route means an endpoint added in a hurry is
unprotected, and nothing fails to say so. The cookie is `httpOnly` and
`sameSite: 'strict'` — nothing should ever navigate into the admin console
from another site, so strict breaks no real flow.

### I20 · The first admin is created by CLI, not a seed endpoint
**2026-10-20.** `bun run admin:create <email> <password> [role]`.
**Why there is a problem at all:** admin creation is behind `AdminGuard`, so
there is nobody to authenticate as until an admin exists. The usual fix — a
seed route that only works while the table is empty — is an unauthenticated
account-creation endpoint that lives in production forever, one truncated
table away from being usable by anyone who finds it.
**A CLI needs shell access to the server**, which is a far better fence than a
runtime condition. It goes through `AdminService` rather than SQL, so the
password rules and the audit row apply identically to an admin created later
through the console.
**Rules out:** a seed HTTP route; inserting an admin with raw SQL, which would
skip the password policy and leave no audit trail.

### I21 · The browser never calls the backend directly; Next route handlers proxy
**2026-10-20.** Jaco's call. Web and admin each get
`app/api/[...path]/route.ts`, forwarding server-side to the backend.
`lib/api/client.ts` in both points at `/api/*`.
**Why — cookies, not tidiness.** Web on Vercel and the backend on Railway are
**cross-site**, so a session cookie set by the API origin is a third-party
cookie. Safari's ITP already blocks those and Chrome is phasing them out:
login would fail **silently** for a large share of users with nothing in the
logs. Proxying makes the session first-party to the app's own origin.
**Side effects:** CORS stops mattering for HTTP, and the backend URL is never
public.
**Supersedes:** architecture.md §2's "web and admin talk to the backend over
HTTP" and `CLAUDE.md` rule 1 in both front-end repos, now updated.

### I22 · The socket authenticates with a ticket, not the session cookie
**2026-10-20.** Follows directly from I21, and **answers the open
`TODO(human)`** in `realtime.gateway.ts`.
**Why the cookie cannot work:** a WebSocket cannot proxy through a Next route
handler, so Socket.io connects to the backend origin directly — and the
session cookie is first-party to the *app's* origin, so the browser will not
send it. The client calls an authenticated endpoint for a ~30-second
single-use ticket and passes it in `handshake.auth`.
**It is also the safer option independently:** a WebSocket upgrade is not
subject to CORS, so a cookie-authenticated socket would be openable by any
site the user visits — CSRF over a socket.
**Rules out:** reading `handshake.headers.cookie`; trusting any user id the
client sends.

### I23 · Every step ships a UI you can click
**2026-10-20.** Jaco: "anything we do has to work and be connected end to end…
all I want to do is go to the UI and test."
**Supersedes P11**, which said admin endpoints ship with each module while the
screens lag. They no longer lag.
**Consequence:** build-plan **0.4 moves ahead of further backend modules** —
1.1's endpoints exist with no way to reach them. Each step costs more; in
exchange nothing is ever "done" in a state Jaco cannot try.

### I24 · The OpenAPI spec must document error responses, or clients cannot handle them
**2026-10-20.** `common/http/api-error.dto.ts` declares the envelope for
Swagger, and `@ApiErrors(400, 401, …)` attaches it per endpoint.
**Found by lint, in the admin app.** `errors.ts` declared the envelope in zod
for the *runtime*, but no `@ApiResponse` named it — so `openapi-typescript`
generated clients whose `error` was `never`. Every `if (error)` in a hook was
dead code the compiler believed could never run, and a failed request would
have fallen through to "success with no data".
**Rule 2 says the spec is complete.** A spec documenting only the happy path is
not, and the gap is invisible until something tries to consume it.
**Rules out:** declaring an error shape only in zod; adding `@ApiResponse` per
status by hand, since the one that gets forgotten is the one a client cannot
then handle.

### I25 · The identity provider sits behind one interface
**2026-10-20, build-plan 1.2.** `IdentityProvider.verify(token)` in
`modules/auth/domain/`, bound to Privy in exactly one factory.
**Why it is worth the indirection:** the economics are genuinely unsettled.
Privy bills **per monthly active user** — free to ~499, then ~$299/mo — while
our own OTP costs **₦6–9 per SMS** plus an abuse surface to defend. Which wins
depends on how many people browse without ever booking, a ratio nobody will
know for a year. `architecture.md` §4 already had the backend issuing **its
own** session cookie after verifying a provider token, so the provider was
never load-bearing; this makes that explicit.
**Chosen for now:** Privy for both sign-in and wallet, because under 499 MAU it
is free, there is no SMS bill, and no abuse defences to build.
**Revisit when:** approaching the MAU boundary.

### I26 · A wallet has a chain *family*, not a chain id
**2026-10-20.** `wallets.chain_type` is `ethereum` or `solana`.
**Why:** an EVM address is not chain-specific — the same address holds funds on
Base, Ethereum and Polygon alike, so a per-wallet chain id records something
that is not a property of the wallet. Which chain we settle on comes from
`CHAIN_ID` in config. The family *is* a property, because a Solana address
cannot hold our USDC at all.
**Found via:** Privy deprecating `chainId` in favour of `chainType`, which
turned out to be the right model rather than a rename.

### I27 · User sessions are `sameSite: lax`; admin sessions are `strict`
**2026-10-20.** Different cookies, different rules, deliberately.
**Why they differ:** a user legitimately arrives from a shared link or a push
notification, and `strict` drops the session on that first cross-site
navigation — indistinguishable from being logged out. The admin console has no
such flow, so nothing is lost by keeping it strict there. User TTL is 30 days
against admin's 12 hours, for the same reason: one is a consumer app, the other
is a tool for people with elevated power.


### I28 · Suspension is admin-only, reversible, and never restores a session
**2026-10-20, build-plan 1.2.** Jaco chose admin-only suspension and reinstatement.
Moderators can list users and reveal a phone, with an audit record, but cannot
change access. Both destructive actions need an in-page confirmation and a
trimmed, nonempty reason (maximum 1,000 characters).

**Why revocation as well as `disabled_at`:** the existing session lookup already
rejected disabled users, but clearing that timestamp alone would revive old
sessions. Both transitions revoke all sessions; a reinstated user must sign in
again. Sign-in checks suspension before updating contacts, linking wallets or
issuing a cookie.

**Why a shared transaction:** status change, session revocation and audit insert
must all commit or all roll back. `AdminService.audit` accepts a transaction
handle; the auth module still never imports the admin schema/repository. Sign-in
and suspension lock the same user row, and initial sign-ins also take a
provider-key advisory lock so concurrent first logins cannot create two users.

**PII:** the list returns masked phone numbers, never raw contact/profile data.
An explicit reveal records access before returning the number with `no-store`.
The UI holds the revealed value only in mounted component state; neither query
nor mutation results retain it. Logout clears protected caches.

### I29 · A native users table until the table package can be installed
**2026-10-20.** The users screen uses semantic HTML with server-side filtering,
sorting and pagination, and TanStack Query for requests. TanStack Table remains
the intended console stack, but it was not installed and the workspace denied
package-registry DNS during this session. No dependency or lockfile was faked.
**Revisit when:** registry access is available and another table needs the shared
abstraction. This temporary implementation keeps the current slice usable.

### I30 · Generate API clients without booting infrastructure
**2026-10-20.** `bun run api:export /private/tmp/rendezvous-openapi.json` builds
the backend and exports real controller metadata without listening or opening
Postgres/Redis connections. It uses the same OpenAPI configuration and route
prefix exclusions as production. Its controller list must stay current as new
modules are added. Frontends can run `openapi-typescript` on that local file.
**Why:** this workspace denied Docker, local network access and port binding.
API generation should not require a running database or a listening server.
The HTTP test harness likewise drives real Express/Nest middleware, guards,
pipes and JSON responses in-process without a TCP listener. These checks do not
replace a live database/browser acceptance test.


### I31 · Cookie paths must match the browser-facing proxy URL
**2026-10-20, admin login follow-up.** The backend issues its admin cookie at
`Path=/admin`, but the browser requests `/api/admin/*`. Passing the cookie
through unchanged stored a first-party cookie that the browser would never send
on the next API request. The proxy now maps the path to `/api/admin` on both
issuance and logout deletion, preserving security flags and individual
Set-Cookie headers (Expires contains a comma, so cookies cannot be split on it).
This corrects the earlier proxy passthrough assumption; the backend's own cookie
contract remains unchanged.

There was a second redirect race: invalidating cached `me: null` after TOTP
left that signed-out value visible to the console while its refetch was pending.
TOTP success now cancels any old identity request and seeds the returned admin
profile before replacing the login route with the dashboard. Failed/empty login
responses do not navigate. Regression tests cover the cookie path, logout path,
multiple cookies, stale signed-out state and successful/failed TOTP navigation.


### D10 · The admin uses the same Rendezvous identity as the web
**2026-10-20.** Jaco pointed out that the blue admin theme looked like another
platform. The earlier distinction existed in admin's CSS commentary, but it was
the wrong product choice: console identity comes from its Admin label, navigation
and tasks, not a second brand.

The admin now follows web's original artwork, magenta palette, Plus Jakarta Sans,
warm blush/cream background, pill actions and rounded surfaces. It retains a
desktop/tablet console layout. The app icon was copied byte-for-byte from
`web/public/brand/app-icon.png`; it is not redrawn. Components and CSS remain
owned by their respective repos, with no cross-repo runtime imports. The web
brand artwork and tokens are the reference when updating either surface.

Supersedes the old admin-only blue-theme rationale. Destructive actions retain
semantic danger styling so their consequences remain clear within the brand.


### I32 · Pin the contract toolchain and make deployment metadata executable
**2026-10-20, step 0.5 preparation.** Foundry v1.8.5 and Solidity 0.8.37 are exact
pins. The EVM target is explicitly Cancun, so adopting a current compiler does
not silently change the opcode target. OpenZeppelin v5.7.0 and forge-std v1.17.0
are pinned as Git submodules to their official release commits, recorded in the
contracts README and staged Git links. No floating branch or `latest` dependency
is used.

The deployment format is a JSON Schema with an executable Ajv check: only the
six agreed fields, nonzero EVM addresses, positive safe block numbers, compiler
ABI structure and matching Base/Base Sepolia filenames. No fictional network
artifact is created; the production release directory is empty until 4.1. This
prevents examples from being mistaken for deployment truth by later chain:sync.

The common check command validates metadata, formatting, compilation and Solidity
tests; CI uses the same command with its larger fuzz profile. Local metadata
checks pass, but Foundry is absent and GitHub downloads are blocked in the agent
workspace. No Forge result, completed 0.5 checkbox or contracts implementation
commit is claimed before those required checks run. This is a tool-access limit,
not a need for a chain account or real funds.


### I33 · Run the existing app checks on every pull request
**2026-10-21, step 0.6.** Each app owns its CI workflow, using Node 22,
Bun 1.4.0 and `bun install --frozen-lockfile`. Pull requests, main pushes and
manual dispatch run separate typecheck, lint and test steps with read-only
repository permissions. New runs cancel obsolete runs on the same ref.

Next.js generates route types before tsc, so a fresh clone does not depend on
someone having started the dev server. Backend tests get disposable Postgres 16
and Redis 7 with health checks and explicit test-only connection settings. The
current suite does not use spatial queries, migrations or object storage; those
services/checks must be extended with future integration coverage. Provider
verification remains mocked at its existing interface; no real credentials are
needed. CI does not regenerate API schemas from an unavailable backend or deploy
anything. Local checks pass; hosted workflow execution awaits a user push.
