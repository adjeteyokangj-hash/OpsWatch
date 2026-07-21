-- AlterTable: application-scoped Stripe subscription state on ProjectBilling.
-- Additive only. Existing ProjectBilling rows keep their data; new columns are
-- nullable (or defaulted) so no backfill is required and no organisation-level
-- subscription is copied onto projects automatically.
ALTER TABLE "ProjectBilling" ADD COLUMN "planCode" TEXT;
ALTER TABLE "ProjectBilling" ADD COLUMN "stripeCustomerId" TEXT;
ALTER TABLE "ProjectBilling" ADD COLUMN "stripeSubscriptionId" TEXT;
ALTER TABLE "ProjectBilling" ADD COLUMN "stripePriceId" TEXT;
ALTER TABLE "ProjectBilling" ADD COLUMN "stripeProductId" TEXT;
ALTER TABLE "ProjectBilling" ADD COLUMN "currentPeriodStart" TIMESTAMP(3);
ALTER TABLE "ProjectBilling" ADD COLUMN "currentPeriodEnd" TIMESTAMP(3);
ALTER TABLE "ProjectBilling" ADD COLUMN "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ProjectBilling" ADD COLUMN "trialEndsAt" TIMESTAMP(3);
ALTER TABLE "ProjectBilling" ADD COLUMN "lastPaymentAt" TIMESTAMP(3);
ALTER TABLE "ProjectBilling" ADD COLUMN "latestInvoiceId" TEXT;

-- Unique index so a Stripe subscription maps to exactly one application.
-- (Postgres allows multiple NULLs, so unmigrated rows are unaffected.)
CREATE UNIQUE INDEX "ProjectBilling_stripeSubscriptionId_key" ON "ProjectBilling"("stripeSubscriptionId");
CREATE INDEX "ProjectBilling_stripeCustomerId_idx" ON "ProjectBilling"("stripeCustomerId");
