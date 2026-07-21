-- CreateTable
CREATE TABLE "WorkerTickRun" (
    "id" TEXT NOT NULL,
    "triggeredBy" TEXT NOT NULL DEFAULT 'supabase-cron',
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "jobsAttempted" INTEGER NOT NULL DEFAULT 0,
    "jobsSucceeded" INTEGER NOT NULL DEFAULT 0,
    "jobsFailed" INTEGER NOT NULL DEFAULT 0,
    "jobsDeferred" INTEGER NOT NULL DEFAULT 0,
    "jobsSkipped" INTEGER NOT NULL DEFAULT 0,
    "heartbeatUpdated" BOOLEAN NOT NULL DEFAULT false,
    "heartbeatAt" TIMESTAMP(3),
    "errorSummary" TEXT,
    "summaryJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkerTickRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerJobState" (
    "jobName" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "lastFinishedAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastDurationMs" INTEGER,
    "lastError" TEXT,
    "nextDueAt" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "totalRuns" INTEGER NOT NULL DEFAULT 0,
    "totalFailures" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerJobState_pkey" PRIMARY KEY ("jobName")
);

-- CreateTable
CREATE TABLE "WorkerTickLock" (
    "key" TEXT NOT NULL,
    "holder" TEXT,
    "lockedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerTickLock_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "WorkerTickRun_startedAt_idx" ON "WorkerTickRun"("startedAt");

-- CreateIndex
CREATE INDEX "WorkerTickRun_status_startedAt_idx" ON "WorkerTickRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "WorkerJobState_nextDueAt_idx" ON "WorkerJobState"("nextDueAt");
