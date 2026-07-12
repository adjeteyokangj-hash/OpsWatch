CREATE TABLE "AutomationPlaybook" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "riskLevel" TEXT NOT NULL DEFAULT 'LOW',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AutomationPlaybook_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AutomationPlaybook_key_key" ON "AutomationPlaybook"("key");

CREATE TABLE "AutomationPlaybookVersion" (
  "id" TEXT NOT NULL,
  "playbookId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "definitionJson" JSONB,
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedBy" TEXT,
  CONSTRAINT "AutomationPlaybookVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AutomationPlaybookVersion_playbookId_version_key" ON "AutomationPlaybookVersion"("playbookId", "version");
ALTER TABLE "AutomationPlaybookVersion" ADD CONSTRAINT "AutomationPlaybookVersion_playbookId_fkey" FOREIGN KEY ("playbookId") REFERENCES "AutomationPlaybook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AutomationPlaybookStep" (
  "id" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "stepOrder" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "targetServiceKey" TEXT,
  "approvalRequired" BOOLEAN NOT NULL DEFAULT false,
  "description" TEXT NOT NULL,
  CONSTRAINT "AutomationPlaybookStep_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AutomationPlaybookStep_versionId_stepOrder_key" ON "AutomationPlaybookStep"("versionId", "stepOrder");
ALTER TABLE "AutomationPlaybookStep" ADD CONSTRAINT "AutomationPlaybookStep_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "AutomationPlaybookVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AutomationRun" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "incidentId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "executionMode" TEXT NOT NULL DEFAULT 'OBSERVE',
  "status" TEXT NOT NULL DEFAULT 'PLANNED',
  "planJson" JSONB NOT NULL,
  "analysisMode" TEXT,
  "confidence" DOUBLE PRECISION,
  "riskLevel" TEXT,
  "reason" TEXT,
  "createdBy" TEXT,
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AutomationRun_organizationId_incidentId_createdAt_idx" ON "AutomationRun"("organizationId", "incidentId", "createdAt");
CREATE INDEX "AutomationRun_projectId_status_idx" ON "AutomationRun"("projectId", "status");
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "AutomationPlaybookVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "AutomationRunStep" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "stepOrder" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "targetServiceId" TEXT,
  "approvalRequired" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "remediationLogId" TEXT,
  "resultJson" JSONB,
  CONSTRAINT "AutomationRunStep_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AutomationRunStep_runId_stepOrder_key" ON "AutomationRunStep"("runId", "stepOrder");
ALTER TABLE "AutomationRunStep" ADD CONSTRAINT "AutomationRunStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AutomationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AutomationApproval" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "approvedBy" TEXT,
  "reason" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutomationApproval_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "AutomationApproval" ADD CONSTRAINT "AutomationApproval_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AutomationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AutomationPolicy" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "policyKey" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "executionMode" TEXT NOT NULL DEFAULT 'OBSERVE',
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutomationPolicy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AutomationPolicy_organizationId_policyKey_key" ON "AutomationPolicy"("organizationId", "policyKey");

CREATE TABLE "AutomationOutcome" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "success" BOOLEAN NOT NULL,
  "detailsJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutomationOutcome_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "AutomationOutcome" ADD CONSTRAINT "AutomationOutcome_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AutomationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
