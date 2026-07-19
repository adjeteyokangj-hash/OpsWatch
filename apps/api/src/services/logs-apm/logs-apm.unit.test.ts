import { describe, expect, it } from "vitest";
import { assertNoSecrets, redactDeep, redactLogPayload } from "./log-redaction";
import {
  buildLogFingerprint,
  extractExceptionClass,
  normalizeLogMessage
} from "./log-fingerprint";
import { evaluateApmHealth } from "./apm-health.service";

describe("Phase 6 log redaction", () => {
  it("redacts nested secrets and payment cards without retaining originals", () => {
    const result = redactLogPayload({
      body: "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc password=hunter2 card 4111-1111-1111-1111",
      attributes: {
        "http.method": "POST",
        authorization: "Bearer secret-token",
        nested: { api_key: "sk_live_abc", safe: "ok" }
      },
      resourceAttributes: { "service.name": "checkout", cookie: "sid=abc" }
    });

    const serialized = JSON.stringify(result);
    expect(serialized.toLowerCase()).not.toContain("hunter2");
    expect(serialized.toLowerCase()).not.toContain("sk_live_abc");
    expect(serialized.toLowerCase()).not.toContain("secret-token");
    expect(serialized).not.toContain("4111-1111-1111-1111");
    expect(result.redactionStatus).toBe("REDACTED");
    expect(result.redactionMeta.fieldsRedacted.length).toBeGreaterThan(0);
    expect(result.attributes["http.method"]).toBe("POST");
    assertNoSecrets(result);
  });

  it("handles binary/malformed values safely", () => {
    const { value } = redactDeep("hello\u0000world");
    expect(value).toBe("[REDACTED_BINARY]");
  });
});

describe("Phase 6 log fingerprinting", () => {
  it("normalizes volatile tokens so repeats share a fingerprint", () => {
    const a = normalizeLogMessage("Timeout for request 55a1b2c3-d4e5-6789-abcd-ef0123456789 after 120ms");
    const b = normalizeLogMessage("Timeout for request 11111111-2222-4333-8444-555555555555 after 999ms");
    expect(a).toBe(b);
    const fpA = buildLogFingerprint({
      projectId: "p1",
      environment: "prod",
      entityId: "e1",
      severity: "HIGH",
      normalizedMessage: a,
      exceptionClass: extractExceptionClass("Unhandled NullPointerException", {}),
      operation: "/checkout"
    });
    const fpB = buildLogFingerprint({
      projectId: "p1",
      environment: "prod",
      entityId: "e1",
      severity: "HIGH",
      normalizedMessage: b,
      exceptionClass: "NullPointerException",
      operation: "/checkout"
    });
    expect(fpA).toBe(fpB);
  });

  it("does not group unrelated messages that merely look similar", () => {
    const fpA = buildLogFingerprint({
      projectId: "p1",
      environment: "prod",
      entityId: "e1",
      severity: "HIGH",
      normalizedMessage: normalizeLogMessage("database connection refused"),
      exceptionClass: null,
      operation: null
    });
    const fpB = buildLogFingerprint({
      projectId: "p1",
      environment: "prod",
      entityId: "e1",
      severity: "HIGH",
      normalizedMessage: normalizeLogMessage("payment gateway connection refused"),
      exceptionClass: null,
      operation: null
    });
    expect(fpA).not.toBe(fpB);
  });
});

describe("Phase 6 APM health", () => {
  it("returns UNKNOWN for insufficient samples", () => {
    const result = evaluateApmHealth({
      errorRate: 0,
      latencyP95Ms: null,
      sampleCount: 1,
      freshUntil: new Date(Date.now() + 60_000),
      now: new Date()
    });
    expect(result.health).toBe("UNKNOWN");
    expect(result.evidence.messages.join(" ")).toMatch(/Insufficient samples/i);
  });

  it("marks CRITICAL when error rate exceeds threshold", () => {
    const result = evaluateApmHealth({
      errorRate: 0.5,
      latencyP95Ms: 100,
      sampleCount: 20,
      freshUntil: new Date(Date.now() + 60_000),
      now: new Date()
    });
    expect(result.health).toBe("CRITICAL");
    expect(result.evidence.messages.join(" ")).toMatch(/Error rate exceeds baseline|Threshold exceeded/);
  });

  it("marks UNKNOWN when evidence is stale", () => {
    const result = evaluateApmHealth({
      errorRate: 0,
      latencyP95Ms: 10,
      sampleCount: 20,
      freshUntil: new Date(Date.now() - 60_000),
      now: new Date()
    });
    expect(result.health).toBe("UNKNOWN");
  });

  it("reports above normal latency without calling it a prediction", () => {
    const result = evaluateApmHealth({
      errorRate: 0,
      latencyP95Ms: 300,
      sampleCount: 20,
      baselineLatencyP95Ms: 100,
      freshUntil: new Date(Date.now() + 60_000),
      now: new Date()
    });
    expect(result.health).toBe("DEGRADED");
    expect(result.evidence.messages.join(" ")).toMatch(/Above normal latency/);
    expect(JSON.stringify(result).toLowerCase()).not.toContain("prediction");
  });
});
