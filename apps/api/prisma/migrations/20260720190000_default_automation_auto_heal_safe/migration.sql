-- AlterTable: new applications default to Auto-Heal Safe Actions
ALTER TABLE "Project" ALTER COLUMN "automationMode" SET DEFAULT 'AUTO_HEAL_SAFE';