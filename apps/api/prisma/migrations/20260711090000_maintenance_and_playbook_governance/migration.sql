-- Maintenance windows (B3)
CREATE TYPE "MaintenanceWindowStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

CREATE TABLE "MaintenanceWindow" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "status" "MaintenanceWindowStatus" NOT NULL DEFAULT 'SCHEDULED',
  "suppressAlerts" BOOLEAN NOT NULL DEFAULT true,
  "suppressIncidents" BOOLEAN NOT NULL DEFAULT false,
  "allowAutonomous" BOOLEAN NOT NULL DEFAULT false,
  "createdById" TEXT NOT NULL,
  "cancelledById" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MaintenanceWindow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MaintenanceWindowService" (
  "id" TEXT NOT NULL,
  "maintenanceWindowId" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  CONSTRAINT "MaintenanceWindowService_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MaintenanceWindowService_maintenanceWindowId_serviceId_key" ON "MaintenanceWindowService"("maintenanceWindowId", "serviceId");
CREATE INDEX "MaintenanceWindow_organizationId_startsAt_idx" ON "MaintenanceWindow"("organizationId", "startsAt");
CREATE INDEX "MaintenanceWindow_organizationId_status_idx" ON "MaintenanceWindow"("organizationId", "status");
CREATE INDEX "MaintenanceWindow_projectId_startsAt_idx" ON "MaintenanceWindow"("projectId", "startsAt");

ALTER TABLE "MaintenanceWindow" ADD CONSTRAINT "MaintenanceWindow_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MaintenanceWindow" ADD CONSTRAINT "MaintenanceWindow_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MaintenanceWindowService" ADD CONSTRAINT "MaintenanceWindowService_maintenanceWindowId_fkey" FOREIGN KEY ("maintenanceWindowId") REFERENCES "MaintenanceWindow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MaintenanceWindowService" ADD CONSTRAINT "MaintenanceWindowService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Alert" ADD COLUMN "maintenanceSuppressed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Alert" ADD COLUMN "maintenanceWindowId" TEXT;

-- Playbook governance (B4)
CREATE TYPE "AutomationPlaybookVersionStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'DEPRECATED');

ALTER TABLE "AutomationPlaybookVersion" ADD COLUMN "status" "AutomationPlaybookVersionStatus" NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "AutomationPlaybookVersion" ADD COLUMN "submittedById" TEXT;
ALTER TABLE "AutomationPlaybookVersion" ADD COLUMN "submittedAt" TIMESTAMP(3);
ALTER TABLE "AutomationPlaybookVersion" ADD COLUMN "reviewedById" TEXT;
ALTER TABLE "AutomationPlaybookVersion" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "AutomationPlaybookVersion" ADD COLUMN "reviewReason" TEXT;
ALTER TABLE "AutomationPlaybookVersion" ADD COLUMN "approvedAt" TIMESTAMP(3);
ALTER TABLE "AutomationPlaybookVersion" ADD COLUMN "deprecatedAt" TIMESTAMP(3);

UPDATE "AutomationPlaybookVersion" SET "status" = 'APPROVED', "approvedAt" = COALESCE("publishedAt", CURRENT_TIMESTAMP) WHERE "version" = 1;

CREATE INDEX "AutomationPlaybookVersion_playbookId_status_idx" ON "AutomationPlaybookVersion"("playbookId", "status");
