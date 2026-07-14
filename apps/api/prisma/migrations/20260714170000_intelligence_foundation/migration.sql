-- Intelligence foundation: observation, learning, patterns, confidence, predictions (gated),
-- operations timeline, deployment records, AI decision audit, retention, dependency evidence.

-- AlterTable AutomationRun — automation intelligence history fields
ALTER TABLE "AutomationRun" ADD COLUMN IF NOT EXISTS "triggerType" TEXT;
ALTER TABLE "AutomationRun" ADD COLUMN IF NOT EXISTS "durationMs" INTEGER;
ALTER TABLE "AutomationRun" ADD COLUMN IF NOT EXISTS "verificationStatus" TEXT;
ALTER TABLE "AutomationRun" ADD COLUMN IF NOT EXISTS "verifiedAt" TIMESTAMP(3);
ALTER TABLE "AutomationRun" ADD COLUMN IF NOT EXISTS "affectedServiceIds" JSONB;

CREATE INDEX IF NOT EXISTS "AutomationRun_organizationId_createdAt_idx" ON "AutomationRun"("organizationId", "createdAt");

-- AlterTable ServiceDependency — telemetry-backed evidence (not invented edges)
ALTER TABLE "ServiceDependency" ADD COLUMN IF NOT EXISTS "evidenceCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ServiceDependency" ADD COLUMN IF NOT EXISTS "evidenceStrength" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "ServiceDependency" ADD COLUMN IF NOT EXISTS "lastObservedAt" TIMESTAMP(3);
ALTER TABLE "ServiceDependency" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'MANUAL';

-- AlterTable IncidentMemoryEntry — permanent retention fields
ALTER TABLE "IncidentMemoryEntry" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "IncidentMemoryEntry" ADD COLUMN IF NOT EXISTS "timelineJson" JSONB;
ALTER TABLE "IncidentMemoryEntry" ADD COLUMN IF NOT EXISTS "affectedServiceIds" JSONB;
ALTER TABLE "IncidentMemoryEntry" ADD COLUMN IF NOT EXISTS "affectedModuleKeys" JSONB;
ALTER TABLE "IncidentMemoryEntry" ADD COLUMN IF NOT EXISTS "affectedWorkflowKeys" JSONB;
ALTER TABLE "IncidentMemoryEntry" ADD COLUMN IF NOT EXISTS "recoveryActionsJson" JSONB;
ALTER TABLE "IncidentMemoryEntry" ADD COLUMN IF NOT EXISTS "automationInvolved" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "IncidentMemoryEntry" ADD COLUMN IF NOT EXISTS "verificationSummary" TEXT;
ALTER TABLE "IncidentMemoryEntry" ADD COLUMN IF NOT EXISTS "resolutionTimeMs" INTEGER;

CREATE INDEX IF NOT EXISTS "IncidentMemoryEntry_organizationId_projectId_idx" ON "IncidentMemoryEntry"("organizationId", "projectId");

-- CreateTable OperationalObservation
CREATE TABLE IF NOT EXISTS "OperationalObservation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "eventKey" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "severity" TEXT,
    "payloadJson" JSONB,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationalObservation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OperationalObservation_organizationId_observedAt_idx" ON "OperationalObservation"("organizationId", "observedAt");
CREATE INDEX IF NOT EXISTS "OperationalObservation_organizationId_sourceType_observedAt_idx" ON "OperationalObservation"("organizationId", "sourceType", "observedAt");
CREATE INDEX IF NOT EXISTS "OperationalObservation_projectId_observedAt_idx" ON "OperationalObservation"("projectId", "observedAt");
CREATE INDEX IF NOT EXISTS "OperationalObservation_organizationId_eventKey_observedAt_idx" ON "OperationalObservation"("organizationId", "eventKey", "observedAt");

-- CreateTable LearningBaseline
CREATE TABLE IF NOT EXISTS "LearningBaseline" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL DEFAULT '',
    "scopeType" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "sampleCount" INTEGER NOT NULL DEFAULT 0,
    "metricsJson" JSONB NOT NULL,
    "lastSampleAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningBaseline_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LearningBaseline_organizationId_projectId_scopeType_scopeKey_key" ON "LearningBaseline"("organizationId", "projectId", "scopeType", "scopeKey");
CREATE INDEX IF NOT EXISTS "LearningBaseline_organizationId_scopeType_idx" ON "LearningBaseline"("organizationId", "scopeType");

-- CreateTable OperationalPattern
CREATE TABLE IF NOT EXISTS "OperationalPattern" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "patternType" TEXT NOT NULL,
    "signatureKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "evidenceJson" JSONB,
    "lastMatchedAt" TIMESTAMP(3),
    "displayEligible" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationalPattern_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OperationalPattern_organizationId_patternType_signatureKey_key" ON "OperationalPattern"("organizationId", "patternType", "signatureKey");
CREATE INDEX IF NOT EXISTS "OperationalPattern_organizationId_displayEligible_confidenceScore_idx" ON "OperationalPattern"("organizationId", "displayEligible", "confidenceScore");
CREATE INDEX IF NOT EXISTS "OperationalPattern_organizationId_patternType_idx" ON "OperationalPattern"("organizationId", "patternType");

-- CreateTable AiConfidenceRecord
CREATE TABLE IF NOT EXISTS "AiConfidenceRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "label" TEXT NOT NULL,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "historicalAccuracy" DOUBLE PRECISION,
    "matchingIncidents" INTEGER NOT NULL DEFAULT 0,
    "recoveryMatches" INTEGER NOT NULL DEFAULT 0,
    "dataCompleteness" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "factorsJson" JSONB,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiConfidenceRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AiConfidenceRecord_organizationId_subjectType_subjectId_idx" ON "AiConfidenceRecord"("organizationId", "subjectType", "subjectId");
