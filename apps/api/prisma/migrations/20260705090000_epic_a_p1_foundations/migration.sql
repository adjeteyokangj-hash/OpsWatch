-- Epic A + P1 foundations
-- Change events, service dependency graph, incident timeline, and SLO windows.

CREATE TABLE "ChangeEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "serviceId" TEXT,
    "incidentId" TEXT,
    "eventType" TEXT NOT NULL,
    "actor" TEXT,
    "summary" TEXT NOT NULL,
    "detailsJson" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ServiceDependency" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fromServiceId" TEXT NOT NULL,
    "toServiceId" TEXT NOT NULL,
    "dependencyType" TEXT NOT NULL DEFAULT 'RUNTIME',
    "criticality" TEXT NOT NULL DEFAULT 'HIGH',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceDependency_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IncidentTimelineEvent" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "severity" "AlertSeverity",
    "payloadJson" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentTimelineEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SLODefinition" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "serviceId" TEXT,
    "name" TEXT NOT NULL,
    "sliType" TEXT NOT NULL,
    "targetPct" DOUBLE PRECISION NOT NULL,
    "windowDays" INTEGER NOT NULL DEFAULT 30,
    "latencyThresholdMs" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SLODefinition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SLOWindow" (
    "id" TEXT NOT NULL,
    "sloDefinitionId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "windowMinutes" INTEGER NOT NULL,
    "availabilityPct" DOUBLE PRECISION,
    "errorRatePct" DOUBLE PRECISION,
    "p95LatencyMs" INTEGER,
    "burnRate" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'HEALTHY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SLOWindow_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChangeEvent_organizationId_occurredAt_idx" ON "ChangeEvent"("organizationId", "occurredAt");
CREATE INDEX "ChangeEvent_projectId_occurredAt_idx" ON "ChangeEvent"("projectId", "occurredAt");
CREATE INDEX "ChangeEvent_serviceId_occurredAt_idx" ON "ChangeEvent"("serviceId", "occurredAt");
CREATE INDEX "ChangeEvent_incidentId_occurredAt_idx" ON "ChangeEvent"("incidentId", "occurredAt");

CREATE UNIQUE INDEX "ServiceDependency_fromServiceId_toServiceId_dependencyType_key" ON "ServiceDependency"("fromServiceId", "toServiceId", "dependencyType");
CREATE INDEX "ServiceDependency_projectId_isActive_idx" ON "ServiceDependency"("projectId", "isActive");
CREATE INDEX "ServiceDependency_fromServiceId_idx" ON "ServiceDependency"("fromServiceId");
CREATE INDEX "ServiceDependency_toServiceId_idx" ON "ServiceDependency"("toServiceId");

CREATE INDEX "IncidentTimelineEvent_incidentId_occurredAt_idx" ON "IncidentTimelineEvent"("incidentId", "occurredAt");
CREATE INDEX "IncidentTimelineEvent_projectId_occurredAt_idx" ON "IncidentTimelineEvent"("projectId", "occurredAt");
CREATE INDEX "IncidentTimelineEvent_sourceType_sourceId_idx" ON "IncidentTimelineEvent"("sourceType", "sourceId");

CREATE INDEX "SLODefinition_projectId_enabled_idx" ON "SLODefinition"("projectId", "enabled");
CREATE INDEX "SLODefinition_serviceId_enabled_idx" ON "SLODefinition"("serviceId", "enabled");

CREATE UNIQUE INDEX "SLOWindow_sloDefinitionId_windowStart_windowEnd_key" ON "SLOWindow"("sloDefinitionId", "windowStart", "windowEnd");
CREATE INDEX "SLOWindow_projectId_windowEnd_idx" ON "SLOWindow"("projectId", "windowEnd");
CREATE INDEX "SLOWindow_status_windowEnd_idx" ON "SLOWindow"("status", "windowEnd");

ALTER TABLE "ChangeEvent" ADD CONSTRAINT "ChangeEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChangeEvent" ADD CONSTRAINT "ChangeEvent_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChangeEvent" ADD CONSTRAINT "ChangeEvent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ServiceDependency" ADD CONSTRAINT "ServiceDependency_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceDependency" ADD CONSTRAINT "ServiceDependency_fromServiceId_fkey" FOREIGN KEY ("fromServiceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceDependency" ADD CONSTRAINT "ServiceDependency_toServiceId_fkey" FOREIGN KEY ("toServiceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IncidentTimelineEvent" ADD CONSTRAINT "IncidentTimelineEvent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IncidentTimelineEvent" ADD CONSTRAINT "IncidentTimelineEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SLODefinition" ADD CONSTRAINT "SLODefinition_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SLODefinition" ADD CONSTRAINT "SLODefinition_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SLOWindow" ADD CONSTRAINT "SLOWindow_sloDefinitionId_fkey" FOREIGN KEY ("sloDefinitionId") REFERENCES "SLODefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SLOWindow" ADD CONSTRAINT "SLOWindow_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
