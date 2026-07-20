import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { COVERAGE_DIMENSIONS, type CoverageDepth, type CoverageDimension } from "./security-scopes";

export type CoverageRow = {
  dimension: CoverageDimension;
  status: string;
  depth: CoverageDepth;
  evidence: Record<string, unknown>;
};

export type SecurityCoverageResult = {
  organizationId: string;
  projectId: string | null;
  overallDepth: CoverageDepth;
  dimensions: CoverageRow[];
  honestSummary: string;
};

const depthRank: Record<CoverageDepth, number> = {
  NONE: 0,
  BASIC: 1,
  STANDARD: 2,
  ADVANCED: 3,
  DEEP: 4
};

const maxDepth = (a: CoverageDepth, b: CoverageDepth): CoverageDepth =>
  depthRank[a] >= depthRank[b] ? a : b;

export const computeSecurityCoverage = async (args: {
  organizationId: string;
  projectId?: string;
}): Promise<SecurityCoverageResult> => {
  const { organizationId, projectId } = args;

  const [
    eventCount,
    authEventCount,
    findingCount,
    urlConnectionCount,
    otelConnectionCount,
    responseRunCount,
    coverageRows
  ] = await Promise.all([
    prisma.securityEvent.count({
      where: { organizationId, ...(projectId ? { projectId } : {}) }
    }),
    prisma.securityEvent.count({
      where: {
        organizationId,
        ...(projectId ? { projectId } : {}),
        eventType: { in: ["LOGIN_FAILED", "LOGIN_SUCCEEDED", "MFA_FAILED", "SESSION_CREATED"] }
      }
    }),
    prisma.securityFinding.count({
      where: { organizationId, ...(projectId ? { projectId } : {}) }
    }),
    prisma.connection.count({
      where: {
        organizationId,
        ...(projectId ? { projectId } : {}),
        OR: [
          { type: { contains: "URL", mode: "insensitive" } },
          { type: { contains: "HTTP", mode: "insensitive" } },
          { mode: { contains: "URL", mode: "insensitive" } }
        ]
      }
    }),
    prisma.connection.count({
      where: {
        organizationId,
        ...(projectId ? { projectId } : {}),
        OR: [
          { type: { contains: "OTEL", mode: "insensitive" } },
          { mode: { contains: "OTEL", mode: "insensitive" } }
        ]
      }
    }),
    prisma.securityResponseRun.count({
      where: { organizationId, ...(projectId ? { projectId } : {}) }
    }),
    prisma.securityCoverageState.findMany({
      where: { organizationId, projectId: projectId ?? null }
    })
  ]);

  const byDimension = new Map(coverageRows.map((row) => [row.dimension, row]));

  const build = (
    dimension: CoverageDimension,
    fallback: Omit<CoverageRow, "dimension">
  ): CoverageRow => {
    const existing = byDimension.get(dimension);
    if (existing) {
      return {
        dimension,
        status: existing.status,
        depth: existing.depth as CoverageDepth,
        evidence: (existing.evidenceJson as Record<string, unknown>) || {}
      };
    }
    return { dimension, ...fallback };
  };

  const external =
    urlConnectionCount > 0
      ? build("EXTERNAL_EXPOSURE", {
          status: "PARTIAL",
          depth: "BASIC",
          evidence: { urlConnections: urlConnectionCount, note: "URL/SSL checks only" }
        })
      : build("EXTERNAL_EXPOSURE", {
          status: "NOT_CONFIGURED",
          depth: "NONE",
          evidence: { note: "No public URL monitoring configured" }
        });

  const application =
    eventCount > 0
      ? build("APPLICATION_EVENTS", {
          status: "CONNECTED",
          depth: "STANDARD",
          evidence: { securityEventCount: eventCount }
        })
      : build("APPLICATION_EVENTS", {
          status: "NOT_CONFIGURED",
          depth: "NONE",
          evidence: { note: "No application security events ingested" }
        });

  const authentication =
    authEventCount > 0
      ? build("AUTHENTICATION", {
          status: "CONNECTED",
          depth: "STANDARD",
          evidence: { authEventCount }
        })
      : build("AUTHENTICATION", {
          status: "NOT_CONFIGURED",
          depth: "NONE",
          evidence: { note: "No authentication security events ingested" }
        });

  const sourceCode = build("SOURCE_CODE", {
    status: "NOT_CONFIGURED",
    depth: "NONE",
    evidence: { note: "Source-code security not connected in Phase 8" }
  });

  const cloud = build("CLOUD_HOSTING", {
    status: "NOT_CONFIGURED",
    depth: "NONE",
    evidence: { note: "Cloud/hosting security connectors not connected" }
  });

  const infrastructure =
    otelConnectionCount > 0
      ? build("INFRASTRUCTURE", {
          status: "PARTIAL",
          depth: "ADVANCED",
          evidence: { otelConnections: otelConnectionCount, note: "OTEL/logs available; not full runtime security" }
        })
      : build("INFRASTRUCTURE", {
          status: "NOT_CONFIGURED",
          depth: "NONE",
          evidence: { note: "Infrastructure/runtime security not configured" }
        });

  const threatResponse =
    responseRunCount > 0
      ? build("THREAT_RESPONSE", {
          status: "APPROVAL",
          depth: findingCount > 0 ? "STANDARD" : "BASIC",
          evidence: { responseRuns: responseRunCount, findings: findingCount }
        })
      : build("THREAT_RESPONSE", {
          status: "OBSERVE",
          depth: findingCount > 0 ? "BASIC" : "NONE",
          evidence: { findings: findingCount, note: "Governed response available via Phase 7 actions when evidence supports it" }
        });

  const dimensions: CoverageRow[] = [
    external,
    application,
    authentication,
    sourceCode,
    cloud,
    infrastructure,
    threatResponse
  ];

  // Persist computed coverage for UI honesty (upsert).
  const now = new Date();
  for (const row of dimensions) {
    const existing = byDimension.get(row.dimension);
    if (existing) {
      await prisma.securityCoverageState.update({
        where: { id: existing.id },
        data: {
          status: row.status,
          depth: row.depth,
          evidenceJson: row.evidence as Prisma.InputJsonValue,
          updatedAt: now
        }
      });
    } else {
      await prisma.securityCoverageState.create({
        data: {
          id: randomUUID(),
          organizationId,
          projectId: projectId ?? null,
          dimension: row.dimension,
          status: row.status,
          depth: row.depth,
          evidenceJson: row.evidence as Prisma.InputJsonValue,
          updatedAt: now
        }
      });
    }
  }

  let overallDepth: CoverageDepth = "NONE";
  for (const row of dimensions) overallDepth = maxDepth(overallDepth, row.depth);

  const honestSummary =
    overallDepth === "NONE"
      ? "Security coverage is not configured. URL monitoring alone is not full protection."
      : overallDepth === "BASIC"
        ? "BASIC depth: external URL/SSL evidence only. Application threat detection requires security event ingestion."
        : overallDepth === "STANDARD"
          ? "STANDARD depth: URL evidence plus application/API security events. Not a complete SIEM."
          : overallDepth === "ADVANCED"
            ? "ADVANCED depth: application, identity, and partial hosting/runtime evidence. Gaps remain."
            : "DEEP depth requires runtime, infrastructure, network and comprehensive logs/traces — verify each dimension.";

  return {
    organizationId,
    projectId: projectId ?? null,
    overallDepth,
    dimensions,
    honestSummary
  };
};

export const ensureCoverageDimensions = (): readonly CoverageDimension[] => COVERAGE_DIMENSIONS;
