import { describe, expect, it } from "vitest";
import { computeProjectHealth, healthDisplayLabel } from "./project-health.service";

describe("project-health.service", () => {
  it("waits for the first website check when URL monitoring is configured", () => {
    const snapshot = computeProjectHealth({
      storedStatus: "DEGRADED",
      monitoringEnabled: true,
      isActive: true,
      services: [
        {
          id: "svc-1",
          name: "API",
          type: "COMPONENT",
          status: "HEALTHY",
          criticality: "HIGH",
          Check: [{
            name: "Public website availability",
            type: "HTTP",
            intervalSeconds: 60,
            configJson: { monitoringRole: "PUBLIC" },
            isActive: true,
            CheckResult: []
          }]
        }
      ],
      openAlerts: [],
      unresolvedIncidents: []
    });

    expect(snapshot.status).toBe("UNKNOWN");
    expect(snapshot.healthReason).toBe("Waiting for first website check");
    expect(healthDisplayLabel("UNKNOWN")).toBe("Waiting for first heartbeat");
  });

  it("uses heartbeat signal when checks have not completed yet", () => {
    const snapshot = computeProjectHealth({
      storedStatus: "HEALTHY",
      monitoringEnabled: true,
      isActive: true,
      services: [],
      openAlerts: [],
      unresolvedIncidents: [],
      lastHeartbeatAt: new Date("2026-07-14T06:00:00.000Z")
    });

    expect(snapshot.status).toBe("HEALTHY");
    expect(snapshot.healthSource).toBe("heartbeat");
    expect(snapshot.healthReason).toContain("Receiving heartbeats");
    expect(snapshot.lastSignalAt?.toISOString()).toBe("2026-07-14T06:00:00.000Z");
  });

  it("does not mark project DOWN when only low-criticality component fails", () => {
    const snapshot = computeProjectHealth({
      storedStatus: "HEALTHY",
      monitoringEnabled: true,
      isActive: true,
      services: [
        {
          id: "svc-1",
          name: "Analytics",
          type: "COMPONENT",
          status: "HEALTHY",
          criticality: "LOW",
          Check: [
            {
              isActive: true,
              CheckResult: [{ status: "FAIL", checkedAt: new Date(), responseCode: 500 }]
            }
          ]
        }
      ],
      openAlerts: [{ serviceId: "svc-1", severity: "HIGH" }],
      unresolvedIncidents: []
    });

    expect(snapshot.status).toBe("DEGRADED");
  });

  it("gives a current public HTTP failure precedence over heartbeat health", () => {
    const now = new Date("2026-07-19T08:00:00.000Z");
    const snapshot = computeProjectHealth({
      storedStatus: "HEALTHY",
      monitoringEnabled: true,
      isActive: true,
      services: [{
        id: "public",
        name: "Public website",
        type: "API",
        status: "DOWN",
        criticality: "HIGH",
        Check: [{
          name: "Public website availability",
          type: "HTTP",
          intervalSeconds: 60,
          configJson: { monitoringRole: "PUBLIC" },
          isActive: true,
          CheckResult: [{ status: "FAIL", checkedAt: now, message: "fetch failed" }]
        }]
      }],
      openAlerts: [],
      unresolvedIncidents: [],
      lastHeartbeatAt: now,
      now
    });
    expect(snapshot).toMatchObject({
      status: "DOWN",
      healthReason: "Public website is unreachable",
      healthSource: "check"
    });
  });

  it("describes admin degradation separately from the public website", () => {
    const now = new Date("2026-07-19T08:00:00.000Z");
    const snapshot = computeProjectHealth({
      storedStatus: "HEALTHY",
      monitoringEnabled: true,
      isActive: true,
      services: [{
        id: "admin",
        name: "Admin endpoint",
        type: "API",
        status: "DEGRADED",
        criticality: "MEDIUM",
        Check: [{
          name: "Admin endpoint response time",
          type: "RESPONSE_TIME",
          intervalSeconds: 60,
          configJson: { monitoringRole: "ADMIN" },
          isActive: true,
          CheckResult: [{ status: "WARN", checkedAt: now, message: "Response time is slow" }]
        }]
      }],
      openAlerts: [],
      unresolvedIncidents: [],
      now
    });
    expect(snapshot).toMatchObject({
      status: "DEGRADED",
      healthReason: "Admin endpoint response is slow"
    });
  });

  it("treats a healthy HTTP result as authoritative while SSL is pending", () => {
    const now = new Date("2026-07-19T08:00:00.000Z");
    const baseCheck = {
      intervalSeconds: 60,
      configJson: { monitoringRole: "PUBLIC" },
      isActive: true
    };
    const snapshot = computeProjectHealth({
      storedStatus: "UNKNOWN",
      healthReason: "Waiting for first heartbeat",
      monitoringEnabled: true,
      isActive: true,
      services: [{
        id: "public",
        name: "Public website",
        type: "API",
        status: "HEALTHY",
        criticality: "HIGH",
        Check: [
          {
            ...baseCheck,
            name: "Public website availability",
            type: "HTTP",
            CheckResult: [{ status: "PASS", checkedAt: now }]
          },
          {
            ...baseCheck,
            name: "Public website certificate",
            type: "SSL",
            CheckResult: []
          }
        ]
      }],
      openAlerts: [],
      unresolvedIncidents: [],
      now
    });
    expect(snapshot.status).toBe("HEALTHY");
    expect(snapshot.healthReason).toBe(
      "Public website HTTP check passed; SSL check pending; heartbeat not connected"
    );
  });

  it("uses recovery results immediately and ignores stale failures", () => {
    const now = new Date("2026-07-19T08:00:00.000Z");
    const service = {
      id: "public",
      name: "Public website",
      type: "API",
      status: "HEALTHY",
      criticality: "HIGH",
      Check: [{
        name: "Public website availability",
        type: "HTTP",
        intervalSeconds: 60,
        configJson: { monitoringRole: "PUBLIC" },
        isActive: true,
        CheckResult: [{ status: "PASS", checkedAt: now }]
      }]
    };
    const recovered = computeProjectHealth({
      storedStatus: "DOWN",
      healthReason: "Public website is unreachable",
      monitoringEnabled: true,
      isActive: true,
      services: [service],
      openAlerts: [],
      unresolvedIncidents: [],
      now
    });
    expect(recovered.status).toBe("HEALTHY");
    expect(recovered.healthReason).toContain("HTTP check passed");

    service.Check[0]!.CheckResult = [{
      status: "FAIL",
      checkedAt: new Date(now.getTime() - 10 * 60_000)
    }];
    const stale = computeProjectHealth({
      storedStatus: "DOWN",
      monitoringEnabled: true,
      isActive: true,
      services: [service],
      openAlerts: [],
      unresolvedIncidents: [],
      now
    });
    expect(stale.status).toBe("UNKNOWN");
    expect(stale.healthReason).toBe("Waiting for fresh website check");
  });
});
