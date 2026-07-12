import { describe, expect, it } from "vitest";
import {
  MIN_RETENTION_DAYS,
  computeCutoff,
  resolveRetentionFromEntitlements
} from "./retention.service";

describe("retention.service", () => {
  describe("computeCutoff", () => {
    it("returns null for unlimited retention", () => {
      expect(computeCutoff(new Date(), null)).toBeNull();
    });

    it("subtracts the retention window from now", () => {
      const now = new Date("2026-07-12T00:00:00.000Z");
      const cutoff = computeCutoff(now, 30);
      expect(cutoff?.toISOString()).toBe("2026-06-12T00:00:00.000Z");
    });

    it("enforces a minimum retention floor", () => {
      const now = new Date("2026-07-12T00:00:00.000Z");
      const cutoff = computeCutoff(now, 0);
      const expected = new Date(now.getTime() - MIN_RETENTION_DAYS * 24 * 60 * 60 * 1000);
      expect(cutoff?.toISOString()).toBe(expected.toISOString());
    });
  });

  describe("resolveRetentionFromEntitlements", () => {
    it("reads domain-scoped keys", () => {
      const resolved = resolveRetentionFromEntitlements([
        { featureKey: "retention.telemetry.days", retentionDays: 30, enabled: true },
        { featureKey: "retention.incidents.days", retentionDays: 90, enabled: true }
      ]);
      expect(resolved).toEqual({ telemetryDays: 30, incidentDays: 90 });
    });

    it("falls back to legacy flat keys", () => {
      const resolved = resolveRetentionFromEntitlements([
        { featureKey: "telemetry.retention_days", retentionDays: 14, enabled: true },
        { featureKey: "incidents.retention_days", retentionDays: 30, enabled: true }
      ]);
      expect(resolved).toEqual({ telemetryDays: 14, incidentDays: 30 });
    });

    it("ignores disabled entitlements", () => {
      const resolved = resolveRetentionFromEntitlements([
        { featureKey: "retention.telemetry.days", retentionDays: 30, enabled: false }
      ]);
      expect(resolved.telemetryDays).toBeNull();
    });

    it("returns null when no retention entitlement is present", () => {
      const resolved = resolveRetentionFromEntitlements([
        { featureKey: "monitoring.monitors.max", retentionDays: null, enabled: true }
      ]);
      expect(resolved).toEqual({ telemetryDays: null, incidentDays: null });
    });
  });
});
