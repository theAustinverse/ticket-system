-- Remove the payment-window concept: orders no longer expire, they're
-- either immediately PAID or later CANCELLED.
ALTER TABLE "Order" ALTER COLUMN "status" SET DEFAULT 'PAID';
ALTER TABLE "Order" DROP COLUMN "expiresAt";
