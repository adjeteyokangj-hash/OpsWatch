-- Phase 9: Learning and prediction foundations (additive).

-- Extend PredictionCandidate for review lifecycle and evidence.
ALTER TABLE "PredictionCandidate" ADD COLUMN IF NOT EXISTS "environment" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "PredictionCandidate" ADD COLUMN IF NOT EXISTS "entityId" TEXT;
ALTER TABLE "PredictionCandidate" ADD COLUMN IF NOT EXISTS "relationshipId" TEXT;
ALTER TABLE "PredictionCandidate" ADD COLUMN IF NOT EXISTS "forecastHorizonMs" INTEGER;
ALTER TABLE "PredictionCandidate" ADD COLUMN IF NOT EXISTS "probability" DOUBLE PRECISION;
ALTER TABLE "PredictionCandidate" ADD COLUMN IF NOT EXISTS "confidenceLabel" TEXT NOT NULL DEFAULT 'INSUFFICIENT';
ALTER TABLE "PredictionCandidate" ADD COLUMN IF NOT EXISTS "reviewState" TEXT NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "PredictionCandidate" ADD COLUMN IF NOT EXISTS "ruleName" TEXT;
ALTER TABLE "PredictionCandidate" ADD COLUMN IF NOT EXISTS "ruleVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PredictionCandidate" ADD COLUMN IF NOT EXISTS "algorithmVersion" TEXT;
ALTER TABLE "PredictionCandidate" ADD COLUMN IF NOT EXISTS "dataQualityState" TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "PredictionCandidate" ADD COLUMN IF NOT EXISTS "recommendedAction" TEXT;
ALTER TABLE "PredictionCandidate" ADD COLUMN IF NOT EXISTS "relatedAlertId" TEXT;
ALTER TABLE "PredictionCandidate" ADD COLUMN IF NOT EXISTS "relatedIncidentId" TEXT;
ALTER TABLE "PredictionCandidate" ADD COLUMN IF NOT EXISTS "actualOutcome" TEXT;
ALTER TABLE "PredictionCandidate" ADD COLUMN IF NOT EXISTS "falsePositive" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PredictionCandidate" ADD COLUMN IF NOT EXISTS "reviewedBy" TEXT;
ALTER TABLE "PredictionCandidate" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3);
ALTER TABLE "PredictionCandidate" ADD COLUMN IF NOT EXISTS "reviewNote" TEXT;
ALTER TABLE "PredictionCandidate" ADD COLUMN IF NOT EXISTS "explanationJson" JSONB;
ALTER TABLE "PredictionCandidate" ADD COLUMN IF NOT EXISTS "featureFlagsJson" JSONB;
ALTER TABLE "PredictionCandidate" ADD COLUMN IF NOT EXISTS "retentionExpiresAt" TIMESTAMP(3);
ALTER TABLE "PredictionCandidate" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "PredictionCandidate_organizationId_reviewState_computedAt_idx"
  ON "PredictionCandidate"("organizationId", "reviewState", "computedAt");
CREATE INDEX IF NOT EXISTS "PredictionCandidate_organizationId_entityId_idx"
  ON "PredictionCandidate"("organizationId", "entityId");
CREATE INDEX IF NOT EXISTS "PredictionCandidate_retentionExpiresAt_idx"
  ON "PredictionCandidate"("retentionExpiresAt");

