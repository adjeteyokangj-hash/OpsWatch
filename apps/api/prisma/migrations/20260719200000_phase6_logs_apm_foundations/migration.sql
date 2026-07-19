-- Phase 6: Logs and APM foundations (additive searchable logs, spans, APM windows).

CREATE TABLE IF NOT EXISTS "LogOccurrenceGroup" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT,
  "environment" TEXT NOT NULL DEFAULT 'unknown',
  "entityId" TEXT,
  "fingerprint" TEXT NOT NULL,
  "severity" TEXT,
  "normalizedMessage" TEXT,
  "exceptionClass" TEXT,
  "operation" TEXT,
  "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
  "firstSeenAt" TIMESTAMP(3) NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "sampleLogId" TEXT,
  "sampleEvidenceJson" JSONB,
  "groupingWindowMs" INTEGER NOT NULL DEFAULT 900000,
  "suppressedUntil" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "relatedAlertId" TEXT,
  "retentionExpiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LogOccurrenceGroup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LogOccurrenceGroup_organizationId_projectId_environment_fingerprint_key"
  ON "LogOccurrenceGroup"("organizationId", "projectId", "environment", "fingerprint");
CREATE INDEX IF NOT EXISTS "LogOccurrenceGroup_organizationId_status_lastSeenAt_idx"
  ON "LogOccurrenceGroup"("organizationId", "status", "lastSeenAt");
CREATE INDEX IF NOT EXISTS "LogOccurrenceGroup_organizationId_projectId_lastSeenAt_idx"
  ON "LogOccurrenceGroup"("organizationId", "projectId", "lastSeenAt");
CREATE INDEX IF NOT EXISTS "LogOccurrenceGroup_entityId_lastSeenAt_idx"
  ON "LogOccurrenceGroup"("entityId", "lastSeenAt");
CREATE INDEX IF NOT EXISTS "LogOccurrenceGroup_relatedAlertId_idx"
  ON "LogOccurrenceGroup"("relatedAlertId");
CREATE INDEX IF NOT EXISTS "LogOccurrenceGroup_retentionExpiresAt_idx"
  ON "LogOccurrenceGroup"("retentionExpiresAt");

CREATE TABLE IF NOT EXISTS "LogRecord" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT,
  "environment" TEXT NOT NULL DEFAULT 'unknown',
  "connectionId" TEXT,
  "entityId" TEXT,
  "serviceName" TEXT,
  "serviceNamespace" TEXT,
  "serviceInstance" TEXT,
  "provider" TEXT NOT NULL DEFAULT 'OTEL',
  "source" TEXT NOT NULL DEFAULT 'OTEL_COLLECTOR',
  "timestamp" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "severity" TEXT,
  "severityNumber" INTEGER,
  "body" TEXT,
  "attributesJson" JSONB,
  "resourceAttributesJson" JSONB,
  "traceId" TEXT,
  "spanId" TEXT,
  "correlationId" TEXT,
  "fingerprint" TEXT NOT NULL,
  "occurrenceGroupId" TEXT,
  "redactionStatus" TEXT NOT NULL DEFAULT 'REDACTED',
  "redactionMetaJson" JSONB,
  "retentionExpiresAt" TIMESTAMP(3) NOT NULL,
  "evidenceSignalId" TEXT,
  "evidenceBatchId" TEXT,
  "sourceRef" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LogRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "LogRecord_organizationId_projectId_timestamp_idx"
  ON "LogRecord"("organizationId", "projectId", "timestamp");
CREATE INDEX IF NOT EXISTS "LogRecord_organizationId_environment_timestamp_idx"
  ON "LogRecord"("organizationId", "environment", "timestamp");
CREATE INDEX IF NOT EXISTS "LogRecord_organizationId_fingerprint_timestamp_idx"
  ON "LogRecord"("organizationId", "fingerprint", "timestamp");
CREATE INDEX IF NOT EXISTS "LogRecord_organizationId_severity_timestamp_idx"
  ON "LogRecord"("organizationId", "severity", "timestamp");
