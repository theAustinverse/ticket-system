-- AlterTable
ALTER TABLE "Sponsorship" ADD COLUMN "txHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Sponsorship_txHash_key" ON "Sponsorship"("txHash");
