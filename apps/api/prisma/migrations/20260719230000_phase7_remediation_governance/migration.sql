-- Phase 7 remediation governance: approvals, execution runs, circuit breakers

CREATE TABLE "RemediationApproval" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "environment" TEXT,
    "alertId" TEXT,
    "incidentId" TEXT,
    "entityId" TEXT,
    "relationshipId" TEXT,
    "actionKey" TEXT NOT NULL,
    "requestedBy" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    "evidenceJson" JSONB,
    "riskLevel" TEXT NOT NULL,
    "expectedImpact" TEXT,
    "verificationMethod" TEXT,
    "rollbackMethod" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decision" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionReason" TEXT,
    "correlationId" TEXT NOT NULL,
    "executionRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RemediationApproval_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RemediationApproval_organizationId_correlationId_key" ON "RemediationApproval"("organizationId", "correlationId");
CREATE INDEX "RemediationApproval_organizationId_decision_expiresAt_idx" ON "RemediationApproval"("organizationId", "decision", "expiresAt");
CREATE INDEX "RemediationApproval_projectId_actionKey_createdAt_idx" ON "RemediationApproval"("projectId", "actionKey", "createdAt");
CREATE INDEX "RemediationApproval_incidentId_createdAt_idx" ON "RemediationApproval"("incidentId", "createdAt");
CREATE INDEX "RemediationApproval_alertId_createdAt_idx" ON "RemediationApproval"("alertId", "createdAt");

CREATE TABLE "RemediationExecutionRun" (
    "id" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "environment" TEXT,
    "connectionId" TEXT,
    "provider" TEXT NOT NULL,
    "actionKey" TEXT NOT NULL,
    "alertId" TEXT,
    "incidentId" TEXT,
    "entityId" TEXT,
    "relationshipId" TEXT,
    "requestedBy" TEXT,
    "approvedBy" TEXT,
    "approvalId" TEXT,
    "automationMode" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "sanitisedInputJson" JSONB,
    "previousStateJson" JSONB,
    "providerResultJson" JSONB,
    "verificationJson" JSONB,
    "resultingStateJson" JSONB,
    "rollbackResultJson" JSONB,
    "failureReason" TEXT,
    "retryCount" INT NOT NULL DEFAULT 0,
    "circuitBreakerState" TEXT,
    "idempotencyKey" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "deadLetterAt" TIMESTAMP(3),
    "lockHolder" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RemediationExecutionRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RemediationExecutionRun_organizationId_correlationId_key" ON "RemediationExecutionRun"("organizationId", "correlationId");
CREATE UNIQUE INDEX "RemediationExecutionRun_organizationId_idempotencyKey_key" ON "RemediationExecutionRun"("organizationId", "idempotencyKey");
CREATE INDEX "RemediationExecutionRun_organizationId_status_createdAt_idx" ON "RemediationExecutionRun"("organizationId", "status", "createdAt");
CREATE INDEX "RemediationExecutionRun_projectId_actionKey_createdAt_idx" ON "RemediationExecutionRun"("projectId", "actionKey", "createdAt");
CREATE INDEX "RemediationExecutionRun_incidentId_createdAt_idx" ON "RemediationExecutionRun"("incidentId", "createdAt");
CREATE INDEX "RemediationExecutionRun_alertId_createdAt_idx" ON "RemediationExecutionRun"("alertId", "createdAt");
CREATE INDEX "RemediationExecutionRun_status_startedAt_idx" ON "RemediationExecutionRun"("status", "startedAt");

CREATE TABLE "RemediationCircuitBreaker" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "actionKey" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'CLOSED',
    "failureCount" INT NOT NULL DEFAULT 0,
    "verificationFailures" INT NOT NULL DEFAULT 0,
    "rollbackFailures" INT NOT NULL DEFAULT 0,
    "providerErrors" INT NOT NULL DEFAULT 0,
    "openedAt" TIMESTAMP(3),
    "openUntil" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastFailureReason" TEXT,
    "trippedBy" TEXT,
    "resetBy" TEXT,
    "resetAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RemediationCircuitBreaker_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RemediationCircuitBreaker_organizationId_projectId_actionKey_key" ON "RemediationCircuitBreaker"("organizationId", "projectId", "actionKey");
CREATE INDEX "RemediationCircuitBreaker_organizationId_state_openUntil_idx" ON "RemediationCircuitBreaker"("organizationId", "state", "openUntil");
