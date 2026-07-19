-- Phase 3: OTEL operational spine (additive normalized signals, evidence, freshness).

ALTER TABLE "IngestReplayNonce"
  ADD COLUMN IF NOT EXISTS "connectionId" TEXT;

CREATE INDEX IF NOT EXISTS "IngestReplayNonce_connectionId_route_createdAt_idx"
  ON "IngestReplayNonce"("connectionId", "route", "createdAt");

ALTER TABLE "OperationalEntity"
  ADD COLUMN IF NOT EXISTS "firstSeenAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "freshUntil" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "staleAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "inactiveAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "signalCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastSignalKind" TEXT,
  ADD COLUMN IF NOT EXISTS "discoveryState" TEXT NOT NULL DEFAULT 'ACTIVE';

CREATE INDEX IF NOT EXISTS "OperationalEntity_organizationId_discoveryState_lastSeenAt_idx"
  ON "OperationalEntity"("organizationId", "discoveryState", "lastSeenAt");

CREATE INDEX IF NOT EXISTS "OperationalEntity_organizationId_freshUntil_idx"
  ON "OperationalEntity"("organizationId", "freshUntil");

ALTER TABLE "OperationalRelationship"
  ADD COLUMN IF NOT EXISTS "discoveryState" TEXT NOT NULL DEFAULT 'CANDIDATE',
  ADD COLUMN IF NOT EXISTS "freshUntil" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "staleAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "inactiveAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "latencyP95Ms" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "errorRate" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "health" TEXT NOT NULL DEFAULT 'UNKNOWN';

CREATE INDEX IF NOT EXISTS "OperationalRelationship_organizationId_discoveryState_lastObservedAt_idx"
  ON "OperationalRelationship"("organizationId", "discoveryState", "lastObservedAt");

CREATE TABLE IF NOT EXISTS "OtelIngestBatch" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT,
  "connectionId" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "protocol" TEXT NOT NULL,
  "idempotencyHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "acceptedCount" INTEGER NOT NULL DEFAULT 0,
  "rejectedCount" INTEGER NOT NULL DEFAULT 0,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "maxRetries" INTEGER NOT NULL DEFAULT 5,
  "nextRetryAt" TIMESTAMP(3),
  "deadLetterReason" TEXT,
  "evidenceJson" JSONB,
  "payloadBytes" INTEGER NOT NULL DEFAULT 0,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processingStartedAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OtelIngestBatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OtelIngestBatch_connectionId_idempotencyHash_key"
  ON "OtelIngestBatch"("connectionId", "idempotencyHash");

CREATE INDEX IF NOT EXISTS "OtelIngestBatch_organizationId_status_receivedAt_idx"
  ON "OtelIngestBatch"("organizationId", "status", "receivedAt");

CREATE INDEX IF NOT EXISTS "OtelIngestBatch_status_nextRetryAt_idx"
  ON "OtelIngestBatch"("status", "nextRetryAt");

CREATE INDEX IF NOT EXISTS "OtelIngestBatch_projectId_receivedAt_idx"
  ON "OtelIngestBatch"("projectId", "receivedAt");

CREATE INDEX IF NOT EXISTS "OtelIngestBatch_expiresAt_idx"
  ON "OtelIngestBatch"("expiresAt");

CREATE TABLE IF NOT EXISTS "NormalizedOperationalSignal" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT,
  "connectionId" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "signalType" TEXT NOT NULL,
  "severity" TEXT,
  "healthImpact" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "sourceEntityId" TEXT,
  "targetEntityId" TEXT,
  "serviceName" TEXT,
  "resourceIdentity" TEXT,
  "environment" TEXT,
  "traceId" TEXT,
  "spanId" TEXT,
  "parentSpanId" TEXT,
  "metricName" TEXT,
  "logFingerprint" TEXT,
  "normalizedStatus" TEXT,
  "fingerprint" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
  "attributesJson" JSONB,
  "resourceAttributesJson" JSONB,
  "evidenceBatchId" TEXT,
  "freshUntil" TIMESTAMP(3),
  "staleAt" TIMESTAMP(3),
  "inactiveAt" TIMESTAMP(3),
  "processingState" TEXT NOT NULL DEFAULT 'PENDING',
  "processingAttempts" INTEGER NOT NULL DEFAULT 0,
  "processingError" TEXT,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NormalizedOperationalSignal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "NormalizedOperationalSignal_organizationId_processingState_observedAt_idx"
  ON "NormalizedOperationalSignal"("organizationId", "processingState", "observedAt");

