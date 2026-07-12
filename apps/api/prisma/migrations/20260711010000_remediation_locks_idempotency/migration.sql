-- Remediation concurrency locks and idempotency keys
ALTER TABLE "RemediationLog" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "RemediationLog_organizationId_idempotencyKey_key"
  ON "RemediationLog"("organizationId", "idempotencyKey");

CREATE INDEX "RemediationLog_incidentId_status_createdAt_idx"
  ON "RemediationLog"("incidentId", "status", "createdAt");

CREATE TABLE "RemediationLock" (
  "id" TEXT NOT NULL,
  "lockKey" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "incidentId" TEXT,
  "action" TEXT,
  "holder" TEXT NOT NULL,
  "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RemediationLock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RemediationLock_lockKey_key" ON "RemediationLock"("lockKey");
CREATE INDEX "RemediationLock_expiresAt_idx" ON "RemediationLock"("expiresAt");
CREATE INDEX "RemediationLock_organizationId_incidentId_idx" ON "RemediationLock"("organizationId", "incidentId");
