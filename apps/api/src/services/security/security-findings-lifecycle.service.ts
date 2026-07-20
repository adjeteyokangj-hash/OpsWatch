import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";

export const markFindingFalsePositive = async (args: {
  organizationId: string;
  findingId: string;
  actorUserId?: string;
  reason: string;
}) => {
  const finding = await prisma.securityFinding.findFirst({
    where: { id: args.findingId, organizationId: args.organizationId }
  });
  if (!finding) return null;

  const updated = await prisma.securityFinding.update({
    where: { id: finding.id },
    data: {
      state: "FALSE_POSITIVE",
      falsePositiveReason: args.reason.slice(0, 1000),
      updatedAt: new Date()
    }
  });

  await prisma.securityEvidenceAccessAudit.create({
    data: {
      id: randomUUID(),
      organizationId: args.organizationId,
      actorUserId: args.actorUserId,
      resourceType: "SecurityFinding",
      resourceId: finding.id,
      action: "FALSE_POSITIVE",
      metadataJson: { reason: args.reason.slice(0, 500) }
    }
  });

  return updated;
};

export const acceptFindingRisk = async (args: {
  organizationId: string;
  findingId: string;
  actorUserId?: string;
  reason: string;
  until?: Date | null;
}) => {
  const finding = await prisma.securityFinding.findFirst({
    where: { id: args.findingId, organizationId: args.organizationId }
  });
  if (!finding) return null;

  if (["CRITICAL", "HIGH"].includes(finding.severity) && !args.until) {
    // High-risk findings should not be permanently accepted without expiry.
    args.until = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  }

  const updated = await prisma.securityFinding.update({
    where: { id: finding.id },
    data: {
      state: "ACCEPTED_RISK",
      acceptedRiskReason: args.reason.slice(0, 1000),
      acceptedRiskUntil: args.until ?? null,
      updatedAt: new Date()
    }
  });

  await prisma.securityEvidenceAccessAudit.create({
    data: {
      id: randomUUID(),
      organizationId: args.organizationId,
      actorUserId: args.actorUserId,
      resourceType: "SecurityFinding",
      resourceId: finding.id,
      action: "ACCEPTED_RISK",
      metadataJson: {
        reason: args.reason.slice(0, 500),
        until: args.until?.toISOString() ?? null
      }
    }
  });

  return updated;
};

export const suppressFinding = async (args: {
  organizationId: string;
  findingId: string;
  actorUserId?: string;
  reason: string;
  until: Date;
}) => {
  const finding = await prisma.securityFinding.findFirst({
    where: { id: args.findingId, organizationId: args.organizationId }
  });
  if (!finding) return null;

  // Suppression must not delete evidence — only change state + expiry.
  const updated = await prisma.securityFinding.update({
    where: { id: finding.id },
    data: {
      state: "SUPPRESSED",
      suppressedUntil: args.until,
      updatedAt: new Date(),
      evidenceSummaryJson: {
        ...((finding.evidenceSummaryJson as object) || {}),
        suppressionReason: args.reason.slice(0, 500)
      }
    }
  });

  await prisma.securityEvidenceAccessAudit.create({
    data: {
      id: randomUUID(),
      organizationId: args.organizationId,
      actorUserId: args.actorUserId,
      resourceType: "SecurityFinding",
      resourceId: finding.id,
      action: "SUPPRESS",
      metadataJson: {
        reason: args.reason.slice(0, 500),
        until: args.until.toISOString()
      }
    }
  });

  return updated;
};
