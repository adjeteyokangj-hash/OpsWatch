import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";
import type { SecurityRiskState } from "./security-scopes";

export const upsertSecurityAssetRisk = async (args: {
  organizationId: string;
  projectId?: string | null;
  entityId?: string | null;
  relationshipId?: string | null;
  riskState: SecurityRiskState;
  findingIds?: string[];
  sequenceIds?: string[];
  evidenceLevel?: string;
  summary?: string;
}) => {
  if (!args.entityId && !args.relationshipId) return null;
  const now = new Date();

  if (args.entityId) {
    const existing = await prisma.securityAssetRisk.findUnique({
      where: {
        organizationId_entityId: {
          organizationId: args.organizationId,
          entityId: args.entityId
        }
      }
    });
    if (existing) {
      return prisma.securityAssetRisk.update({
        where: { id: existing.id },
        data: {
          riskState: args.riskState,
          findingIdsJson: args.findingIds || existing.findingIdsJson,
          sequenceIdsJson: args.sequenceIds || existing.sequenceIdsJson,
          evidenceLevel: args.evidenceLevel || existing.evidenceLevel,
          summary: args.summary || existing.summary,
          projectId: args.projectId ?? existing.projectId,
          updatedAt: now
        }
      });
    }
    return prisma.securityAssetRisk.create({
      data: {
        id: randomUUID(),
        organizationId: args.organizationId,
        projectId: args.projectId ?? null,
        entityId: args.entityId,
        relationshipId: null,
        riskState: args.riskState,
        findingIdsJson: args.findingIds || [],
        sequenceIdsJson: args.sequenceIds || [],
        evidenceLevel: args.evidenceLevel || "SUSPECTED",
        summary: args.summary || null,
        updatedAt: now
      }
    });
  }

  const existingRel = await prisma.securityAssetRisk.findUnique({
    where: {
      organizationId_relationshipId: {
        organizationId: args.organizationId,
        relationshipId: args.relationshipId!
      }
    }
  });
  if (existingRel) {
    return prisma.securityAssetRisk.update({
      where: { id: existingRel.id },
      data: {
        riskState: args.riskState,
        findingIdsJson: args.findingIds || existingRel.findingIdsJson,
        sequenceIdsJson: args.sequenceIds || existingRel.sequenceIdsJson,
        evidenceLevel: args.evidenceLevel || existingRel.evidenceLevel,
        summary: args.summary || existingRel.summary,
        updatedAt: now
      }
    });
  }
  return prisma.securityAssetRisk.create({
    data: {
      id: randomUUID(),
      organizationId: args.organizationId,
      projectId: args.projectId ?? null,
      entityId: null,
      relationshipId: args.relationshipId!,
      riskState: args.riskState,
      findingIdsJson: args.findingIds || [],
      sequenceIdsJson: args.sequenceIds || [],
      evidenceLevel: args.evidenceLevel || "SUSPECTED",
      summary: args.summary || null,
      updatedAt: now
    }
  });
};

export const syncSecurityTopologyOverlay = async (args: {
  organizationId: string;
  projectId?: string | null;
}) => {
  const findings = await prisma.securityFinding.findMany({
    where: {
      organizationId: args.organizationId,
      ...(args.projectId ? { projectId: args.projectId } : {}),
      state: { in: ["OPEN", "INVESTIGATING", "CONTAINING", "MONITORING"] },
      affectedEntityId: { not: null }
    },
    take: 500
  });

  const byEntity = new Map<string, typeof findings>();
  for (const finding of findings) {
    if (!finding.affectedEntityId) continue;
    const list = byEntity.get(finding.affectedEntityId) || [];
    list.push(finding);
    byEntity.set(finding.affectedEntityId, list);
  }

  const risks = [];
  for (const [entityId, entityFindings] of byEntity) {
    const severities = entityFindings.map((finding) => finding.severity);
    let riskState: SecurityRiskState = "ELEVATED_RISK";
    if (severities.includes("CRITICAL")) riskState = "ACTIVE_SUSPICIOUS";
    else if (entityFindings.some((finding) => finding.state === "CONTAINING")) {
      riskState = "CONFIRMED_COMPROMISED";
    } else if (severities.every((severity) => severity === "LOW" || severity === "INFO")) {
      riskState = "ELEVATED_RISK";
    }

    const risk = await upsertSecurityAssetRisk({
      organizationId: args.organizationId,
      projectId: args.projectId,
      entityId,
      riskState,
      findingIds: entityFindings.map((finding) => finding.id),
      evidenceLevel: riskState === "CONFIRMED_COMPROMISED" ? "CONFIRMED" : "SUSPECTED",
      summary: `${entityFindings.length} active security finding(s)`
    });
    if (risk) risks.push(risk);
  }

  return { risks };
};

export const getSecurityTopologyOverlay = async (args: {
  organizationId: string;
  projectId?: string;
}) => {
  const risks = await prisma.securityAssetRisk.findMany({
    where: {
      organizationId: args.organizationId,
      ...(args.projectId ? { projectId: args.projectId } : {})
    },
    orderBy: { updatedAt: "desc" },
    take: 500
  });

  return {
    overlay: "SECURITY",
    note: "Security state is a separate overlay and does not overwrite operational health.",
    assets: risks.map((risk) => ({
      id: risk.id,
      entityId: risk.entityId,
      relationshipId: risk.relationshipId,
      riskState: risk.riskState,
      evidenceLevel: risk.evidenceLevel,
      summary: risk.summary,
      // Accessible text indicator (not colour alone)
      indicator:
        risk.riskState === "NORMAL"
          ? "Normal"
          : risk.riskState === "ELEVATED_RISK"
            ? "Elevated risk"
            : risk.riskState === "ACTIVE_SUSPICIOUS"
              ? "Active suspicious activity"
              : risk.riskState === "CONFIRMED_COMPROMISED"
                ? "Confirmed compromised"
                : "Unknown"
    }))
  };
};
