import { describe, expect, it } from "vitest";
import { analyzeDependencyImpact } from "./dependency-impact.service";

describe("dependency-impact.service", () => {
  it("identifies upstream redis as root cause with tracking unaffected and app degraded", () => {
    const services = [
      { id: "app", name: "Noble Express", type: "APP" as const },
      { id: "quotes-module", name: "Quotes", type: "MODULE" as const },
      { id: "tracking-module", name: "Tracking", type: "MODULE" as const },
      { id: "quote-workflow", name: "Customer Quote Journey", type: "WORKFLOW" as const },
      { id: "quote-api", name: "Quote API", type: "COMPONENT" as const },
      { id: "pricing-engine", name: "Pricing Engine", type: "COMPONENT" as const },
      { id: "redis", name: "Redis", type: "COMPONENT" as const }
    ];

    const edges = [
      { fromServiceId: "quotes-module", toServiceId: "app", dependencyType: "HIERARCHY", criticality: "HIGH" },
      { fromServiceId: "tracking-module", toServiceId: "app", dependencyType: "HIERARCHY", criticality: "HIGH" },
      { fromServiceId: "quote-workflow", toServiceId: "quotes-module", dependencyType: "HIERARCHY", criticality: "HIGH" },
      { fromServiceId: "quote-api", toServiceId: "quote-workflow", dependencyType: "HIERARCHY", criticality: "HIGH" },
      { fromServiceId: "pricing-engine", toServiceId: "redis", dependencyType: "RUNTIME", criticality: "CRITICAL" },
      { fromServiceId: "quote-api", toServiceId: "pricing-engine", dependencyType: "RUNTIME", criticality: "CRITICAL" },
      { fromServiceId: "quote-workflow", toServiceId: "quote-api", dependencyType: "RUNTIME", criticality: "CRITICAL" },
      { fromServiceId: "quotes-module", toServiceId: "quote-workflow", dependencyType: "RUNTIME", criticality: "HIGH" },
      { fromServiceId: "app", toServiceId: "quotes-module", dependencyType: "RUNTIME", criticality: "HIGH" }
    ];

    const analysis = analyzeDependencyImpact({
      projectName: "Noble Express",
      services,
      edges,
      impactedServiceIds: ["quote-api", "quote-workflow", "quotes-module"],
      failingServiceIds: ["redis", "pricing-engine", "quote-api", "quote-workflow"]
    });

    expect(analysis.probableRootCause?.serviceName).toBe("Redis");
    expect(analysis.layerImpacts.find((row) => row.serviceName === "Tracking")?.status).toBe("UNAFFECTED");
    expect(analysis.layerImpacts.find((row) => row.serviceName === "Noble Express")?.status).toBe("DEGRADED");
    expect(analysis.appHealth).toBe("DEGRADED");
    expect(analysis.narrative).toContain("partially degraded");
  });
});
