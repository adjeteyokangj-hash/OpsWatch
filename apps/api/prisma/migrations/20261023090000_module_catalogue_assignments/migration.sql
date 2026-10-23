-- Additive only. Apply through the explicitly approved migration process.
-- No existing data is changed and no historical migration is edited.
BEGIN;
CREATE UNIQUE INDEX "Project_organizationId_id_key" ON "Project"("organizationId", "id");
CREATE UNIQUE INDEX "OperationalEntity_organizationId_projectId_id_key" ON "OperationalEntity"("organizationId", "projectId", "id");
CREATE TABLE "ModuleCatalogueDefinition" (
  "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL,
  "key" TEXT NOT NULL, "label" TEXT NOT NULL, "description" TEXT NOT NULL,
  "category" TEXT NOT NULL, "terms" TEXT[] NOT NULL, "capabilities" TEXT[] NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE', "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ModuleCatalogueDefinition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ModuleCatalogueDefinition_organizationId_key_key" ON "ModuleCatalogueDefinition"("organizationId", "key");
CREATE TABLE "ProjectModuleAssignment" (
  "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "projectId" TEXT NOT NULL,
  "moduleKey" TEXT NOT NULL, "state" TEXT NOT NULL DEFAULT 'PROPOSED', "source" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL CHECK ("confidence" >= 0 AND "confidence" <= 1),
  "evidenceJson" JSONB NOT NULL, "decidedBy" TEXT, "decidedAt" TIMESTAMP(3), "note" TEXT, "verifiedEntityId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectModuleAssignment_state_check" CHECK ("state" IN ('PROPOSED', 'APPROVED', 'REJECTED', 'REMOVED')),
  CONSTRAINT "ProjectModuleAssignment_organizationId_projectId_fkey" FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProjectModuleAssignment_verified_entity_fkey" FOREIGN KEY ("organizationId", "projectId", "verifiedEntityId") REFERENCES "OperationalEntity"("organizationId", "projectId", "id") ON DELETE NO ACTION ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProjectModuleAssignment_organizationId_projectId_moduleKey_key" ON "ProjectModuleAssignment"("organizationId", "projectId", "moduleKey");
CREATE INDEX "ProjectModuleAssignment_organizationId_projectId_state_idx" ON "ProjectModuleAssignment"("organizationId", "projectId", "state");
CREATE TABLE "ModuleDiscoveryRun" (
  "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "projectId" TEXT NOT NULL,
  "slot" INTEGER NOT NULL, "status" TEXT NOT NULL DEFAULT 'RUNNING', "sourcesJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" TIMESTAMP(3),
  CONSTRAINT "ModuleDiscoveryRun_organizationId_projectId_fkey" FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ModuleDiscoveryRun_organizationId_projectId_slot_key" ON "ModuleDiscoveryRun"("organizationId", "projectId", "slot");
CREATE INDEX "ModuleDiscoveryRun_organizationId_projectId_createdAt_idx" ON "ModuleDiscoveryRun"("organizationId", "projectId", "createdAt");

-- API access goes through the tenant-scoped server. Do not expose these rows
-- through public Supabase Data API roles; the database owner retains access.
ALTER TABLE "ModuleCatalogueDefinition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectModuleAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ModuleDiscoveryRun" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "ModuleCatalogueDefinition", "ProjectModuleAssignment", "ModuleDiscoveryRun" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "ModuleCatalogueDefinition", "ProjectModuleAssignment", "ModuleDiscoveryRun" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "ModuleCatalogueDefinition", "ProjectModuleAssignment", "ModuleDiscoveryRun" FROM authenticated;
  END IF;
END $$;
COMMIT;
