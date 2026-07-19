-- Phase 4 canonical operational graph. Additive only.

ALTER TABLE "OperationalEntity"
  ADD COLUMN IF NOT EXISTS "projectScopeKey" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "environment" TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS "stableIdentityKey" TEXT,
  ADD COLUMN IF NOT EXISTS "confirmationState" TEXT NOT NULL DEFAULT 'CONFIRMED',
  ADD COLUMN IF NOT EXISTS "manuallyManaged" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "sharedScope" TEXT NOT NULL DEFAULT 'PROJECT',
  ADD COLUMN IF NOT EXISTS "isTestSeed" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "OperationalRelationship"
  ADD COLUMN IF NOT EXISTS "projectScopeKey" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "environment" TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS "stableIdentityKey" TEXT,
  ADD COLUMN IF NOT EXISTS "firstSeenAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "confirmationState" TEXT NOT NULL DEFAULT 'CONFIRMED',
  ADD COLUMN IF NOT EXISTS "manuallyManaged" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "automationCapabilitiesJson" JSONB,
  ADD COLUMN IF NOT EXISTS "metadataJson" JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS "OperationalEntity_canonical_identity_key"
  ON "OperationalEntity"(
    "organizationId", "projectScopeKey", "environment", "entityType", "stableIdentityKey"
  );
CREATE INDEX IF NOT EXISTS "OperationalEntity_canonical_scope_idx"
  ON "OperationalEntity"(
    "organizationId", "projectScopeKey", "environment", "entityType"
  );

CREATE UNIQUE INDEX IF NOT EXISTS "OperationalRelationship_canonical_identity_key"
  ON "OperationalRelationship"(
    "organizationId", "projectScopeKey", "environment", "stableIdentityKey"
  );
CREATE INDEX IF NOT EXISTS "OperationalRelationship_canonical_scope_idx"
  ON "OperationalRelationship"(
    "organizationId", "projectScopeKey", "environment", "relationshipType"
  );

CREATE TABLE IF NOT EXISTS "OperationalEntityIdentity" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT,
  "projectScopeKey" TEXT NOT NULL DEFAULT '',
  "environment" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION,
  "confirmed" BOOLEAN NOT NULL DEFAULT false,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OperationalEntityIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OperationalEntityIdentity_source_key"
  ON "OperationalEntityIdentity"(
    "organizationId", "projectScopeKey", "environment", "source", "sourceKey"
  );
CREATE INDEX IF NOT EXISTS "OperationalEntityIdentity_entity_source_idx"
  ON "OperationalEntityIdentity"("entityId", "source");
CREATE INDEX IF NOT EXISTS "OperationalEntityIdentity_org_environment_sourceKey_idx"
  ON "OperationalEntityIdentity"("organizationId", "environment", "sourceKey");

CREATE TABLE IF NOT EXISTS "LegacyServiceEntityMapping" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "legacyServiceId" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "entityIdentityKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "conflictReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LegacyServiceEntityMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LegacyServiceEntityMapping_context_key"
  ON "LegacyServiceEntityMapping"(
    "organizationId", "projectId", "environment", "legacyServiceId", "entityId"
  );
CREATE INDEX IF NOT EXISTS "LegacyServiceEntityMapping_lookup_idx"
  ON "LegacyServiceEntityMapping"(
    "organizationId", "projectId", "environment", "legacyServiceId", "status"
  );
CREATE INDEX IF NOT EXISTS "LegacyServiceEntityMapping_entity_status_idx"
  ON "LegacyServiceEntityMapping"("entityId", "status");

CREATE TABLE IF NOT EXISTS "LegacyDependencyRelationshipMapping" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "legacyServiceDependencyId" TEXT NOT NULL,
  "relationshipId" TEXT NOT NULL,
  "relationshipIdentityKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "conflictReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LegacyDependencyRelationshipMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LegacyDependencyRelationshipMapping_context_key"
  ON "LegacyDependencyRelationshipMapping"(
    "organizationId", "projectId", "environment",
    "legacyServiceDependencyId", "relationshipId"
  );
CREATE INDEX IF NOT EXISTS "LegacyDependencyRelationshipMapping_lookup_idx"
  ON "LegacyDependencyRelationshipMapping"(
    "organizationId", "projectId", "environment",
    "legacyServiceDependencyId", "status"
  );
CREATE INDEX IF NOT EXISTS "LegacyDependencyRelationshipMapping_rel_status_idx"
  ON "LegacyDependencyRelationshipMapping"("relationshipId", "status");

ALTER TABLE "OperationalEntityIdentity"
  ADD CONSTRAINT "OperationalEntityIdentity_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "OperationalEntityIdentity_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "OperationalEntityIdentity_entityId_fkey"
    FOREIGN KEY ("entityId") REFERENCES "OperationalEntity"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LegacyServiceEntityMapping"
  ADD CONSTRAINT "LegacyServiceEntityMapping_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LegacyServiceEntityMapping_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LegacyServiceEntityMapping_legacyServiceId_fkey"
    FOREIGN KEY ("legacyServiceId") REFERENCES "Service"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LegacyServiceEntityMapping_entityId_fkey"
    FOREIGN KEY ("entityId") REFERENCES "OperationalEntity"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LegacyDependencyRelationshipMapping"
  ADD CONSTRAINT "LegacyDependencyMapping_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LegacyDependencyMapping_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LegacyDependencyMapping_legacyDependencyId_fkey"
    FOREIGN KEY ("legacyServiceDependencyId") REFERENCES "ServiceDependency"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LegacyDependencyMapping_relationshipId_fkey"
    FOREIGN KEY ("relationshipId") REFERENCES "OperationalRelationship"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
