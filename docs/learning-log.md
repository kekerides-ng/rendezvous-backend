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
