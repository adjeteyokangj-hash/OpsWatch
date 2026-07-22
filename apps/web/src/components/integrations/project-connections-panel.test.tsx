import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectConnectionsPanel } from "./project-connections-panel";
import type { ConnectionRecord } from "../connections/types";

const trueNumerisConnection: ConnectionRecord = {
  id: "conn_tn",
  name: "TrueNumeris Production",
  type: "REST_API",
  mode: "API",
  environment: "production",
  authMethod: "BEARER",
  health: "HEALTHY",
  project: { id: "project_tn", name: "TrueNumeris" },
  secretConfigured: true,
  lastError: null,
  lastValidatedAt: "2026-07-22T08:00:00.000Z",
  isActive: true,
  baseUrl: "https://api.truenumeris.com"
};

describe("ProjectConnectionsPanel", () => {
  it("shows the existing TrueNumeris monitoring connection and truthful capability states", () => {
    const html = renderToStaticMarkup(
      <ProjectConnectionsPanel
        project={{ id: "project_tn", name: "TrueNumeris", slug: "truenumeris" }}
        integrations={[]}
        monitoringConnections={[trueNumerisConnection]}
        onValidate={() => undefined}
      />
    );

    expect(html).toContain("TrueNumeris monitoring connection");
    expect(html).toContain("Connected");
    expect(html).toContain("https://api.truenumeris.com");
    expect(html).toContain("Worker remediator");
    expect(html).toContain("Setup required");
    expect(html).toContain("Service remediator");
    expect(html).toContain("Deployment remediator");
    expect(html).toContain("Not available");
    expect(html).toContain("Webhooks");
    expect(html).toContain("Optional");
    expect(html).toContain("Set up");
    expect(html).toContain("Add optional");
    expect(html).not.toContain(">Validate<");
  });
});