CREATE INDEX IF NOT EXISTS "AiConfidenceRecord_organizationId_computedAt_idx" ON "AiConfidenceRecord"("organizationId", "computedAt");

-- CreateTable PredictionCandidate (emission gated OFF)
CREATE TABLE IF NOT EXISTS "PredictionCandidate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "predictionType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DISABLED',
    "evidenceJson" JSONB,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "PredictionCandidate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PredictionCandidate_organizationId_status_computedAt_idx" ON "PredictionCandidate"("organizationId", "status", "computedAt");
CREATE INDEX IF NOT EXISTS "PredictionCandidate_organizationId_predictionType_idx" ON "PredictionCandidate"("organizationId", "predictionType");

-- CreateTable PredictionAccuracyLog
CREATE TABLE IF NOT EXISTS "PredictionAccuracyLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "predictionId" TEXT,
    "predictedOutcome" TEXT NOT NULL,
    "actualOutcome" TEXT,
    "wasCorrect" BOOLEAN,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PredictionAccuracyLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PredictionAccuracyLog_organizationId_recordedAt_idx" ON "PredictionAccuracyLog"("organizationId", "recordedAt");

-- CreateTable OperationsTimelineEvent
CREATE TABLE IF NOT EXISTS "OperationsTimelineEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "eventType" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "severity" TEXT,
    "payloadJson" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationsTimelineEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OperationsTimelineEvent_organizationId_occurredAt_idx" ON "OperationsTimelineEvent"("organizationId", "occurredAt");
CREATE INDEX IF NOT EXISTS "OperationsTimelineEvent_projectId_occurredAt_idx" ON "OperationsTimelineEvent"("projectId", "occurredAt");
CREATE INDEX IF NOT EXISTS "OperationsTimelineEvent_organizationId_eventType_occurredAt_idx" ON "OperationsTimelineEvent"("organizationId", "eventType", "occurredAt");

-- CreateTable DeploymentRecord
CREATE TABLE IF NOT EXISTS "DeploymentRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "serviceId" TEXT,
    "deployedAt" TIMESTAMP(3) NOT NULL,
    "version" TEXT,
    "commitSha" TEXT,
    "branch" TEXT,
    "changedServicesJson" JSONB,
    "resultingIncidentIds" JSONB,
    "resultingAlertIds" JSONB,
    "recoveryEventIds" JSONB,
    "changeEventId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'CHANGE_EVENT',
    "summary" TEXT NOT NULL,
    "detailsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeploymentRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DeploymentRecord_organizationId_deployedAt_idx" ON "DeploymentRecord"("organizationId", "deployedAt");
CREATE INDEX IF NOT EXISTS "DeploymentRecord_projectId_deployedAt_idx" ON "DeploymentRecord"("projectId", "deployedAt");
CREATE INDEX IF NOT EXISTS "DeploymentRecord_changeEventId_idx" ON "DeploymentRecord"("changeEventId");

-- CreateTable AiDecisionAudit
CREATE TABLE IF NOT EXISTS "AiDecisionAudit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "decisionType" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT,
    "summary" TEXT NOT NULL,
    "confidenceScore" DOUBLE PRECISION,
    "evidenceJson" JSONB,
    "outcome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiDecisionAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AiDecisionAudit_organizationId_createdAt_idx" ON "AiDecisionAudit"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "AiDecisionAudit_organizationId_decisionType_createdAt_idx" ON "AiDecisionAudit"("organizationId", "decisionType", "createdAt");

-- CreateTable ApplicationLearningModel
CREATE TABLE IF NOT EXISTS "ApplicationLearningModel" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "modelKey" TEXT NOT NULL,
    "stateJson" JSONB NOT NULL,
    "sampleCount" INTEGER NOT NULL DEFAULT 0,
    "readiness" TEXT NOT NULL DEFAULT 'LEARNING',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationLearningModel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ApplicationLearningModel_projectId_modelKey_key" ON "ApplicationLearningModel"("projectId", "modelKey");
CREATE INDEX IF NOT EXISTS "ApplicationLearningModel_organizationId_readiness_idx" ON "ApplicationLearningModel"("organizationId", "readiness");

-- CreateTable RetentionPolicy
CREATE TABLE IF NOT EXISTS "RetentionPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dataClass" TEXT NOT NULL,
    "retentionDays" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetentionPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RetentionPolicy_organizationId_dataClass_key" ON "RetentionPolicy"("organizationId", "dataClass");

-- Foreign keys
DO $$ BEGIN
  ALTER TABLE "OperationalObservation" ADD CONSTRAINT "OperationalObservation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "LearningBaseline" ADD CONSTRAINT "LearningBaseline_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "OperationalPattern" ADD CONSTRAINT "OperationalPattern_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AiConfidenceRecord" ADD CONSTRAINT "AiConfidenceRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PredictionCandidate" ADD CONSTRAINT "PredictionCandidate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PredictionAccuracyLog" ADD CONSTRAINT "PredictionAccuracyLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "OperationsTimelineEvent" ADD CONSTRAINT "OperationsTimelineEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "DeploymentRecord" ADD CONSTRAINT "DeploymentRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AiDecisionAudit" ADD CONSTRAINT "AiDecisionAudit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ApplicationLearningModel" ADD CONSTRAINT "ApplicationLearningModel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "RetentionPolicy" ADD CONSTRAINT "RetentionPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
