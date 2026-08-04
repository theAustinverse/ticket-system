# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Service and schema files here carry unusually thorough doc comments explaining *why* each concurrency guard exists — read them before changing that code. This file covers what those comments can't: cross-file invariants, conventions, and where to look.

## What this is

A high-concurrency ticket-sale system ("TS Annual Party") for an in-person event: NestJS + Prisma (PostgreSQL) + Redis backend, separate React/Vite frontend. The hard problem is a "ticket rush" — thousands of users hitting fixed stock at the same instant — so the interesting logic is in Redis-atomic stock control and a virtual waiting room, not the CRUD surface.

Backend → Railway (Docker, auto-deploy from `main`, runs `prisma migrate deploy` on every boot). Frontend → Vercel (auto-deploy from `main`). Production: `ts-annual-event.com`, `api-production-0c47.up.railway.app`.

## Commands

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

**Prisma**: generated client lives at `src/generated/prisma`, not `node_modules`. When no local DB is available to run `prisma migrate dev`, hand-write the migration SQL under `prisma/migrations/<timestamp>_<name>/migration.sql` — match the style of recent migrations exactly.

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
