/*
  Warnings:

  - You are about to drop the column `mapEmbedUrl` on the `Session` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Session" DROP COLUMN "mapEmbedUrl",
ADD COLUMN     "mapUrl" TEXT;
