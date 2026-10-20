# CLAUDE.md — companion-backend

NestJS **modular monolith** for the companion platform. One of four separate repos (`companion-contracts`, `companion-backend`, `companion-web`, `companion-admin`). This repo is the source of truth for the API and for `docs/architecture.md`. The escrow contract lives in `companion-contracts`; this repo only consumes its deployment files.

Read `docs/architecture.md` before designing anything. Check `docs/build-plan.md` for the current step. Append to `docs/learning-log.md` after each step. Jaco is learning as this is built, so explain what you did and why.

## Product line (never cross)
Time and company only. No sexual services. 18+ verified via Smile ID. Fixed categories. Public venue for a first booking. No paid media unlocks. If a task would break this, stop and say so.

## Stack
NestJS · TypeScript strict · **Bun** for install and scripts (never npm/pnpm/yarn; commit `bun.lock`) · Node 22 runtime · Drizzle ORM · Postgres 16 + PostGIS · Redis · BullMQ · `@nestjs/event-emitter` · Socket.io · viem · Swagger (OpenAPI) · Vitest.

## Commands
- `bun install`
- `docker compose up -d` — Postgres+PostGIS, Redis, MinIO
- `bun run dev` — API with hot reload (port 4000)
- `bun run build` · `bun run lint` · `bun run typecheck` · `bun run test`
- `bun run db:generate` · `bun run db:migrate`
- `bun run chain:sync <tag>` — pull `deployments/<network>.json` (chainId, escrow, usdc, deployBlock, abi) from a tagged `companion-contracts` release into `chain/deployments/`
- OpenAPI: `http://localhost:4000/docs` (UI), `/docs-json` (spec used by web and admin)

## Layout
```
src/
  main.ts  app.module.ts
  common/          # config, logger, guards, filters, zod pipe, db module, column helpers
  modules/
    <module>/
      <module>.module.ts
      <module>.controller.ts        # user routes   /v1/<module>/...
      <module>.admin.controller.ts  # admin routes  /admin/<module>/...  (AdminGuard + audit)
      <module>.service.ts           # the module's public API for other modules (export this only)
      <module>.repo.ts              # the ONLY place that touches this module's tables
      <module>.schema.ts            # Drizzle tables in pgSchema('<module>')
      <module>.events.ts            # events this module emits
      dto/                          # request/response DTOs with Swagger decorators
      domain/                       # pure logic (state machines, fee math), no Nest/DB imports
  jobs/            # BullMQ processors
  realtime/        # Socket.io gateway
drizzle/           # generated migrations (commit them)
chain/deployments/ # synced from companion-contracts — never hand-edit
docs/
```

## Rules
1. **Module boundaries.** A module touches only its own tables. To use another module's data, call its exported service. To react to something, listen to its event. Never import another module's repo or schema.
2. **Every endpoint is documented.** DTOs carry Swagger decorators, so the OpenAPI spec is complete. Web and admin depend on it. Breaking an endpoint's shape means bumping it or telling Jaco to regenerate clients.
3. **Admin endpoints** live only in `*.admin.controller.ts` under `/admin/*`, use `AdminGuard` + role checks, and write to `audit_log`. Never expose admin data on user routes.
4. **Money** is integer micro-USDC (`bigint`). Never floats. No fee or refund math in controllers; it lives in `domain/`.
5. **Chain:** booking state changes from chain events only after N confirmations. Handlers are idempotent on `txHash + logIndex`. The operator private key comes from env and is never logged.
6. **Booking status** changes only through `transition(bookingId, from, to, actor)`.
7. **Migrations:** change a schema → `bun run db:generate` → review the SQL → `bun run db:migrate`. Never edit an applied migration.
8. Slow, retryable or scheduled work goes to a BullMQ job, not inline in a request.
9. Validate all input; parameterized queries only; no PII or private keys in logs.
10. After each change: `bun run typecheck && bun run lint && bun run test`. Fix before moving on.
11. When a decision changes, update `docs/architecture.md` in the same change.
12. Conventional commits. **Commit each implementation and each fix as it lands**, once `typecheck`, `lint` and `test` pass — one commit per coherent change, not one per session. Never add a remote or push without being asked.
13. **Keep the handover record current.** After a feature or fix lands, before the commit: rewrite `docs/STATUS.md`, and append to `docs/DECISIONS.md` if a call was made. They are **byte-identical across all four repos** like `architecture.md` — edit `companion-backend/docs/`, then copy to the other three. **And if a step turns out to need a third-party account, add it to `docs/SERVICES.md`** with what to create and which values to copy back, so Jaco can get them all in one sitting. These files are how someone picks this project up without you; a stale one is worse than none.

## Chain integration rules
- Contract code is NOT in this repo. Never write or edit Solidity here; changes go to `companion-contracts`.
- The ABI, addresses and deploy block come only from `chain/deployments/<network>.json`, synced with `bun run chain:sync <tag>`. Validate the file with zod at startup; refuse to boot if the chain id does not match `CHAIN_ID`.
- The escrow module's EIP-712 domain and terms types must match the contract's. If `chain:sync` brings a new contract version, re-run the escrow integration tests against an Anvil fork before deploying.
- `GET /chain/config` serves chainId, USDC address, escrow address and ABI to the web app.
- `OPERATOR_PRIVATE_KEY` is **optional in the env schema on purpose**. The escrow module calls `requireOperatorKey(env)` from `common/config` at construction and refuses to start without it — so a deployment that does not run escrow can still boot (`docs/DECISIONS.md` I12). Never read the variable directly.
