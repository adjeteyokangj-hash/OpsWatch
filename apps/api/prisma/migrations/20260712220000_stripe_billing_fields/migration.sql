-- AlterTable
ALTER TABLE "Plan" ADD COLUMN "stripePriceMonthlyId" TEXT;
ALTER TABLE "Plan" ADD COLUMN "stripePriceAnnualId" TEXT;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "stripeCustomerId" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "stripeSubscriptionId" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "stripePriceId" TEXT;

-- CreateIndex
CREATE INDEX "Subscription_stripeCustomerId_idx" ON "Subscription"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "Subscription_stripeSubscriptionId_idx" ON "Subscription"("stripeSubscriptionId");
