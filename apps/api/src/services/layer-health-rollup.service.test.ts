import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildLayerHealthRollup } from "./layer-health-rollup.service";

vi.mock("../lib/prisma", () => ({
  prisma: {
    project: { findMany: vi.fn() },
    service: { findMany: vi.fn() }
  }
}));

import { prisma } from "../lib/prisma";

describe("buildLayerHealthRollup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("aggregates four-layer health counts", async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue([
      { status: "HEALTHY" },
      { status: "DOWN" },
      { status: "UNKNOWN" }
    ] as any);
    vi.mocked(prisma.service.findMany).mockResolvedValue([
      { type: "MODULE", status: "HEALTHY" },
      { type: "MODULE", status: "DEGRADED" },
      { type: "WORKFLOW", status: "HEALTHY" },
      { type: "API", status: "DOWN" },
      { type: "COMPONENT", status: "UNKNOWN" }
    ] as any);

    const rows = await buildLayerHealthRollup("org-1");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ layer: "APPLICATION", total: 3, healthy: 1, critical: 1, unknown: 1 });
    expect(rows[1]).toMatchObject({ layer: "MODULE", total: 2, healthy: 1, warning: 1 });
    expect(rows[2]).toMatchObject({ layer: "WORKFLOW", total: 1, healthy: 1 });
    expect(rows[3]).toMatchObject({ layer: "COMPONENT", total: 2, critical: 1, unknown: 1 });
  });
});