CREATE INDEX IF NOT EXISTS "LogRecord_organizationId_traceId_idx"
  ON "LogRecord"("organizationId", "traceId");
CREATE INDEX IF NOT EXISTS "LogRecord_organizationId_spanId_idx"
  ON "LogRecord"("organizationId", "spanId");
CREATE INDEX IF NOT EXISTS "LogRecord_organizationId_correlationId_idx"
  ON "LogRecord"("organizationId", "correlationId");
CREATE INDEX IF NOT EXISTS "LogRecord_occurrenceGroupId_timestamp_idx"
  ON "LogRecord"("occurrenceGroupId", "timestamp");
CREATE INDEX IF NOT EXISTS "LogRecord_entityId_timestamp_idx"
  ON "LogRecord"("entityId", "timestamp");
CREATE INDEX IF NOT EXISTS "LogRecord_retentionExpiresAt_idx"
  ON "LogRecord"("retentionExpiresAt");
CREATE INDEX IF NOT EXISTS "LogRecord_evidenceBatchId_idx"
  ON "LogRecord"("evidenceBatchId");
CREATE INDEX IF NOT EXISTS "LogRecord_connectionId_timestamp_idx"
  ON "LogRecord"("connectionId", "timestamp");

CREATE TABLE IF NOT EXISTS "TraceRecord" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT,
  "environment" TEXT NOT NULL DEFAULT 'unknown',
  "connectionId" TEXT,
  "traceId" TEXT NOT NULL,
  "rootServiceName" TEXT,
  "rootSpanId" TEXT,
  "startAt" TIMESTAMP(3),
  "endAt" TIMESTAMP(3),
  "durationMs" INTEGER,
  "spanCount" INTEGER NOT NULL DEFAULT 0,
  "serviceCount" INTEGER NOT NULL DEFAULT 0,
  "errorCount" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'UNSET',
  "isPartial" BOOLEAN NOT NULL DEFAULT false,
  "lateArrivalCount" INTEGER NOT NULL DEFAULT 0,
  "failingSpanId" TEXT,
  "retentionExpiresAt" TIMESTAMP(3) NOT NULL,
  "lastReconstructedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "evidenceBatchId" TEXT,
  CONSTRAINT "TraceRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TraceRecord_organizationId_projectId_traceId_key"
  ON "TraceRecord"("organizationId", "projectId", "traceId");
CREATE INDEX IF NOT EXISTS "TraceRecord_organizationId_startAt_idx"
  ON "TraceRecord"("organizationId", "startAt");
CREATE INDEX IF NOT EXISTS "TraceRecord_organizationId_status_startAt_idx"
  ON "TraceRecord"("organizationId", "status", "startAt");
CREATE INDEX IF NOT EXISTS "TraceRecord_projectId_startAt_idx"
  ON "TraceRecord"("projectId", "startAt");
CREATE INDEX IF NOT EXISTS "TraceRecord_retentionExpiresAt_idx"
  ON "TraceRecord"("retentionExpiresAt");
CREATE INDEX IF NOT EXISTS "TraceRecord_connectionId_idx"
  ON "TraceRecord"("connectionId");
CREATE INDEX IF NOT EXISTS "TraceRecord_evidenceBatchId_idx"
  ON "TraceRecord"("evidenceBatchId");

CREATE TABLE IF NOT EXISTS "SpanRecord" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT,
  "environment" TEXT NOT NULL DEFAULT 'unknown',
  "connectionId" TEXT,
  "serviceEntityId" TEXT,
  "sourceEntityId" TEXT,
  "destinationEntityId" TEXT,
  "traceId" TEXT NOT NULL,
  "spanId" TEXT NOT NULL,
  "parentSpanId" TEXT,
  "traceFlags" INTEGER,
  "spanKind" TEXT,
  "operationName" TEXT NOT NULL,
  "startTimestamp" TIMESTAMP(3) NOT NULL,
  "endTimestamp" TIMESTAMP(3),
  "durationMs" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'UNSET',
  "exceptionSummary" TEXT,
  "httpMethod" TEXT,
  "httpRoute" TEXT,
  "httpStatusCode" INTEGER,
  "dbSystem" TEXT,
  "dbOperation" TEXT,
  "messagingSystem" TEXT,
  "messagingDestination" TEXT,
  "externalPeer" TEXT,
  "attributesJson" JSONB,
  "redactionStatus" TEXT NOT NULL DEFAULT 'REDACTED',
  "retentionExpiresAt" TIMESTAMP(3) NOT NULL,
  "evidenceSignalId" TEXT,
  "evidenceBatchId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "traceRecordId" TEXT,
  CONSTRAINT "SpanRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SpanRecord_organizationId_traceId_spanId_key"
  ON "SpanRecord"("organizationId", "traceId", "spanId");
