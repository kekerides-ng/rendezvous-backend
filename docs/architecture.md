# Architecture — Companion platform

**Master copy lives in `companion-backend/docs/architecture.md`.** Web and admin keep a copy; update the master first, then sync.

Last major change: moved to four separate repos (contracts split out), modular monolith backend, PWA instead of native app, and Base + USDC smart-contract escrow (replaces Paystack/Monnify).

## 1. The product
A Nigeria-first companionship app. Verified adults book each other's time for dinner dates, event plus-ones, city tours, activities and coffee. Payment is locked in an on-chain USDC escrow until the meeting is confirmed.

**Guardrails enforced in code**
- No sexual services. Terms, copy, categories and moderation all say so.
- 18+ only, proven by a provider-verified document date of birth.
- Fixed categories: `DINNER_DATE`, `EVENT_PLUS_ONE`, `CITY_TOUR`, `ACTIVITY_PARTNER`, `COFFEE_CONVERSATION`.
- First booking between two users must be at a public venue.
- No paid unlock of private media. All media is moderated.
- SOS, trip share and report on every live session.

## 2. The four repos

| Repo | What it is | Stack | Deploys to |
|---|---|---|---|
| `companion-contracts` | The escrow smart contract, its tests and deploy scripts. Publishes `deployments/<network>.json` | Solidity · Foundry · OpenZeppelin | Base Sepolia, later Base mainnet (after review) |
| `companion-backend` | All business logic, realtime, jobs, chain watcher, admin APIs | NestJS modular monolith · Bun (package manager) · Node 22 runtime · Drizzle · Postgres + PostGIS · Redis · BullMQ · Socket.io · viem | Railway or Fly.io (long-running server) |
| `companion-web` | User PWA | Next.js (App Router) · Bun · Tailwind · TanStack Query · generated API client · embedded wallet SDK + wagmi/viem · socket.io-client · Mapbox (static images now, GL JS when live location lands) · hand-written service worker | Vercel (or same host as backend) |
| `companion-admin` | Admin console | Next.js (App Router) · Bun · Tailwind · TanStack Table · generated API client | Vercel, on `admin.` subdomain, behind Cloudflare Access later |

**One visual identity.** Web and admin use Rendezvous's original artwork,
magenta palette, Plus Jakarta Sans and warm rounded surfaces. The console is
identified by its Admin label and desktop navigation, not a separate brand.
Brand assets/tokens are mirrored explicitly from the web reference; app code
remains independent.

**No shared code between repos.** They connect only through:
1. **The backend's OpenAPI spec** at `/docs-json`. Web and admin generate their own typed clients from it (`bun run api:gen`).

   **The browser never calls the backend directly over HTTP.** Web and admin each proxy through their own Next.js route handlers (`app/api/[...path]/route.ts`), which forward to the backend server-side.

   The admin proxy maps the backend cookie's `Path=/admin` to the browser-visible `Path=/api/admin` on both sign-in and logout. It forwards each `Set-Cookie` separately and preserves HttpOnly, Secure, SameSite and expiry attributes. After TOTP succeeds, the admin client replaces cached signed-out state with the returned profile before navigating.

   The reason is cookies, not tidiness. Web on Vercel and the backend on Railway are **cross-site**, so a session cookie set by the API origin is a third-party cookie — already blocked by Safari's ITP and being phased out by Chrome. Login would fail silently for a large share of Nigerian users, with nothing in the logs. Proxying makes the session first-party to the app's own origin.

   Two consequences: CORS stops mattering for HTTP, and the backend URL is never public. **Socket.io is the exception** — a WebSocket cannot proxy through a route handler, so it connects to the backend directly and therefore cannot rely on that cookie (see §7).
2. **`GET /chain/config`** on the backend, which returns chain id, USDC address, escrow address and ABI. The web app reads it; admin never signs transactions.
   - The backend gets these values from `companion-contracts`: each deploy writes `deployments/<network>.json` (chainId, escrow, usdc, deployBlock, abi) and is tagged (e.g. `v1.0.0-sepolia`). The backend pulls a tag with `bun run chain:sync <tag>`.
