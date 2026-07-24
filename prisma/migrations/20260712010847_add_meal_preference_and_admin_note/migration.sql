-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "adminNote" TEXT,
ADD COLUMN     "mealPreference" TEXT NOT NULL DEFAULT '未填寫';
