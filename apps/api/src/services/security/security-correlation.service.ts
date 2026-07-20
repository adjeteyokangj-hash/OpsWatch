import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";

type SequenceStep = {
  eventType: string;
  findingRuleKey?: string;
  at: string;
  securityEventId?: string;
  findingId?: string;
  evidenceLevel: "CONFIRMED" | "SUSPECTED" | "POSSIBLE" | "INSUFFICIENT_EVIDENCE";
};

const SEQUENCE_DEFS = [
  {
    sequenceType: "identity_compromise_chain",
    steps: ["LOGIN_FAILED", "LOGIN_SUCCEEDED", "ROLE_CHANGED", "API_KEY_CREATED", "SENSITIVE_SETTING_CHANGED"],
    recommendedContainment: "Revoke sessions/keys where supported; open security incident; increase monitoring."
  },
  {
    sequenceType: "integration_abuse_chain",
    steps: ["INVALID_SIGNATURE", "INTEGRATION_AUTH_FAILED", "RATE_LIMIT_EXCEEDED"],
    recommendedContainment: "Disable compromised test integration; quarantine rejected webhooks; rotate secrets."
  },
  {
    sequenceType: "exposure_after_change",
    steps: ["SECURITY_HEADER_REMOVED", "ADMIN_URL_EXPOSED", "ADMIN_ROUTE_ACCESSED"],
    recommendedContainment: "Verify recent deployment/change; close exposed endpoints; open security incident."
  }
] as const;

export const correlateThreatSequences = async (args: {
  organizationId: string;
  projectId?: string | null;
  lookbackMs?: number;
}) => {
  const since = new Date(Date.now() - (args.lookbackMs ?? 6 * 60 * 60 * 1000));
  const events = await prisma.securityEvent.findMany({
    where: {
      organizationId: args.organizationId,
      timestamp: { gte: since },
      ...(args.projectId ? { projectId: args.projectId } : {})
    },
    orderBy: { timestamp: "asc" },
    take: 2000
  });

  const findings = await prisma.securityFinding.findMany({
    where: {
      organizationId: args.organizationId,
      lastSeenAt: { gte: since },
      ...(args.projectId ? { projectId: args.projectId } : {}),
      state: { in: ["OPEN", "INVESTIGATING", "CONTAINING", "MONITORING"] }
    }
  });

  const created = [];
  for (const def of SEQUENCE_DEFS) {
    const ordered: SequenceStep[] = [];
    let stepIndex = 0;
    for (const event of events) {
      const expected = def.steps[stepIndex];
      if (!expected) break;
      if (event.eventType === expected || (expected === "ROLE_CHANGED" && event.eventType === "PRIVILEGE_GRANTED")) {
        ordered.push({
          eventType: event.eventType,
          at: event.timestamp.toISOString(),
          securityEventId: event.id,
          evidenceLevel: "CONFIRMED"
        });
        stepIndex += 1;
      }
    }

    // Require at least 2 ordered steps to avoid false correlation.
    if (ordered.length < 2) continue;
    // Require shared org already; prefer shared account/ip/entity when present.
    const relatedFindingIds = findings
      .filter((finding) =>
        def.steps.some((step) => finding.ruleKey.includes(step.toLowerCase().split("_")[0] || "")) ||
        ordered.some((step) => finding.matchedEvidenceJson && JSON.stringify(finding.matchedEvidenceJson).includes(step.eventType))
      )
      .map((finding) => finding.id);

    const confidence = Math.min(0.95, 0.4 + ordered.length * 0.12);
    const evidenceLevel =
      ordered.length >= def.steps.length
        ? "SUSPECTED"
        : ordered.length >= 3
          ? "POSSIBLE"
          : "INSUFFICIENT_EVIDENCE";

    // Do not claim causation — sequences are evidence-ordered correlations.
    const now = new Date();
    const sequence = await prisma.threatCorrelationSequence.create({
      data: {
        id: randomUUID(),
        organizationId: args.organizationId,
        projectId: args.projectId ?? events[0]?.projectId ?? null,
        environment: events[0]?.environment || "unknown",
        sequenceType: def.sequenceType,
        confidence,
        stage: ordered.length >= def.steps.length ? "ACTIVE" : "PARTIAL",
        status: "OPEN",
        orderedEvidenceJson: ordered,
        affectedAssetIdsJson: {
          entityIds: [...new Set(events.map((event) => event.entityId).filter(Boolean))],
          findingIds: relatedFindingIds
        },
        likelyEntryPoint: ordered[0]?.eventType || null,
        recommendedContainment: def.recommendedContainment,
        entityId: events.find((event) => event.entityId)?.entityId || null,
        relatedFindingIdsJson: relatedFindingIds,
        evidenceLevel,
        firstSeenAt: new Date(ordered[0].at),
        lastSeenAt: new Date(ordered[ordered.length - 1].at),
        updatedAt: now
      }
    });
    created.push(sequence);
  }

  return { sequences: created };
};

export const buildAttackPathView = async (args: {
  organizationId: string;
  sequenceId: string;
}) => {
  const sequence = await prisma.threatCorrelationSequence.findFirst({
    where: { id: args.sequenceId, organizationId: args.organizationId }
  });
  if (!sequence) return null;

  const ordered = (sequence.orderedEvidenceJson as SequenceStep[]) || [];
  const entityId = sequence.entityId;

  // Only use existing topology ids — never fabricate edges.
  let relationships: Array<{ id: string; sourceEntityId: string; targetEntityId: string }> = [];
  if (entityId) {
    relationships = await prisma.operationalRelationship.findMany({
      where: {
        organizationId: args.organizationId,
        OR: [{ sourceEntityId: entityId }, { targetEntityId: entityId }]
      },
      select: { id: true, sourceEntityId: true, targetEntityId: true },
      take: 50
    });
  }

  return {
    sequenceId: sequence.id,
    sequenceType: sequence.sequenceType,
    evidenceLevel: sequence.evidenceLevel,
    confidence: sequence.confidence,
    suspectedEntryPoint: sequence.likelyEntryPoint,
    currentStage: sequence.stage,
    recommendedContainment: sequence.recommendedContainment,
    nodes: ordered.map((step, index) => ({
      order: index + 1,
      label: step.eventType,
      evidenceLevel: step.evidenceLevel,
      at: step.at,
      securityEventId: step.securityEventId || null,
      findingId: step.findingId || null
    })),
    topology: {
      entityId: entityId || null,
      relationships: relationships.map((rel) => ({
        id: rel.id,
        sourceEntityId: rel.sourceEntityId,
        targetEntityId: rel.targetEntityId,
        evidenceLevel: entityId ? "SUSPECTED" : "INSUFFICIENT_EVIDENCE"
      })),
      note: relationships.length
        ? "Relationships shown exist in canonical topology; linkage to attack is suspected from evidence proximity."
        : "Insufficient topology evidence to draw attack-path edges."
    }
  };
};
