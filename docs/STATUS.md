# Status — Rendezvous

**Last updated: 2026-10-21 (1.3 direct NIN Quick Check wired; live acceptance pending).**
Master copy lives in `backend/docs/STATUS.md`. This file, `DECISIONS.md`,
`architecture.md`, `build-plan.md` and `SERVICES.md` are byte-identical across
backend, web, admin and contracts. Rewrite status after each piece of work.

## Start here

1. Read `docs/DECISIONS.md` for the working agreements and reasons behind the design.
2. Read the relevant repo's `CLAUDE.md`; use Bun for installs and scripts.
3. Read `docs/architecture.md`; edit the backend master and sync copies.
4. Use `docs/build-plan.md` as the completion pointer. Work one step per session.

Commit coherent changes locally after typecheck, lint and tests pass. Never add
a remote or push unless asked. Never format Markdown with Prettier. Leave
`TODO(human)` markers alone; they are Jaco's homework.

## Where work stopped

**Real user sign-in and the admin users slice are implemented. KYC age policy,
status, storage and admin review are now wired; direct Youverify NIN submission,
verified-result ingestion and the web form are implemented. Most user app features
continue to read mock data. Steps 1.2 and 1.3 remain unchecked.**

| Repo | Current state |
|---|---|
| `backend` | Foundations 0.1/0.2, admin auth 1.1, Privy user auth, wallets and sessions. `/admin/users` list, phone reveal, suspend and reinstate endpoints. Direct Youverify NIN Quick Check request, strict response assessment, per-user budget, pending reservation and decision persistence. KYC migration `0004` is generated but not applied to live Postgres. |
| `web` | Drawn user app with real phone sign-in through Privy and the same-origin proxy. First login goes to `/sign-up/profile`, returning login to `/discover`. Most post-sign-in screens remain mock. The profile ID badge reads real KYC status; `/verify` now collects NIN, legal names, DOB, selfie and consent and posts to the backend. API types regenerated. |
| `admin` | Real password + TOTP login, shared protected console shell, dashboard and `/users`, now using the web's Rendezvous brand. Server-side filters/sort/pagination, masked phones, audited reveal, reason-required suspend/reinstate, and a KYC review queue with audited rejection. 34 tests pass; typecheck/lint pass. Production build is blocked in this workspace (see below). |
| `contracts` | **0.5 complete.** Foundry/compiler pins, initialized exact OpenZeppelin/forge-std Git links, six-decimal test token and SafeERC20 smoke/fuzz tests, deployment JSON Schema/validator and CI. Formatting/build pass; 30 metadata tests and 2 Solidity tests pass, including 1,000 fuzz cases under the CI profile. No escrow implementation or deployed contract yet. |

### KYC progress (1.3 remains open)

The backend now has the `kyc.verifications` schema/migration, strict document-DOB
parsing, a Lagos-calendar 18+ check and a `requireVerifiedAdult` service method for
future offer endpoints. A signed-in user can read only their KYC status; the admin
review queue exposes only status, result codes and age/approval flags. Admin and
moderator reviewers can reject a queued case with a reason; the status change and
audit entry share one transaction. There is intentionally no manual approval
endpoint: staff cannot manufacture identity or age evidence. No ID image, number,
image link or raw provider payload is stored in this module.

The web profile badge follows backend status; `/verify` collects NIN, legal
names, document DOB, selfie and explicit consent. The backend calls Youverify's
documented direct NIN Quick Check endpoint and accepts only a returned matching
NIN, validated names and DOB, selfie match, and adult provider DOB. Partial or
unknown responses go to review. A per-user pending row and three-per-day rate
limit protect billable requests. Decision and `auth.users` changes share one
transaction. The admin console has an ID review page. The KYC migrations still
need to run against a live database, and a real sandbox response must confirm
the validation flags before this step is accepted.

