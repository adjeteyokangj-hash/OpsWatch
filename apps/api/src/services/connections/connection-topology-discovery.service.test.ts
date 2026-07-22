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
});