CREATE INDEX IF NOT EXISTS "NormalizedOperationalSignal_batchId_signalType_idx"
  ON "NormalizedOperationalSignal"("batchId", "signalType");

CREATE INDEX IF NOT EXISTS "NormalizedOperationalSignal_projectId_fingerprint_lastSeenAt_idx"
  ON "NormalizedOperationalSignal"("projectId", "fingerprint", "lastSeenAt");

CREATE INDEX IF NOT EXISTS "NormalizedOperationalSignal_connectionId_observedAt_idx"
  ON "NormalizedOperationalSignal"("connectionId", "observedAt");

CREATE INDEX IF NOT EXISTS "NormalizedOperationalSignal_traceId_spanId_idx"
  ON "NormalizedOperationalSignal"("traceId", "spanId");

CREATE INDEX IF NOT EXISTS "NormalizedOperationalSignal_sourceEntityId_lastSeenAt_idx"
  ON "NormalizedOperationalSignal"("sourceEntityId", "lastSeenAt");

CREATE INDEX IF NOT EXISTS "NormalizedOperationalSignal_freshUntil_idx"
  ON "NormalizedOperationalSignal"("freshUntil");

CREATE INDEX IF NOT EXISTS "NormalizedOperationalSignal_staleAt_idx"
  ON "NormalizedOperationalSignal"("staleAt");

CREATE TABLE IF NOT EXISTS "OtelMetricWindow" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT,
  "batchId" TEXT,
  "entityId" TEXT,
  "serviceName" TEXT NOT NULL,
  "environment" TEXT,
  "metricCategory" TEXT NOT NULL,
  "metricName" TEXT NOT NULL,
  "ruleId" TEXT NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "windowEnd" TIMESTAMP(3) NOT NULL,
  "sampleCount" INTEGER NOT NULL DEFAULT 0,
  "sumValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "minValue" DOUBLE PRECISION,
  "maxValue" DOUBLE PRECISION,
  "p95Value" DOUBLE PRECISION,
  "errorCount" INTEGER NOT NULL DEFAULT 0,
  "health" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "evidenceJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OtelMetricWindow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OtelMetricWindow_organizationId_serviceName_environment_ruleId_windowStart_key"
  ON "OtelMetricWindow"("organizationId", "serviceName", "environment", "ruleId", "windowStart");

CREATE INDEX IF NOT EXISTS "OtelMetricWindow_organizationId_health_windowEnd_idx"
  ON "OtelMetricWindow"("organizationId", "health", "windowEnd");

CREATE INDEX IF NOT EXISTS "OtelMetricWindow_projectId_metricCategory_windowEnd_idx"
  ON "OtelMetricWindow"("projectId", "metricCategory", "windowEnd");

CREATE INDEX IF NOT EXISTS "OtelMetricWindow_batchId_idx"
  ON "OtelMetricWindow"("batchId");

CREATE TABLE IF NOT EXISTS "OtelAlertEvidence" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT,
  "alertId" TEXT NOT NULL,
  "batchId" TEXT,
  "signalId" TEXT,
  "entityId" TEXT,
  "relationshipId" TEXT,
  "traceId" TEXT,
  "spanId" TEXT,
  "evidenceKind" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION,
  "metadataJson" JSONB,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OtelAlertEvidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OtelAlertEvidence_alertId_observedAt_idx"
  ON "OtelAlertEvidence"("alertId", "observedAt");

