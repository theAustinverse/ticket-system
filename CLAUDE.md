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

### Companions vs. group members

Two different "extra people" models, easy to conflate. Group bundles (`fixedQuantity`) use `Order.groupMembers`, one entry per bundle seat. Multi-quantity individual tickets (`maxQuantityPerOrder`) use `Order.companions`, with `buyingForFamily` marking whether ticket #1 is the buyer's own. They have different edit cutoffs and different admin-export columns.

### Auth

Two independent surfaces. `AuthModule` issues JWTs for real user accounts (`JwtAuthGuard`). Admin back-office login is a **single shared** username/bcrypt-hash pair from env (`ADMIN_USERNAME`/`ADMIN_PASSWORD_HASH`), not a `User` row — which is why `OrderHistory.actorUserId` is nullable and admin actions pass a label string instead. `AdminGuard` stacks on top of `JwtAuthGuard` for `/admin/*`.

### Frontend

Plain CSS, no framework — a 1920s Hong Kong casino gold/red theme driven by custom properties in `frontend/src/styles.css` (`--void`, `--gold`, `--paper`). Match the palette rather than introducing ad hoc colors. All API calls go through the typed client in `frontend/src/api/client.ts`; add endpoints there instead of calling `fetch` from a page. User-facing and `/admin/*` routes are split in `App.tsx` with separate nav bars and separate auth contexts.
