-- Lets a single order buy more than one of a non-group ticket type (e.g.
-- an early-bird individual ticket bought on behalf of family members too).
ALTER TABLE "TicketType" ADD COLUMN "maxQuantityPerOrder" INTEGER;
ALTER TABLE "Order" ADD COLUMN "companions" JSONB;

-- Enables this for the individual early-bird ticket type specifically —
-- matched by name since it's a one-off data change for an existing row,
-- not a new schema default (every other individual ticket type stays at
-- the existing one-per-order behavior).
UPDATE "TicketType" SET "maxQuantityPerOrder" = 5 WHERE "name" = '單人早鳥票';
