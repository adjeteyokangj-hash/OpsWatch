-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RemediationStatus" ADD VALUE 'MISSING_CONTEXT';
ALTER TYPE "RemediationStatus" ADD VALUE 'MISCONFIGURED_ENV';

-- AlterTable
ALTER TABLE "RemediationLog" ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "executedAt" TIMESTAMP(3),
ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "serviceId" TEXT;
