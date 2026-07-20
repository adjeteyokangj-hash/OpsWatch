import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";
import { syncSecurityTopologyOverlay } from "./security-topology-overlay.service";

export const attachFindingToSecurityIncident = async (args: {
  organizationId: string;
  findingId: string;
  actorUserId?: string;
}) => {
  const finding = await prisma.securityFinding.findFirst({
    where: { id: args.findingId, organizationId: args.organizationId }
  });
  if (!finding || !finding.projectId) return null;
  if (!["HIGH", "CRITICAL"].includes(finding.severity)) return null;
  if (["SUPPRESSED", "FALSE_POSITIVE", "ACCEPTED_RISK", "RESOLVED"].includes(finding.state)) {
    return null;
  }

  // Prefer attaching to an existing open security-classified incident for the same project.
  let incident = await prisma.incident.findFirst({
    where: {
      projectId: finding.projectId,
      classification: "SECURITY",
      status: { in: ["OPEN", "INVESTIGATING", "MONITORING"] }
    },
    orderBy: { openedAt: "desc" }
  });

  if (!incident) {
    // Optionally attach to open operational incident with same root entity.
    if (finding.affectedEntityId) {
      incident = await prisma.incident.findFirst({
        where: {
          projectId: finding.projectId,
          status: { in: ["OPEN", "INVESTIGATING", "MONITORING"] },
          rootCauseEntityId: finding.affectedEntityId
        },
        orderBy: { openedAt: "desc" }
      });
    }
  }

  if (!incident) {
    incident = await prisma.incident.create({
      data: {
        id: randomUUID(),
        projectId: finding.projectId,
        title: `Security: ${finding.ruleName}`,
        severity: finding.severity as "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
        status: "OPEN",
        classification: "SECURITY",
        securitySeverity: finding.severity,
        fingerprint: `security:${finding.fingerprint}`,
        rootCauseEntityId: finding.affectedEntityId,
        rootCauseRelationshipId: finding.affectedRelationshipId
      }
    });
  } else if (incident.classification !== "SECURITY") {
    incident = await prisma.incident.update({
      where: { id: incident.id },
      data: {
        classification: incident.classification || "SECURITY",
        securitySeverity: finding.severity
      }
    });
  }

  await prisma.securityIncidentEvidence.create({
    data: {
      id: randomUUID(),
      organizationId: args.organizationId,
      incidentId: incident.id,
      findingId: finding.id,
      evidenceKind: "SECURITY_FINDING",
      summary: `${finding.ruleName} (${finding.severity}) — ${finding.occurrenceCount} occurrence(s)`,
      confidence: finding.confidence,
      evidenceLevel: finding.confidence >= 0.8 ? "CONFIRMED" : "SUSPECTED",
      metadataJson: {
        ruleKey: finding.ruleKey,
        ruleVersion: finding.ruleVersion,
        recommendedResponse: finding.recommendedResponse
      }
    }
  });

  await prisma.securityFinding.update({
    where: { id: finding.id },
    data: {
      relatedIncidentId: incident.id,
      updatedAt: new Date()
    }
  });

  await prisma.incidentTimelineEvent.create({
    data: {
      id: randomUUID(),
      incidentId: incident.id,
      projectId: finding.projectId,
      eventType: "SECURITY_FINDING_ATTACHED",
      summary: `Security finding attached: ${finding.ruleName}`,
      sourceType: "SecurityFinding",
      sourceId: finding.id,
      severity: finding.severity as "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
      payloadJson: {
        findingId: finding.id,
        ruleKey: finding.ruleKey
      }
    }
  });

  await syncSecurityTopologyOverlay({
    organizationId: args.organizationId,
    projectId: finding.projectId
  });

  return incident;
};

export const promoteOpenFindingsToIncidents = async (args: {
  organizationId: string;
  projectId?: string | null;
}) => {
  const findings = await prisma.securityFinding.findMany({
    where: {
      organizationId: args.organizationId,
      ...(args.projectId ? { projectId: args.projectId } : {}),
      state: { in: ["OPEN", "INVESTIGATING"] },
      severity: { in: ["HIGH", "CRITICAL"] },
      relatedIncidentId: null
    },
    take: 50
  });

  const incidents = [];
  for (const finding of findings) {
    const incident = await attachFindingToSecurityIncident({
      organizationId: args.organizationId,
      findingId: finding.id
    });
    if (incident) incidents.push(incident);
  }
  return { incidents };
};