3. **Socket.io** on the backend, used by web for chat, offers, booking updates and live location.

### Continuous integration

Each app repo runs typecheck, lint and tests in GitHub Actions on pull requests,
main pushes and manual dispatch. Workflows use Node 22, Bun 1.4.0 and frozen
lockfiles. Next.js route types are generated first; backend tests receive isolated
Postgres 16 and Redis 7 services with test-only credentials. Current backend tests
do not exercise spatial queries or require migrations/MinIO. Extend the services
when integration tests need them. Contracts keep their separate Foundry workflow.
These checks do not deploy the apps or replace live acceptance testing.

## 3. Backend: modular monolith

One NestJS app, one deploy, one Postgres database. Inside, strict modules:

| Module | Owns (tables) | Notes |
|---|---|---|
| auth | users, sessions, wallets | Login via embedded-wallet provider; own session cookie |
| kyc | verifications | provider-neutral verified ID and adult result; currently paused |
| profile | profiles, availability, base_location (PostGIS) | Discovery search |
| media | assets | R2 pre-signed uploads, moderation before publish |

**Media step 2.1:** An authenticated user reserves a JPEG, PNG or WebP photo
(1 byte–8 MB, at most six active photos), receives a five-minute S3 SigV4 PUT
URL and uploads directly to private MinIO locally or R2 in deployment. The
backend checks object length, MIME type and image magic bytes before moving it
to `pending_review`. The owner and staff receive short-lived private GET URLs;
there is no public image route yet. Admins and moderators approve or reject
with a reason, atomically writing the result and audit entry. Only approved
assets may be published by the future profile/discovery module. The local
MinIO bucket is created on first reservation; browser PUT CORS is restricted
to `WEB_ORIGIN` in Compose. Production R2 needs a precreated bucket and a CORS
rule for that web origin. The live storage path still needs acceptance testing.
| messaging | conversations, messages, offers | Socket.io; keyword moderation |
| booking | bookings, check_ins | State machine |
| escrow | chain_events, chain_cursor, escrow_records | Chain watcher + operator transactions |
| safety | reports, blocks, sos_events, disputes, trusted_contacts | Live location in Redis GEO |
| reviews | reviews | Two-sided, after completion |
| notifications | push_subscriptions, delivery_log | Web Push + SMS + email |
| admin | admin_users, admin_sessions, audit_log, settings | Separate admin auth |

**Module rules**
- Each module's tables live in its own Postgres schema (`pgSchema('booking')`), so modules can be split into services later.
- A module never queries another module's tables. It calls the other module's exported service (`safetyService.isBlocked(a, b)`).
- Cross-module reactions use in-process events (`@nestjs/event-emitter`), e.g. `booking.completed` → reviews opens a review window.
- Slow, retryable or scheduled work goes to BullMQ queues on Redis (KYC checks, notifications, auto-release keeper, chain backfill).
- A multi-table change inside one module uses one DB transaction.

## 4. Identity and auth

**Users (web)**
- Sign in with email or phone through the embedded-wallet provider (Privy is the default choice; Dynamic is the fallback, confirmed in build step 1). This also creates an embedded wallet on Base.
- Users can instead connect their own wallet (Coinbase Wallet, MetaMask, Rainbow…).
- The backend verifies the provider's token, creates or loads the user, links the wallet address, and issues **its own httpOnly session cookie** (short-lived access JWT + rotating refresh).
- KYC must be verified before a user can make or accept an offer.

**Admins (admin)**
- Completely separate: `admin_users` with email + password (argon2) + TOTP 2FA. No wallet login.
- Roles: `admin`, `moderator`. Every admin action writes an `audit_log` row (who, what, before, after, when, IP).
- Admin routes live under `/admin/*` with `AdminGuard`. CORS for them allows only the admin origin.
- `/admin/users` lists application users with masked phones, server-side pagination, status filters and timestamp sorting. Both roles may list users and explicitly reveal a phone; a reveal is audited before the number is returned and is never cached.
- Only the `admin` role can suspend or reinstate a user. Both actions require a reason. Suspension revokes all sessions and prevents sign-in; reinstatement requires a fresh sign-in and never restores old sessions.
- Sign-in and suspension lock the same user row. Status changes, session revocation and the audit insert share one database transaction, with each module retaining ownership of its tables through its repository/service. Audit failure rolls the change back.

