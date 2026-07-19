import { describe, expect, it } from "vitest";
import { redactRemediatorConfigForApi } from "./remediator-config";

describe("remediator-config redaction", () => {
  it("does not leak secretRef or encrypted blobs in API serialization", () => {
    const redacted = redactRemediatorConfigForApi(
      {
        REMEDIATOR_WEBHOOK_URL: "https://remediator.example/hook",
        _remediatorSecretEnc: { ciphertext: "cipher", iv: "iv", authTag: "tag" }
      },
      {
        secretRef: "env://REMEDIATOR_SECRET",
        credential: {
          configured: true,
          purpose: "REMEDIATOR",
          type: "HMAC_SECRET",
          environment: "production",
          version: 1,
          status: "ACTIVE",
          createdAt: new Date(),
          activatedAt: new Date(),
          expiresAt: null,
          graceExpiresAt: null,
          lastUsedAt: null,
          lastSuccessAt: null,
          lastFailureAt: null,
          maskedSuffix: "1234",
          keyVersion: "v1"
        }
      }
    );

    expect(redacted.secretConfigured).toBe(true);
    expect(redacted.configJson).not.toHaveProperty("_remediatorSecretEnc");
    expect(JSON.stringify(redacted)).not.toContain("env://REMEDIATOR_SECRET");
    expect(JSON.stringify(redacted)).not.toContain("cipher");
  });
});
