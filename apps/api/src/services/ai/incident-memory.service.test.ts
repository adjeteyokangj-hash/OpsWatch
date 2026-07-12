import { describe, expect, it } from "vitest";
import { buildIncidentSignatureText } from "./incident-memory.service";

describe("incident-memory.service", () => {
  it("builds a stable signature from incident context", () => {
    const signature = buildIncidentSignatureText({
      title: "Redis unavailable",
      category: "RELIABILITY",
      diagnosisSummary: "Worker cannot reach Redis",
      rootCause: "Redis pod restart loop",
      alerts: [{ title: "Worker heartbeat stale", message: "No heartbeat", sourceType: "HEARTBEAT" }],
      timeline: [{ eventType: "ALERT_OPENED", summary: "Worker alert opened" }]
    });

    expect(signature).toContain("Redis unavailable");
    expect(signature).toContain("Worker heartbeat stale");
    expect(signature).toContain("Worker alert opened");
  });
});
