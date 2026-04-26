import { describe, expect, it } from "vitest";
import { diagnose } from "./incident-ai.service";

describe("incident-ai.service", () => {
  it("maps SERVICE_DOWN to expected action chain", () => {
    const row = diagnose({ alertType: "SERVICE_DOWN" });
    expect(row.category).toBe("AVAILABILITY");
    expect(row.suggestedActions).toContain("RERUN_HTTP_CHECK");
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
