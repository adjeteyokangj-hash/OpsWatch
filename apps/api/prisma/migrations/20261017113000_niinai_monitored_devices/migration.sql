-- Per-computer heartbeats for desktop applications such as NiiNai.
-- Additive only. Existing application heartbeats keep a null deviceId.

ALTER TABLE "Heartbeat" ADD COLUMN IF NOT EXISTS "deviceId" TEXT;

CREATE INDEX IF NOT EXISTS "Heartbeat_projectId_deviceId_receivedAt_idx"
  ON "Heartbeat"("projectId", "deviceId", "receivedAt");

CREATE TABLE IF NOT EXISTS "MonitoredDevice" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "label" TEXT,
    "reportedName" TEXT,
    "propertyId" TEXT,
    "environment" TEXT NOT NULL,
    "appVersion" TEXT,
    "presence" TEXT NOT NULL DEFAULT 'ONLINE',
    "reportedStatus" TEXT NOT NULL,
    "message" TEXT,
    "lifecycleSync" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "financialSync" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "pendingCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "conflictCount" INTEGER NOT NULL DEFAULT 0,
    "oldestPendingAgeSeconds" INTEGER,
    "lastSuccessfulSyncAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "offlineAfterSeconds" INTEGER NOT NULL DEFAULT 600,
    "sanitizedPayloadJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonitoredDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MonitoredDevice_projectId_deviceId_key"
  ON "MonitoredDevice"("projectId", "deviceId");

CREATE INDEX IF NOT EXISTS "MonitoredDevice_projectId_lastSeenAt_idx"
  ON "MonitoredDevice"("projectId", "lastSeenAt");

CREATE INDEX IF NOT EXISTS "MonitoredDevice_presence_lastSeenAt_idx"
  ON "MonitoredDevice"("presence", "lastSeenAt");

ALTER TABLE "MonitoredDevice" DROP CONSTRAINT IF EXISTS "MonitoredDevice_projectId_fkey";
ALTER TABLE "MonitoredDevice"
  ADD CONSTRAINT "MonitoredDevice_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