-- Rich metric baselines (Phase 9). Existing LearningBaseline retained for compatibility.
CREATE TABLE IF NOT EXISTS "MetricBaseline" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT,
  "environment" TEXT NOT NULL DEFAULT 'unknown',
  "entityId" TEXT,
  "relationshipId" TEXT,
  "metricKey" TEXT NOT NULL,
  "windowMs" INTEGER NOT NULL DEFAULT 3600000,
  "seasonalBucket" TEXT,
  "sampleCount" INTEGER NOT NULL DEFAULT 0,
  "mean" DOUBLE PRECISION,
  "median" DOUBLE PRECISION,
  "p50" DOUBLE PRECISION,
  "p95" DOUBLE PRECISION,
  "variance" DOUBLE PRECISION,
  "minValue" DOUBLE PRECISION,
  "maxValue" DOUBLE PRECISION,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "confidenceLabel" TEXT NOT NULL DEFAULT 'INSUFFICIENT',
  "dataQualityState" TEXT NOT NULL DEFAULT 'INSUFFICIENT_SAMPLES',
  "firstSampleAt" TIMESTAMP(3),
  "lastSampleAt" TIMESTAMP(3),
  "lastRecalculatedAt" TIMESTAMP(3) NOT NULL,
  "algorithmVersion" TEXT NOT NULL DEFAULT 'metric-baseline-v1',
  "sourceQualityJson" JSONB,
  "retentionExpiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MetricBaseline_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MetricBaseline_org_project_env_entity_metric_window_bucket_key"
  ON "MetricBaseline"("organizationId", "projectId", "environment", "entityId", "metricKey", "windowMs", "seasonalBucket");
CREATE INDEX IF NOT EXISTS "MetricBaseline_organizationId_metricKey_lastRecalculatedAt_idx"
  ON "MetricBaseline"("organizationId", "metricKey", "lastRecalculatedAt");
CREATE INDEX IF NOT EXISTS "MetricBaseline_organizationId_dataQualityState_idx"
  ON "MetricBaseline"("organizationId", "dataQualityState");
CREATE INDEX IF NOT EXISTS "MetricBaseline_retentionExpiresAt_idx"
  ON "MetricBaseline"("retentionExpiresAt");

CREATE TABLE IF NOT EXISTS "AnomalyRecord" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT,
  "environment" TEXT NOT NULL DEFAULT 'unknown',
  "entityId" TEXT,
  "relationshipId" TEXT,
  "metricKey" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
  "expectedMin" DOUBLE PRECISION,
  "expectedMax" DOUBLE PRECISION,
  "observedValue" DOUBLE PRECISION NOT NULL,
  "deviation" DOUBLE PRECISION,
  "durationMs" INTEGER,
  "sampleCount" INTEGER NOT NULL DEFAULT 0,
  "baselineConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "baselineId" TEXT,
  "explanation" TEXT NOT NULL,
  "relatedChangeIdsJson" JSONB,
  "relatedAlertIdsJson" JSONB,
  "relatedIncidentIdsJson" JSONB,
  "dataQualityState" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "algorithmVersion" TEXT NOT NULL DEFAULT 'anomaly-v1',
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "firstDetectedAt" TIMESTAMP(3) NOT NULL,
  "lastDetectedAt" TIMESTAMP(3) NOT NULL,
  "retentionExpiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AnomalyRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AnomalyRecord_organizationId_status_lastDetectedAt_idx"
  ON "AnomalyRecord"("organizationId", "status", "lastDetectedAt");
CREATE INDEX IF NOT EXISTS "AnomalyRecord_organizationId_metricKey_lastDetectedAt_idx"
  ON "AnomalyRecord"("organizationId", "metricKey", "lastDetectedAt");
CREATE INDEX IF NOT EXISTS "AnomalyRecord_organizationId_entityId_idx"
  ON "AnomalyRecord"("organizationId", "entityId");
CREATE INDEX IF NOT EXISTS "AnomalyRecord_retentionExpiresAt_idx"
  ON "AnomalyRecord"("retentionExpiresAt");

