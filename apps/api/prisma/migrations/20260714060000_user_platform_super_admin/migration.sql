-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isPlatformSuperAdmin" BOOLEAN NOT NULL DEFAULT false;

-- Ensure builtin platform operator is marked in DB for UI grants
UPDATE "User"
SET "isPlatformSuperAdmin" = true
WHERE lower("email") = 'admin@okanggroup.com';
