-- Nullable allowance columns: NULL means unlimited (replaces legacy 9999 sentinel).
ALTER TABLE "ProjectBilling" ALTER COLUMN "checkLimit" DROP NOT NULL;
ALTER TABLE "ProjectBilling" ALTER COLUMN "userLimit" DROP NOT NULL;
ALTER TABLE "ProjectBilling" ALTER COLUMN "automationRunLimit" DROP NOT NULL;

UPDATE "ProjectBilling"
SET
  "checkLimit" = NULL,
  "userLimit" = NULL,
  "automationRunLimit" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "plan" = 'ENTERPRISE'::"BillingPlanType"
  AND (
    "checkLimit" >= 9999
    OR "userLimit" >= 9999
    OR "automationRunLimit" >= 9999
  );

UPDATE "ProjectBilling"
SET "checkLimit" = NULL WHERE "checkLimit" >= 9999;
UPDATE "ProjectBilling"
SET "userLimit" = NULL WHERE "userLimit" >= 9999;
UPDATE "ProjectBilling"
SET "automationRunLimit" = NULL WHERE "automationRunLimit" >= 9999;
