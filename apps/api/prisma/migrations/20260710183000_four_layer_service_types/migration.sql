-- Preserve existing four-layer monitored areas and make Prisma aware of them.
ALTER TYPE "ServiceType" ADD VALUE IF NOT EXISTS 'APP';
ALTER TYPE "ServiceType" ADD VALUE IF NOT EXISTS 'MODULE';
ALTER TYPE "ServiceType" ADD VALUE IF NOT EXISTS 'WORKFLOW';
ALTER TYPE "ServiceType" ADD VALUE IF NOT EXISTS 'COMPONENT';
