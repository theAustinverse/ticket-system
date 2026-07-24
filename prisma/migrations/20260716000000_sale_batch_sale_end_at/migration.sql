-- Adds a wave's own sale-window close time, independent of the next wave's
-- open time. Once passed, purchases/refunds for this batch stop and
-- StockSweepService sweeps its leftover stock into the next batch.
ALTER TABLE "SaleBatch" ADD COLUMN "saleEndAt" TIMESTAMP(3);
