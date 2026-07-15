-- Phase 6: additive alert fingerprint / occurrence and incident merge/reopen fields.
-- Compatible with existing rows via defaults and nullable columns.

ALTER TABLE "Alert" ADD COLUMN IF NOT EXISTS "fingerprint" TEXT;
ALTER TABLE "Alert" ADD COLUMN IF NOT EXISTS "occurrenceCount" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS "Alert_projectId_fingerprint_status_idx"
  ON "Alert"("projectId", "fingerprint", "status");

ALTER TABLE "Incident" ADD COLUMN IF NOT EXISTS "fingerprint" TEXT;
ALTER TABLE "Incident" ADD COLUMN IF NOT EXISTS "mergedIntoIncidentId" TEXT;
ALTER TABLE "Incident" ADD COLUMN IF NOT EXISTS "reopenCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Incident" ADD COLUMN IF NOT EXISTS "lastReopenedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Incident_projectId_fingerprint_idx"
  ON "Incident"("projectId", "fingerprint");

CREATE INDEX IF NOT EXISTS "Incident_mergedIntoIncidentId_idx"
  ON "Incident"("mergedIntoIncidentId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Incident_mergedIntoIncidentId_fkey'
  ) THEN
    ALTER TABLE "Incident"
      ADD CONSTRAINT "Incident_mergedIntoIncidentId_fkey"
      FOREIGN KEY ("mergedIntoIncidentId") REFERENCES "Incident"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
