import { randomUUID } from "crypto";
import type { AutomationPlaybookVersionStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import type { PlaybookSeedStep } from "./automation-playbooks.seed";

export type PlaybookVersionDto = {
  id: string;
  playbookId: string;
  version: number;
  status: AutomationPlaybookVersionStatus;
  submittedById: string | null;
  submittedAt: string | null;
  reviewedById: string | null;
  reviewedAt: string | null;
  reviewReason: string | null;
  approvedAt: string | null;
  deprecatedAt: string | null;
  publishedAt: string;
  steps: Array<{
    stepOrder: number;
    action: string;
    targetServiceKey: string | null;
    approvalRequired: boolean;
    description: string;
  }>;
};

export type PlaybookDto = {
  id: string;
  key: string;
  name: string;
  description: string;
  riskLevel: string;
  isActive: boolean;
  versions: PlaybookVersionDto[];
  latestApprovedVersion: number | null;
};

const mapVersion = (row: {
  id: string;
  playbookId: string;
  version: number;
  status: AutomationPlaybookVersionStatus;
  submittedById: string | null;
  submittedAt: Date | null;
  reviewedById: string | null;
  reviewedAt: Date | null;
  reviewReason: string | null;
  approvedAt: Date | null;
  deprecatedAt: Date | null;
  publishedAt: Date;
  Steps: Array<{
    stepOrder: number;
    action: string;
    targetServiceKey: string | null;
    approvalRequired: boolean;
    description: string;
  }>;
}): PlaybookVersionDto => ({
  id: row.id,
  playbookId: row.playbookId,
  version: row.version,
  status: row.status,
  submittedById: row.submittedById,
  submittedAt: row.submittedAt?.toISOString() ?? null,
  reviewedById: row.reviewedById,
  reviewedAt: row.reviewedAt?.toISOString() ?? null,
  reviewReason: row.reviewReason,
  approvedAt: row.approvedAt?.toISOString() ?? null,
  deprecatedAt: row.deprecatedAt?.toISOString() ?? null,
  publishedAt: row.publishedAt.toISOString(),
  steps: row.Steps.map((step) => ({
    stepOrder: step.stepOrder,
    action: step.action,
    targetServiceKey: step.targetServiceKey,
    approvalRequired: step.approvalRequired,
    description: step.description
  }))
});

export const listPlaybooksWithGovernance = async (): Promise<PlaybookDto[]> => {
  const rows = await prisma.automationPlaybook.findMany({
    include: {
      Versions: {
        include: { Steps: { orderBy: { stepOrder: "asc" } } },
        orderBy: { version: "desc" }
      }
    },
    orderBy: { name: "asc" }
  });

  return rows.map((row) => {
    const latestApproved = row.Versions.find((version) => version.status === "APPROVED");
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description,
      riskLevel: row.riskLevel,
      isActive: row.isActive,
      versions: row.Versions.map(mapVersion),
      latestApprovedVersion: latestApproved?.version ?? null
    };
  });
};

export const resolveLatestApprovedVersion = async (playbookKey: string) => {
  const playbook = await prisma.automationPlaybook.findUnique({
    where: { key: playbookKey },
    include: {
      Versions: {
        where: { status: "APPROVED" },
        orderBy: { version: "desc" },
        take: 1,
        include: { Steps: { orderBy: { stepOrder: "asc" } } }
      }
    }
  });
  if (!playbook?.Versions[0]) return null;
  return { playbook, version: playbook.Versions[0] };
};

