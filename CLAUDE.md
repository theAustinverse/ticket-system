# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Service and schema files here carry unusually thorough doc comments explaining *why* each concurrency guard exists — read them before changing that code. This file covers what those comments can't: cross-file invariants, conventions, and where to look.

## What this is

A high-concurrency ticket-sale system ("TS Annual Party") for an in-person event: NestJS + Prisma (PostgreSQL) + Redis backend, separate React/Vite frontend. The hard problem is a "ticket rush" — thousands of users hitting fixed stock at the same instant — so the interesting logic is in Redis-atomic stock control and a virtual waiting room, not the CRUD surface.

Backend → Railway (Docker, auto-deploy from `main`, runs `prisma migrate deploy` on every boot). Frontend → Vercel (auto-deploy from `main`). Production: `ts-annual-event.com`, `api-production-0c47.up.railway.app`.

## Commands

**Fresh clone / cloud sandbox — do this first.** The generated Prisma client
(`src/generated/prisma`) is gitignored, so a clean checkout has no client and
*every* typecheck, test, and build fails until it's generated:

```bash
npm ci && npx prisma generate     # repo root; needs no .env and no live DB
cd frontend && npm ci
```

This is deliberately **not** a `postinstall` hook: the Dockerfile runs `npm ci`
(line 4) before copying `prisma/` (line 5), so a postinstall would break the
Railway image build. The Dockerfile calls `prisma generate` explicitly instead.

Backend (repo root):
```bash
npm run start:dev                          # watch mode
npm test                                   # unit tests (src/**/*.spec.ts)
npx jest src/modules/order/order.service.spec.ts   # single file
npx tsc -p tsconfig.build.json --noEmit    # typecheck only
npm run build
```

Frontend (`frontend/`): `npm run dev`, `npm run build`, `npx tsc --noEmit`, `npm run lint` (oxlint, not eslint).

Integration/load tests need real Redis/Postgres (`docker-compose up -d`) and use their own configs:
```bash
npx jest --config jest.integration.config.js   # test/integration/**
npx jest --config test/jest-e2e.json           # test/*.e2e-spec.ts
k6 run -e BASE_URL=http://localhost:3000 -e TICKET_TYPE_ID=<id> -e TOTAL_STOCK=250 -e VUS=2500 test/load/ticket-rush.js
```

**Local infra**: `docker-compose up -d` also builds/runs the `api` container — for backend iteration, run `npm run start:dev` on the host against compose's Postgres/Redis instead of rebuilding it each time. Copy `.env.example` to `.env` first; that file documents every env var and what it gates.

**Without Postgres/Redis** (e.g. a cloud sandbox): unit tests, both typechecks, and both builds all run fine — the unit suite is fully mocked and loads no `.env`. What genuinely cannot run there: `jest.integration.config.js`, `test/jest-e2e.json` (loads `dotenv/config`), the k6 load tests, and anything via docker-compose.

**Prisma**: generated client lives at `src/generated/prisma`, not `node_modules`. When no local DB is available to run `prisma migrate dev`, hand-write the migration SQL under `prisma/migrations/<timestamp>_<name>/migration.sql` — match the style of recent migrations exactly.

## Working across machines (desktop, phone, cloud sandbox)

This project gets edited from more than one place: the desktop, and Claude
Code sessions on the web/phone that run in an ephemeral cloud container. The
desktop is frequently offline while cloud work happens. `origin` on GitHub is
the only thing both sides share — treat it as the single source of truth, not
either machine's working copy.

**A cloud/phone session must never end with work only in its container.** The
container is reclaimed after a period of inactivity and everything in it is
gone — uncommitted edits included. So: commit, push the branch, and get it
onto `main`. Work that isn't pushed does not exist.

**Pushing `main` deploys.** Railway and Vercel both build straight off `main`,
and Railway runs `prisma migrate deploy` on every boot, so a merge to `main`
is a production release. CI (`.github/workflows/ci.yml`) reports on the push
but does not gate it — a red check means "the deploy that just went out is
broken, go revert", not "the deploy was blocked".

**Desktop, on reconnecting** — before starting any new work:

```bash
git fetch origin
git status                       # anything uncommitted here comes first
```

Then, depending on what the desktop is holding:

