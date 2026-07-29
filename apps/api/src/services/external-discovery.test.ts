import { describe, expect, it } from "vitest";
import {
  ExternalDiscoveryParseError,
  parseExternalDiscoveryDocument
} from "./external-discovery";

const validDocument = {
  schemaVersion: "1.0",
  application: {
    name: "StarLiz Academy",
    environment: "production",
    version: "1.2.3",
    instanceId: "prod-1"
  },
  monitoringMode: "api-discovered",
  capabilities: {
    health: true,
    services: true,
    storage: false
  },
  endpoints: {
    health: "/api/external/v1/health",
    services: "/api/external/v1/services"
  },
  registry: [
    {
      key: "health",
      enabled: true,
      endpoint: "/api/external/v1/health",
      requiredScope: "api:read",
      category: "core",
      description: "Health"
    }
  ],
  opswatchTopology: {
    schemaVersion: "1.0",
    source: "starliz-academy",
    application: { key: "starliz-academy", name: "StarLiz Academy" },
    modules: [
      { key: "student-portal", name: "Student Portal", category: "portal", criticality: "HIGH", routePrefixes: ["/student"] }
    ]
  }
};

describe("parseExternalDiscoveryDocument", () => {
  it("parses a StarLiz-compatible discovery document", () => {
    const parsed = parseExternalDiscoveryDocument(validDocument);
    expect(parsed).toMatchObject({
      schemaVersion: "1.0",
      monitoringMode: "api-discovered",
      capabilities: { health: true, services: true, storage: false },
      endpoints: {
        health: "/api/external/v1/health",
        services: "/api/external/v1/services"
      }
    });
    expect(parsed.endpoints).not.toHaveProperty("storage");
    expect(parsed.registry).toHaveLength(1);
  });

  it("ignores combined topology data while still parsing capabilities", () => {
    const parsed = parseExternalDiscoveryDocument(validDocument);
    expect(parsed.capabilities.health).toBe(true);
    expect(parsed.endpoints.services).toBe("/api/external/v1/services");
  });

  it("rejects unsupported schema versions", () => {
    expect(() => parseExternalDiscoveryDocument({ ...validDocument, schemaVersion: "2.0" }))
      .toThrow(ExternalDiscoveryParseError);
  });

  it("rejects shallow ping-style JSON", () => {
    expect(() => parseExternalDiscoveryDocument({ ok: true, service: "ping" }))
      .toThrow(/schemaVersion/);
  });

  it("rejects absolute endpoint URLs", () => {
    expect(() => parseExternalDiscoveryDocument({
      ...validDocument,
      endpoints: {
        health: "https://evil.example/api/external/v1/health",
        services: "/api/external/v1/services"
      }
    })).toThrow(/same-origin path/);
  });

  it("rejects enabled capabilities without endpoints", () => {
    expect(() => parseExternalDiscoveryDocument({
      ...validDocument,
      capabilities: { health: true, jobs: true },
      endpoints: { health: "/api/external/v1/health" }
    })).toThrow(/missing endpoints\.jobs/);
  });
});
