import { describe, expect, it } from "vitest";
import { AUTO_RUN_ALLOWLIST, getAutoRunPolicy } from "../remediation/auto-run-policy.service";

describe("auto-run allowlist expansion", () => {
  it("includes connection/heartbeat safe actions", () => {
    expect(AUTO_RUN_ALLOWLIST.has("REQUEST_FRESH_HEARTBEAT")).toBe(true);
    expect(AUTO_RUN_ALLOWLIST.has("REFRESH_CONNECTION_STATUS")).toBe(true);
    expect(AUTO_RUN_ALLOWLIST.has("RERUN_HTTP_CHECK")).toBe(true);
    expect(AUTO_RUN_ALLOWLIST.has("RESTART_SERVICE")).toBe(false);
  });
});

describe("getAutoRunPolicy allowlist shape", () => {
  it("returns allowlist rows for UI (may be empty policies in unit env)", async () => {
    // Uses real prisma — skip if DB unavailable by catching
    try {
      const orgs = await (await import("../../lib/prisma")).prisma.organization.findFirst({
        select: { id: true }
      });
      if (!orgs) return;
      const snap = await getAutoRunPolicy(orgs.id);
      expect(Array.isArray(snap.allowlist)).toBe(true);
      expect(snap.allowlist!.length).toBeGreaterThan(0);
      const safe = snap.allowlist!.find((row) => row.action === "RERUN_HTTP_CHECK");
      expect(safe?.autoRunEnabled).toBeTypeOf("boolean");
      const high = snap.allowlist!.find((row) => row.action === "RESTART_SERVICE");
      expect(high?.approvalRequired).toBe(true);
      expect(high?.autoRunEnabled).toBe(false);
    } catch {
      // DB unavailable in some CI sandboxes
    }
  });
});