```bash
# Nothing local — the common case. Refuse to merge rather than create a
# surprise merge commit; if this errors, the desktop has commits and you
# want the rebase line below instead.
git pull --ff-only origin main

# Local commits that never got pushed — replay them on top of the cloud work.
git pull --rebase origin main

# Uncommitted WIP — park it, sync, put it back.
git stash && git pull --ff-only origin main && git stash pop
```

**After any pull, resync what the repo generates but doesn't track.** Skipping
this is the usual cause of "it works in the cloud but not on my machine":

```bash
npm ci && npx prisma generate    # if package-lock.json or schema.prisma moved
cd frontend && npm ci            # if frontend/package-lock.json moved
npx prisma migrate deploy        # if prisma/migrations/ gained a directory
```

That last one matters most. `src/generated/prisma` is gitignored and the local
database is not in version control, so a pull that brings in a new migration
leaves the desktop's Postgres behind the schema the code now expects — with
confusing runtime errors rather than an obvious failure.

**Never force-push `main`.** Two machines that disagree about `main`'s history
is the one failure mode this whole arrangement can't recover from cleanly.
Rewriting a shared feature branch is recoverable; rewriting `main` is not.

## Architecture

### Stock control — the never-oversell invariant

Sellable stock lives in **Redis, not Postgres**; Postgres only records what already succeeded. `InventoryService` wraps Lua scripts (`src/modules/inventory/lua/`) loaded once via `SCRIPT LOAD`.

- **Never read-then-write stock across two round trips.** Every mutating stock operation must be one Lua script or one atomic command (`SET NX`, `GETSET`, `INCRBY`). Every existing helper follows this; `claimGroupPurchase` and `takeAllStock` exist *only* to close check-then-act races.
- `TicketType.sharedStockKey` / `poolTotalQuantity` / `maxGroupOrders` / `fixedQuantity` / `maxQuantityPerOrder` are only meaningful in specific combinations — `prisma/schema.prisma` documents which.
- `StockSweepService` (`src/modules/event/`) sweeps a closed `SaleBatch`'s leftovers into the next wave, guarded by an atomic claim on `stockSweepDone`.
- `AdminService.resetStock` re-derives counters from real PAID orders — a drift-repair tool, **not** a restock button. Never make it a blind reset to `totalQuantity`.

### Virtual waiting room

`QueueRoomService` (`src/modules/queue-room/`) gates traffic reaching the order API. It is pacing/UX only — oversell safety comes entirely from the Lua scripts, so admission rate can be tuned freely. Two invariants: queue tokens are bound to the issuing `userId` (`isOwnedBy`) so they can't be forwarded to skip the line, and `consumeAdmission` must run exactly once per successful order or the token stays replayable for its full TTL. `AdmissionGuard` enforces admission on order creation.

### Orders, transfers, audit trail

`OrderService` (`src/modules/order/`) owns creation, self-service edits, two-step transfers (nothing moves until the recipient accepts), and cancellation — which releases stock and sets `status: CANCELLED` rather than deleting, so cancelled orders stay visible in the owner's ticket list.

Every mutation writes an `OrderHistory` row via `recordOrderHistory()` (`src/modules/order/order-history.ts`). Two things to know:
- It's **best-effort by design** — it swallows its own errors so a history-write failure never fails an action that already committed. Call it *after* the real mutation succeeds.
- That swallowing means **a broken call site fails no test unless you assert on it**. Any new order-mutating method needs a test asserting the exact `action`/`before`/`after` shape.
- It records forward only; it does not backfill orders predating the feature.

### Entry tickets and door check-in

