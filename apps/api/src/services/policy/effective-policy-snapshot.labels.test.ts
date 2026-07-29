import { describe, expect, it } from "vitest";
import {
  POLICY_AREA_REMEDIATION_ROUTES,
  readinessStatusLabel,
  type ReadinessStatus
} from "./readiness-registry";

/** Mirrors effective-policy-snapshot resolveAreaStatus for label mapping tests. */
const resolveAreaStatus = (input: {
  requested: boolean;
  effective: boolean;
  readinessOk: boolean;
  notApplicable?: boolean;
}): ReadinessStatus => {
  if (input.notApplicable) return "not_applicable";
  if (!input.requested) return "disabled";
  if (input.effective && input.readinessOk) return "full";
  return "not_configured";
};

describe("policy area status labels", () => {
  it("maps to Full / Not configured / Not applicable / Disabled — never Partial", () => {
    const cases: Array<{ status: ReadinessStatus; label: string }> = [
      {
        status: resolveAreaStatus({ requested: true, effective: true, readinessOk: true }),
        label: "Full"
      },
      {
        status: resolveAreaStatus({ requested: true, effective: false, readinessOk: false }),
        label: "Not configured"
      },
      {
        status: resolveAreaStatus({
          requested: false,
          effective: false,
          readinessOk: true,
          notApplicable: true
        }),
        label: "Not applicable"
      },
      {
        status: resolveAreaStatus({ requested: false, effective: false, readinessOk: true }),
        label: "Disabled"
      }
    ];

    for (const row of cases) {
      expect(readinessStatusLabel(row.status)).toBe(row.label);
      expect(readinessStatusLabel(row.status)).not.toMatch(/Partial/i);
    }
  });

  it("counts full + disabled + not_applicable as covered for policy coverage", () => {
    const areas = [
      resolveAreaStatus({ requested: true, effective: true, readinessOk: true }),
      resolveAreaStatus({ requested: false, effective: false, readinessOk: true }),
      resolveAreaStatus({
        requested: false,
        effective: false,
        readinessOk: true,
        notApplicable: true
      }),
      resolveAreaStatus({ requested: true, effective: false, readinessOk: false })
    ];
    const covered = areas.filter(
      (s) => s === "full" || s === "disabled" || s === "not_applicable"
    ).length;
    expect(covered).toBe(3);
    expect(Math.round((covered / areas.length) * 100)).toBe(75);
  });

  it("only lists real remediation routes or null — no placeholder paths", () => {
    for (const [area, href] of Object.entries(POLICY_AREA_REMEDIATION_ROUTES)) {
      if (href == null) continue;
      expect(href.startsWith("/"), `${area} route`).toBe(true);
      expect(href).not.toMatch(/#todo|placeholder|404/i);
    }
  });
});
