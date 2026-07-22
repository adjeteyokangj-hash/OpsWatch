import { describe, expect, it } from "vitest";
import {
  parseSignedRuntimeEvidence,
  runtimeEvidenceCheckStatus,
} from "./signed-runtime-evidence.service";

const payload = {
  opswatchEvidence: {
    schemaVersion: "1.0",
    source: "truenumeris-runtime",
    generatedAt: "2026-07-22T15:00:00.000Z",
    applicationStatus: "HEALTHY",
    summary: "TrueNumeris runtime evidence is healthy.",
    components: [
      {
        key: "api-server",
        name: "TrueNumeris API",
        serviceType: "API",
        status: "HEALTHY",
        criticality: "HIGH",
        summary: "The TrueNumeris API process is running.",
        metrics: { uptimeSeconds: 120, memoryRssMb: 180 },
      },
      {
        key: "postgresql-database",
        name: "PostgreSQL Database",
        serviceType: "DATABASE",
        status: "DEGRADED",
        criticality: "HIGH",
        summary: "PostgreSQL latency is elevated.",
        metrics: { latencyMs: 950 },
      },
    ],
    dependencies: [
      {
        key: "api-to-database",
        source: { name: "TrueNumeris API", type: "API" },
        target: { name: "PostgreSQL Database", type: "DATABASE" },
        criticality: "HIGH",
        summary: "The API depends on PostgreSQL.",
      },
    ],
  },
};

describe("signed runtime evidence", () => {
  it("parses bounded runtime evidence", () => {
    const parsed = parseSignedRuntimeEvidence(payload);
    expect(parsed?.source).toBe("truenumeris-runtime");
    expect(parsed?.components).toHaveLength(2);
    expect(parsed?.components[1]).toMatchObject({
      key: "postgresql-database",
      status: "DEGRADED",
      metrics: { latencyMs: 950 },
    });
    expect(parsed?.dependencies[0]).toMatchObject({
      key: "api-to-database",
      source: { type: "API" },
      target: { type: "DATABASE" },
    });
  });

  it("returns null when no runtime evidence is present", () => {
    expect(parseSignedRuntimeEvidence({ component: "legacy-heartbeat" })).toBeNull();
  });

  it("rejects unsupported sources and unsafe endpoint types", () => {
    expect(() =>
      parseSignedRuntimeEvidence({
        opswatchEvidence: { ...payload.opswatchEvidence, source: "untrusted-runtime" },
      })
    ).toThrow(/Unsupported runtime evidence source/);

    expect(() =>
      parseSignedRuntimeEvidence({
        opswatchEvidence: {
          ...payload.opswatchEvidence,
          dependencies: [
            {
              ...payload.opswatchEvidence.dependencies[0],
              target: { name: "Shell", type: "HOST" },
            },
          ],
        },
      })
    ).toThrow(/supported runtime endpoint type/);
  });

  it("maps evidence status into the existing check-result contract", () => {
    expect(runtimeEvidenceCheckStatus("HEALTHY")).toBe("PASS");
    expect(runtimeEvidenceCheckStatus("DEGRADED")).toBe("WARN");
    expect(runtimeEvidenceCheckStatus("DOWN")).toBe("FAIL");
  });

  it("rejects duplicate component identities", () => {
    expect(() =>
      parseSignedRuntimeEvidence({
        opswatchEvidence: {
          ...payload.opswatchEvidence,
          components: [
            payload.opswatchEvidence.components[0],
            payload.opswatchEvidence.components[0],
          ],
        },
      })
    ).toThrow(/Duplicate component key/);
  });
});
