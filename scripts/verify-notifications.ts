import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { runHttpChecksJob } from "../apps/worker/src/jobs/run-http-checks.job";

const prisma = new PrismaClient();

const webhookTarget = process.env.NOTIFY_WEBHOOK_TARGET || "http://localhost:4011/opswatch-webhook";
const outputPath = process.env.NOTIFY_WEBHOOK_OUTPUT || path.join(process.cwd(), "tmp", "notification-events.jsonl");

const ensureWebhookChannel = async (projectId: string): Promise<void> => {
  const existing = await prisma.notificationChannel.findFirst({
    where: {
      projectId,
      type: "WEBHOOK",
      target: webhookTarget,
      isActive: true
    }
  });

  if (existing) {
    return;
  }

  await prisma.notificationChannel.create({
    data: {
      projectId,
      type: "WEBHOOK",
      name: "Verification Webhook",
      target: webhookTarget,
      isDefault: false,
      isActive: true
    }
  });
};

const ensureCheckForOutage = async (serviceId: string) => {
  const existing = await prisma.check.findFirst({
    where: { serviceId, name: "Notification Verification Check" }
  });

  const data = {
    serviceId,
    name: "Notification Verification Check",
    type: "HTTP" as const,
    intervalSeconds: 60,
    timeoutMs: 3000,
    expectedStatusCode: 503,
    failureThreshold: 1,
    recoveryThreshold: 1,
    isActive: true
  };

  if (existing) {
    return prisma.check.update({ where: { id: existing.id }, data });
  }

  return prisma.check.create({ data });
};

const cleanupNotificationCheck = async (checkId: string): Promise<void> => {
  await prisma.alert.deleteMany({ where: { sourceId: checkId } });
  await prisma.checkResult.deleteMany({ where: { checkId } });
  await prisma.check.delete({ where: { id: checkId } });
};

const readReasons = (): string[] => {
  if (!fs.existsSync(outputPath)) {
    return [];
  }

  const lines = fs
    .readFileSync(outputPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const reasons: string[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as { body?: { alert?: { reason?: string } } };
      const reason = parsed.body?.alert?.reason;
      if (reason) {
        reasons.push(reason);
      }
    } catch {
      // Ignore malformed lines
    }
  }
  return reasons;
};

const assertHasReason = (reasons: string[], reason: string): void => {
  if (!reasons.includes(reason)) {
    throw new Error(`Expected webhook notification reason '${reason}' in ${outputPath}`);
  }
};

const main = async (): Promise<void> => {
  const project = await prisma.project.findUnique({ where: { slug: "sparkle" } });
  if (!project) {
    throw new Error("Project 'sparkle' not found. Run seed first.");
  }

  const service = await prisma.service.findFirst({ where: { projectId: project.id } });
  if (!service) {
    throw new Error("No service found for project 'sparkle'.");
  }

  await ensureWebhookChannel(project.id);
  const check = await ensureCheckForOutage(service.id);

  await runHttpChecksJob();

  await new Promise((resolve) => setTimeout(resolve, 1200));

  await prisma.check.update({
    where: { id: check.id },
    data: { expectedStatusCode: 200 }
  });

  await runHttpChecksJob();

  await new Promise((resolve) => setTimeout(resolve, 1200));

  const reasons = readReasons();
  assertHasReason(reasons, "triggered");
  assertHasReason(reasons, "resolved");

  await cleanupNotificationCheck(check.id);

  console.log("NOTIFICATIONS_E2E_OK");
  console.log(`Reasons observed: ${Array.from(new Set(reasons)).join(", ")}`);
};

void main()
  .catch((error) => {
    console.error("NOTIFICATIONS_E2E_FAILED", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
