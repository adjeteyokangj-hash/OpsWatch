import { prisma } from "../../lib/prisma";
import { DEFAULT_SECURITY_RETENTION_DAYS } from "./security-scopes";

const resolveDays = async (organizationId: string, dataClass: string): Promise<number> => {
  const policy = await prisma.retentionPolicy.findUnique({
    where: { organizationId_dataClass: { organizationId, dataClass } }
  });
  return policy?.retentionDays && policy.retentionDays > 0
    ? policy.retentionDays
    : DEFAULT_SECURITY_RETENTION_DAYS;
};

/**
 * Prune expired raw security events while preserving finding/incident summaries.
 */
export const pruneSecurityDataForOrg = async (organizationId: string) => {
  const now = new Date();
  const eventDays = await resolveDays(organizationId, "SECURITY_EVENTS");
  const findingDays = await resolveDays(organizationId, "SECURITY_FINDINGS");
  const sequenceDays = await resolveDays(organizationId, "SECURITY_SEQUENCES");

  // Preserve events linked to findings or incident evidence.
  const linkedEventIds = new Set<string>();
  const occurrences = await prisma.securityFindingOccurrence.findMany({
    where: { organizationId, securityEventId: { not: null } },
    select: { securityEventId: true },
    take: 20_000
  });
  for (const row of occurrences) {
    if (row.securityEventId) linkedEventIds.add(row.securityEventId);
  }
  const incidentEvidence = await prisma.securityIncidentEvidence.findMany({
    where: { organizationId, securityEventId: { not: null } },
    select: { securityEventId: true },
    take: 20_000
  });
  for (const row of incidentEvidence) {
    if (row.securityEventId) linkedEventIds.add(row.securityEventId);
  }

  const expiredEvents = await prisma.securityEvent.findMany({
    where: {
      organizationId,
      OR: [{ retentionExpiresAt: { lte: now } }, { timestamp: { lte: new Date(now.getTime() - eventDays * 86400000) } }]
    },
    select: { id: true },
    take: 5000
  });

  const deletable = expiredEvents.filter((event) => !linkedEventIds.has(event.id)).map((event) => event.id);
  let deletedEvents = 0;
  if (deletable.length > 0) {
    const result = await prisma.securityEvent.deleteMany({
      where: { id: { in: deletable }, organizationId }
    });
    deletedEvents = result.count;
  }

  // Findings: expire only RESOLVED/FALSE_POSITIVE/SUPPRESSED past retention; keep summaries on open.
  const expiredFindings = await prisma.securityFinding.deleteMany({
    where: {
      organizationId,
      state: { in: ["RESOLVED", "FALSE_POSITIVE", "SUPPRESSED"] },
      OR: [
        { retentionExpiresAt: { lte: now } },
        { lastSeenAt: { lte: new Date(now.getTime() - findingDays * 86400000) } }
      ]
    }
  });

  const expiredSequences = await prisma.threatCorrelationSequence.deleteMany({
    where: {
      organizationId,
      status: { in: ["RESOLVED", "CLOSED"] },
      OR: [
        { retentionExpiresAt: { lte: now } },
        { lastSeenAt: { lte: new Date(now.getTime() - sequenceDays * 86400000) } }
      ]
    }
  });

  return {
    deletedEvents,
    deletedFindings: expiredFindings.count,
    deletedSequences: expiredSequences.count,
    preservedLinkedEvents: linkedEventIds.size
  };
};
