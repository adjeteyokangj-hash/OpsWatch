-- Additive Phase 1: OkangGroup CMS marketing content store (website copy only).
-- No destructive changes. No customer/monitoring/billing tables touched.

CREATE TABLE IF NOT EXISTS "MarketingContentDocument" (
    "id" TEXT NOT NULL,
    "cmsKey" TEXT NOT NULL,
    "draftJson" JSONB,
    "publishedJson" JSONB,
    "draftRevision" INTEGER NOT NULL DEFAULT 0,
    "publishedRevision" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "MarketingContentDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MarketingContentDocument_cmsKey_key" ON "MarketingContentDocument"("cmsKey");
CREATE INDEX IF NOT EXISTS "MarketingContentDocument_updatedAt_idx" ON "MarketingContentDocument"("updatedAt");

CREATE TABLE IF NOT EXISTS "MarketingContentRevision" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "revisionNo" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "contentJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorLabel" TEXT,

    CONSTRAINT "MarketingContentRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MarketingContentRevision_documentId_revisionNo_kind_key"
  ON "MarketingContentRevision"("documentId", "revisionNo", "kind");
CREATE INDEX IF NOT EXISTS "MarketingContentRevision_documentId_createdAt_idx"
  ON "MarketingContentRevision"("documentId", "createdAt");

ALTER TABLE "MarketingContentRevision"
  DROP CONSTRAINT IF EXISTS "MarketingContentRevision_documentId_fkey";
ALTER TABLE "MarketingContentRevision"
  ADD CONSTRAINT "MarketingContentRevision_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "MarketingContentDocument"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "MarketingCmsApiKey" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "MarketingCmsApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MarketingCmsApiKey_keyHash_key" ON "MarketingCmsApiKey"("keyHash");
CREATE INDEX IF NOT EXISTS "MarketingCmsApiKey_isActive_idx" ON "MarketingCmsApiKey"("isActive");
