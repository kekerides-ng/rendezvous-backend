# Status — Rendezvous

**Last updated: 2026-10-20 (0.1 closed).** Master copy lives in `companion-backend/docs/STATUS.md`
and is byte-identical in all four repos. Rewritten after each piece of work, not appended.

---

## Start here

You are picking up a project already in progress. Before changing anything:

1. **Read `docs/DECISIONS.md`** — why things are the way they are. A lot of
   what looks odd here was a deliberate call with a reason.
2. **Read the `CLAUDE.md` in whichever repo you are working in** — that is the
   rulebook for it, and the rules are enforced by lint and tests, not by trust.
3. **Read `docs/architecture.md`** — the design. It is **byte-identical in all
   four repos**: edit `companion-backend/docs/architecture.md` and copy it to
   the other three, or you will break the sync.
4. **`docs/build-plan.md` is the pointer.** The checkboxes say where work has
   got to, not the git log and not this file.

House rules that are easy to break by accident:

- **Commit each change as it lands**, with a conventional-commit message, once
  `typecheck`, `lint` and `test` pass. Do not batch a session into one commit.
  Never add a remote or push without being asked.
- **One build-plan step per session.** Finish it, write it up in that repo's
  `docs/learning-log.md`, tick it in all four `build-plan.md` copies.
- **Prettier must never format Markdown.** `*.md` is in every `.prettierignore`
  because reflowing a table silently breaks the byte-identical docs.
- **Bun, never npm/pnpm/yarn.** Commit `bun.lock`.
- **`TODO(human)` markers are Jaco's homework, not yours.** Leave them. There
  should only ever be one open at a time.

---

## Where the work stopped

**The web app is fully drawn and completely unwired. The backend is a scaffold
with no modules. That is the whole state in one sentence.**

| Repo | State |
|---|---|
| `companion-web` | ~40 routes covering every supplied design frame. All data comes from `src/lib/mock/`. 385 tests. Build-plan **0.3 done**. |
| `companion-backend` | Build-plan **0.1 done** — Nest scaffold, fail-fast zod config (including the chain block), pino logging, exception filter, health, Swagger, Drizzle, docker-compose. 47 tests. **No feature modules.** |
| `companion-admin` | Documentation only. Repo initialised, nothing built. |
| `companion-contracts` | Documentation only. Repo initialised, nothing built. |

### Current phase

**Phase A — finishing the foundation.** Nothing in Phase B can start until
build-plan **0.2** lands, because every module needs its column helpers and
event bus.

### The next three actions

1. **0.2 backend** — common pieces: DB module + column helpers (`id`,
   `timestamps`, `usdc` bigint, `geographyPoint`), `@nestjs/event-emitter`,
   BullMQ, Socket.io gateway skeleton, rate limiter. **This blocks everything.**
   *Next up — nothing is in the way of starting it.*
2. **0.5 contracts** — `forge init`, pinned OpenZeppelin, `deployments/`
   format. Before 4.1 because `Escrow.sol` must include `topUp()` from the
   start; a contract cannot gain a function after deployment.
3. **0.4 admin** then **0.6 CI** — admin scaffold and login shell, then
   typecheck/lint/test CI in all four repos.

**0.1 is closed.** The config now refuses to boot in production without
`OPERATOR_PRIVATE_KEY`, and the backend learning log has its entry.

---

## How to run each repo

Everything uses **Bun** for install and scripts, Node 22 as the runtime.

### `companion-backend`

```bash
bun install
docker compose up -d     # Postgres+PostGIS, Redis, MinIO
bun run dev              # port 4000
bun run typecheck && bun run lint && bun run test
```

**The Docker ports are offset on purpose** — Postgres **5433**, Redis **6380**,
MinIO **9002/9003** — because a superseded project at `~/Documents/rendezvous old`
holds the standard ones. Connecting to 5432 gets you the wrong database.

Swagger is at `http://localhost:4000/docs`, and the spec web and admin generate
from is `/docs-json`.

### `companion-web`

```bash
bun install
bun run dev              # port 3000
bun run typecheck && bun run lint && bun run test && bun run build
```

- **`/design` is the style guide and the review surface.** Every primitive in
  every state, plus links to every screen. Start there.
- `bun run brand:icons` regenerates the PWA icon set from `public/brand/`, and
  `--check` verifies the traced mark still matches the artwork.
- `bun run api:gen` regenerates `src/lib/api/schema.d.ts` from the backend's
  `/docs-json`. There is nothing to generate yet.
- **Jaco runs the dev server.** Do not start one on port 3000 without saying so;
  use `bun run build` to verify instead.
- If something that is plainly in a file reports as `not a function`, it is the
  Turbopack dev cache. Restart the dev server.

### `companion-admin` / `companion-contracts`

Nothing to run yet. See build-plan 0.4 and 0.5.

---

## Wiring: what a slice looks like from here

The screens exist, so every remaining web step is **wiring, not building**.
`56 files` import from `src/lib/mock/`. Per slice:

1. **backend** — `<module>.schema.ts` in its own `pgSchema` → `.repo.ts` →
   `.service.ts` → `.controller.ts` with Swagger-decorated DTOs →
   `*.admin.controller.ts` behind `AdminGuard` → Vitest. Then
   `bun run db:generate`, review the SQL, `bun run db:migrate`.
2. **web** — `bun run api:gen`, add `features/<x>/use-<x>.ts` TanStack Query
   hooks calling through `src/lib/api/client.ts`, swap the screen's import from
   `lib/mock/<x>` to the hook.
3. **web** — delete `src/lib/mock/<x>.ts`. **That file disappearing is how the
   slice is known to be finished.**

Loading, empty and error states already exist on every screen — `Skeleton`,
`EmptyState` and `Notice` are built and on `/design`.

---

## Open `TODO(human)` — Jaco's, not yours

One is open, which is the correct number:

- `web/src/components/ui/pill.tsx` — whether pill tones should be semantic
  (`info`/`trust`) rather than presentational (`dark`/`light`). Three later
  components (`AssuranceRow`, `Notice`, `SheetOption`) all went semantic, so
  the pattern now has evidence behind it.

---

## Known debt and deliberate deviations

- **Admin screens are deliberately lagging.** Each module's `/admin/*`
  endpoints get built with the module; the queues get built when there is
  content to moderate.
- **The map needs a token.** `NEXT_PUBLIC_MAPBOX_TOKEN` in `web/.env`. Without
  it `MapSurface` falls back to a drawn placeholder rather than a broken image.
- **Photos are gradient placeholders** everywhere. Real assets go in
  `web/public/mock/`.
- **`as Route` casts defeat typed routes.** Template-literal paths need the
  cast, but it also silences a route that does not exist — one was shipped
  before its route existed and the build stayed green.
- **Mock timers stand in for server events.** Amara accepting a plan, the other
  side confirming arrival. Deliberate: a "simulate" button would be scaffolding
  the real flow never has. They become socket events.
- **No `lib/api` usage yet.** `client.ts` and a placeholder `schema.d.ts` exist
  so the seam compiles.

---

## Where the detail is

| Question | File |
|---|---|
| What is the system meant to be? | `docs/architecture.md` |
| What has been done, and what is next? | `docs/build-plan.md` (the checkboxes) |
| Why is it like this? | `docs/DECISIONS.md` |
| What broke, and what nearly did? | `<repo>/docs/learning-log.md` |
| What are the rules for this repo? | `<repo>/CLAUDE.md` |
| What exactly changed, and when? | `git log` in each repo |

`web/docs/learning-log.md` is the longest and most useful of these — it records
the one thing most likely to break for each step built so far.
