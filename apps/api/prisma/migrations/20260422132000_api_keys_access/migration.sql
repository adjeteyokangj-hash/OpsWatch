-- API key access model updates
ALTER TABLE "OrgApiKey"
  ADD COLUMN "projectId" TEXT,
  ADD COLUMN "keyId" TEXT,
  ADD COLUMN "secretHash" TEXT,
  ADD COLUMN "scopes" JSONB,
  ADD COLUMN "environment" TEXT,
  ADD COLUMN "revokedAt" TIMESTAMP(3);

-- Backfill new required columns for any pre-existing keys
UPDATE "OrgApiKey"
SET
  "keyId" = CONCAT('ow_live_', SUBSTRING(MD5(id) FROM 1 FOR 8)),
  "secretHash" = COALESCE("keyHash", MD5(id)),
  "scopes" = '["events:write"]'::jsonb,
  "environment" = 'live'
WHERE "keyId" IS NULL;

ALTER TABLE "OrgApiKey"
  ALTER COLUMN "keyId" SET NOT NULL,
  ALTER COLUMN "secretHash" SET NOT NULL,
  ALTER COLUMN "scopes" SET NOT NULL,
  ALTER COLUMN "environment" SET NOT NULL;

CREATE UNIQUE INDEX "OrgApiKey_keyId_key" ON "OrgApiKey"("keyId");
CREATE INDEX "OrgApiKey_organizationId_revokedAt_idx" ON "OrgApiKey"("organizationId", "revokedAt");
CREATE INDEX "OrgApiKey_projectId_idx" ON "OrgApiKey"("projectId");

ALTER TABLE "OrgApiKey"
  ADD CONSTRAINT "OrgApiKey_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OrgApiKey" DROP COLUMN "keyHash";
ALTER TABLE "OrgApiKey" DROP COLUMN "isActive";
