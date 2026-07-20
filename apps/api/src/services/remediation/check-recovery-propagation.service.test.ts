import { beforeEach, describe, expect, it, vi } from "vitest";

const checkResults: Array<{ status: string; checkedAt: Date }> = [];
const alerts = new Map<string, Record<string, unknown>>();
const incidents = new Map<string, Record<string, unknown>>();
const incidentAlerts: Array<{ incidentId: string; alertId: string }> = [];
const timeline: Array<Record<string, unknown>> = [];
const audits: Array<Record<string, unknown>> = [];

vi.mock("../../lib/prisma", () => ({
  prisma: {
    check: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id
          ? { id: where.id, recoveryThreshold: 2 }
          : null
      )
    },
    checkResult: {
      findMany: vi.fn(async () => [...checkResults].sort((a, b) => b.checkedAt.getTime() - a.checkedAt.getTime()))
    },
    alert: {
      findFirst: vi.fn(async ({ where }: { where: { id?: string } }) => {
        if (where.id) return alerts.get(where.id) ?? null;
        return null;
      }),
      findMany: vi.fn(async ({ where }: { where: { sourceId?: string } }) =>
        [...alerts.values()].filter(
          (row) =>
            row.sourceId === where.sourceId &&
            row.status !== "RESOLVED"
        )
      ),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const current = alerts.get(where.id);
        if (!current) throw new Error("missing alert");
        const next = { ...current, ...data };
        alerts.set(where.id, next);
        return next;
      })
    },
    incident: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => {
        const incident = incidents.get(where.id);
        if (!incident) return null;
        const linked = incidentAlerts
          .filter((row) => row.incidentId === where.id)
          .map((row) => ({ Alert: alerts.get(row.alertId)! }));
        return { ...incident, IncidentAlert: linked };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const current = incidents.get(where.id)!;
        const next = { ...current, ...data };
        incidents.set(where.id, next);
        return next;
      })
    },
    incidentAlert: {
      findMany: vi.fn(async () => [])
    },
    incidentTimelineEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        timeline.push(data);
        return data;
      })
    },
    auditLog: {
      findMany: vi.fn(async () => audits),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        audits.push(data);
        return data;
      })
    }
  }
}));

vi.mock("../intelligence/observation.service", () => ({
  recordOperationsTimelineEvent: vi.fn(async () => undefined)
}));

import {
  evaluateCheckRecoveryThreshold,
  propagateCheckRecovery
} from "./check-recovery-propagation.service";

