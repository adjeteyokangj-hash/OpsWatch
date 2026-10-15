import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  projectFindMany,
  journeyFindMany,
  recommendationFindMany,
  recommendationCreate,
  recommendationUpdate,
  recommendationUpdateMany,
  remediationFindMany,
  eventFindMany,
  transaction
} = vi.hoisted(() => ({
  projectFindMany: vi.fn(),
  journeyFindMany: vi.fn(),
  recommendationFindMany: vi.fn(),
  recommendationCreate: vi.fn(),
  recommendationUpdate: vi.fn(),
  recommendationUpdateMany: vi.fn(),
  remediationFindMany: vi.fn(),
  eventFindMany: vi.fn(),
  transaction: vi.fn()
}));

vi.mock("../lib/prisma", () => ({
  prisma: {
    project: { findMany: projectFindMany },
    syntheticJourney: { findMany: journeyFindMany },
    insightRecommendation: {
      findMany: recommendationFindMany,
      create: recommendationCreate,
      update: recommendationUpdate,
      updateMany: recommendationUpdateMany
    },
    remediationLog: { findMany: remediationFindMany },
    event: { findMany: eventFindMany },
    $transaction: transaction
  }
}));

import { getProductInsights } from "./product-insights.controller";

const emptyProject = {
  id: "proj-1",
  name: "Ops",
  status: "DEGRADED",
  frontendUrl: null,
  ProjectIntegration: [],
  Event: [],
  Heartbeat: [],
  Alert: [],
  Service: []
};

describe("getProductInsights recommendation sync", () => {
  const created: Array<Record<string, unknown>> = [];

  beforeEach(() => {
    created.length = 0;
    vi.clearAllMocks();
    projectFindMany.mockResolvedValue([emptyProject]);
    journeyFindMany.mockResolvedValue([]);
    remediationFindMany.mockResolvedValue([]);
    eventFindMany.mockResolvedValue([]);
    recommendationCreate.mockImplementation((args: { data: Record<string, unknown> }) => {
      created.push(args.data);
      return Promise.resolve(args.data);
    });
    recommendationUpdate.mockImplementation((args: unknown) => Promise.resolve(args));
    recommendationUpdateMany.mockResolvedValue({ count: 0 });
    transaction.mockImplementation(async (ops: Array<Promise<unknown>>) => Promise.all(ops));
    recommendationFindMany.mockImplementation(async (args: { where?: { id?: { in?: string[] } } }) => {
      const ids = args?.where?.id?.in ?? [];
      if (!ids.length) return [];
      return created
        .filter((row) => ids.includes(String(row.id)))
        .map((row) => ({
          ...row,
          status: row.id === created[0]?.id ? "DISMISSED" : "OPEN"
        }));
    });
  });

  it("persists generated recommendations in one transaction and hides dismissed rows on reload", async () => {
    const json = vi.fn();
    const req = { user: { organizationId: "org-1" } } as any;

    await getProductInsights(req, { json } as any);
    const first = json.mock.calls[0][0];
    expect(first.projects[0].recommendations.length).toBeGreaterThan(0);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0][0]).toHaveLength(created.length + 1);
    expect(recommendationUpdate).not.toHaveBeenCalled();
    expect(projectFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-1" },
      select: expect.objectContaining({
        Event: expect.objectContaining({ select: { type: true, message: true } }),
        Service: expect.objectContaining({
          select: expect.objectContaining({
            Check: { select: { id: true, name: true, type: true } }
          })
        })
      })
    }));

    json.mockClear();
    transaction.mockClear();
    recommendationCreate.mockClear();
    await getProductInsights(req, { json } as any);

    const second = json.mock.calls[0][0];
    const visibleIds = second.projects[0].recommendations.map((row: { id: string }) => row.id);
    expect(visibleIds).not.toContain(created[0]?.id);
    expect(visibleIds.length).toBe(created.length - 1);
    expect(recommendationCreate).not.toHaveBeenCalled();
    expect(recommendationUpdate).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0][0]).toHaveLength(1);
  });

  it("rejects requests without an organization claim", async () => {
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    await getProductInsights({ user: undefined } as any, { status, json } as any);
    expect(status).toHaveBeenCalledWith(403);
    expect(projectFindMany).not.toHaveBeenCalled();
  });
});
