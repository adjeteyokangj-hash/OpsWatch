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
  it("labels logs/traces as Foundation/Preview and renders supplied states", () => {
    const html = renderToStaticMarkup(
      <MonitoringDepthSummary
        setup={baseSetup({
          logs: "FOUNDATION_CONNECTED",
          traces: "FOUNDATION_CONNECTED",
          infrastructure: "NOT_CONNECTED",
          otel: {
            connections: 1,
            ingestionEnabled: true,
            topologyDiscoveryEnabled: false,
            alertGenerationEnabled: true,
            label: "Foundation/Preview"
          }
        })}
      />
    );
    expect(html).toContain("Advanced · Logs (Foundation/Preview)");
    expect(html).toContain("Advanced · Traces (Foundation/Preview)");
    expect(html).toContain("Foundation connected");
    expect(html).toContain("1 connection");
    expect(html).toContain("ingest on");
  });

  it("renders not connected when OTEL is absent", () => {
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