CREATE INDEX IF NOT EXISTS "SpanRecord_organizationId_projectId_startTimestamp_idx"
  ON "SpanRecord"("organizationId", "projectId", "startTimestamp");
CREATE INDEX IF NOT EXISTS "SpanRecord_organizationId_serviceEntityId_startTimestamp_idx"
  ON "SpanRecord"("organizationId", "serviceEntityId", "startTimestamp");
CREATE INDEX IF NOT EXISTS "SpanRecord_organizationId_status_startTimestamp_idx"
  ON "SpanRecord"("organizationId", "status", "startTimestamp");
CREATE INDEX IF NOT EXISTS "SpanRecord_organizationId_httpRoute_startTimestamp_idx"
  ON "SpanRecord"("organizationId", "httpRoute", "startTimestamp");
CREATE INDEX IF NOT EXISTS "SpanRecord_traceId_startTimestamp_idx"
  ON "SpanRecord"("traceId", "startTimestamp");
CREATE INDEX IF NOT EXISTS "SpanRecord_traceRecordId_idx"
  ON "SpanRecord"("traceRecordId");
CREATE INDEX IF NOT EXISTS "SpanRecord_retentionExpiresAt_idx"
  ON "SpanRecord"("retentionExpiresAt");
CREATE INDEX IF NOT EXISTS "SpanRecord_evidenceBatchId_idx"
  ON "SpanRecord"("evidenceBatchId");
CREATE INDEX IF NOT EXISTS "SpanRecord_connectionId_startTimestamp_idx"
  ON "SpanRecord"("connectionId", "startTimestamp");

CREATE TABLE IF NOT EXISTS "ApmServiceWindow" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT,
  "entityId" TEXT,
  "serviceName" TEXT NOT NULL,
  "environment" TEXT NOT NULL DEFAULT 'unknown',
  "windowSize" TEXT NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "windowEnd" TIMESTAMP(3) NOT NULL,
  "requestCount" INTEGER NOT NULL DEFAULT 0,
  "errorCount" INTEGER NOT NULL DEFAULT 0,
  "errorRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "latencySumMs" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "latencyAvgMs" DOUBLE PRECISION,
  "latencyP50Ms" DOUBLE PRECISION,
  "latencyP95Ms" DOUBLE PRECISION,
  "latencyP99Ms" DOUBLE PRECISION,
  "availability" DOUBLE PRECISION,
  "sampleCount" INTEGER NOT NULL DEFAULT 0,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "health" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "healthRule" TEXT,
  "healthEvidenceJson" JSONB,
  "lastObservedAt" TIMESTAMP(3),
  "freshUntil" TIMESTAMP(3),
  "lastEvaluatedAt" TIMESTAMP(3),
  "activeAlertCount" INTEGER NOT NULL DEFAULT 0,
  "activeIncidentCount" INTEGER NOT NULL DEFAULT 0,
  "retentionExpiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApmServiceWindow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ApmServiceWindow_org_project_service_env_size_start_key"
  ON "ApmServiceWindow"("organizationId", "projectId", "serviceName", "environment", "windowSize", "windowStart");
CREATE INDEX IF NOT EXISTS "ApmServiceWindow_organizationId_windowEnd_idx"
  ON "ApmServiceWindow"("organizationId", "windowEnd");
CREATE INDEX IF NOT EXISTS "ApmServiceWindow_organizationId_health_windowEnd_idx"
  ON "ApmServiceWindow"("organizationId", "health", "windowEnd");
