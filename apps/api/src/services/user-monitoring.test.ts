import { describe, expect, it } from "vitest";
import {
  bindMonitoringUser,
  hashMonitoringTicket,
  monitoringTicket,
  parseSessionHeartbeat,
  presentMonitoredUsers,
  safeStaffLabel,
  sanitizeDirectory
} from "./user-monitoring";

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MANAGER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RECEPTION = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SESSION = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const INSTALL = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const TICKET = "f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1";

describe("staff directory sanitising", () => {
  it("keeps authorised roles and drops email addresses", () => {
    const staff = sanitizeDirectory([
      { userId: OWNER, displayName: "Owner", role: "owner", status: "active", email: "owner@example.com" },
      { userId: MANAGER, displayName: "manager@example.com", role: "manager", status: "active", propertyIds: [INSTALL] },
      { userId: RECEPTION, displayName: "Front Desk", role: "receptionist", status: "disabled", propertyIds: [INSTALL] },
      { userId: "not-a-user", displayName: "Guest", role: "guest", status: "active" }
    ]);

    expect(staff).toHaveLength(3);
    expect(JSON.stringify(staff)).not.toContain("@");
    expect(staff.map((row) => [row.role, row.propertyAccess, row.accountStatus])).toEqual([
      ["Owner", "ALL", "ACTIVE"],
      ["Manager", "ASSIGNED", "ACTIVE"],
      ["Receptionist", "ASSIGNED", "SUSPENDED"]
    ]);
    expect(staff[1]?.displayName).toBe("Staff");
    expect(staff[0]?.propertyIds).toEqual([]);
    expect(staff[1]?.propertyIds).toEqual([INSTALL]);
  });
});

describe("monitoring identity binding", () => {
  it("rejects a payload that names a different user", () => {
    expect(bindMonitoringUser(MANAGER, OWNER)).toEqual({
      ok: false,
      reason: "The reported user does not match the authenticated NiiNai session"
    });
  });

  it("rejects a heartbeat that has no verified user", () => {
    expect(bindMonitoringUser(OWNER, null).ok).toBe(false);
    expect(monitoringTicket("header.payload.signature")).toBeNull();
  });

  it("accepts the user proven by the ticket", () => {
    expect(bindMonitoringUser(OWNER, OWNER)).toEqual({ ok: true, userId: OWNER });
    expect(bindMonitoringUser(null, OWNER)).toEqual({ ok: true, userId: OWNER });
  });

  it("hashes a ticket without keeping the ticket as the stored value", () => {
    const hash = hashMonitoringTicket(TICKET);
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(TICKET);
    expect(hashMonitoringTicket(TICKET.toUpperCase())).toBe(hash);
  });
});

describe("user presence", () => {
  const staff = sanitizeDirectory([
    { userId: OWNER, displayName: "Owner", role: "owner", status: "active" },
    { userId: MANAGER, displayName: "Manager", role: "manager", status: "active" },
    { userId: RECEPTION, displayName: "Receptionist", role: "receptionist", status: "disabled" }
  ]);
  const now = new Date("2026-10-17T12:00:00.000Z");

  it("groups two live sessions under one user and leaves a silent user offline", () => {
    const shown = presentMonitoredUsers(staff, [
      { sessionId: SESSION, userId: OWNER, installationId: INSTALL, lastSeenAt: now, appVersion: "1.3.2" },
      { sessionId: MANAGER, userId: OWNER, installationId: SESSION, lastSeenAt: now, appVersion: "1.3.2" },
      { sessionId: INSTALL, userId: MANAGER, installationId: INSTALL, lastSeenAt: new Date("2026-10-17T11:00:00.000Z") }
    ], now);

    const owner = shown.find((row) => row.userId === OWNER);
    const manager = shown.find((row) => row.userId === MANAGER);
    expect(owner).toMatchObject({ status: "ONLINE", statusLabel: "Online", sessions: 2, propertyAccess: "All properties" });
    expect(manager).toMatchObject({ status: "OFFLINE", statusLabel: "Offline", sessions: 0, propertyAccess: "Assigned properties" });
  });

  it("shows never connected and suspended from the directory, not from a heartbeat", () => {
    const shown = presentMonitoredUsers(staff, [], now);
    expect(shown.find((row) => row.userId === OWNER)?.statusLabel).toBe("Never connected");
    expect(shown.find((row) => row.userId === RECEPTION)?.statusLabel).toBe("Suspended");
  });

  it("keeps a suspended user's heartbeat visible without counting it as an active session", () => {
    const shown = presentMonitoredUsers(staff, [
      { sessionId: SESSION, userId: RECEPTION, installationId: INSTALL, lastSeenAt: now, appVersion: "1.3.2" }
    ], now);
    expect(shown.find((row) => row.userId === RECEPTION)).toMatchObject({
      status: "SUSPENDED",
      statusLabel: "Suspended",
      sessions: 0,
      sessionDetails: [{ sessionId: SESSION, presence: "ONLINE" }]
    });
  });

  it("does not keep a signed-out session in the session count", () => {
    const shown = presentMonitoredUsers(staff, [
      { sessionId: SESSION, userId: OWNER, installationId: INSTALL, lastSeenAt: now, endedAt: now }
    ], now);
    expect(shown.find((row) => row.userId === OWNER)).toMatchObject({ status: "OFFLINE", sessions: 0, sessionDetails: [] });
  });
});

describe("session payload", () => {
  it("stores the session without the ticket or an email", () => {
    const parsed = parseSessionHeartbeat({
      session: { id: SESSION, installationId: INSTALL, userId: OWNER, ticket: TICKET },
      email: "person@example.com",
      sync: { lifecycle: { pending: 0, failed: 0 }, financial: { pending: 0, failed: 0 } }
    });
    expect(parsed.kind).toBe("session");
    if (parsed.kind !== "session") return;
    expect(JSON.stringify(parsed.value.sanitizedPayload)).not.toContain(TICKET);
    expect(JSON.stringify(parsed.value.sanitizedPayload)).not.toContain("example.com");
    expect(safeStaffLabel("person@example.com")).toBe("Staff");
  });
});
