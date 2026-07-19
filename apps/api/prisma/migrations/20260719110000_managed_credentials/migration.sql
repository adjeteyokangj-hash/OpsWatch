-- Phase 2: versioned managed credential store (additive only).
-- Legacy plaintext / ciphertext columns remain until readers and rollback are proven.

ALTER TABLE "AuditLog"
  ADD COLUMN IF NOT EXISTS "organizationId" TEXT;

ALTER TABLE "OrgApiKey"
  ADD COLUMN IF NOT EXISTS "graceExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rotatedFromKeyId" TEXT,
  ADD COLUMN IF NOT EXISTS "allowCrossEnvironment" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Project"
  ADD COLUMN IF NOT EXISTS "signingCredentialFamilyId" TEXT,
  ADD COLUMN IF NOT EXISTS "signingSecretRotatedAt" TIMESTAMP(3);

ALTER TABLE "Connection"
  ADD COLUMN IF NOT EXISTS "credentialFamilyId" TEXT;

ALTER TABLE "ProjectIntegration"
  ADD COLUMN IF NOT EXISTS "credentialFamilyId" TEXT;

CREATE TABLE IF NOT EXISTS "ManagedCredential" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT,
  "connectionId" TEXT,
  "integrationId" TEXT,
  "familyId" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "credentialType" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "keyVersion" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "authTag" TEXT NOT NULL,
  "maskedSuffix" TEXT,
  "fingerprint" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "activatedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "graceExpiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "revokeReason" TEXT,
  "createdBy" TEXT,
  "rotatedFromId" TEXT,
  "lastUsedAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "lastFailureAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ManagedCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ManagedCredential_familyId_version_key"
  ON "ManagedCredential"("familyId", "version");

CREATE INDEX IF NOT EXISTS "ManagedCredential_organizationId_purpose_status_idx"
  ON "ManagedCredential"("organizationId", "purpose", "status");

CREATE INDEX IF NOT EXISTS "ManagedCredential_connectionId_status_idx"
  ON "ManagedCredential"("connectionId", "status");

CREATE INDEX IF NOT EXISTS "ManagedCredential_projectId_purpose_status_idx"
  ON "ManagedCredential"("projectId", "purpose", "status");

CREATE INDEX IF NOT EXISTS "ManagedCredential_familyId_status_idx"
  ON "ManagedCredential"("familyId", "status");

CREATE INDEX IF NOT EXISTS "ManagedCredential_expiresAt_idx"
  ON "ManagedCredential"("expiresAt");

CREATE INDEX IF NOT EXISTS "AuditLog_organizationId_createdAt_idx"
  ON "AuditLog"("organizationId", "createdAt");

CREATE INDEX IF NOT EXISTS "Project_signingCredentialFamilyId_idx"
  ON "Project"("signingCredentialFamilyId");

CREATE INDEX IF NOT EXISTS "Connection_credentialFamilyId_idx"
  ON "Connection"("credentialFamilyId");

CREATE INDEX IF NOT EXISTS "ProjectIntegration_credentialFamilyId_idx"
  ON "ProjectIntegration"("credentialFamilyId");

ALTER TABLE "ManagedCredential"
  ADD CONSTRAINT "ManagedCredential_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ManagedCredential"
  ADD CONSTRAINT "ManagedCredential_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ManagedCredential"
  ADD CONSTRAINT "ManagedCredential_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ManagedCredential"
  ADD CONSTRAINT "ManagedCredential_integrationId_fkey"
  FOREIGN KEY ("integrationId") REFERENCES "ProjectIntegration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ManagedCredential"
  ADD CONSTRAINT "ManagedCredential_rotatedFromId_fkey"
  FOREIGN KEY ("rotatedFromId") REFERENCES "ManagedCredential"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
