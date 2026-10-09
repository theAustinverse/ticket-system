-- A ticket can have at most one open (PENDING) transfer invitation at a time.
-- The application checks this too, but two simultaneous requests both pass
-- that check, so the database has to be the one to refuse the second.

-- If a double invitation already exists, keep the oldest and cancel the rest,
-- otherwise creating the index below would fail and block the deploy.
UPDATE "TicketTransfer"
SET "status" = 'CANCELLED', "respondedAt" = NOW()
WHERE "status" = 'PENDING'
  AND "id" NOT IN (
    SELECT DISTINCT ON ("orderId") "id"
    FROM "TicketTransfer"
    WHERE "status" = 'PENDING'
    ORDER BY "orderId", "createdAt" ASC, "id" ASC
  );

-- CreateIndex (partial: Prisma's schema language can't express it, so it
-- lives only in this migration)
CREATE UNIQUE INDEX "TicketTransfer_orderId_pending_key" ON "TicketTransfer"("orderId") WHERE "status" = 'PENDING';
