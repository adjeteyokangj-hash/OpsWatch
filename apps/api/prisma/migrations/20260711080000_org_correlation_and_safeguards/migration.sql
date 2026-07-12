ALTER TABLE "Incident" ADD COLUMN "correlationGroupId" TEXT;

CREATE TABLE "OrganizationIncidentGroup" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "correlationKey" TEXT NOT NULL,
  "rootCauseSummary" TEXT,
  "primaryIncidentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrganizationIncidentGroup_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrganizationIncidentGroup_organizationId_correlationKey_idx" ON "OrganizationIncidentGroup"("organizationId", "correlationKey");
CREATE INDEX "OrganizationIncidentGroup_organizationId_createdAt_idx" ON "OrganizationIncidentGroup"("organizationId", "createdAt");
CREATE INDEX "Incident_correlationGroupId_idx" ON "Incident"("correlationGroupId");

ALTER TABLE "OrganizationIncidentGroup" ADD CONSTRAINT "OrganizationIncidentGroup_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_correlationGroupId_fkey" FOREIGN KEY ("correlationGroupId") REFERENCES "OrganizationIncidentGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
