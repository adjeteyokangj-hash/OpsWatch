-- Phase 10: provider-neutral monitoring source connectors

ALTER TABLE "Connection"
  ADD COLUMN IF NOT EXISTS "lastSyncAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastSyncStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "lastSyncSummary" TEXT,
  ADD COLUMN IF NOT EXISTS "lastSyncError" TEXT,
  ADD COLUMN IF NOT EXISTS "lastSyncDurationMs" INTEGER,
  ADD COLUMN IF NOT EXISTS "lastSyncImportedCount" INTEGER,
  ADD COLUMN IF NOT EXISTS "lastSyncCursor" TEXT,
  ADD COLUMN IF NOT EXISTS "syncIntervalMinutes" INTEGER NOT NULL DEFAULT 15;

CREATE INDEX IF NOT EXISTS "Connection_organizationId_mode_lastSyncAt_idx"
  ON "Connection"("organizationId", "mode", "lastSyncAt");

CREATE TABLE IF NOT EXISTS "MonitoringSyncRun" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "projectId" TEXT,
  "environment" TEXT NOT NULL,
  "connectorMode" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "durationMs" INTEGER,
  "importedCount" INTEGER NOT NULL DEFAULT 0,
  "pageCount" INTEGER NOT NULL DEFAULT 0,
  "cursorStart" TEXT,
  "cursorEnd" TEXT,
  "errorCategory" TEXT,
  "errorMessage" TEXT,
  "summaryJson" JSONB,
  "limitationsJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MonitoringSyncRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MonitoringSyncRun_organizationId_connectionId_startedAt_idx"
  ON "MonitoringSyncRun"("organizationId", "connectionId", "startedAt");

CREATE INDEX IF NOT EXISTS "MonitoringSyncRun_connectionId_status_startedAt_idx"
  ON "MonitoringSyncRun"("connectionId", "status", "startedAt");

ALTER TABLE "MonitoringSyncRun"
  ADD CONSTRAINT "MonitoringSyncRun_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MonitoringSyncRun"
  ADD CONSTRAINT "MonitoringSyncRun_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MonitoringSyncRun"
  ADD CONSTRAINT "MonitoringSyncRun_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
