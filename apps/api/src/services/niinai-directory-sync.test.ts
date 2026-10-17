import { describe, expect, it, vi } from "vitest";
import { redactMonitoringSecret, syncNiinaiStaffDirectory } from "./niinai-directory-sync";

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RECEPTION = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("NiiNai directory sync", () => {
  it("does nothing when the monitoring connection is not configured", async () => {
    const replace = vi.fn();
    const result = await syncNiinaiStaffDirectory({
      env: {},
      replace
    });
    expect(result).toEqual({
      status: "DISABLED",
      reason: "NIINAI_MONITORING_DATABASE_URL is not set"
    });
    expect(replace).not.toHaveBeenCalled();
  });

  it("leaves existing staff in place when the directory is empty", async () => {
    const replace = vi.fn();
    await expect(
      syncNiinaiStaffDirectory({
        env: { NIINAI_MONITORING_DATABASE_URL: "postgresql://local" },
        findProject: async () => ({ id: "project-1" }),
        queryDirectory: async () => [],
        replace
      })
    ).rejects.toThrow("left unchanged");
    expect(replace).not.toHaveBeenCalled();
  });

  it("stores sanitised staff and does not keep an email address", async () => {
    const replace = vi.fn(async () => 2);
    const result = await syncNiinaiStaffDirectory({
      env: { NIINAI_MONITORING_DATABASE_URL: "postgresql://local" },
      findProject: async () => ({ id: "project-1" }),
      queryDirectory: async () => [
        { user_id: OWNER, display_name: "Owner", role: "owner", status: "active", property_ids: [] },
        {
          user_id: RECEPTION,
          display_name: "desk@example.com",
          role: "receptionist",
          status: "disabled",
          property_ids: ["11111111-1111-4111-8111-111111111111"]
        }
      ],
      replace
    });
    expect(result).toEqual({ status: "SYNCED", count: 2 });
    expect(replace).toHaveBeenCalledOnce();
    const stored = replace.mock.calls[0]?.[1];
    expect(stored).toEqual([
      expect.objectContaining({ userId: OWNER, role: "Owner", accountStatus: "ACTIVE", propertyAccess: "ALL" }),
      expect.objectContaining({
        userId: RECEPTION,
        displayName: "Staff",
        role: "Receptionist",
        accountStatus: "SUSPENDED",
        propertyAccess: "ASSIGNED"
      })
    ]);
    expect(JSON.stringify(stored)).not.toContain("@");
  });

  it("removes a monitoring password from a connection error", () => {
    const secret = "postgresql://niinai_monitoring:secret-value@db.example/postgres";
    expect(redactMonitoringSecret(`connect failed for ${secret}`, secret)).toBe(
      "connect failed for [redacted]"
    );
  });
});
