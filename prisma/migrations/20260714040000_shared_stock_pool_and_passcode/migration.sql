-- Lets two ticket types (a group bundle + an individual ticket) draw from
-- one shared stock pool instead of independent allotments, with an
-- independent cap on how many group bundles can be sold from that pool, and
-- a passcode gate on entering a ticket type's queue.
ALTER TABLE "TicketType" ADD COLUMN "sharedStockKey" TEXT;
ALTER TABLE "TicketType" ADD COLUMN "poolTotalQuantity" INTEGER;
ALTER TABLE "TicketType" ADD COLUMN "maxGroupOrders" INTEGER;
ALTER TABLE "TicketType" ADD COLUMN "requiresPasscode" BOOLEAN NOT NULL DEFAULT false;
