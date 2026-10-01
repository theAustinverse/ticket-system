-- CreateEnum
CREATE TYPE "SponsorshipStatus" AS ENUM ('PENDING', 'RECEIVED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Sponsorship" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "donorName" TEXT NOT NULL,
    "donorEmail" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "referenceCode" TEXT NOT NULL,
    "status" "SponsorshipStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "Sponsorship_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Sponsorship_referenceCode_key" ON "Sponsorship"("referenceCode");

-- CreateIndex
CREATE INDEX "Sponsorship_userId_idx" ON "Sponsorship"("userId");

-- CreateIndex
CREATE INDEX "Sponsorship_status_createdAt_idx" ON "Sponsorship"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Sponsorship" ADD CONSTRAINT "Sponsorship_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
