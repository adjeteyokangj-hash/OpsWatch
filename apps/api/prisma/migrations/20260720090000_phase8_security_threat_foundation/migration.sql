-- Phase 8: Security and threat foundation (additive).

ALTER TABLE "Incident" ADD COLUMN IF NOT EXISTS "classification" TEXT;
ALTER TABLE "Incident" ADD COLUMN IF NOT EXISTS "securitySeverity" TEXT;
CREATE INDEX IF NOT EXISTS "Incident_projectId_classification_idx" ON "Incident"("projectId", "classification");

CREATE TABLE IF NOT EXISTS "SecurityEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT,
  "environment" TEXT NOT NULL DEFAULT 'unknown',
  "locationId" TEXT,
  "entityId" TEXT,
  "relationshipId" TEXT,
  "accountIdentifierHash" TEXT,
  "sourceIpTruncated" TEXT,
  "geography" TEXT,
  "deviceSessionHash" TEXT,
  "eventType" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
  "timestamp" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "connectionId" TEXT,
  "providerSource" TEXT,
  "correlationId" TEXT,
  "traceId" TEXT,
  "evidenceRef" TEXT,
  "redactionState" TEXT NOT NULL DEFAULT 'REDACTED',
  "retentionExpiresAt" TIMESTAMP(3) NOT NULL,
  "idempotencyKey" TEXT,
  "payloadJson" JSONB,
  "rawSource" TEXT,
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SecurityEvent_organizationId_idempotencyKey_key"
  ON "SecurityEvent"("organizationId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "SecurityEvent_organizationId_timestamp_idx"
  ON "SecurityEvent"("organizationId", "timestamp");
CREATE INDEX IF NOT EXISTS "SecurityEvent_organizationId_projectId_eventType_timestamp_idx"
  ON "SecurityEvent"("organizationId", "projectId", "eventType", "timestamp");
CREATE INDEX IF NOT EXISTS "SecurityEvent_organizationId_environment_timestamp_idx"
  ON "SecurityEvent"("organizationId", "environment", "timestamp");
CREATE INDEX IF NOT EXISTS "SecurityEvent_organizationId_correlationId_idx"
  ON "SecurityEvent"("organizationId", "correlationId");
CREATE INDEX IF NOT EXISTS "SecurityEvent_organizationId_accountIdentifierHash_timestamp_idx"
  ON "SecurityEvent"("organizationId", "accountIdentifierHash", "timestamp");
CREATE INDEX IF NOT EXISTS "SecurityEvent_organizationId_sourceIpTruncated_timestamp_idx"
  ON "SecurityEvent"("organizationId", "sourceIpTruncated", "timestamp");
CREATE INDEX IF NOT EXISTS "SecurityEvent_entityId_timestamp_idx"
  ON "SecurityEvent"("entityId", "timestamp");
CREATE INDEX IF NOT EXISTS "SecurityEvent_retentionExpiresAt_idx"
  ON "SecurityEvent"("retentionExpiresAt");
CREATE INDEX IF NOT EXISTS "SecurityEvent_connectionId_timestamp_idx"
  ON "SecurityEvent"("connectionId", "timestamp");

CREATE TABLE IF NOT EXISTS "SecurityDetectionRule" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT,
  "projectId" TEXT,
  "environment" TEXT,
  "ruleKey" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "version" INT NOT NULL DEFAULT 1,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
  "category" TEXT NOT NULL,
  "thresholdJson" JSONB,
  "windowMs" INT NOT NULL DEFAULT 300000,
  "minimumSamples" INT NOT NULL DEFAULT 1,
  "suppressionJson" JSONB,
  "recommendedResponse" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "lastChangedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SecurityDetectionRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SecurityDetectionRule_organizationId_projectId_environment_ruleKey_key"
  ON "SecurityDetectionRule"("organizationId", "projectId", "environment", "ruleKey");
CREATE INDEX IF NOT EXISTS "SecurityDetectionRule_organizationId_enabled_idx"
  ON "SecurityDetectionRule"("organizationId", "enabled");
CREATE INDEX IF NOT EXISTS "SecurityDetectionRule_ruleKey_version_idx"
  ON "SecurityDetectionRule"("ruleKey", "version");

CREATE TABLE IF NOT EXISTS "SecurityFinding" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT,
  "environment" TEXT NOT NULL DEFAULT 'unknown',
  "fingerprint" TEXT NOT NULL,
  "ruleId" TEXT,
  "ruleKey" TEXT NOT NULL,
  "ruleVersion" INT NOT NULL DEFAULT 1,
  "ruleName" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'OPEN',
  "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "firstSeenAt" TIMESTAMP(3) NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "occurrenceCount" INT NOT NULL DEFAULT 1,
  "affectedEntityId" TEXT,
  "affectedRelationshipId" TEXT,
  "recommendedResponse" TEXT,
  "relatedAlertId" TEXT,
  "relatedIncidentId" TEXT,
  "responseStatus" TEXT,
  "suppressedUntil" TIMESTAMP(3),
  "acceptedRiskUntil" TIMESTAMP(3),
  "falsePositiveReason" TEXT,
  "acceptedRiskReason" TEXT,
  "evidenceSummaryJson" JSONB,
  "thresholdWindowJson" JSONB,
  "matchedEvidenceJson" JSONB,
  "baselineNote" TEXT,
  "retentionExpiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SecurityFinding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SecurityFinding_organizationId_projectId_environment_fingerprint_key"
  ON "SecurityFinding"("organizationId", "projectId", "environment", "fingerprint");
CREATE INDEX IF NOT EXISTS "SecurityFinding_organizationId_state_lastSeenAt_idx"
  ON "SecurityFinding"("organizationId", "state", "lastSeenAt");
CREATE INDEX IF NOT EXISTS "SecurityFinding_organizationId_severity_lastSeenAt_idx"
  ON "SecurityFinding"("organizationId", "severity", "lastSeenAt");
CREATE INDEX IF NOT EXISTS "SecurityFinding_organizationId_projectId_lastSeenAt_idx"
  ON "SecurityFinding"("organizationId", "projectId", "lastSeenAt");
CREATE INDEX IF NOT EXISTS "SecurityFinding_relatedIncidentId_idx"
  ON "SecurityFinding"("relatedIncidentId");
CREATE INDEX IF NOT EXISTS "SecurityFinding_relatedAlertId_idx"
  ON "SecurityFinding"("relatedAlertId");
CREATE INDEX IF NOT EXISTS "SecurityFinding_ruleKey_idx"
  ON "SecurityFinding"("ruleKey");
CREATE INDEX IF NOT EXISTS "SecurityFinding_affectedEntityId_idx"
  ON "SecurityFinding"("affectedEntityId");
CREATE INDEX IF NOT EXISTS "SecurityFinding_retentionExpiresAt_idx"
  ON "SecurityFinding"("retentionExpiresAt");

CREATE TABLE IF NOT EXISTS "SecurityFindingOccurrence" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "findingId" TEXT NOT NULL,
  "securityEventId" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "evidenceJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SecurityFindingOccurrence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SecurityFindingOccurrence_findingId_occurredAt_idx"
  ON "SecurityFindingOccurrence"("findingId", "occurredAt");
CREATE INDEX IF NOT EXISTS "SecurityFindingOccurrence_organizationId_occurredAt_idx"
  ON "SecurityFindingOccurrence"("organizationId", "occurredAt");
CREATE INDEX IF NOT EXISTS "SecurityFindingOccurrence_securityEventId_idx"
  ON "SecurityFindingOccurrence"("securityEventId");

CREATE TABLE IF NOT EXISTS "SecurityEvidenceLink" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "findingId" TEXT,
  "sequenceId" TEXT,
  "securityEventId" TEXT,
  "alertId" TEXT,
  "incidentId" TEXT,
  "logRecordId" TEXT,
  "spanRecordId" TEXT,
  "checkResultId" TEXT,
  "changeEventId" TEXT,
  "linkKind" TEXT NOT NULL,
  "summary" TEXT,
  "confidence" DOUBLE PRECISION,
  "evidenceLevel" TEXT NOT NULL DEFAULT 'SUSPECTED',
  "metadataJson" JSONB,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SecurityEvidenceLink_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SecurityEvidenceLink_findingId_observedAt_idx"
  ON "SecurityEvidenceLink"("findingId", "observedAt");
CREATE INDEX IF NOT EXISTS "SecurityEvidenceLink_sequenceId_observedAt_idx"
  ON "SecurityEvidenceLink"("sequenceId", "observedAt");
CREATE INDEX IF NOT EXISTS "SecurityEvidenceLink_organizationId_incidentId_idx"
  ON "SecurityEvidenceLink"("organizationId", "incidentId");
CREATE INDEX IF NOT EXISTS "SecurityEvidenceLink_alertId_idx"
  ON "SecurityEvidenceLink"("alertId");

CREATE TABLE IF NOT EXISTS "SecurityIncidentEvidence" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "incidentId" TEXT NOT NULL,
  "findingId" TEXT,
  "sequenceId" TEXT,
  "securityEventId" TEXT,
  "evidenceKind" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION,
  "evidenceLevel" TEXT NOT NULL DEFAULT 'SUSPECTED',
  "metadataJson" JSONB,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SecurityIncidentEvidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SecurityIncidentEvidence_incidentId_observedAt_idx"
  ON "SecurityIncidentEvidence"("incidentId", "observedAt");
CREATE INDEX IF NOT EXISTS "SecurityIncidentEvidence_organizationId_findingId_idx"
  ON "SecurityIncidentEvidence"("organizationId", "findingId");
CREATE INDEX IF NOT EXISTS "SecurityIncidentEvidence_sequenceId_idx"
  ON "SecurityIncidentEvidence"("sequenceId");

CREATE TABLE IF NOT EXISTS "ThreatCorrelationSequence" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT,
  "environment" TEXT NOT NULL DEFAULT 'unknown',
  "sequenceType" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "stage" TEXT NOT NULL DEFAULT 'DETECTED',
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "orderedEvidenceJson" JSONB NOT NULL,
  "affectedAssetIdsJson" JSONB,
  "likelyEntryPoint" TEXT,
  "recommendedContainment" TEXT,
  "entityId" TEXT,
  "relatedFindingIdsJson" JSONB,
  "relatedIncidentId" TEXT,
  "evidenceLevel" TEXT NOT NULL DEFAULT 'SUSPECTED',
  "retentionExpiresAt" TIMESTAMP(3),
  "firstSeenAt" TIMESTAMP(3) NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ThreatCorrelationSequence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ThreatCorrelationSequence_organizationId_status_lastSeenAt_idx"
  ON "ThreatCorrelationSequence"("organizationId", "status", "lastSeenAt");
CREATE INDEX IF NOT EXISTS "ThreatCorrelationSequence_organizationId_projectId_sequenceType_idx"
  ON "ThreatCorrelationSequence"("organizationId", "projectId", "sequenceType");
CREATE INDEX IF NOT EXISTS "ThreatCorrelationSequence_relatedIncidentId_idx"
  ON "ThreatCorrelationSequence"("relatedIncidentId");
CREATE INDEX IF NOT EXISTS "ThreatCorrelationSequence_entityId_idx"
  ON "ThreatCorrelationSequence"("entityId");
CREATE INDEX IF NOT EXISTS "ThreatCorrelationSequence_retentionExpiresAt_idx"
  ON "ThreatCorrelationSequence"("retentionExpiresAt");

CREATE TABLE IF NOT EXISTS "SecurityAssetRisk" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT,
  "entityId" TEXT,
  "relationshipId" TEXT,
  "riskState" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "findingIdsJson" JSONB,
  "sequenceIdsJson" JSONB,
  "evidenceLevel" TEXT NOT NULL DEFAULT 'INSUFFICIENT_EVIDENCE',
  "summary" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SecurityAssetRisk_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SecurityAssetRisk_organizationId_entityId_key"
  ON "SecurityAssetRisk"("organizationId", "entityId");
CREATE UNIQUE INDEX IF NOT EXISTS "SecurityAssetRisk_organizationId_relationshipId_key"
  ON "SecurityAssetRisk"("organizationId", "relationshipId");
CREATE INDEX IF NOT EXISTS "SecurityAssetRisk_organizationId_riskState_idx"
  ON "SecurityAssetRisk"("organizationId", "riskState");
CREATE INDEX IF NOT EXISTS "SecurityAssetRisk_projectId_riskState_idx"
  ON "SecurityAssetRisk"("projectId", "riskState");

CREATE TABLE IF NOT EXISTS "SecurityResponseRun" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT,
  "findingId" TEXT,
  "incidentId" TEXT,
  "sequenceId" TEXT,
  "actionKey" TEXT NOT NULL,
  "automationMode" TEXT NOT NULL DEFAULT 'OBSERVE',
  "status" TEXT NOT NULL DEFAULT 'PROPOSED',
  "remediationLogId" TEXT,
  "remediationExecutionRunId" TEXT,
  "requestedBy" TEXT,
  "approvedBy" TEXT,
  "verificationJson" JSONB,
  "resultJson" JSONB,
  "failureReason" TEXT,
  "correlationId" TEXT,
  "startedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SecurityResponseRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SecurityResponseRun_organizationId_status_createdAt_idx"
  ON "SecurityResponseRun"("organizationId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "SecurityResponseRun_findingId_createdAt_idx"
  ON "SecurityResponseRun"("findingId", "createdAt");
CREATE INDEX IF NOT EXISTS "SecurityResponseRun_incidentId_createdAt_idx"
  ON "SecurityResponseRun"("incidentId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "SecurityResponseRun_organizationId_correlationId_key"
  ON "SecurityResponseRun"("organizationId", "correlationId");

CREATE TABLE IF NOT EXISTS "SecurityCoverageState" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT,
  "dimension" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
  "depth" TEXT NOT NULL DEFAULT 'NONE',
  "evidenceJson" JSONB,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SecurityCoverageState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SecurityCoverageState_organizationId_projectId_dimension_key"
  ON "SecurityCoverageState"("organizationId", "projectId", "dimension");
CREATE INDEX IF NOT EXISTS "SecurityCoverageState_organizationId_status_idx"
  ON "SecurityCoverageState"("organizationId", "status");

CREATE TABLE IF NOT EXISTS "SecurityBaselineSample" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT,
  "environment" TEXT NOT NULL DEFAULT 'unknown',
  "metricKey" TEXT NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "windowEnd" TIMESTAMP(3) NOT NULL,
  "sampleCount" INT NOT NULL DEFAULT 0,
  "valueSum" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "valueAvg" DOUBLE PRECISION,
  "valueP95" DOUBLE PRECISION,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "baselineNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SecurityBaselineSample_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SecurityBaselineSample_organizationId_projectId_environment_metricKey_windowStart_key"
  ON "SecurityBaselineSample"("organizationId", "projectId", "environment", "metricKey", "windowStart");
CREATE INDEX IF NOT EXISTS "SecurityBaselineSample_organizationId_metricKey_windowEnd_idx"
  ON "SecurityBaselineSample"("organizationId", "metricKey", "windowEnd");

CREATE TABLE IF NOT EXISTS "SecurityRuleAudit" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "ruleId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "action" TEXT NOT NULL,
  "beforeJson" JSONB,
  "afterJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SecurityRuleAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SecurityRuleAudit_organizationId_createdAt_idx"
  ON "SecurityRuleAudit"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "SecurityRuleAudit_ruleId_createdAt_idx"
  ON "SecurityRuleAudit"("ruleId", "createdAt");

CREATE TABLE IF NOT EXISTS "SecurityEvidenceAccessAudit" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "action" TEXT NOT NULL DEFAULT 'READ',
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SecurityEvidenceAccessAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SecurityEvidenceAccessAudit_organizationId_createdAt_idx"
  ON "SecurityEvidenceAccessAudit"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "SecurityEvidenceAccessAudit_resourceType_resourceId_idx"
  ON "SecurityEvidenceAccessAudit"("resourceType", "resourceId");