Every order has exactly `quantity` `Ticket` rows (seats `0..quantity-1`), each with a random token that its QR code carries as a `/t/<token>` link. `src/modules/checkin/` owns the door side. Invariants that live across files:
- **Any code path that creates an order must create its seats in the same statement** (`tickets: { create: ticketSeatsFor(quantity) }`, as `createOrder` does). The migration backfilled everything that existed before.
- **Any code path that changes an order's owner must rotate every seat's token** in the same transaction, as `acceptTransfer` does — otherwise the previous owner's screenshots still get in.
- Who a seat belongs to is computed by `seatHolder()` in `ticket-seats.ts`, never stored — see the next section for the two models it follows (and `buyingForFamily`, where the buyer holds no seat at all).
- `isSeatReleased()` mirrors `StockSweepService`'s rule for which blank group-member seats it gave back to the pool. **Change one, change the other**, or the door will admit someone into a resold seat (or refuse a valid one).
- Check-in is a conditional write on `checkedInAt IS NULL`; keep it that way.
- Door staff use their own login (`CHECKIN_USERNAME`/`CHECKIN_PASSWORD_HASH`, role `CHECKIN`, 12h token carrying the staff name). Only `CheckinGuard` admits it. Its lockout is per IP on purpose — a global one would let anyone lock every scanner out on event day.
- Check-in routes carry deliberately high `@RateLimit`s: the global limiter runs before auth, so it buckets by IP alone, and every door phone shares the venue's IP.
- Search, headcount and the per-team roster (`/checkin/roster`) load all orders and filter in memory (member names live in JSON). Fine for hundreds of orders. The roster files every seat under its order's `registrantTeam` — the same field the admin export and team stats use — since members and companions have no team of their own.

### Companions vs. group members

Two different "extra people" models, easy to conflate. Group bundles (`fixedQuantity`) use `Order.groupMembers`, one entry per bundle seat. Multi-quantity individual tickets (`maxQuantityPerOrder`) use `Order.companions`, with `buyingForFamily` marking whether ticket #1 is the buyer's own. They have different edit cutoffs and different admin-export columns.

### Back-office corrections (`AdminService`)

Three admin writes exist for fixing data after the fact; all record an `OrderHistory` row with before/after, and all are covered by `admin.service.spec.ts` / `seat-edit.spec.ts`:
- `updateSeat` → `applySeatEdit()` (`src/modules/admin/seat-edit.ts`) changes one seat's name/meal. Its seat mapping mirrors `seatHolder()` — **change one, change the other**. It never touches the QR token, the contact, or the partner/relative mark.
- `updateOrderTeam` moves the *whole order*: team lives once on `Order.registrantTeam`, group members and companions have none of their own, so there is no per-seat team.
- `cancelOrder` is cancel, not delete: conditional `PENDING/PAID → CANCELLED`, then `releaseOrderStock`, reverting the status if the release fails; refused once anyone on the order has checked in. It never refunds — money is settled outside the system. `deleteOrder` is the destructive one and erases the row.

### Public contact people

`Contact` rows (`src/modules/contact/`) are shown to **every visitor**, signed in or not — home page box, `/contact` page. Nothing in them is private, so the public and admin lists are the same query; don't add a field there that isn't meant for the whole internet. The LINE field takes a plain LINE ID or an `https://` link: the service refuses any other scheme (`javascript:`, `data:`, `http:`), and `ContactList.tsx` only turns a value into an `href` when it is https — keep both checks. Admin edits (`/admin/contacts`) don't write `OrderHistory`: a contact belongs to no order. The official LINE link above the list is not a `Contact` row: it is the `OFFICIAL_LINE_URL` constant in `frontend/src/constants.ts` (https only), so changing it is a code change and it shows even when no contact people exist.

### Changelog (更新日誌)

`frontend/src/changelog.ts` is a hand-edited list of visitor-facing features, newest first. The home page shows the entries from the last `RECENT_DAYS` (3) Taipei calendar days — a section at the bottom plus a one-time popup (`ChangelogPopup`, remembers the newest seen id in localStorage, waits for the opening narration to be dismissed). **Shipping a user-facing feature means adding an entry in the same release**; back-office-only changes don't go in. Nothing is stored server-side, so entries age out by date on their own (no entries in range → no section, no popup, no side dot).

### Help bot (客服小幫手)

