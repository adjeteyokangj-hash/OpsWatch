import { randomUUID } from "crypto";
import type { ProjectStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";

const RECOVERY_REASON_VERIFYING = "Remediation completed; awaiting verification checks";
const RECOVERY_REASON_VERIFIED = "Recovery verified by required checks";
const RECOVERY_REASON_FAILED = "Remediation verification failed";

export const enterProjectRecovering = async (input: {
  projectId: string;
  incidentId: string;
  runId: string;
  previousStatus?: ProjectStatus;
}): Promise<void> => {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { status: true, healthReason: true }
  });
  if (!project) return;
  if (project.status === "RECOVERING") return;

  await prisma.project.update({
    where: { id: input.projectId },
    data: {
      status: "RECOVERING",
      healthReason: RECOVERY_REASON_VERIFYING,
      healthSource: "automation-recovery",
      updatedAt: new Date()
    }
  });

  await prisma.incidentTimelineEvent.create({
    data: {
      id: randomUUID(),
      incidentId: input.incidentId,
      projectId: input.projectId,
      eventType: "RECOVERY",
      summary: "Project entered RECOVERING while automation verifies the repair.",
      sourceType: "AUTOMATION_RUN",
      sourceId: input.runId,
      payloadJson: {
        phase: "VERIFYING",
        previousStatus: input.previousStatus ?? project.status,
        runId: input.runId
      }
    }
  });
};

export const completeProjectRecovery = async (input: {
  projectId: string;
  incidentId: string;
  runId: string;
}): Promise<void> => {
  await prisma.project.update({
    where: { id: input.projectId },
    data: {
      status: "HEALTHY",
      healthReason: RECOVERY_REASON_VERIFIED,
      healthSource: "automation-recovery",
      updatedAt: new Date()
    }
  });

  await prisma.incidentTimelineEvent.create({
    data: {
      id: randomUUID(),
      incidentId: input.incidentId,
      projectId: input.projectId,
      eventType: "RECOVERY",
      summary: "Recovery verification passed; project marked HEALTHY.",
      sourceType: "AUTOMATION_RUN",
      sourceId: input.runId,
      payloadJson: { phase: "VERIFIED", runId: input.runId }
    }
  });
};

export const failProjectRecovery = async (input: {
  projectId: string;
  incidentId: string;
  runId: string;
  fallbackStatus?: "DOWN" | "DEGRADED";
}): Promise<void> => {
  const fallback = input.fallbackStatus ?? "DEGRADED";
  await prisma.project.update({
    where: { id: input.projectId },
    data: {
      status: fallback,
      healthReason: RECOVERY_REASON_FAILED,
      healthSource: "automation-recovery",
      updatedAt: new Date()
    }
  });

  await prisma.incidentTimelineEvent.create({
    data: {
      id: randomUUID(),
      incidentId: input.incidentId,
      projectId: input.projectId,
      eventType: "RECOVERY",
      summary: `Recovery verification failed; project marked ${fallback}.`,
      sourceType: "AUTOMATION_RUN",
      sourceId: input.runId,
      payloadJson: { phase: "VERIFICATION_FAILED", runId: input.runId, status: fallback }
    }
  });
};

export const hasActiveVerificationRun = async (projectId: string): Promise<boolean> => {
  const run = await prisma.automationRun.findFirst({
    where: {
      projectId,
      status: { in: ["EXECUTING", "VERIFYING", "APPROVED"] },
      Steps: { some: { status: "VERIFYING" } }
    },
    select: { id: true }
  });
  return Boolean(run);
};
