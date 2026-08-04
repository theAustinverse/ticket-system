-- TicketTransfer's three foreign keys were ON DELETE RESTRICT, which made any
-- order (or either party) that had ever been involved in a transfer — even a
-- rejected or cancelled one — impossible to delete from the back office.
-- AdminService released the order's stock back to the pool *before* issuing
-- the delete, so the failed delete double-counted the seat: it went back to
-- the pool while the order stayed live, and went back again on every retry.
-- Cascade instead, matching OrderHistory.

-- DropForeignKey
ALTER TABLE "TicketTransfer" DROP CONSTRAINT "TicketTransfer_orderId_fkey";

-- DropForeignKey
ALTER TABLE "TicketTransfer" DROP CONSTRAINT "TicketTransfer_fromUserId_fkey";

-- DropForeignKey
ALTER TABLE "TicketTransfer" DROP CONSTRAINT "TicketTransfer_toUserId_fkey";

-- AddForeignKey
ALTER TABLE "TicketTransfer" ADD CONSTRAINT "TicketTransfer_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketTransfer" ADD CONSTRAINT "TicketTransfer_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketTransfer" ADD CONSTRAINT "TicketTransfer_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
