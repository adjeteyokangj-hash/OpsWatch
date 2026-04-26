-- AlterTable
ALTER TABLE "RemediationLog" ADD COLUMN     "impactTier" TEXT,
ADD COLUMN     "predictedLabel" TEXT,
ADD COLUMN     "predictedScore" INTEGER;

-- CreateIndex
CREATE INDEX "RemediationLog_organizationId_action_status_idx" ON "RemediationLog"("organizationId", "action", "status");