CREATE INDEX IF NOT EXISTS "ApmServiceWindow_projectId_windowSize_windowEnd_idx"
  ON "ApmServiceWindow"("projectId", "windowSize", "windowEnd");
CREATE INDEX IF NOT EXISTS "ApmServiceWindow_entityId_windowEnd_idx"
  ON "ApmServiceWindow"("entityId", "windowEnd");
CREATE INDEX IF NOT EXISTS "ApmServiceWindow_freshUntil_idx"
  ON "ApmServiceWindow"("freshUntil");
CREATE INDEX IF NOT EXISTS "ApmServiceWindow_retentionExpiresAt_idx"
  ON "ApmServiceWindow"("retentionExpiresAt");

CREATE TABLE IF NOT EXISTS "ApmEndpointWindow" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT,
  "entityId" TEXT,
  "serviceName" TEXT NOT NULL,
  "environment" TEXT NOT NULL DEFAULT 'unknown',
  "operation" TEXT NOT NULL,
  "httpMethod" TEXT,
  "windowSize" TEXT NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "windowEnd" TIMESTAMP(3) NOT NULL,
  "requestCount" INTEGER NOT NULL DEFAULT 0,
  "errorCount" INTEGER NOT NULL DEFAULT 0,
  "errorRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "latencySumMs" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "latencyAvgMs" DOUBLE PRECISION,
  "latencyP50Ms" DOUBLE PRECISION,
  "latencyP95Ms" DOUBLE PRECISION,
  "latencyP99Ms" DOUBLE PRECISION,
  "slowRequestCount" INTEGER NOT NULL DEFAULT 0,
  "failingTraceCount" INTEGER NOT NULL DEFAULT 0,
  "sampleCount" INTEGER NOT NULL DEFAULT 0,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "health" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "healthRule" TEXT,
  "healthEvidenceJson" JSONB,
  "lastObservedAt" TIMESTAMP(3),
  "freshUntil" TIMESTAMP(3),
  "retentionExpiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApmEndpointWindow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ApmEndpointWindow_org_project_svc_env_op_size_start_key"
  ON "ApmEndpointWindow"("organizationId", "projectId", "serviceName", "environment", "operation", "windowSize", "windowStart");
CREATE INDEX IF NOT EXISTS "ApmEndpointWindow_organizationId_windowEnd_idx"
  ON "ApmEndpointWindow"("organizationId", "windowEnd");
CREATE INDEX IF NOT EXISTS "ApmEndpointWindow_projectId_windowSize_windowEnd_idx"
  ON "ApmEndpointWindow"("projectId", "windowSize", "windowEnd");
CREATE INDEX IF NOT EXISTS "ApmEndpointWindow_entityId_windowEnd_idx"
  ON "ApmEndpointWindow"("entityId", "windowEnd");
CREATE INDEX IF NOT EXISTS "ApmEndpointWindow_retentionExpiresAt_idx"
  ON "ApmEndpointWindow"("retentionExpiresAt");

CREATE TABLE IF NOT EXISTS "ApmDependencyWindow" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT,
  "relationshipId" TEXT,
  "sourceEntityId" TEXT,
  "targetEntityId" TEXT,
  "sourceServiceName" TEXT NOT NULL,
  "targetServiceName" TEXT NOT NULL,
  "environment" TEXT NOT NULL DEFAULT 'unknown',
  "windowSize" TEXT NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "windowEnd" TIMESTAMP(3) NOT NULL,
  "requestCount" INTEGER NOT NULL DEFAULT 0,
  "errorCount" INTEGER NOT NULL DEFAULT 0,
  "errorRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "timeoutCount" INTEGER NOT NULL DEFAULT 0,
  "timeoutRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "latencySumMs" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "latencyAvgMs" DOUBLE PRECISION,
  "latencyP95Ms" DOUBLE PRECISION,
  "sampleCount" INTEGER NOT NULL DEFAULT 0,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "health" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "healthRule" TEXT,
  "healthEvidenceJson" JSONB,
  "lastSuccessAt" TIMESTAMP(3),
  "lastFailureAt" TIMESTAMP(3),
  "lastObservedAt" TIMESTAMP(3),
  "freshUntil" TIMESTAMP(3),
  "retentionExpiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApmDependencyWindow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ApmDependencyWindow_org_project_src_tgt_env_size_start_key"
  ON "ApmDependencyWindow"("organizationId", "projectId", "sourceServiceName", "targetServiceName", "environment", "windowSize", "windowStart");
