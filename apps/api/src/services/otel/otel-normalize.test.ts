import { describe, expect, it } from "vitest";
import {
  normalizeOtelBatch,
  parseOtelBridgePayload,
  isValidTraceId,
  isValidSpanId
} from "./otel-normalize";
import { redactLogBody, redactSensitiveText } from "./otel-redaction";
import { evaluateOtelSignalPolicy } from "./otel-policy.service";

describe("otel normalize", () => {
  it("preserves multiple OTLP resource groups and metric data points", () => {
    const parsed = parseOtelBridgePayload({
      resourceMetrics: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "api" } },
              { key: "deployment.environment", value: { stringValue: "prod" } }
            ]
          },
          scopeMetrics: [
            {
              metrics: [
                {
                  name: "http.server.duration",
                  gauge: {
                    dataPoints: [
                      { asDouble: 10, attributes: [] },
                      { asDouble: 20, attributes: [] }
                    ]
                  }
                }
              ]
            }
          ]
        },
        {
          resource: {
            attributes: [{ key: "service.name", value: { stringValue: "worker" } }]
          },
          scopeMetrics: [
            {
              metrics: [
                {
                  name: "queue.depth",
                  sum: { dataPoints: [{ asInt: 3 }] }
                }
              ]
            }
          ]
        }
      ]
    });
    expect(parsed.error).toBeUndefined();
    expect(parsed.value?.signals).toHaveLength(3);
    expect(parsed.value?.signals.map((row) => row.value)).toEqual([10, 20, 3]);
  });

  it("rejects invalid trace/span hex ids", () => {
    expect(isValidTraceId("zzz")).toBe(false);
    expect(isValidSpanId("abcd")).toBe(false);
    expect(
      parseOtelBridgePayload({
        resource: { serviceName: "api", deploymentEnvironment: "prod" },
        signals: [{ kind: "SPAN", name: "op", traceId: "bad", spanId: "b".repeat(16) }]
      }).error
    ).toMatch(/traceId/);
  });

  it("redacts secrets from bodies and builds deterministic fingerprints", () => {
    expect(redactSensitiveText("password=supersecret token=abc")).toContain("[REDACTED]");
    expect(redactLogBody("authorization: Bearer abc123")).toContain("[REDACTED]");
    const normalized = normalizeOtelBatch({
      resource: { serviceName: "api", deploymentEnvironment: "prod" },
      signals: [
        {
          kind: "METRIC",
          name: "http.server.error_rate",
          value: 0.08,
          timestamp: "2026-07-19T10:00:00.000Z"
        }
      ]
    });
    expect(normalized.accepted).toHaveLength(1);
    const decision = evaluateOtelSignalPolicy(normalized.accepted[0]!);
    expect(decision?.shouldAlert).toBe(true);
    expect(decision?.sourceId).toMatch(/^otel:policy:/);
    const again = evaluateOtelSignalPolicy(normalized.accepted[0]!);
    expect(again?.fingerprint).toBe(decision?.fingerprint);
  });

  it("never treats stale as healthy recovery", () => {
    const normalized = normalizeOtelBatch({
      resource: { serviceName: "api", deploymentEnvironment: "prod" },
      signals: [{ kind: "METRIC", name: "http.server.error_rate", value: 0 }]
    });
    const decision = evaluateOtelSignalPolicy(normalized.accepted[0]!, { isStale: true });
    expect(decision?.health).toBe("UNKNOWN");
    expect(decision?.shouldRecover).toBe(false);
  });
});
