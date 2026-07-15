import { describe, expect, it } from "vitest";
import {
  getConnectionManifest,
  hasInlineSecret,
  negotiateCapabilities,
  validateConnectionConfiguration,
  validateConnectionInput
} from "./connection-manifest.service";

describe("connection manifest", () => {
  it("negotiates only capabilities offered by the selected mode", () => {
    expect(negotiateCapabilities("AGENTLESS", ["health_check", "traces"])).toEqual({
      accepted: ["health_check"],
      rejected: ["traces"],
      required: ["health_check"]
    });
  });

  it("does not accept raw credentials in configuration", () => {
    expect(hasInlineSecret({ endpoint: "https://example.test", password: "not-allowed" })).toBe(true);
    expect(validateConnectionInput({
      mode: "API",
      authMethod: "BEARER",
      configuration: { endpoint: "https://example.test", token: "not-allowed" }
    })).toMatch(/secret material/);
  });

  it("allows a secure reference and enforces the declared mode auth contract", () => {
    expect(validateConnectionInput({
      mode: "OTEL_COLLECTOR",
      authMethod: "API_KEY",
      capabilities: ["telemetry_ingest", "traces"],
      configuration: { serviceName: "document-api" },
      secretRef: "vault://opswatch/collector"
    })).toBeNull();
    expect(getConnectionManifest("OTEL_COLLECTOR").supportedAuthMethods).not.toContain("NONE");
  });

  it("requires the selected mode's mandatory capabilities", () => {
    expect(validateConnectionInput({
      mode: "HEARTBEAT",
      authMethod: "HMAC",
      capabilities: []
    })).toBe("missing required capabilities: heartbeat");
  });

  it("declares only implemented agentless capabilities and validates probe configuration", () => {
    const manifest = getConnectionManifest("AGENTLESS");
    expect(manifest.availableCapabilities).toEqual(["health_check", "latency"]);
    expect(manifest.foundationHooks.every((hook) => hook.supported === false)).toBe(true);
    expect(validateConnectionConfiguration("AGENTLESS", {
      endpoint: "https://status.example.test/health",
      method: "POST"
    })).toEqual({ valid: false, error: "configuration.method must be GET or HEAD" });
  });
});