CREATE TABLE IF NOT EXISTS "IncidentPatternMemory" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT,
  "fingerprint" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "confirmedRootCause" TEXT,
  "rootCauseConfidence" DOUBLE PRECISION,
  "affectedEntityIdsJson" JSONB,
  "propagationPathJson" JSONB,
  "alertSequenceJson" JSONB,
  "evidenceSummaryJson" JSONB,
  "deploymentContextJson" JSONB,
  "remediationActionsJson" JSONB,
  "verificationOutcome" TEXT,
  "timeToDetectMs" INTEGER,
  "timeToRecoverMs" INTEGER,
  "recurrenceCount" INTEGER NOT NULL DEFAULT 1,
  "successfulActionKeysJson" JSONB,
  "failedActionKeysJson" JSONB,
  "displayEligible" BOOLEAN NOT NULL DEFAULT false,
  "dataQualityState" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "sourceIncidentIdsJson" JSONB,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "retentionExpiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IncidentPatternMemory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "IncidentPatternMemory_organizationId_fingerprint_key"
  ON "IncidentPatternMemory"("organizationId", "fingerprint");
CREATE INDEX IF NOT EXISTS "IncidentPatternMemory_organizationId_displayEligible_lastSeenAt_idx"
  ON "IncidentPatternMemory"("organizationId", "displayEligible", "lastSeenAt");
CREATE INDEX IF NOT EXISTS "IncidentPatternMemory_retentionExpiresAt_idx"
  ON "IncidentPatternMemory"("retentionExpiresAt");

CREATE TABLE IF NOT EXISTS "RemediationPatternOutcome" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT,
  "patternFingerprint" TEXT,
  "actionKey" TEXT NOT NULL,
  "successCount" INTEGER NOT NULL DEFAULT 0,
  "failureCount" INTEGER NOT NULL DEFAULT 0,
  "partialCount" INTEGER NOT NULL DEFAULT 0,
  "rollbackCount" INTEGER NOT NULL DEFAULT 0,
  "recurrenceAfterSuccess" INTEGER NOT NULL DEFAULT 0,
  "totalRecoveryMs" BIGINT NOT NULL DEFAULT 0,
  "recommendationConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "riskLevel" TEXT NOT NULL DEFAULT 'MEDIUM',
  "lastOutcome" TEXT,
  "lastOutcomeAt" TIMESTAMP(3),
  "evidenceJson" JSONB,
  "algorithmVersion" TEXT NOT NULL DEFAULT 'remediation-outcome-v1',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RemediationPatternOutcome_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RemediationPatternOutcome_org_project_pattern_action_key"
  ON "RemediationPatternOutcome"("organizationId", "projectId", "patternFingerprint", "actionKey");
CREATE INDEX IF NOT EXISTS "RemediationPatternOutcome_organizationId_actionKey_idx"
  ON "RemediationPatternOutcome"("organizationId", "actionKey");

CREATE TABLE IF NOT EXISTS "LearningAlgorithmVersion" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT,
  "algorithmName" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "parametersJson" JSONB,
  "calculationWindowMs" INTEGER,
  "validationStatus" TEXT NOT NULL DEFAULT 'UNVALIDATED',
  "featureFlagsJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LearningAlgorithmVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LearningAlgorithmVersion_algorithmName_version_key"
  ON "LearningAlgorithmVersion"("algorithmName", "version");
CREATE INDEX IF NOT EXISTS "LearningAlgorithmVersion_organizationId_algorithmName_idx"
  ON "LearningAlgorithmVersion"("organizationId", "algorithmName");

CREATE TABLE IF NOT EXISTS "PredictionOutcomeEvaluation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "predictionId" TEXT NOT NULL,
  "classification" TEXT NOT NULL,
  "leadTimeMs" INTEGER,
  "notes" TEXT,
  "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "evaluatedBy" TEXT,
  "metricsJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PredictionOutcomeEvaluation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PredictionOutcomeEvaluation_predictionId_key"
  ON "PredictionOutcomeEvaluation"("predictionId");
CREATE INDEX IF NOT EXISTS "PredictionOutcomeEvaluation_organizationId_classification_evaluatedAt_idx"
  ON "PredictionOutcomeEvaluation"("organizationId", "classification", "evaluatedAt");
