-- The previous migration's per-ticket-#1 relationship/note/child-seat columns
-- turned out to be redundant: when buyingForFamily is true, ticket #1's
-- family-member data now lives in the companions JSON array (one entry per
-- ticket, quantity entries total) instead of separate scalar columns.
ALTER TABLE "Order" DROP COLUMN "registrantRelationship";
ALTER TABLE "Order" DROP COLUMN "registrantNote";
ALTER TABLE "Order" DROP COLUMN "registrantNeedsChildSeat";
ALTER TABLE "Order" DROP COLUMN "registrantChildSeatCount";
