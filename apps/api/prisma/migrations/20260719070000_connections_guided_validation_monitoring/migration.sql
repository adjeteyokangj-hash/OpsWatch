-- Additive guided connection validation, managed-secret, and monitoring linkage.
-- Existing configurationJson and secretRef values remain authoritative for legacy rows.
ALTER TABLE "Connection"
  ADD COLUMN IF NOT EXISTS "createdBy" TEXT,
  ADD COLUMN IF NOT EXISTS "managedSecretCiphertext" TEXT,
  ADD COLUMN IF NOT EXISTS "managedSecretIv" TEXT,
  ADD COLUMN IF NOT EXISTS "managedSecretAuthTag" TEXT,
  ADD COLUMN IF NOT EXISTS "lastValidatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "validationStatusCode" INTEGER,
  ADD COLUMN IF NOT EXISTS "validationLatencyMs" INTEGER,
  ADD COLUMN IF NOT EXISTS "validationErrorCategory" TEXT,
  ADD COLUMN IF NOT EXISTS "linkedServiceId" TEXT,
  ADD COLUMN IF NOT EXISTS "linkedCheckId" TEXT;

CREATE INDEX IF NOT EXISTS "Connection_linkedServiceId_idx" ON "Connection"("linkedServiceId");
CREATE INDEX IF NOT EXISTS "Connection_linkedCheckId_idx" ON "Connection"("linkedCheckId");
