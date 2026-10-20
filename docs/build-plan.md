# Build plan

Work one step per Claude Code session (`/output-style learning`): plan mode → build → "walk me through it + 3 questions" → run it / break it → learning log → commit → `/clear`.

Repos: `companion-contracts` (only in Phase 4 and before mainnet), `companion-backend`, `companion-web`, `companion-admin`.

Each feature is a **slice across the three app repos, in this order:**
1. **backend**: module + endpoints + Swagger + tests
2. **web**: `bun run api:gen`, then the user screens
3. **admin**: `bun run api:gen`, then the admin screens
4. Wire and test the slice end to end before starting the next one.

Mark done with `[x]`.

## Phase 0 — Foundations
- [x] **0.1 backend:** `nest new` with Bun, Drizzle, docker-compose (Postgres+PostGIS, Redis, MinIO), config (zod env), logger with request id, error filter, zod validation, Swagger at `/docs`, health, Vitest. Folder layout from CLAUDE.md.
- [x] **0.2 backend:** common pieces: DB module + column helpers (`id`, `timestamps`, `usdc` bigint, `geographyPoint`), event emitter, BullMQ, Socket.io gateway skeleton, rate limiter.
- [x] **0.3 web:** `create-next-app` with Bun, Tailwind, TanStack Query, `api:gen` script, PWA manifest + service worker (Serwist), app shell with tabs.
- [ ] **0.4 admin:** `create-next-app` with Bun, Tailwind, `api:gen` script, sidebar layout, login page shell.
- [ ] **0.5 contracts:** `forge init`, OpenZeppelin, folder layout, `deployments/` format, CI with `forge test` + `forge fmt --check`.
- [ ] **0.6 CI** in each app repo: typecheck, lint, test.

## Phase 1 — Identity
- [ ] **1.1 Admin auth:** backend admin module (email + password + TOTP, roles, audit log) → admin login, 2FA setup, admin users page. *Built first so every later slice has its admin side.*
- [ ] **1.2 User auth + wallet:** backend auth module (verify embedded-wallet provider token, link wallet, session cookie) → web sign-in (email/phone or connect wallet) → admin users list + suspend.
- [ ] **1.3 KYC:** backend kyc module (Smile ID web + webhook, 18+ check) → web verify flow → admin KYC review queue.

## Phase 2 — Profiles and discovery
- [ ] **2.1 Media:** R2 pre-signed uploads, moderation status → web upload → admin moderation queue.
- [ ] **2.2 Profiles + discovery:** profile, availability, PostGIS search → web discover + profile pages → admin profile view/edit/hide.

## Phase 3 — Conversations
- [ ] **3.1 Chat + offers:** messaging module, Socket.io events, offer validation (categories, public venue, limits) → web messages + offer cards → admin flagged messages.

## Phase 4 — Escrow
- [ ] **4.1 Contract (companion-contracts repo):** `Escrow.sol` + tests (unit, fuzz, invariant) + deploy script to Base Sepolia that writes `deployments/base-sepolia.json`; tag the release. Set up the Safe for ARBITER and OWNER roles.
- [ ] **4.2 Chain module (backend):** `bun run chain:sync <tag>`, zod-validated deployment file, `/chain/config`, EIP-712 terms signing, chain watcher with cursor + confirmations, operator tx sender.
- [ ] **4.3 Booking + funding:** booking module + state machine → web checkout (approve/permit + fund, sponsored gas) → admin bookings list + escrow status.

## Phase 5 — The meeting
- [ ] **5.1 Rendezvous:** PIN check-in at venue, session timer, end session → web rendezvous screen (Wake Lock, live location) → admin live sessions view.
- [ ] **5.2 Completion + release:** confirm → `release()`, 6 h keeper auto-release job → web completion screen → admin payouts view.
- [ ] **5.3 Safety:** SOS (SMS to trusted contacts + admin alert), report, block, dispute → web SOS/report/block → admin reports + disputes → propose `resolve()` to the Safe.
- [ ] **5.4 Cancellation + refunds:** policy in `domain/`, operator `refund()` → web cancel → admin refunds view.

## Phase 6 — After the meeting
- [ ] **6.1 Reviews:** two-sided reviews, rating aggregates → web review screen + activity → admin review moderation.
- [ ] **6.2 Notifications:** Web Push (VAPID), SMS, email, install prompt → web settings → admin notification log.

## Phase 7 — Platform and launch
- [ ] **7.1 Admin platform:** settings (fee, categories, limits), dashboard numbers, audit log viewer.
- [ ] **7.2 Hardening:** load test discovery and chat, security pass, backups, monitoring/alerts.
- [ ] **7.3 Deploy:** staging on Base Sepolia → external review of `companion-contracts` → mainnet deploy + tag → backend `chain:sync` → production.
