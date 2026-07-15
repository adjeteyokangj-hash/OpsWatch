-- Alert recovery / remediation lifecycle (must be committed before use)
ALTER TYPE "AlertStatus" ADD VALUE IF NOT EXISTS 'REMEDIATING';
ALTER TYPE "AlertStatus" ADD VALUE IF NOT EXISTS 'VERIFYING';
ALTER TYPE "AlertStatus" ADD VALUE IF NOT EXISTS 'RECOVERING';
