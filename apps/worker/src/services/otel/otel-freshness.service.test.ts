import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  entityUpdateMany: vi.fn(),
  relationshipUpdateMany: vi.fn(),
  signalUpdateMany: vi.fn(),
  entityFindMany: vi.fn()
}));

vi.mock("../../lib/prisma", () => ({
  prisma: {
    operationalEntity: {
      updateMany: mocks.entityUpdateMany,
      findMany: mocks.entityFindMany
    },
    operationalRelationship: { updateMany: mocks.relationshipUpdateMany },
    normalizedOperationalSignal: { updateMany: mocks.signalUpdateMany },
    alert: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    otelAlertEvidence: { create: vi.fn() }
  }
}));

vi.mock("../notifications/notification.service", () => ({
  dispatchAlertNotifications: vi.fn()
}));

import { processOtelFreshness } from "./otel-freshness.service";

describe("otel freshness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OPSWATCH_OTEL_ALERT_GENERATION_ENABLED;
    mocks.entityUpdateMany.mockResolvedValue({ count: 2 });
    mocks.relationshipUpdateMany.mockResolvedValue({ count: 1 });
    mocks.signalUpdateMany.mockResolvedValue({ count: 3 });
    mocks.entityFindMany.mockResolvedValue([]);
  });

  it("marks entities and relationships stale without implying healthy recovery", async () => {
    const result = await processOtelFreshness();
    expect(result.staleEntities).toBe(2);
    expect(result.staleRelationships).toBe(1);
    expect(mocks.entityUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          discoveryState: "STALE",
          health: "UNKNOWN",
          healthReason: "otel_stale"
        })
      })
    );
  });
});
