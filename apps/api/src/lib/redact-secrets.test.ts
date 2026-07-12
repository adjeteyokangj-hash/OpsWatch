import { describe, expect, it } from "vitest";
import { redactString, redactUnknown } from "./redact-secrets";

describe("redact-secrets", () => {
  it("redacts bearer tokens and secret-like fields", () => {
    expect(redactString("Authorization: Bearer abc.def.ghi")).toContain("[REDACTED]");
    expect(
      redactUnknown({
        password: "OpsWatch!2026",
        nested: { apiKey: "secret-key", message: "ok" }
      })
    ).toEqual({
      password: "[REDACTED]",
      nested: { apiKey: "[REDACTED]", message: "ok" }
    });
  });
});
