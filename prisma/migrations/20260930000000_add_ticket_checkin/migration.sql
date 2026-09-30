-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "seatIndex" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "checkedInAt" TIMESTAMP(3),
    "checkedInBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_token_key" ON "Ticket"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_orderId_seatIndex_key" ON "Ticket"("orderId", "seatIndex");

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every order that already exists gets its seats now, one per unit
-- of quantity. Tokens are 32 hex chars (a v4 UUID's 122 random bits, from the
-- server's strong RNG), the same shape the app generates for new orders.
-- Cancelled orders are included too — harmless, since check-in refuses any
-- seat whose order isn't PAID, and it keeps "every order has exactly
-- quantity seats" true without exceptions.
INSERT INTO "Ticket" ("id", "orderId", "seatIndex", "token")
SELECT
    gen_random_uuid()::text,
    o."id",
    seat.idx,
    replace(gen_random_uuid()::text, '-', '')
FROM "Order" o
CROSS JOIN LATERAL generate_series(0, o."quantity" - 1) AS seat(idx);
