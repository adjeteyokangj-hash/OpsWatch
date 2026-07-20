import { describe, expect, it, vi } from "vitest";
import { adaptMonitoringSyncPayload } from "./monitoring-connector-adapters";
import { MonitoringHttpError, monitoringHttpGetJson } from "./monitoring-connector-http.client";
import {
  assertMonitoringRemediationNotAutonomous,
  proposeMonitoringRemediation
} from "./monitoring-connector-remediation.service";
import { MONITORING_CONNECTOR_DISPLAY } from "./monitoring-connector-types";

describe("Phase 10 monitoring connector completion", () => {
  it("adapts metrics/alerts wire payloads without exposing vendor branding", () => {
    const page = adaptMonitoringSyncPayload(
      "METRICS_ALERTS_CONNECTOR",
      {
        monitors: [{ id: 42, name: "Checkout latency", overall_state: "Alert", type: "metric alert" }],
        events: [
          {
            id: 99,
            title: "Latency high",
            alert_type: "error",
            monitor_id: 42,
            date_happened: 1_700_000_000
          }
        ],
        meta: { next_cursor: "cursor-2" }
      },
      "cursor"
    );
    expect(page.items[0]?.entities[0]?.stableKey).toBe("monitor:42");
    expect(page.items[0]?.signals[0]?.externalId).toBe("event:99");
    expect(page.nextCursor).toBe("cursor-2");
    expect(JSON.stringify(page)).not.toMatch(/datadog|dynatrace/i);
  });

  it("adapts application-performance wire payloads into neutral entities and problems", () => {
    const page = adaptMonitoringSyncPayload(
      "APPLICATION_PERFORMANCE_CONNECTOR",
      {
        totalCount: 1,
        entities: [{ entityId: "SERVICE-1", displayName: "checkout", type: "SERVICE" }],
        problems: [
          {
            problemId: "P-1",
            title: "Failure rate increase",
            severityLevel: "ERROR",
            impactedEntities: [{ entityId: "SERVICE-1" }],
            startTime: Date.now()
          }
        ],
        nextPageKey: "page-2"
      },
      "nextPageKey"
    );
    expect(page.items[0]?.entities).toHaveLength(1);
    expect(page.items[0]?.signals[0]?.kind).toBe("PROBLEM");
    expect(JSON.stringify(page)).not.toMatch(/datadog|dynatrace/i);
  });

  it("retries on 429 with backoff and eventually succeeds", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        if (calls < 3) {
          return new Response("rate limited", { status: 429, headers: { "retry-after": "0" } });
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const result = await monitoringHttpGetJson<{ ok: boolean }>({
      baseUrl: "https://monitoring.example.com",
      path: "/api/v1/validate",
      authMethod: "API_KEY",
      secret: "secret",
      configuration: { authHeaderName: "DD-API-KEY" },
      maxRetries: 3,
      sleepFn: async (ms) => {
        sleeps.push(ms);
      }
    });

    expect(result.data.ok).toBe(true);
    expect(calls).toBe(3);
    expect(sleeps.length).toBeGreaterThanOrEqual(2);
    vi.unstubAllGlobals();
  });

  it("retries server errors then fails with classified error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 503 }))
    );
    await expect(
      monitoringHttpGetJson({
        baseUrl: "https://monitoring.example.com",
        path: "/api/v1/sync",
        authMethod: "BEARER",
        secret: "token",
        configuration: {},
        maxRetries: 1,
        sleepFn: async () => undefined
      })
    ).rejects.toMatchObject({ category: "SERVER_ERROR", statusCode: 503 } satisfies Partial<MonitoringHttpError>);
    vi.unstubAllGlobals();
  });

  it("never proposes autonomous remediation from monitoring alerts alone", () => {
    const undiagnosed = proposeMonitoringRemediation({
      organizationId: "org",
      projectId: "project",
      connectionId: "conn",
      connectorMode: "METRICS_ALERTS_CONNECTOR",
      alertId: "alert-1",
      diagnosed: false
    });
    expect(undiagnosed[0]?.actionKey).toBe("REQUEST_HUMAN_REVIEW");
    expect(assertMonitoringRemediationNotAutonomous(undiagnosed)).toBe(true);

    const diagnosed = proposeMonitoringRemediation({
      organizationId: "org",
      projectId: "project",
      connectionId: "conn",
      connectorMode: "METRICS_ALERTS_CONNECTOR",
      alertId: "alert-1",
      diagnosed: true,
      diagnosisSummary: "Latency regression after deploy"
    });
    expect(assertMonitoringRemediationNotAutonomous(diagnosed)).toBe(true);
    expect(diagnosed.every((row) => row.autoExecute === false)).toBe(true);
  });

  it("keeps customer-facing connector labels provider-neutral", () => {
    expect(Object.values(MONITORING_CONNECTOR_DISPLAY).join(" ")).not.toMatch(/datadog|dynatrace/i);
  });
});
