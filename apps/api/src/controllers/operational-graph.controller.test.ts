import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma", () => ({ prisma: { operationalLocation: {} } }));

import { createOperationalLocation } from "./operational-graph.controller";

describe("operational location topology mode", () => {
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
});