**KYC step 1.3:** the backend owns verification status in `kyc.verifications` and
evaluates adult status from a provider-verified document date of birth using the
Lagos calendar. User status and admin review endpoints are present. Reviewers
can reject with an audited reason, but cannot approve without provider evidence.
The direct NIN submission was removed at Jaco's request. `KYC_PROVIDER=off`
is the default and makes user status and the admin review list return without
touching the KYC table; sign-in, profile and discovery can proceed. Offers
still require verified adult evidence and fail closed while KYC is off.
`KYC_PROVIDER=youverify` selects the planned provider, but no new check can
be submitted until a provider-neutral capture/result flow is built. The KYC
schema, age policy, status and admin review boundary remain. Future offer
endpoints must call
`KycService.requireVerifiedAdult` server-side.

## 5. Money: Base + USDC escrow

Amounts are stored as **integer micro-USDC** (6 decimals) in `bigint`.

**Users pay in stablecoin.** USDC is the currency of record: it is what a rate is set in, what is locked in escrow, what is released and what is refunded. The UI shows an approximate ₦ figure beside it from a rate feed, so people can judge a price in the money they think in — but the ₦ figure is **display only and never charged**, and the app never implies otherwise.

Where each is primary:

| Context | Primary | Secondary |
|---|---|---|
| Browsing — discovery cards, "from" rates | ≈₦ estimate | — |
| Committing — plan totals, checkout, wallet balance, receipts | USDC | ≈₦ beside it |

A card or a bank transfer is an **on-ramp**, not a payment method for a booking: it buys USDC into the user's wallet, and the booking is funded from that wallet. Nothing in the booking flow charges a card.

### Contracts foundation

The contracts repo pins Foundry v1.8.5, Solidity 0.8.37 (Cancun EVM target),
OpenZeppelin v5.7.0 and forge-std v1.17.0. Dependency Git links pin exact commits;
local and CI checks use the same `bun run check` command. Metadata validation
runs independently of Foundry. Deployment artifacts follow
`contracts/deployments/schema.json`: `chainId`, `escrow`, `usdc`, `deployBlock`,
`version`, `abi`, with network filenames matched to chain IDs. Real deployment
files are written only after a deployment in 4.1; the scaffold publishes none.

### Escrow contract (`companion-contracts/src/Escrow.sol`)
- Holds only USDC (address set at deploy, immutable).
- Built on OpenZeppelin: `SafeERC20`, `ReentrancyGuard`, `AccessControl`, `Pausable`, `EIP712`.
- **Booking terms are signed by the backend** (EIP-712: bookingId, requester, provider, amount, feeBps, releaseAfter, deadline), so a user cannot fund with altered terms.

| Function | Who can call | Effect |
|---|---|---|
| `fund(terms, backendSig)` | requester | Pulls USDC (approve or permit) and locks it. Emits `Funded` |
| `topUp(bookingId, amount)` | requester, while `IN_SESSION` | Adds USDC to an already-funded booking, for time added mid-rendezvous. Emits `ToppedUp` |
| `release(bookingId)` | requester anytime; anyone after `releaseAfter` if not disputed | Pays provider amount − fee, fee → treasury. Emits `Released` |
| `refund(bookingId, refundBps)` | OPERATOR (backend) | Cancellation per policy; the rest goes to the provider. Emits `Refunded` |
| `dispute(bookingId)` | requester or provider, before release | Freezes funds. Emits `Disputed` |
| `resolve(bookingId, toProviderBps)` | ARBITER (Safe multisig) | Splits funds. Emits `Resolved` |
| `pause / setFee / setTreasury` | OWNER (Safe multisig) | Fee capped at 20% in code |

`topUp` exists because a rendezvous can be extended while it is running. The alternative — a second escrow for the extra hour — turns one evening into two payments to release, refund and dispute. A contract cannot gain a function after deployment, so this has to be in the first version.

