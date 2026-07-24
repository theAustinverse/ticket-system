-- Child-seat need becomes a single survey dropdown per order (0 = no need,
-- 1-4 = seats needed) instead of a per-companion checkbox.
ALTER TABLE "Order" ADD COLUMN "childSeatCount" INTEGER NOT NULL DEFAULT 0;
