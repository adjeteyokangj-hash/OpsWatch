-- CreateEnum
CREATE TYPE "IntegrationType" AS ENUM ('WEBHOOK', 'EMAIL', 'STRIPE', 'WORKER_PROVIDER', 'SERVICE_PROVIDER', 'DEPLOYMENT_PROVIDER', 'STATUS_PROVIDER', 'RUNBOOK_PROVIDER');

-- CreateEnum
CREATE TYPE "IntegrationValidationStatus" AS ENUM ('UNKNOWN', 'VALID', 'INVALID');

-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "integrationId" TEXT;

-- CreateTable
CREATE TABLE "ProjectIntegration" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" "IntegrationType" NOT NULL,
    "name" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "configJson" JSONB,
    "secretRef" TEXT,
    "validationStatus" "IntegrationValidationStatus" NOT NULL DEFAULT 'UNKNOWN',
    "validationMessage" TEXT,
    "lastValidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectIntegration_projectId_enabled_idx" ON "ProjectIntegration"("projectId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectIntegration_projectId_type_key" ON "ProjectIntegration"("projectId", "type");

-- AddForeignKey
ALTER TABLE "ProjectIntegration" ADD CONSTRAINT "ProjectIntegration_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
