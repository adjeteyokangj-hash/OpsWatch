import { describe, expect, it } from "vitest";
import { getConnectionManifest, parseGuidedConnectionInput, validateConnectionConfiguration } from "../connection-manifest.service";
import { parseMonitoringSyncPage } from "./monitoring-connector-normalize";
import { resolveMonitoringProfile } from "./monitoring-connector-profile.registry";
import { MONITORING_CONNECTOR_DISPLAY } from "./monitoring-connector-types";

describe("monitoring connector neutrality", () => {
  it("exposes provider-neutral manifest labels only", () => {
    const manifest = getConnectionManifest("METRICS_ALERTS_CONNECTOR");
    expect(manifest.displayName).toBe("Metrics & alerts connector");
    expect(JSON.stringify(manifest)).not.toMatch(/datadog|dynatrace/i);
    expect(MONITORING_CONNECTOR_DISPLAY.METRICS_ALERTS_CONNECTOR).toBe("Metrics & alerts connector");
  });

  it("parses guided monitoring source input with sync defaults", () => {
    const parsed = parseGuidedConnectionInput({
      name: "Production metrics",
      connectorType: "METRICS_ALERTS",
      applicationId: "project-a",
      baseUrl: "https://monitoring.example.com",
      authType: "API_KEY",
      authSecret: "secret"
    });
    expect(parsed.mode).toBe("METRICS_ALERTS_CONNECTOR");
    expect(parsed.capabilities).toContain("monitoring_sync");
    expect(parsed.configuration.syncPath).toBe("/api/v1/sync/metrics-alerts");
    const validation = validateConnectionConfiguration(parsed.mode, parsed.configuration);
    expect(validation.valid).toBe(true);
  });

  it("normalizes paginated sync payloads into entities and signals", () => {
    const page = parseMonitoringSyncPage("METRICS_ALERTS_CONNECTOR", {
      entities: [{ id: "svc-1", name: "Checkout API", type: "SERVICE" }],
      alerts: [{ id: "alert-1", title: "Latency elevated", severity: "warning", serviceId: "svc-1" }],
      nextCursor: "page-2",
      hasMore: true
    }, "cursor");
    expect(page.items[0]?.entities).toHaveLength(1);
    expect(page.items[0]?.signals).toHaveLength(1);
    expect(page.nextCursor).toBe("page-2");
  });

  it("documents honest limitations per profile without vendor branding", () => {
    const limitations = resolveMonitoringProfile("APPLICATION_PERFORMANCE_CONNECTOR", {}).limitations;
    expect(limitations.length).toBeGreaterThan(0);
    expect(limitations.join(" ")).not.toMatch(/datadog|dynatrace/i);
  });
});
