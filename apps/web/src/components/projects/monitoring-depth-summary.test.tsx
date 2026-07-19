import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MonitoringDepthSummary, type MonitoringSetup } from "./monitoring-depth-summary";

const baseSetup = (advanced: MonitoringSetup["depth"]["advancedMonitoring"]): MonitoringSetup => ({
  status: "ACTIVE",
  steps: {
    websiteConnectionCreated: true,
    httpCheckScheduled: true,
    sslCheckScheduled: true,
    firstCheckPending: false,
    monitoringActive: true
  },
  depth: {
    externalMonitoring: {
      publicUrlConnected: true,
      httpMonitoringActive: true,
      sslMonitoringActive: true,
      adminUrlMonitoring: "NOT_CONFIGURED"
    },
    applicationMonitoring: {
      heartbeat: "NOT_CONFIGURED",
      events: "NOT_CONFIGURED"
    },
    advancedMonitoring: advanced
  }
});

describe("MonitoringDepthSummary OTEL honesty", () => {
  it("labels logs/traces as Foundation/Preview and renders OTEL evidence rows", () => {
    const html = renderToStaticMarkup(
      <MonitoringDepthSummary
        setup={baseSetup({
          logs: "FOUNDATION_CONNECTED",
          traces: "FOUNDATION_CONNECTED",
          infrastructure: "NOT_CONNECTED",
          otel: {
            connections: 1,
            connectionHealth: "HEALTHY",
            lastSignalAt: "2026-07-19T10:00:00.000Z",
            signalCounts: {
              metric: 2,
              log: 1,
              trace: 0,
              span: 3,
              error: 0,
              dependency: 1,
              total: 7
            },
            discoveredEntities: 2,
            discoveredRelationships: 1,
            staleEntities: 0,
            ingestionEnabled: true,
            topologyDiscoveryEnabled: false,
            alertGenerationEnabled: true,
            incidentCorrelationEnabled: false,
            processingNotes: [
              "Incident correlation for OTEL is disabled; OTEL alerts are not correlated into OTEL incident evidence."
            ],
            label: "Foundation/Preview"
          }
        })}
      />
    );
    expect(html).toContain("Advanced · Logs (Foundation/Preview)");
    expect(html).toContain("Advanced · Traces (Foundation/Preview)");
    expect(html).toContain("Foundation connected");
    expect(html).toContain("1 connection");
    expect(html).toContain("metric 2");
    expect(html).toContain("2 entities");
    expect(html).toContain("Disabled");
    expect(html).toContain("Incident correlation for OTEL is disabled");
  });

  it("renders not connected when OTEL block is absent", () => {
    const html = renderToStaticMarkup(
      <MonitoringDepthSummary
        setup={baseSetup({
          logs: "NOT_CONNECTED",
          traces: "NOT_CONNECTED",
          infrastructure: "NOT_CONNECTED"
        })}
      />
    );
    expect(html).toContain("Not connected");
    expect(html).not.toContain("data-testid=\"monitoring-depth-otel\"");
  });
});
