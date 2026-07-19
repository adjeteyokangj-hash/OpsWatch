import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../lib/prisma", () => {
  const breakers = new Map<string, Record<string, unknown>>();
  return {
    prisma: {
      remediationCircuitBreaker: {
        findUnique: vi.fn(async ({ where }: { where: { organizationId_projectId_actionKey: { organizationId: string; projectId: string; actionKey: string } } }) => {
          const key = `${where.organizationId_projectId_actionKey.organizationId}:${where.organizationId_projectId_actionKey.projectId}:${where.organizationId_projectId_actionKey.actionKey}`;
          return breakers.get(key) ?? null;
        }),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const key = `${data.organizationId}:${data.projectId}:${data.actionKey}`;
          breakers.set(key, { ...data });
          return data;
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          for (const [key, row] of breakers) {
            if (row.id === where.id) {
              const next = { ...row, ...data };
              breakers.set(key, next);
              return next;
            }
          }
          throw new Error("missing breaker");
        })
      }
    }
  };
});

import {
  assertCircuitClosed,
  recordCircuitFailure,
  resetCircuitBreaker,
  tripCircuitBreaker
} from "./circuit-breaker.service";

describe("Phase 7 circuit breaker hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("trips open after repeated failures and blocks execution", async () => {
    await tripCircuitBreaker({
      organizationId: "org-1",
      projectId: "proj-1",
      actionKey: "TEST_CONNECTION",
      trippedBy: "system",
      reason: "repeated failures"
    });
    for (let i = 0; i < 2; i += 1) {
      await recordCircuitFailure({
        organizationId: "org-1",
        projectId: "proj-1",
        actionKey: "TEST_CONNECTION",
        kind: "provider",
        reason: `failure-${i}`
      });
    }
    const gate = await assertCircuitClosed({
      organizationId: "org-1",
      projectId: "proj-1",
      actionKey: "TEST_CONNECTION"
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toMatch(/Circuit breaker open/i);
  });

  it("allows administrator reset", async () => {
    await tripCircuitBreaker({
      organizationId: "org-1",
      projectId: "proj-1",
      actionKey: "RERUN_HTTP_CHECK",
      trippedBy: "admin",
      reason: "manual"
    });
    await resetCircuitBreaker({
      organizationId: "org-1",
      projectId: "proj-1",
      actionKey: "RERUN_HTTP_CHECK",
      resetBy: "admin"
    });
    const gate = await assertCircuitClosed({
      organizationId: "org-1",
      projectId: "proj-1",
      actionKey: "RERUN_HTTP_CHECK"
    });
    expect(gate.ok).toBe(true);
  });
});
