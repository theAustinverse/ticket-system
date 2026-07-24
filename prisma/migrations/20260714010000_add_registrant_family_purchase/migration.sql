-- Adds support for buying the multi-quantity individual (early-bird) ticket
-- entirely on behalf of a family member (ticket #1 is no longer necessarily
-- the buyer's own info), plus a required identification note per family
-- ticket for admin review.
ALTER TABLE "Order" ADD COLUMN "buyingForFamily" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD COLUMN "registrantRelationship" TEXT;
ALTER TABLE "Order" ADD COLUMN "registrantNote" TEXT;
ALTER TABLE "Order" ADD COLUMN "registrantNeedsChildSeat" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD COLUMN "registrantChildSeatCount" INTEGER;
