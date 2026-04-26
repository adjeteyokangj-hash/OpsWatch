-- CreateEnum
CREATE TYPE "AlertCategory" AS ENUM ('AVAILABILITY', 'RELIABILITY', 'PERFORMANCE', 'SECURITY', 'DEPENDENCY_CHANGE');

-- CreateEnum
CREATE TYPE "RemediationStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'EXECUTING', 'SUCCEEDED', 'FAILED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EventType" ADD VALUE 'SERVICE_DOWN';
ALTER TYPE "EventType" ADD VALUE 'HEARTBEAT_MISSED';
ALTER TYPE "EventType" ADD VALUE 'AUTH_FAILURE_SPIKE';
ALTER TYPE "EventType" ADD VALUE 'TRAFFIC_SPIKE';
ALTER TYPE "EventType" ADD VALUE 'WEBHOOK_SIGNATURE_FAILED';
ALTER TYPE "EventType" ADD VALUE 'DEPLOY_FAILED';
ALTER TYPE "EventType" ADD VALUE 'SSL_EXPIRING';
ALTER TYPE "EventType" ADD VALUE 'DOMAIN_EXPIRING';

-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "category" "AlertCategory" NOT NULL DEFAULT 'AVAILABILITY';

-- CreateTable
CREATE TABLE "RemediationLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "alertId" TEXT,
    "incidentId" TEXT,
    "action" TEXT NOT NULL,
    "contextJson" JSONB,
    "executedBy" TEXT,
    "status" "RemediationStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "resultJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RemediationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RemediationLog_organizationId_createdAt_idx" ON "RemediationLog"("organizationId", "createdAt");
