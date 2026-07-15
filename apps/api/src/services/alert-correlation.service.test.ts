import { describe, expect, it } from "vitest";
import {
  assessFlapping,
  buildAlertFingerprint,
  buildIncidentFingerprint,
  canReopenIncident,
  classifySignalLayer,
  groupCorrelatedAlertsAdvanced,
  labelRcaConfidence,
  rankScenarioACandidates
} from "./alert-correlation.service";
import { retailCheckoutFixture } from "../fixtures/retail-checkout.fixture";

describe("alert-correlation.service (phase 6)", () => {
  it("builds stable alert fingerprints", () => {
    const a = buildAlertFingerprint({
      projectId: "p1",
      serviceId: "svc-pay",
      sourceType: "HTTP_CHECK",
      sourceId: "check-1",
      title: "Payment API unhealthy"
    });
    const b = buildAlertFingerprint({
      projectId: "p1",
      serviceId: "svc-pay",
      sourceType: "HTTP_CHECK",
      sourceId: "check-1",
      title: "Payment API unhealthy"
    });
    expect(a).toBe(b);
    expect(a).toHaveLength(32);
  });

  it("classifies signal vs alert vs correlated incident layers", () => {
    expect(classifySignalLayer({ hasLinkedIncident: false, correlatedAlertCount: 0 })).toBe("SIGNAL");
    expect(classifySignalLayer({ hasLinkedIncident: true, correlatedAlertCount: 1 })).toBe("ALERT");
    expect(classifySignalLayer({ hasLinkedIncident: true, correlatedAlertCount: 3 })).toBe(
      "CORRELATED_INCIDENT"
    );
  });

  it("detects flapping from high occurrence within window", () => {
    const firstSeenAt = new Date("2026-07-15T10:00:00Z");
    const lastSeenAt = new Date("2026-07-15T10:20:00Z");
    const flapping = assessFlapping({
      occurrenceCount: 6,
      firstSeenAt,
      lastSeenAt,
      now: new Date("2026-07-15T10:25:00Z")
    });
    expect(flapping.isFlapping).toBe(true);

    const calm = assessFlapping({
      occurrenceCount: 2,
      firstSeenAt,
      lastSeenAt,
      now: new Date("2026-07-15T10:25:00Z")
    });
    expect(calm.isFlapping).toBe(false);
  });

  it("enforces reopen cooldown", () => {
    const resolvedAt = new Date("2026-07-15T12:00:00Z");
    const blocked = canReopenIncident({
      resolvedAt,
      now: new Date("2026-07-15T12:05:00Z")
    });
    expect(blocked.allowed).toBe(false);

    const allowed = canReopenIncident({
      resolvedAt,
      now: new Date("2026-07-15T12:20:00Z")
    });
    expect(allowed.allowed).toBe(true);
  });

  it("groups by dependency component, shared fingerprint, and shared change event", () => {
    const now = new Date("2026-07-15T14:00:00Z");
    const groups = groupCorrelatedAlertsAdvanced(
      [
        {
          id: "a1",
          projectId: "p1",
          serviceId: "checkout",
          severity: "HIGH",
          title: "Checkout degraded",
          sourceType: "HTTP_CHECK",
          fingerprint: "fp-checkout",
          firstSeenAt: now
        },
        {
          id: "a2",
          projectId: "p1",
          serviceId: "payment-api",
          severity: "CRITICAL",
          title: "Payment API down",
          sourceType: "HTTP_CHECK",
          fingerprint: "fp-pay",
          firstSeenAt: new Date(now.getTime() + 60_000),
          changeEventId: "chg-1"
        },
        {
          id: "a3",
          projectId: "p1",
          serviceId: "payment-provider",
          severity: "CRITICAL",
          title: "External payment provider failing",
          sourceType: "PROVIDER_STATUS",
          fingerprint: "fp-ext",
          firstSeenAt: new Date(now.getTime() + 90_000),
          changeEventId: "chg-1"
        },
        {
          id: "a4",
          projectId: "p1",
          serviceId: "unrelated",
          severity: "LOW",
          title: "Unrelated cache miss",
          sourceType: "HTTP_CHECK",
          fingerprint: "fp-other",
          firstSeenAt: new Date(now.getTime() + 120_000)
        }
      ],
      [
        { fromServiceId: "checkout", toServiceId: "payment-api" },
        { fromServiceId: "payment-api", toServiceId: "payment-provider" }
      ]
    );

    const checkoutGroup = groups.find((g) => g.some((a) => a.id === "a1"));
    expect(checkoutGroup?.map((a) => a.id).sort()).toEqual(["a1", "a2", "a3"]);
    expect(groups.some((g) => g.length === 1 && g[0]!.id === "a4")).toBe(true);
  });

  it("labels RCA confidence from score and evidence without inventing certainty", () => {
    expect(labelRcaConfidence({ score: 0.4, supportingEvidenceCount: 1 })).toBe("POSSIBLE");
    expect(labelRcaConfidence({ score: 0.7, supportingEvidenceCount: 1 })).toBe("PROBABLE");
    expect(labelRcaConfidence({ score: 0.9, supportingEvidenceCount: 2 })).toBe("CONFIRMED");
    expect(labelRcaConfidence({ score: 0.3, supportingEvidenceCount: 0, operatorConfirmed: true })).toBe(
      "CONFIRMED"
    );
  });

  it("Scenario A: external payment dependency ranks above downstream alerts", () => {
    expect(retailCheckoutFixture.scenarioA.entities.map((e) => e.key)).toEqual([
      "online-store",
      "checkout",
      "customer-checkout-workflow",
      "payment-api",
      "external-payment-provider"
    ]);

    const ranked = rankScenarioACandidates([
      { id: "downstream-checkout", kind: "DOWNSTREAM_ALERT", isUpstreamExternal: false, score: 0.8 },
      { id: "downstream-workflow", kind: "DOWNSTREAM_ALERT", isUpstreamExternal: false, score: 0.75 },
      {
        id: "external-provider",
        kind: "EXTERNAL_DEPENDENCY",
        isUpstreamExternal: true,
        score: 0.7
      },
      { id: "recent-deploy", kind: "CHANGE_EVENT", isUpstreamExternal: false, score: 0.65 }
    ]);

    expect(ranked[0]).toBe("external-provider");
    expect(ranked).toContain("downstream-checkout");
    expect(buildIncidentFingerprint(["fp-a", "fp-b"])).toHaveLength(32);
  });
});
