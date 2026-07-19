import { describe, expect, it } from "vitest";
import { redactUnknown } from "../../lib/redact-secrets";
import { getUniversalAction } from "./action-registry";

describe("Phase 7 security and isolation guards", () => {
  it("never includes secrets in sanitised provider evidence payloads", () => {
    const redacted = redactUnknown({
      token: "super-secret",
      authorization: "Bearer abc",
      password: "p@ss",
      nested: { apiKey: "key-1", ok: true }
    }) as Record<string, unknown>;
    expect(JSON.stringify(redacted)).not.toMatch(/super-secret|Bearer abc|p@ss|key-1/);
  });

  it("keeps critical risk unsupported and payment retry disabled", () => {
    expect(getUniversalAction("RETRY_PAYMENT_VERIFICATION")).toBeTruthy();
    expect(getUniversalAction("RETRY_PAYMENT_VERIFICATION")?.enabled).toBe(false);
  });

  it("requires approval for medium/high risk actions in the registry", () => {
    expect(getUniversalAction("RESTART_WORKER")?.requiresApproval).toBe(true);
    expect(getUniversalAction("ROLLBACK_DEPLOYMENT")?.requiresApproval).toBe(true);
    expect(getUniversalAction("REENABLE_CONNECTION")?.requiresApproval).toBe(true);
    expect(getUniversalAction("TEST_CONNECTION")?.requiresApproval).toBe(false);
  });
});
