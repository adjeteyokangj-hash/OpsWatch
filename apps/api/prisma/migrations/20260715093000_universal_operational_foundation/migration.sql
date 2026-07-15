-- Universal operational foundation. Additive only: existing Projects, Services,
-- and ServiceDependencies remain the compatibility surface.
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "topologyMode" TEXT NOT NULL DEFAULT 'CENTRALISED';
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "operationalLocationId" TEXT;

CREATE TABLE IF NOT EXISTS "Connection" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "environment" TEXT NOT NULL DEFAULT 'production',
  "authMethod" TEXT NOT NULL DEFAULT 'NONE',
  "capabilitiesJson" JSONB,
  "configurationJson" JSONB,
  "secretRef" TEXT,
  "health" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "healthReason" TEXT,
  "lastSuccessAt" TIMESTAMP(3),
  "lastFailureAt" TIMESTAMP(3),
  "lastError" TEXT,
  "requestRatePerMinute" INTEGER,
  "errorRatePercent" DOUBLE PRECISION,
  "permissionsJson" JSONB,
  "installationStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "collectorVersion" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Connection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OperationalLocation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "parentLocationId" TEXT,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'SITE',
  "topologyMode" TEXT,
  "regionCode" TEXT,
  "addressJson" JSONB,
  "metadataJson" JSONB,
  "lifecycle" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OperationalLocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OperationalEntity" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT,
  "operationalLocationId" TEXT,
  "legacyServiceId" TEXT,
  "entityType" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "externalId" TEXT,
  "criticality" TEXT NOT NULL DEFAULT 'MEDIUM',
  "health" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "healthOverride" TEXT,
  "healthReason" TEXT,
  "healthConfidence" DOUBLE PRECISION,
  "provenance" TEXT NOT NULL DEFAULT 'DECLARED',
  "discoverySource" TEXT,
  "discoveredAt" TIMESTAMP(3),
  "lastSeenAt" TIMESTAMP(3),
  "tagsJson" JSONB,
  "metadataJson" JSONB,
  "lifecycle" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OperationalEntity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OperationalRelationship" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT,
  "sourceEntityId" TEXT NOT NULL,
  "targetEntityId" TEXT NOT NULL,
  "relationshipType" TEXT NOT NULL,
  "provenance" TEXT NOT NULL DEFAULT 'DECLARED',
  "approvalStatus" TEXT NOT NULL DEFAULT 'APPROVED',
  "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
  "criticality" TEXT NOT NULL DEFAULT 'MEDIUM',
  "confidence" DOUBLE PRECISION,
  "evidenceJson" JSONB,
  "discoveredAt" TIMESTAMP(3),
  "lastObservedAt" TIMESTAMP(3),
  "lifecycle" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OperationalRelationship_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Connection_organizationId_projectId_name_key" ON "Connection"("organizationId", "projectId", "name");
CREATE INDEX IF NOT EXISTS "Connection_organizationId_isActive_createdAt_idx" ON "Connection"("organizationId", "isActive", "createdAt");
CREATE INDEX IF NOT EXISTS "Connection_projectId_isActive_idx" ON "Connection"("projectId", "isActive");
CREATE INDEX IF NOT EXISTS "Connection_organizationId_mode_installationStatus_idx" ON "Connection"("organizationId", "mode", "installationStatus");

CREATE UNIQUE INDEX IF NOT EXISTS "OperationalLocation_organizationId_parentLocationId_name_key" ON "OperationalLocation"("organizationId", "parentLocationId", "name");
CREATE INDEX IF NOT EXISTS "OperationalLocation_organizationId_type_idx" ON "OperationalLocation"("organizationId", "type");
CREATE INDEX IF NOT EXISTS "OperationalLocation_organizationId_regionCode_idx" ON "OperationalLocation"("organizationId", "regionCode");
CREATE INDEX IF NOT EXISTS "Project_operationalLocationId_idx" ON "Project"("operationalLocationId");

CREATE UNIQUE INDEX IF NOT EXISTS "OperationalEntity_legacyServiceId_key" ON "OperationalEntity"("legacyServiceId");
CREATE UNIQUE INDEX IF NOT EXISTS "OperationalEntity_organizationId_entityType_externalId_key" ON "OperationalEntity"("organizationId", "entityType", "externalId");
CREATE INDEX IF NOT EXISTS "OperationalEntity_organizationId_projectId_entityType_idx" ON "OperationalEntity"("organizationId", "projectId", "entityType");
CREATE INDEX IF NOT EXISTS "OperationalEntity_organizationId_operationalLocationId_health_idx" ON "OperationalEntity"("organizationId", "operationalLocationId", "health");
CREATE INDEX IF NOT EXISTS "OperationalEntity_organizationId_provenance_lifecycle_idx" ON "OperationalEntity"("organizationId", "provenance", "lifecycle");

CREATE UNIQUE INDEX IF NOT EXISTS "OperationalRelationship_organizationId_sourceEntityId_targetEntityId_relationshipType_key" ON "OperationalRelationship"("organizationId", "sourceEntityId", "targetEntityId", "relationshipType");
CREATE INDEX IF NOT EXISTS "OperationalRelationship_organizationId_projectId_approvalStatus_idx" ON "OperationalRelationship"("organizationId", "projectId", "approvalStatus");
CREATE INDEX IF NOT EXISTS "OperationalRelationship_sourceEntityId_lifecycle_idx" ON "OperationalRelationship"("sourceEntityId", "lifecycle");
CREATE INDEX IF NOT EXISTS "OperationalRelationship_targetEntityId_lifecycle_idx" ON "OperationalRelationship"("targetEntityId", "lifecycle");

