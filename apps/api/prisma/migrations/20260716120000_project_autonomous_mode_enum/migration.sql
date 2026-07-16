-- Expand project autonomous mode vocabulary (stored as text; legacy values remain valid).
-- New default for projects: MONITOR_ONLY (equivalent to legacy OBSERVE).
ALTER TABLE "Project" ALTER COLUMN "automationMode" SET DEFAULT 'MONITOR_ONLY';

UPDATE "Project" SET "automationMode" = 'MONITOR_ONLY' WHERE "automationMode" = 'OBSERVE';
UPDATE "Project" SET "automationMode" = 'RECOMMEND' WHERE "automationMode" = 'APPROVAL';
UPDATE "Project" SET "automationMode" = 'FULL_AUTONOMOUS' WHERE "automationMode" = 'AUTONOMOUS';
