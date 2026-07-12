-- CreateTable
CREATE TABLE "IngestReplayNonce" (
    "nonce" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "projectId" TEXT,
    "apiKeyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngestReplayNonce_pkey" PRIMARY KEY ("nonce")
);

-- CreateIndex
CREATE INDEX "IngestReplayNonce_expiresAt_idx" ON "IngestReplayNonce"("expiresAt");
