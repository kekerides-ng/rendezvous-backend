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
- **The operator key is required in production and optional everywhere else.**
  Jaco chose `superRefine` on the merged schema over letting the escrow module
  refuse to start. The rule spans two blocks — `NODE_ENV` is infra, the key is
  chain — so neither schema can see both alone, and `.optional()` cannot say
  "optional, except when it isn't". Boot is the only moment this check is
  cheap: a missing key in production is not a feature being unavailable, it is
  **refunds silently failing**, discovered by a user who did not get their
  money back.

That last one has a wrinkle worth knowing: `superRefine` returns a `ZodEffects`,
which has **no `.shape`**. `loadEnv` reads `.shape` to build the typo list, so
the plain object is kept as `appEnvObject` and exported as `APP_ENV_KEYS`.

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
