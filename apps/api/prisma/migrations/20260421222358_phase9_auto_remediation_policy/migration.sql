-- AlterTable
ALTER TABLE "RemediationLog" ADD COLUMN     "executionMode" TEXT NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "policySnapshot" JSONB,
ADD COLUMN     "suppressionSnapshot" JSONB;

-- CreateTable
CREATE TABLE "AutoRemediationPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "policyType" TEXT NOT NULL,
    "policyKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutoRemediationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutoRemediationPolicy_organizationId_idx" ON "AutoRemediationPolicy"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AutoRemediationPolicy_organizationId_policyType_policyKey_key" ON "AutoRemediationPolicy"("organizationId", "policyType", "policyKey");

-- CreateIndex
CREATE INDEX "RemediationLog_organizationId_executionMode_createdAt_idx" ON "RemediationLog"("organizationId", "executionMode", "createdAt");
