-- Phase 4 canonical alert, incident, remediation, and automation references.
-- Legacy Service IDs remain for rollback compatibility.

ALTER TABLE "Alert"
  ADD COLUMN IF NOT EXISTS "operationalEntityId" TEXT,
  ADD COLUMN IF NOT EXISTS "operationalRelationshipId" TEXT;
CREATE INDEX IF NOT EXISTS "Alert_operationalEntityId_status_idx"
  ON "Alert"("operationalEntityId", "status");
CREATE INDEX IF NOT EXISTS "Alert_operationalRelationshipId_status_idx"
  ON "Alert"("operationalRelationshipId", "status");

ALTER TABLE "Incident"
  ADD COLUMN IF NOT EXISTS "rootCauseEntityId" TEXT,
  ADD COLUMN IF NOT EXISTS "rootCauseRelationshipId" TEXT;
CREATE INDEX IF NOT EXISTS "Incident_rootCauseEntityId_idx"
  ON "Incident"("rootCauseEntityId");
CREATE INDEX IF NOT EXISTS "Incident_rootCauseRelationshipId_idx"
  ON "Incident"("rootCauseRelationshipId");

CREATE TABLE IF NOT EXISTS "IncidentTopologyReference" (
  "id" TEXT NOT NULL,
  "incidentId" TEXT NOT NULL,
  "entityId" TEXT,
  "relationshipId" TEXT,
  "role" TEXT NOT NULL DEFAULT 'AFFECTED',
  "source" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IncidentTopologyReference_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "IncidentTopologyReference_target_check"
    CHECK (
      ("entityId" IS NOT NULL AND "relationshipId" IS NULL)
      OR ("entityId" IS NULL AND "relationshipId" IS NOT NULL)
    )
);
CREATE UNIQUE INDEX IF NOT EXISTS "IncidentTopologyReference_entity_role_key"
  ON "IncidentTopologyReference"("incidentId", "entityId", "role")
  WHERE "entityId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "IncidentTopologyReference_relationship_role_key"
  ON "IncidentTopologyReference"("incidentId", "relationshipId", "role")
  WHERE "relationshipId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "IncidentTopologyReference_incidentId_role_idx"
  ON "IncidentTopologyReference"("incidentId", "role");
CREATE INDEX IF NOT EXISTS "IncidentTopologyReference_entityId_idx"
  ON "IncidentTopologyReference"("entityId");
CREATE INDEX IF NOT EXISTS "IncidentTopologyReference_relationshipId_idx"
  ON "IncidentTopologyReference"("relationshipId");

ALTER TABLE "RemediationLog"
  ADD COLUMN IF NOT EXISTS "operationalEntityId" TEXT,
  ADD COLUMN IF NOT EXISTS "operationalRelationshipId" TEXT;
CREATE INDEX IF NOT EXISTS "RemediationLog_operationalEntityId_createdAt_idx"
  ON "RemediationLog"("operationalEntityId", "createdAt");
CREATE INDEX IF NOT EXISTS "RemediationLog_operationalRelationshipId_createdAt_idx"
  ON "RemediationLog"("operationalRelationshipId", "createdAt");

ALTER TABLE "AutomationRun"
  ADD COLUMN IF NOT EXISTS "affectedEntityIds" JSONB,
  ADD COLUMN IF NOT EXISTS "affectedRelationshipIds" JSONB;

ALTER TABLE "AutomationRunStep"
  ADD COLUMN IF NOT EXISTS "targetEntityId" TEXT,
  ADD COLUMN IF NOT EXISTS "targetRelationshipId" TEXT;
CREATE INDEX IF NOT EXISTS "AutomationRunStep_targetEntityId_idx"
  ON "AutomationRunStep"("targetEntityId");
CREATE INDEX IF NOT EXISTS "AutomationRunStep_targetRelationshipId_idx"
  ON "AutomationRunStep"("targetRelationshipId");

ALTER TABLE "Alert"
  ADD CONSTRAINT "Alert_operationalEntityId_fkey"
    FOREIGN KEY ("operationalEntityId") REFERENCES "OperationalEntity"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Alert_operationalRelationshipId_fkey"
    FOREIGN KEY ("operationalRelationshipId") REFERENCES "OperationalRelationship"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Incident"
  ADD CONSTRAINT "Incident_rootCauseEntityId_fkey"
    FOREIGN KEY ("rootCauseEntityId") REFERENCES "OperationalEntity"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Incident_rootCauseRelationshipId_fkey"
    FOREIGN KEY ("rootCauseRelationshipId") REFERENCES "OperationalRelationship"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "IncidentTopologyReference"
  ADD CONSTRAINT "IncidentTopologyReference_incidentId_fkey"
    FOREIGN KEY ("incidentId") REFERENCES "Incident"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "IncidentTopologyReference_entityId_fkey"
    FOREIGN KEY ("entityId") REFERENCES "OperationalEntity"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "IncidentTopologyReference_relationshipId_fkey"
    FOREIGN KEY ("relationshipId") REFERENCES "OperationalRelationship"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RemediationLog"
  ADD CONSTRAINT "RemediationLog_operationalEntityId_fkey"
    FOREIGN KEY ("operationalEntityId") REFERENCES "OperationalEntity"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "RemediationLog_operationalRelationshipId_fkey"
    FOREIGN KEY ("operationalRelationshipId") REFERENCES "OperationalRelationship"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AutomationRunStep"
  ADD CONSTRAINT "AutomationRunStep_targetEntityId_fkey"
    FOREIGN KEY ("targetEntityId") REFERENCES "OperationalEntity"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "AutomationRunStep_targetRelationshipId_fkey"
    FOREIGN KEY ("targetRelationshipId") REFERENCES "OperationalRelationship"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
