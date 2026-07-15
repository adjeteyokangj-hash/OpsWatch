-- Phase 5: additive impact and observation fields for operational relationships.
-- Compatible with existing rows via defaults.
ALTER TABLE "OperationalRelationship" ADD COLUMN IF NOT EXISTS "impactRole" TEXT NOT NULL DEFAULT 'REQUIRED';
ALTER TABLE "OperationalRelationship" ADD COLUMN IF NOT EXISTS "observationCount" INTEGER NOT NULL DEFAULT 0;