`src/modules/help-bot/` + `HelpWidget.tsx` + `/admin/help`. A *private* Q&A (the public 心情便利貼 is separate): a logged-in user asks a system-operation question, `HelpBotBrain` answers from the `FAQ` in `faq.ts` (Claude when `ANTHROPIC_API_KEY` is set, else Gemini when `GEMINI_API_KEY` is set — both constrained to that FAQ — else keyword matching), and anything it isn't sure of is stored as `ESCALATED` and emailed to `HELP_ADMIN_EMAIL` (falls back to `TRANSFER_ADMIN_EMAIL`); the admin replies on `/admin/help` and the user sees it in the widget. Deliberate: the bot is given **no user or order data** and performs **no actions**, so it can only repeat FAQ facts — keep `faq.ts` in step with real behaviour (a wrong answer is worse than an escalation), and every failure path (no key, bad model output, API error) must end in escalate, never a guess. Romance questions are a fixed joke reply (`LOVE_REPLY`, keyword pre-filter `isLoveQuestion` in `faq.ts`, plus a rule in the model prompt) — answered, never escalated; keep that keyword list to unambiguous words, since "男友"/"另一半" appear in normal ticket questions. The escalation email is best-effort; the stored row is the source of truth.

### Auth

Two independent surfaces. `AuthModule` issues JWTs for real user accounts (`JwtAuthGuard`). Admin back-office login is a **single shared** username/bcrypt-hash pair from env (`ADMIN_USERNAME`/`ADMIN_PASSWORD_HASH`), not a `User` row — which is why `OrderHistory.actorUserId` is nullable and admin actions pass a label string instead. `AdminGuard` stacks on top of `JwtAuthGuard` for `/admin/*`.

Password reset (`forgotPassword`/`resetPassword` in `AuthService`) emails a 6-digit code held in Redis, mirroring registration verification. Two properties are deliberate: `forgotPassword` answers identically whether or not the address is registered (and doesn't await the email), so it can't be used to enumerate accounts — don't "helpfully" add a not-found error or surface a mail failure; and the wrong-guess counter is *not* reset when a new code is issued, so requesting codes can't buy more guesses. JWTs are stateless, so a reset does not revoke sessions already issued (up to `JWT_EXPIRES_IN`).

### One own seat per account, and who a group seat is

- An account may hold **one seat in its own name**: a group bundle (the leader is a seat) or an individual order not placed `buyingForFamily` counts as one; a family order counts as none. More seats are allowed only as `buyingForFamily` on a ticket type with `maxQuantityPerOrder`, with relatives named as themselves (not the buyer's name, no duplicates). It is enforced in `createOrder`: a cheap count before any stock moves, then the authoritative recount **inside the write**, under a per-account `pg_advisory_xact_lock` — two simultaneous orders would otherwise both count zero. Transfers (`acceptTransfer`) are deliberately **not** checked against it yet.
- A named group member must be marked `PARTNER` (夥伴) or `RELATIVE` (親友); a relative carries `relativeOfSeat` (0 = leader, i = member i), which must be the leader or a named partner. Validated by `validateGroupMemberKinds` on create and on every member-list edit — which is also how orders from before the field existed get filled in. Only the seat number is stored; the name in "<partner>的親友" is resolved in `seatHolder()` at read time, so a corrected spelling follows.
- `seatHolder()` also returns `team` (the leader's `registrantTeam`, shown on every seat) and `relation`; the share page, door scan, roster and QR list show them.

### Teams (體系)

`Order.registrantTeam` and `User.team` are free strings in the DB, but the API only accepts values in `TEAM_OPTIONS` (`src/common/team-options.ts`, must equal `frontend/src/constants.ts` — a spec enforces it). Renaming or removing a team is a **data migration too**: old orders/profiles keep the old name and show up as a separate team in the back office (the 米克 → 爾森 rename skipped this). Update both tables in the same release.

### Frontend

Plain CSS, no framework — a 1920s Hong Kong casino gold/red theme driven by custom properties in `frontend/src/styles.css` (`--void`, `--gold`, `--paper`). Match the palette rather than introducing ad hoc colors. All API calls go through the typed client in `frontend/src/api/client.ts`; add endpoints there instead of calling `fetch` from a page. User-facing and `/admin/*` routes are split in `App.tsx` with separate nav bars and separate auth contexts.

The home page (`EventListPage`) is a scroll story: a full-screen hero, then chapters whose blocks fade in via `Reveal` (IntersectionObserver, once), a progress line and side dots. Two things to keep: `Reveal` must render already-visible when motion is off (`motionIsOff()` — reduced motion or no IntersectionObserver), or those visitors would see an empty page; and the guided tour finds the event link by `.event-list a[href^="/events/"]`, so keep that structure. It is presentation only — the purchase path doesn't go through it.