CREATE INDEX IF NOT EXISTS "ApmDependencyWindow_organizationId_windowEnd_idx"
  ON "ApmDependencyWindow"("organizationId", "windowEnd");
CREATE INDEX IF NOT EXISTS "ApmDependencyWindow_organizationId_health_windowEnd_idx"
  ON "ApmDependencyWindow"("organizationId", "health", "windowEnd");
CREATE INDEX IF NOT EXISTS "ApmDependencyWindow_relationshipId_windowEnd_idx"
  ON "ApmDependencyWindow"("relationshipId", "windowEnd");
CREATE INDEX IF NOT EXISTS "ApmDependencyWindow_sourceEntityId_windowEnd_idx"
  ON "ApmDependencyWindow"("sourceEntityId", "windowEnd");
CREATE INDEX IF NOT EXISTS "ApmDependencyWindow_targetEntityId_windowEnd_idx"
  ON "ApmDependencyWindow"("targetEntityId", "windowEnd");
CREATE INDEX IF NOT EXISTS "ApmDependencyWindow_freshUntil_idx"
  ON "ApmDependencyWindow"("freshUntil");
CREATE INDEX IF NOT EXISTS "ApmDependencyWindow_retentionExpiresAt_idx"
  ON "ApmDependencyWindow"("retentionExpiresAt");

CREATE TABLE IF NOT EXISTS "LogEvidenceLink" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT,
  "alertId" TEXT,
  "incidentId" TEXT,
  "logRecordId" TEXT,
  "occurrenceGroupId" TEXT,
  "evidenceKind" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION,
  "metadataJson" JSONB,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LogEvidenceLink_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "LogEvidenceLink_alertId_observedAt_idx"
  ON "LogEvidenceLink"("alertId", "observedAt");
CREATE INDEX IF NOT EXISTS "LogEvidenceLink_incidentId_observedAt_idx"
  ON "LogEvidenceLink"("incidentId", "observedAt");
CREATE INDEX IF NOT EXISTS "LogEvidenceLink_organizationId_logRecordId_idx"
  ON "LogEvidenceLink"("organizationId", "logRecordId");
CREATE INDEX IF NOT EXISTS "LogEvidenceLink_occurrenceGroupId_idx"
  ON "LogEvidenceLink"("occurrenceGroupId");

CREATE TABLE IF NOT EXISTS "SpanEvidenceLink" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT,
  "alertId" TEXT,
  "incidentId" TEXT,
  "spanRecordId" TEXT,
  "traceRecordId" TEXT,
  "traceId" TEXT,
  "spanId" TEXT,
  "evidenceKind" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION,
  "metadataJson" JSONB,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SpanEvidenceLink_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SpanEvidenceLink_alertId_observedAt_idx"
  ON "SpanEvidenceLink"("alertId", "observedAt");
CREATE INDEX IF NOT EXISTS "SpanEvidenceLink_incidentId_observedAt_idx"
  ON "SpanEvidenceLink"("incidentId", "observedAt");
CREATE INDEX IF NOT EXISTS "SpanEvidenceLink_organizationId_traceId_idx"
  ON "SpanEvidenceLink"("organizationId", "traceId");
CREATE INDEX IF NOT EXISTS "SpanEvidenceLink_spanRecordId_idx"
  ON "SpanEvidenceLink"("spanRecordId");
CREATE INDEX IF NOT EXISTS "SpanEvidenceLink_traceRecordId_idx"
  ON "SpanEvidenceLink"("traceRecordId");

