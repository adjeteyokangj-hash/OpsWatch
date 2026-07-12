import { describe, expect, it } from "vitest";
import {
  ENTITLEMENT_KEYS,
  LEGACY_ENTITLEMENT_ALIASES,
  normalizeEntitlementKey,
  groupEntitlementsByDomain
} from "./entitlement-keys";

describe("entitlement key domains", () => {
  it("maps legacy flat keys to domain-scoped keys", () => {
    expect(normalizeEntitlementKey("applications.max")).toBe(
      ENTITLEMENT_KEYS.MONITORING_APPLICATIONS_MAX
    );
    expect(normalizeEntitlementKey("remediation.autonomous")).toBe(
      ENTITLEMENT_KEYS.REMEDIATION_AUTONOMOUS
    );
    expect(normalizeEntitlementKey(ENTITLEMENT_KEYS.DIAGNOSIS_AI)).toBe(
      ENTITLEMENT_KEYS.DIAGNOSIS_AI
    );
  });

  it("covers every legacy alias", () => {
    for (const legacyKey of Object.keys(LEGACY_ENTITLEMENT_ALIASES)) {
      expect(normalizeEntitlementKey(legacyKey)).toMatch(/^[a-z]+\.[a-z0-9_.]+$/);
    }
  });

  it("groups entitlements by domain", () => {
    const grouped = groupEntitlementsByDomain({
      [ENTITLEMENT_KEYS.MONITORING_MONITORS_MAX]: { limit: 25 },
      [ENTITLEMENT_KEYS.DIAGNOSIS_AI]: { enabled: true },
      "remediation.autonomous": { enabled: false }
    });

    expect(grouped.monitoring[ENTITLEMENT_KEYS.MONITORING_MONITORS_MAX]).toEqual({ limit: 25 });
    expect(grouped.diagnosis[ENTITLEMENT_KEYS.DIAGNOSIS_AI]).toEqual({ enabled: true });
    expect(grouped.remediation[ENTITLEMENT_KEYS.REMEDIATION_AUTONOMOUS]).toEqual({ enabled: false });
  });
});
