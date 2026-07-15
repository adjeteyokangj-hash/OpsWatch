-- Phase 3: agentless connection lifecycle and universal factual change ledger.
-- Additive only; existing ChangeEvent remains the legacy compatibility surface.
ALTER TABLE "Connection"
  ADD COLUMN IF NOT EXISTS "manifestVersion" TEXT NOT NULL DEFAULT '1.0',
  ADD COLUMN IF NOT EXISTS "deactivatedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "ChangeLedgerEntry" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT,
  "serviceId" TEXT,
  "incidentId" TEXT,
  "connectionId" TEXT,
  "kind" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "actorType" TEXT,
  "actor" TEXT,
  "source" TEXT NOT NULL,
  "externalId" TEXT,
  "evidenceJson" JSONB,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChangeLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ChangeLedgerEntry_organizationId_occurredAt_idx"
  ON "ChangeLedgerEntry"("organizationId", "occurredAt");
CREATE INDEX IF NOT EXISTS "ChangeLedgerEntry_organizationId_kind_occurredAt_idx"
  ON "ChangeLedgerEntry"("organizationId", "kind", "occurredAt");
CREATE INDEX IF NOT EXISTS "ChangeLedgerEntry_projectId_occurredAt_idx"
  ON "ChangeLedgerEntry"("projectId", "occurredAt");
CREATE INDEX IF NOT EXISTS "ChangeLedgerEntry_connectionId_occurredAt_idx"
  ON "ChangeLedgerEntry"("connectionId", "occurredAt");
CREATE INDEX IF NOT EXISTS "ChangeLedgerEntry_organizationId_source_externalId_idx"
  ON "ChangeLedgerEntry"("organizationId", "source", "externalId");

DO $$ BEGIN
  ALTER TABLE "ChangeLedgerEntry" ADD CONSTRAINT "ChangeLedgerEntry_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ChangeLedgerEntry" ADD CONSTRAINT "ChangeLedgerEntry_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ChangeLedgerEntry" ADD CONSTRAINT "ChangeLedgerEntry_serviceId_fkey"
    FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ChangeLedgerEntry" ADD CONSTRAINT "ChangeLedgerEntry_incidentId_fkey"
    FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ChangeLedgerEntry" ADD CONSTRAINT "ChangeLedgerEntry_connectionId_fkey"
    FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
