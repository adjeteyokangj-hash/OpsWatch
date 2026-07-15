import { afterEach, describe, expect, it } from "vitest";
import {
  isOtelIngestionEnabled,
  parseOtelBridgePayload,
  redactOtelAttributes
} from "./otel-bridge.service";

describe("OpenTelemetry bridge contract", () => {
  const originalEnabled = process.env.OPSWATCH_OTEL_INGESTION_ENABLED;

  afterEach(() => {
    if (originalEnabled === undefined) delete process.env.OPSWATCH_OTEL_INGESTION_ENABLED;
    else process.env.OPSWATCH_OTEL_INGESTION_ENABLED = originalEnabled;
  });

  it("is disabled unless explicitly enabled", () => {
    delete process.env.OPSWATCH_OTEL_INGESTION_ENABLED;
    expect(isOtelIngestionEnabled()).toBe(false);
    process.env.OPSWATCH_OTEL_INGESTION_ENABLED = "true";
    expect(isOtelIngestionEnabled()).toBe(true);
  });

  it("drops sensitive and non-allowlisted attributes", () => {
    expect(redactOtelAttributes({
      "http.method": "POST",
      authorization: "Bearer do-not-store",
      "user.email": "person@example.test",
      "custom.internal": "not-stored"
    }, (key) => key === "http.method" || key === "authorization" || key === "user.email")).toEqual({
      "http.method": "POST"
    });
  });

  it("normalizes a generic document-platform OTLP/HTTP batch", () => {
    const parsed = parseOtelBridgePayload({
      resourceMetrics: [{
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: "document-api" } },
            { key: "deployment.environment", value: { stringValue: "staging" } },
            { key: "service.version", value: { stringValue: "2026.07" } }
          ]
        },
        scopeMetrics: [{
          metrics: [{
            name: "document.upload.duration",
            gauge: { dataPoints: [{ asDouble: 42.5, attributes: [{ key: "http.method", value: { stringValue: "POST" } }] }] }
          }]
        }]
      }]
    });

    expect(parsed.error).toBeUndefined();
    expect(parsed.value).toMatchObject({
      resource: { serviceName: "document-api", deploymentEnvironment: "staging", serviceVersion: "2026.07" },
      signals: [{ kind: "METRIC", name: "document.upload.duration", value: 42.5 }]
    });
  });

  it("rejects batches without a service identity", () => {
    expect(parseOtelBridgePayload({ resource: {}, signals: [] }).error).toMatch(/resource\.serviceName/);
  });
});
