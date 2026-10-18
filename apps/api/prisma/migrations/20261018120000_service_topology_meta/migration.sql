-- Nullable manifest metadata. Existing services stay unchanged.

ALTER TABLE "Service" ADD COLUMN IF NOT EXISTS "topologyMetaJson" JSONB;
