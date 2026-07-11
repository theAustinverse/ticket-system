/*
  Warnings:

  - Added the required column `registrantLineId` to the `Order` table without a default value. This is not possible if the table is not empty.
  - Added the required column `registrantName` to the `Order` table without a default value. This is not possible if the table is not empty.
  - Added the required column `registrantPhone` to the `Order` table without a default value. This is not possible if the table is not empty.
  - Added the required column `registrantTeam` to the `Order` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "groupLeaderLineId" TEXT,
ADD COLUMN     "groupLeaderName" TEXT,
ADD COLUMN     "groupLeaderPhone" TEXT,
ADD COLUMN     "groupMembers" JSONB,
ADD COLUMN     "registrantLineId" TEXT NOT NULL,
ADD COLUMN     "registrantName" TEXT NOT NULL,
ADD COLUMN     "registrantPhone" TEXT NOT NULL,
ADD COLUMN     "registrantTeam" TEXT NOT NULL;
