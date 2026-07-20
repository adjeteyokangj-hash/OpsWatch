import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../lib/prisma", () => {
  const store = {
    approvals: [] as Array<Record<string, unknown>>,
    audits: [] as Array<Record<string, unknown>>
  };
  return {
    prisma: {
      project: {
        findFirst: vi.fn(async () => ({ environment: "test" }))
      },
      projectIntegration: {
        findMany: vi.fn(async () => [])
      },
      user: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
          where.id ? { id: where.id } : null
        )
      },
      remediationApproval: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          store.approvals.push(data);
          return data;
        }),
        findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
          store.approvals.find((row) => row.id === where.id) ?? null
        ),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const idx = store.approvals.findIndex((row) => row.id === where.id);
          if (idx < 0) throw new Error("missing");
          store.approvals[idx] = { ...store.approvals[idx], ...data };
          return store.approvals[idx];
        }),
        updateMany: vi.fn(async () => ({ count: 0 }))
      },
      auditLog: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          store.audits.push(data);
          return data;
        })
      },
      __store: store
    }
  };
});

vi.mock("../intelligence/observation.service", () => ({
  recordOperationsTimelineEvent: vi.fn(async () => undefined)
}));

import {
  decideRemediationApproval,
  requestRemediationApproval,
  revalidateApprovedAction
} from "./approval.service";

describe("Phase 7 remediation approval governance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Observe mode never creates an approval that can execute", async () => {
    await expect(
      requestRemediationApproval({
        context: { organizationId: "org-1", serviceId: "svc-1" },
        actionKey: "RERUN_HTTP_CHECK",
        reason: "test",
        automationMode: "OBSERVE"
      })
    ).rejects.toThrow(/Observe/i);
  });

  it("creates approval requests with expiry and risk metadata", async () => {
    const result = await requestRemediationApproval({
      context: {
        organizationId: "org-1",
        projectId: "proj-1",
        extra: { connectionId: "conn-1" }
      },
      actionKey: "TEST_CONNECTION",
      reason: "Probe degraded connection",
      requestedBy: "user-1",
      automationMode: "APPROVAL"
    });
    expect(result.approvalId).toBeTruthy();
    expect(result.correlationId).toBeTruthy();
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects expired approvals on decision", async () => {
    const created = await requestRemediationApproval({
      context: {
        organizationId: "org-1",
        projectId: "proj-1",
        extra: { connectionId: "conn-1" }
      },
      actionKey: "TEST_CONNECTION",
      reason: "expire me",
      automationMode: "APPROVAL",
      ttlMs: 1
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await expect(
      decideRemediationApproval({
        organizationId: "org-1",
        approvalId: created.approvalId,
        decision: "APPROVED",
        decidedBy: "admin-1",
        decisionReason: "too late"
      })
    ).rejects.toThrow(/expired/i);
  });

  it("blocks revalidation when credentials are invalid even if approved", async () => {
    const created = await requestRemediationApproval({
      context: {
        organizationId: "org-1",
        projectId: "proj-1",
        extra: { connectionId: "conn-1" }
      },
      actionKey: "TEST_CONNECTION",
      reason: "approve then revoke",
      automationMode: "APPROVAL"
    });
    await decideRemediationApproval({
      organizationId: "org-1",
      approvalId: created.approvalId,
      decision: "APPROVED",
      decidedBy: "admin-1",
      decisionReason: "ok"
    });
    const revalidated = await revalidateApprovedAction({
      organizationId: "org-1",
      approvalId: created.approvalId,
      context: {
        organizationId: "org-1",
        projectId: "proj-1",
        extra: { connectionId: "conn-1" }
      },
      credentialValid: false,
      credentialReason: "Credential revoked"
    });
    expect(revalidated.ok).toBe(false);
    if (!revalidated.ok) {
      expect(revalidated.reason).toMatch(/revoked|Credential/i);
    }
  });
});
