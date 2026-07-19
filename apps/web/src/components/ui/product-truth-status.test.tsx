import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { projectTestDataState } from "../projects/project-workspace-shell";
import { canonicalDiscoveryLabel } from "../topology/topology-types";
import { PRODUCT_TRUTH_STATES, ProductTruthStatus } from "./product-truth-status";

afterEach(cleanup);

describe("Phase 5 shared product truth", () => {
  it("keeps the approved shared vocabulary stable", () => {
    expect(PRODUCT_TRUTH_STATES).toEqual([
      "Foundation",
      "Preview",
      "Draft",
      "Not configured",
      "Feature disabled",
      "Requires connection",
      "Test data",
      "Live verified"
    ]);
    render(<ProductTruthStatus state="Feature disabled" detail="No product emission" />);
    expect(screen.getByText("Feature disabled")).toHaveAttribute("title", "No product emission");
  });

  it("uses explicit environment and provenance for test-data diagnostics", () => {
    expect(projectTestDataState({ environment: "test", services: [] })).toBe("test-application");
    expect(
      projectTestDataState({
        environment: "production",
        services: [{ provenance: "SEED" }]
      })
    ).toBe("mixed-non-test");
    expect(
      projectTestDataState({
        environment: "production",
        name: "Demo-looking name",
        services: [{ name: "seed-looking service", provenance: "DECLARED" }]
      })
    ).toBeNull();
  });

  it("maps canonical provenance, freshness, and confirmation to approved discovery labels", () => {
    const base = {
      environment: "production",
      entityType: "SERVICE",
      provenance: "DECLARED",
      discoverySource: null,
      discoveryState: "DECLARED",
      freshness: "FRESH" as const,
      confidence: null,
      confirmationState: "UNCONFIRMED",
      sharedScope: "PROJECT",
      isTestSeed: false,
      legacyServiceId: "service-1",
      location: null
    };
    expect(canonicalDiscoveryLabel(base)).toBe("Declared");
    expect(canonicalDiscoveryLabel({ ...base, provenance: "OTEL_DISCOVERED", legacyServiceId: null })).toBe("Discovered");
    expect(canonicalDiscoveryLabel({ ...base, confirmationState: "MANUALLY_CONFIRMED" })).toBe("Manually confirmed");
    expect(canonicalDiscoveryLabel({ ...base, freshness: "STALE" })).toBe("Stale");
    expect(canonicalDiscoveryLabel({ ...base, isTestSeed: true })).toBe("Test/seed data");
    expect(canonicalDiscoveryLabel(undefined)).toBe("Discovery pending");
  });
});
