import { describe, expect, it, vi, beforeEach } from "vitest";

const { fetchSignals } = vi.hoisted(() => ({
  fetchSignals: vi.fn()
}));

vi.mock("../services/ai/relationship-incident-memory.service", () => ({
  getRelationshipIncidentMemorySignals: fetchSignals
}));

import { getRelationshipIncidentMemorySignals } from "../controllers/topology.controller";

describe("getRelationshipIncidentMemorySignals controller", () => {
  beforeEach(() => {
    fetchSignals.mockReset();
  });

  it("returns incident memory signals for an edge", async () => {
    fetchSignals.mockResolvedValueOnce({ occurrenceCount: 2, matches: [] });
    const json = vi.fn();
    await getRelationshipIncidentMemorySignals(
      {
        user: { organizationId: "org-1" },
        params: { projectId: "proj-1", edgeId: "edge-1" }
      } as never,
      { json } as never
    );
    expect(fetchSignals).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "proj-1",
      edgeId: "edge-1"
    });
    expect(json).toHaveBeenCalledWith({ occurrenceCount: 2, matches: [] });
  });

  it("rejects requests without organization scope", async () => {
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    await getRelationshipIncidentMemorySignals({ user: undefined, params: {} } as never, {
      status,
      json
    } as never);
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: "Organization required" });
  });
});
