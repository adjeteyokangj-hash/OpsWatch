-- Phase 7: explicit maintenance remediation policy option
ALTER TABLE "MaintenanceWindow" ADD COLUMN IF NOT EXISTS "remediationPolicy" TEXT;