DO $$ BEGIN
  ALTER TABLE "Project" ADD CONSTRAINT "Project_operationalLocationId_fkey" FOREIGN KEY ("operationalLocationId") REFERENCES "OperationalLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Connection" ADD CONSTRAINT "Connection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Connection" ADD CONSTRAINT "Connection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "OperationalLocation" ADD CONSTRAINT "OperationalLocation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "OperationalLocation" ADD CONSTRAINT "OperationalLocation_parentLocationId_fkey" FOREIGN KEY ("parentLocationId") REFERENCES "OperationalLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "OperationalEntity" ADD CONSTRAINT "OperationalEntity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "OperationalEntity" ADD CONSTRAINT "OperationalEntity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "OperationalEntity" ADD CONSTRAINT "OperationalEntity_operationalLocationId_fkey" FOREIGN KEY ("operationalLocationId") REFERENCES "OperationalLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "OperationalEntity" ADD CONSTRAINT "OperationalEntity_legacyServiceId_fkey" FOREIGN KEY ("legacyServiceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "OperationalRelationship" ADD CONSTRAINT "OperationalRelationship_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "OperationalRelationship" ADD CONSTRAINT "OperationalRelationship_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "OperationalRelationship" ADD CONSTRAINT "OperationalRelationship_sourceEntityId_fkey" FOREIGN KEY ("sourceEntityId") REFERENCES "OperationalEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "OperationalRelationship" ADD CONSTRAINT "OperationalRelationship_targetEntityId_fkey" FOREIGN KEY ("targetEntityId") REFERENCES "OperationalEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Compatibility projection: existing Services and dependencies are represented
-- in the flexible graph without removing or mutating their existing tables.
INSERT INTO "OperationalEntity" (
  "id", "organizationId", "projectId", "entityType", "name", "externalId",
  "criticality", "health", "provenance", "discoverySource", "metadataJson", "updatedAt"
)
SELECT
  'legacy-project:' || p."id", p."organizationId", p."id", 'PROJECT', p."name", p."id",
  'HIGH', p."status"::text, 'DECLARED', 'PROJECT_COMPATIBILITY',
  jsonb_build_object('legacyProjectId', p."id"), CURRENT_TIMESTAMP
FROM "Project" p
WHERE p."organizationId" IS NOT NULL
ON CONFLICT ("organizationId", "entityType", "externalId") DO NOTHING;

INSERT INTO "OperationalEntity" (
  "id", "organizationId", "projectId", "legacyServiceId", "entityType", "name",
  "criticality", "health", "provenance", "discoverySource", "metadataJson", "updatedAt"
)
SELECT
  'legacy-service:' || s."id", p."organizationId", s."projectId", s."id", s."type"::text, s."name",
  s."criticality", s."status"::text, 'DECLARED', 'SERVICE_COMPATIBILITY',
  jsonb_build_object('legacyServiceId', s."id"), CURRENT_TIMESTAMP
FROM "Service" s
JOIN "Project" p ON p."id" = s."projectId"
WHERE p."organizationId" IS NOT NULL
ON CONFLICT ("legacyServiceId") DO NOTHING;

INSERT INTO "OperationalRelationship" (
  "id", "organizationId", "projectId", "sourceEntityId", "targetEntityId",
  "relationshipType", "provenance", "approvalStatus", "requiresApproval",
  "criticality", "updatedAt"
)
SELECT
  'legacy-project-service:' || s."id", p."organizationId", p."id",
  'legacy-project:' || p."id", 'legacy-service:' || s."id",
  'CONTAINS', 'DECLARED', 'APPROVED', false, s."criticality", CURRENT_TIMESTAMP
FROM "Service" s
JOIN "Project" p ON p."id" = s."projectId"
WHERE p."organizationId" IS NOT NULL
ON CONFLICT ("organizationId", "sourceEntityId", "targetEntityId", "relationshipType") DO NOTHING;

INSERT INTO "OperationalRelationship" (
  "id", "organizationId", "projectId", "sourceEntityId", "targetEntityId",
  "relationshipType", "provenance", "approvalStatus", "requiresApproval",
  "criticality", "confidence", "evidenceJson", "lastObservedAt", "updatedAt"
)
SELECT
  'legacy-dependency:' || d."id", p."organizationId", d."projectId",
  'legacy-service:' || d."fromServiceId", 'legacy-service:' || d."toServiceId",
  d."dependencyType", 'DECLARED', 'APPROVED', false, d."criticality",
  d."evidenceStrength", jsonb_build_object('legacyDependencyId', d."id", 'evidenceCount', d."evidenceCount"),
  d."lastObservedAt", CURRENT_TIMESTAMP
FROM "ServiceDependency" d
JOIN "Project" p ON p."id" = d."projectId"
WHERE p."organizationId" IS NOT NULL
ON CONFLICT ("organizationId", "sourceEntityId", "targetEntityId", "relationshipType") DO NOTHING;
