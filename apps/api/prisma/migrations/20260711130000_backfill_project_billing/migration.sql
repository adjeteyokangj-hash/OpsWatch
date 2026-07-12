-- Idempotent backfill: one ProjectBilling row per project that lacks billing
INSERT INTO "ProjectBilling" (
  "id",
  "projectId",
  "plan",
  "monthlyPrice",
  "currency",
  "billingStatus",
  "billingStartDate",
  "dataRetentionDays",
  "checkLimit",
  "userLimit",
  "automationRunLimit",
  "createdAt",
  "updatedAt"
)
SELECT
  'pbb-' || p."id",
  p."id",
  'FREE'::"BillingPlanType",
  0,
  'GBP',
  'ACTIVE'::"BillingStatus",
  COALESCE(p."createdAt", CURRENT_TIMESTAMP),
  30,
  50,
  5,
  100,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Project" p
WHERE NOT EXISTS (
  SELECT 1 FROM "ProjectBilling" b WHERE b."projectId" = p."id"
);
