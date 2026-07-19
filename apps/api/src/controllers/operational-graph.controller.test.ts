import { beforeEach, describe, expect, it, vi } from "vitest";

const { canonicalGraphMock, prismaMock } = vi.hoisted(() => ({
  canonicalGraphMock: {
    upsertEntity: vi.fn(),
    upsertRelationship: vi.fn()
  },
  prismaMock: {
    operationalLocation: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn()
    },
    operationalEntity: {
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn()
    },
    operationalRelationship: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    },
    organization: {
      findFirst: vi.fn()
    },
    project: {
      findFirst: vi.fn()
    }
  }
}));

vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../services/canonical-graph.service", () => ({
  canonicalGraph: canonicalGraphMock
}));

import {
  createOperationalLocation,
  listOperationalGraph,
  proposeLearnedOperationalRelationship,
  reviewLearnedOperationalRelationship
} from "./operational-graph.controller";

describe("operational-graph controller phase 5", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unsupported location topology modes", async () => {
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();

    await createOperationalLocation(
      { user: { organizationId: "org-a" }, body: { name: "Primary site", topologyMode: "SATELLITE" } } as any,
      { status, json } as any
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      error: "topologyMode must be CENTRALISED, DISTRIBUTED, or HYBRID"
    });
  });

  it("scopes graph listing to the authenticated organization", async () => {
    prismaMock.operationalEntity.findMany.mockResolvedValue([{ id: "e1", organizationId: "org-a" }]);
    prismaMock.operationalRelationship.findMany.mockResolvedValue([
      { id: "r1", organizationId: "org-a", sourceEntityId: "e1", targetEntityId: "e1", provenance: "DECLARED", approvalStatus: "APPROVED" }
    ]);
    const json = vi.fn();

    await listOperationalGraph(
      { user: { organizationId: "org-a" }, query: { provenance: "DECLARED", includePendingLearned: "false" } } as any,
      { json } as any
    );

    expect(prismaMock.operationalEntity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org-a", provenance: "DECLARED" })
      })
    );
    expect(prismaMock.operationalRelationship.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org-a", provenance: "DECLARED" })
      })
    );
    expect(json).toHaveBeenCalled();
  });

  it("creates LEARNED relationships as PENDING and never auto-approves", async () => {
    prismaMock.operationalEntity.findMany.mockResolvedValue([
      { id: "a", projectId: "p1", environment: "production" },
      { id: "b", projectId: "p1", environment: "production" }
    ]);
    prismaMock.operationalRelationship.findFirst.mockResolvedValue(null);
    canonicalGraphMock.upsertRelationship.mockImplementation(
      async (data: any) => data
    );
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();

    await proposeLearnedOperationalRelationship(
      {
        user: { organizationId: "org-a" },
        body: { sourceEntityId: "a", targetEntityId: "b", relationshipType: "RUNTIME", impactRole: "REQUIRED" }
      } as any,
      { status, json } as any
    );

    expect(status).toHaveBeenCalledWith(201);
    const created = canonicalGraphMock.upsertRelationship.mock.calls[0][0];
    expect(created.provenance).toBe("LEARNED");
    expect(created.approvalStatus).toBe("PENDING");
    expect(created.requiresApproval).toBe(true);
  });

  it("keeps rejected learned relationships inactive for the caller's org only", async () => {
    prismaMock.operationalRelationship.findFirst.mockResolvedValue({
      id: "rel-1",
      organizationId: "org-a",
      provenance: "LEARNED",
      requiresApproval: true
    });
    prismaMock.operationalRelationship.update.mockResolvedValue({
      id: "rel-1",
      approvalStatus: "REJECTED",
      lifecycle: "INACTIVE",
      requiresApproval: false
    });
    const json = vi.fn();

    await reviewLearnedOperationalRelationship(
      { user: { organizationId: "org-a" }, params: { relationshipId: "rel-1" }, body: { decision: "REJECT" } } as any,
      { json } as any
    );

    expect(prismaMock.operationalRelationship.findFirst).toHaveBeenCalledWith({
      where: { id: "rel-1", organizationId: "org-a", provenance: "LEARNED", requiresApproval: true }
    });
    expect(prismaMock.operationalRelationship.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ approvalStatus: "REJECTED", lifecycle: "INACTIVE", requiresApproval: false })
      })
    );
  });
});
