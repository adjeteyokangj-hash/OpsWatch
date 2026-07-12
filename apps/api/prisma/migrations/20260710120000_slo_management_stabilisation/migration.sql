-- Correlation and SLO stabilisation. Additive and safe for existing definitions.
ALTER TABLE "SLODefinition" ADD COLUMN "targetType" TEXT NOT NULL DEFAULT 'SERVICE';
ALTER TABLE "SLODefinition" ADD COLUMN "targetId" TEXT;
ALTER TABLE "SLODefinition" ADD COLUMN "windowType" TEXT NOT NULL DEFAULT 'ROLLING';
ALTER TABLE "SLODefinition" ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "SLODefinition_projectId_archivedAt_idx"
ON "SLODefinition"("projectId", "archivedAt");