describe("check recovery propagation", () => {
  beforeEach(() => {
    checkResults.length = 0;
    alerts.clear();
    incidents.clear();
    incidentAlerts.length = 0;
    timeline.length = 0;
    audits.length = 0;
    vi.clearAllMocks();
  });

  it("does not meet threshold when only one of two passes", async () => {
    checkResults.push({ status: "PASS", checkedAt: new Date() });
    const progress = await evaluateCheckRecoveryThreshold("check-1");
    expect(progress).toMatchObject({ passed: 1, required: 2, met: false });
  });

  it("meets threshold after two consecutive passes", async () => {
    checkResults.push(
      { status: "PASS", checkedAt: new Date("2026-07-20T12:00:02Z") },
      { status: "PASS", checkedAt: new Date("2026-07-20T12:00:01Z") }
    );
    const progress = await evaluateCheckRecoveryThreshold("check-1");
    expect(progress.met).toBe(true);
  });

  it("resets consecutive progress after a failed check", async () => {
    checkResults.push(
      { status: "FAIL", checkedAt: new Date("2026-07-20T12:00:03Z") },
      { status: "PASS", checkedAt: new Date("2026-07-20T12:00:02Z") },
      { status: "PASS", checkedAt: new Date("2026-07-20T12:00:01Z") }
    );
    const progress = await evaluateCheckRecoveryThreshold("check-1");
    expect(progress).toMatchObject({ passed: 0, met: false, latestStatus: "FAIL" });
  });

  it("keeps alerts open below threshold", async () => {
    checkResults.push({ status: "PASS", checkedAt: new Date() });
    alerts.set("alert-1", {
      id: "alert-1",
      projectId: "proj-1",
      status: "OPEN",
      message: "failing",
      sourceId: "check-1",
      sourceType: "CHECK"
    });
    incidents.set("inc-1", {
      id: "inc-1",
      projectId: "proj-1",
      status: "OPEN",
      rootCause: null
    });
    incidentAlerts.push({ incidentId: "inc-1", alertId: "alert-1" });

    const result = await propagateCheckRecovery({
      organizationId: "org-1",
      projectId: "proj-1",
      checkId: "check-1",
      alertId: "alert-1",
      incidentId: "inc-1",
      correlationId: "corr-1",
      recoveryCause: "automatic"
    });

    expect(result.verification.met).toBe(false);
    expect(result.uiLabel).toMatch(/Verification 1 of 2/);
    expect(alerts.get("alert-1")!.status).toBe("OPEN");
    expect(incidents.get("inc-1")!.status).toBe("OPEN");
  });

  it("resolves one alert and keeps incident open when another linked alert remains", async () => {
    checkResults.push(
      { status: "PASS", checkedAt: new Date("2026-07-20T12:00:02Z") },
      { status: "PASS", checkedAt: new Date("2026-07-20T12:00:01Z") }
    );
    alerts.set("alert-1", {
      id: "alert-1",
      projectId: "proj-1",
      status: "OPEN",
      message: "check A",
      sourceId: "check-1",
      sourceType: "CHECK"
    });
    alerts.set("alert-2", {
      id: "alert-2",
      projectId: "proj-1",
      status: "OPEN",
      message: "check B",
      sourceId: "check-2",
      sourceType: "CHECK"
    });
    incidents.set("inc-1", {
      id: "inc-1",
      projectId: "proj-1",
      status: "OPEN",
      rootCause: null
    });
    incidentAlerts.push(
      { incidentId: "inc-1", alertId: "alert-1" },
      { incidentId: "inc-1", alertId: "alert-2" }
    );

    const result = await propagateCheckRecovery({
      organizationId: "org-1",
      projectId: "proj-1",
      checkId: "check-1",
      alertId: "alert-1",
      incidentId: "inc-1",
      correlationId: "corr-partial",
      recoveryCause: "automatic",
      rootCauseHint: "Readiness endpoint check failed because the expected payload keyword was temporarily missing."
    });

    expect(result.alertResolvedIds).toEqual(["alert-1"]);
    expect(alerts.get("alert-1")!.status).toBe("RESOLVED");
    expect(String(alerts.get("alert-1")!.message)).toContain(
      "Automatically resolved after successful recovery verification"
    );
    expect(alerts.get("alert-2")!.status).toBe("OPEN");
    expect(result.incidentResolved).toBe(false);
    expect(result.uiLabel).toMatch(/Partial recovery/);
    expect(incidents.get("inc-1")!.rootCause).toContain("Readiness endpoint");
  });

  it("resolves the incident when all linked alerts recover", async () => {
    checkResults.push(
      { status: "PASS", checkedAt: new Date("2026-07-20T12:00:02Z") },
      { status: "PASS", checkedAt: new Date("2026-07-20T12:00:01Z") }
    );
    alerts.set("alert-1", {
      id: "alert-1",
      projectId: "proj-1",
      status: "OPEN",
      message: "check A",
      sourceId: "check-1",
      sourceType: "CHECK"
    });
    incidents.set("inc-1", {
      id: "inc-1",
      projectId: "proj-1",
      status: "OPEN",
      rootCause: null
    });
    incidentAlerts.push({ incidentId: "inc-1", alertId: "alert-1" });

    const result = await propagateCheckRecovery({
      organizationId: "org-1",
      projectId: "proj-1",
      checkId: "check-1",
      alertId: "alert-1",
      incidentId: "inc-1",
      correlationId: "corr-full",
      recoveryCause: "automatic"
    });

    expect(result.incidentResolved).toBe(true);
    expect(incidents.get("inc-1")!.status).toBe("RESOLVED");
    expect(result.uiLabel).toMatch(/incident automatically resolved/i);
  });

  it("is idempotent for the same correlation id", async () => {
    checkResults.push(
      { status: "PASS", checkedAt: new Date("2026-07-20T12:00:02Z") },
      { status: "PASS", checkedAt: new Date("2026-07-20T12:00:01Z") }
    );
    alerts.set("alert-1", {
      id: "alert-1",
      projectId: "proj-1",
      status: "OPEN",
      message: "check A",
      sourceId: "check-1",
      sourceType: "CHECK"
    });
    incidents.set("inc-1", {
      id: "inc-1",
      projectId: "proj-1",
      status: "OPEN",
      rootCause: null
    });
    incidentAlerts.push({ incidentId: "inc-1", alertId: "alert-1" });

    const first = await propagateCheckRecovery({
      organizationId: "org-1",
      projectId: "proj-1",
      checkId: "check-1",
      alertId: "alert-1",
      incidentId: "inc-1",
      correlationId: "corr-dup",
      recoveryCause: "automatic"
    });
    expect(first.alertResolvedIds).toEqual(["alert-1"]);

    alerts.set("alert-1", {
      id: "alert-1",
      projectId: "proj-1",
      status: "OPEN",
      message: "check A",
      sourceId: "check-1",
      sourceType: "CHECK"
    });
    incidents.set("inc-1", {
      id: "inc-1",
      projectId: "proj-1",
      status: "OPEN",
      rootCause: null
    });

    const second = await propagateCheckRecovery({
      organizationId: "org-1",
      projectId: "proj-1",
      checkId: "check-1",
      alertId: "alert-1",
      incidentId: "inc-1",
      correlationId: "corr-dup",
      recoveryCause: "automatic"
    });
    expect(second.alertResolvedIds).toEqual([]);
  });
});
