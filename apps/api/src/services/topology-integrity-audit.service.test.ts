import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma", () => ({
  prisma: {
    operationalEntity: { findMany: vi.fn() },
    operationalRelationship: { findMany: vi.fn(), count: vi.fn() },
    alert: { count: vi.fn() },
    automationRunStep: { count: vi.fn() }
  }
}));

vi.mock("./topology-unification.service", () => ({
  compareLegacyAndCanonicalTopology: vi.fn()
}));

import { prisma } from "../lib/prisma";
import { auditCanonicalTopologyIntegrity } from "./topology-integrity-audit.service";
import { compareLegacyAndCanonicalTopology } from "./topology-unification.service";

const emptyComparison = {
  projectId: null,
  legacyEntityCount: 0,
  canonicalEntityCount: 0,
  legacyRelationshipCount: 0,
  canonicalRelationshipCount: 0,
  missingEntities: [],
  missingRelationships: [],
  duplicates: [],
  ambiguousMappings: [],
  healthDifferences: []
};

describe("topology integrity audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.operationalEntity.findMany).mockResolvedValue([]);
    vi.mocked(prisma.operationalRelationship.findMany).mockResolvedValue([]);
    vi.mocked(prisma.operationalRelationship.count).mockResolvedValue(0);
    vi.mocked(prisma.alert.count).mockResolvedValue(0);
    vi.mocked(prisma.automationRunStep.count).mockResolvedValue(0);
    vi.mocked(compareLegacyAndCanonicalTopology).mockResolvedValue(
      emptyComparison
    );
  });

  it("passes a clean canonical graph", async () => {
    const result = await auditCanonicalTopologyIntegrity();

    expect(result.passes).toBe(true);
    expect(result.counts.critical).toBe(0);
    expect(result.findings).toEqual([]);
  });

  it("blocks cutover for duplicate identities and scope mismatches", async () => {
    const entity = {
      id: "entity-1",
      organizationId: "org-1",
      projectId: "project-1",
      projectScopeKey: "project-1",
      environment: "production",
      entityType: "APP",
      stableIdentityKey: "app",
      sharedScope: "PROJECT",
      health: "HEALTHY",
      freshUntil: null,
      discoveryState: "ACTIVE",
      isTestSeed: false,
      discoverySource: "MANUAL"
    };
    vi.mocked(prisma.operationalEntity.findMany).mockResolvedValue([
      entity,
      { ...entity, id: "entity-2" }
    ] as any);
    vi.mocked(prisma.operationalRelationship.findMany).mockResolvedValue([
      {
        id: "relationship-1",
        organizationId: "org-1",
        projectId: "project-1",
        environment: "production",
        stableIdentityKey: "calls",
        sourceEntityId: "entity-1",
        targetEntityId: "entity-2",
        health: "HEALTHY",
        discoveryState: "ACTIVE",
        freshUntil: null,
        Source: {
          organizationId: "org-1",
          projectId: "project-1",
          environment: "production"
        },
        Target: {
          organizationId: "org-1",
          projectId: "another-project",
          environment: "production"
        }
      }
    ] as any);

    const result = await auditCanonicalTopologyIntegrity();

    expect(result.passes).toBe(false);
    expect(result.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "DUPLICATE_ENTITY_IDENTITY",
        "RELATIONSHIP_SCOPE_MISMATCH"
      ])
    );
  });
});
