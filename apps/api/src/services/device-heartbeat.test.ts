import { describe, expect, it } from "vitest";
import {
  DEVICE_OFFLINE_AFTER_SECONDS,
  classifySyncLane,
  deviceCredentialRejection,
  devicePresence,
  parseDeviceHeartbeatPayload,
  presentMonitoredDevices
} from "./device-heartbeat";
import { NIINAI_REACHABILITY_STATUS, NIINAI_SUPABASE_HEALTH_URL } from "./niinai-cloud-check";

const DEVICE_A = "11111111-1111-4111-8111-111111111111";
const DEVICE_B = "22222222-2222-4222-8222-222222222222";
const DEVICE_C = "33333333-3333-4333-8333-333333333333";

describe("device heartbeat allow-list", () => {
  it("keeps technical fields and drops guest and financial content", () => {
    const parsed = parseDeviceHeartbeatPayload({
      device: { id: DEVICE_A, label: "Kanewu Reception", reportedName: "FRONT-DESK" },
      propertyId: "44444444-4444-4444-8444-444444444444",
      guestName: "Ama Mensah",
      phone: "0244000000",
      amount: 120,
      sync: {
        pendingCount: 2,
        failedCount: 1,
        conflictCount: 0,
        oldestPendingAgeSeconds: 30,
        lastSuccessfulSyncAt: "2026-10-17T10:00:00.000Z",
        lifecycle: { pending: 1, failed: 0, oldestPendingAgeSeconds: 30 },
        financial: { pending: 0, failed: 1, oldestPendingAgeSeconds: 5 }
      }
    });

    expect(parsed.kind).toBe("device");
    if (parsed.kind !== "device") return;
    expect(parsed.value.payload).not.toHaveProperty("guestName");
    expect(parsed.value.payload).not.toHaveProperty("phone");
    expect(parsed.value.payload).not.toHaveProperty("amount");
    expect(JSON.stringify(parsed.value.payload)).not.toContain("Ama");
    expect(JSON.stringify(parsed.value.payload)).not.toContain("0244");
    expect(parsed.value.lifecycleSync).toBe("HEALTHY");
    expect(parsed.value.financialSync).toBe("FAILED");
  });

  it("rejects a device object without a UUID and ignores ordinary heartbeats", () => {
    expect(parseDeviceHeartbeatPayload({ device: { id: "front-desk" } }).kind).toBe("invalid");
    expect(parseDeviceHeartbeatPayload({ status: "HEALTHY" }).kind).toBe("absent");
    expect(parseDeviceHeartbeatPayload(undefined).kind).toBe("absent");
  });

  it("marks a lane delayed only after the pending-age threshold", () => {
    expect(classifySyncLane({ pending: 1, failed: 0, oldestPendingAgeSeconds: 60 })).toBe("HEALTHY");
    expect(
      classifySyncLane({
        pending: 1,
        failed: 0,
        oldestPendingAgeSeconds: 15 * 60
      })
    ).toBe("DELAYED");
    expect(classifySyncLane(null)).toBe("UNKNOWN");
  });
});

describe("independent computer presence", () => {
  it("shows one computer offline without changing the others", () => {
    const now = new Date("2026-10-17T12:00:00.000Z");
    const presented = presentMonitoredDevices(
      [
        {
          id: "row-a",
          deviceId: DEVICE_A,
          label: "Kanewu Reception",
          appVersion: "1.3.2",
          lifecycleSync: "FAILED",
          financialSync: "HEALTHY",
          lastSeenAt: now,
          offlineAfterSeconds: DEVICE_OFFLINE_AFTER_SECONDS
        },
        {
          id: "row-b",
          deviceId: DEVICE_B,
          label: "Community 25 Reception",
          appVersion: "1.3.1",
          lifecycleSync: "HEALTHY",
          financialSync: "HEALTHY",
          lastSeenAt: new Date(now.getTime() - 11 * 60_000),
          offlineAfterSeconds: DEVICE_OFFLINE_AFTER_SECONDS
        },
        {
          id: "row-c",
          deviceId: DEVICE_C,
          label: "Owner computer",
          appVersion: "1.3.2",
          lifecycleSync: "HEALTHY",
          financialSync: "DELAYED",
          lastSeenAt: new Date(now.getTime() - 30_000),
          offlineAfterSeconds: DEVICE_OFFLINE_AFTER_SECONDS
        }
      ],
      now
    );

    expect(presented.map((row) => row.presence)).toEqual(["ONLINE", "OFFLINE", "ONLINE"]);
    expect(presented[0]?.lifecycleSync).toBe("FAILED");
    expect(presented[1]?.lifecycleSync).toBe("HEALTHY");
    expect(presented[2]?.financialSync).toBe("DELAYED");
    expect(presented[0]?.versionNote).toBe("Different from another computer");
    expect(devicePresence(new Date(now.getTime() - 9 * 60_000), 600, now)).toBe("ONLINE");
  });

  it("treats a heartbeat older than 10 minutes as offline even when the stored flag still says online", () => {
    const now = new Date("2026-10-18T09:00:00.000Z");
    const [device] = presentMonitoredDevices(
      [
        {
          id: "row-stale",
          deviceId: DEVICE_A,
          label: "Front desk",
          appVersion: "1.3.2",
          lifecycleSync: "HEALTHY",
          financialSync: "HEALTHY",
          lastSeenAt: new Date(now.getTime() - 22 * 60 * 60_000),
          offlineAfterSeconds: DEVICE_OFFLINE_AFTER_SECONDS
        }
      ],
      now
    );

    expect(device?.presence).toBe("OFFLINE");
    expect(device?.lifecycleSync).toBe("HEALTHY");
  });
});

describe("per-computer credentials", () => {
  it("accepts only the enrolled computer and ignores other ingest keys", () => {
    const payload = { device: { id: DEVICE_A, reportedName: "FRONT-DESK" } };
    expect(deviceCredentialRejection(`NiiNai computer ${DEVICE_A}`, payload)).toBeNull();
    expect(deviceCredentialRejection("NiiNai Guest House heartbeat ingest", payload)).toBeNull();
    expect(deviceCredentialRejection(`NiiNai computer ${DEVICE_B}`, payload)).toBe(
      "Device credential does not match this computer"
    );
  });
});

describe("NiiNai cloud reachability check", () => {
  it("accepts a live host response and rejects server errors without a credential", () => {
    expect(NIINAI_SUPABASE_HEALTH_URL).toBe(
      "https://ojmfvcvijgxboohpnfdu.supabase.co/auth/v1/health"
    );
    expect(NIINAI_SUPABASE_HEALTH_URL).not.toContain("apikey");
    expect(NIINAI_REACHABILITY_STATUS.acceptedStatusMax).toBeLessThan(500);
    expect(NIINAI_REACHABILITY_STATUS.acceptedStatusMin).toBeLessThanOrEqual(401);
    expect(NIINAI_REACHABILITY_STATUS.acceptedStatusMax).toBeGreaterThanOrEqual(401);
  });
});