The [Youverify NIN API reference](https://doc.youverify.co/api-reference/quickcheck/kyc--nigeria/verify-national-identification-number-nin)
documents the direct route and fields. A vForm ID and public merchant key are
not needed. The API secret stays in ignored `backend/.env`; never copy it to
client code. This workspace cannot resolve the sandbox host or access the
Docker socket, so no live check or migration was run. Step 1.3 remains open.

### App CI (0.6)

Backend, web and admin each have `.github/workflows/ci.yml`: pull requests,
pushes to `main`, and manual runs install the frozen Bun lockfile, then run
separate typecheck, lint and test steps. Node 22 and Bun 1.4.0 match the project.
Next.js route types are generated before typechecking fresh checkouts. Backend
jobs use disposable Postgres 16 and Redis 7 services; current tests need neither
PostGIS extensions, migrated tables nor MinIO. Spatial/database integration
coverage must extend this setup when those tests arrive.

Local equivalents pass: backend 141, web 393 and admin 34 tests, with typecheck
and lint passing in each. Workflow YAML was parsed and required steps checked.
Hosted actions, Linux dependency installation and service startup have not been
run here. No remote was added and nothing was pushed. These workflows check code;
they do not deploy it or replace the pending live acceptance pass for 1.2.

### Shared Rendezvous identity

The admin now follows the web's original icon, magenta palette, Plus Jakarta
Sans, warm page gradient, pill buttons and rounded surfaces. Login, sidebar,
dashboard and users table use the same signature; the Admin label and console
layout identify the operational surface. Brand asset hashes match the web
original. Typecheck, lint and all 34 admin tests pass after this styling change.
No browser was available to the automation tool for a live visual review.

### What the new users slice does

- Open `http://localhost:3001/users` after admin sign-in, or follow **Users** in the sidebar.
- Both roles can list users and explicitly reveal a phone. Raw numbers never appear in list responses or query/mutation result caches. Reveals are audited and responses use `Cache-Control: no-store`.
- Only `admin` can suspend/reinstate. Each action needs an in-page confirmation and a reason. Backend role denial is 403, not 401.
- Suspension sets the existing `disabled_at` field, revokes every session and blocks sign-in before any user/contact/wallet/session writes. Reinstatement never restores old sessions.
- Sign-in and suspension lock the same user row. Status, revocation and audit insertion are one transaction; audit failure rolls the change back.
- Logout clears protected caches. API 401 redirects to login; permission and service errors remain visible as errors.

### Verification completed and limits

- Backend: `bun run typecheck`, `bun run lint`, `bun run test` (**189 passed**), `bun run build`.
- Admin: typecheck, lint, tests (**34 passed**); these include proxy forwarding, filters, confirmations, role visibility, reveals and logout cleanup.
- Web: typecheck, lint, tests (**402 passed**). Both API schemas were regenerated from the real controller metadata.
- Backend HTTP tests run the real Nest/Express middleware, cookie parsing, guards, validation and route prefix rules in-process without binding a TCP port. Repository tests exercise Drizzle's real SQL/transaction driver with a fake connection, including audit-failure rollback.
- **Not verified against live Postgres, Youverify or in a browser during this session.** Docker socket access and sandbox DNS were denied by the workspace. Real provider responses and database lock contention still need the live check.
- **Admin production build remains unverified.** Turbopack's internal port binding was denied. A webpack fallback got past that but could not download Inter from Google Fonts (DNS/network denied). Product fonts/configuration were left intact.
- TanStack Table could not be downloaded. This screen temporarily uses an accessible native table with the same server-side controls; requests still use TanStack Query. See I29.

## Next actions

1. Run the **1.3 KYC** migrations and a consented sandbox NIN check; confirm the actual response flags and adult/underage decisions. Then tick 1.3. Step **0.6 app CI** is complete.
2. Finish the remaining live acceptance pass for **1.2**, then tick it in all four build-plan copies.
3. **4.1 escrow implementation** stays in Phase 4; the foundation is ready for it now.

### Contracts foundation verification

The user installed Foundry and initialized the pinned submodules. The full
`bun run check` now passes: tool/dependency pins, 30 metadata tests, artifact
validation, Forge formatting/build and both Solidity tests. A separate
`FOUNDRY_PROFILE=ci forge test -vvv` also passes with 1,000 fuzz cases. The GitHub
workflow is defined but was not run on GitHub; no remote was added or pushed.
Foundry is installed in `~/.foundry/bin`; that directory must be on PATH.

From `contracts/` after a fresh clone:

```bash
foundryup --install v1.8.5
git submodule update --init --recursive
bun install --frozen-lockfile
bun run check
```

The Solidity tests validate a six-decimal mock token and SafeERC20 transfers.
They do not validate escrow business logic: `src/` and `script/` remain reserved
for 4.1. No escrow, deployment script, network deployment or release tag exists.
The deployment directory contains the schema/docs, never fake live addresses.
No RPC account, wallet or funds are needed for the local foundation checks.

### Live acceptance pass for 1.2

Start Docker and the backend, web and admin on the ports below. Use an existing
real user or sign in once by phone. Do not suspend a user's account without
choosing an appropriate test account.

1. Sign in as an admin, open Users, and verify the existing database row appears masked. Try status filters, timestamp sort, pagination and audited phone reveal.
2. Suspend the test user with a reason. Their existing `/api/v1/auth/me` request must return 401, and a fresh provider-token exchange must return 403 without setting a session cookie.
3. Reinstate with a reason. The old cookie must remain rejected; a new sign-in succeeds.
4. Check audit rows for actor, subject, before/after state, reason and request context. Reveals must not copy the phone itself into the audit payload.
5. Sign in as a moderator: listing/reveal work, destructive controls are hidden, and direct suspension/reinstatement requests return 403.
6. Exercise simultaneous sign-in/suspension against Postgres, then run the normal admin production build with network access.

## Run the apps

All package operations use **Bun**; production backend runtime is Node 22.

```bash
cd backend
bun install
docker compose up -d
bun run dev                 # 4000; Swagger /docs, spec /docs-json

cd ../web
bun install
bun run dev                 # 3000 — Jaco runs this; do not start another silently

cd ../admin
bun install
bun run dev                 # 3001
```

Docker ports deliberately differ from the old project's: Postgres **5433**,
Redis **6380**, MinIO **9002/9003**. Port 5432 belongs to the old project.

Each app: `bun run typecheck && bun run lint && bun run test`.
Backend/admin/web builds use `bun run build`.

### Sign in as a user

`http://localhost:3000` → Get started → actual phone number → SMS code.
First sign-in goes to `/sign-up/profile`; later sign-ins go to `/discover`.
Privy's public app ID belongs in `web/.env` as `NEXT_PUBLIC_PRIVY_APP_ID`.
`PRIVY_APP_ID` and `PRIVY_APP_SECRET` belong only in `backend/.env`. Never move
the secret back to the web app or expose it with a `NEXT_PUBLIC_` prefix.

### Sign in as an admin

If none exists, from `backend/`:

```bash
bun run admin:create ada@rendezvous.ng 'correct horse battery staple' admin
```

Open `http://localhost:3001/login`, enter email/password, enrol an authenticator
on first use, then enter its TOTP code. The dashboard links to Users.
Admin endpoints are `/admin/*`, **not** `/v1/admin/*`. The browser calls them
through the admin app's `/api/admin/*` proxy. Admin staff account management
remains a later step; `/users` is for application users.

### If admin creation or migrations fail

From `backend/`, run `bun run db:check` for a read-only connection/table check,
then `bun run db:migrate`. Migration and admin-creation failures now report the
underlying Postgres/network error code without printing SQL parameters or
credentials. The migration command uses Drizzle's runtime migrator with the same
SQL files and default `drizzle.__drizzle_migrations` history as drizzle-kit.

`ECONNREFUSED` means the endpoint is not accepting a connection; inspect
`docker compose ps`. `28P01` means the database rejected the password; check
DATABASE_URL against the credentials used to initialize the existing volume.
The Compose project name has a local user edit from `companion` to `rendezvous`,
which can select a different volume. Do not delete/reset volumes to diagnose it.
The user corrected the local database target to `rendezvous` and restarted the
backend, clearing the reported database error.

### If TOTP succeeds but login returns to the same screen

The admin proxy now maps the session cookie from backend `Path=/admin` to
browser `Path=/api/admin`, including logout deletion. TOTP success also replaces
cached signed-out state before navigating. These fixes pass 34 admin tests plus
typecheck/lint. Refresh the login page, start again, and use a fresh authenticator
code. Live browser confirmation is still pending; the existing authenticator
setup does not need to be recreated.

### Generate API types without a running backend

```bash
cd backend
bun run api:export /private/tmp/rendezvous-openapi.json
cd ../admin
bun x --no-install openapi-typescript /private/tmp/rendezvous-openapi.json -o src/lib/api/schema.d.ts
cd ../web
bun x --no-install openapi-typescript /private/tmp/rendezvous-openapi.json -o src/lib/api/schema.d.ts
```

Normal `bun run api:gen` still works against a running backend. The offline
export shares Swagger configuration/prefix rules with production; keep its
controller list current as modules are added.

## Later slices and existing debt

- Per slice: backend module/endpoints/Swagger/tests → generated frontend types → wire web/admin UI → live test → learning log → tick all four build plans.
- User mocks are still in `web/src/lib/mock/`; delete the corresponding mock file when its slice is fully wired.
- Mapbox needs `NEXT_PUBLIC_MAPBOX_TOKEN`; otherwise the map intentionally uses a drawn fallback. Photos are still placeholders.
- Phone/DOB column encryption remains pre-production debt already recorded in the auth schema. This session did not change contact storage.
- Preserve both existing `TODO(human)` markers: realtime socket authentication and the web Pill tone decision. I22 records the socket-ticket design, but the marker was not changed.
- No new third-party accounts or secrets are required by this users slice. See `docs/SERVICES.md` for later integrations.

Detailed reasoning lives in `docs/DECISIONS.md`; repo-specific explanations and
questions live in `docs/learning-log.md`.
