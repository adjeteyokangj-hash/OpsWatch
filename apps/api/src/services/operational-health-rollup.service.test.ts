import { afterEach, describe, expect, it } from "vitest";
import {
  computeOperationalHealthRollup,
  isActiveApprovedRelationship,
  isLearnedTopologyEnabled
} from "./operational-health-rollup.service";

describe("operational-health-rollup.service", () => {
  const originalFlag = process.env.OPSWATCH_LEARNED_TOPOLOGY_ENABLED;

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.OPSWATCH_LEARNED_TOPOLOGY_ENABLED;
    else process.env.OPSWATCH_LEARNED_TOPOLOGY_ENABLED = originalFlag;
  });

  it("keeps learned topology disabled unless explicitly enabled", () => {
    delete process.env.OPSWATCH_LEARNED_TOPOLOGY_ENABLED;
    expect(isLearnedTopologyEnabled()).toBe(false);
    process.env.OPSWATCH_LEARNED_TOPOLOGY_ENABLED = "true";
    expect(isLearnedTopologyEnabled()).toBe(true);
  });

  it("does not mark a system DOWN when only an OPTIONAL non-critical dependency fails", () => {
    const snapshot = computeOperationalHealthRollup({
      topologyMode: "CENTRALISED",
      entities: [
        { id: "system", name: "Checkout", health: "HEALTHY" },
        { id: "optional-cache", name: "Nice-to-have cache", health: "DOWN" }
      ],
      relationships: [
        {
          id: "rel-optional",
          sourceEntityId: "system",
          targetEntityId: "optional-cache",
          relationshipType: "RUNTIME",
          impactRole: "OPTIONAL",
          approvalStatus: "APPROVED",
          lifecycle: "ACTIVE"
        }
      ]
    });

    const system = snapshot.entities.find((row) => row.entityId === "system");
    expect(system?.currentHealth).toBe("AT_RISK");
    expect(system?.currentHealth).not.toBe("DOWN");
    // Optional leaf remains DOWN itself; the dependent system must not escalate to DOWN.
    expect(snapshot.entities.find((row) => row.entityId === "optional-cache")?.currentHealth).toBe("DOWN");
  });

  it("degrades a workflow when a REQUIRED dependency is DOWN", () => {
    const snapshot = computeOperationalHealthRollup({
      entities: [
        { id: "workflow", name: "Quote workflow", health: "HEALTHY" },
        { id: "pricing", name: "Pricing API", health: "DOWN" }
      ],
      relationships: [
        {
          id: "rel-required",
          sourceEntityId: "workflow",
          targetEntityId: "pricing",
          relationshipType: "RUNTIME",
          impactRole: "REQUIRED",
          approvalStatus: "APPROVED",
          lifecycle: "ACTIVE",
          confidence: 0.9,
          lastObservedAt: "2026-07-15T12:00:00.000Z"
        }
      ]
    });

    const workflow = snapshot.entities.find((row) => row.entityId === "workflow");
    expect(workflow?.currentHealth).toBe("DEGRADED");
    expect(workflow?.contributingEntityIds).toContain("pricing");
    expect(workflow?.dependencyCause).toMatch(/REQUIRED/);
    expect(workflow?.evidenceTimestamp).toBe("2026-07-15T12:00:00.000Z");
  });

  it("marks parent DOWN when a BUSINESS_CRITICAL dependency is DOWN", () => {
    const snapshot = computeOperationalHealthRollup({
      entities: [
        { id: "system", health: "HEALTHY" },
        { id: "payments", health: "DOWN" }
      ],
      relationships: [
        {
          id: "rel-bc",
          sourceEntityId: "system",
          targetEntityId: "payments",
          relationshipType: "RUNTIME",
          impactRole: "BUSINESS_CRITICAL",
          approvalStatus: "APPROVED",
          lifecycle: "ACTIVE"
        }
      ]
    });
    expect(snapshot.entities.find((row) => row.entityId === "system")?.currentHealth).toBe("DOWN");
  });

  it("ignores pending LEARNED edges in roll-up", () => {
    const snapshot = computeOperationalHealthRollup({
      entities: [
        { id: "system", health: "HEALTHY" },
        { id: "ghost", health: "DOWN" }
      ],
      relationships: [
        {
          id: "rel-pending",
          sourceEntityId: "system",
          targetEntityId: "ghost",
          relationshipType: "RUNTIME",
          impactRole: "REQUIRED",
          provenance: "LEARNED",
          approvalStatus: "PENDING",
          lifecycle: "ACTIVE"
        }
      ]
    });

    expect(isActiveApprovedRelationship({
      id: "rel-pending",
      sourceEntityId: "system",
      targetEntityId: "ghost",
      relationshipType: "RUNTIME",
      approvalStatus: "PENDING",
      lifecycle: "ACTIVE"
    })).toBe(false);
    expect(snapshot.entities.find((row) => row.entityId === "system")?.currentHealth).toBe("HEALTHY");
  });

  it("ignores rejected relationships which stay inactive", () => {
    const snapshot = computeOperationalHealthRollup({
      entities: [
        { id: "system", health: "HEALTHY" },
        { id: "bad", health: "DOWN" }
      ],
      relationships: [
        {
          id: "rel-rejected",
          sourceEntityId: "system",
          targetEntityId: "bad",
          relationshipType: "RUNTIME",
          impactRole: "BUSINESS_CRITICAL",
          provenance: "LEARNED",
          approvalStatus: "REJECTED",
          lifecycle: "INACTIVE"
        }
      ]
    });
    expect(snapshot.entities.find((row) => row.entityId === "system")?.currentHealth).toBe("HEALTHY");
  });

  it("requires all REDUNDANT peers DOWN before escalating", () => {
    const partial = computeOperationalHealthRollup({
      entities: [
        { id: "system", health: "HEALTHY" },
        { id: "replica-a", health: "DOWN" },
        { id: "replica-b", health: "HEALTHY" }
      ],
      relationships: [
        {
          id: "r1",
          sourceEntityId: "system",
          targetEntityId: "replica-a",
          relationshipType: "RUNTIME",
          impactRole: "REDUNDANT",
          approvalStatus: "APPROVED",
          lifecycle: "ACTIVE"
        },
        {
          id: "r2",
          sourceEntityId: "system",
          targetEntityId: "replica-b",
          relationshipType: "RUNTIME",
          impactRole: "REDUNDANT",
          approvalStatus: "APPROVED",
          lifecycle: "ACTIVE"
        }
      ]
    });
    expect(partial.entities.find((row) => row.entityId === "system")?.currentHealth).toBe("HEALTHY");

    const allDown = computeOperationalHealthRollup({
      entities: [
        { id: "system", health: "HEALTHY" },
        { id: "replica-a", health: "DOWN" },
        { id: "replica-b", health: "DOWN" }
      ],
      relationships: [
        {
          id: "r1",
          sourceEntityId: "system",
          targetEntityId: "replica-a",
          relationshipType: "RUNTIME",
          impactRole: "REDUNDANT",
          approvalStatus: "APPROVED",
          lifecycle: "ACTIVE"
        },
        {
          id: "r2",
          sourceEntityId: "system",
          targetEntityId: "replica-b",
          relationshipType: "RUNTIME",
          impactRole: "REDUNDANT",
          approvalStatus: "APPROVED",
          lifecycle: "ACTIVE"
        }
      ]
    });
    expect(allDown.entities.find((row) => row.entityId === "system")?.currentHealth).toBe("DEGRADED");
  });

  it("respects healthOverride over dependency escalation", () => {
    const snapshot = computeOperationalHealthRollup({
      entities: [
        { id: "system", health: "HEALTHY", healthOverride: "MAINTENANCE" },
        { id: "db", health: "DOWN" }
      ],
      relationships: [
        {
          id: "rel",
          sourceEntityId: "system",
          targetEntityId: "db",
          relationshipType: "RUNTIME",
          impactRole: "BUSINESS_CRITICAL",
          approvalStatus: "APPROVED",
          lifecycle: "ACTIVE"
        }
      ]
    });
    const system = snapshot.entities.find((row) => row.entityId === "system");
    expect(system?.overrideApplied).toBe(true);
    expect(system?.currentHealth).toBe("MAINTENANCE");
    expect(system?.dependencyCause).toBeNull();
  });

  it("rolls up locations and centralised org health with org-scoped entities only", () => {
    const snapshot = computeOperationalHealthRollup({
      topologyMode: "HYBRID",
      entities: [
        { id: "central-api", health: "HEALTHY", operationalLocationId: null, organizationId: "org-a" },
        { id: "branch-pos", health: "DOWN", operationalLocationId: "loc-1", organizationId: "org-a" }
      ],
      relationships: []
    });

    expect(snapshot.locations.find((row) => row.locationId === "loc-1")?.health).toBe("DOWN");
    expect(snapshot.locations.find((row) => row.locationId === null)?.health).toBe("HEALTHY");
    expect(snapshot.organization.topologyMode).toBe("HYBRID");
    expect(snapshot.organization.health).toBe("DOWN");
  });
});
