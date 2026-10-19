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
