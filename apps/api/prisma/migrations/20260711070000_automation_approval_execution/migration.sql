ALTER TABLE "AutomationRun" ADD COLUMN "approvedVersionId" TEXT;
ALTER TABLE "AutomationRun" ADD COLUMN "cancelledBy" TEXT;
ALTER TABLE "AutomationRun" ADD COLUMN "cancelledAt" TIMESTAMP(3);
ALTER TABLE "AutomationRun" ADD COLUMN "currentStepOrder" INTEGER;
ALTER TABLE "AutomationRun" ADD COLUMN "supersededByRunId" TEXT;

ALTER TABLE "AutomationApproval" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'RUN';
