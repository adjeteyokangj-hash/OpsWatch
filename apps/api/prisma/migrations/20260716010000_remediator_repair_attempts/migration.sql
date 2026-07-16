-- AlterTable
ALTER TABLE "Project" ADD COLUMN "remediationEmergencyDisabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateEnum
CREATE TYPE "RemediatorRepairStatus" AS ENUM (
  'REQUESTED',
  'ACCEPTED',
  'REJECTED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'TIMED_OUT',
  'VERIFICATION_FAILED'
);

-- CreateTable
CREATE TABLE "RemediatorRepairAttempt" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "incidentId" TEXT,
  "alertId" TEXT,
  "providerType" "IntegrationType" NOT NULL,
  "remediatorAction" TEXT NOT NULL,
  "target" TEXT,
  "reason" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "nonce" TEXT NOT NULL,
  "requestTimestamp" TIMESTAMP(3) NOT NULL,
  "status" "RemediatorRepairStatus" NOT NULL DEFAULT 'REQUESTED',
  "httpStatus" INTEGER,
  "requestPayloadJson" JSONB,
  "responsePayloadJson" JSONB,
  "verificationJson" JSONB,
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),

  CONSTRAINT "RemediatorRepairAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RemediatorRepairAttempt_organizationId_idempotencyKey_key"
  ON "RemediatorRepairAttempt"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "RemediatorRepairAttempt_organizationId_nonce_key"
  ON "RemediatorRepairAttempt"("organizationId", "nonce");

-- CreateIndex
CREATE INDEX "RemediatorRepairAttempt_projectId_status_createdAt_idx"
  ON "RemediatorRepairAttempt"("projectId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "RemediatorRepairAttempt_organizationId_remediatorAction_createdAt_idx"
  ON "RemediatorRepairAttempt"("organizationId", "remediatorAction", "createdAt");

-- CreateIndex
CREATE INDEX "RemediatorRepairAttempt_incidentId_createdAt_idx"
  ON "RemediatorRepairAttempt"("incidentId", "createdAt");