CREATE INDEX IF NOT EXISTS "OtelAlertEvidence_organizationId_traceId_idx"
  ON "OtelAlertEvidence"("organizationId", "traceId");

CREATE INDEX IF NOT EXISTS "OtelAlertEvidence_signalId_idx"
  ON "OtelAlertEvidence"("signalId");

CREATE INDEX IF NOT EXISTS "OtelAlertEvidence_batchId_idx"
  ON "OtelAlertEvidence"("batchId");

CREATE TABLE IF NOT EXISTS "OtelIncidentEvidence" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT,
  "incidentId" TEXT NOT NULL,
  "batchId" TEXT,
  "signalId" TEXT,
  "entityId" TEXT,
  "relationshipId" TEXT,
  "traceId" TEXT,
  "spanId" TEXT,
  "evidenceKind" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION,
  "propagationDirection" TEXT,
  "candidateRootCause" BOOLEAN NOT NULL DEFAULT false,
  "metadataJson" JSONB,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OtelIncidentEvidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OtelIncidentEvidence_incidentId_observedAt_idx"
  ON "OtelIncidentEvidence"("incidentId", "observedAt");

CREATE INDEX IF NOT EXISTS "OtelIncidentEvidence_organizationId_traceId_idx"
  ON "OtelIncidentEvidence"("organizationId", "traceId");

CREATE INDEX IF NOT EXISTS "OtelIncidentEvidence_signalId_idx"
  ON "OtelIncidentEvidence"("signalId");

CREATE INDEX IF NOT EXISTS "OtelIncidentEvidence_batchId_idx"
  ON "OtelIncidentEvidence"("batchId");

ALTER TABLE "OtelIngestBatch"
  ADD CONSTRAINT "OtelIngestBatch_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "OtelIngestBatch_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "OtelIngestBatch_connectionId_fkey"
    FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NormalizedOperationalSignal"
  ADD CONSTRAINT "NormalizedOperationalSignal_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "NormalizedOperationalSignal_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "NormalizedOperationalSignal_connectionId_fkey"
    FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "NormalizedOperationalSignal_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "OtelIngestBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "NormalizedOperationalSignal_sourceEntityId_fkey"
    FOREIGN KEY ("sourceEntityId") REFERENCES "OperationalEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "NormalizedOperationalSignal_targetEntityId_fkey"
    FOREIGN KEY ("targetEntityId") REFERENCES "OperationalEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OtelMetricWindow"
  ADD CONSTRAINT "OtelMetricWindow_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "OtelMetricWindow_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "OtelMetricWindow_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "OtelIngestBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OtelAlertEvidence"
  ADD CONSTRAINT "OtelAlertEvidence_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "OtelAlertEvidence_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "OtelAlertEvidence_alertId_fkey"
    FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "OtelAlertEvidence_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "OtelIngestBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "OtelAlertEvidence_signalId_fkey"
    FOREIGN KEY ("signalId") REFERENCES "NormalizedOperationalSignal"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "OtelAlertEvidence_entityId_fkey"
    FOREIGN KEY ("entityId") REFERENCES "OperationalEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "OtelAlertEvidence_relationshipId_fkey"
    FOREIGN KEY ("relationshipId") REFERENCES "OperationalRelationship"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OtelIncidentEvidence"
  ADD CONSTRAINT "OtelIncidentEvidence_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "OtelIncidentEvidence_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "OtelIncidentEvidence_incidentId_fkey"
    FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "OtelIncidentEvidence_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "OtelIngestBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "OtelIncidentEvidence_signalId_fkey"
    FOREIGN KEY ("signalId") REFERENCES "NormalizedOperationalSignal"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "OtelIncidentEvidence_entityId_fkey"
    FOREIGN KEY ("entityId") REFERENCES "OperationalEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "OtelIncidentEvidence_relationshipId_fkey"
    FOREIGN KEY ("relationshipId") REFERENCES "OperationalRelationship"("id") ON DELETE SET NULL ON UPDATE CASCADE;
