-- AlterTable: per-application billing interval + payment method summary
ALTER TABLE "ProjectBilling" ADD COLUMN "billingInterval" "BillingInterval" NOT NULL DEFAULT 'MONTHLY';
ALTER TABLE "ProjectBilling" ADD COLUMN "paymentBrand" TEXT;
ALTER TABLE "ProjectBilling" ADD COLUMN "paymentLast4" TEXT;
ALTER TABLE "ProjectBilling" ADD COLUMN "paymentExpMonth" INTEGER;
ALTER TABLE "ProjectBilling" ADD COLUMN "paymentExpYear" INTEGER;
ALTER TABLE "ProjectBilling" ADD COLUMN "paymentUpdatedAt" TIMESTAMP(3);
