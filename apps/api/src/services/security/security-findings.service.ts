import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";

export type ListFindingsArgs = {
  organizationId: string;
  projectId?: string;
  state?: string;
  severity?: string;
  actorUserId?: string;
  limit?: number;
};

export const listSecurityFindings = async (args: ListFindingsArgs) => {
  const findings = await prisma.securityFinding.findMany({
    where: {
      organizationId: args.organizationId,
      ...(args.projectId ? { projectId: args.projectId } : {}),
      ...(args.state ? { state: args.state } : {}),
      ...(args.severity ? { severity: args.severity } : {})
    },
    orderBy: [{ lastSeenAt: "desc" }],
    take: Math.min(args.limit ?? 100, 200)
  });

  if (args.actorUserId) {
    await prisma.securityEvidenceAccessAudit.create({
      data: {
        id: randomUUID(),
        organizationId: args.organizationId,
        actorUserId: args.actorUserId,
        resourceType: "SecurityFindingList",
        resourceId: args.projectId || args.organizationId,
        action: "READ",
        metadataJson: {
          count: findings.length,
          state: args.state ?? null,
          severity: args.severity ?? null
        }
      }
    });
  }

  return findings;
};

export const getSecurityFindingById = async (args: {
  organizationId: string;
  findingId: string;
  actorUserId?: string;
}) => {
  const finding = await prisma.securityFinding.findFirst({
    where: { id: args.findingId, organizationId: args.organizationId },
    include: {
      Occurrences: { orderBy: { occurredAt: "desc" }, take: 50 },
      EvidenceLinks: { orderBy: { observedAt: "desc" }, take: 50 },
      ResponseRuns: { orderBy: { createdAt: "desc" }, take: 20 }
    }
  });

  if (finding && args.actorUserId) {
    await prisma.securityEvidenceAccessAudit.create({
      data: {
        id: randomUUID(),
        organizationId: args.organizationId,
        actorUserId: args.actorUserId,
        resourceType: "SecurityFinding",
        resourceId: finding.id,
        action: "READ"
      }
    });
  }

  return finding;
};
