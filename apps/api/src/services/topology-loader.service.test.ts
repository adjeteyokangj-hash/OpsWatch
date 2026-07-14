import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma", () => ({
  prisma: {
    project: { findFirst: vi.fn() },
    service: { findMany: vi.fn() },
    serviceDependency: { findMany: vi.fn() },
    alert: { findMany: vi.fn() },
    incident: { findMany: vi.fn() },
    sLODefinition: { findMany: vi.fn() },
    heartbeat: { findMany: vi.fn() },
    $queryRaw: vi.fn()
  }
}));

vi.mock("./check-result-batch.service", () => ({
  loadRecentCheckResultsByCheckIds: vi.fn()
}));

import { prisma } from "../lib/prisma";
import { loadRecentCheckResultsByCheckIds } from "./check-result-batch.service";
import { clearTopologyLoaderCache, loadProjectTopology } from "./topology-loader.service";

describe("topology-loader.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTopologyLoaderCache();
  });

  it("loads check results in one batched call and caches briefly", async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue({
      id: "proj-1",
      name: "Noble Express",
      status: "HEALTHY"
    } as any);
    vi.mocked(prisma.service.findMany).mockResolvedValue([
      {
        id: "svc-1",
        name: "Quotes",
        type: "MODULE",
        status: "HEALTHY",
        Check: [{ id: "chk-1", isActive: true }]
      }
    ] as any);
    vi.mocked(prisma.serviceDependency.findMany).mockResolvedValue([]);
    vi.mocked(prisma.alert.findMany).mockResolvedValue([]);
    vi.mocked(prisma.incident.findMany).mockResolvedValue([]);
    vi.mocked(prisma.sLODefinition.findMany).mockResolvedValue([]);
    vi.mocked(prisma.heartbeat.findMany).mockResolvedValue([]);
    vi.mocked(loadRecentCheckResultsByCheckIds).mockResolvedValue(
      new Map([
        [
          "chk-1",
          [
            {
              checkId: "chk-1",
              status: "PASS",
              checkedAt: new Date("2026-07-14T12:00:00.000Z"),
              responseTimeMs: 42
            }
          ]
        ]
      ])
    );

    const first = await loadProjectTopology("org-1", "proj-1");
    expect(first).not.toBeNull();
    expect(first!.nodes).toHaveLength(1);
    expect(first!.nodes[0]!.metrics.availabilityPercent).toBe(100);
    expect(loadRecentCheckResultsByCheckIds).toHaveBeenCalledWith(["chk-1"], 12);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();

    const second = await loadProjectTopology("org-1", "proj-1");
    expect(second).toEqual(first);
    expect(prisma.service.findMany).toHaveBeenCalledTimes(1);
  });

  it("returns null when project is outside the organization", async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue(null);
    expect(await loadProjectTopology("org-1", "proj-missing")).toBeNull();
    expect(prisma.service.findMany).not.toHaveBeenCalled();
  });
});
