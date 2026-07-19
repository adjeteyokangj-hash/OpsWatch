import { describe, expect, it } from "vitest";
import {
  canRevokeApiKey,
  canRotateApiKey,
  credentialStatusLabel,
  credentialStatusPillClass,
  deriveConnectionCredentialStatus,
  formatCredentialDateOrNever,
  maskedSecretConfiguredLabel
} from "./credential-status";

describe("credential-status", () => {
  it("maps API key statuses to labels and pill classes", () => {
    expect(credentialStatusLabel("EXPIRING_SOON")).toBe("Expiring soon");
    expect(credentialStatusLabel("ROTATION_PENDING")).toBe("Rotation pending");
    expect(credentialStatusPillClass("ACTIVE")).toBe("pass");
    expect(credentialStatusPillClass("REVOKED")).toBe("fail");
    expect(credentialStatusPillClass("EXPIRING_SOON")).toBe("warn");
  });

  it("formats missing dates as Never or N/A", () => {
    expect(formatCredentialDateOrNever(null)).toBe("Never");
    expect(formatCredentialDateOrNever("2026-07-19T10:00:00.000Z")).toMatch(/2026/);
    expect(maskedSecretConfiguredLabel(true)).toBe("Configured");
    expect(maskedSecretConfiguredLabel(false)).toBe("Not configured");
  });

  it("derives connection credential status with fallbacks", () => {
    expect(
      deriveConnectionCredentialStatus({
        isActive: true,
        secretConfigured: true,
        authMethod: "BEARER",
        credentialStatus: "ROTATION_PENDING"
      })
    ).toBe("ROTATION_PENDING");

    expect(
      deriveConnectionCredentialStatus({
        isActive: false,
        secretConfigured: true,
        authMethod: "BEARER"
      })
    ).toBe("REVOKED");

    expect(
      deriveConnectionCredentialStatus({
        isActive: true,
        secretConfigured: false,
        authMethod: "BEARER"
      })
    ).toBe("NOT_CONFIGURED");

    expect(
      deriveConnectionCredentialStatus({
        isActive: true,
        secretConfigured: true,
        authMethod: "BEARER",
        health: "UNHEALTHY"
      })
    ).toBe("CONNECTION_FAILED");
  });

  it("gates rotate and revoke actions by status", () => {
    expect(canRotateApiKey("ACTIVE")).toBe(true);
    expect(canRotateApiKey("EXPIRING_SOON")).toBe(true);
    expect(canRotateApiKey("REVOKED")).toBe(false);
    expect(canRevokeApiKey("ROTATION_PENDING")).toBe(true);
    expect(canRevokeApiKey("EXPIRED")).toBe(false);
  });
});
