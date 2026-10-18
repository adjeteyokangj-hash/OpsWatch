import { describe, expect, it } from "vitest";
import { parseConnectionTopologyManifest } from "./connection-topology-discovery.service";

const payload = {
  ok: true,
  data: {
    status: "ok",
    opswatchTopology: {
      schemaVersion: "1.0",
      source: "truenumeris",
      application: { key: "truenumeris", name: "TrueNumeris" },
      modules: [
        {
          key: "sales",
          name: "Sales",
          category: "operations",
          description: "Sales operations",
          criticality: "HIGH",
          routePrefixes: ["/dashboard/sales", "/dashboard/invoices"]
        },
        {
          key: "reports",
          name: "Reports",
          description: "Reporting operations",
          criticality: "MEDIUM",
          routePrefixes: ["/dashboard/reports"]
        }
      ]
    }
  }
};

describe("parseConnectionTopologyManifest", () => {
  it("reads a versioned manifest from the authenticated discovery wrapper", () => {
    const manifest = parseConnectionTopologyManifest(payload);

    expect(manifest?.source).toBe("truenumeris");
    expect(manifest?.application.name).toBe("TrueNumeris");
    expect(manifest?.modules.map((module) => module.key)).toEqual(["sales", "reports"]);
    expect(manifest?.modules[0]?.routePrefixes).toEqual([
      "/dashboard/sales",
      "/dashboard/invoices"
    ]);
  });

  it("returns null when the provider has no topology contract", () => {
    expect(parseConnectionTopologyManifest({ ok: true, data: { status: "ok" } })).toBeNull();
  });

  it("reads a top-level opswatchTopology payload from a combined discovery document", () => {
    const manifest = parseConnectionTopologyManifest({
      schemaVersion: "1.0",
      monitoringMode: "api-discovered",
      capabilities: { health: true },
      endpoints: { health: "/api/external/v1/health" },
      opswatchTopology: payload.data.opswatchTopology
    });

    expect(manifest?.modules[0]?.category).toBe("operations");
    expect(manifest?.modules[0]?.name).toBe("Sales");
  });

  it("rejects duplicate module identities", () => {
    const duplicate = structuredClone(payload);
    duplicate.data.opswatchTopology.modules[1]!.key = "sales";

    expect(() => parseConnectionTopologyManifest(duplicate)).toThrow(/Duplicate module key/);
  });

  it("rejects unknown schema versions", () => {
    const unsupported = structuredClone(payload) as any;
    unsupported.data.opswatchTopology.schemaVersion = "2.0";

    expect(() => parseConnectionTopologyManifest(unsupported)).toThrow(/Unsupported/);
  });

  it("drops unsafe route prefixes without rejecting the module", () => {
    const routes = structuredClone(payload);
    routes.data.opswatchTopology.modules[0]!.routePrefixes = [
      "/dashboard/sales",
      "https://malicious.example",
      "//evil.example"
    ];

    expect(parseConnectionTopologyManifest(routes)?.modules[0]?.routePrefixes).toEqual([
      "/dashboard/sales"
    ]);
  });

  it("keeps a version 1.0 manifest free of the extended fields' requirements", () => {
    const manifest = parseConnectionTopologyManifest(payload);
    expect(manifest?.schemaVersion).toBe("1.0");
    expect(manifest?.components).toEqual([]);
    expect(manifest?.relationships).toEqual([]);
    expect(manifest?.healthBindings).toEqual([]);
  });

  it("reads components, relationships and health bindings from a version 1.1 fixture", () => {
    const manifest = parseConnectionTopologyManifest({
      opswatchTopology: {
        schemaVersion: "1.1",
        source: "harbor-ledger",
        application: { key: "harbor-ledger", name: "Harbor Ledger" },
        modules: [{ key: "invoices", name: "Invoices", criticality: "HIGH" }],
        components: [
          { key: "warehouse", name: "North Warehouse", kind: "property" },
          { key: "desk", name: "Counter desk", kind: "installation", parentKey: "warehouse" },
          { key: "month-end", name: "Month end", kind: "workflow", parentKey: "invoices" }
        ],
        relationships: [
          { from: "month-end", to: "invoices", type: "depends_on", provenance: "verified" },
          { from: "desk", to: "warehouse", type: "runs_on", provenance: "configured" }
        ],
        healthBindings: [
          { componentKey: "month-end", signal: "heartbeat_lane", lane: "financial" },
          { componentKey: "warehouse", signal: "unbound" }
        ]
      }
    });

    expect(manifest?.components?.map((component) => component.kind)).toEqual([
      "property",
      "installation",
      "workflow"
    ]);
    expect(manifest?.relationships?.[1]?.provenance).toBe("configured");
    expect(manifest?.healthBindings?.[0]?.lane).toBe("financial");
  });

  it("rejects inferred relationships and version 1.0 documents that carry components", () => {
    expect(() => parseConnectionTopologyManifest({
      opswatchTopology: {
        schemaVersion: "1.1",
        source: "harbor-ledger",
        application: { key: "harbor-ledger", name: "Harbor Ledger" },
        modules: [{ key: "invoices", name: "Invoices" }],
        relationships: [{ from: "invoices", to: "harbor-ledger", type: "depends_on", provenance: "inferred" }]
      }
    })).toThrow(/provenance/);

    expect(() => parseConnectionTopologyManifest({
      opswatchTopology: {
        schemaVersion: "1.0",
        source: "harbor-ledger",
        application: { key: "harbor-ledger", name: "Harbor Ledger" },
        modules: [{ key: "invoices", name: "Invoices" }],
        components: [{ key: "desk", name: "Counter desk", kind: "installation" }]
      }
    })).toThrow(/schema version 1.1/);
  });
});
