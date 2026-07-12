-- Add new ProjectStatus enum values (must be committed before use — separate migration)
ALTER TYPE "ProjectStatus" ADD VALUE IF NOT EXISTS 'UNKNOWN';
ALTER TYPE "ProjectStatus" ADD VALUE IF NOT EXISTS 'MAINTENANCE';
ALTER TYPE "ProjectStatus" ADD VALUE IF NOT EXISTS 'RECOVERING';
