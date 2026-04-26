-- AlterTable: add audit tracking columns to OrgApiKey
ALTER TABLE "OrgApiKey"
  ADD COLUMN "lastUsedRoute"     TEXT,
  ADD COLUMN "lastUsedIp"        TEXT,
  ADD COLUMN "lastUsedUserAgent" TEXT,
  ADD COLUMN "revokeReason"      TEXT;
