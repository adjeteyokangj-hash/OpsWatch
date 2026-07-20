-- AI & Automation Policy Centre
CREATE TABLE IF NOT EXISTS "AiAutomationPolicyBundle" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "operatingProfile" TEXT NOT NULL DEFAULT 'MONITOR_ONLY',
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "documentJson" JSONB NOT NULL,
  "ownerUserId" TEXT,
  "approverUserId" TEXT,
  "reviewAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "activatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiAutomationPolicyBundle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AiAutomationPolicyBundle_organizationId_key" ON "AiAutomationPolicyBundle"("organizationId");

CREATE TABLE IF NOT EXISTS "AiAutomationPolicyRevision" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "bundleId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "beforeJson" JSONB,
  "afterJson" JSONB NOT NULL,
  "reason" TEXT,
  "actorUserId" TEXT,
  "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "supersedesId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiAutomationPolicyRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AiAutomationPolicyRevision_bundleId_version_key" ON "AiAutomationPolicyRevision"("bundleId", "version");
CREATE INDEX IF NOT EXISTS "AiAutomationPolicyRevision_organizationId_createdAt_idx" ON "AiAutomationPolicyRevision"("organizationId", "createdAt");

CREATE TABLE IF NOT EXISTS "AiPolicyAuditEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "bundleId" TEXT,
  "eventType" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "detailJson" JSONB,
  "actorUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiPolicyAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AiPolicyAuditEvent_organizationId_createdAt_idx" ON "AiPolicyAuditEvent"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "AiPolicyAuditEvent_organizationId_eventType_createdAt_idx" ON "AiPolicyAuditEvent"("organizationId", "eventType", "createdAt");

DO $$ BEGIN
  ALTER TABLE "AiAutomationPolicyBundle" ADD CONSTRAINT "AiAutomationPolicyBundle_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AiAutomationPolicyRevision" ADD CONSTRAINT "AiAutomationPolicyRevision_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "AiAutomationPolicyBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AiAutomationPolicyRevision" ADD CONSTRAINT "AiAutomationPolicyRevision_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AiPolicyAuditEvent" ADD CONSTRAINT "AiPolicyAuditEvent_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "AiAutomationPolicyBundle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AiPolicyAuditEvent" ADD CONSTRAINT "AiPolicyAuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;