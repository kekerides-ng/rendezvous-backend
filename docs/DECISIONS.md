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
