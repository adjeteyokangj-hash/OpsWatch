import { describe, expect, it } from "vitest";
import { diagnose } from "./incident-ai.service";

describe("incident-ai.service", () => {
  it("maps SERVICE_DOWN to network-unreachable style diagnosis", () => {
    const row = diagnose({ alertType: "SERVICE_DOWN" });
    expect(row.category).toBe("AVAILABILITY");
    expect(row.suggestedActions).toContain("RERUN_HTTP_CHECK");
  });

  it("classifies expected 503 got 200 as HTTP status mismatch", () => {
    const row = diagnose({
      message: "Expected 503 got 200",
      expectedStatusCode: 503,
      actualStatusCode: 200
    });
    expect(row.failureClass).toBe("HTTP_STATUS_MISMATCH");
    expect(row.diagnosis).toContain("responded successfully");
    expect(row.confidence).toBeGreaterThanOrEqual(0.95);
    expect(row.possibleCauses).toContain("Health check expectation is misconfigured");
  });

  it("classifies expected 200 got 500 as application error", () => {
    const row = diagnose({ expectedStatusCode: 200, actualStatusCode: 500 });
    expect(row.failureClass).toBe("APPLICATION_ERROR");
    expect(row.suggestedActions).toContain("RESTART_SERVICE");
  });

  it("maps WEBHOOK_FAILED to retry + diagnostics", () => {
    const row = diagnose({ alertType: "WEBHOOK_FAILED" });
    expect(row.category).toBe("RELIABILITY");
    expect(row.suggestedActions).toEqual(
      expect.arrayContaining(["RETRY_WEBHOOKS", "CHECK_PROVIDER_STATUS"])
    );
  });

  it("maps AUTH_FAILURE_SPIKE to security response", () => {
    const row = diagnose({ alertType: "AUTH_FAILURE_SPIKE" });
    expect(row.category).toBe("SECURITY");
    expect(row.suggestedActions).toContain("REQUEST_HUMAN_REVIEW");
  });
});
