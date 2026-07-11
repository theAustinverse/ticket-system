/*
  Warnings:

  - Added the required column `totalAmount` to the `Order` table without a default value. This is not possible if the table is not empty.
  - Added the required column `batchId` to the `TicketType` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "totalAmount" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "TicketType" ADD COLUMN     "batchId" TEXT NOT NULL,
ADD COLUMN     "fixedQuantity" INTEGER;

-- CreateTable
CREATE TABLE "SaleBatch" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "saleStartAt" TIMESTAMP(3),

    CONSTRAINT "SaleBatch_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "SaleBatch" ADD CONSTRAINT "SaleBatch_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketType" ADD CONSTRAINT "TicketType_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SaleBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
