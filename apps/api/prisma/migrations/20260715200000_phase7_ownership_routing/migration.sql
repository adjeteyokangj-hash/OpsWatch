-- Phase 7: additive ownership / routing fields for services and operational entities.

ALTER TABLE "Service" ADD COLUMN IF NOT EXISTS "ownerUserId" TEXT;
ALTER TABLE "Service" ADD COLUMN IF NOT EXISTS "ownerTeam" TEXT;
ALTER TABLE "Service" ADD COLUMN IF NOT EXISTS "runbookUrl" TEXT;
ALTER TABLE "Service" ADD COLUMN IF NOT EXISTS "escalationContact" TEXT;

CREATE INDEX IF NOT EXISTS "Service_projectId_ownerUserId_idx" ON "Service"("projectId", "ownerUserId");
CREATE INDEX IF NOT EXISTS "Service_projectId_ownerTeam_idx" ON "Service"("projectId", "ownerTeam");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Service_ownerUserId_fkey'
  ) THEN
    ALTER TABLE "Service"
      ADD CONSTRAINT "Service_ownerUserId_fkey"
      FOREIGN KEY ("ownerUserId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "OperationalEntity" ADD COLUMN IF NOT EXISTS "ownerUserId" TEXT;
ALTER TABLE "OperationalEntity" ADD COLUMN IF NOT EXISTS "ownerTeam" TEXT;
ALTER TABLE "OperationalEntity" ADD COLUMN IF NOT EXISTS "runbookUrl" TEXT;
ALTER TABLE "OperationalEntity" ADD COLUMN IF NOT EXISTS "escalationContact" TEXT;

CREATE INDEX IF NOT EXISTS "OperationalEntity_organizationId_ownerUserId_idx"
  ON "OperationalEntity"("organizationId", "ownerUserId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OperationalEntity_ownerUserId_fkey'
  ) THEN
    ALTER TABLE "OperationalEntity"
      ADD CONSTRAINT "OperationalEntity_ownerUserId_fkey"
      FOREIGN KEY ("ownerUserId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