CREATE TABLE IF NOT EXISTS "ApmEvidenceLink" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT,
  "alertId" TEXT,
  "incidentId" TEXT,
  "serviceWindowId" TEXT,
  "endpointWindowId" TEXT,
  "dependencyWindowId" TEXT,
  "evidenceKind" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION,
  "metadataJson" JSONB,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApmEvidenceLink_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ApmEvidenceLink_alertId_observedAt_idx"
  ON "ApmEvidenceLink"("alertId", "observedAt");
CREATE INDEX IF NOT EXISTS "ApmEvidenceLink_incidentId_observedAt_idx"
  ON "ApmEvidenceLink"("incidentId", "observedAt");
CREATE INDEX IF NOT EXISTS "ApmEvidenceLink_serviceWindowId_idx"
  ON "ApmEvidenceLink"("serviceWindowId");
CREATE INDEX IF NOT EXISTS "ApmEvidenceLink_endpointWindowId_idx"
  ON "ApmEvidenceLink"("endpointWindowId");
CREATE INDEX IF NOT EXISTS "ApmEvidenceLink_dependencyWindowId_idx"
  ON "ApmEvidenceLink"("dependencyWindowId");

-- Foreign keys (additive; ignore if already present via IF NOT EXISTS pattern where supported)
DO $$ BEGIN
  ALTER TABLE "LogOccurrenceGroup" ADD CONSTRAINT "LogOccurrenceGroup_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "LogOccurrenceGroup" ADD CONSTRAINT "LogOccurrenceGroup_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "LogOccurrenceGroup" ADD CONSTRAINT "LogOccurrenceGroup_entityId_fkey"
    FOREIGN KEY ("entityId") REFERENCES "OperationalEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "LogRecord" ADD CONSTRAINT "LogRecord_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "LogRecord" ADD CONSTRAINT "LogRecord_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "LogRecord" ADD CONSTRAINT "LogRecord_connectionId_fkey"
    FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "LogRecord" ADD CONSTRAINT "LogRecord_entityId_fkey"
    FOREIGN KEY ("entityId") REFERENCES "OperationalEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "LogRecord" ADD CONSTRAINT "LogRecord_occurrenceGroupId_fkey"
    FOREIGN KEY ("occurrenceGroupId") REFERENCES "LogOccurrenceGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "LogRecord" ADD CONSTRAINT "LogRecord_evidenceBatchId_fkey"
    FOREIGN KEY ("evidenceBatchId") REFERENCES "OtelIngestBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "TraceRecord" ADD CONSTRAINT "TraceRecord_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "TraceRecord" ADD CONSTRAINT "TraceRecord_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "TraceRecord" ADD CONSTRAINT "TraceRecord_connectionId_fkey"
    FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "TraceRecord" ADD CONSTRAINT "TraceRecord_evidenceBatchId_fkey"
    FOREIGN KEY ("evidenceBatchId") REFERENCES "OtelIngestBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "SpanRecord" ADD CONSTRAINT "SpanRecord_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SpanRecord" ADD CONSTRAINT "SpanRecord_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SpanRecord" ADD CONSTRAINT "SpanRecord_connectionId_fkey"
    FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SpanRecord" ADD CONSTRAINT "SpanRecord_serviceEntityId_fkey"
    FOREIGN KEY ("serviceEntityId") REFERENCES "OperationalEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SpanRecord" ADD CONSTRAINT "SpanRecord_sourceEntityId_fkey"
    FOREIGN KEY ("sourceEntityId") REFERENCES "OperationalEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SpanRecord" ADD CONSTRAINT "SpanRecord_destinationEntityId_fkey"
    FOREIGN KEY ("destinationEntityId") REFERENCES "OperationalEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SpanRecord" ADD CONSTRAINT "SpanRecord_traceRecordId_fkey"
    FOREIGN KEY ("traceRecordId") REFERENCES "TraceRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SpanRecord" ADD CONSTRAINT "SpanRecord_evidenceBatchId_fkey"
    FOREIGN KEY ("evidenceBatchId") REFERENCES "OtelIngestBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ApmServiceWindow" ADD CONSTRAINT "ApmServiceWindow_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ApmServiceWindow" ADD CONSTRAINT "ApmServiceWindow_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ApmServiceWindow" ADD CONSTRAINT "ApmServiceWindow_entityId_fkey"
    FOREIGN KEY ("entityId") REFERENCES "OperationalEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ApmEndpointWindow" ADD CONSTRAINT "ApmEndpointWindow_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ApmEndpointWindow" ADD CONSTRAINT "ApmEndpointWindow_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ApmEndpointWindow" ADD CONSTRAINT "ApmEndpointWindow_entityId_fkey"
    FOREIGN KEY ("entityId") REFERENCES "OperationalEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ApmDependencyWindow" ADD CONSTRAINT "ApmDependencyWindow_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ApmDependencyWindow" ADD CONSTRAINT "ApmDependencyWindow_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ApmDependencyWindow" ADD CONSTRAINT "ApmDependencyWindow_relationshipId_fkey"
    FOREIGN KEY ("relationshipId") REFERENCES "OperationalRelationship"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ApmDependencyWindow" ADD CONSTRAINT "ApmDependencyWindow_sourceEntityId_fkey"
    FOREIGN KEY ("sourceEntityId") REFERENCES "OperationalEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ApmDependencyWindow" ADD CONSTRAINT "ApmDependencyWindow_targetEntityId_fkey"
    FOREIGN KEY ("targetEntityId") REFERENCES "OperationalEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "LogEvidenceLink" ADD CONSTRAINT "LogEvidenceLink_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "LogEvidenceLink" ADD CONSTRAINT "LogEvidenceLink_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "LogEvidenceLink" ADD CONSTRAINT "LogEvidenceLink_alertId_fkey"
    FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "LogEvidenceLink" ADD CONSTRAINT "LogEvidenceLink_incidentId_fkey"
    FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "LogEvidenceLink" ADD CONSTRAINT "LogEvidenceLink_logRecordId_fkey"
    FOREIGN KEY ("logRecordId") REFERENCES "LogRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "LogEvidenceLink" ADD CONSTRAINT "LogEvidenceLink_occurrenceGroupId_fkey"
    FOREIGN KEY ("occurrenceGroupId") REFERENCES "LogOccurrenceGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "SpanEvidenceLink" ADD CONSTRAINT "SpanEvidenceLink_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SpanEvidenceLink" ADD CONSTRAINT "SpanEvidenceLink_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SpanEvidenceLink" ADD CONSTRAINT "SpanEvidenceLink_alertId_fkey"
    FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SpanEvidenceLink" ADD CONSTRAINT "SpanEvidenceLink_incidentId_fkey"
    FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SpanEvidenceLink" ADD CONSTRAINT "SpanEvidenceLink_spanRecordId_fkey"
    FOREIGN KEY ("spanRecordId") REFERENCES "SpanRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SpanEvidenceLink" ADD CONSTRAINT "SpanEvidenceLink_traceRecordId_fkey"
    FOREIGN KEY ("traceRecordId") REFERENCES "TraceRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ApmEvidenceLink" ADD CONSTRAINT "ApmEvidenceLink_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ApmEvidenceLink" ADD CONSTRAINT "ApmEvidenceLink_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ApmEvidenceLink" ADD CONSTRAINT "ApmEvidenceLink_alertId_fkey"
    FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ApmEvidenceLink" ADD CONSTRAINT "ApmEvidenceLink_incidentId_fkey"
    FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ApmEvidenceLink" ADD CONSTRAINT "ApmEvidenceLink_serviceWindowId_fkey"
    FOREIGN KEY ("serviceWindowId") REFERENCES "ApmServiceWindow"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ApmEvidenceLink" ADD CONSTRAINT "ApmEvidenceLink_endpointWindowId_fkey"
    FOREIGN KEY ("endpointWindowId") REFERENCES "ApmEndpointWindow"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ApmEvidenceLink" ADD CONSTRAINT "ApmEvidenceLink_dependencyWindowId_fkey"
    FOREIGN KEY ("dependencyWindowId") REFERENCES "ApmDependencyWindow"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
