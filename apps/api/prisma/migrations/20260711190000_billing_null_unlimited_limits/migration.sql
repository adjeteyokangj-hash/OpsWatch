-- Represent unlimited allowances as NULL instead of magic number 9999.
ALTER TABLE "ProjectBilling" ALTER COLUMN "checkLimit" DROP NOT NULL;
ALTER TABLE "ProjectBilling" ALTER COLUMN "userLimit" DROP NOT NULL;
ALTER TABLE "ProjectBilling" ALTER COLUMN "automationRunLimit" DROP NOT NULL;

UPDATE "ProjectBilling"
SET "checkLimit" = NULL
WHERE "checkLimit" IS NOT NULL AND "checkLimit" >= 9999;

UPDATE "ProjectBilling"
SET "userLimit" = NULL
WHERE "userLimit" IS NOT NULL AND "userLimit" >= 9999;

UPDATE "ProjectBilling"
SET "automationRunLimit" = NULL
WHERE "automationRunLimit" IS NOT NULL AND "automationRunLimit" >= 9999;

UPDATE "ProjectBilling"
SET
  "checkLimit" = NULL,
  "userLimit" = NULL,
  "automationRunLimit" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "plan" = 'ENTERPRISE'::"BillingPlanType"
  AND (
    "checkLimit" IS NOT NULL
    OR "userLimit" IS NOT NULL
    OR "automationRunLimit" IS NOT NULL
  );
