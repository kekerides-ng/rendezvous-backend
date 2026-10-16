---
description: Add a new backend module with user routes, admin routes, its own schema, and Swagger docs
argument-hint: <module-name>
---

Create the backend module `$ARGUMENTS`.

1. Read `docs/architecture.md` §3. Confirm what `$ARGUMENTS` owns. If it is not listed, stop and ask.
2. Create `src/modules/$ARGUMENTS/` following the layout in CLAUDE.md: module, controller, admin.controller, service, repo, schema, events, dto/, domain/.
3. Define its Drizzle tables in `pgSchema('$ARGUMENTS')` only. Run `bun run db:generate` and show me the SQL before migrating.
4. User routes under `/v1/$ARGUMENTS`; admin routes under `/admin/$ARGUMENTS` with AdminGuard, role checks and audit logging.
5. Every DTO has Swagger decorators. Confirm the endpoints appear in `/docs-json`.
6. Export only the service from the module. Emit events for things other modules may care about.
7. Add unit tests for `domain/` and one e2e test per controller.
8. Run `bun run typecheck && bun run lint && bun run test`. Fix until green.
9. Summarise: tables, endpoints (user and admin), events, and the reminder to run `bun run api:gen` in companion-web and companion-admin.