Roles:
- **OPERATOR**: backend hot key with minimal power (refund, keeper release).
- **ARBITER** and **OWNER**: a Safe multisig. The admin console *proposes* resolutions; signers approve them in Safe.

### Gas
- Embedded wallets are ERC-4337 smart wallets with a paymaster (Coinbase CDP or Pimlico), so users never need ETH.
- External wallets pay their own gas, which is cents on Base.

### Chain watcher (backend `escrow` module)
- `viem` watches escrow events and also backfills from the last processed block (`chain_cursor`). This survives restarts.
- An event is acted on only after N confirmations (config, default 5 on Base). Events are idempotent on `txHash + logIndex`.
- Each event drives the booking state machine.

## 6. Booking flow

```
offer accepted ─► PENDING_FUNDING ──Funded (N conf)──► CONFIRMED ──both confirm arrival──► IN_SESSION
      │                 │                                  │                                     │
      │          30 min unfunded                     cancel ► refund(policy)                timer ends
      │                 ▼                                  ▼                                     ▼
      │              EXPIRED                           CANCELLED                    AWAITING_CONFIRMATION
      │                                                                     │ requester confirms → release()
      │                                                                     │ or 6 h pass → keeper release()
      │                                                                     ▼
      │                                                                 COMPLETED (Released)
      │
 SOS / report / dispute() at any point after funding ──► DISPUTED ──arbiter resolve()──► RESOLVED
```
**Arrival is confirmed by both people, not one.** Each side shows a rotating 4-digit code (also encoded as a QR); entering or scanning the other's code records *your* confirmation. The booking holds both flags and only moves to `IN_SESSION` once each has confirmed, which is what makes "we were both there" a fact rather than one person's claim — it is the evidence a dispute turns on. A booking that is funded but never mutually confirmed falls to the cancellation policy, not to the provider.

- Cancellation policy (refund to requester): >24 h before start 100%, 2–24 h 75%, <2 h 50%.
- Every transition goes through `transition(bookingId, from, to, actor)` with an optimistic lock (`version`).

## 7. Realtime and safety in a PWA
- Socket.io for chat, offers, typing, booking updates. Redis adapter, so it can scale to more instances.
- **The socket authenticates with a short-lived ticket, not the session cookie.** HTTP goes through the app's own Next route handlers (§2), so the session cookie is first-party to the web app and the browser will not send it to the backend origin on a WebSocket upgrade. The client calls an authenticated endpoint for a ~30-second single-use ticket and passes it in the handshake. This also sidesteps the fact that a WebSocket upgrade is not subject to CORS, so a cookie-based socket would be open to any site the user visits.
- **Live location only while the session page is open** (a PWA has no background GPS). The session screen uses the Wake Lock API and tells the user to keep it open.
- SOS sends an SMS to trusted contacts (Termii) and alerts the admin queue. It does not depend on push.
- Web Push needs the PWA installed to the home screen on iOS (16.4+). The web app prompts for install. Anything critical also goes by SMS.

## 8. Security and compliance
- Secrets only in env or a secret manager. The operator key is never in a repo or in admin.
- Rate limits on login, OTP, offers, messages (Redis).
- Validate every input with zod or class-validator. Use parameterized queries only.
- Verify provider reports server-side before accepting results. Store result codes, not ID images.
- NDPA: encrypt phone and DOB at column level; delete live location after the session; account deletion endpoint.
- Contract: Foundry unit + fuzz + invariant tests; testnet (Base Sepolia) until reviewed. Mainnet only after an external review.
- **Open legal question:** Nigeria's SEC regulates digital-asset businesses. Confirm the licensing position with a lawyer before real funds go live.

## 9. Environments
| Env | Backend | Web / Admin | Chain |
|---|---|---|---|
| Local | Docker Compose (Postgres+PostGIS, Redis, MinIO) + `bun run dev` | `bun run dev` | Anvil fork or Base Sepolia |
| Staging | Railway/Fly + Neon + Upstash | Vercel previews | Base Sepolia |
| Production | Railway/Fly (2+ instances) | Vercel | Base mainnet (after review) |
