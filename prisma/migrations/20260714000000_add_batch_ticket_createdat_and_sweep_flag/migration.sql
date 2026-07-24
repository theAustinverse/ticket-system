-- Adds createdAt to SaleBatch/TicketType (used to infer wave order) and a
-- one-shot idempotency flag on SaleBatch for the group-ticket stock sweep
-- that fires when the next wave opens.
ALTER TABLE "SaleBatch" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "SaleBatch" ADD COLUMN "stockSweepDone" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TicketType" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
