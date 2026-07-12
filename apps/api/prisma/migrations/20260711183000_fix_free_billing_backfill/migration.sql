-- Correct FREE-plan rows created by the legacy backfill with Starter-tier limits.
UPDATE "ProjectBilling"
SET
  "monthlyPrice" = 0,
  "currency" = 'GBP',
  "dataRetentionDays" = 7,
  "checkLimit" = 10,
  "userLimit" = 2,
  "automationRunLimit" = 20,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "plan" = 'FREE'::"BillingPlanType"
  AND (
    "monthlyPrice" <> 0
    OR "dataRetentionDays" <> 7
    OR "checkLimit" <> 10
    OR "userLimit" <> 2
    OR "automationRunLimit" <> 20
  );

-- Enterprise labels with non-enterprise limits should be treated as custom pricing.
UPDATE "ProjectBilling"
SET
  "plan" = 'CUSTOM'::"BillingPlanType",
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "plan" = 'ENTERPRISE'::"BillingPlanType"
  AND (
    "monthlyPrice" <> 499
    OR "dataRetentionDays" <> 365
    OR "checkLimit" IS NOT NULL
    OR "userLimit" IS NOT NULL
    OR "automationRunLimit" IS NOT NULL
  );