export const createPlaybookDraftVersion = async (input: {
  playbookKey: string;
  steps: PlaybookSeedStep[];
  createdById: string;
}): Promise<PlaybookVersionDto> => {
  const playbook = await prisma.automationPlaybook.findUnique({ where: { key: input.playbookKey } });
  if (!playbook) throw new Error("Playbook not found");

  const latest = await prisma.automationPlaybookVersion.findFirst({
    where: { playbookId: playbook.id },
    orderBy: { version: "desc" }
  });
  const nextVersion = (latest?.version ?? 0) + 1;
  const versionId = randomUUID();
  const now = new Date();

  const row = await prisma.automationPlaybookVersion.create({
    data: {
      id: versionId,
      playbookId: playbook.id,
      version: nextVersion,
      status: "DRAFT",
      definitionJson: { steps: input.steps },
      publishedAt: now,
      publishedBy: input.createdById,
      Steps: {
        create: input.steps.map((step) => ({
          id: randomUUID(),
          stepOrder: step.order,
          action: step.action,
          targetServiceKey: step.targetServiceKey ?? null,
          approvalRequired: step.approvalRequired,
          description: step.description
        }))
      }
    },
    include: { Steps: { orderBy: { stepOrder: "asc" } } }
  });

  return mapVersion(row);
};

export const submitPlaybookVersionForReview = async (input: {
  playbookKey: string;
  version: number;
  submittedById: string;
}): Promise<PlaybookVersionDto> => {
  const version = await loadVersionOrThrow(input.playbookKey, input.version);
  if (version.status !== "DRAFT" && version.status !== "REJECTED") {
    throw new Error("Only draft or rejected versions can be submitted for review");
  }

  const updated = await prisma.automationPlaybookVersion.update({
    where: { id: version.id },
    data: {
      status: "IN_REVIEW",
      submittedById: input.submittedById,
      submittedAt: new Date(),
      reviewedById: null,
      reviewedAt: null,
      reviewReason: null
    },
    include: { Steps: { orderBy: { stepOrder: "asc" } } }
  });
  return mapVersion(updated);
};

export const reviewPlaybookVersion = async (input: {
  playbookKey: string;
  version: number;
  decision: "APPROVED" | "REJECTED";
  reviewedById: string;
  reason: string;
}): Promise<PlaybookVersionDto> => {
  const version = await loadVersionOrThrow(input.playbookKey, input.version);
  if (version.status !== "IN_REVIEW") {
    throw new Error("Only versions in review can be approved or rejected");
  }
  if (!input.reason.trim()) throw new Error("reason is required");

  const now = new Date();
  if (input.decision === "APPROVED") {
    await prisma.$transaction([
      prisma.automationPlaybookVersion.updateMany({
        where: { playbookId: version.playbookId, status: "APPROVED" },
        data: { status: "DEPRECATED", deprecatedAt: now }
      }),
      prisma.automationPlaybookVersion.update({
        where: { id: version.id },
        data: {
          status: "APPROVED",
          reviewedById: input.reviewedById,
          reviewedAt: now,
          reviewReason: input.reason.trim(),
          approvedAt: now
        }
      })
    ]);
  } else {
    await prisma.automationPlaybookVersion.update({
      where: { id: version.id },
      data: {
        status: "REJECTED",
        reviewedById: input.reviewedById,
        reviewedAt: now,
        reviewReason: input.reason.trim()
      }
    });
  }

  const updated = await prisma.automationPlaybookVersion.findUniqueOrThrow({
    where: { id: version.id },
    include: { Steps: { orderBy: { stepOrder: "asc" } } }
  });
  return mapVersion(updated);
};

export const deprecatePlaybookVersion = async (input: {
  playbookKey: string;
  version: number;
}): Promise<PlaybookVersionDto> => {
  const version = await loadVersionOrThrow(input.playbookKey, input.version);
  if (version.status !== "APPROVED") {
    throw new Error("Only approved versions can be deprecated");
  }

  const updated = await prisma.automationPlaybookVersion.update({
    where: { id: version.id },
    data: { status: "DEPRECATED", deprecatedAt: new Date() },
    include: { Steps: { orderBy: { stepOrder: "asc" } } }
  });
  return mapVersion(updated);
};

const loadVersionOrThrow = async (playbookKey: string, versionNumber: number) => {
  const playbook = await prisma.automationPlaybook.findUnique({ where: { key: playbookKey } });
  if (!playbook) throw new Error("Playbook not found");
  const version = await prisma.automationPlaybookVersion.findFirst({
    where: { playbookId: playbook.id, version: versionNumber }
  });
  if (!version) throw new Error("Playbook version not found");
  return { ...version, playbookId: playbook.id };
};
