-- Additive Users and Sessions monitoring. Existing computer rows stay in place.

CREATE TABLE "MonitoredStaff" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "accountStatus" TEXT NOT NULL,
    "propertyAccess" TEXT NOT NULL,
    "propertyIds" JSONB NOT NULL,
    "directorySeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonitoredStaff_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MonitoredSession" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "appVersion" TEXT,
    "lifecycleSync" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "financialSync" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "lastSuccessfulSyncAt" TIMESTAMP(3),
    "presence" TEXT NOT NULL DEFAULT 'ONLINE',
    "endedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "offlineAfterSeconds" INTEGER NOT NULL DEFAULT 600,
    "sanitizedPayloadJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonitoredSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MonitoredStaff_projectId_userId_key" ON "MonitoredStaff"("projectId", "userId");
CREATE INDEX "MonitoredStaff_projectId_accountStatus_idx" ON "MonitoredStaff"("projectId", "accountStatus");
CREATE UNIQUE INDEX "MonitoredSession_projectId_sessionId_key" ON "MonitoredSession"("projectId", "sessionId");
CREATE INDEX "MonitoredSession_projectId_userId_lastSeenAt_idx" ON "MonitoredSession"("projectId", "userId", "lastSeenAt");
CREATE INDEX "MonitoredSession_presence_lastSeenAt_idx" ON "MonitoredSession"("presence", "lastSeenAt");

ALTER TABLE "MonitoredStaff" ADD CONSTRAINT "MonitoredStaff_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MonitoredSession" ADD CONSTRAINT "MonitoredSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
