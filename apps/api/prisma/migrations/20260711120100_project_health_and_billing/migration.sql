-- Project operational fields
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "healthReason" TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "healthSource" TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "lastCompletedCheckAt" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "lastSignalAt" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "monitoringEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "monitoringStartedAt" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "automationMode" TEXT NOT NULL DEFAULT 'OBSERVE';
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "projectOwner" TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "operationalContact" TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "defaultRegion" TEXT;

ALTER TABLE "Service" ADD COLUMN IF NOT EXISTS "criticality" TEXT NOT NULL DEFAULT 'MEDIUM';

CREATE TYPE "BillingPlanType" AS ENUM ('FREE', 'STARTER', 'PRO', 'ENTERPRISE', 'CUSTOM');
CREATE TYPE "BillingStatus" AS ENUM ('ACTIVE', 'TRIAL', 'PAST_DUE', 'CANCELLED', 'SUSPENDED');

CREATE TABLE IF NOT EXISTS "ProjectBilling" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "plan" "BillingPlanType" NOT NULL DEFAULT 'FREE',
  "monthlyPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'GBP',
  "billingStatus" "BillingStatus" NOT NULL DEFAULT 'ACTIVE',
  "billingStartDate" TIMESTAMP(3),
  "renewalDate" TIMESTAMP(3),
  "dataRetentionDays" INTEGER NOT NULL DEFAULT 30,
  "checkLimit" INTEGER NOT NULL DEFAULT 50,
  "userLimit" INTEGER NOT NULL DEFAULT 5,
  "automationRunLimit" INTEGER NOT NULL DEFAULT 100,
  "customLimits" JSONB,
  "internalNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectBilling_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProjectBilling_projectId_key" ON "ProjectBilling"("projectId");

DO $$ BEGIN
  ALTER TABLE "ProjectBilling" ADD CONSTRAINT "ProjectBilling_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Correct false-degraded projects with no monitoring evidence
UPDATE "Project" p
SET
  "status" = 'UNKNOWN',
  "healthReason" = 'Awaiting first completed check',
  "healthSource" = 'migration-correction',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE p."status" = 'DEGRADED'
  AND NOT EXISTS (
    SELECT 1
    FROM "Service" s
    JOIN "Check" c ON c."serviceId" = s.id
    JOIN "CheckResult" cr ON cr."checkId" = c.id
    WHERE s."projectId" = p.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM "Alert" a
    WHERE a."projectId" = p.id AND a."status" IN ('OPEN', 'ACKNOWLEDGED')
  )
  AND NOT EXISTS (
    SELECT 1 FROM "Incident" i
    WHERE i."projectId" = p.id AND i."status" IN ('OPEN', 'INVESTIGATING', 'MONITORING')
  );

UPDATE "Project"
SET
  "status" = 'UNKNOWN',
  "healthReason" = COALESCE("healthReason", 'Awaiting first completed check'),
  "healthSource" = COALESCE("healthSource", 'migration-default')
WHERE "status" = 'HEALTHY'
  AND NOT EXISTS (
    SELECT 1
    FROM "Service" s
    JOIN "Check" c ON c."serviceId" = s.id
    JOIN "CheckResult" cr ON cr."checkId" = c.id
    WHERE s."projectId" = "Project".id
  )
  AND NOT EXISTS (
    SELECT 1 FROM "Incident" i
    WHERE i."projectId" = "Project".id AND i."status" IN ('OPEN', 'INVESTIGATING', 'MONITORING')
  );

ALTER TABLE "Project" ALTER COLUMN "status" SET DEFAULT 'UNKNOWN';
